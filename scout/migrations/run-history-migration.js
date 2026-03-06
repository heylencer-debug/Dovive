require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function main() {
  console.log('Running dovive_history migration...');

  // Try creating via direct REST (PostgREST doesn't support DDL — need pg endpoint)
  // Use Supabase management API or pg directly
  // Fallback: test if table exists by querying it
  const testRes = await fetch(`${SUPABASE_URL}/rest/v1/dovive_history?limit=1`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });

  if (testRes.ok) {
    console.log('✅ dovive_history table already exists!');
    return;
  }

  const status = testRes.status;
  const body = await testRes.text();
  console.log(`Table check: ${status} — ${body}`);

  if (status === 404 || body.includes('does not exist') || body.includes('relation')) {
    console.log('Table does not exist. Please run this SQL in Supabase dashboard SQL Editor:');
    console.log(`
CREATE TABLE IF NOT EXISTS dovive_history (
  id            bigserial PRIMARY KEY,
  asin          text NOT NULL,
  keyword       text NOT NULL,
  title         text,
  brand         text,
  price         numeric,
  bsr           integer,
  rating        numeric,
  review_count  integer,
  rank_position integer,
  is_sponsored  boolean,
  category      text,
  source        text,
  scraped_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dovive_history_asin_idx    ON dovive_history(asin);
CREATE INDEX IF NOT EXISTS dovive_history_keyword_idx ON dovive_history(keyword);
CREATE INDEX IF NOT EXISTS dovive_history_scraped_idx ON dovive_history(scraped_at DESC);
    `);
  }
}

main().catch(console.error);
