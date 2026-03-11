/**
 * Patch script: Add flavor intelligence + fix competitor notes + comprehensive comparison
 * Changes:
 *  1. phase8-formula-brief.js: Add FLAVOR INTELLIGENCE section to prompt (from competitor data)
 *  2. phase9-formula-qa.js: Add FLAVOR QA section + COMPREHENSIVE INGREDIENT COMPARISON TABLE
 *  3. phase9-formula-qa.js: Separate API call for competitor notes (always completes)
 */
const fs = require('fs');
const path = require('path');

// ─── 1. PHASE 8 — Add Flavor Intelligence section ─────────────────────────────
{
  const file = path.join(__dirname, 'phase8-formula-brief.js');
  let c = fs.readFileSync(file, 'utf8');

  // Add flavorIntelSection builder after formPainPoints block
  const afterFormPain = `  ).map(p => \`- \${p.keyword}: \${p.mentions} mentions\`).join('\\n') || 'No specific formulation feedback';`;
  const flavorIntelBuilder = `
  // Build flavor intelligence from top competitor data
  const flavorIntelSection = (() => {
    const lines = [];
    // Flavor data from top competitors (titles + other_ingredients)
    const flavorCompetitors = top20.slice(0, 10).filter(c => c.supplement_facts_raw || c.other_ingredients);
    flavorCompetitors.forEach(c => {
      const raw = ((c.supplement_facts_raw || '') + ' ' + (c.other_ingredients || '')).toLowerCase();
      const flavors = [];
      if (raw.includes('strawberry')) flavors.push('strawberry');
      if (raw.includes('raspberry')) flavors.push('raspberry');
      if (raw.includes('lemon')) flavors.push('lemon');
      if (raw.includes('mango')) flavors.push('mango');
      if (raw.includes('peach')) flavors.push('peach');
      if (raw.includes('cherry')) flavors.push('cherry');
      if (raw.includes('mixed berry') || raw.includes('mixed fruit')) flavors.push('mixed berry');
      if (raw.includes('apple')) flavors.push('apple');
      if (raw.includes('watermelon')) flavors.push('watermelon');
      if (raw.includes('citrus')) flavors.push('citrus');
      if (flavors.length) lines.push(\`- \${c.brand} BSR#\${c.rank}: \${flavors.join(', ')}\`);
    });
    // Taste/flavor pain points from reviews
    const tastePains = cs.top_pain_points.filter(p =>
      ['taste', 'flavor', 'texture', 'smell', 'aftertaste', 'chalky', 'gritty', 'bitter', 'sweet', 'sugar']
        .some(w => p.keyword.toLowerCase().includes(w))
    ).map(p => \`- "\${p.keyword}": \${p.mentions} review mentions\`);
    return [
      '### Competitor Flavor Profiles',
      lines.length ? lines.join('\\n') : '- Flavor data not extracted from supplement facts',
      '',
      '### Consumer Taste Complaints (from reviews — solve these)',
      tastePains.length ? tastePains.join('\\n') : '- No specific taste complaints found',
      '',
      '### Flavor Strategy Directive',
      '- Gummies must taste GREAT — taste is a purchase repeat driver',
      '- Ashwagandha has a bitter/earthy note — must be masked aggressively',
      '- Recommend: natural fruit flavor with citric acid brightness to cut bitterness',
      '- Include flavor name, intensity level, and masking agent recommendations in spec',
    ].join('\\n');
  })();`;

  if (!c.includes('flavorIntelSection')) {
    c = c.replace(afterFormPain, afterFormPain + '\n' + flavorIntelBuilder);
    console.log('P8: flavorIntelSection builder added');
  } else { console.log('P8: flavorIntelSection already exists'); }

  // Inject into prompt after CONSUMER PAIN POINTS section
  const painPointsSection = `## dY"^ CATEGORY STATISTICS`;
  const flavorInjection = `## 👅 FLAVOR & TASTE INTELLIGENCE (Critical for gummies)

\${flavorIntelSection}

---

## dY"^ CATEGORY STATISTICS`;

  if (!c.includes('FLAVOR & TASTE INTELLIGENCE')) {
    c = c.replace(painPointsSection, flavorInjection);
    console.log('P8: Flavor intelligence section injected into prompt');
  } else { console.log('P8: Flavor section already in prompt'); }

  // Add explicit flavor instruction in the formula spec output template
  const organolepticTarget = `| Taste | [If applicable - flavor profile] |`;
  const organolepticEnhanced = `| Taste | [REQUIRED: Specific flavor name + masking strategy for ashwagandha bitterness] |
| Sweetener System | [Type + amount — sugar-free preferred; use stevia/monk fruit/erythritol blend] |
| Flavor Masking | [How to neutralize earthy/bitter ashwagandha notes] |`;

  if (!c.includes('Sweetener System')) {
    c = c.replace(organolepticTarget, organolepticEnhanced);
    console.log('P8: Organoleptic targets enhanced');
  }

  fs.writeFileSync(file, c, 'utf8');
  require('child_process').execSync(`node -c "${file}"`, { stdio: 'pipe' });
  console.log('P8: Syntax OK\n');
}

