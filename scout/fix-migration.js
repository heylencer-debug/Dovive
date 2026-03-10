/**
 * fix-migration.js
 * 1. Deduplicate categories (keep one per search_term)
 * 2. Reassign products with null category_id using source data
 */

const SOURCE_URL = 'https://fhfqjcvwcxizbioftvdw.supabase.co';
const SOURCE_KEY = 'sb_secret_Urw2XKj4d9QUsvcEnQrKBA_TzA_KEnH';
const TARGET_URL = 'https://jwkitkfufigldpldqtbq.supabase.co';
const TARGET_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc';

async function tgt(method, path, body) {
  const res = await fetch(`${TARGET_URL}/rest/v1/${path}`, {
    method, headers: {
      apikey: TARGET_KEY, Authorization: `Bearer ${TARGET_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=representation'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function src(path) {
  const res = await fetch(`${SOURCE_URL}/rest/v1/${path}`, {
    headers: { apikey: SOURCE_KEY, Authorization: `Bearer ${SOURCE_KEY}` }
  });
  return res.json();
}

function log(m) { console.log(`[${new Date().toISOString()}] ${m}`); }
function chunk(arr, n) { const c=[]; for(let i=0;i<arr.length;i+=n) c.push(arr.slice(i,i+n)); return c; }

async function main() {
  // ── Step 1: Get all categories, group by search_term ──────────────────────
  log('Step 1: Deduplicating categories...');
  const allCats = await tgt('GET', 'categories?select=id,search_term,name&limit=1000');
  
  // Group by search_term
  const byTerm = {};
  for (const c of allCats) {
    if (!byTerm[c.search_term]) byTerm[c.search_term] = [];
    byTerm[c.search_term].push(c);
  }

  // For each term with dupes, find which ID has the most products, keep that one
  const keepMap = {}; // search_term → id to keep
  const deleteIds = [];

  for (const [term, cats] of Object.entries(byTerm)) {
    if (cats.length === 1) {
      keepMap[term] = cats[0].id;
      continue;
    }
    // Get product counts for each
    const counts = await Promise.all(cats.map(async c => {
      const rows = await tgt('GET', `products?category_id=eq.${c.id}&select=id&limit=500`);
      return { id: c.id, count: rows.length };
    }));
    counts.sort((a, b) => b.count - a.count);
    keepMap[term] = counts[0].id;
    for (let i = 1; i < counts.length; i++) deleteIds.push(counts[i].id);
    log(`  "${term}": keeping ${counts[0].id} (${counts[0].count} products), deleting ${counts.length - 1} dupes`);
  }

  // Delete duplicate categories
  for (const id of deleteIds) {
    await tgt('DELETE', `categories?id=eq.${id}`);
  }
  log(`  ✅ Deleted ${deleteIds.length} duplicate categories. Kept ${Object.keys(keepMap).length} unique.`);

  // ── Step 2: Fix products with null category_id ────────────────────────────
  log('\nStep 2: Fixing products with null category_id...');

  // Get all source products with their keywords
  let srcProds = [];
  let offset = 0;
  while (true) {
    const batch = await src(`dovive_research?select=asin,keyword&limit=1000&offset=${offset}`);
    if (!batch.length) break;
    srcProds = srcProds.concat(batch);
    offset += batch.length;
    if (batch.length < 1000) break;
  }
  log(`  Source products: ${srcProds.length}`);

  // Build ASIN → category_id map
  const asinCatMap = {};
  for (const p of srcProds) {
    if (p.keyword && keepMap[p.keyword]) {
      asinCatMap[p.asin] = keepMap[p.keyword];
    }
  }

  // Get all target products with null category
  const nullCatProds = await tgt('GET', 'products?category_id=is.null&select=asin&limit=1000');
  log(`  Products with null category: ${nullCatProds.length}`);

  // Update them in batches
  let fixed = 0;
  const updates = [];
  for (const p of nullCatProds) {
    if (asinCatMap[p.asin]) {
      updates.push({ asin: p.asin, category_id: asinCatMap[p.asin] });
    }
  }

  // Patch each product (Supabase REST needs individual patches or upsert by asin)
  for (const batch of chunk(updates, 50)) {
    // Use upsert with asin as conflict target
    const res = await fetch(`${TARGET_URL}/rest/v1/products`, {
      method: 'POST',
      headers: {
        apikey: TARGET_KEY, Authorization: `Bearer ${TARGET_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(batch)
    });
    if (!res.ok) console.error('Batch update error:', await res.text());
    fixed += batch.length;
    log(`  Fixed ${fixed}/${updates.length}...`);
  }

  log(`  ✅ Fixed ${fixed} products with category_id`);
  log(`  ⚠️  ${nullCatProds.length - updates.length} products couldn't be mapped (old n8n data, no keyword match)`);

  // ── Final counts ──────────────────────────────────────────────────────────
  log('\nFinal verification:');
  const ashwagandhaId = keepMap['ashwagandha gummies'];
  if (ashwagandhaId) {
    const ashProds = await tgt('GET', `products?category_id=eq.${ashwagandhaId}&select=id`);
    log(`  Ashwagandha gummies: ${ashProds.length} products under ${ashwagandhaId}`);
  }
  log('✅ Done!');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
