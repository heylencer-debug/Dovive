const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'phase9-formula-qa.js');
let c = fs.readFileSync(file, 'utf8');

// Find the line after the main QA save success log, insert Call 2 invocation
// Target: the line just before "// Save competitor notes to products"

const insertBefore = `  // ── Call 2 invocation ──`;
if (c.includes(insertBefore)) {
  console.log('Call 2 already wired in');
  process.exit(0);
}

// Find "Save competitor notes to products" comment section (has garbled chars)
const compNotesSaveIdx = c.indexOf('if (noteCount > 0) {');
if (compNotesSaveIdx === -1) {
  console.log('ERROR: noteCount block not found');
  process.exit(1);
}

const call2Invocation = `  // ── Call 2 invocation ──────────────────────────────────────────────────────
  const marketIntelText = marketIntelDoc?.report || marketIntelDoc?.ai_market_analysis || '';
  const { comprehensiveComparison, flavorQA, competitorNotes: call2Notes } = await runCall2(
    KEYWORD, grokBrief, claudeBrief, adjustedFormula, competitors, marketIntelText
  );

  // Merge notes — call2 is authoritative
  const finalNotes = { ...competitorNotes, ...call2Notes };
  const finalNoteCount = Object.keys(finalNotes).length;
  console.log(\`Competitor notes total: \${finalNoteCount}\`);

  // Save call2 sections into formula_briefs.ingredients
  if (comprehensiveComparison || flavorQA) {
    const { error: c2Err } = await DASH.from('formula_briefs')
      .update({
        ingredients: {
          ...updatedIngredients,
          comprehensive_comparison: comprehensiveComparison,
          flavor_qa: flavorQA,
          qa_report: updatedIngredients.qa_report
            + (comprehensiveComparison ? '\\n\\n## COMPREHENSIVE INGREDIENT COMPARISON\\n' + comprehensiveComparison : '')
            + (flavorQA ? '\\n\\n## FLAVOR & TASTE QA\\n' + flavorQA : ''),
        }
      })
      .eq('id', briefRow.id);
    if (c2Err) console.error('  Call 2 save error:', c2Err.message);
    else console.log('  Call 2 results saved (comparison + flavor QA) OK');
  }

  `;

c = c.slice(0, compNotesSaveIdx) + call2Invocation + c.slice(compNotesSaveIdx);

// Now update the competitor notes save loop to use finalNotes (not old noteCount)
c = c.replace(
  '  if (noteCount > 0) {\n    console.log(`\\nSaving comparison notes to ${noteCount} products...`);\n    let notesSaved = 0;\n    for (const [asin, note] of Object.entries(finalNotes || {})) {',
  '  if (finalNoteCount > 0) {\n    console.log(`\\nSaving comparison notes to ${finalNoteCount} products...`);\n    let notesSaved = 0;\n    for (const [asin, note] of Object.entries(finalNotes)) {'
);

// Fix old notesSaved log
c = c.replace(
  'console.log(`  \u2705. Notes saved: ${notesSaved}/${noteCount}`);',
  'console.log(`  Notes saved: ${notesSaved}/${finalNoteCount}`);'
);

fs.writeFileSync(file, c, 'utf8');

const { execSync } = require('child_process');
try {
  execSync(`node -c "${file}"`, { stdio: 'pipe' });
  console.log('Syntax OK');
} catch (e) {
  console.log('Syntax error:', e.stderr?.toString().slice(0, 400));
  process.exit(1);
}

console.log('Done — Call 2 wired into run()');
