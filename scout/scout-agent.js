/**
 * Dovive Scout Agent V2.9
 * Amazon Market Research Scraper + AI Analysis + Telegram Reports
 *
 * Features:
 * - Keyword search scraping (V2.9: simplified - just keyword, no product type suffix)
 * - Deep scrape top 5 non-sponsored products per keyword (scrapeProductPage called for each)
 * - Product type categorization (auto-detected from title)
 * - Full review scraping (up to 50 per product)
 * - Deep ASIN data (images, specs, features, ingredients, certifications)
 * - Progress tracking
 * - Gummies & Powder specialized extraction (sweetener, base, flavors)
 * - Price per serving calculation
 * - Review sentiment auto-tagging
 * - Full image scraping: main, gallery, A+ content (for OCR pipeline)
 * - V2.9: Fixed keyword fetch (is_active), reports upsert (on_conflict=keyword),
 *         price validation (1-300), and deep scrape now runs for every keyword
 *
 * Run with: node start.js (keeps running and polling)
 * Or once: node scout-agent.js --once
 */

require('dotenv').config();
const path = require('path');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());
const fetch = require('node-fetch');

// ============================================================
// PRODUCT TYPE CONFIGURATION
// ============================================================
// Priority types get more thorough scraping
const PRIORITY_TYPES = ['gummies', 'gummy', 'powder'];

// All product types
const ALL_PRODUCT_TYPES = [
  'capsule',
  'capsules',
  'tablet',
  'tablets',
  'softgel',
  'softgels',
  'gummies',
  'gummy',
  'powder',
  'liquid',
  'drops',
  'tincture',
  'spray',
  'patch',
  'tea',
  'drink mix',
  'stick pack',
  'lozenge',
  'chewable',
  'liposomal'
];

// Standard types (non-priority)
const STANDARD_TYPES = ALL_PRODUCT_TYPES.filter(t => !PRIORITY_TYPES.includes(t));

// Ordered types: priority first, then standard
const PRODUCT_TYPES = [...PRIORITY_TYPES, ...STANDARD_TYPES];

// Detect product type from title
function detectProductType(title) {
  const t = title.toLowerCase();
  if (t.includes('gummies') || t.includes('gummy')) return 'Gummies';
  if (t.includes('powder')) return 'Powder';
  if (t.includes('liquid') || t.includes('drops') || t.includes('tincture')) return 'Liquid/Drops';
  if (t.includes('softgel')) return 'Softgel';
  if (t.includes('tablet') || t.includes('tablets')) return 'Tablet';
  if (t.includes('spray')) return 'Spray';
  if (t.includes('patch')) return 'Patch';
  if (t.includes('tea')) return 'Tea';
  if (t.includes('drink mix') || t.includes('stick pack')) return 'Drink Mix';
  if (t.includes('lozenge') || t.includes('chewable')) return 'Lozenge';
  if (t.includes('liposomal')) return 'Liposomal';
  if (t.includes('capsule') || t.includes('caps')) return 'Capsule';
  return 'Other';
}

// ============================================================
// CONFIGURATION
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const OPENCLAW_GATEWAY = process.env.OPENCLAW_GATEWAY;
const OPENCLAW_TOKEN = process.env.OPENCLAW_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const POLL_INTERVAL = 60000; // 60 seconds
const SCRAPE_DELAY_MIN = 3000;
const SCRAPE_DELAY_MAX = 6000;
const PRODUCT_PAGE_DELAY_MIN = 4000;
const PRODUCT_PAGE_DELAY_MAX = 7000;

// Scraping limits - different for priority vs standard types
const PRIORITY_LIMITS = {
  maxProductsPerSearch: 50,
  maxDeepScrapePerType: 30,
  maxReviewsPerProduct: 200
};

const STANDARD_LIMITS = {
  maxProductsPerSearch: 20,
  maxDeepScrapePerType: 10,
  maxReviewsPerProduct: 50
};

const TOP_N_FOR_AI_SUMMARY = 10;

// ============================================================
// SCOUT CONFIG (loaded from Supabase at startup)
// ============================================================
let scoutConfig = {
  best_sellers_categories: [],
  product_types_active: ['gummies', 'gummy', 'powder'],
  max_products_per_type: 50,
  max_reviews_per_product: 200,
  deep_scrape_top_n: 30,
  scrape_mode: 'best_sellers_first'  // 'best_sellers_first' | 'keyword_only' | 'best_sellers_only'
};

/**
 * Fetch Scout configuration from dovive_scout_config table
 */
async function fetchScoutConfig() {
  try {
    const rows = await sbFetch('dovive_scout_config', {
      select: 'config_key,config_value'
    });

    if (rows && rows.length > 0) {
      rows.forEach(r => {
        try {
          // Parse JSON values
          if (r.config_value && (r.config_value.startsWith('[') || r.config_value.startsWith('{'))) {
            scoutConfig[r.config_key] = JSON.parse(r.config_value);
          } else if (r.config_value && !isNaN(r.config_value)) {
            scoutConfig[r.config_key] = parseInt(r.config_value);
          } else {
            scoutConfig[r.config_key] = r.config_value;
          }
        } catch (e) {
          scoutConfig[r.config_key] = r.config_value;
        }
      });
      log(`Loaded ${rows.length} config values from Supabase`, 'success');
    } else {
      log('No scout config found in Supabase, using defaults', 'warn');
    }

    return scoutConfig;
  } catch (err) {
    log(`Failed to fetch scout config: ${err.message}`, 'error');
    return scoutConfig;
  }
}

// ============================================================
// FORMAT-SPECIFIC EXTRACTORS
// ============================================================

// FLAVOR EXTRACTOR
function extractFlavors(text) {
  const flavors = [];
  const flavorList = [
    'strawberry', 'raspberry', 'cherry', 'blueberry', 'mixed berry', 'berry',
    'watermelon', 'grape', 'orange', 'lemon', 'lime', 'peach', 'mango',
    'pineapple', 'tropical', 'apple', 'coconut', 'vanilla', 'chocolate',
    'caramel', 'unflavored', 'natural flavor'
  ];
  flavorList.forEach(f => {
    if (text.includes(f)) flavors.push(f);
  });
  return [...new Set(flavors)];
}

// SERVING COUNT EXTRACTOR (for gummies: "2 gummies per serving" → 2)
function extractServingCount(text) {
  const match = text.match(/(\d+)\s*gumm/);
  return match ? parseInt(match[1]) : null;
}

// SERVING GRAMS EXTRACTOR (for powder: "5g per serving" → 5)
function extractServingGrams(text) {
  const match = text.match(/(\d+(?:\.\d+)?)\s*g(?:rams?)?\s*per\s*serving/) ||
                text.match(/serving size[:\s]+(\d+(?:\.\d+)?)\s*g/);
  return match ? parseFloat(match[1]) : null;
}

// GUMMIES EXTRACTOR
function extractGummiesData(title, bulletPoints, specsText, ingredientsText) {
  const all = (title + ' ' + bulletPoints.join(' ') + ' ' + specsText + ' ' + ingredientsText).toLowerCase();
  return {
    base_type: all.includes('pectin') ? 'Pectin (Vegan)' : all.includes('gelatin') ? 'Gelatin' : 'Unknown',
    is_sugar_free: all.includes('sugar-free') || all.includes('sugar free') || all.includes('no sugar') || all.includes('0g sugar'),
    sweetener: all.includes('stevia') ? 'Stevia' :
               all.includes('monk fruit') ? 'Monk Fruit' :
               all.includes('sucralose') ? 'Sucralose' :
               all.includes('erythritol') ? 'Erythritol' :
               all.includes('xylitol') ? 'Xylitol' : 'Sugar',
    has_coating: all.includes('sugar coated') || all.includes('sugar-coated') || all.includes('coated'),
    flavors_mentioned: extractFlavors(all),
    serving_per_gummy: extractServingCount(all)
  };
}

// POWDER EXTRACTOR
function extractPowderData(title, bulletPoints, specsText, ingredientsText) {
  const all = (title + ' ' + bulletPoints.join(' ') + ' ' + specsText + ' ' + ingredientsText).toLowerCase();
  return {
    is_unflavored: all.includes('unflavored') || all.includes('flavorless') || all.includes('no flavor'),
    sweetener: all.includes('stevia') ? 'Stevia' :
               all.includes('monk fruit') ? 'Monk Fruit' :
               all.includes('sucralose') ? 'Sucralose' :
               all.includes('unsweetened') ? 'Unsweetened' :
               all.includes('sugar') ? 'Sugar' : 'Unknown',
    packaging_type: all.includes('stick pack') || all.includes('single serve') ? 'Stick Pack' :
                    all.includes('pouch') ? 'Pouch' :
                    all.includes('canister') ? 'Canister' : 'Tub',
    is_instant: all.includes('instant') || all.includes('dissolves instantly') || all.includes('instantly dissolves'),
    flavors_mentioned: extractFlavors(all),
    serving_size_grams: extractServingGrams(all)
  };
}

