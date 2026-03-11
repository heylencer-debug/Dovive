const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'phase9-formula-qa.js');
let c = fs.readFileSync(file, 'utf8');

const lines = c.split('\n');
const startIdx = lines.findIndex(l => l.includes('if (noteCount > 0)'));
if (startIdx === -1) { console.log('Block already fixed or not found'); process.exit(0); }

// Find the closing bracket
let depth = 0, endIdx = -1;
for (let i = startIdx; i < lines.length; i++) {
  depth += (lines[i].match(/\{/g)||[]).length - (lines[i].match(/\}/g)||[]).length;
  if (depth <= 0 && i > startIdx) { endIdx = i; break; }
}
console.log(`Replacing lines ${startIdx+1}–${endIdx+1}`);

const newBlock = `  if (finalNoteCount > 0) {
    console.log('Saving ' + finalNoteCount + ' competitor notes to products...');
    let notesSaved = 0;
    for (const [asin, note] of Object.entries(finalNotes)) {
      const { data: prod } = await DASH.from('products')
        .select('marketing_analysis').eq('asin', asin).single();
      if (!prod) continue;
      const existing = prod.marketing_analysis || {};
      const { error: ne } = await DASH.from('products').update({
        marketing_analysis: { ...existing, qa_comparison_note: note }
      }).eq('asin', asin);
      if (!ne) notesSaved++;
    }
    console.log('  Notes saved to products: ' + notesSaved + '/' + finalNoteCount + ' OK');
  } else {
    console.log('  No competitor notes generated');
  }`;

lines.splice(startIdx, endIdx - startIdx + 1, newBlock);
c = lines.join('\n');
fs.writeFileSync(file, c, 'utf8');

const { execSync } = require('child_process');
try {
  execSync(`node -c "${file}"`, { stdio: 'pipe' });
  console.log('Syntax OK');
} catch (e) {
  console.log('Syntax error:', e.stderr?.toString().slice(0, 300));
  process.exit(1);
}
console.log('Done');
