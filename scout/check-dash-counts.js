const DASH = require('@supabase/supabase-js').createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);

async function main() {
  const tables = ['products','categories','formula_briefs','category_analyses'];
  for (const t of tables) {
    const { count, error } = await DASH.from(t).select('*', { count: 'exact', head: true });
    console.log(t + ':', count, 'rows', error ? '| ERROR: ' + error.message : '');
  }

  // Check what category_id the products use
  const { data: prods } = await DASH.from('products').select('asin,category_id,brand').limit(3);
  console.log('\nSample products:');
  prods?.forEach(p => console.log(' ', p.asin, '| cat:', p.category_id, '|', p.brand));

  // Get formula_briefs
  const { data: fbs } = await DASH.from('formula_briefs').select('id,category_id,created_at,positioning').order('created_at', { ascending: false });
  console.log('\nformula_briefs:');
  fbs?.forEach(f => console.log(' ', f.id, '| cat:', f.category_id, '|', f.created_at?.split('T')[0], '|', (f.positioning || '').slice(0, 60)));
}
main().catch(console.error);
