/**
 * barry-fix-all.js
 * Runs P3 review text migration + P4 OCR migration for all real categories
 * Then queues P6 reruns via pm2 queue
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DOVIVE = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);

const QUEUE_FILE = path.join(__dirname, 'pipeline-queue.json');
const REAL_KEYWORDS = [
  'ashwagandha gummies',
  'collagen gummies',
  'elderberry gummies',
  'magnesium gummies',
  'melatonin gummies',
  'vitamin c gummies',
];

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }

// ── Fix P3: add top_reviews text to review_analysis ──────────────────────────
async function fixP3ReviewText(categoryId, categoryName) {
  log(`P3 review text fix: ${categoryName}`);
  const { data: products } = await DASH.from('products')
    .select('id, asin, review_analysis')
    .eq('category_id', categoryId)
    .not('review_analysis', 'is', null);

  if (!products?.length) { log(`  No products with review_analysis`); return 0; }

  let fixed = 0;
  for (const p of products) {
    if (p.review_analysis?.top_reviews?.length > 0) continue; // already has text

    // Fetch raw reviews from dovive_reviews
    const { data: reviews } = await DOVIVE.from('dovive_reviews')
      .select('review_id, title, body, reviewer_name, review_date, rating, verified_purchase, helpful_votes')
      .eq('asin', p.asin)
      .order('helpful_votes', { ascending: false })
      .limit(30);

    if (!reviews?.length) continue;

    const pos = reviews.filter(r => r.rating >= 4).slice(0, 5);
    const neg = reviews.filter(r => r.rating <= 2).slice(0, 5);
    const neu = reviews.filter(r => r.rating === 3).slice(0, 3);

    const existing = p.review_analysis || {};
    const updated = {
      ...existing,
      top_reviews: {
        positive: pos.map(r => ({ title: r.title, body: r.body, reviewer: r.reviewer_name, date: r.review_date, rating: r.rating, verified: r.verified_purchase, helpful: r.helpful_votes })),
        negative: neg.map(r => ({ title: r.title, body: r.body, reviewer: r.reviewer_name, date: r.review_date, rating: r.rating, verified: r.verified_purchase, helpful: r.helpful_votes })),
        neutral: neu.map(r => ({ title: r.title, body: r.body, reviewer: r.reviewer_name, date: r.review_date, rating: r.rating, verified: r.verified_purchase, helpful: r.helpful_votes })),
      }
    };

    await DASH.from('products').update({ review_analysis: updated }).eq('id', p.id);
    fixed++;
  }
  log(`  Fixed ${fixed}/${products.length} products with review text`);
  return fixed;
}

// ── Fix P4: populate supplement_facts_raw from all_nutrients ─────────────────
async function fixP4OCR(categoryId, categoryName) {
  log(`P4 supplement_facts_raw fix: ${categoryName}`);
  const { data: products } = await DASH.from('products')
    .select('id, asin, supplement_facts_raw, all_nutrients')
    .eq('category_id', categoryId)
    .is('supplement_facts_raw', null)
    .not('all_nutrients', 'is', null);

  if (!products?.length) { log(`  Nothing to fix`); return 0; }

  let fixed = 0;
  for (const p of products) {
    const facts = p.all_nutrients;
    if (!Array.isArray(facts) || !facts.length) continue;
    const sfRaw = facts.map(f => `${f.name}: ${f.amount || '?'}${f.dv_percent ? ` (${f.dv_percent}% DV)` : ''}`).join('\n');
    await DASH.from('products').update({ supplement_facts_raw: sfRaw }).eq('id', p.id);
    fixed++;
  }
  log(`  Fixed ${fixed}/${products.length} products with supplement_facts_raw`);
  return fixed;
}

// ── Queue P6 rerun for a keyword ──────────────────────────────────────────────
function addToQueue(keyword, fromPhase, force) {
  let queue = [];
  if (fs.existsSync(QUEUE_FILE)) {
    try { queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')); } catch {}
  }
  const alreadyQueued = queue.some(e => (typeof e === 'string' ? e : e.keyword) === keyword);
  if (alreadyQueued) { log(`  Already queued: ${keyword}`); return; }
  queue.push({ keyword, fromPhase, force });
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
  log(`  Queued: "${keyword}" from P${fromPhase}${force ? ' --force' : ''}`);
}

async function main() {
  console.log('\n🔧 BARRY FIX-ALL — Patching P3 + P4 + Queuing P6 reruns\n' + '═'.repeat(60));

  // Get real categories
  const { data: cats } = await DASH.from('categories').select('id, name').order('name');
  const realCats = [];
  for (const kw of REAL_KEYWORDS) {
    const words = kw.replace(/'/g, '').split(' ');
    // Find category with most products matching this keyword
    const matches = (cats||[]).filter(c => {
      if (c.name.startsWith('=') || c.name.toLowerCase().includes('demo')) return false;
      const lower = c.name.toLowerCase().replace(/'/g, '');
      return words.every(w => lower.includes(w));
    });
    if (!matches.length) { log(`No category found for: ${kw}`); continue; }

    // Pick the one with most products
    let bestCat = null, bestCount = 0;
    for (const m of matches) {
      const { count } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', m.id);
      if ((count || 0) > bestCount) { bestCount = count; bestCat = m; }
    }
    if (bestCat && bestCount >= 5) {
      realCats.push({ ...bestCat, keyword: kw, count: bestCount });
    }
  }

  log(`\nFound ${realCats.length} real categories to fix:\n`);
  realCats.forEach(c => log(`  ${c.name} (${c.count} products)`));
  console.log('');

  // Fix each category
  for (const cat of realCats) {
    console.log(`\n${'─'.repeat(50)}`);
    log(`Processing: ${cat.name}`);
    await fixP3ReviewText(cat.id, cat.name);
    await fixP4OCR(cat.id, cat.name);
    // Queue P6 rerun (P6 → P7 → P8 → P9 → P10 all follow)
    addToQueue(cat.keyword, 6, true);
  }

  console.log('\n' + '═'.repeat(60));
  log('P3 + P4 fixes applied. P6 reruns queued via pm2.');
  const queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  log(`Queue length: ${queue.length}`);
  log('pm2 will pick up each keyword sequentially.');
  log('Run "pm2 logs scout-pipeline" on Hostinger to monitor.');
}

main().catch(console.error);
