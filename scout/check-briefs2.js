const https = require('https');
const pat = 'sbp_930d9e5fe75da4d2415263ec1d37aaaa8b5aaab7';
const query = `SELECT ingredients FROM formula_briefs WHERE category_id='820537da-3994-4a11-a2e0-a636d751b26f' LIMIT 1`;
const body = JSON.stringify({ query });
const req = https.request({
  hostname: 'api.supabase.com',
  path: '/v1/projects/jwkitkfufigldpldqtbq/database/query',
  method: 'POST',
  headers: { 'Authorization': `Bearer ${pat}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
}, res => {
  let d = ''; res.on('data', c => d += c); res.on('end', () => {
    const rows = JSON.parse(d);
    const ing = rows[0].ingredients;
    console.log('adjusted_formula:', (ing.adjusted_formula || '').length, 'chars');
    console.log('adjusted_formula preview:', (ing.adjusted_formula || 'EMPTY').slice(0, 300));
    console.log('qa_verdict:', ing.qa_verdict);
    console.log('qa_score:', ing.qa_score);
    console.log('formula_brief_model_grok:', ing.formula_brief_model_grok);
    console.log('formula_brief_model_claude:', ing.formula_brief_model_claude);
  });
});
req.on('error', console.error); req.write(body); req.end();
