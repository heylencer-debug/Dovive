/**
 * migrate-v3.js
 * Adds missing columns to dovive_bsr_products for Phase 1 v3
 */

require('dotenv').config();
const fetch = require('node-fetch');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const SQL = `
ALTER TABLE dovive_bsr_products
  ADD COLUMN IF NOT EXISTS brand         text,
  ADD COLUMN IF NOT EXISTS bullet_points jsonb,
  ADD COLUMN IF NOT EXISTS specifications jsonb,
  ADD COLUMN IF NOT EXISTS images        jsonb,
  ADD COLUMN IF NOT EXISTS format_type   text,
  ADD COLUMN IF NOT EXISTS bsr_rank      integer,
  ADD COLUMN IF NOT EXISTS rating        numeric,
  ADD COLUMN IF NOT EXISTS review_count  integer,
  ADD COLUMN IF NOT EXISTS price         text;
`;

async function run() {
  console.log('Running migration...');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql: SQL }),
  });

  if (!res.ok) {
    const text = await res.text();
    // Supabase REST doesn't expose raw SQL — use direct pg or management API
    console.log('Note: Cannot run ALTER TABLE via REST API directly.');
    console.log('Please run this SQL in the Supabase SQL editor:\n');
    console.log(SQL);
    return;
  }

  const data = await res.json();
  console.log('Migration result:', data);
}

run().catch(console.error);
