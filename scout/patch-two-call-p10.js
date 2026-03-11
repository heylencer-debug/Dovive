/**
 * Adds a second dedicated API call to phase9-formula-qa.js
 * Call 1 (existing): Final Formula Brief + QA Verdict + Issues/Warnings (8k tokens)
 * Call 2 (new): Comprehensive Ingredient Comparison + Flavor QA + Competitor Notes (6k tokens)
 */
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'phase9-formula-qa.js');
let c = fs.readFileSync(file, 'utf8');

// ── Add buildCall2Prompt function before run() ────────────────────────────────
const runFnMarker = `async function run() {`;
const call2Fn = `
// ── Build focused Call 2 prompt (Comparison + Flavor + Competitor Notes) ──────
function buildCall2Prompt(keyword, grokBrief, claudeBrief, adjustedFormula, competitors, marketIntel) {
  const top10 = (competitors || []).slice(0, 10);

  // Build competitor ingredient table data
  const compRows = top10.map((c, i) => {
    const sf = (c.supplement_facts_raw || '').slice(0, 500);
    const rev = c.monthly_revenue ? \`$\${Math.round(c.monthly_revenue / 1000)}k/mo\` : 'N/A';
    return \`### Competitor \${i + 1}: \${c.brand} | BSR \${c.bsr_current} | \${rev} | $\${c.price}
ASIN: \${c.asin}
Supplement Facts: \${sf || 'Not available'}
Rating: \${c.rating_value} (\\${c.rating_count} reviews)
\`;
  }).join('\\n');

  // Flavor intelligence from competitor data
  const flavorData = top10.map(c => {
    const raw = ((c.supplement_facts_raw || '') + ' ' + ((c.marketing_analysis?.other_ingredients) || '')).toLowerCase();
    const flavors = ['strawberry','raspberry','lemon','mango','peach','cherry','mixed berry','apple','watermelon','citrus','blackberry','tropical']
      .filter(f => raw.includes(f));
    return flavors.length ? \`- \${c.brand}: \${flavors.join(', ')}\` : null;
  }).filter(Boolean).join('\\n') || '- Flavor data not found in supplement facts';

  const adjFormulaSummary = (adjustedFormula || '').slice(0, 1000);
  const grokSummary = (grokBrief || '').slice(0, 2000);
  const claudeSummary = (claudeBrief || '').slice(0, 2000);
  const miSummary = (marketIntel || '').slice(0, 1500);

  return \`You are a supplement product analyst and flavor scientist. Generate THREE sections for DOVIVE's \${keyword} product.

## DOVIVE FORMULA CONTEXT
### Adjusted Formula (QA-approved):
\${adjFormulaSummary}

### Formula A Summary (Grok 4.2 P9):
\${grokSummary}

### Formula B Summary (Claude Opus 4.6 P9):
\${claudeSummary}

## MARKET INTELLIGENCE
\${miSummary}

## TOP COMPETITOR FORMULAS
\${compRows}

## COMPETITOR FLAVOR PROFILES (detected from supplement facts)
\${flavorData}

---

Generate exactly these three sections. Use exact headings.

## COMPREHENSIVE INGREDIENT COMPARISON
Build a complete table comparing DOVIVE's adjusted formula against top 5 competitors for every active ingredient. Be specific with exact mg amounts from the competitor data above.

| Ingredient | DOVIVE (Adjusted) | Comp #1 | Comp #2 | Comp #3 | Comp #4 | Comp #5 | Clinical Range | Market Verdict |
|---|---|---|---|---|---|---|---|---|
[One row per active ingredient. Use exact mg from supplement facts. Market Verdict: Under-dosed / Clinical / Over-dosed / Not common]

**DOVIVE Unique Differentiators** (what we have that competitors don't at clinical dose):
[bullet list]

**Competitive Gaps** (what competitors have that we're missing or under-dosing):
[bullet list]

**Why our formula wins overall:**
[2-3 sentence summary]

## FLAVOR & TASTE QA
(Gummies live or die on taste — critical for repeat purchases and reviews)

**Category Flavor Intelligence:**
- Top competitor flavors: [from data above]
- Ashwagandha masking challenge: ashwagandha has an earthy/bitter/slightly sulfuric note at 600mg — this MUST be aggressively masked
- What 1-star reviews say: [common taste complaints in supplement gummy category]

**Recommended Flavor Strategy for DOVIVE \${keyword}:**
| Element | Recommendation | Reason |
|---|---|---|
| Primary flavor | [specific flavor name] | [why it masks ashwagandha best] |
| Flavor intensity | [mild/medium/bold] | [balance with active taste] |
| Sweetener system | [stevia / monk fruit / erythritol blend + amounts] | [sugar-free, no aftertaste] |
| Masking agent | [citric acid / natural flavor blend] | [cuts bitterness] |
| Color | [natural color] | [consumer expectation] |
| Texture target | [firm/soft, chew time] | [gummy standard] |

**Pilot Testing Priority:** [what to test first in CMO pilot runs]
**Risk:** [main taste risk and how to mitigate]

## COMPETITOR_NOTES_JSON
Return ONLY a valid JSON object. One entry per ASIN. One sentence comparing their formula to ours. Focus on the most important difference (dose, ingredient quality, or certification).
{"ASIN": "comparison note", ...}
\`;
}

async function runCall2(keyword, grokBrief, claudeBrief, adjustedFormula, competitors, marketIntelText) {
  console.log(\`\\nRunning Call 2: Comprehensive Comparison + Flavor QA + Competitor Notes...\`);
  const prompt = buildCall2Prompt(keyword, grokBrief, claudeBrief, adjustedFormula, competitors, marketIntelText);
  console.log(\`  Prompt size: \${Math.round(prompt.length / 1000)}k chars\`);
  const result = await callClaudeOpusQA(prompt, 6000);
  console.log(\`  Call 2 done: \${Math.round(result.length / 1000)}k chars\`);

  // Parse sections from call 2
  const comparisonMatch = result.match(/## COMPREHENSIVE INGREDIENT COMPARISON([\\s\\S]*?)(?:\\n## FLAVOR|$)/);
  const flavorMatch     = result.match(/## FLAVOR & TASTE QA([\\s\\S]*?)(?:\\n## COMPETITOR_NOTES_JSON|$)/);
  const notesMatch      = result.match(/## COMPETITOR_NOTES_JSON([\\s\\S]*)/);

  const comprehensiveComparison = comparisonMatch?.[1]?.trim() || null;
  const flavorQA                = flavorMatch?.[1]?.trim() || null;
  const notesRaw                = notesMatch?.[1]?.trim() || '';

  // Parse competitor notes JSON
  const jsonBlock = notesRaw.replace(/\`\`\`json\\n?/g, '').replace(/\`\`\`\\n?/g, '').trim();
  let competitorNotes = {};
  try {
    const obj = jsonBlock.match(/\\{[\\s\\S]*\\}/)?.[0];
    competitorNotes = obj ? JSON.parse(obj) : {};
  } catch {}

  console.log(\`  Comprehensive comparison: \${comprehensiveComparison ? Math.round(comprehensiveComparison.length/1000)+'k chars OK' : 'MISSING'}\`);
  console.log(\`  Flavor QA: \${flavorQA ? Math.round(flavorQA.length/1000)+'k chars OK' : 'MISSING'}\`);
  console.log(\`  Competitor notes: \${Object.keys(competitorNotes).length} ASINs\`);

  return { comprehensiveComparison, flavorQA, competitorNotes };
}

async function run() {`;

