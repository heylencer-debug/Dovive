/**
 * Dovive BSR Scraper — Playwright Stealth
 * Gets top 20 products per keyword sorted by Best Sellers Rank.
 * Visits each product page for full details (brand, bullets, BSR, images).
 * Reviews skipped — handled separately.
 */

require('dotenv').config();
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());

const SUPABASE_URL = 'https://fhfqjcvwcxizbioftvdw.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitter(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
];

// ─── Supabase ─────────────────────────────────────────────────────────────────

async function sbUpsert(table, data, conflict) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflict}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase ${table}: ${res.status} ${txt.slice(0, 200)}`);
  }
}

async function getActiveKeywords() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/dovive_keywords?active=eq.true&select=id,keyword`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  if (!res.ok) throw new Error('Failed to fetch keywords');
  return res.json();
}

// ─── Type parsers ─────────────────────────────────────────────────────────────

const parseRating = r => { const m = String(r||'').match(/(\d+\.?\d*)/); return m ? parseFloat(m[1]) : null; };
const parseCount  = r => { const m = String(r||'').replace(/,/g,'').match(/(\d+)/); return m ? parseInt(m[1]) : null; };
const parsePrice  = p => { const m = String(p||'').replace(/,/g,'').match(/[\d.]+/); return m ? parseFloat(m[0]) : null; };

// ─── Scrape search results (sorted by BSR) ────────────────────────────────────

async function scrapeSearchResults(page, keyword) {
  // sort=exact-aware-popularity-rank = sort by Best Sellers Rank
  const url = `https://www.amazon.com/s?k=${encodeURIComponent(keyword)}&s=exact-aware-popularity-rank`;
  console.log(`  → ${url}`);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(jitter(2500, 4000));

  const title = await page.title();
  if (title.toLowerCase().includes('robot') || title.toLowerCase().includes('captcha') || title.includes('Sign-In')) {
    throw new Error(`Amazon blocked — page: "${title}"`);
  }

  const products = await page.evaluate(() => {
    const items = [];
    const cards = document.querySelectorAll('[data-asin][data-component-type="s-search-result"]');
    for (const card of cards) {
      const asin = card.dataset.asin;
      if (!asin || asin.length < 8) continue;

      const sponsored = card.querySelector('.puis-sponsored-label-text, [aria-label*="Sponsored"], .s-sponsored-label-text');
      if (sponsored) continue;

      const titleEl = card.querySelector('h2 a span, h2 span');
      const priceEl = card.querySelector('.a-price .a-offscreen');
      const ratingEl = card.querySelector('.a-icon-alt');
      const reviewEl = card.querySelector('[aria-label*="stars"] ~ span, .a-size-base.s-underline-text');
      const imageEl  = card.querySelector('img.s-image');
      const brandEl  = card.querySelector('.a-size-base-plus.a-color-base, .s-line-clamp-1 span');

      items.push({
        asin,
        title: titleEl?.textContent?.trim() || null,
        price: priceEl?.textContent?.trim() || null,
        rating: ratingEl?.textContent?.trim() || null,
        review_count: reviewEl?.textContent?.trim() || null,
        main_image: imageEl?.src || null,
        brand: brandEl?.textContent?.trim() || null,
      });

      if (items.length >= 20) break;
    }
    return items;
  });

  return products;
}

// ─── Scrape product detail page ───────────────────────────────────────────────

