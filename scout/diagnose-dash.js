require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);

async function check(keyword) {
  // Get category
  const { data: cats } = await DASH.from('categories').select('id,name').ilike('name', `%${keyword}%`);
  if (!cats?.length) { console.log(`No category found for: ${keyword}`); return; }
  const cat = cats[0];
  console.log(`\n=== ${cat.name} (${cat.id}) ===`);

  // Total products
  const { count: total } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', cat.id);
  console.log(`Total products: ${total}`);

  // P4 OCR: supplement_facts_raw
  const { count: ocr } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', cat.id).not('supplement_facts_raw', 'is', null);
  console.log(`P4 OCR (supplement_facts_raw): ${ocr}/${total}`);

  // P4 OCR: all_nutrients
  const { count: nuts } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', cat.id).not('all_nutrients', 'is', null);
  console.log(`P4 all_nutrients: ${nuts}/${total}`);

  // Sample product - what does supplement_facts_raw look like?
  const { data: sample } = await DASH.from('products').select('asin,supplement_facts_raw,all_nutrients').eq('category_id', cat.id).not('supplement_facts_raw', 'is', null).limit(1);
  if (sample?.[0]) {
    const sfr = sample[0].supplement_facts_raw;
    console.log(`supplement_facts_raw type: ${typeof sfr} | value: ${JSON.stringify(sfr).slice(0,120)}`);
  } else {
    console.log('supplement_facts_raw: NO DATA IN ANY PRODUCT');
    // Check all_nutrients instead
    const { data: s2 } = await DASH.from('products').select('asin,all_nutrients').eq('category_id', cat.id).not('all_nutrients', 'is', null).limit(1);
    if (s2?.[0]) console.log(`all_nutrients sample: ${JSON.stringify(s2[0].all_nutrients).slice(0,200)}`);
  }

  // P9 formula_briefs
  const { data: fb } = await DASH.from('formula_briefs').select('id,created_at,ingredients').eq('category_id', cat.id).limit(1);
  if (fb?.[0]) {
    const ing = fb[0].ingredients || {};
    console.log(`formula_briefs: EXISTS (${fb[0].created_at?.split('T')[0]})`);
    console.log(`  ai_generated_brief: ${ing.ai_generated_brief ? Math.round(ing.ai_generated_brief.length/1000)+'k chars' : 'MISSING'}`);
    console.log(`  ai_generated_brief_grok: ${ing.ai_generated_brief_grok ? Math.round(ing.ai_generated_brief_grok.length/1000)+'k chars' : 'MISSING'}`);
    console.log(`  ai_generated_brief_claude: ${ing.ai_generated_brief_claude ? Math.round(ing.ai_generated_brief_claude.length/1000)+'k chars' : 'MISSING'}`);
    console.log(`  market_intelligence: ${ing.market_intelligence?.ai_market_analysis ? 'EXISTS' : 'MISSING'}`);
  } else {
    console.log(`formula_briefs: NONE`);
  }
}

async function main() {
  await check('collagen gummies');
  await check('vitamin c gummies');
}
main().catch(console.error);
