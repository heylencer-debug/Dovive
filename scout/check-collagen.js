require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const DASH_URL = 'https://jwkitkfufigldpldqtbq.supabase.co';
const DASH_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc';
const DASH = createClient(DASH_URL, DASH_KEY);

async function main() {
  // 1. Total products in DASH
  const { count: total } = await DASH.from('products').select('*',{count:'exact',head:true});
  console.log('Total products in DASH:', total);

  // 2. Check both Collagen Gummies category IDs
  const catIds = [
    '09d5d6ca-e880-454f-9eed-8296df00e6fc',
    '4ad100ef-c70e-4a35-9a18-c16b7dd6d163'
  ];
  for (const id of catIds) {
    const { count } = await DASH.from('products').select('*',{count:'exact',head:true}).eq('category_id', id);
    console.log(`Category ${id}: ${count} products`);
  }

  // 3. Try inserting a test product to verify writes work
  const { error: testErr } = await DASH.from('products').upsert({
    asin: 'TEST-COLLAGEN-001',
    category_id: '09d5d6ca-e880-454f-9eed-8296df00e6fc',
    title: 'Test Collagen Product',
    brand: 'Test Brand',
    price: 9.99
  }, { onConflict: 'asin,category_id' });
  if (testErr) console.log('Write test FAILED:', testErr.message);
  else console.log('Write test SUCCESS - DASH is writable');

  // 4. Check for the test product
  const { count: testCount } = await DASH.from('products').select('*',{count:'exact',head:true}).eq('asin','TEST-COLLAGEN-001');
  console.log('Test product found in DASH:', testCount);

  // 5. Sample of what categories DO have products
  const { data: withProducts } = await DASH.from('products').select('category_id').limit(5);
  console.log('Sample category IDs with products:', [...new Set(withProducts?.map(p=>p.category_id))]);
}
main().catch(console.error);
