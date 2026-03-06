/**
 * test-v3.js — Single keyword test
 * Keyword search → filter → full detail extraction
 * Fields: title, brand, bullet_points, specifications, images,
 *         format_type, rating, review_count, price
 */

require('dotenv').config();
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

const fetch = require('node-fetch');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const TEST_KEYWORD = 'magnesium gummies';
const MAX_PRODUCTS = 20;

const GUMMY_TERMS  = ['gummies', 'gummy', 'gummie'];
const POWDER_TERMS = ['powder', 'powdered'];
const EXCLUDE_TERMS = ['capsule', 'tablet', 'softgel', 'pill', 'liquid', 'drops', 'spray', 'patch'];

function detectFormat(title) {
  const lower = title.toLowerCase();
  if (EXCLUDE_TERMS.some(t => lower.includes(t))) return null;
  if (GUMMY_TERMS.some(t => lower.includes(t)))   return 'gummies';
  if (POWDER_TERMS.some(t => lower.includes(t)))  return 'powder';
  return null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

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
  if (!res.ok) throw new Error(`Upsert failed: ${res.status} ${await res.text()}`);
}

async function scrapeSearchPage(page, keyword) {
  const url = `https://www.amazon.com/s?k=${encodeURIComponent(keyword)}`;
  console.log(`Searching: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(rand(3000, 5000));

  const title = await page.title();
  console.log('Page title:', title);
  if (/robot|captcha|sign.in|something went wrong/i.test(title)) {
    await page.screenshot({ path: 'debug-block.png' });
    console.log('Blocked! Screenshot saved to debug-block.png');
    return [];
  }

  const items = await page.evaluate(() => {
    const results = [];
    const cards = document.querySelectorAll('[data-component-type="s-search-result"]');
    for (const card of cards) {
      if (results.length >= 30) break;
      // Skip sponsored
      if (card.querySelector('.puis-sponsored-label-text, [aria-label="Sponsored"], .s-sponsored-label-info-icon')) continue;
      const asin = card.getAttribute('data-asin');
      if (!asin) continue;
      const titleEl = card.querySelector('h2 span, h2 a span');
      const title = titleEl ? titleEl.textContent.trim() : '';
      if (asin && title) results.push({ asin, title });
    }
    return results;
  });

  console.log(`Found ${items.length} search results`);
  return items;
}

async function scrapeProductDetail(context, asin) {
  const page = await context.newPage();

  // Allow images on detail pages (we need them)
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (type === 'font' || type === 'media') route.abort();
    else route.continue();
  });

  try {
    await page.goto(`https://www.amazon.com/dp/${asin}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(rand(2500, 4000));

    const blocked = await page.title();
    if (/robot|captcha|sign.in/i.test(blocked)) {
      console.log(`  [${asin}] Blocked`);
      return null;
    }

    const data = await page.evaluate(() => {
      // Title
      const title = document.querySelector('#productTitle')?.textContent?.trim() || '';

      // Brand
      let brand = document.querySelector('#bylineInfo')?.textContent?.trim() || '';
      brand = brand.replace(/^(Brand:|Visit the)\s*/i, '').replace(/\s+Store$/i, '').trim();

      // Price
      const price =
        document.querySelector('.a-price .a-offscreen')?.textContent?.trim() ||
        document.querySelector('#priceblock_ourprice')?.textContent?.trim() || '';

      // Rating
      const ratingText = document.querySelector('#acrPopover')?.getAttribute('title') || '';
      const rating = parseFloat(ratingText) || null;

      // Review count
      const reviewText = document.querySelector('#acrCustomerReviewText')?.textContent?.trim() || '';
      const reviewCount = parseInt(reviewText.replace(/[^0-9]/g, '')) || null;

      // Bullet points (as array)
      const bullet_points = Array.from(
        document.querySelectorAll('#feature-bullets li span.a-list-item')
      )
        .map(el => el.textContent.trim())
        .filter(t => t && !t.toLowerCase().includes('make sure this fits'));

      // Specifications (as object)
      const specifications = {};
      document.querySelectorAll(
        '#productDetails_techSpec_section_1 tr, #productDetails_techSpec_section_2 tr, #productDetails_db_sections tr'
      ).forEach(row => {
        const key = row.querySelector('th')?.textContent?.trim();
        const val = row.querySelector('td')?.textContent?.trim().replace(/\s+/g, ' ');
        if (key && val) specifications[key] = val;
      });
      // Detail bullets format
      document.querySelectorAll('#detailBullets_feature_div li span.a-list-item').forEach(el => {
        const parts = el.innerHTML.split('<span class="a-text-bold">');
        if (parts.length >= 2) {
          const key = parts[1].split('</span>')[0].replace(/[:\u200F\u200E]/g, '').trim();
          const val = parts[1].split('</span>')[1]?.replace(/<[^>]+>/g, '').trim();
          if (key && val) specifications[key] = val;
        }
      });

      // Images — try colorImages JS blob first
      const images = [];
      for (const script of document.querySelectorAll('script')) {
        const content = script.textContent || '';
        const match = content.match(/'colorImages'\s*:\s*\{\s*'initial'\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
        if (match) {
          try {
            JSON.parse(match[1]).forEach(img => {
              const src = img.hiRes || img.large;
              if (src && !images.includes(src)) images.push(src);
            });
          } catch (_) {}
          if (images.length) break;
        }
      }
      // Fallback: main image + thumbnails
      if (!images.length) {
        const main = document.querySelector('#landingImage, #imgTagWrapperId img');
        const mainSrc = main?.getAttribute('data-old-hires') || main?.getAttribute('src') || '';
        if (mainSrc && !mainSrc.includes('transparent')) images.push(mainSrc);

        document.querySelectorAll('#altImages img').forEach(img => {
          const src = (img.getAttribute('src') || '').replace(/\._[A-Z0-9_,]+_\./, '.');
          if (src && !src.includes('transparent') && !images.includes(src)) images.push(src);
        });
      }

      return { title, brand, price, rating, reviewCount, bullet_points, specifications, images };
    });

    return data;
  } catch (err) {
    console.error(`  [${asin}] Error: ${err.message}`);
    return null;
  } finally {
    await page.close();
  }
}

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
  });

  // Block images/fonts on search page
  const searchPage = await context.newPage();
  await searchPage.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (type === 'image' || type === 'font' || type === 'media') route.abort();
    else route.continue();
  });

  // Warm up — visit homepage first
  console.log('Warming up on amazon.com...');
  await searchPage.goto('https://www.amazon.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(rand(3000, 5000));

  const searchResults = await scrapeSearchPage(searchPage, TEST_KEYWORD);
  await searchPage.close();

  // Filter to gummies/powder only
  const filtered = [];
  for (const item of searchResults) {
    const fmt = detectFormat(item.title);
    if (fmt) { item.format_type = fmt; filtered.push(item); }
    if (filtered.length >= MAX_PRODUCTS) break;
  }
  console.log(`\nFiltered: ${filtered.length} gummies/powder products`);
  filtered.forEach((p, i) => console.log(`  ${i+1}. [${p.format_type}] ${p.title.slice(0, 70)}`));

  // Scrape detail pages
  const toSave = [];
  for (let i = 0; i < filtered.length; i++) {
    const item = filtered[i];
    console.log(`\n[${i+1}/${filtered.length}] Scraping ${item.asin}...`);
    const detail = await scrapeProductDetail(context, item.asin);
    if (!detail) continue;

    const record = {
      asin:           item.asin,
      keyword:        TEST_KEYWORD,
      title:          detail.title || item.title,
      brand:          detail.brand || null,
      description:    null,
      bullet_points:  detail.bullet_points?.length ? detail.bullet_points : null,
      specifications: Object.keys(detail.specifications || {}).length ? detail.specifications : null,
      images:         detail.images?.length ? detail.images : null,
      format_type:    item.format_type,
      rating:         detail.rating || null,
      review_count:   detail.reviewCount || null,
      price:          detail.price || null,
      scraped_at:     new Date().toISOString(),
    };

    console.log(`  Title:   ${record.title?.slice(0, 60)}`);
    console.log(`  Brand:   ${record.brand}`);
    console.log(`  Price:   ${record.price}`);
    console.log(`  Rating:  ${record.rating} (${record.review_count} reviews)`);
    console.log(`  Bullets: ${record.bullet_points?.length || 0}`);
    console.log(`  Specs:   ${Object.keys(detail.specifications || {}).length} fields`);
    console.log(`  Images:  ${record.images?.length || 0}`);

    toSave.push(record);
    await sleep(rand(2000, 3500));
  }

  // Save to Supabase
  if (toSave.length) {
    await upsertProducts(toSave);
    console.log(`\n✅ Saved ${toSave.length} products to Supabase`);
  }

  await browser.close();
  console.log('Done.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
