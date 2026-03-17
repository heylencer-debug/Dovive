/**
 * migrate-reviews-to-dash.js
 * Builds review_analysis JSON from raw dovive_reviews and pushes to supplement-scope-dash products
 * Scope: ashwagandha gummies (category 820537da-3994-4a11-a2e0-a636d751b26f)
 *
 * review_analysis shape expected by dashboard:
 * {
 *   sentiment_distribution: {
 *     very_positive_5star: { count, percentage },
 *     positive_4star: { count, percentage },
 *     neutral_3star: { count, percentage },
 *     negative_2star: { count, percentage },
 *     very_negative_1star: { count, percentage },
 *     positive: number,   // % of 4+5 star
 *     neutral: number,    // % of 3 star
 *     negative: number,   // % of 1+2 star
 *   },
 *   analysis_metadata: { total_reviews_analyzed, average_rating, analysis_quality }
 * }
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { resolveCategory } = require('./utils/category-resolver');

const DOVIVE = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);

// ── Dynamic keyword + category resolution ─────────────────────
const _kwIdx = process.argv.indexOf('--keyword');
const KEYWORD = _kwIdx >= 0
  ? process.argv[_kwIdx + 1]
  : (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'ashwagandha gummies');

async function lookupCategoryId(keyword) {
  const cat = await resolveCategory(DASH, keyword);
  console.log(`  → Resolved category (${cat.method}): "${cat.name}" (${cat.id})`);
  return cat.id;
}


function buildReviewAnalysis(reviews) {
  const total = reviews.length;
  if (total === 0) return null;

  const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let ratingSum = 0;

  for (const r of reviews) {
    const star = Math.round(r.rating);
    if (counts[star] !== undefined) counts[star]++;
    ratingSum += r.rating;
  }

  const pct = (n) => Math.round((n / total) * 100);
  const positiveCount = counts[5] + counts[4];
  const neutralCount = counts[3];
  const negativeCount = counts[2] + counts[1];

  // Top reviews for Product Details Modal display
  const withBody = reviews.filter(r => r.body && r.body.trim().length > 10);
  const topPositive = withBody
    .filter(r => r.rating >= 4)
    .sort((a, b) => (b.helpful_votes || 0) - (a.helpful_votes || 0))
    .slice(0, 5)
    .map(r => ({ rating: r.rating, title: r.title || '', body: r.body, reviewer: r.reviewer_name || '', date: r.review_date, verified: r.verified_purchase }));
  const topCritical = withBody
    .filter(r => r.rating <= 2)
    .sort((a, b) => (b.helpful_votes || 0) - (a.helpful_votes || 0))
    .slice(0, 5)
    .map(r => ({ rating: r.rating, title: r.title || '', body: r.body, reviewer: r.reviewer_name || '', date: r.review_date, verified: r.verified_purchase }));
  const topNeutral = withBody
    .filter(r => r.rating === 3)
    .slice(0, 3)
    .map(r => ({ rating: r.rating, title: r.title || '', body: r.body, reviewer: r.reviewer_name || '', date: r.review_date, verified: r.verified_purchase }));

  // Common pain points from critical reviews
  const pain_points = topCritical.map(r => ({ issue: r.title, body: r.body?.slice(0, 150) }));

  return {
    sentiment_distribution: {
      very_positive_5star: { count: counts[5], percentage: pct(counts[5]) },
      positive_4star:      { count: counts[4], percentage: pct(counts[4]) },
      neutral_3star:       { count: counts[3], percentage: pct(counts[3]) },
      negative_2star:      { count: counts[2], percentage: pct(counts[2]) },
      very_negative_1star: { count: counts[1], percentage: pct(counts[1]) },
      positive: pct(positiveCount),
      neutral:  pct(neutralCount),
      negative: pct(negativeCount),
    },
    // Raw review text for Product Details Modal
    top_reviews: {
      positive: topPositive,
      critical: topCritical,
      neutral:  topNeutral,
    },
    pain_points,
    analysis_metadata: {
      total_reviews_analyzed: total,
      average_rating: Math.round((ratingSum / total) * 10) / 10,
      analysis_quality: total >= 20 ? 'high' : total >= 5 ? 'medium' : 'low',
      source: 'dovive_reviews',
      generated_at: new Date().toISOString(),
    },
  };
}

async function run() {
  console.log(`=== Reviews Migration: dovive → supplement-scope-dash ===`);
  console.log(`Keyword: "${KEYWORD}"\n`);

  const DASH_CAT_ID = await lookupCategoryId(KEYWORD);

  // 1. Get dash product ASINs for this category
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

  // 2. Get all reviews for ashwagandha gummies
  let allReviews = [];
  let page = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await DOVIVE
      .from('dovive_reviews')
      .select('asin, rating, title, body, reviewer_name, review_date, verified_purchase, helpful_votes')
      .eq('keyword', KEYWORD)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    allReviews = allReviews.concat(data);
    if (data.length < pageSize) break;
    page++;
  }

  console.log(`Fetched ${allReviews.length} reviews total`);

  // 3. Group reviews by ASIN
  const byAsin = {};
  for (const r of allReviews) {
    if (!byAsin[r.asin]) byAsin[r.asin] = [];
    byAsin[r.asin].push(r);
  }

  const asinsWithReviews = Object.keys(byAsin);
  console.log(`ASINs with reviews: ${asinsWithReviews.length}\n`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const asin of asinsWithReviews) {
    const dashId = asinToId[asin];
    if (!dashId) {
      skipped++;
      continue;
    }

    const analysis = buildReviewAnalysis(byAsin[asin]);
    if (!analysis) { skipped++; continue; }

    const { error } = await DASH
      .from('products')
      .update({
        review_analysis: analysis,
        review_analysis_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', dashId);

    if (error) {
      console.error(`  ERROR ${asin}:`, error.message);
      errors++;
    } else {
      updated++;
      if (updated % 10 === 0) console.log(`  ${updated} updated...`);
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Updated: ${updated} products with review_analysis`);
  console.log(`Skipped (ASIN not in dash or no reviews): ${skipped}`);
  console.log(`Errors: ${errors}`);
}

run().catch(console.error);