// PRICE PER SERVING CALCULATOR
function calcPricePerServing(price, specsText, bulletPoints) {
  const all = (specsText + ' ' + bulletPoints.join(' ')).toLowerCase();
  // Look for "X servings" or "X count" or "X capsules"
  const servingsMatch = all.match(/(\d+)\s*(?:servings?|count|ct\b|capsules?|tablets?|softgels?|gummies|pieces?)/);
  if (servingsMatch && price) {
    const servings = parseInt(servingsMatch[1]);
    if (servings > 0 && servings < 1000) {
      return parseFloat((price / servings).toFixed(3));
    }
  }
  return null;
}

// Extract serving count from specs
function extractServingCountFromSpecs(specsText, bulletPoints) {
  const all = (specsText + ' ' + bulletPoints.join(' ')).toLowerCase();
  const servingsMatch = all.match(/(\d+)\s*(?:servings?|count|ct\b|capsules?|tablets?|softgels?|gummies|pieces?)/);
  if (servingsMatch) {
    const count = parseInt(servingsMatch[1]);
    if (count > 0 && count < 1000) return count;
  }
  return null;
}

// REVIEW SENTIMENT TAGGER
function tagReviewSentiment(reviewTitle, reviewBody) {
  const text = (reviewTitle + ' ' + reviewBody).toLowerCase();
  const tags = [];

  // Positive signals
  if (text.match(/taste|flavor|delicious|yummy|good taste|great taste|love the taste/)) {
    tags.push('taste-positive');
  }
  if (text.match(/work|effective|results|difference|help|improved|notice/)) {
    tags.push('effectiveness-positive');
  }
  if (text.match(/worth|value|price|affordable|cheap|deal/)) {
    tags.push('value-positive');
  }
  if (text.match(/package|packaging|bottle|container|seal/)) {
    tags.push('packaging-mention');
  }

  // Negative signals
  if (text.match(/taste|flavor|disgusting|awful|terrible|horrible|bad taste/)) {
    if (text.match(/don't|doesn't|not|no |bad|awful|horrible|disgusting|terrible|gross|weird/)) {
      tags.push('taste-negative');
    }
  }
  if (text.match(/side effect|stomach|nausea|headache|upset|sick|reaction/)) {
    tags.push('side-effects');
  }
  if (text.match(/not work|didn't work|no effect|waste|useless|fake/)) {
    tags.push('effectiveness-negative');
  }
  if (text.match(/expensive|overpriced|not worth/)) {
    tags.push('value-negative');
  }

  return tags;
}

// ============================================================
// UTILITY HELPERS
// ============================================================
function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(msg, level = 'info') {
  const ts = new Date().toISOString();
  const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : level === 'success' ? '✅' : '📝';
  console.log(`[${ts}] ${prefix} ${msg}`);
}

// ============================================================
// AMAZON LOGIN (for authenticated scraping)
// ============================================================
async function loginToAmazon(page) {
  try {
    // First check if already logged in via saved session (persistent browser profile)
    log('Checking Amazon session...');
    await page.goto('https://www.amazon.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    const alreadyLoggedIn = await page.evaluate(() => {
      const nav = document.querySelector('#nav-link-accountList-nav-line-1');
      const greeting = nav ? nav.textContent.trim() : '';
      return nav && !greeting.includes('Sign in') && greeting.length > 0;
    });

    if (alreadyLoggedIn) {
      const name = await page.evaluate(() => {
        const nav = document.querySelector('#nav-link-accountList-nav-line-1');
        return nav ? nav.textContent.trim() : 'user';
      });
      log('Amazon session active — logged in as: ' + name, 'success');
      return true;
    }

    // Not logged in — try with credentials
    const email = process.env.AMAZON_EMAIL;
    const password = process.env.AMAZON_PASSWORD;
    if (!email || !password) {
      log('No Amazon credentials configured - scraping as guest', 'warn');
      return false;
    }

    log('Session expired, logging in to Amazon...');
    await page.goto('https://www.amazon.com/ap/signin?openid.assoc_handle=usflex&openid.mode=checkid_setup&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Fill email
    const emailField = await page.$('#ap_email');
    if (!emailField) {
      log('Amazon sign-in form not found - may have redirected to bot check', 'warn');
      return false;
    }
    await page.fill('#ap_email', email);
    await page.click('#continue');
    await page.waitForTimeout(2000);

    // Fill password
    const pwField = await page.$('#ap_password');
    if (!pwField) {
      log('Password field not found - possible CAPTCHA, continuing as guest', 'warn');
      return false;
    }
    await page.fill('#ap_password', password);
    await page.click('#signInSubmit');
    await page.waitForTimeout(4000);

    const loggedIn = await page.evaluate(() => {
      const nav = document.querySelector('#nav-link-accountList-nav-line-1');
      return nav && !nav.textContent.includes('Sign in');
    });

    if (loggedIn) {
      log('Amazon login successful', 'success');
      return true;
    } else {
      log('Amazon login failed - continuing as guest', 'warn');
      return false;
    }
  } catch (err) {
    log('Amazon login error: ' + err.message + ' - continuing as guest', 'warn');
    return false;
  }
}

// Parse price from text like "$17.54" or "$19.98 ($0.33/Count)" - returns dollars not cents
function parsePrice(text) {
  if (!text) return null;
  // Remove $ and commas, parse as float (only first number if multiple like "$19.98 ($0.33/Count)")
  const clean = String(text).replace(/[^0-9.]/g, '').split('.').slice(0, 2).join('.');
  const val = parseFloat(clean);
  if (isNaN(val) || val <= 0) return null;
  // If value looks like it's in cents (> 500), divide by 100
  let price = val;
  if (val > 500) price = val / 100;
  // Validate range: must be between 1.00 and 300.00
  if (price < 1.00 || price > 300.00) return null;
  return Math.round(price * 100) / 100; // round to 2 decimal places
}

// Parse BSR from text - returns integer rank
function parseBSR(text) {
  if (!text) return null;
  const clean = text.replace(/[^0-9]/g, '');
  const val = parseInt(clean);
  return isNaN(val) ? null : val;
}

// Check if product type is priority
function isPriorityType(productType) {
  return PRIORITY_TYPES.includes(productType.toLowerCase());
}

// Get limits based on product type
function getLimitsForType(productType) {
  return isPriorityType(productType) ? PRIORITY_LIMITS : STANDARD_LIMITS;
}

// ============================================================
// SUPABASE HELPERS
// ============================================================
async function sbFetch(table, options = {}) {
  const { select = '*', filter = '', order = '', limit = '' } = options;

  let endpoint = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`;
  if (filter) endpoint += `&${filter}`;
  if (order) endpoint += `&order=${order}`;
  if (limit) endpoint += `&limit=${limit}`;

  const res = await fetch(endpoint, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase fetch error: ${res.status} - ${text}`);
  }

  return res.json();
}

async function sbInsert(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(data)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase insert error: ${res.status} - ${text}`);
  }

  return res.json();
}

async function sbUpsert(table, data, onConflict = '') {
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation,resolution=merge-duplicates'
  };

  const conflictParam = onConflict ? `?on_conflict=${onConflict}` : '';
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${conflictParam}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase upsert error: ${res.status} - ${text}`);
  }

  return res.json();
}

