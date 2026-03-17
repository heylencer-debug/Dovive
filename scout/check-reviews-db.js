require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const DOVIVE = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);

async function main() {
  // 1. How many reviews in dovive_reviews?
  const { count, error } = await DOVIVE.from('dovive_reviews')
    .select('*', { count: 'exact', head: true });
  console.log('dovive_reviews total:', count, '| error:', error?.message || 'none');

  // 2. Sample columns
  const { data: s1, error: e1 } = await DOVIVE.from('dovive_reviews').select('*').limit(1);
  if (s1?.[0]) {
    console.log('columns:', Object.keys(s1[0]).join(', '));
    console.log('sample asin:', s1[0].asin, '| rating:', s1[0].rating);
  } else {
    console.log('empty or error:', e1?.message);
  }

  // 3. Look up a known Vitamin C ASIN from DASH
  const { data: vitcProds } = await DASH.from('products')
    .select('asin, review_analysis')
    .eq('category_id', '105df5c1-f8f0-4199-8230-a9f787e9e26c')
    .not('review_analysis', 'is', null)
    .limit(3);

  console.log('\nChecking 3 Vitamin C ASINs against dovive_reviews:');
  for (const p of (vitcProds || [])) {
    const { count: rc, error: re } = await DOVIVE.from('dovive_reviews')
      .select('*', { count: 'exact', head: true }).eq('asin', p.asin);
    const hasTopReviews = !!p.review_analysis?.top_reviews;
    console.log(`  ${p.asin}: ${rc} reviews in dovive_reviews | DASH has top_reviews: ${hasTopReviews} | err: ${re?.message || 'none'}`);
  }

  // 4. Check if reviews are stored in DASH products table itself under a different field
  const { data: s2 } = await DASH.from('products')
    .select('asin, review_analysis')
    .eq('category_id', '105df5c1-f8f0-4199-8230-a9f787e9e26c')
    .not('review_analysis', 'is', null)
    .limit(1);
  if (s2?.[0]) {
    const ra = s2[0].review_analysis;
    console.log('\nDASH review_analysis top-level keys:', Object.keys(ra).join(', '));
    if (ra.top_reviews) console.log('top_reviews structure:', JSON.stringify(ra.top_reviews).slice(0, 200));
  }
}
main().catch(console.error);
