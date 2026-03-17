/**
 * fix-p3-top-reviews.js
 * Patches top_reviews into DASH products.review_analysis for all categories
 * where source reviews exist in dovive_reviews but top_reviews is missing/empty.
 * 
 * Run on Hostinger: node fix-p3-top-reviews.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const DOVIVE = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);

// All real production categories
const CATS = [
  { name: 'Ashwagandha Gummies', id: '820537da-3994-4a11-a2e0-a636d751b26f' },
  { name: 'Collagen Gummies',    id: '3e1de3ab-8e76-4b37-bd31-a4b3a2a037d8' },
  { name: 'Elderberry Gummies',  id: '98d9d9c7-ecfa-4e74-9874-c59623aed0be' },
  { name: 'Magnesium Gummies',   id: 'ac2763b7-08bf-4d33-b384-7df18552a311' },
  { name: 'Melatonin Gummies',   id: '992bf7a2-c744-4e6f-b9cc-a1e80a6f5ccd' },
  { name: 'Vitamin C Gummies',   id: '105df5c1-f8f0-4199-8230-a9f787e9e26c' },
];

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }

function needsTopReviews(review_analysis) {
  if (!review_analysis) return true; // no review_analysis at all — can't fix here, needs P3 full run
  const tr = review_analysis.top_reviews;
  if (!tr) return true;
  // Check if positive array has actual content
  const posLen = Array.isArray(tr.positive) ? tr.positive.length
               : Array.isArray(tr) ? tr.length : 0;
  return posLen === 0;
}

async function fixCategory(cat) {
  log(`\n─── ${cat.name} ───`);

  // Fetch all products that have review_analysis (P3 ran) but missing top_reviews text
  let page = 0;
  const PAGE_SIZE = 50;
  let totalFixed = 0, totalSkipped = 0, totalNoReviews = 0;

  while (true) {
    const { data: products, error } = await DASH.from('products')
      .select('id, asin, review_analysis')
      .eq('category_id', cat.id)
      .not('review_analysis', 'is', null)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) { log(`  DASH error: ${error.message}`); break; }
    if (!products?.length) break;

    const toFix = products.filter(p => needsTopReviews(p.review_analysis));
    log(`  Page ${page+1}: ${products.length} products | ${toFix.length} need top_reviews`);

    for (const p of toFix) {
      // Fetch reviews from source
      const { data: reviews } = await DOVIVE.from('dovive_reviews')
        .select('reviewer_name, rating, title, body, review_date, verified_purchase, helpful_votes')
        .eq('asin', p.asin)
        .order('helpful_votes', { ascending: false })
        .limit(40);

      if (!reviews?.length) { totalNoReviews++; continue; }

      const positive = reviews.filter(r => r.rating >= 4).slice(0, 5).map(r => ({
        title: r.title, body: r.body, reviewer: r.reviewer_name,
        date: r.review_date, rating: r.rating,
        verified: r.verified_purchase, helpful: r.helpful_votes
      }));
      const critical = reviews.filter(r => r.rating <= 2).slice(0, 5).map(r => ({
        title: r.title, body: r.body, reviewer: r.reviewer_name,
        date: r.review_date, rating: r.rating,
        verified: r.verified_purchase, helpful: r.helpful_votes
      }));
      const neutral = reviews.filter(r => r.rating === 3).slice(0, 3).map(r => ({
        title: r.title, body: r.body, reviewer: r.reviewer_name,
        date: r.review_date, rating: r.rating,
        verified: r.verified_purchase, helpful: r.helpful_votes
      }));

      const updated = {
        ...p.review_analysis,
        top_reviews: { positive, critical, neutral }
      };

      const { error: upErr } = await DASH.from('products')
        .update({ review_analysis: updated })
        .eq('id', p.id);

      if (upErr) { log(`  ❌ ${p.asin}: ${upErr.message}`); }
      else { totalFixed++; }
    }

    totalSkipped += (products.length - toFix.length);
    if (products.length < PAGE_SIZE) break;
    page++;
  }

  log(`  ✅ Fixed: ${totalFixed} | Already had text: ${totalSkipped} | No reviews in source: ${totalNoReviews}`);
  return totalFixed;
}

async function main() {
  console.log('\n🔧 P3 TOP-REVIEWS FIX — All Production Categories\n' + '═'.repeat(60));

  let grandTotal = 0;
  for (const cat of CATS) {
    grandTotal += await fixCategory(cat);
  }

  console.log('\n' + '═'.repeat(60));
  log(`Done. Total products fixed: ${grandTotal}`);
}

main().catch(console.error);
