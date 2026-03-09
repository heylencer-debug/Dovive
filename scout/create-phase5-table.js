/**
 * create-phase5-table.js
 * Creates the dovive_phase5_research table in Supabase
 * BMAD Architecture: AD-01
 * Date: 2026-03-09
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const SQL = `
CREATE TABLE IF NOT EXISTS dovive_phase5_research (
  id              bigserial PRIMARY KEY,
  asin            text NOT NULL,
  keyword         text NOT NULL,
  brand           text,
  bsr_rank        integer,

  benefits        jsonb,
  features        jsonb,
  formula_notes   text,

  certifications        jsonb,
  awards                jsonb,
  third_party_tested    boolean DEFAULT false,
  transparency_flag     boolean DEFAULT true,

  reddit_sentiment  text,
  reddit_notes      text,
  reddit_sources    jsonb,

  external_reviews      jsonb,
  healthline_covered    boolean DEFAULT false,
  labdoor_score         text,

  key_weaknesses    text,
  key_strengths     text,
  competitor_angle  text,

  researched_at   timestamptz DEFAULT now(),
  researched_by   text DEFAULT 'scout',
  phase           integer DEFAULT 5,

  UNIQUE(asin, keyword)
);

CREATE INDEX IF NOT EXISTS idx_p5_keyword ON dovive_phase5_research(keyword);
CREATE INDEX IF NOT EXISTS idx_p5_asin    ON dovive_phase5_research(asin);
CREATE INDEX IF NOT EXISTS idx_p5_bsr     ON dovive_phase5_research(bsr_rank ASC);
`;

async function main() {
  console.log('Creating dovive_phase5_research table...');
  const { error } = await sb.rpc('exec_sql', { sql: SQL }).catch(() => ({ error: { message: 'rpc not available' } }));

  if (error) {
    // Supabase free tier doesn't support raw SQL via rpc — use management API instead
    console.log('Direct RPC not available. Use Supabase dashboard SQL editor or management API.');
    console.log('\nRun this SQL in your Supabase SQL editor:\n');
    console.log(SQL);
  } else {
    console.log('Table created successfully.');
  }
}

main();
