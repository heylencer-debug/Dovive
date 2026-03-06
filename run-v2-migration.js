const https = require('https');
const fs = require('fs');
const sql = fs.readFileSync('./scout/migrations/001_scout_v2_tables.sql', 'utf8');
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
  res.on('end', () => console.log('Status:', res.statusCode, d || '✓ Migration complete'));
});
req.on('error', e => console.error(e.message));
req.write(body);
req.end();
