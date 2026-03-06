/**
 * bsr-v3.js — Phase 1 v3
 * ─────────────────────────────────────────────────────────────
 * Source:   Amazon Best Sellers category pages (not keyword search)
 * Filter:   gummies / powder only (strict — excludes capsules, tablets, softgels)
 * Target:   Top 20 per category after filtering
 * Extracts: title, brand, bullet_points, specifications, images,
 *           format_type, bsr_rank, rating, review_count, price
 * Saves to: dovive_bsr_products (Supabase)
 * ─────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');

chromium.use(stealth());

const fetch = require('node-fetch');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// ─── BSR Categories ────────────────────────────────────────────
// TEST MODE: only 1 category
const BSR_CATEGORIES = [
  {
    name: 'Gummy Vitamins',
    url: 'https://www.amazon.com/Best-Sellers-Health-Personal-Care-Gummy-Vitamins/zgbs/hpc/6973664011?ref_=zg_bs_nav_hpc_0',
    format_hint: 'gummies',
  },
  // Other categories — enable after test passes
  // { name: 'Herbal Supplements', url: '...', format_hint: null },
  // { name: 'Sports Nutrition Powders', url: '...', format_hint: 'powder' },
  // { name: 'Vitamins & Dietary Supplements', url: '...', format_hint: null },
  // { name: 'Mushroom Supplements', url: '...', format_hint: null },
];

const MAX_PER_CATEGORY = 20;

// ─── Format detection (strict — no capsules/tablets/softgels) ──
const GUMMY_TERMS   = ['gummies', 'gummy', 'gummie'];
const POWDER_TERMS  = ['powder', 'powdered'];
const EXCLUDE_TERMS = ['capsule', 'tablet', 'softgel', 'pill', 'liquid', 'drops', 'spray', 'patch'];

function detectFormat(title) {
  const lower = title.toLowerCase();
  if (EXCLUDE_TERMS.some(t => lower.includes(t))) return null; // hard exclude
  if (GUMMY_TERMS.some(t => lower.includes(t)))   return 'gummies';
  if (POWDER_TERMS.some(t => lower.includes(t)))  return 'powder';
  return null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// ─── Supabase ───────────────────────────────────────────────────
async function upsertProducts(products) {
  if (!products.length) return;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/dovive_bsr_products?on_conflict=asin,keyword`,
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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upsert failed: ${res.status} ${text}`);
  }
}

// ─── BSR page scrape: get ranked ASINs + titles ─────────────────
async function scrapeBSRPage(page, url, categoryName) {
  console.log(`\n[BSR] Loading: ${categoryName}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(rand(3000, 5000));

  const title = await page.title();
  console.log(`  [BSR] Page title: ${title}`);
  if (/robot|captcha|sign.in/i.test(title)) {
    console.log(`  [BSR] Blocked on ${categoryName}`);
    return [];
  }

  // Dismiss "deliver to Philippines" or country banner if present
  try {
    const dismissBtn = await page.$('[data-action="a-alert-dismiss"], #nav-global-location-slot button, .glow-toaster-button-dismiss');
    if (dismissBtn) { await dismissBtn.click(); await sleep(1000); }
  } catch (_) {}

  // Set delivery to US zip if prompted
  try {
    const locationBtn = await page.$('#glow-ingress-block, #nav-global-location-slot');
    if (locationBtn) {
      await locationBtn.click();
      await sleep(1500);
      const zipInput = await page.$('#GLUXZipUpdateInput');
      if (zipInput) {
        await zipInput.fill('10001');
        const applyBtn = await page.$('[aria-labelledby="GLUXZipUpdate-announce"]');
        if (applyBtn) { await applyBtn.click(); await sleep(2000); }
      }
    }
  } catch (_) {}

  // Amazon BSR pages have two layouts: zgrid (grid) and zlist (list)
  const items = await page.evaluate(() => {
    const results = [];

    // Try grid layout first
    const gridItems = document.querySelectorAll('.zg-grid-general-faceout');
    if (gridItems.length) {
      gridItems.forEach((el, i) => {
        const asinEl = el.closest('[data-asin]') || el.querySelector('[data-asin]');
        const asin = asinEl ? asinEl.getAttribute('data-asin') : null;
        const titleEl = el.querySelector('.p13n-sc-truncated, ._cDEzb_p13n-sc-css-line-clamp-3_g3dy1, a .a-truncate-cut, a span');
        const title = titleEl ? titleEl.textContent.trim() : '';
        const rankEl = el.querySelector('.zg-bdg-text, .a-color-secondary');
        const rank = i + 1;
        if (asin && title) results.push({ asin, title, rank });
      });
    }

    // Try list layout
    if (!results.length) {
      const listItems = document.querySelectorAll('.zg-item-immersion');
      listItems.forEach((el, i) => {
        const asin = el.getAttribute('data-asin') || (el.closest('[data-asin]') || {}).getAttribute?.('data-asin');
        const titleEl = el.querySelector('.p13n-sc-truncated, a .a-truncate-cut, .a-size-small a, .a-link-normal span');
        const title = titleEl ? titleEl.textContent.trim() : '';
        if (asin && title) results.push({ asin, title, rank: i + 1 });
      });
    }

    // Fallback: any [data-asin] with a title nearby
    if (!results.length) {
      document.querySelectorAll('[data-asin]').forEach((el, i) => {
        const asin = el.getAttribute('data-asin');
        if (!asin) return;
        const titleEl = el.querySelector('a span, .a-size-medium, .a-size-small');
        const title = titleEl ? titleEl.textContent.trim() : '';
        if (asin && title) results.push({ asin, title, rank: i + 1 });
      });
    }

    return results;
  });

  console.log(`  [BSR] Found ${items.length} items on page`);
  return items;
}

// ─── Product detail page scrape ─────────────────────────────────
async function scrapeProduct(context, asin) {
  const page = await context.newPage();
  const data = { asin };

  try {
    await page.goto(`https://www.amazon.com/dp/${asin}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await sleep(rand(2500, 4000));

    const pageTitle = await page.title();
    if (/robot|captcha|sign.in/i.test(pageTitle)) {
      console.log(`    [ASIN ${asin}] Blocked`);
      return null;
    }

    const extracted = await page.evaluate(() => {
      // ── Title ──────────────────────────────────────────────────
      const title = (
        document.querySelector('#productTitle')?.textContent?.trim() ||
        document.querySelector('h1 span')?.textContent?.trim() || ''
      );

      // ── Brand ──────────────────────────────────────────────────
      const brand = (
        document.querySelector('#bylineInfo')?.textContent?.trim()?.replace(/^(Brand:|Visit the|Store)?\s*/i, '').replace(/\s+Store$/, '').trim() ||
        document.querySelector('#brand')?.textContent?.trim() || ''
      );

      // ── Price ──────────────────────────────────────────────────
      const price = (
        document.querySelector('.a-price .a-offscreen')?.textContent?.trim() ||
        document.querySelector('#priceblock_ourprice')?.textContent?.trim() ||
        document.querySelector('#price_inside_buybox')?.textContent?.trim() || ''
      );

      // ── Rating ─────────────────────────────────────────────────
      const ratingText = document.querySelector('#acrPopover')?.getAttribute('title') || '';
      const rating = parseFloat(ratingText) || null;

      // ── Review count ───────────────────────────────────────────
      const reviewText = document.querySelector('#acrCustomerReviewText')?.textContent?.trim() || '';
      const reviewCount = parseInt(reviewText.replace(/[^0-9]/g, '')) || null;

      // ── Bullet points ──────────────────────────────────────────
      const bulletEls = document.querySelectorAll('#feature-bullets li span.a-list-item');
      const bullet_points = Array.from(bulletEls)
        .map(el => el.textContent.trim())
        .filter(t => t && !t.toLowerCase().includes('make sure this fits'));

      // ── Specifications ─────────────────────────────────────────
      const specs = {};

      // From technical details table
      document.querySelectorAll('#productDetails_techSpec_section_1 tr, #productDetails_techSpec_section_2 tr').forEach(row => {
        const key = row.querySelector('th')?.textContent?.trim();
        const val = row.querySelector('td')?.textContent?.trim().replace(/\s+/g, ' ');
        if (key && val) specs[key] = val;
      });

      // From additional information table
      document.querySelectorAll('#productDetails_db_sections tr, #detailBullets_feature_div li').forEach(el => {
        if (el.tagName === 'TR') {
          const key = el.querySelector('th')?.textContent?.trim();
          const val = el.querySelector('td')?.textContent?.trim().replace(/\s+/g, ' ');
          if (key && val) specs[key] = val;
        } else {
          // detail bullet format: "Key : Value"
          const text = el.textContent.trim();
          const colonIdx = text.indexOf(':');
          if (colonIdx > 0) {
            const key = text.slice(0, colonIdx).trim().replace(/\u200F|\u200E/g, '');
            const val = text.slice(colonIdx + 1).trim();
            if (key && val) specs[key] = val;
          }
        }
      });

      // ── Images ─────────────────────────────────────────────────
      const images = [];

      // Try to extract from the colorImages JS data blob
      const scripts = Array.from(document.querySelectorAll('script'));
      for (const script of scripts) {
        const content = script.textContent || '';
        const match = content.match(/'colorImages'\s*:\s*\{[^}]*'initial'\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
        if (match) {
          try {
            const parsed = JSON.parse(match[1]);
            parsed.forEach(img => {
              if (img.hiRes) images.push(img.hiRes);
              else if (img.large) images.push(img.large);
            });
          } catch (_) {}
          if (images.length) break;
        }
      }

      // Fallback: grab visible img tags in image block
      if (!images.length) {
        document.querySelectorAll('#imgTagWrapperId img, #landingImage, #main-image').forEach(img => {
          const src = img.getAttribute('data-old-hires') || img.getAttribute('src') || '';
          if (src && !src.includes('transparent-pixel') && !images.includes(src)) images.push(src);
        });
        // Also grab thumbnails
        document.querySelectorAll('#altImages img').forEach(img => {
          const src = img.getAttribute('src') || '';
          // Convert thumbnail URL to large
          const large = src.replace(/\._[^.]+_\./, '.');
          if (large && !large.includes('transparent-pixel') && !images.includes(large)) images.push(large);
        });
      }

      return { title, brand, price, rating, reviewCount, bullet_points, specifications: specs, images };
    });

    Object.assign(data, extracted);
  } catch (err) {
    console.error(`    [ASIN ${asin}] Error: ${err.message}`);
    return null;
  } finally {
    await page.close();
  }

  return data;
}

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_KEY in .env');
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    geolocation: { latitude: 40.7128, longitude: -74.0060 }, // New York
    permissions: ['geolocation'],
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  // Set US cookies before any navigation
  await context.addCookies([
    { name: 'i18n-prefs',   value: 'USD',   domain: '.amazon.com', path: '/' },
    { name: 'lc-main',      value: 'en_US', domain: '.amazon.com', path: '/' },
    { name: 'sp-cdn',       value: '"L5Z9:PH"', domain: '.amazon.com', path: '/' },
    { name: 'countryCode',  value: 'US',    domain: '.amazon.com', path: '/' },
  ]);

  // Hit amazon.com first and set delivery to US zip 10001
  console.log('Setting US delivery address...');
  const setupPage = await context.newPage();
  await setupPage.goto('https://www.amazon.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3000);
  try {
    // Click "Deliver to" widget
    const locationEl = await setupPage.$('#glow-ingress-block');
    if (locationEl) {
      await locationEl.click();
      await sleep(2000);
      const zipInput = await setupPage.$('#GLUXZipUpdateInput');
      if (zipInput) {
        await zipInput.fill('10001');
        await setupPage.keyboard.press('Enter');
        await sleep(2000);
        const applyBtn = await setupPage.$('[data-action="GLUXPostalUpdateAction"] input[type="submit"], [aria-labelledby="GLUXZipUpdate-announce"]');
        if (applyBtn) { await applyBtn.click(); await sleep(2000); }
      }
    }
  } catch (e) { console.log('Location setup note:', e.message); }
  await setupPage.close();
  console.log('US delivery set. Starting BSR scrape...');

  let totalSaved = 0;

  for (const category of BSR_CATEGORIES) {
    const bsrPage = await context.newPage();

    // Block images/fonts on BSR listing page (speed)
    await bsrPage.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (type === 'image' || type === 'font' || type === 'media') route.abort();
      else route.continue();
    });

    let bsrItems = [];
    try {
      bsrItems = await scrapeBSRPage(bsrPage, category.url, category.name);
    } catch (err) {
      console.error(`  [BSR] Error loading ${category.name}: ${err.message}`);
    } finally {
      await bsrPage.close();
    }

    if (!bsrItems.length) {
      console.log(`  [BSR] No items found for ${category.name}, skipping`);
      continue;
    }

    // Filter to gummies/powder only
    const filtered = [];
    for (const item of bsrItems) {
      const fmt = detectFormat(item.title);
      if (fmt) {
        item.format_type = fmt;
        filtered.push(item);
      }
      if (filtered.length >= MAX_PER_CATEGORY) break;
    }

    console.log(`  [${category.name}] ${bsrItems.length} BSR items → ${filtered.length} match gummies/powder filter`);

    if (!filtered.length) continue;

    // Scrape each product detail page
    const toUpsert = [];
    for (let i = 0; i < filtered.length; i++) {
      const item = filtered[i];
      console.log(`  [${i + 1}/${filtered.length}] ${item.asin} — ${item.title.slice(0, 60)}`);

      const detail = await scrapeProduct(context, item.asin);
      if (!detail) continue;

      toUpsert.push({
        asin:           item.asin,
        keyword:        category.name,          // use category name as keyword
        title:          detail.title || item.title,
        brand:          detail.brand || null,
        description:    null,                   // deprecated — now using bullet_points
        bullet_points:  detail.bullet_points?.length ? detail.bullet_points : null,
        specifications: Object.keys(detail.specifications || {}).length ? detail.specifications : null,
        images:         detail.images?.length ? detail.images : null,
        format_type:    item.format_type,
        bsr_rank:       item.rank,
        rating:         detail.rating || null,
        review_count:   detail.reviewCount || null,
        price:          detail.price || null,
        scraped_at:     new Date().toISOString(),
      });

      await sleep(rand(2000, 3500));
    }

    if (toUpsert.length) {
      try {
        await upsertProducts(toUpsert);
        totalSaved += toUpsert.length;
        console.log(`  ✓ Saved ${toUpsert.length} products for "${category.name}"`);
      } catch (err) {
        console.error(`  ✗ Save failed for ${category.name}: ${err.message}`);
      }
    }

    // Wait between categories
    if (category !== BSR_CATEGORIES[BSR_CATEGORIES.length - 1]) {
      const delay = rand(20000, 30000);
      console.log(`\nWaiting ${(delay / 1000).toFixed(0)}s before next category...`);
      await sleep(delay);
    }
  }

  await browser.close();
  console.log(`\n✅ Done. Total products saved: ${totalSaved}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
