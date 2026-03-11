require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);

async function main() {
  // Check review_analysis fields for flavor data
  const { data: prods } = await DASH.from('products')
    .select('asin, brand, title, review_analysis, marketing_analysis')
    .eq('category_id', '820537da-3994-4a11-a2e0-a636d751b26f')
    .not('review_analysis', 'is', null)
    .order('bsr_current', { ascending: true })
    .limit(10);

  console.log(`Products with review_analysis: ${prods?.length || 0}`);
  if (prods?.length) {
    const p = prods[0];
    console.log('\n--- Sample review_analysis keys ---');
    const ra = p.review_analysis;
    console.log('Keys:', Object.keys(ra || {}).join(', '));
    console.log('Flavor/taste fields:');
    const flavKeys = Object.keys(ra || {}).filter(k => /flavor|taste|smell|texture|gummy|palatab/i.test(k));
    flavKeys.forEach(k => console.log(` ${k}:`, JSON.stringify(ra[k]).slice(0, 120)));
    if (!flavKeys.length) {
      // Show full structure
      console.log('Full sample:', JSON.stringify(ra).slice(0, 600));
    }
  }

  // Check P5 research for flavor mentions
  const { data: p5 } = await DASH.from('products')
    .select('asin, marketing_analysis')
    .eq('category_id', '820537da-3994-4a11-a2e0-a636d751b26f')
    .not('marketing_analysis->p5_research', 'is', null)
    .limit(3);
  console.log(`\nProducts with p5_research: ${p5?.length || 0}`);
  if (p5?.length) {
    const r = p5[0].marketing_analysis?.p5_research || '';
    const flavorIdx = r.toLowerCase().indexOf('flavor');
    if (flavorIdx > -1) console.log('Flavor mention in P5:', r.slice(flavorIdx - 50, flavorIdx + 200));
  }
}
main().then(() => setTimeout(() => process.exit(0), 500));
