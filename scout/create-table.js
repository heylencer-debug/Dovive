require('dotenv').config();
const fetch = require('node-fetch');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function main() {
  // Use Management API to create table
  const res = await fetch(`${SUPABASE_URL}/rest/v1/dovive_bsr_products?limit=1`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  if (res.status === 200) {
    console.log('Table dovive_bsr_products already exists.');
    return;
  }
  console.log('Table does not exist (status:', res.status, '). Create it in Supabase SQL editor:');
  console.log(`
CREATE TABLE IF NOT EXISTS dovive_bsr_products (
  id bigint generated always as identity primary key,
  asin text not null,
  keyword text not null,
  title text,
  description text,
  scraped_at timestamptz default now(),
  unique(asin, keyword)
);

ALTER TABLE dovive_bsr_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon can insert" ON dovive_bsr_products FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon can select" ON dovive_bsr_products FOR SELECT TO anon USING (true);
CREATE POLICY "anon can update" ON dovive_bsr_products FOR UPDATE TO anon USING (true);
  `);
}

main().catch(console.error);
