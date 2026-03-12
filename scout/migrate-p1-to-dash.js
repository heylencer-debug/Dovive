/**
 * migrate-p1-to-dash.js
 * Creates a DASH category for a keyword and migrates P1 products from
 * dovive_research → supplement-scope-dash products table.
 *
 * Usage:
 *   node migrate-p1-to-dash.js "melatonin gummies"
 *   node migrate-p1-to-dash.js --keyword "melatonin gummies"
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const DOVIVE = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);

const _kwIdx = process.argv.indexOf('--keyword');
const KEYWORD = _kwIdx >= 0
  ? process.argv[_kwIdx + 1]
  : (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null);

if (!KEYWORD) {
  console.error('Usage: node migrate-p1-to-dash.js "keyword here"');
  process.exit(1);
}

function toTitleCase(str) {
  return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

async function getOrCreateCategory() {
  // Check if category already exists by search_term
  const { data: existing } = await DASH
    .from('categories')
    .select('id, name')
    .eq('search_term', KEYWORD)
    .limit(1);

  if (existing?.length) {
    console.log(`  → Category exists: "${existing[0].name}" (${existing[0].id})`);
    return existing[0].id;
  }

  // Create new category
  const name = toTitleCase(KEYWORD);
  const { data, error } = await DASH
    .from('categories')
    .insert({ name, search_term: KEYWORD, last_scanned: new Date().toISOString() })
    .select('id, name')
    .single();

  if (error) throw new Error(`Failed to create category: ${error.message}`);
  console.log(`  → Created category: "${data.name}" (${data.id})`);
  return data.id;
}

async function run() {
  console.log(`\n=== P1 Migration: dovive_research → supplement-scope-dash ===`);
  console.log(`Keyword: "${KEYWORD}"\n`);

  // 1. Get or create the DASH category
  const categoryId = await getOrCreateCategory();

  // 2. Fetch P1 products from dovive_research
  const { data: products, error: fetchErr } = await DOVIVE
    .from('dovive_research')
    .select('*')
    .eq('keyword', KEYWORD);

  if (fetchErr) throw fetchErr;
  console.log(`Fetched ${products.length} products from dovive_research`);

  if (!products.length) {
    console.log('No products to migrate. Run P1 scraper first.');
    return { categoryId, migrated: 0 };
  }

  // 3. Get existing ASINs in DASH for this category (to skip duplicates)
  const { data: existing } = await DASH
    .from('products')
    .select('asin')
    .eq('category_id', categoryId);
  const existingAsins = new Set((existing || []).map(p => p.asin));
  console.log(`Already in DASH: ${existingAsins.size} products`);

  // 4. Map + upsert products
  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const p of products) {
    if (existingAsins.has(p.asin)) { skipped++; continue; }

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

    const priceVal = p.price ? parseFloat(String(p.price).replace(/[^0-9.]/g, '')) || null : null;
    const row = {
      asin: p.asin,
      category_id: categoryId,
      title: p.title || '',
      brand: p.brand || null,
      price: priceVal,
      current_price: priceVal,
      rating_value: p.rating || null,
      rating_count: p.review_count || null,
      feature_bullets: featureBullets,
      feature_bullets_text: featureBulletsText,
      specifications: p.specs || null,
      image_urls: imageUrls,
      main_image_url: p.main_image || mainImageUrl || null,
      bsr_current: p.bsr || null,
      keyword_rank: p.rank_position || null,
      created_at: p.scraped_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { error } = await DASH.from('products').insert(row);
    if (error) {
      // Try upsert on conflict
      const { error: upsertErr } = await DASH.from('products').upsert(row, { onConflict: 'asin,category_id' });
      if (upsertErr) {
        console.error(`  ERROR ${p.asin}: ${upsertErr.message}`);
        errors++;
        continue;
      }
    }
    migrated++;
    if (migrated % 20 === 0) console.log(`  ${migrated} migrated...`);
  }

  console.log(`\n=== DONE ===`);
  console.log(`Migrated: ${migrated}`);
  console.log(`Skipped (already in DASH): ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log(`Category ID: ${categoryId}`);

  return { categoryId, migrated, skipped, errors };
}

run().catch(console.error);
