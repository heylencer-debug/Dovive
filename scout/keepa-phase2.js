/**
 * keepa-phase2.js — Phase 2: Keepa API + Direct Parser
 * ─────────────────────────────────────────────────────
 * 1. Fetch ASINs from dovive_research
 * 2. Call Keepa API per ASIN
 * 3. Parse directly (Keepa encoding is well-documented)
 * 4. Save to dovive_keepa
 */

require('dotenv').config();
const fetch = require('node-fetch');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const KEEPA_DOMAIN = 1; // US

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Keepa time → ISO date string
// Keepa minutes = minutes since 2011-01-01 00:00 UTC
const KEEPA_EPOCH = new Date('2011-01-01T00:00:00Z').getTime();
function keepaTimeToDate(keepaMin) {
  if (!keepaMin || keepaMin < 0) return null;
  return new Date(KEEPA_EPOCH + keepaMin * 60000).toISOString().split('T')[0];
}

// Keepa price → USD (divide by 100, -1 = unavailable)
function keepaPrice(val) {
  if (!val || val < 0) return null;
  return Math.round(val) / 100;
}

// Parse Keepa csv array [time, value, time, value, ...] → [{date, value}]
// Limit to last N days
function parseCsvArray(arr, limitDays = null) {
  if (!arr || !arr.length) return [];
  const result = [];
  const cutoff = limitDays ? Date.now() - limitDays * 86400000 : 0;
  for (let i = 0; i < arr.length - 1; i += 2) {
    const t = arr[i];
    const v = arr[i + 1];
    if (t < 0 || v < 0) continue;
    const ms = KEEPA_EPOCH + t * 60000;
    if (ms < cutoff) continue;
    result.push({ date: new Date(ms).toISOString().split('T')[0], value: v });
  }
  return result;
}

// Count BSR drops in last N days (each drop = purchase event)
function countBsrDrops(bsrArr, days) {
  const parsed = parseCsvArray(bsrArr, days);
  let drops = 0;
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i].value < parsed[i - 1].value) drops++;
  }
  return drops;
}

// Image URLs from imagesCSV
function parseImages(imagesCSV) {
  if (!imagesCSV) return [];
  return imagesCSV.split(',').map(img =>
    `https://images-na.ssl-images-amazon.com/images/I/${img.trim()}`
  ).filter(Boolean);
}

// ── Fetch Keepa API key ───────────────────────────────────────
async function getKeepaKey() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/dovive_scout_config?config_key=eq.keepa_api_key&select=config_value`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const data = await res.json();
  if (!data.length) throw new Error('Keepa API key not found');
  return data[0].config_value.replace(/"/g, '');
}

// ── Fetch ASINs ───────────────────────────────────────────────
async function getASINs(keyword) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/dovive_research?keyword=eq.${encodeURIComponent(keyword)}&select=asin,title&order=bsr.asc`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  return res.json();
}

// ── Call Keepa API — batch up to 100 ASINs per request ───────
async function fetchKeepa(asins, apiKey) {
  const asinParam = Array.isArray(asins) ? asins.join(',') : asins;
  const url = `https://api.keepa.com/product?key=${apiKey}&domain=${KEEPA_DOMAIN}&asin=${asinParam}&stats=180&history=1&offers=20&buybox=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Keepa error: ${res.status}`);
  return res.json();
}

