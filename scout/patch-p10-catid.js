const fs = require('fs');

// Fix phase9-formula-qa.js — dynamic CAT_ID
const p9Path = __dirname + '/phase9-formula-qa.js';
let p9 = fs.readFileSync(p9Path, 'utf8');

const dynLookup = `
  // Dynamic category lookup — no hardcoded CAT_ID
  const { data: catMatches } = await DASH.from('categories')
    .select('id, name').ilike('name', \`%\${KEYWORD}%\`).order('created_at', { ascending: true }).limit(5);
  if (!catMatches?.length) { console.error(\`ERROR: No category found for "\${KEYWORD}"\`); setTimeout(() => process.exit(1), 100); return; }
  let CAT_ID = catMatches[0].id;
  if (catMatches.length > 1) {
    const counts = await Promise.all(catMatches.map(async c => {
      const { count } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', c.id);
      return { ...c, count: count || 0 };
    }));
    CAT_ID = counts.sort((a, b) => b.count - a.count)[0].id;
  }
  console.log(\`Category: \${catMatches.find(c => c.id === CAT_ID)?.name} (\${CAT_ID})\\n\`);
`;

// Insert dynamic lookup before "// Check if already done"
const checkIdx = p9.indexOf('// Check if already done');
if (checkIdx === -1) { console.log('ERROR: target not found'); process.exit(1); }
p9 = p9.slice(0, checkIdx) + dynLookup + '\n  ' + p9.slice(checkIdx);
fs.writeFileSync(p9Path, p9, 'utf8');
console.log('✅ phase9: dynamic CAT_ID added');

// Fix seed-category-analysis.js — dynamic CAT_ID
const seedPath = __dirname + '/seed-category-analysis.js';
let seed = fs.readFileSync(seedPath, 'utf8');

// Check if KEYWORD arg exists
if (!seed.includes('process.argv')) {
  // Add keyword arg parsing and dynamic lookup at the top of the file after requires
  seed = seed.replace(
    "const CAT_ID = '820537da-3994-4a11-a2e0-a636d751b26f';",
    `const KEYWORD_ARG = process.argv.includes('--keyword') ? process.argv[process.argv.indexOf('--keyword') + 1] : 'ashwagandha gummies';
// CAT_ID resolved dynamically in run() — see below`
  );
  console.log('✅ seed: placeholder updated (run() needs manual dynamic lookup)');
} else {
  seed = seed.replace(
    "const CAT_ID = '820537da-3994-4a11-a2e0-a636d751b26f';",
    `const KEYWORD_ARG = process.argv.includes('--keyword') ? process.argv[process.argv.indexOf('--keyword') + 1] : 'ashwagandha gummies';`
  );
  console.log('✅ seed: KEYWORD_ARG added');
}
fs.writeFileSync(seedPath, seed, 'utf8');

// Verify phase9 syntax
const { execSync } = require('child_process');
try {
  execSync(`node -c "${p9Path}"`, { stdio: 'pipe' });
  console.log('✅ phase9 syntax OK');
} catch (e) {
  console.log('❌ phase9 syntax error:', e.stderr?.toString());
}