// ─── 2. PHASE 9 — Add Flavor QA + Comprehensive Comparison ───────────────────
{
  const file = path.join(__dirname, 'phase9-formula-qa.js');
  let c = fs.readFileSync(file, 'utf8');

  // 2a. Add flavor QA section to prompt (after WARNINGS)
  const warnSection = `## FORMULA ADJUSTMENTS`;
  const flavorQA = `## FLAVOR & TASTE QA
(Gummies live or die on taste — evaluate both formulas' flavor strategy)

| Dimension | Formula A (Grok) | Formula B (Claude) | Market Expectation |
|---|---|---|---|
| Proposed flavor | [A's flavor] | [B's flavor] | [What top sellers use] |
| Bitterness masking | [A's approach] | [B's approach] | [Best practice] |
| Sweetener system | [A's sweeteners] | [B's sweeteners] | [Sugar-free preference] |
| Texture/mouthfeel | [Assessment] | [Assessment] | [Gummy standard] |

**Flavor Risk Assessment:** [Will ashwagandha's earthy/bitter notes break through? How to fix?]
**Recommended Flavor Profile:** [Specific name + masking strategy + sweetener recommendation]
**Review-Backed Evidence:** [What do 1-star reviews say about taste in this category?]

## FORMULA ADJUSTMENTS`;

  if (!c.includes('FLAVOR & TASTE QA')) {
    c = c.replace(warnSection, flavorQA);
    console.log('P10: Flavor QA section added to prompt');
  } else { console.log('P10: Flavor QA already in prompt'); }

  // 2b. Add comprehensive ingredient comparison table to prompt
  const dualFormulaSection = `## DUAL FORMULA COMPARISON`;
  const comprehensiveComparison = `## COMPREHENSIVE INGREDIENT COMPARISON
(Every active ingredient compared: DOVIVE proposed vs top 5 competitors — exact amounts)

Build a table with ALL primary active ingredients. For each ingredient, show:
| Ingredient | DOVIVE Formula A | DOVIVE Formula B | Competitor #1 | Competitor #2 | Competitor #3 | Market Verdict |
|---|---|---|---|---|---|---|
[Row per ingredient — use exact mg amounts from the competitor OCR data above]
[Market Verdict: Under-dosed / Clinical / Over-dosed / Not used]

After the table:
**DOVIVE's Unique Differentiators** (ingredients we have that competitors don't):
- [ingredient]: [clinical dose vs competitors]

**Competitive Gaps** (what competitors have that we're missing or under-dosing):
- [ingredient]: [their dose vs ours vs recommendation]

## DUAL FORMULA COMPARISON`;

  if (!c.includes('COMPREHENSIVE INGREDIENT COMPARISON')) {
    c = c.replace(dualFormulaSection, comprehensiveComparison);
    console.log('P10: Comprehensive ingredient comparison added to prompt');
  } else { console.log('P10: Comprehensive comparison already in prompt'); }

  fs.writeFileSync(file, c, 'utf8');
  require('child_process').execSync(`node -c "${file}"`, { stdio: 'pipe' });
  console.log('P10: Syntax OK\n');
}

