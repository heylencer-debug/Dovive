/**
 * migrate-to-supplement-scope.js
 * Migrates all Dovive Supabase data to supplement-scope-dash's Supabase
 * 
 * Source: fhfqjcvwcxizbioftvdw (Dovive)
 * Target: jwkitkfufigldpldqtbq (supplement-scope-dash)
 * 
 * Maps:
 *   dovive_keywords    → categories
 *   dovive_research    → products
 *   dovive_keepa       → products (BSR/sales enrichment)
 *   dovive_ocr         → products (supplement facts enrichment)
 *   dovive_phase5_research → products (review/marketing analysis)
 */

const SOURCE_URL = 'https://fhfqjcvwcxizbioftvdw.supabase.co';
const SOURCE_KEY = 'sb_secret_Urw2XKj4d9QUsvcEnQrKBA_TzA_KEnH';

const TARGET_URL = 'https://jwkitkfufigldpldqtbq.supabase.co';
const TARGET_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc';

const BATCH_SIZE = 50;

// ─── Helpers ────────────────────────────────────────────────────────────────

async function srcGet(table, params = '') {
  const res = await fetch(`${SOURCE_URL}/rest/v1/${table}?${params}`, {
    headers: { apikey: SOURCE_KEY, Authorization: `Bearer ${SOURCE_KEY}` }
  });
  if (!res.ok) throw new Error(`Source GET ${table} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function tgtUpsert(table, rows) {
  if (!rows.length) return;
  const res = await fetch(`${TARGET_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: TARGET_KEY,
      Authorization: `Bearer ${TARGET_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(rows)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Target UPSERT ${table} failed: ${res.status} ${err}`);
  }
}

async function tgtGet(table, params = '') {
  const res = await fetch(`${TARGET_URL}/rest/v1/${table}?${params}`, {
    headers: { apikey: TARGET_KEY, Authorization: `Bearer ${TARGET_KEY}` }
  });
  if (!res.ok) throw new Error(`Target GET ${table} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ─── Step 1: Migrate keywords → categories ──────────────────────────────────

async function migrateKeywords() {
  log('Step 1: Migrating keywords → categories...');
  const keywords = await srcGet('dovive_keywords', 'select=*');
  log(`  Found ${keywords.length} keywords`);

  const rows = keywords.map(k => ({
    // Use a stable UUID based on keyword name so re-runs don't duplicate
    // We'll use search_term as unique key — target has unique constraint on search_term
    name: k.keyword.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    search_term: k.keyword,
    last_scanned: k.last_run || k.created_at || new Date().toISOString(),
  }));

  // Upsert in batches
  for (const batch of chunk(rows, BATCH_SIZE)) {
    await tgtUpsert('categories', batch);
  }
  log(`  ✅ ${rows.length} categories upserted`);
}

// ─── Step 2: Migrate products ───────────────────────────────────────────────

async function migrateProducts() {
  log('Step 2: Migrating dovive_research → products...');

  // Get category mapping (search_term → id)
  const categories = await tgtGet('categories', 'select=id,search_term');
  const catMap = {};
  for (const c of categories) catMap[c.search_term] = c.id;
  log(`  Category map: ${Object.keys(catMap).length} entries`);

  // Fetch all products from source (paginate)
  let allProducts = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const batch = await srcGet('dovive_research', `select=*&limit=${PAGE}&offset=${offset}`);
    if (!batch.length) break;
    allProducts = allProducts.concat(batch);
    offset += PAGE;
    if (batch.length < PAGE) break;
  }
  log(`  Fetched ${allProducts.length} products from source`);

  // Map to target schema
  const rows = allProducts.map(p => {
    // Parse images
    let imageUrls = [];
    let mainImageUrl = null;
    try {
      const imgs = typeof p.images === 'string' ? JSON.parse(p.images) : (p.images || []);
      imageUrls = Array.isArray(imgs) ? imgs : [];
      mainImageUrl = imageUrls[0] || null;
    } catch {}

    // Parse bullet_points
    let featureBullets = [];
    let featureBulletsText = '';
    try {
      const bp = typeof p.bullet_points === 'string' ? JSON.parse(p.bullet_points) : (p.bullet_points || []);
      featureBullets = Array.isArray(bp) ? bp : [];
      featureBulletsText = featureBullets.join('\n');
    } catch {
      featureBulletsText = p.bullet_points || '';
    }

    const categoryId = catMap[p.keyword] || null;

    return {
      asin: p.asin,
      category_id: categoryId,
      title: p.title || '',
      brand: p.brand || '',
      price: parseFloat(p.price) || null,
      current_price: parseFloat(p.price) || null,
      price_current: parseFloat(p.price) || null,
      rating: Math.max(0, parseFloat(p.rating) || 0) || null,
      rating_value: Math.max(0, parseFloat(p.rating) || 0) || null,
      reviews: parseInt(p.reviews) || 0,
      rating_count: parseInt(p.reviews) || 0,
      rank: parseInt(p.bsr) || null,
      bsr_current: parseInt(p.bsr) || null,
      bsr_primary: parseInt(p.bsr) || null,
      bsr_category: p.bsr_category || null,
      image_url: mainImageUrl,
      main_image_url: mainImageUrl,
      image_urls: imageUrls.length ? imageUrls : null,
      feature_bullets: featureBullets.length ? featureBullets : null,
      feature_bullets_text: featureBulletsText || null,
      product_url: p.url || (p.asin ? `https://www.amazon.com/dp/${p.asin}` : null),
      is_available: true,
      seller_type: p.fulfillment || null,
      is_fba: p.fulfillment === 'FBA',
      amazon_choice: p.amazon_choice || false,
      bestseller: p.bestseller || false,
      created_at: p.created_at || new Date().toISOString(),
      updated_at: p.updated_at || new Date().toISOString(),
    };
  });

  // Upsert in batches
  let count = 0;
  for (const batch of chunk(rows, BATCH_SIZE)) {
    await tgtUpsert('products', batch);
    count += batch.length;
    log(`  Upserted ${count}/${rows.length} products...`);
  }
  log(`  ✅ ${rows.length} products migrated`);
}

