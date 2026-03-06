const https = require('https');
const sql = `
ALTER TABLE dovive_products ADD COLUMN IF NOT EXISTS format_data jsonb DEFAULT '{}';
ALTER TABLE dovive_products ADD COLUMN IF NOT EXISTS price_per_serving numeric;
ALTER TABLE dovive_products ADD COLUMN IF NOT EXISTS total_servings integer;
ALTER TABLE dovive_products ADD COLUMN IF NOT EXISTS main_image text;
ALTER TABLE dovive_products ADD COLUMN IF NOT EXISTS bullet_points jsonb DEFAULT '[]';
ALTER TABLE dovive_products ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE dovive_products ADD COLUMN IF NOT EXISTS ingredients text;
ALTER TABLE dovive_products ADD COLUMN IF NOT EXISTS reviews jsonb DEFAULT '[]';
ALTER TABLE dovive_products ADD COLUMN IF NOT EXISTS certifications jsonb DEFAULT '[]';
ALTER TABLE dovive_products ADD COLUMN IF NOT EXISTS source text DEFAULT 'keyword_search';
ALTER TABLE dovive_specs ADD COLUMN IF NOT EXISTS gummies_data jsonb DEFAULT '{}';
ALTER TABLE dovive_specs ADD COLUMN IF NOT EXISTS powder_data jsonb DEFAULT '{}';
ALTER TABLE dovive_specs ADD COLUMN IF NOT EXISTS format_data jsonb DEFAULT '{}';
ALTER TABLE dovive_specs ADD COLUMN IF NOT EXISTS price_per_serving numeric;
ALTER TABLE dovive_specs ADD COLUMN IF NOT EXISTS sentiment_tags jsonb DEFAULT '[]';
`;
const body = JSON.stringify({ query: sql });
const req = https.request({
  hostname: 'api.supabase.com',
  path: '/v1/projects/fhfqjcvwcxizbioftvdw/database/query',
  method: 'POST',
  headers: {
    'Authorization': 'Bearer sbp_930d9e5fe75da4d2415263ec1d37aaaa8b5aaab7',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  }
}, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => console.log('Status:', res.statusCode, d || '✓ Columns added'));
});
req.on('error', e => console.error(e.message));
req.write(body);
req.end();