// ── Parse Keepa product → clean record ───────────────────────
function parseKeepa(product) {
  const p = product;
  const stats = p.stats || {};
  const csv = p.csv || [];

  // BSR history is in salesRanks (object keyed by category)
  // Also available in csv[3] for root category
  const bsrCsvRaw = csv[3] || []; // root category BSR
  const bsrHistory90 = parseCsvArray(bsrCsvRaw, 90).map(r => ({ date: r.date, rank: r.value }));
  const bsrHistory30 = parseCsvArray(bsrCsvRaw, 30).map(r => ({ date: r.date, rank: r.value }));

  // Price history (Amazon price = csv[0], New 3P = csv[1])
  const priceHistory30 = parseCsvArray(csv[0], 30).map(r => ({
    date: r.date,
    price_usd: keepaPrice(r.value)
  })).filter(r => r.price_usd !== null);

  // Current price from stats
  const currentPrice = keepaPrice(stats.current?.[0]) || keepaPrice(stats.current?.[1]) || keepaPrice(stats.buyBoxPrice);

  // Current BSR
  const currentBsr = stats.current?.[3] > 0 ? stats.current[3] : null;

  // BSR drops
  const bsrDrops30 = stats.salesRankDrops30 || countBsrDrops(bsrCsvRaw, 30);
  const bsrDrops90 = stats.salesRankDrops90 || countBsrDrops(bsrCsvRaw, 90);

  // Category
  const categoryTree = (p.categoryTree || []).map(c => c.name);
  const category = categoryTree.slice(-1)[0] || p.productGroup || null;

  // Dimensions (Keepa stores in mm and grams)
  const dimensions = {
    length_inches: p.itemLength ? Math.round(p.itemLength / 25.4 * 10) / 10 : null,
    width_inches:  p.itemWidth  ? Math.round(p.itemWidth  / 25.4 * 10) / 10 : null,
    height_inches: p.itemHeight ? Math.round(p.itemHeight / 25.4 * 10) / 10 : null,
    weight_lbs:    p.itemWeight ? Math.round(p.itemWeight / 453.592 * 100) / 100 : null,
    package_length_inches: p.packageLength ? Math.round(p.packageLength / 25.4 * 10) / 10 : null,
    package_width_inches:  p.packageWidth  ? Math.round(p.packageWidth  / 25.4 * 10) / 10 : null,
    package_height_inches: p.packageHeight ? Math.round(p.packageHeight / 25.4 * 10) / 10 : null,
    package_weight_lbs:    p.packageWeight ? Math.round(p.packageWeight / 453.592 * 100) / 100 : null,
  };

  // UPC / EAN
  const upc = p.upcList?.[0] || null;
  const ean = p.eanList?.[0] || null;

  // Monthly sales
  const monthlySalesEst = p.monthlySold > 0 ? p.monthlySold : (bsrDrops30 * 4) || null;

  // Buybox seller
  const buyboxSeller = stats.buyBoxSellerId || null;
  const fulfillment = stats.buyBoxIsFBA ? 'FBA' : stats.buyBoxIsAmazon ? 'Amazon' : 'FBM';

  return {
    asin:              p.asin,
    title:             p.title || null,
    brand:             p.brand || null,
    manufacturer:      p.manufacturer || null,
    category:          category,
    product_group:     p.productGroup || null,
    description:       p.description?.slice(0, 5000) || null,
    features:          p.features?.length ? p.features : null,
    dimensions:        Object.values(dimensions).some(v => v !== null) ? dimensions : null,
    images:            parseImages(p.imagesCSV),
    upc:               upc,
    ean:               ean,
    part_number:       p.partNumber || null,
    release_date:      keepaTimeToDate(p.releaseDate) || null,
    listed_since:      keepaTimeToDate(p.listedSince) || null,
    price_usd:         currentPrice,
    price_history_30d: priceHistory30.length ? priceHistory30 : null,
    bsr_current:       currentBsr,
    bsr_category:      p.salesRankDisplayGroup || p.websiteDisplayGroupName || null,
    bsr_history_30d:   bsrHistory30.length ? bsrHistory30 : null,
    bsr_history_90d:   bsrHistory90.length ? bsrHistory90 : null,
    bsr_drops_30d:     bsrDrops30 || null,
    bsr_drops_90d:     bsrDrops90 || null,
    monthly_sales_est: monthlySalesEst,
    rating:            p.stats?.avg30?.[16] ? p.stats.avg30[16] / 10 : null,
    review_count:      p.stats?.current?.[16] || null,
    buybox_seller:     buyboxSeller,
    fulfillment:       fulfillment,
    availability:      stats.buyBoxAvailabilityMessage || null,
    total_offers:      stats.totalOfferCount || null,
    fba_offers:        stats.offerCountFBA || null,
    fbm_offers:        stats.offerCountFBM || null,
    is_sns_eligible:   p.isSNS || false,
    monthly_sold_history: p.monthlySoldHistory?.length ? p.monthlySoldHistory : null,
  };
}

