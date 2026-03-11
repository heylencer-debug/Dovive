const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'phase9-formula-qa.js');
let content = fs.readFileSync(filePath, 'utf8');

// ── 1. Add FINAL FORMULA BRIEF section to prompt ─────────────────────────────
const competitorJsonSection = `## COMPETITOR_NOTES_JSON`;
const insertAfterPattern = /## COMPETITOR_NOTES_JSON[\s\S]*?\{"ASIN1": "note"[^}]+\}\r?\n/;

const newSection = `
## FINAL FORMULA BRIEF
(Write this LAST — a complete, production-ready formula brief synthesizing Formula A + Formula B + all QA corrections. This is the DOVIVE manufacturing spec we hand to the CMO. As detailed and complete as the input briefs — NOT a summary. Exact structure required:)

### Executive Summary
[2–3 sentences: what makes this formula win in the market, who it is for, the key differentiator]

### Recommended Formula — Per Serving (2 gummies)
| Ingredient | Amount | Form / Grade | Role | Why This Dose |
|---|---|---|---|---|
[All actives — must fit within gummy active load ceiling: 250–350mg actives per gummy max]

### Excipients & Manufacturing Notes
[Pectin, sweeteners, acids, flavors, colors — with CMO instructions]

### Supplement Facts Panel (label-ready)
[Full FDA-compliant block: Serving Size, Servings Per Container, all ingredients, amounts, %DV]

### Certifications Required
| Certification | Priority | Reason |
|---|---|---|

### Flavor & Format
[Flavor name, gummy form, color, texture notes]

### Variant Lineup
[2–3 SKUs with names and key differentiation]

### Pricing & Margin Targets
| Format | MSRP | Est. COGS/serving | Target Margin |
|---|---|---|---|

### Claims (Label + Marketing)
[Approved claims only — structure/function, no disease claims]

### Why DOVIVE Wins This Category
[3–5 bullet points — competitive advantages vs top ASINs analyzed]

`;

// Insert FINAL FORMULA BRIEF section after COMPETITOR_NOTES_JSON block
const competitorBlockMatch = content.match(insertAfterPattern);
if (competitorBlockMatch) {
  const insertIdx = content.indexOf(competitorBlockMatch[0]) + competitorBlockMatch[0].length;
  content = content.slice(0, insertIdx) + newSection + content.slice(insertIdx);
  console.log('✅ FINAL FORMULA BRIEF section injected into prompt');
} else {
  console.log('❌ COMPETITOR_NOTES_JSON block not found — checking manually...');
  const idx = content.indexOf('## COMPETITOR_NOTES_JSON');
  console.log('  idx:', idx, '| snippet:', content.slice(idx, idx + 120));
  process.exit(1);
}

// ── 2. Bump max_tokens from 8000 to 12000 to accommodate full brief ──────────
const oldTokens = `, max_tokens: 8000,`;
const newTokens = `, max_tokens: 12000,`;
if (content.includes(oldTokens)) {
  content = content.replace(oldTokens, newTokens);
  console.log('✅ max_tokens bumped to 12000');
} else {
  console.log('⚠️  max_tokens 8000 not found — may already be changed');
}

// ── 3. Add parser for FINAL FORMULA BRIEF ───────────────────────────────────
const oldParse = `  const adjustedFormulaMatch = qaReport.match(/## ADJUSTED FORMULA SPECIFICATION([\\s\\S]*?)(?:\\n## |$)/);
  const adjustedFormula = adjustedFormulaMatch?.[1]?.trim() || null;`;

const newParse = `  const adjustedFormulaMatch = qaReport.match(/## ADJUSTED FORMULA SPECIFICATION([\\s\\S]*?)(?:\\n## |$)/);
  const adjustedFormula = adjustedFormulaMatch?.[1]?.trim() || null;

  // Parse the complete Final Formula Brief
  const finalBriefMatch = qaReport.match(/## FINAL FORMULA BRIEF([\\s\\S]*?)(?:\\n## COMPETITOR_NOTES_JSON|$)/);
  const finalFormulaBrief = finalBriefMatch?.[1]?.trim() || null;
  if (finalFormulaBrief) {
    console.log(\`  Final Formula Brief parsed: \${Math.round(finalFormulaBrief.length / 1000)}k chars ✅\`);
  } else {
    console.log(\`  ⚠️  Final Formula Brief section not found in QA output\`);
  }`;

if (content.includes(oldParse)) {
  content = content.replace(oldParse, newParse);
  console.log('✅ Final Formula Brief parser added');
} else {
  console.log('❌ adjustedFormulaMatch block not found');
  process.exit(1);
}

// ── 4. Save final_formula_brief to updatedIngredients ───────────────────────
const oldIngredients = `    adjusted_formula: adjustedFormula,`;
const newIngredients = `    adjusted_formula: adjustedFormula,
    final_formula_brief: finalFormulaBrief,`;

if (content.includes(oldIngredients)) {
  content = content.replace(oldIngredients, newIngredients);
  console.log('✅ final_formula_brief added to Supabase save');
} else {
  console.log('❌ adjusted_formula save line not found');
  process.exit(1);
}

// ── 5. Write and verify ──────────────────────────────────────────────────────
fs.writeFileSync(filePath, content, 'utf8');

const { execSync } = require('child_process');
try {
  execSync(`node -c "${filePath}"`, { stdio: 'pipe' });
  console.log('✅ Syntax OK');
} catch (e) {
  console.log('❌ Syntax error:', e.stderr?.toString().slice(0, 300));
  process.exit(1);
}

console.log('\nAll patches applied to phase9-formula-qa.js');
