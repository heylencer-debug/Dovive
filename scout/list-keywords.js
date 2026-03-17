require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function main() {
  const { data: cats } = await DASH.from('categories').select('name, id').order('name');
  console.log('\n=== DASH Categories (already in dashboard) ===');
  cats?.forEach(c => console.log(' -', c.name));

  const { data: kws } = await sb.from('dovive_keywords').select('keyword, product_count, status').order('created_at', { ascending: false });
  console.log('\n=== dovive_keywords (scraped) ===');
  kws?.forEach(r => console.log(` - ${r.keyword} | ${r.product_count} products | ${r.status}`));
}
main().catch(console.error);
