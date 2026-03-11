const https = require('https');
const body = JSON.stringify({
  query: `SELECT ingredients->>'final_formula_brief' as ffb FROM formula_briefs WHERE category_id='820537da-3994-4a11-a2e0-a636d751b26f' LIMIT 1`
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
  let d = ''; res.on('data', c => d += c);
  res.on('end', () => {
    const ffb = JSON.parse(d)[0].ffb || '';
    const sections = [...ffb.matchAll(/^### .+/gm)].map(m => m[0]);
    console.log('total chars:', ffb.length);
    console.log('subsections:', sections.join('\n'));
    const recIdx = ffb.indexOf('Recommended Formula');
    console.log('\n--- Recommended Formula section (first 600 chars) ---');
    console.log(ffb.slice(recIdx, recIdx + 600));
  });
});
req.on('error', console.error); req.write(body); req.end();
