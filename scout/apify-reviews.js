/**
 * apify-reviews.js — Phase 3: Apify-based Review Scraper (Enhanced)
 * ─────────────────────────────────────────────────────────────────
 * Uses Apify "web_wanderer/amazon-reviews-extractor" actor
 * 
 * This actor can get up to 500+ reviews per product using "All Stars" mode
 * (100 reviews per star rating × 5 ratings = 500 reviews)
 * 
 * Usage:
 *   node apify-reviews.js                          — all ASINs
 *   node apify-reviews.js "ashwagandha gummies"    — specific keyword
 *   node apify-reviews.js --test B094T2BZCK        — test single ASIN
 */

require('dotenv').config();
const fetch = require('node-fetch');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const APIFY_KEY = process.env.APIFY_KEY;
const ACT_ID = 'axesso_data~amazon-reviews-scraper';

// Parse arguments
const args = process.argv.slice(2);
const testMode = args[0] === '--test';
const testAsin = testMode ? args[1] : null;
const KEYWORD_FILTER = (!testMode && args[0]) || null;

// axesso_data actor config
const MAX_REVIEWS = 100; // reviews per product
const COUNTRY_CODE = 'US';
const PAGES_PER_PRODUCT = 10; // kept for compatibility
const ALL_STARS_MODE = true; // kept for compatibility
const SORT_BY = 'recent'; // kept for compatibility
const REGION = 'amazon.com'; // kept for compatibility

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Fetch ASINs from Supabase ─────────────────────────────────────────────────
async function getAsins() {
  let url = `${SUPABASE_URL}/rest/v1/dovive_research?select=asin,keyword,title&order=scraped_at.desc`;
  if (KEYWORD_FILTER) url += `&keyword=eq.${encodeURIComponent(KEYWORD_FILTER)}`;

  const res = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  if (!res.ok) throw new Error(`Failed to fetch ASINs: ${res.status}`);
  const data = await res.json();

  // Deduplicate by ASIN
  const seen = new Set();
  return data.filter(r => {
    if (seen.has(r.asin)) return false;
    seen.add(r.asin);
    return true;
  });
}

// ── Check already scraped ASINs ───────────────────────────────────────────────
async function getScrapedAsins() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/dovive_reviews?select=asin`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  if (!res.ok) return new Set();
  const data = await res.json();
  return new Set(data.map(r => r.asin));
}

// ── Run Apify actor for one ASIN ──────────────────────────────────────────────
async function fetchApifyReviews(asin) {
  console.log(`  → Calling axesso_data actor (maxReviews: ${MAX_REVIEWS}, country: ${COUNTRY_CODE})...`);

  const input = {
    input: [{ asin, countryCode: COUNTRY_CODE }],
    maxReviews: MAX_REVIEWS
  };

  // Start the run
  const runRes = await fetch(`https://api.apify.com/v2/acts/${ACT_ID}/runs?token=${APIFY_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  const runData = await runRes.json();

  if (!runData.data) {
    console.log('  → Apify response:', JSON.stringify(runData).substring(0, 500));
    throw new Error('Failed to start Apify run: ' + JSON.stringify(runData));
  }

  const runId = runData.data.id;
  console.log(`  → Run started: ${runId}`);

  // Wait for completion (poll every 10 seconds, max 300 seconds)
  for (let i = 0; i < 30; i++) {
    await sleep(10000);
    const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_KEY}`);
    const status = await statusRes.json();

    const runStatus = status.data?.status;
    console.log(`  → Status: ${runStatus} (${(i + 1) * 10}s)`);

    if (runStatus === 'SUCCEEDED') {
      const itemsRes = await fetch(`https://api.apify.com/v2/datasets/${status.data.defaultDatasetId}/items?token=${APIFY_KEY}&clean=1`);
      const items = await itemsRes.json();
      return items;
    } else if (runStatus === 'FAILED' || runStatus === 'ABORTED' || runStatus === 'TIMED-OUT') {
      throw new Error(`Apify run ${runStatus}`);
    }
  }
  throw new Error('Apify run timed out');
}

