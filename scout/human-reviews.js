/**
 * human-reviews.js — Phase 3: Review Scraper
 * ─────────────────────────────────────────────
 * 1. Pull all ASINs from dovive_research (filtered by keyword if provided)
 * 2. Visit each product's review page like a human
 * 3. Scrape reviews (rating, title, body, date, verified, helpful votes)
 * 4. Save to dovive_reviews table
 *
 * Usage:
 *   node human-reviews.js                          — all ASINs
 *   node human-reviews.js "ashwagandha gummies"    — specific keyword
 */

require('dotenv').config();
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

const fetch = require('node-fetch');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const AMAZON_EMAIL = process.env.AMAZON_EMAIL;
const AMAZON_PASSWORD = process.env.AMAZON_PASSWORD;

const KEYWORD_FILTER = process.argv[2] || null;
const REVIEWS_PER_PRODUCT = 20; // top 20 reviews per ASIN (2 pages)

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

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

// ── Save reviews to Supabase ──────────────────────────────────────────────────
async function saveReviews(reviews) {
  if (!reviews.length) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/dovive_reviews`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(reviews),
  });
  if (!res.ok) throw new Error(`Save failed: ${res.status} ${await res.text()}`);
}

// ── Scrape reviews from a product review page ─────────────────────────────────
async function scrapeReviews(page, asin, keyword) {
  const reviews = [];
  const reviewUrl = `https://www.amazon.com/product-reviews/${asin}/?sortBy=recent&pageNumber=1`;

  try {
    await page.goto(reviewUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    console.log(`  ⚠ Navigation error, skipping`);
    return [];
  }
  await sleep(rand(2000, 4000));

  // Debug: take screenshot if no reviews found
  const hasReviews = await page.$('[data-hook="review"]');
  if (!hasReviews) {
    // Check for CAPTCHA
    const captcha = await page.$('#captchacharacters, .a-button .a-button-text, img[src*="captcha"]');
    if (captcha) {
      console.log(`  ⚠ CAPTCHA detected! Please solve manually in browser...`);
      console.log(`    Waiting 90 seconds...`);
      await sleep(90000); // Wait for manual CAPTCHA solve
      console.log(`  ✓ Resuming...`);
    } else {
      await page.screenshot({ path: `debug-${asin}.png` });
      const url = page.url();
      const title = await page.title();
      console.log(`  ⚠ Page: ${url} | Title: ${title.substring(0, 60)}`);
    }
  }

  // Handle interstitial
  const continueBtn = await page.$('input[value="Continue shopping"]');
  if (continueBtn) {
    await continueBtn.click();
    await sleep(rand(2000, 3000));
  }

  for (let pageNum = 1; pageNum <= 2; pageNum++) {
    if (pageNum > 1) {
      const nextBtn = await page.$('.a-pagination .a-last:not(.a-disabled) a');
      if (!nextBtn) break;
      await nextBtn.click();
      await sleep(rand(2000, 3500));
    }

    const pageReviews = await page.evaluate(() => {
      const items = document.querySelectorAll('[data-hook="review"]');
      return Array.from(items).map(el => {
        const ratingEl = el.querySelector('[data-hook="review-star-rating"] .a-icon-alt, [data-hook="cmps-review-star-rating"] .a-icon-alt');
        const ratingText = ratingEl?.textContent?.trim() || '';
        const rating = parseFloat(ratingText) || null;

        const title = el.querySelector('[data-hook="review-title"] span:not(.a-icon-alt)')?.textContent?.trim() || null;
        const body = el.querySelector('[data-hook="review-body"] span')?.textContent?.trim() || null;
        const dateText = el.querySelector('[data-hook="review-date"]')?.textContent?.trim() || null;
        const verified = !!el.querySelector('[data-hook="avp-badge"]');
        const helpfulText = el.querySelector('[data-hook="helpful-vote-statement"]')?.textContent?.trim() || null;
        const helpfulVotes = helpfulText ? parseInt(helpfulText.replace(/\D/g, '')) || 0 : 0;
        const reviewer = el.querySelector('.a-profile-name')?.textContent?.trim() || null;

        return { reviewer_name: reviewer, rating, title, body, review_date: dateText, verified_purchase: verified, helpful_votes: helpfulVotes };
      });
    });

    reviews.push(...pageReviews);
    if (reviews.length >= REVIEWS_PER_PRODUCT) break;
  }

  return reviews.slice(0, REVIEWS_PER_PRODUCT).map(r => ({
    ...r,
    asin,
    keyword: keyword || null,
    scraped_at: new Date().toISOString(),
  }));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n📝 Phase 3 — Review Scraper`);
  console.log(KEYWORD_FILTER ? `   Keyword: "${KEYWORD_FILTER}"` : '   Keyword: ALL');

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

  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  // Sign in via Amazon homepage first
  console.log('→ Opening Amazon...');
  await page.goto('https://www.amazon.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(rand(2000, 3000));
  const interstitial = await page.$('input[value="Continue shopping"]');
  if (interstitial) { await interstitial.click(); await sleep(rand(1500, 2500)); }

  // Check if already signed in
  const signInLink = await page.$('#nav-signin-tooltip, a[href*="signin"], #nav-link-accountList');
  if (!signInLink) {
    console.log('  ✓ Already signed in');
  } else {
    console.log('  → Signing in with human-like typing...');
    await page.goto('https://www.amazon.com/ap/signin', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(rand(2000, 4000));

    // Type email like a human (character by character with random delays)
    await page.click('#ap_email');
    await sleep(rand(500, 1000));
    for (const char of AMAZON_EMAIL) {
      await page.keyboard.type(char, { delay: rand(80, 200) });
    }
    await page.click('#continue');
    await sleep(rand(2000, 3500));

    // Type password like a human
    await page.click('#ap_password');
    await sleep(rand(500, 1000));
    for (const char of AMAZON_PASSWORD) {
      await page.keyboard.type(char, { delay: rand(80, 200) });
    }
    await page.click('#auth-signin-button');
    await sleep(rand(3000, 5000));

    console.log('  ✓ Signed in');
  }

  let success = 0, failed = 0;

  for (let i = 0; i < toScrape.length; i++) {
    const { asin, keyword, title } = toScrape[i];
    console.log(`\n[${i + 1}/${toScrape.length}] ${asin} — ${title?.slice(0, 60)}`);

    try {
      const reviews = await scrapeReviews(page, asin, keyword);
      if (reviews.length) {
        await saveReviews(reviews);
        console.log(`  ✓ ${reviews.length} reviews saved`);
        success++;
      } else {
        console.log('  ⚠ No reviews found');
        failed++;
      }
      await sleep(rand(2000, 4000));
    } catch (err) {
      console.error(`  ✗ ${err.message}`);
      failed++;
      await sleep(rand(3000, 5000));
    }
  }

  await browser.close();
  console.log(`\n✅ Done — Success: ${success} | Failed: ${failed}`);

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
