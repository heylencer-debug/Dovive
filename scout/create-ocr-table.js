require('dotenv').config({ path: 'C:\\Users\\Carl Rebadomia\\.openclaw\\workspace\\PerciCommandCenter\\.env' });
const fetch = require('node-fetch');

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF  = 'fhfqjcvwcxizbioftvdw';

const sql = `
CREATE TABLE IF NOT EXISTS dovive_ocr (
  id bigserial PRIMARY KEY,
  asin text NOT NULL,
  keyword text,
  image_url text,
  image_index integer DEFAULT 0,
  serving_size text,
  servings_per_container text,
  supplement_facts jsonb,
  other_ingredients text,
  health_claims text[],
  certifications text[],
  raw_text text,
  gpt_model text DEFAULT 'gpt-4o',
  processed_at timestamptz DEFAULT now(),
  UNIQUE(asin, image_index)
);
CREATE INDEX IF NOT EXISTS dovive_ocr_asin_idx ON dovive_ocr(asin);
CREATE INDEX IF NOT EXISTS dovive_ocr_keyword_idx ON dovive_ocr(keyword);
`;

(async () => {
  console.log('Creating dovive_ocr table...');
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: sql })
  });
  const data = await res.json();
  console.log('Status:', res.status);
  console.log('Result:', JSON.stringify(data).slice(0, 300));
})().catch(e => console.error(e.message));
