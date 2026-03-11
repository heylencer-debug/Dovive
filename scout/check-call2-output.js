require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);
async function main() {
  const { data } = await DASH.from('formula_briefs')
    .select('ingredients')
    .eq('category_id', '820537da-3994-4a11-a2e0-a636d751b26f')
    .single();
  const ing = data?.ingredients || {};
  console.log('comprehensive_comparison chars:', (ing.comprehensive_comparison||'').length);
  console.log('flavor_qa chars:', (ing.flavor_qa||'').length);
  // Check products for qa_comparison_note
  const { data: prods, count } = await DASH.from('products')
    .select('asin, marketing_analysis', { count: 'exact' })
    .eq('category_id', '820537da-3994-4a11-a2e0-a636d751b26f')
    .not('marketing_analysis->qa_comparison_note', 'is', null)
    .limit(5);
  console.log('\nProducts with qa_comparison_note:', count);
  prods?.forEach(p => console.log(' ', p.asin, ':', p.marketing_analysis?.qa_comparison_note?.slice(0,80)));
}
main().then(() => setTimeout(() => process.exit(0), 500));
