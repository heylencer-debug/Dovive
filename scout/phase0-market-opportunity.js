/**
 * phase0-market-opportunity.js — Market Opportunity Scanner (Live Amazon + Keepa)
 *
 * Discovers and ranks supplement categories DIRECTLY from Amazon and Keepa —
 * no prior pipeline run needed. Use this to decide which keywords to run next.
 *
 * Sources:
 *   1. Amazon Best Sellers > Vitamins & Dietary Supplements (live subcategories)
 *   2. 25 seed supplement keywords (searched on Amazon)
 *
 * Enrichment:
 *   Keepa API called with collected ASINs → real monthly_revenue, BSR history, rating
 *
 * Scoring (0–100):
 *   40pts — Total category revenue (log-normalized)
 *   20pts — Growth momentum (% rising products vs 30d avg BSR)
 *   15pts — Per-product revenue opportunity (log-normalized)
 *   15pts — Competition gap (% products with BSR > 5000 = less saturated)
 *   10pts — Consumer quality signal (avg rating)
 *
 * Usage:
 *   node phase0-market-opportunity.js
 *   node phase0-market-opportunity.js --top 15
 *   node phase0-market-opportunity.js --top 5 --min-products 3
 *   node phase0-market-opportunity.js --top 10 --headed   (visible browser for debugging)
 */

require('dotenv').config();
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());
const fetch = require('node-fetch');
const fs   = require('fs');
const path = require('path');

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const TOP_N = process.argv.includes('--top')
  ? Math.max(1, parseInt(process.argv[process.argv.indexOf('--top') + 1]) || 10)
  : 10;
const MIN_PRODUCTS = process.argv.includes('--min-products')
  ? Math.max(1, parseInt(process.argv[process.argv.indexOf('--min-products') + 1]) || 5)
  : 5;
const HEADED = process.argv.includes('--headed');
const MAX_PER_CATEGORY = 20;
const COOKIE_FILE = path.join(__dirname, '.amazon-cookies.json');
const OUTPUT_DIR  = path.join(__dirname, 'output');
const KEEPA_DOMAIN = 1; // US

// ─── Seed keyword list ────────────────────────────────────────────────────────

const SEED_KEYWORDS = [
  'melatonin gummies',
  'magnesium gummies',
  'magnesium glycinate',
  'vitamin C gummies',
  'collagen gummies',
  'ashwagandha gummies',
  'elderberry gummies',
  'probiotic gummies',
  'apple cider vinegar gummies',
  'creatine gummies',
  "lion's mane gummies",
  'vitamin D3 gummies',
  'omega-3 gummies',
  'zinc gummies',
  'biotin gummies',
  'turmeric gummies',
  'berberine supplement',
  'electrolyte powder',
  'collagen peptides powder',
  'ashwagandha powder',
  "lion's mane powder",
  'mushroom supplement',
  'sleep supplement gummies',
  'fish oil gummies',
  'multivitamin gummies',
];

// ─── Anti-detection config ────────────────────────────────────────────────────

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
];

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
];

// ─── Utils ────────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pickRandom(arr) { return arr[rand(0, arr.length - 1)]; }

