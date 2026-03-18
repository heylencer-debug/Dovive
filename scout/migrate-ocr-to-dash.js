/**
 * migrate-ocr-to-dash.js
 * Syncs P4 OCR data from dovive_ocr → supplement-scope-dash products table
 * Populates: all_nutrients, nutrients_count, ocr_confidence, servings_per_container, serving_size
 *
 * Confidence score logic:
 *   >= 8 nutrients → 0.92 (high)
 *   5–7 nutrients  → 0.78 (good)
 *   2–4 nutrients  → 0.55 (partial)
 *   1 nutrient     → 0.35 (low)
 *   0 / null       → 0.15 (very low)
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { resolveCategory } = require('./utils/category-resolver');

const DOVIVE = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);

const KEYWORD = process.argv[2] || 'ashwagandha gummies';

// Dynamic category lookup — resolves keyword → DASH category_id
async function lookupCategoryId(keyword) {
  const cat = await resolveCategory(DASH, keyword);
  console.log(`  → Resolved category (${cat.method}): "${cat.name}" (${cat.id})`);
  return cat.id;
}


function calcConfidence(facts) {
  const n = (facts || []).length;
  if (n >= 8) return 0.92;
  if (n >= 5) return 0.78;
  if (n >= 2) return 0.55;
  if (n >= 1) return 0.35;
  return 0.15;
}

// Pick best OCR record per ASIN: most supplement_facts items
function pickBest(records) {
  return records.reduce((best, cur) => {
    const curCount = (cur.supplement_facts || []).length;
    const bestCount = (best.supplement_facts || []).length;
    return curCount > bestCount ? cur : best;
  });
}

async function main() {
  console.log(`\n=== OCR Migration: dovive_ocr → supplement-scope-dash ===`);
  console.log(`Keyword: "${KEYWORD}"\n`);

  const DASH_CAT_ID = await lookupCategoryId(KEYWORD);

  // 1. Load all OCR records for this keyword
  const { data: ocrRows, error: ocrErr } = await DOVIVE
    .from('dovive_ocr')
    .select('asin,serving_size,servings_per_container,supplement_facts,certifications,health_claims')
    .eq('keyword', KEYWORD);

  if (ocrErr) { console.error('OCR fetch error:', ocrErr.message); return; }
  console.log(`Fetched ${ocrRows.length} OCR records`);

  // Group by ASIN, keep best record per ASIN
  const byAsin = new Map();
  for (const row of ocrRows) {
    const existing = byAsin.get(row.asin);
    if (!existing) {
      byAsin.set(row.asin, row);
    } else {
      // Keep record with more supplement_facts
      const existingCount = (existing.supplement_facts || []).length;
      const curCount = (row.supplement_facts || []).length;
      if (curCount > existingCount) byAsin.set(row.asin, row);
    }
  }
  console.log(`Unique ASINs with OCR data: ${byAsin.size}`);

  // 2. Load all products from DASH
  const { data: products, error: prodErr } = await DASH
    .from('products')
    .select('id,asin,title,bsr_current')
    .eq('category_id', DASH_CAT_ID);

  if (prodErr) { console.error('Products fetch error:', prodErr.message); return; }
  console.log(`Products in DASH: ${products.length}\n`);

  const dashByAsin = new Map(products.map(p => [p.asin, p]));

  let updated = 0, skipped = 0, errors = 0;
  const weakRows = [];

  for (const [asin, ocr] of byAsin) {
    const product = dashByAsin.get(asin);
    if (!product) { skipped++; continue; }

    const productId = product.id;
    const facts = Array.isArray(ocr.supplement_facts) ? ocr.supplement_facts.filter(f => f && f.name) : [];
    const confidence = calcConfidence(facts);
    const nutrientsCount = facts.length;

    // Build supplement_facts_raw as a human-readable text string (used by phase tracker + formula prompt)
    const sfRaw = facts.length > 0
      ? facts.map(f => `${f.name}: ${f.amount || '?'}${f.dv_percent ? ` (${f.dv_percent}% DV)` : ''}`).join('\n')
      : null;

    const updateData = {
      all_nutrients: facts.length > 0 ? facts : null,
      supplement_facts_raw: sfRaw,
      nutrients_count: nutrientsCount,
      ocr_confidence: confidence,
    };

    // Only set serving info if not already present
    if (ocr.serving_size) updateData.serving_size = ocr.serving_size;
    if (ocr.servings_per_container) updateData.servings_per_container = parseInt(ocr.servings_per_container) || null;
    if (ocr.certifications && Array.isArray(ocr.certifications) && ocr.certifications.length > 0) {
      updateData.claims_on_label = ocr.certifications;
    }

    const { error } = await DASH.from('products').update(updateData).eq('id', productId);
    if (error) {
      console.error(`  ✗ ${asin}: ${error.message}`);
      errors++;
    } else {
      updated++;
      if (nutrientsCount === 0) {
        weakRows.push({ asin, title: product.title || '', bsr: product.bsr_current || null, reason: 'empty_supplement_facts' });
      }
      if (updated % 20 === 0) console.log(`  ${updated} updated...`);
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Updated: ${updated} products`);
  console.log(`Skipped (ASIN not in DASH): ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log(`\nFields now populated: all_nutrients, nutrients_count, ocr_confidence, serving_size, servings_per_container`);

  if (weakRows.length) {
    weakRows.sort((a, b) => (a.bsr || 9999999) - (b.bsr || 9999999));
    const top20Weak = weakRows.filter(r => r.bsr && r.bsr <= 20).length;
    console.log(`\n⚠ OCR weak rows (0 nutrients): ${weakRows.length} | top20 affected: ${top20Weak}`);
    console.log('Top weak rows by BSR:');
    weakRows.slice(0, 20).forEach(r => {
      console.log(`  - ${r.asin} | BSR ${r.bsr ?? 'NA'} | ${r.title.substring(0, 90)}`);
    });
  }
}

main().catch(console.error);