async function sbUpdate(table, filter, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(data)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase update error: ${res.status} - ${text}`);
  }

  return res.json();
}

async function sbDelete(table, filter) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'DELETE',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  if (!res.ok) {
    const text = await res.text();
    log(`Delete warning on ${table}: ${res.status} - ${text}`, 'warn');
  }

  return true;
}

// ============================================================
// EXTERNAL API HELPERS
// ============================================================
async function getOpenRouterKey() {
  try {
    const settings = await sbFetch('app_settings', {
      filter: 'key=eq.openrouter_api_key',
      limit: 1
    });
    if (settings && settings.length > 0) {
      return settings[0].value;
    }
    log('OpenRouter key not found in app_settings', 'warn');
    return null;
  } catch (err) {
    log(`Failed to get OpenRouter key: ${err.message}`, 'error');
    return null;
  }
}

async function sendTelegram(message) {
  if (!OPENCLAW_GATEWAY || !OPENCLAW_TOKEN || !TELEGRAM_CHAT_ID) {
    log('Telegram not configured - skipping notification', 'warn');
    return;
  }

  try {
    // Use OpenClaw system event to deliver Telegram message
    const res = await fetch(`${OPENCLAW_GATEWAY}/api/events`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENCLAW_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        kind: 'system',
        text: message,
        deliver: true
      })
    });

    if (!res.ok) {
      const text = await res.text();
      log(`Telegram send failed: ${res.status} - ${text}`, 'error');
    } else {
      log('Telegram notification sent', 'success');
    }
  } catch (err) {
    log(`Telegram error: ${err.message}`, 'error');
  }
}

// ============================================================
// PROGRESS TRACKING
// ============================================================
async function updateJobProgress(jobId, updates) {
  try {
    await sbUpdate('dovive_jobs', `id=eq.${jobId}`, {
      ...updates,
      updated_at: new Date().toISOString()
    });
  } catch (err) {
    log(`Failed to update job progress: ${err.message}`, 'warn');
  }
}

// ============================================================
// SCRAPING FUNCTIONS
// ============================================================

/**
 * Scrape search results for a keyword + product type combination
 * Returns up to maxResults products with pagination
 */
async function scrapeSearchResults(page, searchQuery, keyword, productType, maxResults = 50) {
  log(`Searching: "${searchQuery}" (type: ${productType})`);

  const products = [];
  let pageNum = 1;
  const maxPages = 3; // Amazon typically shows 16-24 per page, so 3 pages = ~48-72 products

  while (products.length < maxResults && pageNum <= maxPages) {
    const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(searchQuery)}&page=${pageNum}`;

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await sleep(randomDelay(SCRAPE_DELAY_MIN, SCRAPE_DELAY_MAX));

      // Detect CAPTCHA / robot check
      const isCaptcha = await page.evaluate(() => {
        const body = document.body.innerText || '';
        const title = document.title || '';
        return body.includes('robot') || body.includes('captcha') || body.includes('Type the characters') ||
               title.includes('Robot Check') || title.includes('CAPTCHA') ||
               !!document.querySelector('form[action*="captcha"]') ||
               !!document.querySelector('#captchacharacters');
      });
      if (isCaptcha) {
        log('⚠️  CAPTCHA detected! Pausing 60s — please solve it in the browser window...', 'warn');
        await sleep(60000); // Wait 60s for manual solve
        log('Resuming after CAPTCHA pause...', 'warn');
      }

      // Wait for results
      await page.waitForSelector('[data-asin]', { timeout: 15000 }).catch(() => {
        log(`No results on page ${pageNum} — Amazon may be blocking. Try increasing delay.`, 'warn');
      });

      // Extract products from current page
      const pageProducts = await page.evaluate((startRank) => {
        const items = [];
        const resultDivs = document.querySelectorAll('[data-asin]:not([data-asin=""])');

        let rank = startRank;
        resultDivs.forEach((div) => {
          const asin = div.getAttribute('data-asin');
          if (!asin || asin.length !== 10) return;

          // Sponsored check
          const sponsoredEl = div.querySelector('[data-component-type="sp-sponsored-result"]') ||
                            div.querySelector('.s-label-popover-default') ||
                            div.textContent.includes('Sponsored');
          const is_sponsored = !!sponsoredEl;

          // Prime check
          const primeEl = div.querySelector('.a-icon-prime') || div.querySelector('[aria-label*="Prime"]');
          const is_prime = !!primeEl;

          // Title
          const titleEl = div.querySelector('h2 a span') || div.querySelector('h2 span');
          const title = titleEl?.textContent?.trim() || '';
          if (!title) return;

          // URL
          const linkEl = div.querySelector('h2 a');
          const url = linkEl?.href || `https://www.amazon.com/dp/${asin}`;

          // Price - extract raw text, will parse properly outside evaluate
          const priceText = div.querySelector('.a-price .a-offscreen')?.textContent?.trim() || '';

          // Rating
          const ratingEl = div.querySelector('i.a-icon-star-small span.a-icon-alt') ||
                          div.querySelector('i.a-icon-star span.a-icon-alt') ||
                          div.querySelector('.a-icon-alt');
          const ratingText = ratingEl?.textContent || '';
          const ratingMatch = ratingText.match(/(\d+\.?\d*)\s*out\s*of\s*5/i);
          const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

          // Reviews count
          const reviewEl = div.querySelector('span.a-size-base.s-underline-text') ||
                          div.querySelector('[aria-label*="rating"]')?.parentElement?.querySelector('span:last-child');
          let reviewText = reviewEl?.textContent?.replace(/[,\s]/g, '') || '0';
          const review_count = parseInt(reviewText) || null;

          rank++;
          items.push({
            asin,
            title: title.slice(0, 500),
            url,
            price_text: priceText,
            rating,
            review_count,
            rank_position: rank,
            is_sponsored,
            is_prime
          });
        });

        return items;
      }, products.length);

      // Add detected product type and metadata, parse price properly
      for (const p of pageProducts) {
        if (products.length >= maxResults) break;
        p.keyword = keyword;
        p.search_query = searchQuery;
        p.product_type = detectProductType(p.title);
        p.price = parsePrice(p.price_text);  // Parse price from text using helper
        products.push(p);
      }

      log(`  Page ${pageNum}: Found ${pageProducts.length} products (total: ${products.length})`);

      // Check for next page
      const hasNextPage = await page.evaluate(() => {
        const nextBtn = document.querySelector('.s-pagination-next:not(.s-pagination-disabled)');
        return !!nextBtn;
      });

      if (!hasNextPage) {
        log(`  No more pages after page ${pageNum}`);
        break;
      }

      pageNum++;
      await sleep(randomDelay(SCRAPE_DELAY_MIN, SCRAPE_DELAY_MAX));

    } catch (err) {
      log(`  Page ${pageNum} error: ${err.message}`, 'error');
      break;
    }
  }

  log(`  Total products collected: ${products.length}`);
  return products;
}

/**
 * Scrape Amazon Best Sellers page for a category
 * Returns top 100 products ranked by real sales velocity (updated hourly)
 * This gives TRUE market leaders, not Amazon's promoted/algorithmic results
 */
async function scrapeBestSellers(browser, category, keyword) {
  // category = { name, node_id, format, url }
  const page = await browser.newPage();

  try {
    // Set US locale and Amazon cookies to avoid geo-redirect
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

    const products = [];
    let pageNum = 1;
    const maxPages = 2; // Top 100 = 2 pages of 50 each
    const maxProducts = parseInt(scoutConfig.max_products_per_type || 50);

    log(`Scraping Best Sellers: ${category.name} (url: ${category.url})`);

    while (pageNum <= maxPages && products.length < maxProducts) {
      const url = category.url + (pageNum > 1 ? '?pg=' + pageNum : '');
      log(`  Loading page ${pageNum}: ${url}`);

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(2000 + Math.random() * 1000);

      // Scrape product cards from Best Sellers page
      // Best Sellers layout: .zg-grid-general-faceout or .p13n-gridRow or #gridItemRoot
      const currentPage = pageNum; // Capture for closure
      const items = await page.evaluate((pageNumber) => {
        const results = [];

        // Try multiple selectors for different BS page layouts
        const cards = document.querySelectorAll(
          '.zg-grid-general-faceout, .p13n-gridRow ._cDEzb_grid-cell_1uMOS, [id^="gridItemRoot"]'
        );

        cards.forEach((card, index) => {
          try {
            const rankEl = card.querySelector('.zg-bdg-text, ._cDEzb_p13n-sc-css-line-clamp-1_1Fn1y, .zg-item .a-size-small');
            const titleEl = card.querySelector('._cDEzb_p13n-sc-css-line-clamp-3_g3dy1 a, .p13n-sc-truncated, a.a-link-normal span');
            const priceEl = card.querySelector('._cDEzb_p13n-sc-price_3mJ9Z, .a-color-price, span.p13n-sc-price');
            const ratingEl = card.querySelector('i.a-icon-star-small span.a-icon-alt, .a-icon-alt');
            const reviewEl = card.querySelector('a[href*="customerReviews"] span, span.a-size-small.a-color-secondary');
            const linkEl = card.querySelector('a.a-link-normal[href*="/dp/"]');
            const imgEl = card.querySelector('img.a-dynamic-image, img.p13n-product-image');

            const href = linkEl ? linkEl.getAttribute('href') : '';
            const asinMatch = href.match(/\/dp\/([A-Z0-9]{10})/);

            if (asinMatch) {
              results.push({
                asin: asinMatch[1],
                title: titleEl ? titleEl.textContent.trim() : '',
                price_text: priceEl ? priceEl.textContent.trim().replace(/[^0-9.]/g, '') : null,
                rating_text: ratingEl ? ratingEl.textContent.trim() : null,
                review_text: reviewEl ? reviewEl.textContent.trim().replace(/[^0-9,]/g, '') : null,
                image_url: imgEl ? imgEl.src : null,
                rank_position: index + 1 + (pageNumber - 1) * 50,
                url: 'https://www.amazon.com' + href.split('?')[0]
              });
            }
          } catch(e) {}
        });

        return results;
      }, currentPage);

      log(`  Page ${pageNum}: Found ${items.length} products`);
      products.push(...items);
      pageNum++;

      // Check if next page exists
      const hasNext = await page.$('.a-pagination .a-last:not(.a-disabled)');
      if (!hasNext) {
        log(`  No more pages after page ${pageNum - 1}`);
        break;
      }

      await sleep(2000 + Math.random() * 1500);
    }

    await page.close();

    // Parse numeric values and add metadata
    const parsedProducts = products.map(p => ({
      asin: p.asin,
      title: p.title,
      url: p.url,
      price: parsePrice(p.price_text),  // Use parsePrice helper for proper dollar parsing
      price_text: p.price_text ? '$' + p.price_text : null,
      rating: p.rating_text ? parseFloat(p.rating_text.split(' ')[0]) : null,
      review_count: p.review_text ? parseInt(p.review_text.replace(',', '')) : null,
      rank_position: p.rank_position,
      keyword: keyword,
      product_type: detectProductType(p.title),
      source: 'best_sellers',
      bsr_category: category.name,
      bsr: p.rank_position,
      images: p.image_url ? [p.image_url] : [],
      is_sponsored: false,
      is_prime: false
    }));

    log(`  Total Best Sellers collected: ${parsedProducts.length}`);
    return parsedProducts;

  } catch (e) {
    await page.close();
    throw new Error('Best Sellers scrape failed for ' + category.name + ': ' + e.message);
  }
}

