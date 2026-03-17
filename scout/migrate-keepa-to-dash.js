/**
 * migrate-keepa-to-dash.js
 * Migrates Keepa data from dovive_keepa → supplement-scope-dash products
 * Fields: monthly_sales, monthly_revenue, bsr_30_days_avg, bsr_90_days_avg, price_usd, historical_data
 *
 * Usage:
 *   node migrate-keepa-to-dash.js "magnesium gummies"
 *   node migrate-keepa-to-dash.js --keyword "magnesium gummies"
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { resolveCategory } = require('./utils/category-resolver');

const DOVIVE = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);

// ── Dynamic keyword resolution ────────────────────────────────
const _kwIdx = process.argv.indexOf('--keyword');
const KEYWORD_ARG = _kwIdx >= 0
  ? process.argv[_kwIdx + 1]
  : (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'ashwagandha gummies');

async function lookupCategoryId(keyword) {
  const cat = await resolveCategory(DASH, keyword);
  console.log(`  → Resolved category (${cat.method}): "${cat.name}" (${cat.id})`);
  return cat.id;
}

function avgBSR(history) {
  if (!history || !Array.isArray(history) || history.length === 0) return null;
  const ranks = history.map(h => h.rank).filter(r => r && r > 0);
  if (ranks.length === 0) return null;
  return Math.round(ranks.reduce((a, b) => a + b, 0) / ranks.length);
}

async function run() {
  const KEYWORD = KEYWORD_ARG;
  console.log(`=== Keepa Migration: dovive → supplement-scope-dash ===`);
  console.log(`Keyword: "${KEYWORD}"\n`);

  const DASH_CAT_ID = await lookupCategoryId(KEYWORD);

  // 1. Get all ASINs in supplement-scope-dash for this category
  const { data: dashProducts, error: dashErr } = await DASH
    .from('products')
    .select('id, asin')
    .eq('category_id', DASH_CAT_ID);

  if (dashErr) throw dashErr;
  console.log(`Found ${dashProducts.length} products in supplement-scope-dash`);

  const asinToId = {};
  for (const p of dashProducts) {
    if (p.asin) asinToId[p.asin] = p.id;
  }

  // 2. Get ASINs for this keyword from dovive_research (source of truth for keyword→ASIN mapping)
  const { data: researchRows } = await DOVIVE
    .from('dovive_research')
    .select('asin')
    .eq('keyword', KEYWORD);
  const keywordAsins = (researchRows || []).map(r => r.asin);
  if (!keywordAsins.length) {
    console.log('No ASINs found in dovive_research for this keyword.');
    return;
  }
  console.log(`Found ${keywordAsins.length} ASINs in dovive_research for "${KEYWORD}"`);

  // 3. Get Keepa data by ASIN (not keyword — keyword field may be null)
  const { data: keepaRows, error: keepaErr } = await DOVIVE
    .from('dovive_keepa')
    .select('asin, monthly_sales_est, price_usd, bsr_current, bsr_history_30d, bsr_history_90d, bsr_drops_30d, bsr_drops_90d, monthly_sold_history')
    .in('asin', keywordAsins);

  if (keepaErr) throw keepaErr;
  console.log(`Found ${keepaRows.length} Keepa records\n`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const k of keepaRows) {
    const dashId = asinToId[k.asin];
    if (!dashId) {
      skipped++;
      continue;
    }

    const bsr30avg = avgBSR(k.bsr_history_30d);
    const bsr90avg = avgBSR(k.bsr_history_90d);
    const monthlyRevenue = (k.monthly_sales_est && k.price_usd)
      ? Math.round(k.monthly_sales_est * k.price_usd)
      : null;

    const patch = {
      monthly_sales: k.monthly_sales_est,
      monthly_revenue: monthlyRevenue,
      bsr_30_days_avg: bsr30avg,
      bsr_90_days_avg: bsr90avg,
      historical_data: {
        bsr_history_30d: k.bsr_history_30d,
        bsr_history_90d: k.bsr_history_90d,
        bsr_drops_30d: k.bsr_drops_30d,
        bsr_drops_90d: k.bsr_drops_90d,
        monthly_sold_history: k.monthly_sold_history,
        price_usd: k.price_usd,
      },
      updated_at: new Date().toISOString(),
    };

    const { error } = await DASH
      .from('products')
      .update(patch)
      .eq('id', dashId);

    if (error) {
      console.error(`  ERROR ${k.asin}:`, error.message);
      errors++;
    } else {
      updated++;
      if (updated % 20 === 0) console.log(`  ${updated} updated...`);
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped (ASIN not in dash): ${skipped}`);
  console.log(`Errors: ${errors}`);
}

run().catch(console.error);
