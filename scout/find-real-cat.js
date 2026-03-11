const DASH = require('@supabase/supabase-js').createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);

async function main() {
  // Find ashwagandha categories
  const { data: cats } = await DASH.from('categories').select('id,name,keyword,slug').or('name.ilike.%ashwagandha%,keyword.ilike.%ashwagandha%,slug.ilike.%ashwagandha%');
  console.log('Ashwagandha categories:');
  cats?.forEach(c => console.log(' ', c.id, '|', c.name, '| kw:', c.keyword, '| slug:', c.slug));

  // Find products mentioning ashwagandha in title
  const { data: prods } = await DASH.from('products').select('asin,category_id,brand,title').ilike('title', '%ashwagandha%').ilike('title', '%gumm%').limit(5);
  console.log('\nAshwagandha gummy products:');
  prods?.forEach(p => console.log(' ', p.asin, '| cat:', p.category_id, '|', p.brand, '|', p.title?.slice(0,60)));

  // Count products per category for ashwagandha cats
  if (cats?.length) {
    console.log('\nProduct counts per category:');
    for (const c of cats) {
      const { count } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', c.id);
      console.log(' ', c.name, ':', count, 'products | id:', c.id);
    }
  }
}
main().catch(console.error);
