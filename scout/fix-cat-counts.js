require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);

// All Scout-managed categories - update total_products from actual product count
const SCOUT_CATS = [
  { id: 'c1dadd2a-2217-4963-bec5-0ded0f6dff49', name: 'Collagen Gummies' },
  { id: '98d9d9c7-ecfa-4e74-9874-c59623aed0be', name: 'Elderberry Gummies' },
  { id: 'ac2763b7-08bf-4d33-b384-7df18552a311', name: 'Magnesium Gummies' },
  { id: '820537da-3994-4a11-a2e0-a636d751b26f', name: 'Ashwagandha Gummies' },
  { id: '992bf7a2-c744-4e6f-b9cc-a1e80a6f5ccd', name: 'Melatonin Gummies' },
];

async function main() {
  for (const cat of SCOUT_CATS) {
    const { count } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', cat.id);
    const { error } = await DASH.from('categories').update({
      total_products: count,
      updated_at: new Date().toISOString(),
      run_timestamp: new Date().toISOString()
    }).eq('id', cat.id);
    if (error) console.log(`${cat.name}: ERROR - ${error.message}`);
    else console.log(`${cat.name}: updated total_products=${count}`);
  }
}
main().catch(console.error);
