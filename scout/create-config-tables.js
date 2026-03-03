const https = require('https');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const sql = `
CREATE TABLE IF NOT EXISTS dovive_scout_config (
  id bigint generated always as identity primary key,
  config_key text UNIQUE NOT NULL,
  config_value jsonb NOT NULL,
  description text,
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dovive_scout_changelog (
  id bigint generated always as identity primary key,
  version text NOT NULL,
  change_type text,
  description text,
  changed_by text DEFAULT 'perci',
  changed_at timestamptz DEFAULT now()
);
ALTER TABLE dovive_scout_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE dovive_scout_changelog ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='dovive_scout_config' AND policyname='anon_all_config') THEN
    CREATE POLICY anon_all_config ON dovive_scout_config FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='dovive_scout_changelog' AND policyname='anon_all_changelog') THEN
    CREATE POLICY anon_all_changelog ON dovive_scout_changelog FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;
`;

const MGMT_TOKEN = 'sbp_930d9e5fe75da4d2415263ec1d37aaaa8b5aaab7';
const body = JSON.stringify({ query: sql });

const req = https.request({
  hostname: 'api.supabase.com',
  path: '/v1/projects/fhfqjcvwcxizbioftvdw/database/query',
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + MGMT_TOKEN,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  }
}, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => console.log('Status:', res.statusCode, d));
});
req.on('error', e => console.error(e.message));
req.write(body);
req.end();
