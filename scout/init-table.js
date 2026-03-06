// Creates dovive_bsr_products table via Supabase Management API
const fetch = require('node-fetch');

const PROJECT_REF = 'fhfqjcvwcxizbioftvdw';
const MGMT_TOKEN = 'sbp_930d9e5fe75da4d2415263ec1d37aaaa8b5aaab7';

const sql = `
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

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='dovive_bsr_products' AND policyname='anon insert') THEN
    CREATE POLICY "anon insert" ON dovive_bsr_products FOR INSERT TO anon WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='dovive_bsr_products' AND policyname='anon select') THEN
    CREATE POLICY "anon select" ON dovive_bsr_products FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='dovive_bsr_products' AND policyname='anon update') THEN
    CREATE POLICY "anon update" ON dovive_bsr_products FOR UPDATE TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;
`;

fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${MGMT_TOKEN}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ query: sql })
})
.then(r => r.text().then(t => ({ status: r.status, body: t })))
.then(({ status, body }) => {
  console.log('Status:', status);
  console.log('Response:', body);
})
.catch(console.error);
