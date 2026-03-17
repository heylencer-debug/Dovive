require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fetch = require('node-fetch');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
async function main() {
  // Get Keepa key from Supabase config table
  const res = await fetch(`${SUPABASE_URL}/rest/v1/dovive_scout_config?config_key=eq.keepa_api_key&select=config_value`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  const data = await res.json();
  if (!data.length) { console.log('❌ Keepa key not found in dovive_scout_config'); return; }
  const keepaKey = data[0].config_value.replace(/"/g, '');
  console.log('Keepa key found:', keepaKey.slice(0, 8) + '...');
  // Test Keepa API
  const r2 = await fetch(`https://api.keepa.com/token?key=${keepaKey}`);
  const t = await r2.json();
  if (t.tokensLeft !== undefined) {
    console.log('✅ Keepa CONNECTED');
    console.log('   Tokens left:', t.tokensLeft);
    console.log('   Refill in:', Math.round((t.refillIn || 0) / 60), 'mins');
  } else {
    console.log('❌ Keepa ERROR:', JSON.stringify(t));
  }
}
main().catch(e => console.log('Error:', e.message));
