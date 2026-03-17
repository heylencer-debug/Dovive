require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);
const DOVIVE = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const CAT = 'c1dadd2a-2217-4963-bec5-0ded0f6dff49';

(async () => {
  // Check review_analysis shape in DASH products
  const { data: products } = await DASH.from('products')
    .select('asin, brand, review_analysis')
    .eq('category_id', CAT)
    .not('review_analysis', 'is', null)
    .limit(2);

  console.log('=== DASH products.review_analysis sample ===');
  console.log(JSON.stringify(products, null, 2).slice(0, 2000));

  // Check raw reviews in dovive_reviews
  const asin = products?.[0]?.asin;
  if (asin) {
    const { data: reviews } = await DOVIVE.from('dovive_reviews')
      .select('asin, rating, title, body, review_date, reviewer_name, verified_purchase')
      .eq('asin', asin).limit(3);
    console.log('\n=== dovive_reviews sample for', asin, '===');
    console.log(JSON.stringify(reviews, null, 2).slice(0, 1500));
  }

  // Count totals
  const { count: dashCount } = await DASH.from('products')
    .select('*', { count: 'exact', head: true })
    .eq('category_id', CAT).not('review_analysis', 'is', null);
  const { count: rawCount } = await DOVIVE.from('dovive_reviews')
    .select('*', { count: 'exact', head: true }).ilike('keyword', '%collagen%');
  console.log(`\n=== Counts ===`);
  console.log(`DASH products with review_analysis: ${dashCount}`);
  console.log(`dovive_reviews (collagen): ${rawCount}`);
})();
