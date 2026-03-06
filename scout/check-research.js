const fetch = require('node-fetch');
const ACCESS_TOKEN = 'sbp_930d9e5fe75da4d2415263ec1d37aaaa8b5aaab7';
fetch('https://api.supabase.com/v1/projects/fhfqjcvwcxizbioftvdw/database/query', {
  method: 'POST',
  headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'dovive_research' ORDER BY ordinal_position;` })
}).then(r => r.json()).then(d => d.forEach(c => console.log(c.column_name, '-', c.data_type))).catch(console.error);
