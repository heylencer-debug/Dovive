require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);
const DOVIVE = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function main() {
  // 1. Get ALL collagen category IDs in DASH
  const { data: cats } = await DASH.from('categories').select('id,name').ilike('name','%collagen%');
  console.log(`Found ${cats.length} collagen categories to delete:`);
  cats.forEach(c => console.log(`  - ${c.name} (${c.id})`));

  // 2. Delete all products in those categories
  for (const cat of cats) {
    const { count } = await DASH.from('products').select('*',{count:'exact',head:true}).eq('category_id', cat.id);
    if (count > 0) {
      const { error } = await DASH.from('products').delete().eq('category_id', cat.id);
      if (error) console.log(`  Products delete error for ${cat.name}:`, error.message);
      else console.log(`  Deleted ${count} products from ${cat.name}`);
    }
  }

  // 3. Delete formula_briefs for those categories
  for (const cat of cats) {
    await DASH.from('formula_briefs').delete().eq('category_id', cat.id);
  }

  // 4. Delete all collagen categories
  const { error: catErr } = await DASH.from('categories').delete().ilike('name','%collagen%');
  if (catErr) console.log('Category delete error:', catErr.message);
  else console.log(`✅ All ${cats.length} collagen categories deleted`);

  // 5. Clean dovive_research for collagen gummies
  const { count: resCount } = await DOVIVE.from('dovive_research').select('*',{count:'exact',head:true}).eq('keyword','collagen gummies');
  const { error: resErr } = await DOVIVE.from('dovive_research').delete().eq('keyword','collagen gummies');
  if (resErr) console.log('dovive_research delete error:', resErr.message);
  else console.log(`✅ Deleted ${resCount} collagen gummies records from dovive_research`);

  // 6. Clean dovive_keepa
  const { count: keepaCount } = await DOVIVE.from('dovive_keepa').select('*',{count:'exact',head:true}).eq('keyword','collagen gummies');
  if (keepaCount > 0) {
    await DOVIVE.from('dovive_keepa').delete().eq('keyword','collagen gummies');
    console.log(`✅ Deleted ${keepaCount} collagen records from dovive_keepa`);
  }

  console.log('\n🧹 Clean slate ready. Restart pipeline with: node run-pipeline.js --keyword "collagen gummies"');
}
main().catch(console.error);