// ── Save to dovive_keepa ──────────────────────────────────────
async function saveKeepa(record) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/dovive_keepa?on_conflict=asin`,
    {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ ...record, parsed_at: new Date().toISOString() }),
    }
  );
  if (!res.ok) throw new Error(`Save failed: ${res.status} ${await res.text()}`);
}

// ── Also update dovive_research with validated Keepa data ─────
async function updateResearch(asin, parsed) {
  const update = {
    title:       parsed.title || undefined,
    brand:       parsed.brand || undefined,
    price:       parsed.price_usd || undefined,
    bsr:         parsed.bsr_current || undefined,
    images:      parsed.images?.length ? parsed.images : undefined,
    main_image:  parsed.images?.[0] || undefined,
    review_count: parsed.review_count || undefined,
    rating:      parsed.rating || undefined,
  };
  // Remove undefined keys
  Object.keys(update).forEach(k => update[k] === undefined && delete update[k]);
  if (!Object.keys(update).length) return;

  await fetch(`${SUPABASE_URL}/rest/v1/dovive_research?asin=eq.${asin}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(update),
  });
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  const KEYWORD = process.argv[2] || 'magnesium gummies';
  const TEST_MODE = process.argv.includes('--test');

  console.log(`\n🔍 Keepa Phase 2 — "${KEYWORD}"${TEST_MODE ? ' [TEST: 1 ASIN]' : ''}`);

  const keepaKey = await getKeepaKey();
  console.log('✓ Keepa key loaded');

  const products = await getASINs(KEYWORD);
  console.log(`✓ ${products.length} ASINs to process`);

  const list = TEST_MODE ? products.slice(0, 1) : products;
  let success = 0, failed = 0;

  // ── Batch ASINs in groups of 100 (Keepa API limit per request) ──
  const BATCH_SIZE = 100;
  const batches = [];
  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    batches.push(list.slice(i, i + BATCH_SIZE));
  }

  console.log(`✓ Processing ${list.length} ASINs in ${batches.length} batch(es) of up to ${BATCH_SIZE}`);

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    const asinList = batch.map(p => p.asin);
    console.log(`\n📦 Batch ${bi + 1}/${batches.length} — ${asinList.length} ASINs`);

    try {
      const keepaData = await fetchKeepa(asinList, keepaKey);
      console.log(`  ✓ Keepa fetched (tokens left: ${keepaData.tokensLeft})`);

      if (!keepaData.products?.length) {
        console.log('  ⚠ No products returned for batch, skipping');
        failed += batch.length;
        continue;
      }

      console.log(`  ✓ Got ${keepaData.products.length} products back`);

      // Parse and save each product in the batch
      for (const product of keepaData.products) {
        try {
          const parsed = parseKeepa(product);
          console.log(`  [${parsed.asin}] $${parsed.price_usd} | BSR: ${parsed.bsr_current} | ~${parsed.monthly_sales_est}/mo | Drops30: ${parsed.bsr_drops_30d}`);
          await saveKeepa({ ...parsed, keyword: KEYWORD });
          await updateResearch(parsed.asin, parsed);
          success++;
        } catch (err) {
          console.error(`  ✗ Parse/save error for ${product.asin}: ${err.message}`);
          failed++;
        }
      }

      // Only delay between batches, not between individual ASINs
      if (bi < batches.length - 1) {
        console.log(`  ⏳ Waiting 2s before next batch...`);
        await sleep(2000);
      }

    } catch (err) {
      console.error(`  ✗ Batch ${bi + 1} failed: ${err.message}`);
      failed += batch.length;
      await sleep(3000);
    }
  }

  console.log(`\n✅ Done — Success: ${success} | Failed: ${failed}`);

  // Update dovive_keywords dashboard with last_keepa_run timestamp
  const keyword = process.argv[2];
  if (keyword) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/dovive_keywords?keyword=eq.${encodeURIComponent(keyword)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          last_keepa_run: new Date().toISOString(),
          keepa_success: success,
          keepa_failed: failed,
        }),
      }
    );
    if (res.ok) {
      console.log(`✓ Dashboard updated for "${keyword}"`);
    } else {
      console.warn(`⚠ Dashboard update failed: ${res.status} ${await res.text()}`);
    }
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