// ─── 3. PHASE 9 — Separate competitor notes API call ─────────────────────────
{
  const file = path.join(__dirname, 'phase9-formula-qa.js');
  let c = fs.readFileSync(file, 'utf8');

  // Add a dedicated competitor notes function (small focused call)
  const parseCompFn = `function parseCompetitorNotes(qaReport)`;
  const newCompFn = `async function generateCompetitorNotesOnly(competitors, qaAdjustedFormula, keyword) {
  /** Separate small API call — guaranteed to complete, not affected by main QA token budget */
  const lines = competitors.slice(0, 10).map((comp, i) => {
    const sf = (comp.supplement_facts_raw || '').slice(0, 300);
    return \`### #\${i+1} ASIN: \${comp.asin} — \${comp.brand}\\nBSR: \${comp.bsr_current} | $\${comp.price} | \${comp.monthly_revenue?.toLocaleString()}/mo revenue\\nFormula snippet: \${sf || 'Not available'}\`;
  }).join('\\n');

  const prompt = \`You are a supplement product analyst. For each competitor below, write ONE concise sentence comparing their formula to DOVIVE's formula for \${keyword}. Focus on the most important ingredient/dose/quality difference.

DOVIVE's Final Formula (key actives):
\${(qaAdjustedFormula || '').slice(0, 800)}

COMPETITORS:
\${lines}

Return ONLY a valid JSON object mapping each ASIN to a one-line note:
{"ASIN1": "Their dose is X vs our Y — we win on Z", "ASIN2": "..."}
No other text. Pure JSON only.\`;

  try {
    const key = getOpenRouterKey();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal: controller.signal,
      headers: { 'Authorization': \`Bearer \${key}\`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-opus-4.6',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    clearTimeout(timeout);
    const text = await res.text();
    const json = JSON.parse(text);
    const raw = json.choices?.[0]?.message?.content || '';
    const obj = raw.match(/\\{[\\s\\S]*\\}/)?.[0];
    return obj ? JSON.parse(obj) : {};
  } catch (e) {
    console.log(\`  Competitor notes generation failed: \${e.message}\`);
    return {};
  }
}

function parseCompetitorNotes(qaReport)`;

  if (!c.includes('generateCompetitorNotesOnly')) {
    c = c.replace(parseCompFn, newCompFn);
    console.log('P10: generateCompetitorNotesOnly() added');
  } else { console.log('P10: competitor notes fn already exists'); }

  // Replace the competitor notes parsing call in run() to use separate API call
  const oldNotesParse = `  const competitorNotes = parseCompetitorNotes(qaReport);
  const noteCount = Object.keys(competitorNotes).length;
  console.log(\`QA Verdict: \${verdict.verdict} | Score: \${verdict.score}/10\`);
  console.log(\`Competitor notes parsed: \${noteCount}\\n\`);`;

  const newNotesParse = `  const competitorNotes = parseCompetitorNotes(qaReport);
  let parsedCount = Object.keys(competitorNotes).length;
  console.log(\`QA Verdict: \${verdict.verdict} | Score: \${verdict.score}/10\`);
  console.log(\`Competitor notes from main QA: \${parsedCount}\`);

  // If main QA didn't produce notes (token cutoff), run dedicated small call
  let finalNotes = competitorNotes;
  if (parsedCount === 0) {
    console.log(\`  Running dedicated competitor notes call...\`);
    finalNotes = await generateCompetitorNotesOnly(competitors, adjustedFormula, KEYWORD);
    parsedCount = Object.keys(finalNotes).length;
    console.log(\`  Competitor notes generated: \${parsedCount}\\n\`);
  }
  const noteCount = parsedCount;`;

  if (c.includes('const competitorNotes = parseCompetitorNotes(qaReport);') && !c.includes('dedicated competitor notes call')) {
    c = c.replace(oldNotesParse, newNotesParse);
    console.log('P10: Competitor notes now uses dedicated fallback call');
  } else { console.log('P10: Competitor notes call already updated or not found'); }

  // Update the save block to use finalNotes instead of competitorNotes
  c = c.replace(
    'for (const [asin, note] of Object.entries(competitorNotes)) {',
    'for (const [asin, note] of Object.entries(finalNotes)) {'
  );

  fs.writeFileSync(file, c, 'utf8');
  try {
    require('child_process').execSync(`node -c "${file}"`, { stdio: 'pipe' });
    console.log('P10: Syntax OK\n');
  } catch (e) {
    console.log('P10: Syntax error:', e.stderr?.toString().slice(0, 300));
    process.exit(1);
  }
}

console.log('All patches applied successfully');
