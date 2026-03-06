require('dotenv').config();
const fetch = require('node-fetch');

const PROJECT_REF = 'fhfqjcvwcxizbioftvdw';
const ACCESS_TOKEN = 'sbp_930d9e5fe75da4d2415263ec1d37aaaa8b5aaab7';

const SQL = `ALTER TABLE dovive_bsr_products
  ADD COLUMN IF NOT EXISTS brand          text,
  ADD COLUMN IF NOT EXISTS bullet_points  jsonb,
  ADD COLUMN IF NOT EXISTS specifications jsonb,
  ADD COLUMN IF NOT EXISTS images         jsonb,
  ADD COLUMN IF NOT EXISTS format_type    text,
  ADD COLUMN IF NOT EXISTS bsr_rank       integer,
  ADD COLUMN IF NOT EXISTS rating         numeric,
  ADD COLUMN IF NOT EXISTS review_count   integer,
  ADD COLUMN IF NOT EXISTS price          text;`;

async function main() {
  console.log('Running migration via Supabase Management API...');
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: SQL }),
  });

  const data = await res.json();
  console.log('Status:', res.status);
  console.log('Result:', JSON.stringify(data, null, 2));

  if (res.ok) {
    console.log('\n✅ Migration done. Verifying columns...');
    const verRes = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'dovive_bsr_products' ORDER BY ordinal_position;`
      }),
    });
    const cols = await verRes.json();
    console.log('\nColumns:', JSON.stringify(cols, null, 2));
  }
}

main().catch(console.error);
