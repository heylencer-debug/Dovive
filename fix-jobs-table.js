const https = require('https');
const sql = `
ALTER TABLE dovive_jobs ADD COLUMN IF NOT EXISTS current_keyword text;
ALTER TABLE dovive_jobs ADD COLUMN IF NOT EXISTS current_product_type text;
ALTER TABLE dovive_jobs ADD COLUMN IF NOT EXISTS products_scraped integer DEFAULT 0;
ALTER TABLE dovive_jobs ADD COLUMN IF NOT EXISTS reviews_scraped integer DEFAULT 0;
ALTER TABLE dovive_jobs ADD COLUMN IF NOT EXISTS progress_pct integer DEFAULT 0;
ALTER TABLE dovive_jobs ADD COLUMN IF NOT EXISTS eta_seconds integer;
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
  res.on('end', () => console.log('Status:', res.statusCode, d || 'OK'));
});
req.on('error', e => console.error(e.message));
req.write(body);
req.end();
