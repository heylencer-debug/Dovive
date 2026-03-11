require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);

async function main() {
  const { data, error } = await DASH
    .from('formula_briefs')
    .select('id, ingredients')
    .eq('category_id', '820537da-3994-4a11-a2e0-a636d751b26f')
    .limit(1)
    .single();

  if (error || !data) { console.error('Fetch error:', error?.message); process.exit(1); }

  const ing = data.ingredients || {};
  const ffb = ing.final_formula_brief || '';

  console.log('final_formula_brief chars:', ffb.length);
  console.log('adjusted_formula chars:', (ing.adjusted_formula || '').length);

  if (!ffb) { console.log('No final_formula_brief found — nothing to patch'); process.exit(0); }

  // Extract Recommended Formula section
  const match = ffb.match(/### Recommended Formula[\s\S]*?(?=\n### |\n## |$)/);
  if (!match) { console.log('Could not find Recommended Formula section in brief'); process.exit(1); }

  const extracted = match[0].trim();
  console.log('Extracted adjusted_formula:', extracted.length, 'chars');
  console.log('Preview:', extracted.slice(0, 200));

  const { error: upErr } = await DASH
    .from('formula_briefs')
    .update({ ingredients: { ...ing, adjusted_formula: extracted } })
    .eq('id', data.id);

  if (upErr) { console.error('Update error:', upErr.message); process.exit(1); }
  console.log('adjusted_formula patched successfully');
}

main().then(() => setTimeout(() => process.exit(0), 500));
