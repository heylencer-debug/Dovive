const fs = require('fs');
const path = require('path');

const seedPath = path.join(__dirname, 'seed-category-analysis.js');
let content = fs.readFileSync(seedPath, 'utf8');

// 1. Make it accept --cat-id and --keyword flags so pipeline can pass correct values
const newHeader = `require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);

const KEYWORD_ARG = process.argv.includes('--keyword') ? process.argv[process.argv.indexOf('--keyword') + 1] : 'ashwagandha gummies';
const CAT_ID_ARG  = process.argv.includes('--cat-id')  ? process.argv[process.argv.indexOf('--cat-id')  + 1] : null;

async function resolveCatId() {
  if (CAT_ID_ARG) return CAT_ID_ARG;
  // Dynamic lookup by keyword
  const { data: cats } = await DASH.from('categories').select('id,name').ilike('name', \`%\${KEYWORD_ARG}%\`).order('created_at', { ascending: true }).limit(5);
  if (!cats?.length) throw new Error(\`No category found for "\${KEYWORD_ARG}"\`);
  if (cats.length === 1) return cats[0].id;
  const counts = await Promise.all(cats.map(async c => {
    const { count } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', c.id);
    return { ...c, count: count || 0 };
  }));
  return counts.sort((a, b) => b.count - a.count)[0].id;
}

`;

// Replace the old header (up to the record definition)
const recordIdx = content.indexOf('const record = {');
if (recordIdx === -1) { console.log('ERROR: record not found'); process.exit(1); }
content = newHeader + content.slice(recordIdx);

// Fix the record to use dynamic CAT_ID
content = content.replace(
  "const record = {\n  category_id: CAT_ID,\n  category_name: 'ashwagandha gummies',",
  "const buildRecord = (catId, keyword) => ({\n  category_id: catId,\n  category_name: keyword,"
);

// Close the record properly and update main()
content = content.replace(
  'async function main() {\n  console.log(\'Inserting category_analyses for ashwagandha gummies...\');\n  const { data, error } = await DASH.from(\'category_analyses\').insert(record).select(\'id\');',
  `async function main() {
  const catId = await resolveCatId();
  const record = buildRecord(catId, KEYWORD_ARG);
  console.log(\`Inserting category_analyses for \${KEYWORD_ARG} (cat: \${catId})...\`);
  const { data, error } = await DASH.from('category_analyses').insert(record).select('id');`
);
content = content.replace(
  ".upsert(record, { onConflict: 'category_id' })",
  ".upsert(record, { onConflict: 'category_id' })"
);

// Fix the closing bracket issue from buildRecord
const lastBraceIdx = content.lastIndexOf('};');
content = content.slice(0, lastBraceIdx) + '});';

fs.writeFileSync(seedPath, content, 'utf8');
console.log('✅ seed patched with dynamic CAT_ID lookup');

const { execSync } = require('child_process');
try { execSync(`node -c "${seedPath}"`, { stdio: 'pipe' }); console.log('✅ syntax OK'); }
catch (e) { console.log('❌ syntax error:', e.stderr?.toString().slice(0, 200)); }
