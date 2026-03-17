require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const DOVIVE = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);

const CATS = [
  { name: 'Ashwagandha', id: '820537da-3994-4a11-a2e0-a636d751b26f' },
  { name: 'Collagen',    id: '3e1de3ab-8e76-4b37-bd31-a4b3a2a037d8' },
  { name: 'Elderberry',  id: '98d9d9c7-ecfa-4e74-9874-c59623aed0be' },
];

async function main() {
  for (const cat of CATS) {
    // Get 5 ASINs from DASH with review_analysis
    const { data: dashProds } = await DASH.from('products')
      .select('asin').eq('category_id', cat.id).not('review_analysis', 'is', null).limit(5);
    const dashAsins = (dashProds || []).map(p => p.asin);
    console.log(`\n${cat.name} — DASH ASINs (sample):`, dashAsins.join(', '));

    // Check each against dovive_reviews
    let matchCount = 0;
    for (const asin of dashAsins) {
      const { count } = await DOVIVE.from('dovive_reviews')
        .select('*', { count: 'exact', head: true }).eq('asin', asin);
      if (count > 0) matchCount++;
      console.log(`  ${asin}: ${count} reviews in source`);
    }
    console.log(`  Match rate: ${matchCount}/${dashAsins.length}`);
    
    // Also check cross-direction: get 3 ASINs from dovive_reviews and see if in DASH
    const { data: srcRevs } = await DOVIVE.from('dovive_reviews')
      .select('asin').ilike('keyword', '%' + cat.name.split(' ')[0].toLowerCase() + '%').limit(3);
    const srcAsins = [...new Set((srcRevs || []).map(r => r.asin))];
    console.log(`  Source review ASINs (sample):`, srcAsins.join(', '));
  }
}
main().catch(console.error);
