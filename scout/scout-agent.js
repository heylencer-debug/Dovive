/**
 * Dovive Scout Agent
 * Amazon Market Research Scraper + AI Analysis + Telegram Reports
 *
 * Run with: node start.js (keeps running and polling)
 * Or once: node scout-agent.js --once
 */

require('dotenv').config();
const { chromium } = require('playwright');
const fetch = require('node-fetch');

// Config - loaded from environment (no hardcoding)
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
const MAX_PRODUCTS_TO_SCRAPE = 20;
const TOP_N_FOR_BSR = 5;

// Random delay helper
function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Sleep helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Log with timestamp
function log(msg, level = 'info') {
  const ts = new Date().toISOString();
  const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : level === 'success' ? '✅' : '📝';
  console.log(`[${ts}] ${prefix} ${msg}`);
}

// Supabase helpers
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

async function sbUpsert(table, data, onConflict) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': `return=representation,resolution=merge-duplicates`
    },
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

// Get OpenRouter API key from app_settings
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

// Send Telegram message via OpenClaw Gateway
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

// Generate AI market summary for a keyword
async function generateAISummary(keyword, products, openRouterKey) {
  if (!openRouterKey) {
    return {
      summary: 'AI summary unavailable - OpenRouter key not configured',
      recommendation: 'MONITOR'
    };
  }

  const top10 = products.slice(0, 10);
  const productList = top10.map((p, i) =>
    `${i + 1}. "${p.title}" - $${p.price || 'N/A'} - ${p.rating || 'N/A'}★ - ${(p.review_count || 0).toLocaleString()} reviews - BSR: ${p.bsr ? p.bsr.toLocaleString() : 'N/A'}${p.is_sponsored ? ' [SPONSORED]' : ''}`
  ).join('\n');

  const prompt = `You are Scout, a market research analyst for Dovive, a supplement brand launching on Amazon US.

You just scraped Amazon for '${keyword}'. Here is the data:
${productList}

Write a market research summary covering:
1. MARKET SIZE SIGNAL: How competitive is this market? (review counts, number of high-BSR products)
2. PRICE OPPORTUNITY: What price range dominates? Is there a gap at premium or budget tier?
3. MARKET GAP: What do top products seem to be missing? (based on titles and positioning)
4. ENTRY RECOMMENDATION: Should Dovive enter this market? ENTER / MONITOR / AVOID — with 1-sentence reason
5. TOP COMPETITOR: Which single product would be Dovive's main competition and why?

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
        max_tokens: 1200
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

// Scrape Amazon search results for a keyword
async function scrapeKeyword(page, keyword) {
  log(`Scraping: "${keyword}"`);

  const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(keyword)}&ref=nb_sb_noss`;

  try {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(randomDelay(SCRAPE_DELAY_MIN, SCRAPE_DELAY_MAX));

    // Wait for results to load
    await page.waitForSelector('[data-asin]', { timeout: 15000 }).catch(() => {
      log('No data-asin elements found, may be captcha or empty results', 'warn');
    });

    // Screenshot for debugging (optional)
    // await page.screenshot({ path: `debug-${keyword.replace(/\s+/g, '-')}.png` });

    // Get search results
    const results = await page.evaluate((maxProducts) => {
      const items = [];
      const resultDivs = document.querySelectorAll('[data-asin]:not([data-asin=""])');

      let rank = 0;
      resultDivs.forEach((div) => {
        if (rank >= maxProducts) return;

        const asin = div.getAttribute('data-asin');
        if (!asin || asin.length !== 10) return;

        // Check if sponsored
        const sponsoredEl = div.querySelector('[data-component-type="sp-sponsored-result"]') ||
                          div.querySelector('.s-label-popover-default') ||
                          div.textContent.includes('Sponsored');
        const is_sponsored = !!sponsoredEl;

        // Title
        const titleEl = div.querySelector('h2 a span') || div.querySelector('h2 span');
        const title = titleEl?.textContent?.trim() || '';
        if (!title) return;

        // Price - handle various price formats
        const priceWhole = div.querySelector('.a-price-whole')?.textContent?.replace(/[,.\s]/g, '') || '';
        const priceFraction = div.querySelector('.a-price-fraction')?.textContent || '00';
        const price = priceWhole ? parseFloat(`${priceWhole}.${priceFraction}`) : null;

        // Rating
        const ratingEl = div.querySelector('i.a-icon-star-small span.a-icon-alt') ||
                        div.querySelector('i.a-icon-star span.a-icon-alt') ||
                        div.querySelector('.a-icon-alt');
        const ratingText = ratingEl?.textContent || '';
        const ratingMatch = ratingText.match(/(\d+\.?\d*)\s*out\s*of\s*5/i);
        const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

        // Reviews count
        const reviewEl = div.querySelector('span.a-size-base.s-underline-text') ||
                        div.querySelector('[aria-label*="rating"]')?.parentElement?.querySelector('span:last-child') ||
                        div.querySelector('.a-size-small .a-link-normal');
        let reviewText = reviewEl?.textContent?.replace(/[,\s]/g, '') || '0';
        const review_count = parseInt(reviewText) || null;

        rank++;
        items.push({
          asin,
          title: title.slice(0, 500),
          price,
          rating,
          review_count,
          rank_position: rank,
          is_sponsored
        });
      });

      return items;
    }, MAX_PRODUCTS_TO_SCRAPE);

    log(`  Found ${results.length} products (${results.filter(r => r.is_sponsored).length} sponsored)`);

    // Get BSR and brand for top N non-sponsored products
    const nonSponsored = results.filter(r => !r.is_sponsored);
    const topProducts = nonSponsored.slice(0, TOP_N_FOR_BSR);

    for (let i = 0; i < topProducts.length; i++) {
      const product = topProducts[i];
      log(`  Fetching details for #${i + 1}: ${product.asin}`);

      try {
        const productUrl = `https://www.amazon.com/dp/${product.asin}`;
        await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await sleep(randomDelay(PRODUCT_PAGE_DELAY_MIN, PRODUCT_PAGE_DELAY_MAX));

        const details = await page.evaluate(() => {
          let bsr = null;
          let brand = null;
          let category = null;

          // BSR - multiple locations
          const detailsText = document.body.innerText;
          const bsrMatch = detailsText.match(/Best\s*Sellers\s*Rank[:\s#]*(\d[\d,]*)/i);
          if (bsrMatch) {
            bsr = parseInt(bsrMatch[1].replace(/,/g, ''));
          }

          if (!bsr) {
            const bsrEl = document.querySelector('#SalesRank') ||
                         document.querySelector('[data-feature-name="salesRank"]') ||
                         document.querySelector('#detailBulletsWrapper_feature_div');
            if (bsrEl) {
              const match = bsrEl.textContent.match(/#?([\d,]+)/);
              if (match) bsr = parseInt(match[1].replace(/,/g, ''));
            }
          }

          // Brand
          const brandEl = document.querySelector('#bylineInfo') ||
                         document.querySelector('.po-brand .a-span9') ||
                         document.querySelector('a#bylineInfo');
          if (brandEl) {
            brand = brandEl.textContent.replace(/^(Brand|Visit the|Store)[:.\s]*/i, '').trim();
          }

          // Category from breadcrumb
          const categoryEl = document.querySelector('#wayfinding-breadcrumbs_feature_div ul li:last-child a') ||
                            document.querySelector('.a-breadcrumb li:last-child a');
          if (categoryEl) {
            category = categoryEl.textContent.trim();
          }

          return { bsr, brand, category };
        });

        // Update product with details
        const idx = results.findIndex(r => r.asin === product.asin);
        if (idx >= 0) {
          if (details.bsr) results[idx].bsr = details.bsr;
          if (details.brand) results[idx].brand = details.brand;
          if (details.category) results[idx].category = details.category;
          if (details.bsr) log(`    BSR: ${details.bsr.toLocaleString()}`);
        }
      } catch (err) {
        log(`    Failed to get details: ${err.message}`, 'warn');
      }
    }

    return results;
  } catch (err) {
    log(`  Scrape failed: ${err.message}`, 'error');
    return [];
  }
}

// Build Telegram report message
function buildTelegramReport(date, keywordResults) {
  let msg = `⚗️ SCOUT REPORT — ${date}\n\n`;

  for (const [keyword, data] of Object.entries(keywordResults)) {
    const { products, recommendation, keyGap } = data;
    const topProduct = products.find(p => !p.is_sponsored) || products[0];

    msg += `📦 ${keyword.toUpperCase()}\n`;
    if (topProduct) {
      msg += `• Top: ${topProduct.title.slice(0, 50)}... ($${topProduct.price || 'N/A'}, ${topProduct.rating || 'N/A'}★, ${(topProduct.review_count || 0).toLocaleString()} reviews)\n`;
    }
    msg += `• Entry: ${recommendation}\n`;
    if (keyGap) {
      msg += `• Gap: ${keyGap.slice(0, 80)}\n`;
    }
    msg += '\n';
  }

  msg += `Full report: https://heylencer-debug.github.io/Dovive`;
  return msg;
}

// Extract key gap from AI summary
function extractKeyGap(summary) {
  const gapMatch = summary.match(/MARKET GAP[:\s]*([^\n]+)/i);
  if (gapMatch) return gapMatch[1].trim();

  const missingMatch = summary.match(/missing[:\s]*([^\n.]+)/i);
  if (missingMatch) return missingMatch[1].trim();

  return null;
}

// Process a queued job
async function processJob(job) {
  log(`Processing job ${job.id} (triggered by: ${job.triggered_by || 'unknown'})`);

  const startedAt = new Date().toISOString();

  // Update job to running
  await sbUpdate('dovive_jobs', `id=eq.${job.id}`, {
    status: 'running',
    started_at: startedAt,
    updated_at: startedAt
  });

  let browser;
  const keywordResults = {};

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

    // Launch browser (visible so Carlo can watch)
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

    // Get OpenRouter key for AI summaries
    const openRouterKey = await getOpenRouterKey();

    // Scrape each keyword
    for (const kw of keywords) {
      try {
        const products = await scrapeKeyword(page, kw.keyword);

        if (products.length > 0) {
          // Save research data (upsert on asin+keyword)
          for (const product of products) {
            try {
              await sbInsert('dovive_research', {
                keyword: kw.keyword,
                asin: product.asin,
                title: product.title,
                price: product.price,
                rating: product.rating,
                review_count: product.review_count,
                rank_position: product.rank_position,
                bsr: product.bsr || null,
                brand: product.brand || null,
                category: product.category || null,
                is_sponsored: product.is_sponsored || false,
                scraped_at: new Date().toISOString()
              });
            } catch (err) {
              // Likely duplicate, log and continue
              if (!err.message.includes('duplicate')) {
                log(`Failed to save product ${product.asin}: ${err.message}`, 'warn');
              }
            }
          }

          // Generate AI summary
          log(`  Generating AI summary...`);
          const { summary: aiSummary, recommendation } = await generateAISummary(kw.keyword, products, openRouterKey);
          const keyGap = extractKeyGap(aiSummary);

          // Store for Telegram report
          keywordResults[kw.keyword] = { products, recommendation, keyGap };

          // Calculate stats
          const prices = products.filter(p => p.price).map(p => p.price);
          const ratings = products.filter(p => p.rating).map(p => p.rating);
          const reviews = products.filter(p => p.review_count).map(p => p.review_count);

          const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
          const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
          const avgReviews = reviews.length > 0 ? Math.round(reviews.reduce((a, b) => a + b, 0) / reviews.length) : null;

          // Save report
          await sbInsert('dovive_reports', {
            keyword: kw.keyword,
            ai_summary: aiSummary,
            recommendation,
            total_products: products.length,
            avg_price: avgPrice ? parseFloat(avgPrice.toFixed(2)) : null,
            avg_rating: avgRating ? parseFloat(avgRating.toFixed(2)) : null,
            avg_reviews: avgReviews,
            analyzed_at: new Date().toISOString()
          });

          log(`  Saved ${products.length} products and report`, 'success');
        }

        // Delay before next keyword
        await sleep(randomDelay(SCRAPE_DELAY_MIN, SCRAPE_DELAY_MAX));
      } catch (err) {
        log(`Failed for "${kw.keyword}": ${err.message}`, 'error');

        // Send error alert to Telegram
        await sendTelegram(`⚠️ Scout Error on "${kw.keyword}": ${err.message}`);

        // Continue to next keyword
      }
    }

    // Mark job complete
    const completedAt = new Date().toISOString();
    await sbUpdate('dovive_jobs', `id=eq.${job.id}`, {
      status: 'complete',
      completed_at: completedAt,
      updated_at: completedAt
    });

    log('Job completed successfully', 'success');

    // Send Telegram summary report
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

    // Send error alert to Telegram
    await sendTelegram(`❌ Scout Job Failed: ${err.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Poll for queued jobs
async function pollForJobs() {
  try {
    const jobs = await sbFetch('dovive_jobs', {
      filter: 'status=eq.queued',
      order: 'created_at.asc',
      limit: 1
    });

    if (jobs && jobs.length > 0) {
      await processJob(jobs[0]);
    }
  } catch (err) {
    log(`Poll error: ${err.message}`, 'error');
  }
}

// Validate config
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

// Main
async function main() {
  console.log('');
  console.log('🔭 DOVIVE SCOUT AGENT');
  console.log('═══════════════════════════════════════');
  console.log('');

  validateConfig();

  log(`Supabase: ${SUPABASE_URL}`);
  log(`Poll interval: ${POLL_INTERVAL / 1000}s`);
  log(`Telegram: ${TELEGRAM_CHAT_ID ? 'Enabled' : 'Disabled'}`);

  const runOnce = process.argv.includes('--once');

  if (runOnce) {
    log('Running in single-shot mode');

    // Create a job and process it
    const [job] = await sbInsert('dovive_jobs', {
      status: 'queued',
      triggered_by: 'cli'
    });

    if (job) {
      await processJob(job);
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
