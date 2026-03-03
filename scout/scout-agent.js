/**
 * Dovive Scout Agent
 * Amazon Market Research Scraper + AI Analysis
 *
 * Run with: node scout-agent.js
 * Or once: node scout-agent.js --once
 */

require('dotenv').config();
const { chromium } = require('playwright');
const fetch = require('node-fetch');

// Config
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fhfqjcvwcxizbioftvdw.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const POLL_INTERVAL = 30000; // 30 seconds
const SCRAPE_DELAY = 2500; // 2.5 seconds between requests
const PRODUCT_PAGE_DELAY = 3000; // 3 seconds between product page visits

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

// Sleep helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
    console.warn('OpenRouter key not found in app_settings');
    return null;
  } catch (err) {
    console.error('Failed to get OpenRouter key:', err);
    return null;
  }
}

// Generate AI market summary
async function generateAISummary(keyword, products, openRouterKey) {
  if (!openRouterKey) {
    return 'AI summary unavailable - OpenRouter key not configured';
  }

  const productSummary = products.slice(0, 10).map((p, i) =>
    `${i + 1}. ${p.title} - $${p.price || 'N/A'} - ${p.rating || 'N/A'} stars - ${p.review_count || 'N/A'} reviews - BSR: ${p.bsr || 'N/A'}`
  ).join('\n');

  const prompt = `Analyze this Amazon supplement market data for "${keyword}". Identify:
1. Market gaps and opportunities
2. Pricing strategies (what price points are underserved?)
3. Common product weaknesses based on the data
4. Potential differentiators for a new entrant

Products:
${productSummary}

Provide a concise, actionable summary (under 500 words) with specific insights.`;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://heylencer-debug.github.io/Dovive'
      },
      body: JSON.stringify({
        model: 'anthropic/claude-opus-4-5',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1000
      })
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('OpenRouter error:', text);
      return 'AI summary generation failed';
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || 'No summary generated';
  } catch (err) {
    console.error('AI summary error:', err);
    return 'AI summary generation failed: ' + err.message;
  }
}

// Scrape Amazon search results
async function scrapeKeyword(page, keyword) {
  console.log(`\n🔍 Scraping: "${keyword}"`);

  const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(keyword)}`;

  try {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(SCRAPE_DELAY);

    // Wait for results to load
    await page.waitForSelector('[data-asin]', { timeout: 10000 }).catch(() => {});

    // Get search results
    const results = await page.evaluate(() => {
      const items = [];
      const resultDivs = document.querySelectorAll('[data-asin]:not([data-asin=""])');

      let rank = 0;
      resultDivs.forEach((div) => {
        if (rank >= 20) return;

        const asin = div.getAttribute('data-asin');
        if (!asin || asin.length !== 10) return;

        // Title
        const titleEl = div.querySelector('h2 a span') || div.querySelector('h2 span');
        const title = titleEl?.textContent?.trim() || '';
        if (!title) return;

        // Price
        const priceWhole = div.querySelector('.a-price-whole')?.textContent?.replace(',', '') || '';
        const priceFraction = div.querySelector('.a-price-fraction')?.textContent || '00';
        const price = priceWhole ? parseFloat(`${priceWhole}.${priceFraction}`) : null;

        // Rating
        const ratingEl = div.querySelector('.a-icon-alt');
        const ratingText = ratingEl?.textContent || '';
        const ratingMatch = ratingText.match(/(\d+\.?\d*)\s*out\s*of\s*5/i);
        const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

        // Reviews
        const reviewEl = div.querySelector('span[aria-label*="star"]')?.closest('div')?.querySelector('span:last-child') ||
                        div.querySelector('.a-size-small .a-link-normal');
        const reviewText = reviewEl?.textContent?.replace(/[,\s]/g, '') || '0';
        const review_count = parseInt(reviewText) || null;

        rank++;
        items.push({
          asin,
          title: title.slice(0, 500),
          price,
          rating,
          review_count,
          rank_position: rank
        });
      });

      return items;
    });

    console.log(`  Found ${results.length} products`);

    // Get BSR for top 5 products
    const topProducts = results.slice(0, 5);
    for (let i = 0; i < topProducts.length; i++) {
      const product = topProducts[i];
      console.log(`  Fetching BSR for #${i + 1}: ${product.asin}`);

      try {
        const productUrl = `https://www.amazon.com/dp/${product.asin}`;
        await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(PRODUCT_PAGE_DELAY);

        const bsr = await page.evaluate(() => {
          // Look for BSR in product details
          const detailsText = document.body.innerText;
          const bsrMatch = detailsText.match(/Best\s*Sellers\s*Rank[:\s#]*(\d[\d,]*)/i);
          if (bsrMatch) {
            return parseInt(bsrMatch[1].replace(/,/g, ''));
          }

          // Try alternative location
          const bsrEl = document.querySelector('#SalesRank') ||
                       document.querySelector('[data-feature-name="salesRank"]');
          if (bsrEl) {
            const match = bsrEl.textContent.match(/#?([\d,]+)/);
            return match ? parseInt(match[1].replace(/,/g, '')) : null;
          }

          return null;
        });

        if (bsr) {
          product.bsr = bsr;
          console.log(`    BSR: ${bsr.toLocaleString()}`);
        }
      } catch (err) {
        console.warn(`    Failed to get BSR: ${err.message}`);
      }
    }

    return results;
  } catch (err) {
    console.error(`  Scrape failed: ${err.message}`);
    return [];
  }
}

