/**
 * patch-supplement-scope-data.js
 * Fixes 3 data issues in supplement-scope-dash products:
 * 1. Price: use dovive_keepa.price_usd (correct) over dovive_research.price (sometimes wrong)
 * 2. Reviews: populate from dovive_keepa.review_count
 * 3. supplement_facts_raw + all_nutrients: migrate from dovive_ocr
 */

const { createClient } = require('@supabase/supabase-js');

const DOVIVE_URL = 'https://fhfqjcvwcxizbioftvdw.supabase.co';
const DOVIVE_KEY = 'sb_secret_Urw2XKj4d9QUsvcEnQrKBA_TzA_KEnH';

const SS_URL = 'https://jwkitkfufigldpldqtbq.supabase.co';
const SS_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc';

const dovive = createClient(DOVIVE_URL, DOVIVE_KEY);
const ss = createClient(SS_URL, SS_KEY);

async function fetchAll(client, table, columns, batchSize = 1000) {
  let all = [];
  let offset = 0;
  while (true) {
    const { data, error } = await client.from(table).select(columns).range(offset, offset + batchSize - 1);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < batchSize) break;
    offset += batchSize;
  }
  return all;
}

async function main() {
  console.log('=== Patch supplement-scope-dash product data ===\n');

  // 1. Load all products from supplement-scope-dash (with category_id set = our migrated data)
  console.log('Loading supplement-scope-dash products...');
  const ssProducts = await fetchAll(ss, 'products', 'id,asin,price,reviews,rating_count,supplement_facts_raw,all_nutrients,ocr_extracted,category_id');
  const ourProducts = ssProducts.filter(p => p.category_id !== null);
  console.log(`  Found ${ourProducts.length} products with category_id\n`);

  const asins = ourProducts.map(p => p.asin);

  // 2. Load Keepa data for these ASINs
  console.log('Loading Keepa data...');
  const keepaRows = await fetchAll(dovive, 'dovive_keepa', 'asin,price_usd,review_count,rating');
  const keepaMap = {};
  keepaRows.forEach(r => { keepaMap[r.asin] = r; });
  console.log(`  Loaded ${keepaRows.length} Keepa records`);
  const keepaMatches = asins.filter(a => keepaMap[a]).length;
  console.log(`  ${keepaMatches}/${asins.length} of our products have Keepa data\n`);

  // 3. Load OCR data
  console.log('Loading OCR data...');
  const ocrRows = await fetchAll(dovive, 'dovive_ocr', 'asin,raw_text,supplement_facts,other_ingredients,serving_size,servings_per_container');
  // Dedupe by asin — take first (best) OCR record per product
  const ocrMap = {};
  ocrRows.forEach(r => {
    if (!ocrMap[r.asin] && (r.raw_text || r.supplement_facts)) ocrMap[r.asin] = r;
  });
  console.log(`  Loaded ${ocrRows.length} OCR records`);
  const ocrMatches = asins.filter(a => ocrMap[a]).length;
  console.log(`  ${ocrMatches}/${asins.length} of our products have OCR data\n`);

  // 4. Build patches
  console.log('Building patches...');
  const patches = [];
  let priceFixed = 0, reviewsFixed = 0, ocrFixed = 0;

  for (const p of ourProducts) {
    const patch = { id: p.id, asin: p.asin };
    let hasChange = false;

    const keepa = keepaMap[p.asin];
    const ocr = ocrMap[p.asin];

    // Fix price from Keepa
    if (keepa && keepa.price_usd && keepa.price_usd > 0 && keepa.price_usd < 500) {
      patch.price = keepa.price_usd;
      patch.price_current = keepa.price_usd;
      patch.current_price = keepa.price_usd;
      hasChange = true;
      priceFixed++;
    } else if (!keepa && p.price > 500) {
      // Price looks wrong but no Keepa to fix it — null it out
      patch.price = null;
      patch.price_current = null;
      patch.current_price = null;
      hasChange = true;
    }

    // Fix reviews from Keepa
    if (keepa && keepa.review_count !== null && keepa.review_count !== undefined) {
      patch.reviews = keepa.review_count;
      patch.rating_count = keepa.review_count;
      hasChange = true;
      reviewsFixed++;
    }

    // Fix rating from Keepa (more reliable)
    if (keepa && keepa.rating && keepa.rating > 0) {
      patch.rating = keepa.rating;
      patch.rating_value = keepa.rating;
      hasChange = true;
    }

    // Migrate OCR supplement facts
    if (ocr) {
      if (ocr.raw_text && !p.supplement_facts_raw) {
        patch.supplement_facts_raw = ocr.raw_text;
        hasChange = true;
        ocrFixed++;
      }
      if (ocr.supplement_facts && !p.all_nutrients) {
        patch.all_nutrients = ocr.supplement_facts;
        hasChange = true;
      }
      if (ocr.serving_size) {
        patch.serving_size = String(ocr.serving_size).substring(0, 100);
        hasChange = true;
      }
      if (ocr.servings_per_container) {
        const parsed = parseInt(String(ocr.servings_per_container).replace(/\D/g, ''), 10);
        if (!isNaN(parsed) && parsed > 0 && parsed < 10000) {
          patch.servings_per_container = parsed;
          hasChange = true;
        }
      }
      if (ocr.other_ingredients) {
        patch.other_ingredients = ocr.other_ingredients;
        hasChange = true;
      }
      patch.ocr_extracted = true;
      hasChange = true;
    }

    if (hasChange) patches.push(patch);
  }

  console.log(`  Price fixes: ${priceFixed}`);
  console.log(`  Review fixes: ${reviewsFixed}`);
  console.log(`  OCR migrations: ${ocrFixed}`);
  console.log(`  Total patches to apply: ${patches.length}\n`);

  if (patches.length === 0) {
    console.log('Nothing to patch. Done.');
    return;
  }

  // 5. Apply patches in batches
  console.log('Applying patches...');
  const BATCH = 50;
  let updated = 0;
  for (let i = 0; i < patches.length; i += BATCH) {
    const batch = patches.slice(i, i + BATCH);
    // Upsert by id
    const { error } = await ss.from('products').upsert(batch, { onConflict: 'id' });
    if (error) {
      console.error(`  Batch ${i}-${i+BATCH} ERROR:`, error.message);
    } else {
      updated += batch.length;
      process.stdout.write(`\r  Updated: ${updated}/${patches.length}`);
    }
  }
  console.log(`\n\n✅ Patch complete!`);
  console.log(`   ${priceFixed} prices fixed (using Keepa price_usd)`);
  console.log(`   ${reviewsFixed} review counts populated`);
  console.log(`   ${ocrFixed} products got supplement_facts_raw from OCR`);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