// ─── Step 3: Enrich with Keepa data ─────────────────────────────────────────

async function enrichWithKeepa() {
  log('Step 3: Enriching products with Keepa BSR/sales data...');

  let keepaRows = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const batch = await srcGet('dovive_keepa', `select=*&limit=${PAGE}&offset=${offset}`);
    if (!batch.length) break;
    keepaRows = keepaRows.concat(batch);
    offset += PAGE;
    if (batch.length < PAGE) break;
  }
  log(`  Fetched ${keepaRows.length} Keepa rows`);

  // Build ASIN → Keepa map (latest record wins)
  const keepaMap = {};
  for (const k of keepaRows) {
    if (!keepaMap[k.asin] || k.created_at > keepaMap[k.asin].created_at) {
      keepaMap[k.asin] = k;
    }
  }

  const updates = Object.values(keepaMap).map(k => {
    // Build historical BSR data
    let historicalData = null;
    try {
      if (k.bsr_history) {
        const bsrHist = typeof k.bsr_history === 'string' ? JSON.parse(k.bsr_history) : k.bsr_history;
        historicalData = { bsr_history: bsrHist, source: 'keepa' };
      }
    } catch {}

    return {
      asin: k.asin,
      bsr_current: k.bsr_current || null,
      bsr_30_days_avg: k.bsr_30d_avg || k.bsr_30days_avg || null,
      bsr_90_days_avg: k.bsr_90d_avg || k.bsr_90days_avg || null,
      monthly_sales: k.monthly_sales || null,
      estimated_monthly_sales: k.monthly_sales || null,
      monthly_revenue: k.monthly_revenue || null,
      estimated_revenue: k.monthly_revenue || null,
      price_30_days_avg: k.price_30d_avg || null,
      price_90_days_avg: k.price_90d_avg || null,
      listing_since: k.listing_since || null,
      parent_asin: k.parent_asin || null,
      historical_data: historicalData,
      updated_at: new Date().toISOString(),
    };
  });

  let count = 0;
  for (const batch of chunk(updates, BATCH_SIZE)) {
    await tgtUpsert('products', batch);
    count += batch.length;
  }
  log(`  ✅ ${updates.length} products enriched with Keepa data`);
}

// ─── Step 4: Enrich with OCR / supplement facts ─────────────────────────────