function fmt$(n) {
  if (!n) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`;
  return `$${Math.round(n)}`;
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

// ─── Cookie persistence ───────────────────────────────────────────────────────

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

// ─── CAPTCHA detection ────────────────────────────────────────────────────────

async function isBlocked(page) {
  const title = (await page.title()).toLowerCase();
  const url   = page.url().toLowerCase();
  if (title.includes('robot') || title.includes('captcha') || title.includes('sorry')) return true;
  if (url.includes('captcha') || url.includes('validatecaptcha')) return true;
  const el = await page.$('form[action*="captcha"], #captchacharacters');
  return !!el;
}

// ─── Keepa helpers ────────────────────────────────────────────────────────────

const KEEPA_EPOCH = new Date('2011-01-01T00:00:00Z').getTime();

function keepaPrice(val) {
  if (!val || val < 0) return null;
  return Math.round(val) / 100;
}

function parseCsvArray(arr, limitDays = null) {
  if (!arr || !arr.length) return [];
  const result = [];
  const cutoff = limitDays ? Date.now() - limitDays * 86_400_000 : 0;
  for (let i = 0; i < arr.length - 1; i += 2) {
    const t = arr[i], v = arr[i + 1];
    if (t < 0 || v < 0) continue;
    const ms = KEEPA_EPOCH + t * 60_000;
    if (ms < cutoff) continue;
    result.push({ value: v });
  }
  return result;
}

function countBsrDrops(bsrArr, days) {
  const parsed = parseCsvArray(bsrArr, days);
  let drops = 0;
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i].value < parsed[i - 1].value) drops++;
  }
  return drops;
}

async function getKeepaKey() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('SUPABASE_URL/SUPABASE_KEY not set in .env');
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/dovive_scout_config?config_key=eq.keepa_api_key&select=config_value`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const data = await res.json();
  if (!data.length) throw new Error('Keepa API key not found in dovive_scout_config');
  return data[0].config_value.replace(/"/g, '');
}

async function fetchKeepa(asins, apiKey) {
  const asinParam = Array.isArray(asins) ? asins.join(',') : asins;
  const url = `https://api.keepa.com/product?key=${apiKey}&domain=${KEEPA_DOMAIN}&asin=${asinParam}&stats=180&history=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Keepa API ${res.status}: ${await res.text()}`);
  return res.json();
}

function parseKeepaProduct(p) {
  const stats     = p.stats || {};
  const csv       = p.csv   || [];
  const bsrCsvRaw = csv[3]  || [];

  const currentBsr   = stats.current?.[3] > 0 ? stats.current[3] : null;
  const currentPrice = keepaPrice(stats.current?.[0]) ?? keepaPrice(stats.current?.[1]) ?? keepaPrice(stats.buyBoxPrice);
  const bsrDrops30   = stats.salesRankDrops30 || countBsrDrops(bsrCsvRaw, 30);
  const monthlySales = p.monthlySold > 0 ? p.monthlySold : (bsrDrops30 * 4) || null;
  const monthlyRevenue = (monthlySales && currentPrice) ? Math.round(monthlySales * currentPrice) : null;

  // Rising = current BSR improved >15% vs 30-day average
  const bsr30 = parseCsvArray(bsrCsvRaw, 30);
  const avg30Bsr = bsr30.length ? avg(bsr30.map(r => r.value)) : currentBsr;
  const isRising = !!(currentBsr && avg30Bsr && currentBsr < avg30Bsr * 0.85);

  const rating = p.stats?.avg30?.[16] ? p.stats.avg30[16] / 10 : null;

  return { asin: p.asin, bsr: currentBsr, price: currentPrice, monthlySales, monthlyRevenue, rating, isRising };
}

// ─── Amazon scraping ──────────────────────────────────────────────────────────

async function scrapeKeyword(page, keyword) {
  const url = `https://www.amazon.com/s?k=${encodeURIComponent(keyword)}&ref=nb_sb_noss`;
  console.log(`  → "${keyword}"`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(rand(2500, 4000));

    if (await isBlocked(page)) {
      console.warn(`    ⚠ Blocked/CAPTCHA — skipping`);
      return [];
    }

    await page.waitForSelector('[data-asin]', { timeout: 10000 }).catch(() => {});

    const asins = await page.evaluate((max) => {
      const results = [];
      const divs = document.querySelectorAll('[data-component-type="s-search-result"][data-asin]');
      for (const div of divs) {
        if (results.length >= max) break;
        const asin = div.getAttribute('data-asin');
        if (!asin || asin.length !== 10) continue;
        if (
          div.querySelector('[data-component-type="sp-sponsored-result"]') ||
          div.querySelector('.puis-sponsored-label-text') ||
          div.querySelector('[aria-label="Sponsored"]')
        ) continue;
        results.push(asin);
      }
      return results;
    }, MAX_PER_CATEGORY);

    console.log(`    ✓ ${asins.length} ASINs`);
    return asins;
  } catch (e) {
    console.warn(`    ⚠ Error: ${e.message}`);
    return [];
  }
}

