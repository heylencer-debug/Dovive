/**
 * human-bsr.js — Phase 1 Scraper (v4 — Anti-Detection Enhanced)
 *
 * Improvements over v3:
 *  - Rotates User-Agent from a pool of real Chrome versions
 *  - Persists browser cookies across runs (avoids "new visitor" fingerprint)
 *  - Skips ASINs already in Supabase — resumes from where it left off
 *  - Retries product pages up to 3x on failure
 *  - Detects CAPTCHA/block pages and pauses with human-like delay before retry
 *  - Randomizes viewport size per run
 *  - Adds realistic Accept-Language and extra headers
 *  - Longer, more varied delays between product pages
 */

require('dotenv').config();
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

const fetch = require('node-fetch');
const fs   = require('fs');
const path = require('path');

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_KEY;
const KEYWORD_LABEL = process.argv[2] || 'magnesium gummies';

// ── DASH live sync ────────────────────────────────────────────
const DASH_URL = 'https://jwkitkfufigldpldqtbq.supabase.co';
const DASH_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc';
let _dashCategoryId = null;

async function getDashCategoryId(keyword) {
  if (_dashCategoryId) return _dashCategoryId;
  const res = await fetch(`${DASH_URL}/rest/v1/categories?name=ilike.*${encodeURIComponent(keyword)}*&select=id,name,total_products`, {
    headers: { apikey: DASH_KEY, Authorization: `Bearer ${DASH_KEY}` }
  });
  const cats = await res.json();
  if (!cats.length) {
    // Create category
    const cr = await fetch(`${DASH_URL}/rest/v1/categories`, {
      method: 'POST',
      headers: { apikey: DASH_KEY, Authorization: `Bearer ${DASH_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ name: keyword.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' '), search_term: keyword, total_products: 0 })
    });
    const newCat = await cr.json();
    _dashCategoryId = Array.isArray(newCat) ? newCat[0]?.id : newCat?.id;
  } else {
    // Pick largest
    const sorted = cats.sort((a, b) => (b.total_products || 0) - (a.total_products || 0));
    _dashCategoryId = sorted[0].id;
  }
  return _dashCategoryId;
}

async function syncProductToDash(record) {
  try {
    const categoryId = await getDashCategoryId(record.keyword);
    if (!categoryId) return;
    const featureBullets = Array.isArray(record.bullet_points) ? record.bullet_points : null;
    const featureBulletsText = featureBullets ? featureBullets.join('\n') : null;
    const imageUrls = Array.isArray(record.images) ? record.images : null;
    const dashProduct = {
      asin: record.asin, category_id: categoryId, title: record.title || '',
      brand: record.brand || null, price: record.price || null,
      rating_value: record.rating || null, rating_count: record.review_count || null,
      bsr_current: record.bsr || null, feature_bullets: featureBullets,
      feature_bullets_text: featureBulletsText, specifications: record.specs || null,
      image_urls: imageUrls, main_image_url: record.main_image || null,
      updated_at: new Date().toISOString()
    };
    await fetch(`${DASH_URL}/rest/v1/products?on_conflict=asin,category_id`, {
      method: 'POST',
      headers: { apikey: DASH_KEY, Authorization: `Bearer ${DASH_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([dashProduct])
    });
    // Update category product count
    const { } = await fetch(`${DASH_URL}/rest/v1/rpc/increment_category_count`, { method: 'POST' }).catch(() => {});
  } catch (e) {
    // Non-fatal — don't crash scraper for DASH sync errors
  }
}

// ── Anti-detection config ─────────────────────────────────────
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
];

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
];

