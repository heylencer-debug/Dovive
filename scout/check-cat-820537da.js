const DASH = require('@supabase/supabase-js').createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);
const CAT = '820537da-3994-4a11-a2e0-a636d751b26f';

async function main() {
  // Check category record
  const { data: cat } = await DASH.from('categories').select('*').eq('id', CAT).maybeSingle();
  console.log('Category record:', cat ? JSON.stringify(cat).slice(0,200) : 'NOT IN categories table');

  // Count products
  const { count: prodCount } = await DASH.from('products').select('*',{count:'exact',head:true}).eq('category_id',CAT);
  console.log('Products:', prodCount);

  // Check marketing_analysis coverage
  const { count: piCount } = await DASH.from('products').select('*',{count:'exact',head:true}).eq('category_id',CAT).filter('marketing_analysis->product_intelligence','not.is',null);
  console.log('With product_intelligence:', piCount);

  // Check formula_briefs
  const { data: fb } = await DASH.from('formula_briefs').select('id,created_at,ingredients').eq('category_id',CAT).single();
  const ing = fb?.ingredients || {};
  console.log('\nformula_briefs:');
  console.log('  id:', fb?.id);
  console.log('  ai_generated_brief:', (ing.ai_generated_brief||'').length, 'chars');
  console.log('  qa_report:', (ing.qa_report||'').length, 'chars');
  console.log('  market_intelligence:', !!(ing.market_intelligence?.ai_market_analysis));

  // Check category_analyses
  const { data: cas } = await DASH.from('category_analyses').select('id,created_at').eq('category_id',CAT).order('created_at',{ascending:false});
  console.log('\ncategory_analyses records:', cas?.length);
  cas?.forEach(c => console.log(' ', c.id, '|', c.created_at?.split('T')[0]));

  // What does the dashboard query for by name?
  const { data: byName } = await DASH.from('categories').select('id,name').ilike('name','%ashwagandha gummies%');
  console.log('\nCategories matching "ashwagandha gummies":', byName?.length, byName?.map(c=>c.id+' | '+c.name));
}
main().catch(console.error);
