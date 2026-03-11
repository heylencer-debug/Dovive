const fs = require('fs');
const filePath = require('path').join(__dirname, 'phase9-formula-qa.js');
let content = fs.readFileSync(filePath, 'utf8');

// Find the parse block by line numbers and replace it
const lines = content.split('\n');

// Find start: line with "Extract adjusted formula section"
let startIdx = -1, endIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('Extract adjusted formula section')) startIdx = i;
  if (startIdx > -1 && lines[i].includes('Final Formula Brief section not found in QA output')) {
    endIdx = i + 1; break;
  }
}

if (startIdx === -1 || endIdx === -1) {
  console.log('Block not found. startIdx:', startIdx, 'endIdx:', endIdx);
  process.exit(1);
}

console.log(`Replacing lines ${startIdx+1}–${endIdx+1}`);

const newBlock = [
  `  // ── Parse Final Formula Brief FIRST (written first in output) ──────────────`,
  `  const finalBriefMatch = qaReport.match(/## FINAL FORMULA BRIEF([\\s\\S]*?)(?:\\n## QA VERDICT|$)/);`,
  `  const finalFormulaBrief = finalBriefMatch?.[1]?.trim() || null;`,
  `  if (finalFormulaBrief) {`,
  `    console.log(\`  Final Formula Brief: \${Math.round(finalFormulaBrief.length / 1000)}k chars OK\`);`,
  `  } else {`,
  `    console.log(\`  WARNING: Final Formula Brief section not found in QA output\`);`,
  `  }`,
  ``,
  `  // ── Adjusted formula: standalone section OR extracted from brief ─────────────`,
  `  const adjustedFormulaMatch = qaReport.match(/## ADJUSTED FORMULA SPECIFICATION([\\s\\S]*?)(?:\\n## |$)/);`,
  `  const adjustedFormulaFromBrief = finalFormulaBrief`,
  `    ? finalFormulaBrief.match(/### Recommended Formula[\\s\\S]*?(?=\\n### |$)/)?.[0]?.trim() || null`,
  `    : null;`,
  `  const adjustedFormula = adjustedFormulaMatch?.[1]?.trim() || adjustedFormulaFromBrief || null;`,
  `  if (adjustedFormula) {`,
  `    const src = adjustedFormulaMatch ? 'standalone section' : 'extracted from Final Formula Brief';`,
  `    console.log(\`  Adjusted formula: \${Math.round(adjustedFormula.length / 1000)}k chars OK (\${src})\`);`,
  `  } else {`,
  `    console.log(\`  WARNING: Adjusted formula not found\`);`,
  `  }`,
].join('\n');

lines.splice(startIdx, endIdx - startIdx, newBlock);
content = lines.join('\n');
fs.writeFileSync(filePath, content, 'utf8');

const { execSync } = require('child_process');
try {
  execSync(`node -c "${filePath}"`, { stdio: 'pipe' });
  console.log('Syntax OK');
} catch (e) {
  console.log('Syntax error:', e.stderr?.toString().slice(0, 200));
  process.exit(1);
}
console.log('Done');