async function scrapeProductPage(page, asin) {
  try {
    await page.goto(`https://www.amazon.com/dp/${asin}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (navErr) {
    // Retry once on navigation failure
    await sleep(3000);
    await page.goto(`https://www.amazon.com/dp/${asin}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  await sleep(jitter(3000, 5000));

  return page.evaluate(() => {
    // Brand
    const brandEl = document.querySelector('#bylineInfo, .po-brand .a-span9 span');
    const brand = brandEl?.textContent?.trim().replace(/^(Visit the |Brand: )/i, '').replace(/ Store$/, '').trim() || null;

    // Bullets
    const bullets = Array.from(document.querySelectorAll('#feature-bullets li span.a-list-item'))
      .map(el => el.textContent.trim())
      .filter(t => t.length > 10)
      .slice(0, 6);

    // BSR
    let bsr = null;
    const allRows = document.querySelectorAll('#productDetails_detailBullets_sections1 tr, #detailBullets_feature_div li, .prodDetTable tr, #productDetails_db_sections tr');
    for (const row of allRows) {
      if (row.textContent.includes('Best Sellers Rank')) {
        const match = row.textContent.match(/#([\d,]+)/);
        if (match) { bsr = parseInt(match[1].replace(/,/g, '')); break; }
      }
    }

    // Price
    const priceEl = document.querySelector('.a-price .a-offscreen, #priceblock_ourprice, #priceblock_dealprice, .apexPriceToPay .a-offscreen');
    const price = priceEl?.textContent?.trim() || null;

    // Rating
    const ratingEl = document.querySelector('#acrPopover .a-icon-alt, span[data-hook="rating-out-of-text"]');
    const rating = ratingEl?.textContent?.trim() || null;

    // Review count
    const reviewCountEl = document.querySelector('#acrCustomerReviewText');
    const review_count = reviewCountEl?.textContent?.replace(/[^0-9]/g, '') || null;

    // Gallery images
    const images = Array.from(document.querySelectorAll('#altImages li img'))
      .map(img => (img.src || '').replace(/\._[A-Z0-9_,]+_\./g, '._SL1500_.'))
      .filter(src => src.includes('amazon') && !src.includes('play-button') && src.includes('SL1500'))
      .slice(0, 8);

    // Ingredients
    let ingredients = null;
    const bodyText = document.body.innerText;
    const ingMatch = bodyText.match(/Ingredients?:([^\n]{10,400})/i);
    if (ingMatch) ingredients = ingMatch[1].trim().slice(0, 400);

    return { brand, bullet_points: bullets, bsr, price, rating, review_count, images, ingredients };
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function runScrape() {
  const start = Date.now();
  console.log('\n⚔️ Dovive BSR Scraper');
  console.log(`Started: ${new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}\n`);

  if (!SUPABASE_KEY) { console.error('❌ SUPABASE_KEY not set'); process.exit(1); }

  const keywords = await getActiveKeywords();
  console.log(`Keywords: ${keywords.map(k => k.keyword).join(', ')}\n`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled']
  });

  let totalProducts = 0;
  let errors = 0;

  for (let ki = 0; ki < keywords.length; ki++) {
    const { keyword } = keywords[ki];
    console.log(`\n🔍 [${ki+1}/${keywords.length}] "${keyword}"`);

    // Fresh context per keyword — different fingerprint each time
    const context = await browser.newContext({
      userAgent: USER_AGENTS[ki % USER_AGENTS.length],
      viewport: { width: jitter(1280, 1440), height: jitter(700, 800) },
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });
    const page = await context.newPage();
    await page.route('**/*.{woff,woff2,ttf,eot}', r => r.abort());

    try {
      // Step 1: Search results sorted by BSR
      const searchResults = await scrapeSearchResults(page, keyword);
      if (!searchResults.length) { console.log('  ⚠️ No results'); await context.close(); continue; }
      console.log(`  → ${searchResults.length} products found`);

      // Step 2: Visit each product page for details
      for (let i = 0; i < searchResults.length; i++) {
        const product = searchResults[i];
        const rank = i + 1;
        process.stdout.write(`  [${rank}/${searchResults.length}] ${product.asin}: `);

        try {
          const details = await scrapeProductPage(page, product.asin);

          await sbUpsert('dovive_research', {
            keyword,
            asin: product.asin,
            title: product.title,
            brand: details.brand || product.brand,
            price: parsePrice(details.price || product.price),
            bsr: details.bsr,
            rating: parseRating(details.rating || product.rating),
            review_count: parseCount(details.review_count || product.review_count),
            main_image: product.main_image,
            images: details.images || [],
            bullet_points: details.bullet_points || [],
            ingredients: details.ingredients,
            rank_position: rank,
            scraped_at: new Date().toISOString()
          }, 'asin,keyword');

          totalProducts++;
          process.stdout.write(`✅ ${details.brand || '-'} | BSR:${details.bsr || '?'} | ⭐${parseRating(details.rating || product.rating) || '?'}\n`);
          await sleep(jitter(1500, 3000));

        } catch (productErr) {
          process.stdout.write(`❌ ${productErr.message.slice(0, 60)}\n`);
          errors++;
          await sleep(jitter(3000, 5000));
        }
      }

    } catch (keywordErr) {
      console.log(`  ❌ ${keywordErr.message}`);
      errors++;
    }

    await context.close();

    if (ki < keywords.length - 1) {
      const pause = jitter(25000, 40000);
      console.log(`\n  ⏳ Cooling down ${Math.round(pause/1000)}s...`);
      await sleep(pause);
    }
  }

  await browser.close();
  const elapsed = Math.round((Date.now() - start) / 1000);
  console.log(`\n✅ Done in ${elapsed}s — ${totalProducts} products saved, ${errors} errors`);
  return { totalProducts, errors, elapsed };
}

if (require.main === module) {
  runScrape().catch(err => { console.error('Fatal:', err); process.exit(1); });
}

module.exports = { runScrape };
