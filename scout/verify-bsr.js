const fetch = require('node-fetch');
const SUPABASE_URL = 'https://fhfqjcvwcxizbioftvdw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoZnFqY3Z3Y3hpemJpb2Z0dmR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNTcxMzgsImV4cCI6MjA4NzkzMzEzOH0.g8K40DjhvxE7u4JdHICqKc1dMxS4eZdMhfA11M8ZMBc';

fetch(`${SUPABASE_URL}/rest/v1/dovive_bsr_products?select=keyword,asin,title`, {
  headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
})
.then(r => r.json())
.then(rows => {
  const counts = {};
  rows.forEach(r => counts[r.keyword] = (counts[r.keyword] || 0) + 1);
  console.log('\nBSR Product Summary:');
  console.log('Total rows:', rows.length);
  console.log('\nPer keyword:');
  Object.entries(counts).sort().forEach(([kw, count]) => {
    console.log(`  ${kw}: ${count} products`);
  });
  console.log('\nFirst 5 products:');
  rows.slice(0, 5).forEach(r => {
    console.log(`  [${r.asin}] ${r.keyword}: ${r.title.slice(0, 70)}`);
  });
})
.catch(console.error);
