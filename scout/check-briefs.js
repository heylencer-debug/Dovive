const https = require('https');

const pat = 'sbp_930d9e5fe75da4d2415263ec1d37aaaa8b5aaab7';
const query = "SELECT id, ingredients FROM formula_briefs WHERE category_id='820537da-3994-4a11-a2e0-a636d751b26f' LIMIT 1";

const body = JSON.stringify({ query });
const options = {
  hostname: 'api.supabase.com',
  path: '/v1/projects/jwkitkfufigldpldqtbq/database/query',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${pat}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const rows = JSON.parse(data);
    if (!Array.isArray(rows) || rows.length === 0) { console.log('No rows:', data); return; }
    const ing = rows[0].ingredients || {};
    console.log('Formula brief keys:', Object.keys(ing).join(', '));
    console.log('ai_generated_brief:', (ing.ai_generated_brief || '').length, 'chars');
    console.log('ai_generated_brief_grok:', (ing.ai_generated_brief_grok || '').length, 'chars');
    console.log('ai_generated_brief_claude:', (ing.ai_generated_brief_claude || '').length, 'chars');
    console.log('qa_report:', (ing.qa_report || '').length, 'chars');
  });
});
req.on('error', console.error);
req.write(body);
req.end();