// ============================================================
// IMAGE SCRAPING FOR OCR PIPELINE
// ============================================================

/**
 * Convert Amazon thumbnail URLs to full-size versions
 * Removes size constraints like ._AC_SX300_. or ._SS40_.
 */
function upgradeImageUrl(url) {
  if (!url) return url;
  return url
    .replace(/\._[A-Z]{2}[0-9]+_\./g, '.')       // e.g. ._SX300_. or ._AC_SL300_.
    .replace(/\._[A-Z]+_[A-Z]+[0-9]+_\./g, '.')  // e.g. ._AC_UL320_.
    .replace(/\._AC_S[SXL][0-9]+_\./g, '.')      // e.g. ._AC_SX300_.
    .replace(/\._[A-Z0-9,_]+_\./g, '.');         // catch-all for other size codes
}

/**
 * Scrape ALL images from Amazon product listing
 * Returns array of { type: 'main'|'gallery'|'aplus', url: string, index: number }
 */
async function scrapeAllImages(page) {
  return await page.evaluate(() => {
    const images = [];

    // 1. MAIN IMAGE (high res)
    const mainImg = document.querySelector('#landingImage, #imgBlkFront, #main-image');
    if (mainImg) {
      // Get highest resolution version
      const dataDynamic = mainImg.getAttribute('data-old-hires') ||
                          mainImg.getAttribute('data-a-hires') ||
                          mainImg.src;
      // Convert thumbnail URL to full size
      const fullRes = dataDynamic.replace(/\._[A-Z_0-9,]+_\./, '.');
      if (fullRes && fullRes.startsWith('http')) {
        images.push({ type: 'main', url: fullRes, index: 0 });
      }
    }

    // 2. GALLERY THUMBNAILS → full size
    const thumbs = document.querySelectorAll(
      '#altImages li.item img, #altImages .imageThumbnail img, .a-button-thumbnail img'
    );
    thumbs.forEach((img, i) => {
      let src = img.getAttribute('data-old-hires') || img.src || '';
      // Convert thumbnail to full size: remove size suffix like ._AC_US40_ or ._SS40_
      src = src.replace(/\._[A-Z_0-9,]+_\./, '.').replace(/\._[A-Z]+[0-9]+_\./, '.');
      if (src && !src.includes('transparent-pixel') && src.includes('amazon') && src.startsWith('http')) {
        // Check if not already added (avoid duplicates with main)
        const exists = images.some(existing => existing.url === src);
        if (!exists) {
          images.push({ type: 'gallery', url: src, index: i + 1 });
        }
      }
    });

    // 3. A+ CONTENT IMAGES (brand enhanced content - often has formula/claims)
    const aplusImgs = document.querySelectorAll(
      '#aplus img, #aplus3p_feature_div img, .aplus-module img, #dpx-aplus-product-description_feature_div img'
    );
    aplusImgs.forEach((img, i) => {
      const src = img.src || img.getAttribute('data-src') || '';
      if (src && src.includes('amazon') && !src.includes('transparent') && src.startsWith('http')) {
        const exists = images.some(existing => existing.url === src);
        if (!exists) {
          images.push({ type: 'aplus', url: src, index: i });
        }
      }
    });

    return images;
  });
}

/**
 * Save product images to dovive_product_images for OCR pipeline
 */
async function saveProductImages(asin, keyword, images) {
  if (!images || images.length === 0) return;

  try {
    const rows = images.map(img => ({
      asin,
      keyword,
      image_type: img.type,
      image_index: img.index,
      url: upgradeImageUrl(img.url),
      ocr_status: 'pending'
    }));

    // Delete existing images for this ASIN first (re-scrape = fresh data)
    await sbDelete('dovive_product_images', 'asin=eq.' + asin);
    await sbInsert('dovive_product_images', rows);
    log(`  Saved ${rows.length} images for ${asin}`);
  } catch (err) {
    log(`  Failed to save images for ${asin}: ${err.message}`, 'warn');
  }
}

/**
 * Scrape product detail page for images, features, and basic specs
 * V2.8: Expanded to collect full data for dovive_research including
 * images, bullet points, brand, description, ingredients, specs, reviews, certifications
 */
