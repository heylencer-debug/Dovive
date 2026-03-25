/**
 * phase10-competitive-benchmarking.js — Competitive Formula Benchmarking (P11)
 *
 * Takes our final adjusted formula (from P10 QA) and compares it
 * ingredient-by-ingredient against every competitor formula we have OCR data for.
 *
 * Anti-hallucination architecture:
 *   1. All competitor data from DB (P4 OCR — real scraped formulas, not AI memory)
 *   2. Claude Sonnet 4.6 drafts the benchmarking analysis grounded in provided data
 *   3. Claude Opus 4.6 validates/critiques — finds unsupported claims, wrong doses
 *   4. Every comparison backed by actual OCR text from DB; unverifiable = flagged
 *   5. Structured output with mandatory evidence fields
 *
 * Output:
 *   - formula_briefs.ingredients.competitive_benchmarking (JSON + markdown)
 *   - Vault: C:\SirPercival-Vault\07_ai-systems\agents\scout\competitive-benchmarking\
 *
 * Usage:
 *   node phase10-competitive-benchmarking.js --keyword "biotin gummies"
 *   node phase10-competitive-benchmarking.js --keyword "biotin gummies" --force
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { resolveCategory } = require('./utils/category-resolver');
const fs = require('fs');
const path = require('path');

const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);

const KEYWORD = process.argv.includes('--keyword')
  ? process.argv[process.argv.indexOf('--keyword') + 1]
  : 'ashwagandha gummies';
const FORCE = process.argv.includes('--force');

// ─── API Helpers ───────────────────────────────────────────────────────────────

function getOpenRouterKey()   { return process.env.OPENROUTER_API_KEY || null; }

async function callClaudeSonnet(prompt, maxTokens = 12000) {
  const key = getOpenRouterKey();
  if (!key) throw new Error('OPENROUTER_API_KEY not set');
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://dovive.com',
        'X-Title': 'DOVIVE Scout P11 Benchmarking',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4-6',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const raw = await res.text();
    let j;
    try { j = JSON.parse(raw); } catch { throw new Error(`Bad JSON from OpenRouter: ${raw.slice(0, 200)}`); }
    if (j.error) throw new Error(`Claude Sonnet error: ${j.error.message || JSON.stringify(j.error)}`);
    if (j.usage) console.log(`  Tokens: ${j.usage.prompt_tokens}→${j.usage.completion_tokens}`);
    const output = j.choices?.[0]?.message?.content || null;
    console.log(`  ✅ Claude Sonnet done (${Math.round((Date.now()-start)/1000)}s, ${Math.round((output?.length||0)/1000)}k chars)`);
    return output;
  } finally {
    clearTimeout(timeout);
  }
}

async function callClaudeOpus(prompt, maxTokens = 12000) {
  const key = getOpenRouterKey();
  if (!key) throw new Error('OPENROUTER_API_KEY not set');
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://dovive.com',
        'X-Title': 'DOVIVE Scout P11 Benchmarking',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-opus-4-6',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const raw = await res.text();
    let j;
    try { j = JSON.parse(raw); } catch { throw new Error(`Bad JSON from OpenRouter: ${raw.slice(0, 200)}`); }
    if (j.error) throw new Error(`Claude Opus error: ${j.error.message || JSON.stringify(j.error)}`);
    if (j.usage) console.log(`  Tokens: ${j.usage.prompt_tokens}→${j.usage.completion_tokens}`);
    const output = j.choices?.[0]?.message?.content || null;
    console.log(`  ✅ Claude Opus done (${Math.round((Date.now()-start)/1000)}s, ${Math.round((output?.length||0)/1000)}k chars)`);
    return output;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Build Sonnet Draft Prompt ─────────────────────────────────────────────────

function buildSonnetDraftPrompt(adjustedFormula, competitors, keyword) {
  const compSection = competitors.map((c, i) => {
    const nutrients = c.all_nutrients
      ? (typeof c.all_nutrients === 'string' ? c.all_nutrients : JSON.stringify(c.all_nutrients, null, 2))
      : null;
    const sf = c.supplement_facts_raw || '';
    const hasFormula = nutrients || sf;
    if (!hasFormula) return `### COMPETITOR ${i+1}: ${c.brand || 'Unknown'} [${c.asin}]\nBSR: ${c.bsr_current} | $${c.price} | $${(c.monthly_revenue||0).toLocaleString()}/mo\n⚠ NO FORMULA DATA — skip comparison, list as "Formula not extracted"\n`;
    return `### COMPETITOR ${i+1}: ${c.brand || 'Unknown'} [${c.asin}]
BSR: ${c.bsr_current?.toLocaleString()} | Price: $${c.price} | Revenue: $${(c.monthly_revenue||0).toLocaleString()}/mo
Rating: ${c.rating_value}⭐ (${(c.rating_count||0).toLocaleString()} reviews)
Serving: ${c.serving_size || 'N/A'} | Servings/container: ${c.servings_per_container || 'N/A'}

Supplement Facts (OCR extracted):
${sf.slice(0, 800) || 'Not available'}

Structured nutrients:
${nutrients ? nutrients.slice(0, 600) : 'Not available'}
`;
  }).join('\n---\n');

  return `You are a senior supplement formulator with expertise in competitive formula analysis.

## CRITICAL RULES — READ BEFORE PROCEEDING
1. Use ONLY the competitor data provided below. NEVER invent doses, ingredients, or formulas.
2. If a competitor has no formula data, mark them as "No OCR data — cannot compare" and move on.
3. Every dose you cite MUST appear in the provided supplement facts text above it.
4. If you are unsure about a comparison, write "NEEDS_VERIFICATION: [reason]" instead of guessing.
5. Do NOT use your training knowledge of what a product "typically contains" — only use the data here.

## DOVIVE FINAL FORMULA (from P10 QA — this is the ground truth)
${adjustedFormula || 'ERROR: No adjusted formula found. Cannot benchmark.'}

## COMPETITOR FORMULAS (${competitors.length} competitors with OCR data)
${compSection}

---

## YOUR DELIVERABLE

Produce this exact structure:

# P11 COMPETITIVE FORMULA BENCHMARKING — ${keyword.toUpperCase()}
*Data source: P4 OCR extraction + P10 adjusted formula*
*Benchmarking model: Claude Sonnet 4.6 (draft) — to be validated by Claude Opus 4.6*

## EXECUTIVE SUMMARY
| Metric | Value |
|---|---|
| Competitors analyzed | [only those with OCR formula data] |
| Competitors skipped (no OCR data) | [count] |
| Ingredients where DOVIVE wins | [count] |
| Ingredients where competitors win | [count] |
| Tie / Within 20% | [count] |
| Unique DOVIVE ingredients | [count — ingredients competitors don't have] |
| Missing vs competitors | [count — ingredients competitors have that we don't] |
| Overall competitive position | STRONG / COMPETITIVE / NEEDS WORK |

## INGREDIENT-BY-INGREDIENT COMPARISON
(Only include rows where at least one competitor has data for that ingredient)

| Ingredient | DOVIVE Dose | Best Competitor Dose | Market Average | Verdict | Evidence Source |
|---|---|---|---|---|---|
[One row per active ingredient. Verdict: DOVIVE WINS / COMPETITOR WINS / TIE / NEEDS_VERIFICATION]
[Evidence Source: "ASIN B0XXXXXXXX supplement_facts_raw" — cite the actual source]

## PER-COMPETITOR BREAKDOWN
(Only for competitors WITH formula data)

For each competitor with OCR data:
### vs [Brand] — BSR [X] | $[price] | [ASIN]
**Formula coverage**: [X/Y ingredients we could compare]
**Where DOVIVE wins**: [bullet list with specific doses]
**Where competitor wins**: [bullet list with specific doses]
**Unique to DOVIVE**: [ingredients we have that they don't]
**Unique to competitor**: [ingredients they have that we don't — should we add?]
**Can we beat them?**: [Yes/No/Partial + one-line reason based on data]
**Market claim we can make**: ["More X than [Brand]" or "First to include Y at clinical dose"]

## DOVIVE ADVANTAGES SUMMARY
(Evidence-backed claims we can make on the label or in marketing)
| Claim | vs Which Competitor | Evidence | Confidence |
|---|---|---|---|
[Only claims directly supported by the comparison data above]

## COMPETITIVE GAPS — SHOULD WE ADD THESE?
(Ingredients multiple competitors have that we're missing)
| Ingredient | How Many Competitors Have It | Avg Competitor Dose | Add to DOVIVE? | Reason |
|---|---|---|---|---|

## FORMULA STRENGTH SCORE
| Dimension | Score (0-10) | Rationale |
|---|---|---|
| Dose superiority (vs market) | [X/10] | [one line, evidence-based] |
| Ingredient uniqueness | [X/10] | [one line] |
| Certifications & quality signals | [X/10] | [one line] |
| Value proposition at target price | [X/10] | [one line] |
| Overall formula competitiveness | [X/10] | [one line] |

## DATA QUALITY FLAGS
List every instance where you wrote NEEDS_VERIFICATION and why:
- [ingredient/claim]: [what's unverifiable and why]

---
Be surgical and data-driven. If you can't verify a claim from the data provided, flag it. This report will be reviewed by Claude Opus 4.6 which will check every number against the source data.`;
}

// ─── Build Claude Opus Validation Prompt ──────────────────────────────────────

function buildOpusValidationPrompt(adjustedFormula, competitors, grokDraft, keyword) {
  // Build a compact competitor reference for verification
  const compRef = competitors.slice(0, 50).map(c => {
    const sf = (c.supplement_facts_raw || '').slice(0, 400);
    return `[${c.asin}] ${c.brand}: ${sf || 'No OCR data'}`;
  }).join('\n');

  return `You are a pharmaceutical QA expert and fact-checker. Your ONLY job is to validate the competitive benchmarking report below for accuracy.

## VALIDATION RULES
1. Check every dose cited for DOVIVE against the formula anchor
2. Check every dose cited for competitors against the competitor data provided
3. Flag any claim NOT directly supported by the data
4. Correct any wrong numbers you find
5. Approve sections that are accurate

## DOVIVE FORMULA ANCHOR (ground truth — all DOVIVE doses must match this)
${adjustedFormula || 'Not available'}

## COMPETITOR DATA (OCR source — all competitor doses must come from this)
${compRef}

## GROK BENCHMARKING DRAFT (to validate)
${grokDraft?.slice(0, 8000) || 'No draft available'}
${grokDraft && grokDraft.length > 8000 ? '\n[Draft continues — key sections shown]\n' : ''}

---

## YOUR DELIVERABLE

Produce a validation report in this exact format:

# P11 VALIDATION REPORT — Claude Opus 4.6
*Reviewing Claude Sonnet 4.6 benchmarking draft for ${keyword}*

## VALIDATION SUMMARY
| | Count |
|---|---|
| Sections verified (accurate) | [N] |
| Errors found (wrong numbers) | [N] |
| Unsupported claims flagged | [N] |
| NEEDS_VERIFICATION items confirmed | [N] |
| Overall validation result | PASS / PASS WITH CORRECTIONS / FAIL |

## ERRORS FOUND
(Wrong numbers that must be corrected)
| # | Location in Draft | Error | Correct Value | Source |
|---|---|---|---|---|
[If none: "✅ No factual errors found in competitor dose comparisons."]

## UNSUPPORTED CLAIMS
(Claims in the draft that can't be verified from the provided data)
| # | Claim | Why Unsupported | Recommendation |
|---|---|---|---|
[If none: "✅ All claims are supported by provided data."]

## CONFIRMED NEEDS_VERIFICATION ITEMS
(Items Claude Sonnet correctly flagged as unverifiable)
[List each — confirm they are indeed unverifiable from provided data]

## ADDITIONAL GAPS SONNET MISSED
(Competitor advantages or DOVIVE weaknesses that Claude Sonnet didn't flag)
[Be specific — cite ASIN and dose]

## VALIDATED ADVANTAGES
(Claims from the draft that ARE fully supported by the data — safe to use in marketing)
| Claim | Verified Against | Confidence |
|---|---|---|

## FINAL VERDICT
**Validation result**: [PASS / PASS WITH CORRECTIONS / FAIL]
**Summary**: [2-3 sentences — is this benchmarking report reliable? What's the main caveat?]
**Recommended action**: [Use as-is / Apply corrections above and use / Regenerate draft]`;
}

// ─── Parse overall score ───────────────────────────────────────────────────────

function parseScore(draft) {
  const m = draft?.match(/Overall formula competitiveness.*?(\d+(?:\.\d+)?)\s*\/\s*10/);
  return m ? parseFloat(m[1]) : null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n${'═'.repeat(62)}`);
  console.log(`P11: COMPETITIVE FORMULA BENCHMARKING — "${KEYWORD}"`);
  console.log(`${'═'.repeat(62)}\n`);

  // Resolve category
  let CAT_ID, catName;
  try {
    const cat = await resolveCategory(DASH, KEYWORD);
    CAT_ID = cat.id;
    catName = cat.name;
    console.log(`  → Resolved category (${cat.method}): "${cat.name}" (${cat.id})`);
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    setTimeout(() => process.exit(1), 100);
    return;
  }

  // Skip if already done
  if (!FORCE) {
    const { data: existing } = await DASH.from('formula_briefs')
      .select('ingredients').eq('category_id', CAT_ID).limit(1).single();
    if (existing?.ingredients?.competitive_benchmarking) {
      console.log(`✅ P11 benchmarking already exists. Use --force to regenerate.`);
      return;
    }
  }

  // Load adjusted formula from P10
  console.log(`Loading P10 adjusted formula...`);
  const { data: briefRow } = await DASH.from('formula_briefs')
    .select('id, ingredients').eq('category_id', CAT_ID).not('ingredients', 'is', null).limit(1).single();
  const adjustedFormula = briefRow?.ingredients?.adjusted_formula
    || briefRow?.ingredients?.final_formula_brief
    || briefRow?.ingredients?.ai_generated_brief;
  if (!adjustedFormula) {
    console.error('ERROR: No formula found in formula_briefs. Run P9/P10 first.');
    setTimeout(() => process.exit(1), 100);
    return;
  }
  console.log(`  ✅ Formula loaded (${Math.round(adjustedFormula.length / 1000)}k chars)`);

  // Load competitors with formula data
  console.log(`Loading competitor formulas from DASH...`);
  const { data: allProducts } = await DASH.from('products')
    .select(`asin, brand, title, bsr_current, price, monthly_revenue, monthly_sales,
             rating_value, rating_count, serving_size, servings_per_container,
             supplement_facts_raw, all_nutrients, nutrients_count, marketing_analysis`)
    .eq('category_id', CAT_ID)
    .not('bsr_current', 'is', null)
    .order('bsr_current', { ascending: true })
    .limit(50);

  const withFormula = (allProducts || []).filter(p => p.nutrients_count > 0 || p.supplement_facts_raw);
  const withoutFormula = (allProducts || []).filter(p => !p.nutrients_count && !p.supplement_facts_raw);
  console.log(`  Total products: ${allProducts?.length || 0}`);
  console.log(`  With formula data (OCR): ${withFormula.length}`);
  console.log(`  Without formula data: ${withoutFormula.length}`);

  if (withFormula.length === 0) {
    console.error('ERROR: No competitors have formula data. Run P4 first.');
    setTimeout(() => process.exit(1), 100);
    return;
  }

  // ── Call 1: Claude Sonnet drafts the benchmarking ─────────────────────────
  console.log(`\nCall 1: Claude Sonnet 4.6 drafting ingredient comparison (${withFormula.length} competitors with OCR data)...`);
  const sonnetPrompt = buildSonnetDraftPrompt(adjustedFormula, withFormula, KEYWORD);
  console.log(`  Prompt: ${Math.round(sonnetPrompt.length / 1000)}k chars`);
  const sonnetDraft = await callClaudeSonnet(sonnetPrompt, 10000);

  // ── Call 2: Claude Opus validates ─────────────────────────────────────────
  console.log(`\nCall 2: Claude Opus 4.6 validating Sonnet's analysis...`);
  const opusPrompt = buildOpusValidationPrompt(adjustedFormula, withFormula, sonnetDraft, KEYWORD);
  console.log(`  Prompt: ${Math.round(opusPrompt.length / 1000)}k chars`);
  const opusValidation = await callClaudeOpus(opusPrompt, 8000);

  // ── Parse scores ──────────────────────────────────────────────────────────
  const formulaScore = parseScore(sonnetDraft);
  const validationPassMatch = opusValidation?.match(/Overall validation result.*?(PASS WITH CORRECTIONS|PASS|FAIL)/i);
  const validationResult = validationPassMatch?.[1]?.trim() || 'UNKNOWN';
  console.log(`\nFormula competitiveness score: ${formulaScore}/10`);
  console.log(`Validation result: ${validationResult}`);

  // ── Save to formula_briefs ────────────────────────────────────────────────
  console.log(`\nSaving to Supabase...`);
  const benchmarkingData = {
    sonnet_draft: sonnetDraft,
    opus_validation: opusValidation,
    formula_score: formulaScore,
    validation_result: validationResult,
    competitors_with_formula: withFormula.length,
    competitors_without_formula: withoutFormula.length,
    generated_at: new Date().toISOString(),
    models_used: { draft: 'anthropic/claude-sonnet-4-6', validation: 'anthropic/claude-opus-4-6' },
  };

  const updatedIngredients = {
    ...(briefRow.ingredients || {}),
    competitive_benchmarking: benchmarkingData,
  };
  const { error: saveErr } = await DASH.from('formula_briefs')
    .update({ ingredients: updatedIngredients })
    .eq('id', briefRow.id);
  if (saveErr) console.error(`  ❌ Save error: ${saveErr.message}`);
  else console.log(`  ✅ Saved to formula_briefs.ingredients.competitive_benchmarking`);

  // ── Save to vault ─────────────────────────────────────────────────────────
  console.log(`\nSaving to vault...`);
  const date = new Date().toISOString().split('T')[0];
  const slug = KEYWORD.replace(/\s+/g, '-').toLowerCase();
  const vaultDir = 'C:\\SirPercival-Vault\\07_ai-systems\\agents\\scout\\competitive-benchmarking';
  try {
    if (!fs.existsSync(vaultDir)) fs.mkdirSync(vaultDir, { recursive: true });
    const vaultPath = path.join(vaultDir, `${date}-${slug}-benchmarking.md`);
    fs.writeFileSync(vaultPath, [
      `# P11 Competitive Formula Benchmarking — ${KEYWORD}`,
      `Generated: ${new Date().toISOString()}`,
      `Formula score: ${formulaScore}/10 | Validation: ${validationResult}`,
      `Competitors with formula data: ${withFormula.length} | Without: ${withoutFormula.length}`,
      `Models: Claude Sonnet 4.6 (draft) + Claude Opus 4.6 (validation)`,
      ``,
      `---`,
      ``,
      `## CLAUDE SONNET 4.6 DRAFT`,
      sonnetDraft || 'Not available',
      ``,
      `---`,
      ``,
      `## CLAUDE OPUS 4.6 VALIDATION`,
      opusValidation || 'Not available',
    ].join('\n'));
    console.log(`  ✅ ${vaultPath}`);
  } catch (e) {
    console.warn(`  ⚠ Vault save failed (non-fatal): ${e.message}`);
    // Save to scout/output instead
    const outDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${date}-${slug}-competitive-benchmarking.md`);
    fs.writeFileSync(outPath, [grokDraft, '\n\n---\n\n', opusValidation].join(''));
    console.log(`  ✅ Saved to ${outPath}`);
  }

  console.log(`\n${'═'.repeat(62)}`);
  console.log(`P11 COMPLETE`);
  console.log(`Formula competitiveness: ${formulaScore}/10`);
  console.log(`Validation: ${validationResult}`);
  console.log(`${withFormula.length} competitors benchmarked | ${withoutFormula.length} skipped (no OCR)`);
  console.log(`${'═'.repeat(62)}\n`);
}

run()
  .then(() => setTimeout(() => process.exit(0), 500))
  .catch(e => {
    console.error(e.message);
    setTimeout(() => process.exit(1), 500);
  });