// ── Save reviews to Supabase ──────────────────────────────────────────────────
async function saveReviews(asin, keyword, reviews) {
  if (!reviews.length) return 0;

  // Filter for actual reviews (those with reviewId)
  const actualReviews = reviews.filter(r => r.reviewId);
  
  if (!actualReviews.length) {
    console.log('  ⚠ No actual reviews found in response');
    return 0;
  }
  
  const rows = actualReviews.map(r => {
    // Parse rating — axesso returns "5.0 out of 5 stars" or plain number
    let rating = r.rating || null;
    if (typeof rating === 'string') {
      const match = rating.match(/[\d.]+/);
      rating = match ? parseFloat(match[0]) : null;
    }
    // Parse date — axesso returns "Reviewed in the United States on August 17, 2025"
    let reviewDate = r.date || r.reviewDate || null;
    if (reviewDate && typeof reviewDate === 'string') {
      // Extract date from long string like "Reviewed in the United States on August 17, 2025"
      const dateMatch = reviewDate.match(/(\w+ \d+, \d{4})/);
      if (dateMatch) {
        const parsed = new Date(dateMatch[1]);
        reviewDate = isNaN(parsed.getTime()) ? null : parsed.toISOString().split('T')[0];
      } else {
        // Try parsing directly
        const parsed = new Date(reviewDate);
        reviewDate = isNaN(parsed.getTime()) ? null : parsed.toISOString().split('T')[0];
      }
    }
    return {
      asin: r.asin || asin,
      keyword: keyword || null,
      reviewer_name: r.userName || r.profileName || null,
      rating,
      title: r.title || r.reviewTitle || null,
      body: r.text || r.reviewText || null,
      review_date: reviewDate,
      verified_purchase: r.verified === true || r.verifiedPurchase === true,
      helpful_votes: r.numberOfHelpful || r.helpfulVoteCount || 0,
      scraped_at: new Date().toISOString(),
    };
  });

  // Insert reviews (no review_id column in schema — use plain insert)
  const res = await fetch(`${SUPABASE_URL}/rest/v1/dovive_reviews`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Save failed: ${res.status} - ${errText.substring(0, 200)}`);
  }
  return rows.length;
}

// ── Test mode for single ASIN ─────────────────────────────────────────────────
async function runTest(asin) {
  console.log(`\n🧪 TEST MODE — Single ASIN: ${asin}`);
  console.log(`   Actor: ${ACT_ID}`);
  console.log(`   Pages per product: ${PAGES_PER_PRODUCT}`);
  console.log(`   All stars mode: ${ALL_STARS_MODE}`);
  console.log(`──────────────────────────────────────`);
  
  try {
    const reviews = await fetchApifyReviews(asin);
    const actualReviews = reviews.filter(r => r.reviewId);
    
    console.log(`\n✅ Total reviews fetched: ${actualReviews.length}`);
    
    if (actualReviews.length === 0) {
      console.log('⚠ No reviews found. Raw response sample:');
      console.log(JSON.stringify(reviews.slice(0, 2), null, 2).substring(0, 1000));
      return reviews;
    }
    
    // Show rating distribution
    const ratingDist = {};
    for (const r of actualReviews) {
      const rating = r.rating || 'unknown';
      ratingDist[rating] = (ratingDist[rating] || 0) + 1;
    }
    console.log(`\n📊 Rating distribution:`);
    for (const [rating, count] of Object.entries(ratingDist).sort()) {
      console.log(`   ${rating}⭐: ${count}`);
    }
    
    // Show verified vs unverified
    const verified = actualReviews.filter(r => r.verifiedPurchase).length;
    console.log(`\n✓ Verified purchases: ${verified}/${actualReviews.length}`);
    
    // Show sample reviews
    console.log(`\n📝 Sample reviews (first 3):`);
    for (const r of actualReviews.slice(0, 3)) {
      console.log(`   ───────────────────────────`);
      console.log(`   Rating: ${r.rating}⭐`);
      console.log(`   Title: ${r.reviewTitle?.substring(0, 60)}`);
      console.log(`   Date: ${r.reviewDate}`);
      console.log(`   Verified: ${r.verifiedPurchase}`);
      console.log(`   Text: ${r.reviewText?.substring(0, 100)}...`);
    }
    
    return reviews;
  } catch (err) {
    console.error(`\n❌ Test failed: ${err.message}`);
    return [];
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // Test mode
  if (testMode) {
    if (!testAsin) {
      console.error('Usage: node apify-reviews.js --test <ASIN>');
      process.exit(1);
    }
    await runTest(testAsin);
    return;
  }

  console.log(`\n📝 Phase 3 — Apify Review Scraper (Enhanced)`);
  console.log(`   Actor: ${ACT_ID}`);
  console.log(KEYWORD_FILTER ? `   Keyword: "${KEYWORD_FILTER}"` : '   Keyword: ALL');
  console.log(`   Pages per product: ${PAGES_PER_PRODUCT}`);
  console.log(`   All stars mode: ${ALL_STARS_MODE}`);
  console.log(`   Sort: ${SORT_BY} | Region: ${REGION}`);

  const allAsins = await getAsins();
  const scrapedAsins = await getScrapedAsins();
  const toScrape = allAsins.filter(r => !scrapedAsins.has(r.asin));

  console.log(`\n✓ Total ASINs in DB: ${allAsins.length}`);
  console.log(`✓ Already scraped: ${scrapedAsins.size}`);
  console.log(`✓ To scrape: ${toScrape.length}\n`);

  if (!toScrape.length) {
    console.log('Nothing new to scrape!');
    return;
  }

  let success = 0, failed = 0, totalReviews = 0;
  let productsSinceLastMigration = 0;

  // Mid-run DASH migration helper
  async function runMidMigration() {
    if (!KEYWORD_FILTER) return;
    try {
      console.log(`\n  🔄 Mid-run DASH sync (every 25 products)...`);
      const { execSync } = require('child_process');
      execSync(`node migrate-reviews-to-dash.js "${KEYWORD_FILTER}"`, { cwd: __dirname, stdio: 'inherit', timeout: 60000 });
    } catch (e) {
      console.warn(`  ⚠ Mid-run migration failed: ${e.message?.slice(0, 100)}`);
    }
  }

  for (let i = 0; i < toScrape.length; i++) {
    const { asin, keyword, title } = toScrape[i];
    console.log(`\n[${i + 1}/${toScrape.length}] ${asin} — ${title?.slice(0, 60)}`);

    // Retry logic — 3 attempts per ASIN
    let reviews = [];
    let gotReviews = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        reviews = await fetchApifyReviews(asin);
        gotReviews = true;
        break;
      } catch (err) {
        if (attempt < 3) {
          console.warn(`  ⚠ Attempt ${attempt} failed: ${err.message?.slice(0,80)} — retrying...`);
          await sleep(8000);
        } else {
          console.error(`  ✗ All 3 attempts failed: ${err.message?.slice(0,100)}`);
        }
      }
    }

    if (gotReviews) {
      const actualReviews = reviews.filter(r => r.reviewId);
      if (actualReviews.length > 0) {
        try {
          const saved = await saveReviews(asin, keyword, actualReviews);
          console.log(`  ✓ ${saved} reviews saved`);
          totalReviews += saved;
          success++;
          productsSinceLastMigration++;
        } catch (saveErr) {
          console.error(`  ✗ Save failed: ${saveErr.message?.slice(0,150)}`);
          failed++;
        }
      } else {
        console.log(`  ⚠ No reviews found`);
        failed++;
      }
    } else {
      failed++;
    }

    // Mid-run DASH migration every 25 products
    if (productsSinceLastMigration >= 25) {
      await runMidMigration();
      productsSinceLastMigration = 0;
    }

    await sleep(3000); // Rate limit between ASINs
  }

  console.log(`\n✅ Done — Products: ${success} success, ${failed} failed | Total reviews: ${totalReviews}`);

  // Update keyword dashboard
  if (KEYWORD_FILTER) {
    await fetch(`${SUPABASE_URL}/rest/v1/dovive_keywords?keyword=eq.${encodeURIComponent(KEYWORD_FILTER)}`, {
      method: 'PATCH',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ last_review_run: new Date().toISOString(), review_success: success, review_failed: failed }),
    });
    console.log(`✓ Dashboard updated for "${KEYWORD_FILTER}"`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
