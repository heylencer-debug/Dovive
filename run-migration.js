const https = require('https');

const sql = [
  "DELETE FROM dovive_research WHERE id NOT IN (SELECT MIN(id) FROM dovive_research GROUP BY asin, keyword)",
  "ALTER TABLE dovive_research DROP CONSTRAINT IF EXISTS dovive_research_asin_keyword_key",
  "ALTER TABLE dovive_research ADD CONSTRAINT dovive_research_asin_keyword_key UNIQUE (asin, keyword)",
  "DELETE FROM dovive_reports WHERE id NOT IN (SELECT MIN(id) FROM dovive_reports GROUP BY keyword)",
  "ALTER TABLE dovive_reports DROP CONSTRAINT IF EXISTS dovive_reports_keyword_key",
  "ALTER TABLE dovive_reports ADD CONSTRAINT dovive_reports_keyword_key UNIQUE (keyword)"
].join('; ');

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
  res.on('end', () => console.log('Status:', res.statusCode, d));
});
req.on('error', e => console.error(e.message));
req.write(body);
req.end();
