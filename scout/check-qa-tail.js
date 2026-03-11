const https = require('https');
const body = JSON.stringify({
  query: `SELECT ingredients->>'qa_report' as qr FROM formula_briefs WHERE category_id='820537da-3994-4a11-a2e0-a636d751b26f' LIMIT 1`
});
const req = https.request({
  hostname: 'api.supabase.com',
  path: '/v1/projects/jwkitkfufigldpldqtbq/database/query',
  method: 'POST',
  headers: {
    'Authorization': 'Bearer sbp_930d9e5fe75da4d2415263ec1d37aaaa8b5aaab7',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  }
}, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const qr = JSON.parse(d)[0].qr;
    console.log('Total chars:', qr.length);
    // Show all section headings found
    const sections = [...qr.matchAll(/^## .+/gm)].map(m => m[0]);
    console.log('\nSections found:');
    sections.forEach(s => console.log(' ', s));
    console.log('\nLast 600 chars:');
    console.log(qr.slice(-600));
  });
});
req.on('error', console.error);
req.write(body);
req.end();
