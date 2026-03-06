/*
CREATE TABLE IF NOT EXISTS dovive_bsr_products (
  id bigint generated always as identity primary key,
  asin text not null,
  keyword text not null,
  title text,
  description text,
  scraped_at timestamptz default now(),
  unique(asin, keyword)
);
*/

require('dotenv').config();
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const fetch = require('node-fetch');

chromium.use(stealth());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const FILTER_TERMS = ['gummies', 'gummy', 'powder', 'powdered'];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function matchesFilter(title) {
  const lower = title.toLowerCase();
  return FILTER_TERMS.some(t => lower.includes(t));
}

async function fetchKeywords() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/dovive_keywords?active=eq.true&select=id,keyword`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }
  );
  if (!res.ok) throw new Error(`Failed to fetch keywords: ${res.status} ${await res.text()}`);
  return res.json();
}

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

async function scrapeKeyword(keyword) {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  await context.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (type === 'image' || type === 'font') {
      route.abort();
    } else {
      route.continue();
    }
  });

  const page = await context.newPage();

  let found = 0;
  let kept = 0;
  let saved = 0;

  try {
    const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(keyword)}&s=exact-aware-popularity-rank`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(3500);
    const pageTitle = await page.title();
    console.log(`  [${keyword}] Page: ${pageTitle}`);
    if (/robot|captcha|sign.in/i.test(pageTitle)) {
      console.log(`  [${keyword}] Blocked by Amazon. Skipping.`);
      return;
    }

    const products = await page.evaluate(() => {
      const results = [];
      const cards = document.querySelectorAll('[data-component-type="s-search-result"]');
      for (const card of cards) {
        if (results.length >= 20) break;

        // Skip sponsored
        const sponsoredLabel = card.querySelector('.puis-sponsored-label-text, [aria-label="Sponsored"]');
        if (sponsoredLabel) continue;
        const adBadge = card.querySelector('.s-sponsored-label-info-icon');
        if (adBadge) continue;

        const asin = card.getAttribute('data-asin');
        if (!asin) continue;

        const titleEl =
          card.querySelector('h2 span') ||
          card.querySelector('h2 a span') ||
          card.querySelector('.a-size-medium.a-color-base.a-text-normal');
        const title = titleEl ? titleEl.textContent.trim() : '';

        if (asin) results.push({ asin, title });
      }
      return results;
    });

    found = products.length;
    const filtered = products.filter(p => matchesFilter(p.title));
    kept = filtered.length;

    const toUpsert = [];

    for (const product of filtered) {
      const detailPage = await context.newPage();
      try {
        await detailPage.goto(`https://www.amazon.com/dp/${product.asin}`, {
          waitUntil: 'domcontentloaded',
          timeout: 60000,
        });
        await sleep(3000);

        const description = await detailPage.evaluate(() => {
          const descEl = document.querySelector('#productDescription');
          if (descEl && descEl.innerText.trim()) return descEl.innerText.trim();

          const bullets = document.querySelectorAll('#feature-bullets li span.a-list-item');
          if (bullets.length) {
            return Array.from(bullets)
              .map(b => b.textContent.trim())
              .filter(Boolean)
              .join('\n');
          }
          return '';
        });

        toUpsert.push({
          asin: product.asin,
          keyword,
          title: product.title,
          description,
          scraped_at: new Date().toISOString(),
        });
      } catch (err) {
        console.error(`  [${keyword}] Error scraping ASIN ${product.asin}: ${err.message}`);
      } finally {
        await detailPage.close();
      }
    }

    await upsertProducts(toUpsert);
    saved = toUpsert.length;
  } finally {
    await browser.close();
  }

  console.log(`[${keyword}] Found ${found}, kept ${kept} (gummies/powder filter), saved ${saved}`);
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_KEY in environment');
  }

  const keywords = await fetchKeywords();
  console.log(`Loaded ${keywords.length} active keywords`);

  for (let i = 0; i < keywords.length; i++) {
    const { keyword } = keywords[i];
    try {
      await scrapeKeyword(keyword);
    } catch (err) {
      console.error(`[${keyword}] Fatal error: ${err.message}`);
    }

    if (i < keywords.length - 1) {
      const delay = randomDelay(25000, 35000);
      console.log(`Waiting ${(delay / 1000).toFixed(1)}s before next keyword...`);
      await sleep(delay);
    }
  }

  console.log('Done.');
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
