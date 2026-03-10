require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
async function main() {
  const { data, error } = await sb.from('dovive_research')
    .select('asin, title, features, description, ingredients')
    .eq('keyword', 'ashwagandha gummies')
    .limit(3);
  if (error) { console.error(error); return; }
  (data||[]).forEach(p => {
    console.log('ASIN:', p.asin);
    console.log('Features:', JSON.stringify(p.features||[]).substring(0, 300));
    console.log('Ingredients:', (p.ingredients||'none').substring(0, 200));
    console.log('---');
  });

  const { count: withFeatures } = await sb.from('dovive_research').select('*', {count:'exact',head:true}).eq('keyword','ashwagandha gummies').not('features','is',null);
  const { count: withIngredients } = await sb.from('dovive_research').select('*', {count:'exact',head:true}).eq('keyword','ashwagandha gummies').not('ingredients','is',null);
  const { count: withDesc } = await sb.from('dovive_research').select('*', {count:'exact',head:true}).eq('keyword','ashwagandha gummies').not('description','is',null);
  console.log('\nData coverage for ashwagandha gummies (159 total):');
  console.log('With features/bullets:', withFeatures);
  console.log('With ingredients text:', withIngredients);
  console.log('With description:', withDesc);
}
main().catch(console.error);
