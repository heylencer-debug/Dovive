/**
 * add-keyword-to-keepa.js
 * Sprint 1 Task 3: Add keyword column to dovive_keepa, backfill from dovive_research
 * Date: 2026-03-09
 */
require('dotenv').config();
const https = require('https');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const PROJECT_REF = 'fhfqjcvwcxizbioftvdw';
const MANAGEMENT_TOKEN = 'sbp_930d9e5fe75da4d2415263ec1d37aaaa8b5aaab7';

function runSQL(sql) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql });
    const options = {
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MANAGEMENT_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => res.statusCode === 201 ? resolve(data) : reject(new Error(`SQL failed ${res.statusCode}: ${data}`)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('Sprint 1 Task 3 — Adding keyword column to dovive_keepa...\n');

  // Step 1: Add column
  console.log('Step 1: Adding keyword column...');
  await runSQL('ALTER TABLE dovive_keepa ADD COLUMN IF NOT EXISTS keyword text;');
  console.log('  ✅ Column added\n');

  // Step 2: Backfill from dovive_research (join on asin)
  console.log('Step 2: Backfilling keyword from dovive_research...');
  await runSQL(`
    UPDATE dovive_keepa k
    SET keyword = r.keyword
    FROM (
      SELECT DISTINCT ON (asin) asin, keyword
      FROM dovive_research
      ORDER BY asin, scraped_at DESC
    ) r
    WHERE k.asin = r.asin AND k.keyword IS NULL;
  `);
  console.log('  ✅ Backfill complete\n');

  // Step 3: Add index
  console.log('Step 3: Adding index...');
  await runSQL('CREATE INDEX IF NOT EXISTS idx_keepa_keyword ON dovive_keepa(keyword);');
  console.log('  ✅ Index created\n');

  // Step 4: Verify
  const { data, error } = await sb.from('dovive_keepa').select('keyword, asin').not('keyword', 'is', null).limit(5);
  if (error) { console.error('Verify error:', error.message); return; }
  console.log('Step 4: Verification sample:');
  data.forEach(r => console.log(`  ${r.asin} → ${r.keyword}`));

  const { count } = await sb.from('dovive_keepa').select('*', { count: 'exact', head: true }).not('keyword', 'is', null);
  console.log(`\n  ✅ ${count} rows now have keyword set`);
  console.log('\nSprint 1 Task 3 complete!');
}

main().catch(console.error);