async function scrapeBestSellersSubcategories(page) {
  const url = 'https://www.amazon.com/Best-Sellers-Vitamins-Dietary-Supplements/zgbs/hpc/3760901/';
  console.log('  → Amazon Best Sellers: discovering subcategories...');

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(rand(2500, 4000));

    if (await isBlocked(page)) {
      console.warn('  ⚠ Blocked on Best Sellers page — skipping BSR discovery');
      return [];
    }

    const subcats = await page.evaluate(() => {
      const links = [];
      const els = document.querySelectorAll('#zg-left-col a, .zg-browse-group a');
      for (const el of els) {
        const name = el.textContent.trim();
        const href = el.getAttribute('href') || '';
        if (!name || !href.includes('zgbs')) continue;
        if (name.toLowerCase().includes('see all')) continue;
        links.push({
          name,
          url: href.startsWith('http') ? href : `https://www.amazon.com${href}`,
        });
      }
      return links.slice(0, 12);
    });

    console.log(`    ✓ ${subcats.length} subcategories`);
    return subcats;
  } catch (e) {
    console.warn(`  ⚠ Best Sellers discovery failed: ${e.message}`);
    return [];
  }
}

async function scrapeBestSellersPage(page, catName, catUrl) {
  console.log(`  → BSR page: "${catName}"`);
  try {
    await page.goto(catUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(rand(2000, 3500));

    if (await isBlocked(page)) {
      console.warn(`    ⚠ Blocked — skipping`);
      return [];
    }

    const asins = await page.evaluate((max) => {
      const results = [];
      const items = document.querySelectorAll('.zg-grid-general-faceout, [id^="gridItemRoot"]');
      for (const item of items) {
        if (results.length >= max) break;
        const link = item.querySelector('a.a-link-normal[href*="/dp/"]');
        if (!link) continue;
        const match = link.href.match(/\/dp\/([A-Z0-9]{10})/);
        if (match) results.push(match[1]);
      }
      return results;
    }, MAX_PER_CATEGORY);

    console.log(`    ✓ ${asins.length} ASINs`);
    return asins;
  } catch (e) {
    console.warn(`    ⚠ Error: ${e.message}`);
    return [];
  }
}

// ─── Metrics & scoring ────────────────────────────────────────────────────────

function computeMetrics(keepaResults) {
  const products  = keepaResults.filter(p => p.bsr || p.monthlyRevenue || p.price);
  const total     = products.length;
  const revenues  = products.map(p => p.monthlyRevenue || 0).filter(r => r > 0);
  const bsrs      = products.map(p => p.bsr).filter(Boolean);
  const ratings   = products.map(p => p.rating).filter(Boolean);
  const prices    = products.map(p => p.price).filter(Boolean);

  const totalRevenue      = revenues.reduce((s, r) => s + r, 0);
  const avgRevenue        = revenues.length ? totalRevenue / revenues.length : 0;
  const avgRating         = avg(ratings);
  const medianBsr         = median(bsrs);
  const avgPrice          = avg(prices);
  const risingCount       = products.filter(p => p.isRising).length;
  const growthPct         = total > 0 ? risingCount / total : 0;
  // Competition gap: % of products NOT in the hyper-competitive BSR < 5000 zone
  const lowCompCount      = bsrs.filter(b => b > 5000).length;
  const competitionGapPct = bsrs.length > 0 ? lowCompCount / bsrs.length : 0.5;

  return {
    total, totalRevenue, avgRevenue, avgRating, avgPrice,
    medianBsr, growthPct, risingCount, competitionGapPct,
    keepaCoverage: total > 0 ? Math.round(revenues.length / total * 100) : 0,
    scores: null,
    totalScore: 0,
  };
}

function scoreCategories(allMetrics) {
  const maxTotalRevenue = Math.max(...allMetrics.map(m => m.metrics.totalRevenue), 1);
  const maxAvgRevenue   = Math.max(...allMetrics.map(m => m.metrics.avgRevenue), 1);

  for (const entry of allMetrics) {
    const m = entry.metrics;
    const revScore     = Math.log(m.totalRevenue + 1) / Math.log(maxTotalRevenue + 1) * 40;
    const growthScore  = m.growthPct * 20;
    const perProdScore = Math.log(m.avgRevenue + 1) / Math.log(maxAvgRevenue + 1) * 15;
    const gapScore     = m.competitionGapPct * 15;
    const qualityScore = m.avgRating > 0 ? ((m.avgRating - 1) / 4) * 10 : 5;

    m.scores = {
      rev:      Math.round(revScore     * 10) / 10,
      growth:   Math.round(growthScore  * 10) / 10,
      perProd:  Math.round(perProdScore * 10) / 10,
      gap:      Math.round(gapScore     * 10) / 10,
      quality:  Math.round(qualityScore * 10) / 10,
    };
    m.totalScore = Math.round(revScore + growthScore + perProdScore + gapScore + qualityScore);
  }

  return allMetrics.sort((a, b) => b.metrics.totalScore - a.metrics.totalScore);
}

function buildRationale(m) {
  const parts = [];
  if (m.totalRevenue > 0) {
    parts.push(`${fmt$(m.totalRevenue)}/mo across ${m.total} products`);
    if (m.avgRevenue > 0) parts.push(`avg ${fmt$(m.avgRevenue)}/mo per product`);
  } else {
    parts.push(`${m.total} products (Keepa revenue unavailable)`);
  }
  if (m.medianBsr)    parts.push(`median BSR ${m.medianBsr.toLocaleString()}`);
  if (m.growthPct > 0.2)  parts.push(`strong growth (${Math.round(m.growthPct * 100)}% rising)`);
  else if (m.growthPct > 0) parts.push(`${Math.round(m.growthPct * 100)}% rising`);
  if (m.competitionGapPct > 0.6) parts.push(`low competition density`);
  else if (m.competitionGapPct < 0.3) parts.push(`⚠ saturated market`);
  if (m.avgRating)    parts.push(`avg ${m.avgRating.toFixed(1)}★`);
  if (m.avgPrice)     parts.push(`avg price $${m.avgPrice.toFixed(2)}`);
  if (m.keepaCoverage < 50) parts.push(`⚠ low Keepa coverage (${m.keepaCoverage}%)`);
  return parts.join(' · ');
}

// ─── Markdown output ──────────────────────────────────────────────────────────

function saveOutput(ranked, date) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(OUTPUT_DIR, `${date}-phase0-opportunities.md`);
  const displayCount = Math.min(TOP_N, ranked.length);

  const lines = [
    `# Phase 0 — Market Opportunity Ranking (Live Amazon + Keepa)`,
    `Generated: ${new Date().toISOString()}`,
    `Categories analyzed: ${ranked.length} | Top ${displayCount} shown | Min products: ${MIN_PRODUCTS}`,
    `Sources: Amazon Best Sellers (supplements) + ${SEED_KEYWORDS.length} seed keywords`,
    '',
    '---',
    '',
    '## Ranked Opportunities',
    '',
    '| Rank | Category | Score | Revenue/mo | Avg/Product | BSR Median | Growth% | Competition | Rating |',
    '|------|----------|-------|------------|-------------|------------|---------|-------------|--------|',
  ];

  for (let i = 0; i < displayCount; i++) {
    const { name, metrics: m } = ranked[i];
    const comp = m.competitionGapPct > 0.6 ? 'Low' : m.competitionGapPct < 0.3 ? '⚠ High' : 'Medium';
    lines.push(
      `| #${i + 1} | **${name}** | ${m.totalScore}/100 | ${fmt$(m.totalRevenue)} | ${fmt$(m.avgRevenue)} | ${m.medianBsr ? m.medianBsr.toLocaleString() : '—'} | ${Math.round(m.growthPct * 100)}% | ${comp} | ${m.avgRating ? m.avgRating.toFixed(1) + '★' : '—'} |`
    );
  }

  lines.push('', '---', '', '## Category Details & Rationale', '');

  for (let i = 0; i < displayCount; i++) {
    const { name, metrics: m } = ranked[i];
    lines.push(`### #${i + 1} — ${name}`);
    lines.push('');
    lines.push(`**Score:** ${m.totalScore}/100 | **Products:** ${m.total} | **Keepa coverage:** ${m.keepaCoverage}%`);
    lines.push('');
    if (m.scores) {
      lines.push('**Score breakdown:**');
      lines.push(`- Revenue size (40pts):            ${m.scores.rev}`);
      lines.push(`- Growth momentum (20pts):         ${m.scores.growth}`);
      lines.push(`- Per-product opportunity (15pts): ${m.scores.perProd}`);
      lines.push(`- Competition gap (15pts):         ${m.scores.gap}`);
      lines.push(`- Consumer quality signal (10pts): ${m.scores.quality}`);
    }
    lines.push('');
    lines.push(`**Rationale:** ${buildRationale(m)}`);
    lines.push('');
    lines.push(`**Run command:** \`node run-pipeline.js --keyword "${name}"\``);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  lines.push('*Generated by phase0-market-opportunity.js (Dovive Scout — Live Mode)*');
  fs.writeFileSync(outPath, lines.join('\n'));
  return outPath;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n${'═'.repeat(62)}`);
  console.log(`PHASE 0 — MARKET OPPORTUNITY SCANNER  [LIVE MODE]`);
  console.log(`Source: Amazon Best Sellers + ${SEED_KEYWORDS.length} seed keywords + Keepa`);
  console.log(`${'═'.repeat(62)}\n`);

  // ── Step 1: Launch browser ──────────────────────────────────────────────────

  const browser = await chromium.launch({
    headless: !HEADED,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent: pickRandom(USER_AGENTS),
    viewport:  pickRandom(VIEWPORTS),
  });
  await context.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  await loadCookies(context);
  const page = await context.newPage();

  // categoryName → Set of ASINs
  const categoryAsins = new Map();

  // ── Step 2: Best Sellers subcategories ─────────────────────────────────────

  console.log('STEP 1: Amazon Best Sellers — discovering subcategories...');
  const bsrSubcats = await scrapeBestSellersSubcategories(page);

  for (const subcat of bsrSubcats) {
    const asins = await scrapeBestSellersPage(page, subcat.name, subcat.url);
    if (asins.length > 0) {
      const existing = categoryAsins.get(subcat.name) || new Set();
      asins.forEach(a => existing.add(a));
      categoryAsins.set(subcat.name, existing);
    }
    await sleep(rand(3000, 5000));
  }

  // ── Step 3: Seed keyword searches ──────────────────────────────────────────

  console.log(`\nSTEP 2: Searching ${SEED_KEYWORDS.length} seed keywords on Amazon...`);
  for (const keyword of SEED_KEYWORDS) {
    const asins = await scrapeKeyword(page, keyword);
    if (asins.length > 0) {
      const existing = categoryAsins.get(keyword) || new Set();
      asins.forEach(a => existing.add(a));
      categoryAsins.set(keyword, existing);
    }
    await sleep(rand(3000, 5000));
  }

  await saveCookies(context);
  await browser.close();

  const qualifyingCats = [...categoryAsins.entries()].filter(([, s]) => s.size >= MIN_PRODUCTS);
  console.log(`\n  ✓ ${qualifyingCats.length} categories with ≥${MIN_PRODUCTS} ASINs`);

  if (qualifyingCats.length === 0) {
    console.warn('⚠ No qualifying categories. Amazon may be blocking — try --headed or run later.');
    process.exit(0);
  }

  // ── Step 4: Keepa enrichment ────────────────────────────────────────────────

  console.log('\nSTEP 3: Fetching Keepa data...');

  let keepaKey = null;
  try {
    keepaKey = await getKeepaKey();
    console.log('  ✓ Keepa API key loaded');
  } catch (e) {
    console.warn(`  ⚠ ${e.message}`);
    console.warn('  → Scoring will use product count + BSR only (no revenue)\n');
  }

  // Deduplicate ASINs across all categories
  const allAsins = [...new Set(qualifyingCats.flatMap(([, s]) => [...s]))];
  console.log(`  Total unique ASINs: ${allAsins.length}`);

  // asin → parsed Keepa result
  const keepaData = new Map();

  if (keepaKey) {
    const BATCH_SIZE = 100;
    const batches = [];
    for (let i = 0; i < allAsins.length; i += BATCH_SIZE) {
      batches.push(allAsins.slice(i, i + BATCH_SIZE));
    }

    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      console.log(`  Batch ${bi + 1}/${batches.length} — ${batch.length} ASINs...`);
      try {
        const result = await fetchKeepa(batch, keepaKey);
        if (result.tokensLeft !== undefined) {
          console.log(`    Tokens remaining: ${result.tokensLeft}`);
        }
        for (const product of (result.products || [])) {
          if (product?.asin) keepaData.set(product.asin, parseKeepaProduct(product));
        }
      } catch (e) {
        console.warn(`    ⚠ Batch ${bi + 1} failed: ${e.message}`);
      }
      if (bi < batches.length - 1) await sleep(2000);
    }

    console.log(`  ✓ Keepa data for ${keepaData.size}/${allAsins.length} ASINs\n`);
  }

  // ── Step 5: Compute metrics per category ────────────────────────────────────

  console.log('STEP 4: Computing metrics...');
  const allMetrics = [];

  for (const [catName, asinSet] of qualifyingCats) {
    const asins = [...asinSet];
    const catKeepa = asins.map(asin =>
      keepaData.get(asin) || { asin, bsr: null, price: null, monthlySales: null, monthlyRevenue: null, rating: null, isRising: false }
    );
    const metrics = computeMetrics(catKeepa);

    if (metrics.total < MIN_PRODUCTS) {
      console.log(`  ⤵ Skipping "${catName}" — ${metrics.total} Keepa results (min: ${MIN_PRODUCTS})`);
      continue;
    }

    allMetrics.push({ name: catName, metrics });
    console.log(`  ✓ ${catName.padEnd(42)} ${metrics.total} prods  ${fmt$(metrics.totalRevenue)}/mo  BSR ${metrics.medianBsr?.toLocaleString() || '—'}`);
  }

  if (!allMetrics.length) {
    console.warn('\n⚠ No qualifying categories after Keepa enrichment. Try --min-products 1');
    process.exit(0);
  }

  // ── Step 6: Score & rank ────────────────────────────────────────────────────

  const ranked = scoreCategories(allMetrics);
  const date = new Date().toISOString().split('T')[0];
  const displayCount = Math.min(TOP_N, ranked.length);

  // ── Step 7: Console output ──────────────────────────────────────────────────

  console.log(`\n${'═'.repeat(62)}`);
  console.log(`TOP ${displayCount} SUPPLEMENT OPPORTUNITIES  —  ${date}`);
  console.log(`${'═'.repeat(62)}\n`);

  for (let i = 0; i < displayCount; i++) {
    const { name, metrics: m } = ranked[i];
    const bar = '█'.repeat(Math.round(m.totalScore / 10)) + '░'.repeat(10 - Math.round(m.totalScore / 10));
    console.log(`#${String(i + 1).padStart(2)}  ${bar}  ${String(m.totalScore).padStart(3)}/100  ${name}`);
    console.log(`      ${buildRationale(m)}`);
    if (i < displayCount - 1) console.log('');
  }

  console.log(`\n${'─'.repeat(62)}`);
  console.log('RECOMMENDED NEXT PIPELINE RUN:');
  if (ranked[0]) console.log(`  node run-pipeline.js --keyword "${ranked[0].name}"`);
  if (ranked[1]) console.log(`  node run-pipeline.js --keyword "${ranked[1].name}"  ← 2nd pick`);
  console.log(`${'─'.repeat(62)}\n`);

  // ── Step 8: Save markdown ───────────────────────────────────────────────────

  try {
    const outPath = saveOutput(ranked, date);
    console.log(`✅ Saved: ${outPath}\n`);
  } catch (e) {
    console.warn(`⚠ Output save failed (non-fatal): ${e.message}\n`);
  }

  console.log('✅ Phase 0 complete\n');
}

run().catch(e => {
  console.error('\n❌ FAILED:', e.message);
  process.exit(1);
});
