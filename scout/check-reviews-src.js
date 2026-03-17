require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const D = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function main() {
  const { data: sample } = await D.from('dovive_reviews').select('keyword, asin').limit(5);
  console.log('Sample rows:', JSON.stringify(sample));

  const keywords = ['ashwagandha gummies', 'vitamin c gummies', 'collagen gummies', 'elderberry gummies', 'magnesium gummies', 'melatonin gummies'];
  for (const kw of keywords) {
    const { count } = await D.from('dovive_reviews').select('*', { count: 'exact', head: true }).ilike('keyword', '%' + kw.split(' ')[0] + '%');
    console.log(kw + ': ' + count + ' reviews');
  }
}
main().catch(console.error);
