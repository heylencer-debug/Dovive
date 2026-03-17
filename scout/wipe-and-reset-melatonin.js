/**
 * wipe-and-reset-melatonin.js
 * 1. Deletes all products from Melatonin Gummies category in DASH
 * 2. Deletes formula_briefs for that category
 * 3. Renames category to clean "Melatonin Gummies"
 * 4. Also cleans up other stub melatonin categories
 * Then queues full P1-P10 pipeline.
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);

const MAIN_CAT = '992bf7a2-c744-4e6f-b9cc-a1e80a6f5ccd'; // =Melatonin Gummies for Adults - Sample (81 products)
const QUEUE_FILE = path.join(__dirname, 'pipeline-queue.json');

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }

async function main() {
  console.log('\n🗑️  MELATONIN GUMMIES — Wipe & Reset\n' + '═'.repeat(50));

  // Step 1: Delete all products from main category
  log('Deleting products from main Melatonin category...');
  const { count: prodCount } = await DASH.from('products')
    .select('*', { count: 'exact', head: true }).eq('category_id', MAIN_CAT);
  log(`  Found ${prodCount} products to delete`);

  // Delete in batches of 100
  let deleted = 0;
  while (true) {
    const { data: batch } = await DASH.from('products')
      .select('id').eq('category_id', MAIN_CAT).limit(100);
    if (!batch?.length) break;
    const ids = batch.map(p => p.id);
    const { error } = await DASH.from('products').delete().in('id', ids);
    if (error) { log(`  ❌ Delete error: ${error.message}`); break; }
    deleted += ids.length;
    log(`  Deleted ${deleted}/${prodCount}...`);
  }
  log(`  ✅ Deleted ${deleted} products`);

  // Step 2: Delete formula_briefs
  log('Deleting formula_briefs...');
  const { error: fbErr } = await DASH.from('formula_briefs').delete().eq('category_id', MAIN_CAT);
  if (fbErr) log(`  ❌ formula_briefs error: ${fbErr.message}`);
  else log(`  ✅ formula_briefs cleared`);

  // Step 3: Rename main category
  log('Renaming category to "Melatonin Gummies"...');
  const { error: renameErr } = await DASH.from('categories')
    .update({ name: 'Melatonin Gummies' }).eq('id', MAIN_CAT);
  if (renameErr) log(`  ❌ Rename error: ${renameErr.message}`);
  else log(`  ✅ Category renamed to "Melatonin Gummies"`);

  // Step 4: Delete products from stub categories (leave categories but empty them)
  const STUB_CATS = [
    '55080a63-7089-4b17-851c-1fefe509118f',
    '14ab8313-4f33-489a-b8b3-90a592b609b4',
    'ed08c16f-e14f-4bbf-bb5c-b3c41672ec73',
    '020e404d-f15c-434e-877f-cc910e68e13e',
    'd70d4935-6254-44ec-885b-1bc298e6ca62',
    'd3b2ddc6-1686-444b-9662-57e3f72d1c52',
  ];
  log('Clearing stub Melatonin categories...');
  for (const catId of STUB_CATS) {
    const { data: stubs } = await DASH.from('products').select('id').eq('category_id', catId).limit(200);
    if (stubs?.length) {
      await DASH.from('products').delete().in('id', stubs.map(p => p.id));
      log(`  Cleared ${stubs.length} from ${catId}`);
    }
  }
  log('  ✅ Stubs cleared');

  // Step 5: Queue P1-P10
  log('Queueing full P1-P10 pipeline for "melatonin gummies"...');
  let queue = [];
  if (fs.existsSync(QUEUE_FILE)) {
    try { queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')); } catch {}
  }
  const already = queue.some(e => (typeof e === 'string' ? e : e.keyword) === 'melatonin gummies');
  if (!already) {
    queue.push({ keyword: 'melatonin gummies', fromPhase: 1, force: false });
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
    log('  ✅ Queued: "melatonin gummies" from P1');
  } else {
    log('  Already in queue');
  }

  console.log('\n' + '═'.repeat(50));
  log('Done. pm2 will pick up melatonin gummies within 30s.');
  log('Category ID: ' + MAIN_CAT);
}

main().catch(console.error);