async function enrichWithOCR() {
  log('Step 4: Enriching products with OCR supplement facts...');

  // Get latest OCR per ASIN (prefer image_index=99 text extraction, else any)
  let ocrRows = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const batch = await srcGet('dovive_ocr', `select=*&limit=${PAGE}&offset=${offset}`);
    if (!batch.length) break;
    ocrRows = ocrRows.concat(batch);
    offset += PAGE;
    if (batch.length < PAGE) break;
  }
  log(`  Fetched ${ocrRows.length} OCR rows`);

  // ASIN → best OCR record
  const ocrMap = {};
  for (const r of ocrRows) {
    const existing = ocrMap[r.asin];
    // Prefer image_index=99 (text extraction), then highest confidence
    if (!existing) {
      ocrMap[r.asin] = r;
    } else if (r.image_index === 99 && existing.image_index !== 99) {
      ocrMap[r.asin] = r;
    } else if (r.image_index !== 99 && existing.image_index !== 99 && (r.confidence || 0) > (existing.confidence || 0)) {
      ocrMap[r.asin] = r;
    }
  }

  const updates = Object.values(ocrMap).map(r => {
    let allNutrients = null;
    try {
      if (r.supplement_facts) {
        const sf = typeof r.supplement_facts === 'string' ? JSON.parse(r.supplement_facts) : r.supplement_facts;
        allNutrients = sf;
      }
    } catch {}

    return {
      asin: r.asin,
      supplement_facts_raw: r.raw_text || null,
      all_nutrients: allNutrients,
      serving_size: r.serving_size || null,
      servings_per_container: r.servings_per_container ? parseInt(r.servings_per_container) : null,
      ocr_extracted: !!(r.raw_text || r.supplement_facts),
      ocr_confidence: r.confidence || null,
      supplement_facts_complete: !!(allNutrients),
      updated_at: new Date().toISOString(),
    };
  });

  let count = 0;
  for (const batch of chunk(updates, BATCH_SIZE)) {
    await tgtUpsert('products', batch);
    count += batch.length;
  }
  log(`  ✅ ${updates.length} products enriched with OCR data`);
}

// ─── Step 5: Enrich with Phase 5 deep research ──────────────────────────────

async function enrichWithPhase5() {
  log('Step 5: Enriching products with Phase 5 deep research...');

  const phase5 = await srcGet('dovive_phase5_research', 'select=*');
  log(`  Fetched ${phase5.length} Phase 5 records`);

  const updates = phase5.map(p => {
    const reviewAnalysis = {
      key_strengths: p.key_strengths || [],
      key_weaknesses: p.key_weaknesses || [],
      benefits: p.benefits || [],
      features: p.features || [],
      certifications: p.certifications || [],
      reddit_sentiment: p.reddit_sentiment || null,
      reddit_notes: p.reddit_notes || null,
      external_reviews: p.external_reviews || null,
      source: 'dovive_phase5',
      analyzed_at: p.created_at || new Date().toISOString(),
    };

    const marketingAnalysis = {
      competitor_angle: p.competitor_angle || null,
      formula_notes: p.formula_notes || null,
      source: 'dovive_phase5',
      analyzed_at: p.created_at || new Date().toISOString(),
    };

    return {
      asin: p.asin,
      review_analysis: reviewAnalysis,
      review_analysis_updated_at: p.updated_at || new Date().toISOString(),
      marketing_analysis: marketingAnalysis,
      marketing_analysis_updated_at: p.updated_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });

  for (const batch of chunk(updates, BATCH_SIZE)) {
    await tgtUpsert('products', batch);
  }
  log(`  ✅ ${updates.length} products enriched with Phase 5 data`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  log('=== Dovive → supplement-scope-dash Migration ===');
  log(`Source: ${SOURCE_URL}`);
  log(`Target: ${TARGET_URL}`);
  console.log('');

  try {
    await migrateKeywords();
    console.log('');
    await migrateProducts();
    console.log('');
    await enrichWithKeepa();
    console.log('');
    await enrichWithOCR();
    console.log('');
    await enrichWithPhase5();
    console.log('');
    log('=== ✅ Migration complete! ===');
    log('All Dovive P1-P5 data is now in supplement-scope-dash Supabase.');
  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
  }
}

main();
