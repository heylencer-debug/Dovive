/**
 * run-phase5-migration.js
 * Creates dovive_phase5_research table via Supabase Management API
 */
require('dotenv').config();
const https = require('https');

const PROJECT_REF = 'fhfqjcvwcxizbioftvdw';
const MANAGEMENT_TOKEN = 'sbp_930d9e5fe75da4d2415263ec1d37aaaa8b5aaab7';

const sql = [
  'CREATE TABLE IF NOT EXISTS dovive_phase5_research (',
  '  id bigserial PRIMARY KEY,',
  '  asin text NOT NULL,',
  '  keyword text NOT NULL,',
  '  brand text,',
  '  bsr_rank integer,',
  '  benefits jsonb,',
  '  features jsonb,',
  '  formula_notes text,',
  '  certifications jsonb,',
  '  awards jsonb,',
  '  third_party_tested boolean DEFAULT false,',
  '  transparency_flag boolean DEFAULT true,',
  '  reddit_sentiment text,',
  '  reddit_notes text,',
  '  reddit_sources jsonb,',
  '  external_reviews jsonb,',
  '  healthline_covered boolean DEFAULT false,',
  '  labdoor_score text,',
  '  key_weaknesses text,',
  '  key_strengths text,',
  '  competitor_angle text,',
  '  researched_at timestamptz DEFAULT now(),',
  '  researched_by text DEFAULT \'scout\',',
  '  phase integer DEFAULT 5,',
  '  UNIQUE(asin, keyword)',
  ');'
].join('\n');

const body = JSON.stringify({ query: sql });

const options = {
  hostname: 'api.supabase.com',
  path: '/v1/projects/' + PROJECT_REF + '/database/query',
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + MANAGEMENT_TOKEN,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  }
};

console.log('Creating dovive_phase5_research table via Supabase Management API...');

const req = https.request(options, res => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    if (res.statusCode === 200 || res.statusCode === 201) {
      console.log('Table created successfully!');
    } else {
      console.log('Response:', data);
    }
  });
});

req.on('error', e => console.error('Error:', e.message));
req.write(body);
req.end();