async function scrapeProductPage(page, asin, keyword, productType) {
  log(`  Scraping product page: ${asin}`);

  try {
    const productUrl = `https://www.amazon.com/dp/${asin}`;
    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(randomDelay(PRODUCT_PAGE_DELAY_MIN, PRODUCT_PAGE_DELAY_MAX));

    // 1. IMAGES - all gallery images
    const allImages = await page.evaluate(() => {
      const imgs = [];
      // Main image
      const main = document.querySelector('#landingImage');
      if (main) {
        const src = (main.getAttribute('data-old-hires') || main.src || '').replace(/\._[A-Z0-9_,]+_\./g, '.');
        if (src) imgs.push({ type: 'main', url: src });
      }
      // Gallery thumbnails → full size
      document.querySelectorAll('#altImages li.item img').forEach((img, i) => {
        let src = (img.getAttribute('data-old-hires') || img.src || '').replace(/\._[A-Z0-9_,]+_\./g, '.');
        if (src && src.includes('amazon') && !src.includes('transparent')) {
          imgs.push({ type: 'gallery', url: src, index: i });
        }
      });
      // A+ content images
      document.querySelectorAll('#aplus img, .aplus-module img').forEach((img, i) => {
        const src = (img.src || img.getAttribute('data-src') || '').replace(/\._[A-Z0-9_,]+_\./g, '.');
        if (src && src.includes('amazon')) imgs.push({ type: 'aplus', url: src });
      });
      return imgs;
    });
    log(`    Images found: ${allImages.length}`);

    // 2. BULLET POINTS
    const bulletPoints = await page.evaluate(() => {
      const bullets = [];
      document.querySelectorAll('#feature-bullets li span.a-list-item').forEach(el => {
        const text = el.textContent.trim();
        if (text && text.length > 5) bullets.push(text);
      });
      return bullets;
    });

    // 3. BRAND
    const brand = await page.evaluate(() => {
      const byline = document.querySelector('#bylineInfo, #brand, .po-brand .a-span9');
      return byline ? byline.textContent.replace('Visit the', '').replace('Store', '').replace('Brand:', '').trim() : null;
    });

    // 4. DESCRIPTION / INGREDIENTS
    const description = await page.evaluate(() => {
      const desc = document.querySelector('#productDescription p, #productDescription_fullView');
      return desc ? desc.textContent.trim().substring(0, 2000) : null;
    });

    // Try to extract ingredients from description or bullet points
    const ingredientsText = await page.evaluate(() => {
      // Look for "Ingredients:" section in product description
      const full = document.body.innerText;
      const match = full.match(/ingredients[:\s]+([^\n]{20,500})/i);
      return match ? match[1].trim() : null;
    });

    // 5. SPECS (from product details table)
    const specs = await page.evaluate(() => {
      const data = {};
      document.querySelectorAll('#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr, .detail-bullet-list li').forEach(row => {
        const cells = row.querySelectorAll('td, span.a-text-bold');
        if (cells.length >= 2) {
          const key = cells[0].textContent.replace(/[:\u200F\u200E]/g, '').trim();
          const val = cells[1].textContent.trim();
          if (key && val) data[key] = val;
        }
      });
      // Also get detail bullets format
      document.querySelectorAll('.detail-bullet-list span.a-list-item').forEach(item => {
        const bold = item.querySelector('span.a-text-bold');
        if (bold) {
          const key = bold.textContent.replace(/[:\u200F\u200E]/g, '').trim();
          const val = item.textContent.replace(bold.textContent, '').trim();
          if (key && val) data[key] = val;
        }
      });
      return data;
    });

    // 6. REVIEWS - top 10 reviews from product page
    const pageReviews = await page.evaluate(() => {
      const revs = [];
      document.querySelectorAll('[data-hook="review"]').forEach(el => {
        const rating = el.querySelector('[data-hook="review-star-rating"] .a-icon-alt');
        const title = el.querySelector('[data-hook="review-title"] span:not(.a-icon-alt)');
        const body = el.querySelector('[data-hook="review-body"] span');
        const date = el.querySelector('[data-hook="review-date"]');
        const verified = el.querySelector('[data-hook="avp-badge"]');
        revs.push({
          rating: rating ? parseFloat(rating.textContent) : null,
          title: title ? title.textContent.trim() : null,
          body: body ? body.textContent.trim().substring(0, 500) : null,
          date: date ? date.textContent.trim() : null,
          verified: !!verified
        });
      });
      return revs.slice(0, 10);
    });

    // Extract title and BSR
    const pageDetails = await page.evaluate(() => {
      const result = { title: '', bsr: null, bsr_category: null };
      const titleEl = document.querySelector('#productTitle');
      result.title = titleEl?.textContent?.trim() || '';

      const detailsText = document.body.innerText;
      const bsrMatch = detailsText.match(/Best\s*Sellers\s*Rank[:\s#]*(\d[\d,]*)/i);
      if (bsrMatch) result.bsr_text = bsrMatch[1];

      const bsrCatMatch = detailsText.match(/Best\s*Sellers\s*Rank[:\s#]*[\d,]+\s*in\s*([^\n(]+)/i);
      if (bsrCatMatch) result.bsr_category = bsrCatMatch[1].trim().replace(/\s*\(.*$/, '');

      return result;
    });

    // Log extraction results
    log(`    Bullets found: ${bulletPoints.length}`);
    log(`    Specs found: ${Object.keys(specs).length}`);
    log(`    Reviews found: ${pageReviews.length}`);
    log(`    Brand: ${brand || 'null'}`);

    // 7. CERTIFICATIONS from bullet points and specs
    const certKeywords = ['non-gmo','vegan','vegetarian','gluten-free','organic','kosher','halal','gmp','nsf','third-party','usp verified','made in usa'];
    const allText = [...bulletPoints, description || '', JSON.stringify(specs)].join(' ').toLowerCase();
    const certifications = certKeywords.filter(k => allText.includes(k));

    // 8. MAIN IMAGE (just the first/main image URL for quick display)
    const mainImage = allImages.find(i => i.type === 'main')?.url || allImages[0]?.url || null;

    // 9. SERVINGS data from specs
    const specsText = JSON.stringify(specs);
    const servMatch = specsText.match(/(\d+)\s*(serving|count|capsule|tablet|gummy|piece)/i);
    const totalServings = servMatch ? parseInt(servMatch[1]) : null;

    // Build details object
    const details = {
      title: pageDetails.title,
      brand,
      bsr: parseBSR(pageDetails.bsr_text),
      bsr_category: pageDetails.bsr_category,
      allImages,
      images: allImages.map(img => upgradeImageUrl(img.url)),
      main_image: mainImage,
      bullet_points: bulletPoints,
      features: bulletPoints, // Keep for backwards compatibility
      description,
      ingredients: ingredientsText,
      specs,
      reviews: pageReviews,
      certifications,
      total_servings: totalServings,
      serving_count: totalServings // Keep for backwards compatibility
    };

    // Extract format-specific data
    details.format_data = {};
    details.gummies_data = null;
    details.powder_data = null;

    if (productType === 'Gummies') {
      details.gummies_data = extractGummiesData(pageDetails.title, bulletPoints, specsText, ingredientsText || '');
      details.format_data = details.gummies_data;
    } else if (productType === 'Powder') {
      details.powder_data = extractPowderData(pageDetails.title, bulletPoints, specsText, ingredientsText || '');
      details.format_data = details.powder_data;
    }

    // Save images to dovive_product_images for OCR processing
    await saveProductImages(asin, keyword, allImages);

    return details;

  } catch (err) {
    log(`  Product page error for ${asin}: ${err.message}`, 'error');
    return null;
  }
}

/**
 * Scrape all reviews for a product (up to maxReviews)
 * Now includes sentiment tagging
 */
async function scrapeReviews(page, asin, keyword, maxReviews = Infinity) {
  log(`  Scraping reviews for: ${asin} (all available)`);

  const reviews = [];
  let pageNum = 1;

  while (true) { // paginate until no more reviews
    const reviewUrl = `https://www.amazon.com/product-reviews/${asin}?sortBy=recent&reviewerType=all_reviews&pageNumber=${pageNum}`;

    try {
      await page.goto(reviewUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await sleep(randomDelay(1000, 2000));

      // Wait for reviews to load
      await page.waitForSelector('[data-hook="review"]', { timeout: 10000 }).catch(() => null);

      const pageReviews = await page.evaluate(() => {
        const items = [];
        const reviewDivs = document.querySelectorAll('[data-hook="review"]');

        reviewDivs.forEach(div => {
          // Reviewer name
          const nameEl = div.querySelector('span.a-profile-name');
          const reviewer_name = nameEl?.textContent?.trim() || 'Anonymous';

          // Rating
          const ratingEl = div.querySelector('i[data-hook="review-star-rating"] span.a-icon-alt, i[data-hook="cmps-review-star-rating"] span.a-icon-alt');
          const ratingText = ratingEl?.textContent || '';
          const ratingMatch = ratingText.match(/(\d+\.?\d*)/);
          const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

          // Title
          const titleEl = div.querySelector('a[data-hook="review-title"] span:last-child, [data-hook="review-title"] span');
          const title = titleEl?.textContent?.trim() || '';

          // Body
          const bodyEl = div.querySelector('span[data-hook="review-body"] span');
          const body = bodyEl?.textContent?.trim() || '';

          // Date
          const dateEl = div.querySelector('span[data-hook="review-date"]');
          const dateText = dateEl?.textContent || '';
          // Parse "Reviewed in the United States on January 1, 2024"
          const dateMatch = dateText.match(/on\s+(.+)$/i);
          let review_date = null;
          if (dateMatch) {
            try {
              review_date = new Date(dateMatch[1]).toISOString().split('T')[0];
            } catch (e) {}
          }

          // Verified purchase
          const verifiedEl = div.querySelector('span[data-hook="avp-badge"]');
          const verified_purchase = !!verifiedEl;

          // Helpful votes
          const helpfulEl = div.querySelector('span[data-hook="helpful-vote-statement"]');
          const helpfulText = helpfulEl?.textContent || '';
          const helpfulMatch = helpfulText.match(/(\d+)/);
          const helpful_votes = helpfulMatch ? parseInt(helpfulMatch[1]) : 0;

          if (body || title) {
            items.push({
              reviewer_name,
              rating,
              title,
              body: body.slice(0, 5000), // Limit body length
              review_date,
              verified_purchase,
              helpful_votes
            });
          }
        });

        return items;
      });

      if (pageReviews.length === 0) {
        log(`    No reviews on page ${pageNum}, stopping`);
        break;
      }

      // Add ASIN, keyword, and sentiment tags to each review
      for (const r of pageReviews) {
        // no limit - collect all
        r.asin = asin;
        r.keyword = keyword;
        // Add sentiment tags
        r.sentiment_tags = tagReviewSentiment(r.title, r.body);
        reviews.push(r);
      }

      log(`    Page ${pageNum}: ${pageReviews.length} reviews (total: ${reviews.length})`);

      // Check for next page
      const hasNextPage = await page.evaluate(() => {
        const nextBtn = document.querySelector('li.a-last:not(.a-disabled) a');
        return !!nextBtn;
      });

      if (!hasNextPage) {
        break;
      }

      pageNum++;
      await sleep(randomDelay(1500, 2500)); // Slightly longer delay for review pages

    } catch (err) {
      log(`    Reviews page ${pageNum} error: ${err.message}`, 'error');
      break;
    }
  }

  log(`    Total reviews collected: ${reviews.length}`);
  return reviews;
}

/**
 * Enhanced reviews scraping for authenticated sessions
 * Scrapes multiple pages of reviews when logged in
 */
async function scrapeReviewsPage(page, asin, maxReviews = Infinity) {
  const reviews = [];
  let pageNum = 1;

  while (pageNum <= 500) { // hard ceiling: 500 pages = ~5000 reviews max
    try {
      await page.goto(`https://www.amazon.com/product-reviews/${asin}?pageNumber=${pageNum}&sortBy=recent`, {
        waitUntil: 'domcontentloaded', timeout: 30000
      });
      await page.waitForTimeout(randomDelay(1500, 3000));

      const pageReviews = await page.evaluate(() => {
        const revs = [];
        document.querySelectorAll('[data-hook="review"]').forEach(el => {
          const rating = el.querySelector('[data-hook="review-star-rating"] .a-icon-alt');
          const title = el.querySelector('[data-hook="review-title"] span:not(.a-icon-alt)');
          const body = el.querySelector('[data-hook="review-body"] span');
          const date = el.querySelector('[data-hook="review-date"]');
          const verified = el.querySelector('[data-hook="avp-badge"]');
          const helpful = el.querySelector('[data-hook="helpful-vote-statement"]');
          if (title && body) {
            revs.push({
              rating: rating ? parseFloat(rating.textContent) : null,
              title: title.textContent.trim(),
              body: body.textContent.trim().substring(0, 1000),
              date: date ? date.textContent.trim() : null,
              verified: !!verified,
              helpful_votes: helpful ? helpful.textContent.trim() : null
            });
          }
        });
        return revs;
      });

      if (pageReviews.length === 0) break;
      reviews.push(...pageReviews);
      log(`    Reviews page ${pageNum}: ${pageReviews.length} found (total: ${reviews.length})`);
      pageNum++;
      if (reviews.length >= 500) {
        log(`    Soft cap 500 reached — stopping review scrape`);
        break;
      }
    } catch (err) {
      log(`    Reviews page ${pageNum} error: ${err.message}`);
      break;
    }
  }

  log(`    Total reviews collected: ${reviews.length}`);
  return reviews;
}

// ============================================================
// DATABASE SAVE FUNCTIONS
// ============================================================

/**
 * Save products to dovive_products (upsert)
 * Now includes price_per_serving, serving_count, format_data, and source
 */
async function saveProducts(products, detailsMap = {}) {
  if (!products || products.length === 0) return;

  for (const p of products) {
    try {
      const details = detailsMap[p.asin] || {};

      await sbUpsert('dovive_products', {
        asin: p.asin,
        keyword: p.keyword,
        product_type: p.product_type,
        title: p.title,
        brand: p.brand || details.brand || null,
        price: p.price,
        price_text: p.price_text,
        bsr: p.bsr || details.bsr || null,
        bsr_category: p.bsr_category || details.bsr_category || null,
        rating: p.rating,
        review_count: p.review_count,
        images: p.images || details.images || [],
        features: p.features || details.features || [],
        is_sponsored: p.is_sponsored || false,
        is_prime: p.is_prime || false,
        url: p.url,
        rank_position: p.rank_position,
        search_query: p.search_query,
        price_per_serving: details.price_per_serving || null,
        serving_count: details.serving_count || null,
        format_data: details.format_data || {},
        source: p.source || 'keyword_search',  // Track data origin: 'keyword_search' | 'best_sellers' | 'manual'
        scraped_at: new Date().toISOString()
      });
    } catch (err) {
      if (!err.message.includes('duplicate')) {
        log(`Failed to save product ${p.asin}: ${err.message}`, 'warn');
      }
    }
  }

  log(`Saved ${products.length} products to dovive_products`, 'success');
}

/**
 * Save/update product details to dovive_specs
 * Now includes gummies_data and powder_data
 */
async function saveProductDetails(asin, keyword, details, productType) {
  if (!details) return;

  try {
    const specs = details.specs || {};

    await sbUpsert('dovive_specs', {
      asin,
      keyword,
      item_form: specs['Item Form'] || specs['Product Form'] || null,
      unit_count: specs['Unit Count'] || specs['Number of Items'] || null,
      flavor: specs['Flavor'] || null,
      primary_ingredient: specs['Primary Supplement Ingredient'] || specs['Active Ingredient'] || null,
      weight: specs['Item Weight'] || specs['Package Weight'] || null,
      dimensions: specs['Package Dimensions'] || specs['Product Dimensions'] || null,
      diet_type: specs['Diet Type'] || null,
      allergen_info: specs['Allergen Information'] || null,
      country_of_origin: specs['Country of Origin'] || null,
      manufacturer: specs['Manufacturer'] || null,
      ingredients: details.ingredients,
      certifications: details.certifications || [],
      all_specs: specs,
      gummies_data: details.gummies_data || {},
      powder_data: details.powder_data || {},
      scraped_at: new Date().toISOString()
    });
  } catch (err) {
    if (!err.message.includes('duplicate')) {
      log(`Failed to save specs for ${asin}: ${err.message}`, 'warn');
    }
  }
}

/**
 * Save reviews to dovive_reviews table (individual rows, not JSON blob)
 * Deletes old reviews first for fresh data, then batch inserts
 */
async function saveReviews(asin, keyword, reviews) {
  if (!reviews || reviews.length === 0) return 0;

  // Delete old reviews for this asin+keyword first (fresh data on each scrape)
  await sbDelete('dovive_reviews', `asin=eq.${asin}&keyword=eq.${encodeURIComponent(keyword)}`);

  // Prepare rows with all fields
  const rows = reviews.map(r => ({
    asin,
    keyword,
    reviewer_name: r.reviewer_name || r.author || null,
    rating: r.rating || null,
    title: r.title || null,
    body: r.body || r.text || null,
    review_date: r.date || r.review_date || null,
    verified_purchase: r.verified || r.verified_purchase || false,
    helpful_votes: parseInt(r.helpful_votes) || 0,
    sentiment_tags: r.sentiment_tags || [],
    scraped_at: new Date().toISOString()
  }));

  // Insert in batches of 50 to avoid payload limits
  const batchSize = 50;
  let saved = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    try {
      await sbInsert('dovive_reviews', batch);
      saved += batch.length;
      log(`    Saved reviews batch ${Math.floor(i/batchSize)+1}: ${saved}/${rows.length}`);
    } catch (err) {
      log(`    Failed to save reviews batch: ${err.message}`, 'warn');
    }
  }

  log(`  Saved ${saved}/${reviews.length} reviews for ${asin}`, 'success');
  return saved;
}

/**
 * Update product with details from product page scrape
 */
async function updateProductWithDetails(asin, keyword, details, price) {
  if (!details) return;

  try {
    // Calculate price per serving if we have price and serving count
    let pricePerServing = null;
    if (price && details.serving_count) {
      pricePerServing = parseFloat((price / details.serving_count).toFixed(3));
    }

    await sbUpdate('dovive_products', `asin=eq.${asin}&keyword=eq.${encodeURIComponent(keyword)}`, {
      bsr: details.bsr,
      bsr_category: details.bsr_category,
      brand: details.brand,
      images: details.images || [],
      features: details.features || [],
      price_per_serving: pricePerServing,
      serving_count: details.serving_count,
      format_data: details.format_data || {}
    });
  } catch (err) {
    log(`Failed to update product ${asin}: ${err.message}`, 'warn');
  }
}

/**
 * Save full product data to dovive_research table (V2.8)
 * This is the primary data store for Scout dashboard
 */
async function saveToResearch(product, details, source = 'keyword_search') {
  try {
    const price = product.price;
    const totalServings = details?.total_servings || null;
    const pricePerServing = (price && totalServings && totalServings > 0)
      ? Math.round((price / totalServings) * 100) / 100
      : null;

    const data = {
      keyword: product.keyword,
      asin: product.asin,
      title: details?.title || product.title,
      brand: details?.brand || product.brand || null,
      price: price,
      bsr: details?.bsr || product.bsr || null,
      rating: product.rating,
      review_count: product.review_count,
      rank_position: product.rank_position,
      is_sponsored: product.is_sponsored || false,
      source: source,
      main_image: details?.main_image || null,
      images: details?.allImages || [],
      bullet_points: details?.bullet_points || [],
      description: details?.description || null,
      ingredients: details?.ingredients || null,
      specs: details?.specs || {},
      certifications: details?.certifications || [],
      reviews: details?.reviews || [],
      format_data: details?.format_data || {},
      total_servings: totalServings,
      price_per_serving: pricePerServing,
      scraped_at: new Date().toISOString()
    };

    await sbUpsert('dovive_research', data, 'asin,keyword');
    log(`    Saved to dovive_research: ${product.asin}`, 'success');
  } catch (err) {
    if (!err.message.includes('duplicate')) {
      log(`Failed to save to dovive_research ${product.asin}: ${err.message}`, 'warn');
    }
  }
}

// ============================================================
// AI SUMMARY GENERATION
// ============================================================
async function generateAISummary(keyword, allProducts, openRouterKey) {
  if (!openRouterKey) {
    return {
      summary: 'AI summary unavailable - OpenRouter key not configured',
      recommendation: 'MONITOR'
    };
  }

  // Get top products across all types
  const top10 = allProducts.slice(0, TOP_N_FOR_AI_SUMMARY);
  const productList = top10.map((p, i) =>
    `${i + 1}. [${p.product_type}] "${p.title.slice(0, 60)}..." - $${p.price || 'N/A'} - ${p.rating || 'N/A'}★ - ${(p.review_count || 0).toLocaleString()} reviews - BSR: ${p.bsr ? p.bsr.toLocaleString() : 'N/A'}${p.is_sponsored ? ' [AD]' : ''}`
  ).join('\n');

  // Type distribution
  const typeCount = {};
  allProducts.forEach(p => {
    typeCount[p.product_type] = (typeCount[p.product_type] || 0) + 1;
  });
  const typeDistribution = Object.entries(typeCount)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${type}: ${count}`)
    .join(', ');

  const prompt = `You are Scout, a market research analyst for Dovive, a supplement brand launching on Amazon US.

You just scraped Amazon for '${keyword}' across 20 product types. Here is the data:

TOP 10 PRODUCTS:
${productList}

PRODUCT TYPE DISTRIBUTION (total ${allProducts.length} products):
${typeDistribution}

Write a market research summary covering:
1. MARKET SIZE SIGNAL: How competitive is this market? (review counts, BSR ranges)
2. DOMINANT PRODUCT TYPES: Which forms (capsule, gummies, powder, etc.) dominate? Is there a type gap?
3. PRICE OPPORTUNITY: What price range dominates? Gap at premium or budget tier?
4. MARKET GAP: What do top products seem to be missing?
5. ENTRY RECOMMENDATION: Should Dovive enter this market? ENTER / MONITOR / AVOID — with 1-sentence reason
6. RECOMMENDED FORMAT: Which product type should Dovive launch with and why?
7. TOP COMPETITOR: Which single product would be Dovive's main competition?

Be specific. Use the actual data. Plain English — no jargon.`;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://heylencer-debug.github.io/Dovive'
      },
      body: JSON.stringify({
        model: 'anthropic/claude-3.5-sonnet',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1500
      })
    });

    if (!res.ok) {
      const text = await res.text();
      log(`OpenRouter error: ${text}`, 'error');
      return { summary: 'AI summary generation failed', recommendation: 'MONITOR' };
    }

    const data = await res.json();
    const summary = data.choices?.[0]?.message?.content || 'No summary generated';

    // Extract recommendation
    const recMatch = summary.match(/ENTRY RECOMMENDATION[:\s]*(ENTER|MONITOR|AVOID)/i);
    const recommendation = recMatch ? recMatch[1].toUpperCase() : 'MONITOR';

    return { summary, recommendation };
  } catch (err) {
    log(`AI summary error: ${err.message}`, 'error');
    return { summary: 'AI summary generation failed: ' + err.message, recommendation: 'MONITOR' };
  }
}

// Extract key gap from AI summary
function extractKeyGap(summary) {
  const gapMatch = summary.match(/MARKET GAP[:\s]*([^\n]+)/i);
  if (gapMatch) return gapMatch[1].trim();

  const missingMatch = summary.match(/missing[:\s]*([^\n.]+)/i);
  if (missingMatch) return missingMatch[1].trim();

  return null;
}

// ============================================================
// TELEGRAM REPORTING
// ============================================================
function buildTelegramReport(date, keywordResults) {
  let msg = `⚗️ SCOUT V2.9 REPORT — ${date}\n\n`;

  for (const [keyword, data] of Object.entries(keywordResults)) {
    const { products, recommendation, keyGap, typeBreakdown } = data;
    const topProduct = products.find(p => !p.is_sponsored) || products[0];

    msg += `📦 ${keyword.toUpperCase()}\n`;
    msg += `• Products scraped: ${products.length}\n`;
    if (typeBreakdown) {
      const topTypes = Object.entries(typeBreakdown)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([t, c]) => `${t}(${c})`)
        .join(', ');
      msg += `• Top types: ${topTypes}\n`;
    }
    if (topProduct) {
      msg += `• #1: ${topProduct.title.slice(0, 40)}... ($${topProduct.price || 'N/A'})\n`;
    }
    msg += `• Entry: ${recommendation}\n`;
    if (keyGap) {
      msg += `• Gap: ${keyGap.slice(0, 70)}\n`;
    }
    msg += '\n';
  }

  msg += `Full report: https://heylencer-debug.github.io/Dovive`;
  return msg;
}

// ============================================================
// MAIN SCOUT PROCESS
// ============================================================
async function runScout(job) {
  log(`Processing job ${job.id} (triggered by: ${job.triggered_by || 'unknown'})`);

  const startedAt = new Date().toISOString();
  await sbUpdate('dovive_jobs', `id=eq.${job.id}`, {
    status: 'running',
    started_at: startedAt,
    updated_at: startedAt
  });

  let browser;
  const keywordResults = {};
  let totalProductsScraped = 0;
  let totalReviewsScraped = 0;

  try {
    // Get active keywords
    const keywords = await sbFetch('dovive_keywords', {
      filter: 'active=eq.true',
      order: 'created_at.asc'
    });

    if (!keywords || keywords.length === 0) {
      log('No active keywords to scrape (check is_active column)');
      await sbUpdate('dovive_jobs', `id=eq.${job.id}`, {
        status: 'complete',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      return;
    }

    // Log configuration
    const scrapeMode = scoutConfig.scrape_mode || 'best_sellers_first';
    const activeProductTypes = scoutConfig.product_types_active || PRIORITY_TYPES;
    const bestSellersCategories = scoutConfig.best_sellers_categories || [];

    // Log all active keywords found
    const keywordList = keywords.map(k => k.keyword).join(', ');
    log(`Found ${keywords.length} active keywords: [${keywordList}]`, 'success');
    log(`Scrape mode: ${scrapeMode}`);
    log(`Active product types: ${activeProductTypes.join(', ')}`);
    log(`Best Sellers categories: ${bestSellersCategories.length}`);
    log(`Product types per keyword: ${PRODUCT_TYPES.length}`);
    log(`Priority types: ${PRIORITY_TYPES.join(', ')}`);

    // Use real Chrome install with its own user profile — bypasses Amazon bot detection
    const chromeExe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const userDataDir = path.join(__dirname, '.browser-profile');
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      executablePath: chromeExe,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--window-size=1366,768',
        '--disable-extensions-except',
        '--start-maximized'
      ],
      viewport: { width: 1366, height: 768 },
      locale: 'en-US',
      timezoneId: 'America/New_York'
    });
    browser = context;

    // Extra stealth: hide webdriver flag on every new page
    context.on('page', async (p) => {
      await p.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.chrome = { runtime: {} };
      });
    });

    const page = await context.newPage();
    const openRouterKey = await getOpenRouterKey();

    // Amazon login for authenticated scraping
    const isLoggedIn = await loginToAmazon(page);
    log('Scraping as: ' + (isLoggedIn ? 'authenticated user' : 'guest'));

    // ============================================================
    // PHASE 1: BEST SELLERS SCRAPING (DISABLED for now - focus on keyword search only)
    // ============================================================
    // V2.9: Skip best sellers to simplify - only keyword search path for now
    if (false && (scrapeMode === 'best_sellers_first' || scrapeMode === 'best_sellers_only') && bestSellersCategories.length > 0) {
      log(`\n========== BEST SELLERS PHASE ==========`);
      log(`Scraping ${bestSellersCategories.length} Best Sellers categories`);

      for (const category of bestSellersCategories) {
        // Check if category is relevant to active product types
        const isRelevant = activeProductTypes.some(t =>
          category.format === 'all' ||
          category.format === t ||
          category.name.toLowerCase().includes(t.toLowerCase())
        );

        if (!isRelevant) {
          log(`Skipping ${category.name} (not relevant to active types)`);
          continue;
        }

        // Update job progress
        await updateJobProgress(job.id, {
          current_keyword: 'Best Sellers',
          current_product_type: category.name,
          products_scraped: totalProductsScraped,
          reviews_scraped: totalReviewsScraped
        });

        try {
          // Use first keyword for BS products (for association)
          const bsKeyword = keywords[0]?.keyword || 'supplements';
          const bsProducts = await scrapeBestSellers(browser, category, bsKeyword);

          if (bsProducts.length > 0) {
            await saveProducts(bsProducts);
            totalProductsScraped += bsProducts.length;
            log(`Saved ${bsProducts.length} products from Best Sellers: ${category.name}`, 'success');

            // Deep scrape top N Best Sellers products
            const deepScrapeN = parseInt(scoutConfig.deep_scrape_top_n || 10);
            const topBsProducts = bsProducts.slice(0, deepScrapeN);

            for (const product of topBsProducts) {
              log(`  Deep scraping BS product: ${product.asin}`);
              const details = await scrapeProductPage(page, product.asin, bsKeyword, product.product_type);
              if (details) {
                await updateProductWithDetails(product.asin, bsKeyword, details, product.price);
                await saveProductDetails(product.asin, bsKeyword, details, product.product_type);
                // V2.8: Save full data to dovive_research
                await saveToResearch(product, details, 'best_sellers');
              }

              // Scrape reviews for top Best Sellers
              const maxReviews = parseInt(scoutConfig.max_reviews_per_product || 100);
              const reviews = await scrapeReviews(page, product.asin, bsKeyword, maxReviews);
              if (reviews.length > 0) {
                await saveReviews(product.asin, bsKeyword, reviews);
                totalReviewsScraped += reviews.length;
              }

              await sleep(randomDelay(2000, 3000));
            }
          }
        } catch (err) {
          log(`Best Sellers scrape error for ${category.name}: ${err.message}`, 'error');
        }

        // Delay between categories
        await sleep(randomDelay(3000, 5000));
      }

      log(`\n========== BEST SELLERS PHASE COMPLETE ==========`);
      log(`Total products from Best Sellers: ${totalProductsScraped}`);
    }

    // ============================================================
    // PHASE 2: KEYWORD SEARCH SCRAPING (V2.9 simplified)
    // ============================================================
    // V2.9: Simplified flow - search keyword directly, deep scrape top 5
    log(`\n========== KEYWORD SEARCH PHASE ==========`);

    // Process each keyword
    for (const kw of keywords) {
      const keyword = kw.keyword;
      log(`\n========== KEYWORD: ${keyword} ==========`);

      const allProducts = [];
      const typeBreakdown = {};
      const detailsMap = {};

      // Update job progress
      await updateJobProgress(job.id, {
        current_keyword: keyword,
        current_product_type: 'all',
        products_scraped: totalProductsScraped,
        reviews_scraped: totalReviewsScraped
      });

      try {
        // V2.9: Search just the keyword (no product type suffix)
        const products = await scrapeSearchResults(page, keyword, keyword, 'all', 50);
        products.forEach(p => { p.source = 'keyword_search'; });
        log(`Found ${products.length} products for "${keyword}"`);

        if (products.length > 0) {
          // Track for AI summary
          allProducts.push(...products);
          products.forEach(p => {
            typeBreakdown[p.product_type] = (typeBreakdown[p.product_type] || 0) + 1;
          });

          // V2.9: Deep scrape top 5 non-sponsored products
          const TOP_N_DEEP_SCRAPE = 5;
          const topProducts = products.filter(p => !p.is_sponsored).slice(0, TOP_N_DEEP_SCRAPE);
          log(`Deep scraping top ${topProducts.length} non-sponsored products...`);

          for (let i = 0; i < topProducts.length; i++) {
            const product = topProducts[i];
            log(`\nScraping product page: ${product.asin} (#${i + 1} of ${topProducts.length})`);

            // Scrape product page with product type for format-specific extraction
            const details = await scrapeProductPage(page, product.asin, keyword, product.product_type);
            if (details) {
              // Store details for saving later
              detailsMap[product.asin] = details;

              await updateProductWithDetails(product.asin, keyword, details, product.price);
              await saveProductDetails(product.asin, keyword, details, product.product_type);
              // V2.9: Save full data to dovive_research with upsert
              await saveToResearch(product, details, 'keyword_search');

              // Merge details into product for AI summary
              product.bsr = details.bsr;
              product.brand = details.brand;
            }

            // Scrape ALL available reviews (no limit)
            const reviews = isLoggedIn
              ? await scrapeReviewsPage(page, product.asin)
              : await scrapeReviews(page, product.asin, keyword);

            if (reviews.length > 0) {
              // Add asin and keyword to reviews from scrapeReviewsPage (if not already present)
              const enrichedReviews = reviews.map(r => ({
                ...r,
                asin: r.asin || product.asin,
                keyword: r.keyword || keyword,
                sentiment_tags: r.sentiment_tags || tagReviewSentiment(r.title || '', r.body || '')
              }));
              await saveReviews(product.asin, keyword, enrichedReviews);
              totalReviewsScraped += enrichedReviews.length;
            }

            // Update progress
            await updateJobProgress(job.id, {
              products_scraped: totalProductsScraped,
              reviews_scraped: totalReviewsScraped
            });

            // Delay between products
            await sleep(randomDelay(2000, 3000));
          }

          // Save all products to database with details
          await saveProducts(products, detailsMap);
          totalProductsScraped += products.length;
        }

      } catch (err) {
        log(`Error for "${keyword}": ${err.message}`, 'error');
      }

      // Generate AI summary for this keyword (using all products)
      if (allProducts.length > 0) {
        log(`Generating AI summary for "${keyword}" (${allProducts.length} products)...`);

        // Sort by rank for AI summary
        allProducts.sort((a, b) => (a.rank_position || 999) - (b.rank_position || 999));

        const { summary: aiSummary, recommendation } = await generateAISummary(keyword, allProducts, openRouterKey);
        const keyGap = extractKeyGap(aiSummary);

        keywordResults[keyword] = {
          products: allProducts,
          recommendation,
          keyGap,
          typeBreakdown
        };

        // Calculate stats
        const prices = allProducts.filter(p => p.price).map(p => p.price);
        const ratings = allProducts.filter(p => p.rating).map(p => p.rating);
        const reviews = allProducts.filter(p => p.review_count).map(p => p.review_count);

        const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
        const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
        const avgReviews = reviews.length > 0 ? Math.round(reviews.reduce((a, b) => a + b, 0) / reviews.length) : null;

        // Save report - use upsert with on_conflict='keyword' to handle duplicates
        try {
          await sbUpsert('dovive_reports', {
            keyword,
            ai_summary: aiSummary,
            recommendation,
            total_products: allProducts.length,
            avg_price: avgPrice ? parseFloat(avgPrice.toFixed(2)) : null,
            avg_rating: avgRating ? parseFloat(avgRating.toFixed(2)) : null,
            avg_reviews: avgReviews,
            analyzed_at: new Date().toISOString()
          }, 'keyword');
          log(`Saved report for "${keyword}"`, 'success');
        } catch (reportErr) {
          // If recommendation column doesn't exist, retry without it
          if (reportErr.message.includes('recommendation')) {
            log(`Retrying report save without recommendation column`, 'warn');
            await sbUpsert('dovive_reports', {
              keyword,
              ai_summary: aiSummary,
              total_products: allProducts.length,
              avg_price: avgPrice ? parseFloat(avgPrice.toFixed(2)) : null,
              avg_rating: avgRating ? parseFloat(avgRating.toFixed(2)) : null,
              avg_reviews: avgReviews,
              analyzed_at: new Date().toISOString()
            }, 'keyword');
            log(`Saved report for "${keyword}" (without recommendation)`, 'success');
          } else {
            throw reportErr;
          }
        }
      }

      // Delay before next keyword
      await sleep(randomDelay(3000, 5000));
    } // End of keyword loop

    // Mark job complete
    const completedAt = new Date().toISOString();
    await sbUpdate('dovive_jobs', `id=eq.${job.id}`, {
      status: 'complete',
      completed_at: completedAt,
      products_scraped: totalProductsScraped,
      reviews_scraped: totalReviewsScraped,
      updated_at: completedAt
    });

    log(`\n========== JOB COMPLETE ==========`);
    log(`Total products scraped: ${totalProductsScraped}`);
    log(`Total reviews scraped: ${totalReviewsScraped}`, 'success');

    // Send Telegram summary
    if (Object.keys(keywordResults).length > 0) {
      const today = new Date().toISOString().split('T')[0];
      const reportMsg = buildTelegramReport(today, keywordResults);
      await sendTelegram(reportMsg);
    }

  } catch (err) {
    log(`Job failed: ${err.message}`, 'error');

    await sbUpdate('dovive_jobs', `id=eq.${job.id}`, {
      status: 'error',
      error_message: err.message,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    await sendTelegram(`❌ Scout V2.9 Job Failed: ${err.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// ============================================================
// POLLING & MAIN
// ============================================================
async function pollForJobs() {
  try {
    const jobs = await sbFetch('dovive_jobs', {
      filter: 'status=eq.queued',
      order: 'created_at.asc',
      limit: 1
    });

    if (jobs && jobs.length > 0) {
      await runScout(jobs[0]);
    }
  } catch (err) {
    log(`Poll error: ${err.message}`, 'error');
  }
}

function validateConfig() {
  const required = [
    ['SUPABASE_URL', SUPABASE_URL],
    ['SUPABASE_KEY', SUPABASE_KEY]
  ];

  const missing = required.filter(([name, val]) => !val).map(([name]) => name);

  if (missing.length > 0) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    console.error('   Set these in scout/.env or parent .env file');
    process.exit(1);
  }

  const optional = [
    ['OPENCLAW_GATEWAY', OPENCLAW_GATEWAY],
    ['OPENCLAW_TOKEN', OPENCLAW_TOKEN],
    ['TELEGRAM_CHAT_ID', TELEGRAM_CHAT_ID]
  ];

  const missingOptional = optional.filter(([name, val]) => !val).map(([name]) => name);
  if (missingOptional.length > 0) {
    log(`Optional env vars not set (Telegram disabled): ${missingOptional.join(', ')}`, 'warn');
  }
}

async function main() {
  console.log('');
  console.log('🔭 DOVIVE SCOUT AGENT V2.9');
  console.log('═══════════════════════════════════════');
  console.log('   Keyword Search + Deep Product Scrape');
  console.log('═══════════════════════════════════════');
  console.log('');

  validateConfig();

  // Fetch Scout config from Supabase
  await fetchScoutConfig();

  log(`Supabase: ${SUPABASE_URL}`);
  log(`Poll interval: ${POLL_INTERVAL / 1000}s`);
  log(`Scrape mode: ${scoutConfig.scrape_mode}`);
  log(`Active types: ${(scoutConfig.product_types_active || PRIORITY_TYPES).join(', ')}`);
  log(`Best Sellers categories: ${(scoutConfig.best_sellers_categories || []).length}`);
  log(`Product types: ${PRODUCT_TYPES.length} (${PRIORITY_TYPES.length} priority)`);
  log(`Priority limits: ${PRIORITY_LIMITS.maxProductsPerSearch} products, ${PRIORITY_LIMITS.maxDeepScrapePerType} deep, ${PRIORITY_LIMITS.maxReviewsPerProduct} reviews`);
  log(`Standard limits: ${STANDARD_LIMITS.maxProductsPerSearch} products, ${STANDARD_LIMITS.maxDeepScrapePerType} deep, ${STANDARD_LIMITS.maxReviewsPerProduct} reviews`);
  log(`Telegram: ${TELEGRAM_CHAT_ID ? 'Enabled' : 'Disabled'}`);

  const runOnce = process.argv.includes('--once');

  if (runOnce) {
    log('Running in single-shot mode');

    const [job] = await sbInsert('dovive_jobs', {
      status: 'queued',
      triggered_by: 'cli'
    });

    if (job) {
      await runScout(job);
    }

    log('Done.');
    process.exit(0);
  }

  // Continuous polling mode
  log('Starting continuous polling...');
  console.log('');

  while (true) {
    await pollForJobs();
    await sleep(POLL_INTERVAL);
    process.stdout.write('.');
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  log('Received SIGINT, shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('Received SIGTERM, shutting down...');
  process.exit(0);
});

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
