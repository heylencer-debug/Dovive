require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);
const CAT = 'c1dadd2a-2217-4963-bec5-0ded0f6dff49';

(async () => {
  const { count: total } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', CAT);
  const { count: keepa } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', CAT).not('monthly_sales', 'is', null);
  const { count: reviews } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', CAT).not('review_analysis', 'is', null);
  const { count: ocr } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', CAT).not('all_nutrients', 'is', null);
  const { count: p6 } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', CAT).not('marketing_analysis', 'is', null);
  const { data: brief } = await DASH.from('formula_briefs').select('ingredients').eq('category_id', CAT).single();
  const hasP7 = !!(brief?.ingredients?.market_intelligence?.ai_market_analysis);
  const hasP9 = !!(brief?.ingredients?.ai_generated_brief);

  console.log('=== Collagen Gummies Phase Status ===');
  console.log(`Total products : ${total}`);
  console.log(`P2 Keepa       : ${keepa}/${total} ${keepa >= total * 0.9 ? '✅' : '❌ INCOMPLETE'}`);
  console.log(`P3 Reviews     : ${reviews}/${total} ${reviews >= total * 0.5 ? '✅' : '❌ INCOMPLETE'}`);
  console.log(`P4 OCR         : ${ocr}/${total} ${ocr >= total * 0.8 ? '✅' : '❌ INCOMPLETE'}`);
  console.log(`P6 Product Intel: ${p6}/${total} ${p6 >= total * 0.9 ? '✅' : '❌ INCOMPLETE'}`);
  console.log(`P7 Market Intel : ${hasP7 ? '✅ EXISTS' : '❌ MISSING'}`);
  console.log(`P9 Formula Brief: ${hasP9 ? '✅ EXISTS' : '❌ MISSING'}`);
})();
