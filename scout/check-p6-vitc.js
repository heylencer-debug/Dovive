require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);

async function run() {
  const { data: cats } = await DASH.from('categories').select('id,name').ilike('name', '%vitamin c%');
  console.log('Categories found:', cats?.map(c => `${c.name} (${c.id})`).join('\n  '));

  for (const c of cats || []) {
    const { count: total } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', c.id);
    const { count: hasMA } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', c.id).not('marketing_analysis', 'is', null);
    const { data: sample } = await DASH.from('products').select('marketing_analysis').eq('category_id', c.id).not('marketing_analysis', 'is', null).limit(1);
    const pi = sample?.[0]?.marketing_analysis?.product_intelligence;
    console.log(`\n${c.name}`);
    console.log(`  Total products: ${total}`);
    console.log(`  Has marketing_analysis: ${hasMA}`);
    console.log(`  Has product_intelligence: ${!!pi}`);
    if (pi) console.log(`  Sample PI keys: ${Object.keys(pi).slice(0, 8).join(', ')}`);
    else if (sample?.[0]?.marketing_analysis) console.log(`  marketing_analysis keys: ${Object.keys(sample[0].marketing_analysis).join(', ')}`);
  }
}
run().catch(console.error);