const COOKIE_FILE = path.join(__dirname, '.amazon-cookies.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pickRandom(arr) { return arr[rand(0, arr.length - 1)]; }

// ── Human-like scroll ─────────────────────────────────────────
async function humanScroll(page) {
  const scrolls = rand(2, 5);
  for (let i = 0; i < scrolls; i++) {
    await page.mouse.move(rand(300, 900), rand(200, 600));
    await page.evaluate((px) => window.scrollBy(0, px), rand(200, 500));
    await sleep(rand(300, 700));
  }
}

// ── Check if page is blocked / CAPTCHA ───────────────────────
async function isBlocked(page) {
  const title = (await page.title()).toLowerCase();
  const url   = page.url().toLowerCase();
  if (title.includes('robot') || title.includes('captcha') || title.includes('sorry')) return true;
  if (url.includes('captcha') || url.includes('validatecaptcha')) return true;
  const captchaEl = await page.$('form[action*="captcha"], #captchacharacters');
  return !!captchaEl;
}

// ── Cookie persistence ────────────────────────────────────────
async function loadCookies(context) {
  try {
    if (fs.existsSync(COOKIE_FILE)) {
      const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
      await context.addCookies(cookies);
      console.log(`  ✓ Loaded ${cookies.length} saved cookies`);
    }
  } catch (_) {}
}

async function saveCookies(context) {
  try {
    const cookies = await context.cookies('https://www.amazon.com');
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
  } catch (_) {}
}

// ── Keyword registration ──────────────────────────────────────
async function ensureKeyword(keyword) {
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/dovive_keywords?keyword=eq.${encodeURIComponent(keyword)}`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const existing = await checkRes.json();
  if (existing.length > 0) {
    if (!existing[0].active) {
      await fetch(`${SUPABASE_URL}/rest/v1/dovive_keywords?keyword=eq.${encodeURIComponent(keyword)}`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: true })
      });
      console.log(`  ✓ Keyword "${keyword}" re-activated`);
    } else {
      console.log(`  ✓ Keyword "${keyword}" already active`);
    }
  } else {
    await fetch(`${SUPABASE_URL}/rest/v1/dovive_keywords`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword, active: true })
    });
    console.log(`  ✓ Keyword "${keyword}" created`);
  }
}

// ── Get already-scraped ASINs for this keyword ────────────────
async function getAlreadyScraped(keyword) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/dovive_research?keyword=eq.${encodeURIComponent(keyword)}&select=asin`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const rows = await res.json();
  return new Set(rows.map(r => r.asin));
}

// ── Upsert to Supabase ────────────────────────────────────────
async function upsertProducts(products) {
  if (!products.length) return;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/dovive_research?on_conflict=asin,keyword`,
    {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(products),
    }
  );
  if (!res.ok) throw new Error(`Upsert failed: ${res.status} ${await res.text()}`);

  const historyRows = products.map(p => ({
    asin: p.asin, keyword: p.keyword, title: p.title, brand: p.brand,
    price: p.price, bsr: p.bsr, rating: p.rating, review_count: p.review_count,
    rank_position: p.rank_position, is_sponsored: p.is_sponsored,
    category: p.category, source: p.source, scraped_at: new Date().toISOString(),
  }));
  const res2 = await fetch(`${SUPABASE_URL}/rest/v1/dovive_history`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify(historyRows),
  });
  if (!res2.ok) console.warn(`History insert warning: ${res2.status}`);
}

// ── Scrape a product detail page with retry ───────────────────
async function scrapeProductDetail(context, asin, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const page = await context.newPage();
    try {
      await page.goto(`https://www.amazon.com/dp/${asin}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      await sleep(rand(1500, 3000));

      // Check for block/CAPTCHA
      if (await isBlocked(page)) {
        console.log(`  ⚠ Blocked on attempt ${attempt}. Waiting ${attempt * 15}s...`);
        await page.close();
        await sleep(attempt * 15000 + rand(3000, 8000));
        continue;
      }

      await humanScroll(page);

      const data = await page.evaluate(() => {
        const title = document.querySelector('#productTitle')?.textContent?.trim() || '';
        let brand = document.querySelector('#bylineInfo')?.textContent?.trim() || '';
        brand = brand.replace(/^(Brand:|Visit the)\s*/i, '').replace(/\s+Store$/i, '').trim();
        const price =
          document.querySelector('.a-price .a-offscreen')?.textContent?.trim() ||
          document.querySelector('#priceblock_ourprice')?.textContent?.trim() || '';
        const ratingText = document.querySelector('#acrPopover')?.getAttribute('title') || '';
        const rating = parseFloat(ratingText) || null;
        const reviewText = document.querySelector('#acrCustomerReviewText')?.textContent?.trim() || '';
        const reviewCount = parseInt(reviewText.replace(/[^0-9]/g, '')) || null;
        const bullet_points = Array.from(
          document.querySelectorAll('#feature-bullets li span.a-list-item')
        ).map(el => el.textContent.trim()).filter(t => t && !/make sure this fits/i.test(t));
        const specifications = {};
        document.querySelectorAll(
          '#productDetails_techSpec_section_1 tr, #productDetails_techSpec_section_2 tr, #productDetails_db_sections tr'
        ).forEach(row => {
          const key = row.querySelector('th')?.textContent?.trim();
          const val = row.querySelector('td')?.textContent?.trim().replace(/\s+/g, ' ');
          if (key && val) specifications[key] = val;
        });
        document.querySelectorAll('#detailBullets_feature_div li').forEach(el => {
          const bold = el.querySelector('.a-text-bold');
          if (bold) {
            const key = bold.textContent.replace(/[:\u200F\u200E]/g, '').trim();
            const val = bold.nextSibling?.textContent?.trim() || '';
            if (key && val) specifications[key] = val;
          }
        });
        const images = [];
        for (const script of document.querySelectorAll('script')) {
          const c = script.textContent || '';
          const m = c.match(/'colorImages'\s*:\s*\{\s*'initial'\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
          if (m) {
            try {
              JSON.parse(m[1]).forEach(img => {
                const src = img.hiRes || img.large;
                if (src && !images.includes(src)) images.push(src);
              });
            } catch (_) {}
            if (images.length) break;
          }
        }
        if (!images.length) {
          const main = document.querySelector('#landingImage, #imgTagWrapperId img');
          const src = main?.getAttribute('data-old-hires') || main?.getAttribute('src') || '';
          if (src && !src.includes('transparent')) images.push(src);
          document.querySelectorAll('#altImages img').forEach(img => {
            const s = (img.getAttribute('src') || '').replace(/\._[A-Z0-9_,]+_\./, '.');
            if (s && !s.includes('transparent') && !images.includes(s)) images.push(s);
          });
        }
        return { title, brand, price, rating, reviewCount, bullet_points, specifications, images };
      });

      await page.close();
      return data;

    } catch (err) {
      console.error(`  [${asin}] Attempt ${attempt} error: ${err.message?.slice(0, 80)}`);
      try { await page.close(); } catch (_) {}
      if (attempt < retries) await sleep(rand(5000, 10000));
    }
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  const userAgent = pickRandom(USER_AGENTS);
  const viewport  = pickRandom(VIEWPORTS);

  console.log(`\n📦 Phase 1 — human-bsr.js v4`);
  console.log(`   Keyword: "${KEYWORD_LABEL}"`);
  console.log(`   UA: ${userAgent.slice(0, 60)}...`);
  console.log(`   Viewport: ${viewport.width}x${viewport.height}`);

  const browser = await chromium.launch({ headless: process.platform !== 'win32' });
  const context = await browser.newContext({
    userAgent,
    viewport,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    },
  });

  // Load saved cookies (return visitor fingerprint)
  await loadCookies(context);

  const page = await context.newPage();

  // ── Step 0: Register keyword ─────────────────────────────────
  console.log(`\n→ Registering keyword "${KEYWORD_LABEL}" in dashboard...`);
  await ensureKeyword(KEYWORD_LABEL);

  // ── Step 0b: Get already-scraped ASINs (resume support) ──────
  const alreadyScraped = await getAlreadyScraped(KEYWORD_LABEL);
  console.log(`  ✓ Already scraped: ${alreadyScraped.size} products (will skip these)`);

  // ── Step 1: Amazon homepage ───────────────────────────────────
  console.log('→ Opening Amazon homepage...');
  await page.goto('https://www.amazon.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(rand(3000, 6000));
  await saveCookies(context);

  // Handle interstitial
  const continueBtn = await page.$('input[value="Continue shopping"], a:has-text("Continue shopping")');
  if (continueBtn) {
    console.log('  → Interstitial detected. Clicking "Continue shopping"...');
    await continueBtn.click();
    await sleep(rand(4000, 7000));
  }

  await humanScroll(page);
  await sleep(rand(1500, 3000));
  console.log('  Homepage loaded:', await page.title());

  // Find search box
  const searchSelectors = ['#twotabsearchtextbox', '#nav-search-bar-form input[type="text"]', 'input[name="field-keywords"]'];
  let searchBox = null;
  for (const sel of searchSelectors) {
    searchBox = await page.$(sel);
    if (searchBox) { console.log('  Found search box via:', sel); break; }
  }
  if (!searchBox) throw new Error('Search box not found');

  // ── Step 2: Search ────────────────────────────────────────────
  console.log(`\n→ Searching for "${KEYWORD_LABEL}"...`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(rand(500, 1000));
  await searchBox.scrollIntoViewIfNeeded();
  await sleep(rand(500, 800));
  await page.fill('#twotabsearchtextbox', '');
  await page.type('#twotabsearchtextbox', KEYWORD_LABEL, { delay: rand(60, 130) });
  await sleep(rand(700, 1200));
  await page.keyboard.press('Enter');
  await sleep(rand(4000, 6000));
  await saveCookies(context);

  console.log('  Search results:', await page.title());

  // ── Step 3: Collect ASINs across pages ───────────────────────
  const allGummies = [];

  for (let pageNum = 1; pageNum <= 3; pageNum++) {
    console.log(`\n→ Scanning page ${pageNum}...`);
    await humanScroll(page);

    const pageItems = await page.evaluate((pNum) => {
      const results = [];
      const cards = document.querySelectorAll('[data-component-type="s-search-result"]');
      cards.forEach((card, i) => {
        if (card.querySelector('.puis-sponsored-label-text, [aria-label="Sponsored"]')) return;
        const asin = card.getAttribute('data-asin');
        if (!asin) return;
        const titleEl = card.querySelector('h2 span, h2 a span');
        const title = titleEl?.textContent?.trim() || '';
        if (/gumm/i.test(title)) {
          results.push({ asin, title, rank: (pNum - 1) * 48 + i + 1 });
        }
      });
      return results;
    }, pageNum);

    console.log(`  Found ${pageItems.length} gummies on page ${pageNum}`);
    pageItems.forEach(p => console.log(`    [${p.asin}] ${p.title.slice(0, 70)}`));
    allGummies.push(...pageItems);

    if (pageNum < 3) {
      // Scroll to bottom first to reveal the Next button
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(rand(1500, 2500));

      const nextBtn = await page.$('.s-pagination-next:not(.s-pagination-disabled)');
      if (!nextBtn) { console.log('  No more pages.'); break; }

      // Scroll Next button into view and click it naturally
      await nextBtn.scrollIntoViewIfNeeded();
      await sleep(rand(800, 1500));
      await nextBtn.click();

      // Wait for new page to fully load
      await page.waitForLoadState('domcontentloaded');
      await sleep(rand(5000, 8000));

      // Verify we actually got a new results page
      const newTitle = await page.title();
      const newCards = await page.evaluate(() =>
        document.querySelectorAll('[data-component-type="s-search-result"]').length
      );
      console.log(`  → Page ${pageNum + 1} loaded: "${newTitle}" | ${newCards} cards`);

      if (newCards === 0) {
        console.log('  → No results on next page — stopping pagination.');
        break;
      }
    }
  }

  // Deduplicate
  const seenAsins = new Set();
  const uniqueGummies = allGummies.filter(p => {
    if (seenAsins.has(p.asin)) return false;
    seenAsins.add(p.asin); return true;
  });

  // Filter out already-scraped
  const toScrape = uniqueGummies.filter(p => !alreadyScraped.has(p.asin));
  const skipped  = uniqueGummies.length - toScrape.length;

  console.log(`\nTotal gummies: ${uniqueGummies.length} unique | ${skipped} already in DB | ${toScrape.length} to scrape`);

  if (!toScrape.length) {
    console.log('✅ All products already scraped. Nothing to do.');
    await browser.close();
    return;
  }

  // ── Step 4: Scrape each product detail page ───────────────────
  let saved = 0;
  for (let i = 0; i < toScrape.length; i++) {
    const item = toScrape[i];
    console.log(`\n[${i + 1}/${toScrape.length}] ${item.asin} — ${item.title.slice(0, 60)}`);

    const detail = await scrapeProductDetail(context, item.asin);
    if (!detail) { console.log('  → Skipped (failed after retries)'); continue; }

    const priceNum  = parseFloat((detail.price || '').replace(/[^0-9.]/g, '')) || null;
    const mainImage = detail.images?.[0] || null;

    const record = {
      asin:          item.asin,
      keyword:       KEYWORD_LABEL,
      title:         detail.title || item.title,
      brand:         detail.brand || null,
      description:   null,
      bullet_points: detail.bullet_points?.length ? detail.bullet_points : null,
      specs:         Object.keys(detail.specifications || {}).length ? detail.specifications : null,
      images:        detail.images?.length ? detail.images : null,
      main_image:    mainImage,
      bsr:           item.rank,
      rank_position: item.rank,
      rating:        detail.rating || null,
      review_count:  detail.reviewCount || null,
      price:         priceNum,
      source:        'human-bsr-v4',
      scraped_at:    new Date().toISOString(),
    };

    console.log(`  ✓ ${record.title?.slice(0, 55)}`);
    console.log(`    Brand: ${record.brand} | Price: ${record.price} | ⭐ ${record.rating} (${record.review_count})`);
    console.log(`    Bullets: ${record.bullet_points?.length || 0} | Specs: ${Object.keys(detail.specifications || {}).length} | Images: ${record.images?.length || 0}`);

    try {
      await upsertProducts([record]);
      await syncProductToDash(record); // live sync to DASH dashboard
      console.log(`  → Saved ✓`);
      saved++;
    } catch (err) {
      console.error(`  → Save failed: ${err.message}`);
    }

    // Save cookies periodically
    if (i % 10 === 0) await saveCookies(context);

    // Longer, randomized delay between products (key anti-detection measure)
    const delay = rand(3000, 6000);
    await sleep(delay);
  }

  await saveCookies(context);
  console.log(`\n✅ Done. ${saved}/${toScrape.length} new products saved. (${skipped} skipped — already in DB)`);
  await browser.close();
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
