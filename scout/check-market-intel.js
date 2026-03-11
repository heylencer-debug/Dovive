const https = require('https');
const pat = 'sbp_930d9e5fe75da4d2415263ec1d37aaaa8b5aaab7';
const query = `SELECT 
  ingredients->>'market_intelligence' as mi_raw,
  ingredients->>'market_intelligence_updated_at' as mi_updated,
  jsonb_typeof(ingredients->'market_intelligence') as mi_type,
  created_at
FROM formula_briefs 
WHERE category_id='820537da-3994-4a11-a2e0-a636d751b26f' LIMIT 1`;
const body = JSON.stringify({ query });
const req = https.request({
  hostname: 'api.supabase.com',
  path: '/v1/projects/jwkitkfufigldpldqtbq/database/query',
  method: 'POST',
  headers: { 'Authorization': `Bearer ${pat}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
}, res => {
  let d = ''; res.on('data', c => d += c); res.on('end', () => {
    const rows = JSON.parse(d);
    const r = rows[0];
    console.log('market_intelligence type:', r.mi_type);
    console.log('market_intelligence length:', (r.mi_raw || '').length);
    const mi = r.mi_raw ? JSON.parse(r.mi_raw) : null;
    if (mi) {
      console.log('market_intelligence keys:', Object.keys(mi).join(', '));
      console.log('ai_market_analysis:', (mi.ai_market_analysis || '').length, 'chars');
    } else {
      console.log('market_intelligence: NULL or empty');
    }
  });
});
req.on('error', console.error); req.write(body); req.end();
