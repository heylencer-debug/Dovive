require('dotenv').config();
const fetch = require('node-fetch');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const PROJECT_REF = 'fhfqjcvwcxizbioftvdw';

async function main() {
  // Try Supabase management API first
  const sql = [
    "CREATE TABLE IF NOT EXISTS dovive_ocr (",
    "  id bigserial PRIMARY KEY,",
    "  asin text NOT NULL,",
    "  keyword text,",
    "  image_url text,",
    "  image_index integer DEFAULT 0,",
    "  serving_size text,",
    "  servings_per_container text,",
    "  supplement_facts jsonb,",
    "  other_ingredients text,",
    "  health_claims text[],",
    "  certifications text[],",
    "  raw_text text,",
    "  gpt_model text DEFAULT 'gpt-4o',",
    "  processed_at timestamptz DEFAULT now(),",
    "  UNIQUE(asin, image_index)",
    ")"
  ].join(' ');

  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: sql })
  });
  const data = await res.json();
  console.log('Status:', res.status);
  console.log('Result:', JSON.stringify(data).slice(0, 300));
}

main().catch(e => console.error(e.message));