if (!c.includes('buildCall2Prompt')) {
  c = c.replace(runFnMarker, call2Fn);
  console.log('Added buildCall2Prompt + runCall2 functions');
} else {
  console.log('call2 functions already exist');
}

// ── Wire Call 2 into run() after main QA save ─────────────────────────────────
// Find the save block and add call 2 after it
const afterSaveMarker = `  else console.log(\`  \${String.fromCharCode(9989)}. Saved to formula_briefs.ingredients.qa_report\`);`;

const call2WireIn = `
  // ── Call 2: Comprehensive Comparison + Flavor QA + Competitor Notes ──────────
  const { comprehensiveComparison, flavorQA, competitorNotes: call2Notes } = await runCall2(
    KEYWORD, grokBrief, claudeBrief, adjustedFormula, competitors,
    marketIntelDoc?.report || marketIntelDoc?.ai_market_analysis || ''
  );

  // Merge competitor notes (call 2 is authoritative)
  let finalNotes = { ...competitorNotes, ...call2Notes };
  const noteCount = Object.keys(finalNotes).length;
  console.log(\`Competitor notes total: \${noteCount}\\n\`);

  // Save call 2 results to formula_briefs
  if (comprehensiveComparison || flavorQA) {
    const { error: c2Err } = await DASH.from('formula_briefs')
      .update({
        ingredients: {
          ...updatedIngredients,
          comprehensive_comparison: comprehensiveComparison,
          flavor_qa: flavorQA,
        }
      })
      .eq('id', briefRow.id);
    if (c2Err) console.error('  Call 2 save error:', c2Err.message);
    else console.log('  Call 2 results saved to Supabase OK');
  }
`;

// Find the marker and insert after
if (!c.includes('Call 2: Comprehensive Comparison') && c.includes('Saved to formula_briefs.ingredients.qa_report')) {
  // Find position of the save log line
  const markerIdx = c.indexOf('Saved to formula_briefs.ingredients.qa_report');
  const lineEnd = c.indexOf('\n', markerIdx) + 1;
  c = c.slice(0, lineEnd) + call2WireIn + c.slice(lineEnd);
  console.log('Call 2 wired into run() after main save');
} else if (c.includes('Call 2: Comprehensive Comparison')) {
  console.log('Call 2 already wired in');
} else {
  console.log('WARNING: Could not find save marker');
}

// ── Update competitor notes save loop to use finalNotes ───────────────────────
c = c.replace(
  'for (const [asin, note] of Object.entries(finalNotes)) {',
  'for (const [asin, note] of Object.entries(finalNotes || {})) {'
);

// ── Also append call2 sections to the qa_report for PDF download ──────────────
const qaReportSave = `    qa_report: qaReport,`;
const qaReportEnhanced = `    qa_report: qaReport + (comprehensiveComparison ? '\\n\\n## COMPREHENSIVE INGREDIENT COMPARISON\\n' + comprehensiveComparison : '') + (flavorQA ? '\\n\\n## FLAVOR & TASTE QA\\n' + flavorQA : ''),`;

// Only do this if not already enhanced
if (c.includes('    qa_report: qaReport,') && !c.includes('comprehensiveComparison ?')) {
  c = c.replace(qaReportSave, qaReportEnhanced);
  console.log('qa_report enhanced with call2 sections');
} else {
  console.log('qa_report already enhanced or pattern not found');
}

fs.writeFileSync(file, c, 'utf8');

const { execSync } = require('child_process');
try {
  execSync(`node -c "${file}"`, { stdio: 'pipe' });
  console.log('\nSyntax OK — all patches applied');
} catch (e) {
  console.log('Syntax error:', e.stderr?.toString().slice(0, 400));
  process.exit(1);
}
