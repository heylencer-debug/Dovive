/**
 * Dovive Scout Agent V2.4
 * Amazon Market Research Scraper + AI Analysis + Telegram Reports
 *
 * Features:
 * - Best Sellers scraping (true sales-ranked top 100 per category)
 * - Config-driven scrape modes (best_sellers_first, keyword_only, best_sellers_only)
 * - Product type categorization (20 types)
 * - Full review scraping (up to 200 per product)
 * - Deep ASIN data (images, specs, features, ingredients, certifications)
 * - Progress tracking
 * - Gummies & Powder specialized extraction (sweetener, base, flavors)
 * - Price per serving calculation
 * - Review sentiment auto-tagging
 *
 * Run with: node start.js (keeps running and polling)
 * Or once: node scout-agent.js --once
 */

require('dotenv').config();
const { chromium } = require('playwright');
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
const SCRAPE_DELAY_MIN = 2000;
const SCRAPE_DELAY_MAX = 3000;
const PRODUCT_PAGE_DELAY_MIN = 2500;
const PRODUCT_PAGE_DELAY_MAX = 3500;

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

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
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
    const res = await fetch(`${OPENCLAW_GATEWAY}/message/send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENCLAW_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        channel: 'telegram',
        to: TELEGRAM_CHAT_ID,
        message
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

      // Wait for results
      await page.waitForSelector('[data-asin]', { timeout: 15000 }).catch(() => {
        log(`No results on page ${pageNum}`, 'warn');
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

          // Price
          const priceWhole = div.querySelector('.a-price-whole')?.textContent?.replace(/[,.\s]/g, '') || '';
          const priceFraction = div.querySelector('.a-price-fraction')?.textContent || '00';
          const price = priceWhole ? parseFloat(`${priceWhole}.${priceFraction}`) : null;
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
            price,
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

      // Add detected product type and metadata
      for (const p of pageProducts) {
        if (products.length >= maxResults) break;
        p.keyword = keyword;
        p.search_query = searchQuery;
        p.product_type = detectProductType(p.title);
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
 * Scrape product detail page for images, features, and basic specs
 * Now includes format-specific data extraction and price per serving
 */
async function scrapeProductPage(page, asin, keyword, productType) {
  log(`  Scraping product page: ${asin}`);

  try {
    const productUrl = `https://www.amazon.com/dp/${asin}`;
    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(randomDelay(PRODUCT_PAGE_DELAY_MIN, PRODUCT_PAGE_DELAY_MAX));

    const details = await page.evaluate(() => {
      const result = {
        bsr: null,
        bsr_category: null,
        brand: null,
        images: [],
        features: [],
        specs: {},
        ingredients: null,
        certifications: [],
        title: ''
      };

      // Title
      const titleEl = document.querySelector('#productTitle');
      result.title = titleEl?.textContent?.trim() || '';

      // BSR
      const detailsText = document.body.innerText;
      const bsrMatch = detailsText.match(/Best\s*Sellers\s*Rank[:\s#]*(\d[\d,]*)/i);
      if (bsrMatch) {
        result.bsr = parseInt(bsrMatch[1].replace(/,/g, ''));
      }

      // BSR Category
      const bsrCatMatch = detailsText.match(/Best\s*Sellers\s*Rank[:\s#]*[\d,]+\s*in\s*([^\n(]+)/i);
      if (bsrCatMatch) {
        result.bsr_category = bsrCatMatch[1].trim().replace(/\s*\(.*$/, '');
      }

      // Brand
      const brandEl = document.querySelector('#bylineInfo') ||
                     document.querySelector('.po-brand .a-span9') ||
                     document.querySelector('a#bylineInfo');
      if (brandEl) {
        result.brand = brandEl.textContent.replace(/^(Brand|Visit the|Store)[:.\s]*/i, '').trim();
      }

      // Main image
      const mainImg = document.querySelector('#landingImage');
      if (mainImg && mainImg.src) {
        // Convert to high-res version
        let highRes = mainImg.src.replace(/\._AC_S[A-Z]*\d+_/, '._AC_SL1500_');
        result.images.push(highRes);
      }

      // Gallery images
      const altImages = document.querySelectorAll('#altImages img');
      altImages.forEach(img => {
        if (img.src && !img.src.includes('play-button')) {
          let highRes = img.src.replace(/\._AC_S[A-Z]*\d+_/, '._AC_SL1500_');
          if (!result.images.includes(highRes)) {
            result.images.push(highRes);
          }
        }
      });

      // Feature bullets
      const bulletItems = document.querySelectorAll('#feature-bullets ul li span.a-list-item');
      bulletItems.forEach(item => {
        const text = item.textContent?.trim();
        if (text && text.length > 5 && !text.startsWith('Make sure')) {
          result.features.push(text);
        }
      });

      // Product specifications from various tables
      const specTables = [
        '#productDetails_techSpec_section_1 tr',
        '#productDetails_detailBullets_sections1 tr',
        '#detailBullets_feature_div li',
        '.a-section.a-spacing-small.a-padding-small table tr'
      ];

      specTables.forEach(selector => {
        document.querySelectorAll(selector).forEach(row => {
          const key = row.querySelector('th, .a-text-bold')?.textContent?.trim()?.replace(/[:\s]+$/, '');
          const val = row.querySelector('td, .a-list-item:not(.a-text-bold)')?.textContent?.trim();
          if (key && val && val.length < 500) {
            result.specs[key] = val;
          }
        });
      });

      // Try to get ingredients/supplement facts
      const ingredientKeywords = ['Supplement Facts', 'Ingredients:', 'Other Ingredients:', 'Active Ingredients'];
      const allText = document.body.innerText;
      for (const kw of ingredientKeywords) {
        const idx = allText.indexOf(kw);
        if (idx !== -1) {
          // Extract ~500 chars after keyword
          result.ingredients = allText.slice(idx, idx + 500).replace(/\n+/g, ' ').trim();
          break;
        }
      }

      // Look for certifications/badges
      const certKeywords = ['Certified', 'Non-GMO', 'Organic', 'GMP', 'Third Party Tested',
                           'NSF', 'USP', 'Vegan', 'Gluten Free', 'Kosher', 'Halal',
                           'USDA Organic', 'Made in USA'];
      certKeywords.forEach(cert => {
        if (allText.toLowerCase().includes(cert.toLowerCase())) {
          result.certifications.push(cert);
        }
      });

      return result;
    });

    // Now process format-specific data on the Node.js side
    const specsText = Object.values(details.specs || {}).join(' ');
    const bulletPoints = details.features || [];
    const ingredientsText = details.ingredients || '';
    const title = details.title || '';

    // Calculate price per serving
    details.price_per_serving = null;
    details.serving_count = extractServingCountFromSpecs(specsText, bulletPoints);

    // Extract format-specific data
    details.format_data = {};
    details.gummies_data = null;
    details.powder_data = null;

    if (productType === 'Gummies') {
      details.gummies_data = extractGummiesData(title, bulletPoints, specsText, ingredientsText);
      details.format_data = details.gummies_data;
    } else if (productType === 'Powder') {
      details.powder_data = extractPowderData(title, bulletPoints, specsText, ingredientsText);
      details.format_data = details.powder_data;
    }

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
async function scrapeReviews(page, asin, keyword, maxReviews = 200) {
  log(`  Scraping reviews for: ${asin} (max: ${maxReviews})`);

  const reviews = [];
  let pageNum = 1;

  while (reviews.length < maxReviews) {
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
        if (reviews.length >= maxReviews) break;
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

      if (!hasNextPage || reviews.length >= maxReviews) {
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

// ============================================================
// DATABASE SAVE FUNCTIONS
// ============================================================

/**
 * Save products to dovive_products (upsert)
 * Now includes price_per_serving, serving_count, and format_data
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
 * Save reviews to dovive_reviews
 * Now includes sentiment_tags
 */
async function saveReviews(asin, keyword, reviews) {
  if (!reviews || reviews.length === 0) return;

  let saved = 0;
  for (const r of reviews) {
    try {
      await sbInsert('dovive_reviews', {
        asin,
        keyword,
        reviewer_name: r.reviewer_name,
        rating: r.rating,
        title: r.title,
        body: r.body,
        review_date: r.review_date,
        verified_purchase: r.verified_purchase,
        helpful_votes: r.helpful_votes,
        sentiment_tags: r.sentiment_tags || [],
        scraped_at: new Date().toISOString()
      });
      saved++;
    } catch (err) {
      // Likely duplicates, continue
    }
  }

  log(`  Saved ${saved}/${reviews.length} reviews for ${asin}`, 'success');
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
  let msg = `⚗️ SCOUT V2.1 REPORT — ${date}\n\n`;

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
      log('No active keywords to scrape');
      await sbUpdate('dovive_jobs', `id=eq.${job.id}`, {
        status: 'complete',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      return;
    }

    log(`Keywords to scrape: ${keywords.length}`);
    log(`Product types per keyword: ${PRODUCT_TYPES.length}`);
    log(`Priority types: ${PRIORITY_TYPES.join(', ')}`);
    log(`Total search combinations: ${keywords.length * PRODUCT_TYPES.length}`);

    // Launch browser
    browser = await chromium.launch({
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      locale: 'en-US'
    });

    const page = await context.newPage();
    const openRouterKey = await getOpenRouterKey();

    // Process each keyword
    for (const kw of keywords) {
      const keyword = kw.keyword;
      log(`\n========== KEYWORD: ${keyword} ==========`);

      const allProducts = [];
      const typeBreakdown = {};
      const detailsMap = {};

      // Process each product type (priority types first)
      for (let i = 0; i < PRODUCT_TYPES.length; i++) {
        const productType = PRODUCT_TYPES[i];
        const searchQuery = `${keyword} ${productType}`;
        const limits = getLimitsForType(productType);
        const isPriority = isPriorityType(productType);

        log(`\n--- ${isPriority ? '⭐ PRIORITY' : 'STANDARD'}: ${productType} ---`);
        log(`  Limits: ${limits.maxProductsPerSearch} products, ${limits.maxDeepScrapePerType} deep, ${limits.maxReviewsPerProduct} reviews`);

        // Update job progress
        await updateJobProgress(job.id, {
          current_keyword: keyword,
          current_product_type: productType,
          products_scraped: totalProductsScraped,
          reviews_scraped: totalReviewsScraped
        });

        try {
          // Scrape search results with type-specific limits
          const products = await scrapeSearchResults(page, searchQuery, keyword, productType, limits.maxProductsPerSearch);

          if (products.length > 0) {
            // Track for AI summary
            allProducts.push(...products);
            products.forEach(p => {
              typeBreakdown[p.product_type] = (typeBreakdown[p.product_type] || 0) + 1;
            });

            // Deep scrape top N products per type
            const topProducts = products.filter(p => !p.is_sponsored).slice(0, limits.maxDeepScrapePerType);

            for (const product of topProducts) {
              log(`  Deep scraping: ${product.asin}`);

              // Scrape product page with product type for format-specific extraction
              const details = await scrapeProductPage(page, product.asin, keyword, product.product_type);
              if (details) {
                // Store details for saving later
                detailsMap[product.asin] = details;

                await updateProductWithDetails(product.asin, keyword, details, product.price);
                await saveProductDetails(product.asin, keyword, details, product.product_type);

                // Merge details into product for AI summary
                product.bsr = details.bsr;
                product.brand = details.brand;
              }

              // Scrape reviews with type-specific limits
              const reviews = await scrapeReviews(page, product.asin, keyword, limits.maxReviewsPerProduct);
              if (reviews.length > 0) {
                await saveReviews(product.asin, keyword, reviews);
                totalReviewsScraped += reviews.length;
              }

              // Update progress
              await updateJobProgress(job.id, {
                products_scraped: totalProductsScraped,
                reviews_scraped: totalReviewsScraped
              });

              // Delay between products
              await sleep(randomDelay(2000, 3000));
            }

            // Save products to database with details
            await saveProducts(products, detailsMap);
            totalProductsScraped += products.length;
          }

          // Delay between product types
          await sleep(randomDelay(SCRAPE_DELAY_MIN, SCRAPE_DELAY_MAX));

        } catch (err) {
          log(`Error for "${searchQuery}": ${err.message}`, 'error');
          continue;
        }
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

        // Save report
        await sbInsert('dovive_reports', {
          keyword,
          ai_summary: aiSummary,
          recommendation,
          total_products: allProducts.length,
          avg_price: avgPrice ? parseFloat(avgPrice.toFixed(2)) : null,
          avg_rating: avgRating ? parseFloat(avgRating.toFixed(2)) : null,
          avg_reviews: avgReviews,
          analyzed_at: new Date().toISOString()
        });

        log(`Saved report for "${keyword}"`, 'success');
      }

      // Delay before next keyword
      await sleep(randomDelay(3000, 5000));
    }

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

    await sendTelegram(`❌ Scout V2.1 Job Failed: ${err.message}`);
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
  console.log('🔭 DOVIVE SCOUT AGENT V2.1');
  console.log('═══════════════════════════════════════');
  console.log('   Gummies + Powder Intelligence');
  console.log('═══════════════════════════════════════');
  console.log('');

  validateConfig();

  log(`Supabase: ${SUPABASE_URL}`);
  log(`Poll interval: ${POLL_INTERVAL / 1000}s`);
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