// Process a queued job
async function processJob(job) {
  console.log(`\n⚡ Processing job ${job.id} (triggered by: ${job.triggered_by})`);

  // Update job to running
  await sbUpdate('dovive_jobs', `id=eq.${job.id}`, {
    status: 'running',
    updated_at: new Date().toISOString()
  });

  let browser;

  try {
    // Get active keywords
    const keywords = await sbFetch('dovive_keywords', {
      filter: 'active=eq.true',
      order: 'created_at.asc'
    });

    if (!keywords || keywords.length === 0) {
      console.log('No active keywords to scrape');
      await sbUpdate('dovive_jobs', `id=eq.${job.id}`, {
        status: 'complete',
        updated_at: new Date().toISOString()
      });
      return;
    }

    console.log(`\n📋 Keywords to scrape: ${keywords.length}`);

    // Launch browser (visible so Carlo can watch)
    browser = await chromium.launch({
      headless: false,
      args: ['--disable-blink-features=AutomationControlled']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    // Get OpenRouter key for AI summaries
    const openRouterKey = await getOpenRouterKey();

    // Scrape each keyword
    for (const kw of keywords) {
      try {
        const products = await scrapeKeyword(page, kw.keyword);

        if (products.length > 0) {
          // Save research data
          for (const product of products) {
            await sbInsert('dovive_research', {
              keyword: kw.keyword,
              ...product,
              scraped_at: new Date().toISOString()
            });
          }

          // Generate AI summary
          console.log(`  🤖 Generating AI summary...`);
          const aiSummary = await generateAISummary(kw.keyword, products, openRouterKey);

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
            total_products: products.length,
            avg_price: avgPrice ? parseFloat(avgPrice.toFixed(2)) : null,
            avg_rating: avgRating ? parseFloat(avgRating.toFixed(2)) : null,
            avg_reviews: avgReviews,
            analyzed_at: new Date().toISOString()
          });

          console.log(`  ✅ Saved ${products.length} products and report`);
        }

        // Delay before next keyword
        await sleep(SCRAPE_DELAY);
      } catch (err) {
        console.error(`  ❌ Failed for "${kw.keyword}": ${err.message}`);
        // Continue to next keyword
      }
    }

    // Mark job complete
    await sbUpdate('dovive_jobs', `id=eq.${job.id}`, {
      status: 'complete',
      updated_at: new Date().toISOString()
    });

    console.log('\n✅ Job completed successfully');
  } catch (err) {
    console.error('Job failed:', err);
    await sbUpdate('dovive_jobs', `id=eq.${job.id}`, {
      status: 'error',
      updated_at: new Date().toISOString()
    });
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
    console.error('Poll error:', err);
  }
}

// Main
async function main() {
  console.log('🔭 Dovive Scout Agent');
  console.log('========================');

  if (!SUPABASE_KEY) {
    console.error('❌ SUPABASE_KEY not set in environment');
    process.exit(1);
  }

  console.log(`Supabase URL: ${SUPABASE_URL}`);
  console.log(`Poll interval: ${POLL_INTERVAL / 1000}s`);

  const runOnce = process.argv.includes('--once');

  if (runOnce) {
    console.log('\n🔄 Running in single-shot mode');

    // Create a job and process it
    const [job] = await sbInsert('dovive_jobs', {
      status: 'queued',
      triggered_by: 'cli'
    });

    if (job) {
      await processJob(job);
    }

    console.log('\nDone.');
    process.exit(0);
  }

  // Continuous polling mode
  console.log('\n🔄 Starting continuous polling...');

  while (true) {
    await pollForJobs();
    await sleep(POLL_INTERVAL);
    process.stdout.write('.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
