/**
 * migrate-keepa-keyword.js
 * Adds keyword column to dovive_keepa and backfills from dovive_research
 * Sprint 1 Task 3 — BMAD Improvement
 */
require('dotenv').config();
const https = require('https');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const PROJECT_REF = 'fhfqjcvwcxizbioftvdw';
const MANAGEMENT_TOKEN = 'sbp_930d9e5fe75da4d2415263ec1d37aaaa8b5aaab7';

async function runSQL(sql) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql });
    const options = {
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: 'POST',
      headers: { 'Authorization': `Bearer ${MANAGEMENT_TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('Step 1: Adding keyword column to dovive_keepa...');
  const addCol = await runSQL('ALTER TABLE dovive_keepa ADD COLUMN IF NOT EXISTS keyword text;');
  console.log('  Status:', addCol.status, addCol.status === 201 ? '✅' : addCol.body);

  console.log('Step 2: Adding index on keyword...');
  const addIdx = await runSQL('CREATE INDEX IF NOT EXISTS idx_keepa_keyword ON dovive_keepa(keyword);');
  console.log('  Status:', addIdx.status, addIdx.status === 201 ? '✅' : addIdx.body);

  console.log('Step 3: Backfilling keyword from dovive_research...');
  const backfill = await runSQL(`
    UPDATE dovive_keepa k
    SET keyword = r.keyword
    FROM dovive_research r
    WHERE k.asin = r.asin AND k.keyword IS NULL;
  `);
  console.log('  Status:', backfill.status, backfill.status === 201 ? '✅' : backfill.body);

  // Verify
  console.log('\nStep 4: Verifying backfill...');
  const { data, error } = await sb.from('dovive_keepa').select('keyword, asin').not('keyword', 'is', null).limit(5);
  if (error) { console.error('  ❌', error.message); return; }
  console.log(`  ✅ Sample backfilled rows:`);
  data.forEach(r => console.log(`    ${r.asin} → ${r.keyword}`));

  const { count } = await sb.from('dovive_keepa').select('*', { count: 'exact', head: true }).not('keyword', 'is', null);
  console.log(`\n  Total keepa rows with keyword: ${count}`);
  console.log('\n✅ Migration complete.');
}

main().catch(console.error);
