/**
 * Migration: Create dovive_history table
 * Logs every scrape run per ASIN+keyword for trend tracking.
 * Run once: node migrations/create-history-table.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function run() {
  console.log('Creating dovive_history table...');

  const { error } = await supabase.rpc('exec_sql', {
    sql: `
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
    `
  });

  if (error) {
    console.error('RPC failed — try running SQL directly in Supabase dashboard:');
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
  } else {
    console.log('✅ dovive_history table created!');
  }
}

run();
