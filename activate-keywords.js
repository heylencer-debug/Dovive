const https = require('https');
const sql = 'UPDATE dovive_keywords SET active = true WHERE id IN (6,7,8,9,10,11,12,13,14)';
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
  res.on('end', () => console.log(res.statusCode, d || 'OK - all 9 keywords activated'));
});
req.on('error', e => console.error(e.message));
req.write(body);
req.end();
