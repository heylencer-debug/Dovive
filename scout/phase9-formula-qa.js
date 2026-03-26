/**
 * phase9-formula-qa.js â€" Formula QA & Competitive Benchmarking
 *
 * Acts as a senior pharmaceutical formulator + QA specialist.
 * Stress-tests the P8 formula against every competitor formula one-by-one.
 *
 * Questions it answers per competitor:
 *   - Is our dose too high / too low vs this competitor?
 *   - Are our bonus ingredients justified or over-engineered?
 *   - What would a contract manufacturer flag?
 *   - Can we beat this competitor at our target price?
 *
 * Output:
 *   - Full QA report saved to formula_briefs.ingredients.qa_report
 *   - Adjusted formula saved to formula_briefs.ingredients.adjusted_formula
 *   - Per-product comparison notes saved to products.marketing_analysis.qa_comparison_note
 *   - Vault: C:\SirPercival-Vault\07_ai-systems\agents\scout\qa-reports\
 *
 * Usage:
 *   node phase9-formula-qa.js --keyword "ashwagandha gummies"
 *   node phase9-formula-qa.js --keyword "ashwagandha gummies" --force
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
const FORCE   = process.argv.includes('--force');

// Token usage log — populated by every API call in this run
const tokenLog = [];

// CAT_ID is resolved dynamically in run() - no hardcoding

// â"€â"€â"€ xAI Key â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function getOpenRouterKey() {
  return process.env.OPENROUTER_API_KEY || null;
}

async function callClaudeSonnetQA(prompt, maxTokens = 12000) {
  const key = getOpenRouterKey();
  if (!key) throw new Error('No OpenRouter key');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000); // 5 min hard timeout
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://dovive.com', 'X-Title': 'DOVIVE Scout P10 QA' },
      body: JSON.stringify({ model: 'anthropic/claude-sonnet-4-6', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    });
    const raw = await res.text();
    let j;
    try { j = JSON.parse(raw); } catch (e) { throw new Error(`Bad JSON from OpenRouter (${raw.length} chars): ${raw.slice(0, 200)}`); }
    if (j.error) throw new Error(`Claude Sonnet QA error: ${j.error.message || JSON.stringify(j.error)}`);
    if (j.usage) {
      console.log(`  Tokens: ${j.usage.prompt_tokens}→${j.usage.completion_tokens} (total: ${j.usage.total_tokens})`);
      tokenLog.push({ call: tokenLog.length + 1, prompt_tokens: j.usage.prompt_tokens, completion_tokens: j.usage.completion_tokens, total_tokens: j.usage.total_tokens, ts: new Date().toISOString() });
    }
    return j.choices?.[0]?.message?.content || null;
  } finally {
    clearTimeout(timeout);
  }
}

// â"€â"€â"€ Load P6 market intelligence from vault â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function loadMarketIntelFromVault(keyword) {
  const slug = keyword.replace(/\s+/g, '-').toLowerCase();
  const dir = 'C:\\SirPercival-Vault\\07_ai-systems\\agents\\scout\\market-intelligence';
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.includes(slug)).sort().reverse();
  if (!files.length) return null;
  return fs.readFileSync(path.join(dir, files[0]), 'utf8');
}

// â"€â"€â"€ Build QA prompt â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function buildQAPrompt(grokBrief, marketIntel, competitors, keyword, claudeBrief = null) {
  const competitorSection = competitors.map((c, i) => {
    const pi = c.marketing_analysis?.product_intelligence || {};
    return `
### COMPETITOR ${i + 1}: ${c.brand || 'Unknown'} [ASIN: ${c.asin}]
- BSR: ${c.bsr_current?.toLocaleString() || 'N/A'} | Price: $${c.price || 'N/A'} | Revenue: $${(c.monthly_revenue || 0).toLocaleString()}/mo
- Rating: ${c.rating_value || 'N/A'}â­ (${(c.rating_count || 0).toLocaleString()} reviews)
- Extract Type: ${pi.ashwagandha_extract_type || 'Unknown'} | Dose: ${pi.ashwagandha_amount_mg || '?'}mg
- Bonus Ingredients: ${(pi.bonus_ingredients || []).join(', ') || 'None'}
- Certifications: ${(pi.certifications || []).join(', ') || 'None'}
- Sugar-Free: ${pi.is_sugar_free} | Vegan: ${pi.is_vegan} | 3rd Party: ${pi.is_third_party_tested}
- Formula Score: ${pi.formula_quality_score || '?'}/10 | Threat: ${pi.competitor_threat_level || '?'}
- BSR Trend: ${pi.bsr_trend_label || '?'} | Price Tier: ${pi.price_positioning_label || '?'}
- Revenue/Review: $${pi.revenue_per_review || '?'}/review
- Strengths: ${(pi.key_strengths || []).join('; ') || 'N/A'}
- Weaknesses: ${(pi.key_weaknesses || []).join('; ') || 'N/A'}
- Market Gap: ${pi.market_opportunity_gap || 'N/A'}
- OCR Supplement Facts: ${(c.supplement_facts_raw || '').substring(0, 500) || 'Not available'}`;
  }).join('\n\n---\n');

  return `You are a senior pharmaceutical formulator, supplement QA specialist, and competitive intelligence analyst with 20+ years of experience launching successful Amazon supplement products. You have deep knowledge of:
- Supplement ingredient safety, efficacy, and clinical dosing ranges
- Gummy manufacturing constraints (active load limits, heat stability, pH)
- US supplement regulations (DSHEA, FDA guidelines, NDI requirements)
- Amazon supplement market dynamics and pricing strategy
- Contract manufacturing costs and MOQ realities

## YOUR MISSION

DOVIVE's AI (P8) produced a formula specification for ${keyword}. Your job is to:
1. **Critically review** every ingredient, every dose â€" question everything
2. **Compare head-to-head** against each of the top 10 competitors
3. **Identify what's too much, what's too little, what's unjustified**
4. **Produce an adjusted formula** with precise reasoning for every change
5. **Write competitor comparison notes** that will show on each competitor's card

This is a CRITICAL QA gate. P8 AI may have over-engineered the formula. Be the expert who catches that.

---

## DUAL AI FORMULA PROPOSALS (both to be reviewed and adjudicated)

### FORMULA A - Grok 4.2 Deep Reasoning (grok-4.20-beta-0309-reasoning)
${grokBrief || "Not available"}

### FORMULA B - Claude Sonnet 4.6 (anthropic/claude-sonnet-4-6)

${claudeBrief || "Claude Sonnet brief not available (single-model run)"}

---

## P6 MARKET INTELLIGENCE (category context)

${marketIntel || 'Not available'}

---

## TOP 10 COMPETITORS (formula-by-formula comparison)

${competitorSection}

---

## HARD ENFORCEMENT RULES (apply when writing the FINAL FORMULA BRIEF — no exceptions)

These override both Formula A and Formula B if either violates them. Do not just flag violations in the QA section — **correct them in the FINAL FORMULA BRIEF itself**. These rules apply to every supplement category.

### 1. CLINICAL DOSE FLOORS (apply to every ingredient in this formula)
For each active ingredient proposed by either AI:
- Look up the **minimum clinically studied dose** from published human research for its stated function in this product
- If the proposed dose is **below** that floor, raise it to the clinical minimum or remove the ingredient entirely
- If the proposed dose **exceeds clinical utility** (i.e., competitors are inflating a number for marketing optics with no additional benefit at that dose), correct it down to the effective ceiling
- Never keep an ingredient at a token/label-dressing dose that has no physiological effect at the amount used

### 2. INGREDIENT FORM HIERARCHY (always correct to the most bioavailable form)
For each active ingredient, identify whether a superior bioavailable form exists. Default rules:
- Always prefer **chelated or amino acid chelate forms** of minerals over inorganic salts (oxides, sulfates, carbonates)
- Always prefer **methylated or activated forms** of vitamins over synthetic precursors when a meaningful percentage of the population has impaired conversion
- Always prefer forms with **established human bioavailability data** over cheaper commodity forms
- If either AI used an inferior form, the FINAL FORMULA BRIEF must correct to the superior form and document the reason in CRITICAL ISSUES

### 3. LEAN FORMULA PRINCIPLE
- Target: **8–10 active ingredients**. Maximum 12 only if every ingredient above 10 has a distinct, non-redundant clinical role at a meaningful dose
- Every ingredient must pass all three tests: (a) dose is at or above clinical minimum for its stated function, (b) its function is not already covered by another ingredient in the formula, (c) it is not present for label aesthetics
- If either AI produced more than 12 actives, remove the weakest first: lowest dose relative to clinical floor, most redundant function
- A lean formula at clinical doses always outperforms a kitchen-sink formula with diluted amounts

### 4. MANUFACTURABILITY GATE
Before accepting the final formula, validate it against the dosage form constraints:
- **Active load**: Calculate total actives per unit (e.g., per gummy). If it exceeds the dosage form's physical limit (250–350 mg per gummy), the formula MUST be trimmed — remove or reduce lowest-priority actives until it fits. State the total active load in CRITICAL ISSUES if it fails.
- **Heat-sensitive ingredients**: Flag any active that degrades during manufacturing of the chosen form. Require encapsulated or heat-stable form in the final spec.
- **pH interactions**: Flag actives that are unstable in the product matrix pH. Require buffering, encapsulation, or form change.
- **Taste conflicts**: Flag any active with a known bitter/metallic taste at the proposed dose without a masking solution in the excipient system.
- **Ingredient incompatibilities**: Flag known absorption antagonists present together (e.g., calcium + iron, zinc + copper at high doses) and either separate into different SKUs or note the conflict.
If the formula fails any of these checks, correct it in the FINAL FORMULA BRIEF — do not just flag it.

### 5. CLINICAL CITATION CHECK
For each active ingredient in the FINAL FORMULA BRIEF:
- Verify a human clinical study exists at or near the proposed dose for the stated function
- If either AI cited a study, check that the dose and population match the claim
- If no human RCT exists at the proposed dose, flag it in WARNINGS and either justify with mechanistic evidence or reduce to the highest dose with human data
- An ingredient with no human evidence at its proposed dose must not appear in the final formula without an explicit caveat

### 5. PAIN POINTS VIA EXCIPIENTS ONLY
- Taste, texture, and tolerability complaints must be solved via the excipient and manufacturing system — NOT by adding more actives
- Never add an active ingredient to solve a problem that is a formulation or manufacturing issue

---

## YOUR DELIVERABLE â€" produce this exact markdown structure:

# P9 FORMULA QA REPORT â€" ${keyword.toUpperCase()}

## FINAL FORMULA BRIEF
(Write this FIRST - complete, production-ready manufacturing spec synthesizing Formula A + Formula B + QA corrections. This is what goes to the CMO. Full detail required - match the depth of the input briefs.)

### Executive Summary
[2-3 sentences: market opportunity, who it is for, key differentiator vs Goli/competitors]

### Recommended Formula - Per Serving (2 gummies)
| Ingredient | Amount | Form / Grade | Role | Why This Dose |
|---|---|---|---|---|
[Actives only - must stay within 250-350mg actives per gummy max for real manufacturability]

### Excipients & Manufacturing Notes
[Pectin, sweeteners, acids, flavors, colors - with specific CMO instructions]

### Supplement Facts Panel (label-ready, FDA-compliant)
Serving Size: 2 Gummies | Servings Per Container: 45
[All ingredients with amounts and %DV]

### Certifications Required
| Certification | Priority | Reason |
|---|---|---|

### Flavor & Format
[Flavor name, gummy form, color, texture notes]

### Variant Lineup
[2-3 SKUs with names and differentiation]

### Pricing & Margin Targets
| Format | MSRP | Est. COGS/serving | Target Margin |
|---|---|---|---|

### Claims (Label + Marketing)
[Bullet list - structure/function only, no disease claims]

### Why DOVIVE Wins
[3-5 bullets - competitive advantages vs top ASINs]

## QA VERDICT
**Overall:** [APPROVED / APPROVED WITH ADJUSTMENTS / NEEDS MAJOR REVISION]
**QA Score:** X/10
**Summary:** 2-3 sentences â€" did P8 AI over-engineer this? What's the critical finding?

## CRITICAL ISSUES â›"
(Issues that MUST be fixed before manufacturing)
| # | Issue | Ingredient/Element | Problem | Fix |
|---|---|---|---|---|
| 1 | ... | ... | ... | ... |

## WARNINGS âš ï¸
(Important but not blocking)
| # | Warning | Detail | Recommendation |
|---|---|---|---|

## DOSE ANALYSIS TABLE
(Every active ingredient â€" is the dose right?)
| Ingredient | Proposed Dose | Clinical Effective Range | Market Avg | Verdict | Notes |
|---|---|---|---|---|---|

## MANUFACTURABILITY CHECK
| Factor | Assessment | Risk | Action |
|---|---|---|---|
| Active load per gummy | ... | ... | ... |
| Heat-sensitive ingredients | ... | ... | ... |
| Cost per serving (est.) | ... | ... | ... |
| MOQ feasibility | ... | ... | ... |
| Gummy texture impact | ... | ... | ... |

## COMPETITOR HEAD-TO-HEAD COMPARISON
(One section per competitor â€" be specific)

### vs [Brand] â€" BSR [X] | $[price]
**Our formula vs theirs:**
- Ashwagandha: our [Xmg KSM-66] vs their [Ymg Unknown] â†' [ADVANTAGE OURS / THEIRS / TIE]
- Bonus ingredients: we have [A,B,C] they have [D,E] â†' [analysis]
- Price positioning: [analysis]
- Sugar content: [comparison]
- Third-party testing: [comparison]
**Can we beat them?** [Yes/No/Maybe + one-line reason]
**Comparison note (for card display):** [One concise sentence for the competitor card]
**ASIN:** [asin]

[repeat for each competitor]

## COMPREHENSIVE INGREDIENT COMPARISON
(Every active ingredient compared: DOVIVE proposed vs top 5 competitors - exact amounts)

Build a table with ALL primary active ingredients. For each ingredient, show:
| Ingredient | DOVIVE Formula A | DOVIVE Formula B | Competitor #1 | Competitor #2 | Competitor #3 | Market Verdict |
|---|---|---|---|---|---|---|
[Row per ingredient - use exact mg amounts from the competitor OCR data above]
[Market Verdict: Under-dosed / Clinical / Over-dosed / Not used]

After the table:
**DOVIVE's Unique Differentiators** (ingredients we have that competitors don't):
- [ingredient]: [clinical dose vs competitors]

**Competitive Gaps** (what competitors have that we're missing or under-dosing):
- [ingredient]: [their dose vs ours vs recommendation]

## DUAL FORMULA COMPARISON
(Score Formula A and Formula B independently, then pick the winner)

| Dimension | Formula A (Grok 4.2) | Formula B (Claude Opus) | Winner |
|---|---|---|---|
| Primary active dose | [dose] | [dose] | [A/B/Tie] |
| Bonus ingredient quality | [assessment] | [assessment] | [A/B/Tie] |
| Manufacturability in gummies | [Yes/Risk/No] | [Yes/Risk/No] | [A/B/Tie] |
| Clinical dose alignment | [score/10] | [score/10] | [A/B/Tie] |
| Cost efficiency | [assessment] | [assessment] | [A/B/Tie] |
| Overall QA Score | [X/10] | [X/10] | [A/B] |

**Winner:** [Formula A or B]
**Reason:** [One sentence - why this formula is stronger for DOVIVE]

**Best elements from Formula A to keep:** [list]
**Best elements from Formula B to incorporate:** [list]

## FLAVOR & TASTE QA
(Gummies live or die on taste - evaluate both formulas' flavor strategy)

| Dimension | Formula A (Grok) | Formula B (Claude) | Market Expectation |
|---|---|---|---|
| Proposed flavor | [A's flavor] | [B's flavor] | [What top sellers use] |
| Bitterness masking | [A's approach] | [B's approach] | [Best practice] |
| Sweetener system | [A's sweeteners] | [B's sweeteners] | [Sugar-free preference] |
| Texture/mouthfeel | [Assessment] | [Assessment] | [Gummy standard] |

**Flavor Risk Assessment:** [Will ashwagandha's earthy/bitter notes break through? How to fix?]
**Recommended Flavor Profile:** [Specific name + masking strategy + sweetener recommendation]
**Review-Backed Evidence:** [What do 1-star reviews say about taste in this category?]

## FORMULA ADJUSTMENTS
(What P8 got wrong and what we're fixing)
| Ingredient | P8 Original | P9 Adjusted | Reason |
|---|---|---|---|

## ADJUSTED FORMULA SPECIFICATION
(Complete revised formula â€" production ready)

### Per Serving (2 gummies)
| Ingredient | Amount | Form/Grade | Justification |
|---|---|---|---|

### Other Ingredients (excipients)
[list]

### Certifications Required
[list with priority: MUST-HAVE / NICE-TO-HAVE]

### Manufacturing Notes
[key instructions for CMO]

### Cost Estimate
- Estimated COGS per serving: $X.XXâ€"$X.XX
- Target MSRP: $XX.XX
- Estimated margin: XX%

## QA SIGN-OFF NOTES
(What to tell the contract manufacturer)
[paragraph â€" key QA requirements, testing protocols, stability concerns]

## COMPETITOR_NOTES_JSON
(Do NOT skip this section â€" used to populate competitor cards in dashboard)
Return a valid JSON object mapping each ASIN to a one-line comparison note:
{"ASIN1": "note", "ASIN2": "note", ...}

---

Be brutally honest. If P8 over-engineered the formula with 16 ingredients when the market only supports 4-6, say so. If our KSM-66 dose is unrealistically high for a gummy, flag it. This is the final QA gate before we send specs to a manufacturer.

⚠️ CRITICAL OUTPUT REQUIREMENTS (machine-parsed - do not skip or rename):
1. "## ADJUSTED FORMULA SPECIFICATION" - exact heading, two ## symbols
2. "## FINAL FORMULA BRIEF" - exact heading, must appear BEFORE ## COMPETITOR_NOTES_JSON
3. "## COMPETITOR_NOTES_JSON" - exact heading with valid JSON object

All three sections are required. If any is missing, pipeline data will not save correctly.`;
}

// â"€â"€â"€ Parse competitor notes from QA output â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

async function generateCompetitorNotesOnly(competitors, qaAdjustedFormula, keyword) {
  /** Separate small API call - guaranteed to complete, not affected by main QA token budget */
  const lines = competitors.slice(0, 10).map((comp, i) => {
    const sf = (comp.supplement_facts_raw || '').slice(0, 300);
    return `### #${i+1} ASIN: ${comp.asin} - ${comp.brand}\nBSR: ${comp.bsr_current} | ${comp.price} | ${comp.monthly_revenue?.toLocaleString()}/mo revenue\nFormula snippet: ${sf || 'Not available'}`;
  }).join('\n');

  const prompt = `You are a supplement product analyst. For each competitor below, write ONE concise sentence comparing their formula to DOVIVE's formula for ${keyword}. Focus on the most important ingredient/dose/quality difference.

DOVIVE's Final Formula (key actives):
${(qaAdjustedFormula || '').slice(0, 800)}

COMPETITORS:
${lines}

Return ONLY a valid JSON object mapping each ASIN to a one-line note:
{"ASIN1": "Their dose is X vs our Y - we win on Z", "ASIN2": "..."}
No other text. Pure JSON only.`;

  const key = getOpenRouterKey();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal: controller.signal,
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const text = await res.text();
    const json = JSON.parse(text);
    const raw = json.choices?.[0]?.message?.content || '';
    const obj = raw.match(/\{[\s\S]*\}/)?.[0];
    return obj ? JSON.parse(obj) : {};
  } catch (e) {
    console.log(`  Competitor notes generation failed: ${e.message}`);
    return {};
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseCompetitorNotes(qaReport) {
  const match = qaReport.match(/## COMPETITOR_NOTES_JSON\s*\n([\s\S]*?)(?:\n##|$)/);
  if (!match) return {};
  const jsonBlock = match[1].trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(jsonBlock);
  } catch {
    // Try to extract just the JSON object
    const objMatch = jsonBlock.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try { return JSON.parse(objMatch[0]); } catch {}
    }
    return {};
  }
}

// â"€â"€â"€ Parse QA verdict â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function parseQAVerdict(qaReport) {
  const verdictMatch = qaReport.match(/\*\*Overall:\*\*\s*(.+)/);
  const scoreMatch = qaReport.match(/\*\*QA Score:\*\*\s*(\d+(?:\.\d+)?)/);
  const summaryMatch = qaReport.match(/\*\*Summary:\*\*\s*(.+)/);
  return {
    verdict: verdictMatch?.[1]?.trim() || 'UNKNOWN',
    score: scoreMatch?.[1] ? parseFloat(scoreMatch[1]) : null,
    summary: summaryMatch?.[1]?.trim() || '',
  };
}

function renderFlavorRecommendationsTable(flavorRecommendations = [], flavorSummary = null) {
  if (!Array.isArray(flavorRecommendations) || flavorRecommendations.length === 0) return '';

  const header = [
    `## FLAVOR RECOMMENDATIONS (${flavorRecommendations.length})`,
    '',
    '| Rank | Flavor | Confidence | Source Brand | Source ASIN | Source Field | Competitor Presence | Market Fit Rationale | Masking Strategy | Sweetener System | Color Direction |',
    '|---:|---|---:|---|---|---|---|---|---|---|---|'
  ];

  const rows = flavorRecommendations.map((f, idx) => {
    const rank       = f?.rank || idx + 1;
    const name       = (f?.flavor_name || 'N/A').toString().replace(/\|/g, '\\|');
    const confidence = f?.confidence != null ? String(f.confidence) : 'N/A';
    const srcBrand   = (f?.provenance?.source_brand || '').toString().replace(/\|/g, '\\|') || 'N/A';
    const srcAsin    = (f?.provenance?.source_asin  || '').toString().replace(/\|/g, '\\|') || 'N/A';
    const srcField   = (f?.provenance?.source_field || '').toString().replace(/\|/g, '\\|') || 'N/A';
    const presence   = (f?.evidence?.competitor_presence || 'N/A').toString().replace(/\|/g, '\\|');
    const reason     = (f?.evidence?.market_fit_reason || f?.evidence?.review_signal || 'N/A').toString().replace(/\|/g, '\\|');
    const masking    = (f?.formulation_notes?.masking_strategy || 'N/A').toString().replace(/\|/g, '\\|');
    const sweetener  = (f?.formulation_notes?.sweetener_system || 'N/A').toString().replace(/\|/g, '\\|');
    const color      = (f?.formulation_notes?.color_direction  || 'N/A').toString().replace(/\|/g, '\\|');
    return `| ${rank} | ${name} | ${confidence} | ${srcBrand} | ${srcAsin} | ${srcField} | ${presence} | ${reason} | ${masking} | ${sweetener} | ${color} |`;
  });

  const parts = [...header, ...rows];

  const workedFromRows = flavorRecommendations
    .filter(f => (f?.confidence ?? 0) >= 50)
    .slice(0, 3)
    .map(f => `${f.flavor_name} (${f.provenance?.source_brand || 'signal-derived'} ${f.provenance?.source_asin || ''})`)
    .join(', ');
  const didntFromRows = flavorRecommendations
    .filter(f => (f?.confidence ?? 0) < 50)
    .slice(0, 3)
    .map(f => `${f.flavor_name} (lower-confidence / inferred signal)`)
    .join(', ');

  const whatWorked = flavorSummary?.what_worked
    || (workedFromRows
      ? `Highest-confidence flavor signals came from competitor-observed patterns: ${workedFromRows}. These ranked highest due to direct market evidence from competitor listings and ingredient context.`
      : 'No strong direct competitor flavor signals were available in this run; recommendations rely on best-available category evidence.');

  const whatDidnt = flavorSummary?.what_didnt
    || (didntFromRows
      ? `Lower-confidence signals were limited or indirect: ${didntFromRows}. These were kept lower-ranked or used as fallback to maintain a complete 5-7 flavor strategy.`
      : 'Weak/absent signals were excluded where possible; remaining gaps were filled using category defaults to preserve manufacturing decision coverage.');

  parts.push('', '### WHAT WORKED', whatWorked);
  parts.push('', "### WHAT DIDN'T", whatDidnt);

  return parts.join('\n');
}

// â"€â"€â"€ Main â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€


// ── Build focused Call 2 prompt (Comparison + Flavor + Competitor Notes) ──────
function buildCall2Prompt(keyword, grokBrief, claudeBrief, adjustedFormula, competitors, marketIntel) {
  const top10 = (competitors || []).slice(0, 10);

  // Build competitor ingredient table data
  const compRows = top10.map((c, i) => {
    const sf = (c.supplement_facts_raw || '').slice(0, 500);
    const rev = c.monthly_revenue ? `${Math.round(c.monthly_revenue / 1000)}k/mo` : 'N/A';
    return `### Competitor ${i + 1}: ${c.brand} | BSR ${c.bsr_current} | ${rev} | ${c.price}
ASIN: ${c.asin}
Supplement Facts: ${sf || 'Not available'}
Rating: ${c.rating_value} (${c.rating_count} reviews)
`;
  }).join('\n');

  // Flavor intelligence from competitor data
  const flavorData = top10.map(c => {
    const raw = ((c.supplement_facts_raw || '') + ' ' + ((c.marketing_analysis?.other_ingredients) || '')).toLowerCase();
    const flavors = ['strawberry','raspberry','lemon','mango','peach','cherry','mixed berry','apple','watermelon','citrus','blackberry','tropical']
      .filter(f => raw.includes(f));
    return flavors.length ? `- ${c.brand}: ${flavors.join(', ')}` : null;
  }).filter(Boolean).join('\n') || '- Flavor data not found in supplement facts';

  // Use full adjusted formula - this is the ANCHOR all analysis must align to
  const adjFormulaSummary = adjustedFormula || 'Not yet generated';
  const grokSummary = grokBrief || '';
  const claudeSummary = claudeBrief || '';
  const miSummary = marketIntel || '';

  return `You are a supplement product analyst and flavor scientist. Generate THREE sections for DOVIVE's ${keyword} product.

⚠️ CONSISTENCY RULE - READ FIRST:
The formula anchor below is the QA-approved final specification. Every ingredient amount, every dose, every ingredient name you reference in your analysis MUST exactly match this anchor. Do not invent different amounts. Do not reference ingredients not in this anchor. This ensures the full document is internally consistent.

## ✅ FORMULA ANCHOR - DOVIVE FINAL SPEC (do not deviate from these numbers)
${adjFormulaSummary}

---

## SUPPORTING CONTEXT (reference only - anchor above takes precedence)
### Formula A Draft (Grok 4.2 P9 - before QA):
${grokSummary}

### Formula B Draft (Claude Sonnet 4.6 P9 - before QA):
${claudeSummary}

## MARKET INTELLIGENCE
${miSummary}

## TOP COMPETITOR FORMULAS
${compRows}

## COMPETITOR FLAVOR PROFILES (detected from supplement facts)
${flavorData}

---

Generate exactly these three sections. Use exact headings.

## COMPREHENSIVE INGREDIENT COMPARISON
⚠️ DOVIVE column MUST use the exact amounts from the FORMULA ANCHOR above - no deviations.
Compare DOVIVE's formula against the top competitors for every active ingredient.

| Ingredient | DOVIVE *(exact from anchor)* | Comp #1 | Comp #2 | Comp #3 | Comp #4 | Comp #5 | Clinical Range | Verdict |
|---|---|---|---|---|---|---|---|---|
[One row per ingredient in DOVIVE anchor. DOVIVE amounts must match anchor exactly. Use exact mg from competitor supplement facts for their columns. Verdict: Under-dosed / Clinical / Over-dosed / Not used]

**Why each DOVIVE ingredient beats competitors:**
[One bullet per ingredient - specific clinical or quality reason]

**DOVIVE Unique Differentiators** (ingredients competitors don't have at clinical dose):
[bullet list]

**Competitive Gaps** (ingredients competitors have that we don't - and whether we should add them):
[bullet list]

**Bottom line - why our formula wins:**
[2-3 sentences, referencing specific amounts from the anchor]

## FLAVOR & TASTE QA
(Gummies live or die on taste - critical for repeat purchases and reviews)

**Category Flavor Intelligence:**
- Top competitor flavors: [from data above]
- What 1-star reviews say: [common taste complaints in supplement gummy category]

**Recommended Flavor Strategy for DOVIVE ${keyword}:**
| Element | Recommendation | Reason |
|---|---|---|
| Primary flavor | [specific flavor name] | [why this flavor aligns with category demand and masking needs] |
| Flavor intensity | [mild/medium/bold] | [balance with active taste] |
| Sweetener system | [stevia / monk fruit / erythritol blend + amounts] | [sugar-free, no aftertaste] |
| Masking agent | [citric acid / natural flavor blend] | [cuts bitterness] |
| Color | [natural color] | [consumer expectation] |
| Texture target | [firm/soft, chew time] | [gummy standard] |

**Pilot Testing Priority:** [what to test first in CMO pilot runs]
**Risk:** [main taste risk and how to mitigate]

## FLAVOR_RECOMMENDATIONS_JSON
Return ONLY a valid JSON array with 5 to 7 items. Use this exact schema per item:
[
  {
    "flavor_name": "string",
    "rank": 1,
    "confidence": 75,
    "provenance": {
      "source_brand": "exact brand name from competitor data above, or empty string",
      "source_asin": "exact ASIN from competitor data above, or empty string",
      "source_field": "title|supplement_facts_raw|marketing_analysis.other_ingredients|derived"
    },
    "evidence": {
      "competitor_presence": "high|medium|low",
      "review_signal": "string",
      "market_fit_reason": "string"
    },
    "formulation_notes": {
      "masking_strategy": "string",
      "sweetener_system": "string",
      "color_direction": "string"
    }
  }
]
Rules:
- Must return 5-7 flavors only (not less than 5, not more than 7).
- Must be grounded in provided competitor flavors + market context.
- No hardcoded generic list without evidence.
- confidence: 0-100 integer reflecting signal strength (80-100 = multiple top competitors confirmed, 50-79 = single competitor or indirect signal, 20-49 = category inference, 10-19 = sparse/emergency fallback).
- provenance: cite the specific competitor brand + ASIN + field where the flavor signal was found; use empty strings if derived from category context.

## FLAVOR_SUMMARY_JSON
Return ONLY a valid JSON object with exactly two fields:
{
  "what_worked": "Paragraph describing which competitor signals clearly drove the recommendations and why those flavors ranked highest.",
  "what_didnt": "Paragraph describing which competitor signals were weak, ambiguous, or absent, and why those flavors were ranked lower or excluded."
}

## COMPETITOR_NOTES_JSON
Return ONLY a valid JSON object. One entry per ASIN. One sentence comparing their formula to ours. Focus on the most important difference (dose, ingredient quality, or certification).
{"ASIN": "comparison note", ...}
`;
}

async function runCall2(keyword, grokBrief, claudeBrief, adjustedFormula, competitors, marketIntelText) {
  console.log(`\nRunning Call 2: Comprehensive Comparison + Flavor QA + Competitor Notes...`);
  const prompt = buildCall2Prompt(keyword, grokBrief, claudeBrief, adjustedFormula, competitors, marketIntelText);
  console.log(`  Prompt size: ${Math.round(prompt.length / 1000)}k chars`);
  const call2Start = Date.now();
  const result = await callClaudeSonnetQA(prompt, 6000);
  const call2Elapsed = Math.round((Date.now() - call2Start) / 1000);
  console.log(`  Call 2 done: ${Math.round(result.length / 1000)}k chars (${call2Elapsed}s)`);

  // Parse sections from call 2
  const comparisonMatch    = result.match(/## COMPREHENSIVE INGREDIENT COMPARISON([\s\S]*?)(?:\n## FLAVOR|$)/);
  const flavorMatch        = result.match(/## FLAVOR & TASTE QA([\s\S]*?)(?:\n## FLAVOR_RECOMMENDATIONS_JSON|$)/);
  const flavorJsonMatch    = result.match(/## FLAVOR_RECOMMENDATIONS_JSON([\s\S]*?)(?:\n## FLAVOR_SUMMARY_JSON|\n## COMPETITOR_NOTES_JSON|$)/);
  const flavorSummaryMatch = result.match(/## FLAVOR_SUMMARY_JSON([\s\S]*?)(?:\n## COMPETITOR_NOTES_JSON|$)/);
  const notesMatch         = result.match(/## COMPETITOR_NOTES_JSON([\s\S]*)/);

  const comprehensiveComparison = comparisonMatch?.[1]?.trim() || null;
  const flavorQA                = flavorMatch?.[1]?.trim() || null;
  const flavorRaw               = flavorJsonMatch?.[1]?.trim() || '';
  const flavorSummaryRaw        = flavorSummaryMatch?.[1]?.trim() || '';
  const notesRaw                = notesMatch?.[1]?.trim() || '';

  // Parse flavor recommendations JSON
  let flavorRecommendations = [];
  try {
    const cleanFlavor = flavorRaw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const arr = cleanFlavor.match(/\[[\s\S]*\]/)?.[0];
    const parsed = arr ? JSON.parse(arr) : [];
    flavorRecommendations = Array.isArray(parsed) ? parsed : [];
  } catch {}

  // Parse flavor summary JSON
  let flavorSummary = null;
  try {
    const cleanSummary = flavorSummaryRaw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const obj = cleanSummary.match(/\{[\s\S]*\}/)?.[0];
    flavorSummary = obj ? JSON.parse(obj) : null;
  } catch {}

  // Parse competitor notes JSON
  const jsonBlock = notesRaw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  let competitorNotes = {};
  try {
    const obj = jsonBlock.match(/\{[\s\S]*\}/)?.[0];
    competitorNotes = obj ? JSON.parse(obj) : {};
  } catch {}

  console.log(`  Comprehensive comparison: ${comprehensiveComparison ? Math.round(comprehensiveComparison.length/1000)+'k chars OK' : 'MISSING'}`);
  console.log(`  Flavor QA: ${flavorQA ? Math.round(flavorQA.length/1000)+'k chars OK' : 'MISSING'}`);
  console.log(`  Flavor recommendations: ${flavorRecommendations.length} items`);
  console.log(`  Flavor summary: ${flavorSummary ? 'OK' : 'MISSING'}`);
  console.log(`  Competitor notes: ${Object.keys(competitorNotes).length} ASINs`);

  const call2ParseStatus = {
    comprehensive_comparison: !!comprehensiveComparison,
    flavor_qa: !!flavorQA,
    flavor_recommendations_count: flavorRecommendations.length,
    flavor_summary: !!flavorSummary,
    competitor_notes_count: Object.keys(competitorNotes).length,
    missing_sections: [
      !comprehensiveComparison && 'comprehensive_comparison',
      !flavorQA && 'flavor_qa',
      flavorRecommendations.length === 0 && 'flavor_recommendations_json',
      !flavorSummary && 'flavor_summary_json',
      Object.keys(competitorNotes).length === 0 && 'competitor_notes_json',
    ].filter(Boolean),
  };
  if (call2ParseStatus.missing_sections.length > 0) {
    console.warn(`  ⚠ Call 2 parse failures: ${call2ParseStatus.missing_sections.join(', ')}`);
  }

  return { comprehensiveComparison, flavorQA, flavorRecommendations, flavorSummary, competitorNotes, elapsed: call2Elapsed, parseStatus: call2ParseStatus };
}

// ── Call 3: Competitor Notes ONLY - tiny focused JSON call ────────────────────
async function runCall3CompetitorNotes(keyword, adjustedFormula, competitors) {
  console.log(`\nRunning Call 3: Competitor Notes (JSON only)...`);
  const top10 = (competitors || []).slice(0, 10);

  const compLines = top10.map(c => {
    const sf = (c.supplement_facts_raw || '').slice(0, 300);
    return `ASIN: ${c.asin} | Brand: ${c.brand} | BSR: ${c.bsr_current} | $${c.price}
Formula: ${sf || 'Not available'}`;
  }).join('\n\n');

  // Pass full formula as anchor - competitor notes must reference exact amounts
  const adjSummary = adjustedFormula || 'Not yet generated';

  const prompt = `You are a supplement analyst. Compare DOVIVE's formula to each competitor. Output ONLY a valid JSON object — no markdown, no explanation, no code fences. Pure JSON only.

⚠️ Use the EXACT ingredient amounts from the formula anchor below in your comparison notes. Do not invent different amounts.

DOVIVE's ${keyword} FORMULA ANCHOR (QA-approved final spec):
${adjSummary}

COMPETITORS:
${compLines}

Return this exact format - use the EXACT ASIN codes listed above, one entry per ASIN:
{${top10.map(c => `"${c.asin}": "one sentence"`).join(', ')}}

Replace each "one sentence" with your comparison. Focus on the most important difference (dose, ingredient quality, certification, or price). Return ONLY pure JSON, no markdown.`;

  const key = getOpenRouterKey();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000);
  const call3Start = Date.now();
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal: controller.signal,
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const text = await res.text();
    const parsed = JSON.parse(text);
    if (parsed.usage) {
      console.log(`  Call 3 tokens: ${parsed.usage.prompt_tokens}→${parsed.usage.completion_tokens}`);
      tokenLog.push({ call: tokenLog.length + 1, prompt_tokens: parsed.usage.prompt_tokens, completion_tokens: parsed.usage.completion_tokens, total_tokens: parsed.usage.total_tokens, ts: new Date().toISOString() });
    }
    const raw = parsed.choices?.[0]?.message?.content?.trim() || '';
    // Try to extract JSON - handle if Claude adds any wrapping text
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) { console.log(`  No JSON found in response. Raw: ${raw.slice(0, 200)}`); return {}; }
    const notes = JSON.parse(jsonMatch[0]);
    const elapsed = Math.round((Date.now() - call3Start) / 1000);
    console.log(`  Competitor notes: ${Object.keys(notes).length} ASINs OK (${elapsed}s)`);
    return notes;
  } catch (e) {
    console.log(`  Call 3 failed: ${e.message}`);
    return {};
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Build run audit markdown section ──────────────────────────────────────────────────────
function buildRunAuditMarkdown(audit) {
  const missing = audit.call2ParseStatus?.missing_sections || [];
  const call2Desc = audit.call2Status === 'success'
    ? '✅ success (' + (audit.call2Elapsed ?? 'N/A') + 's)'
    : audit.call2Status === 'partial'
      ? '⚠ partial — missing: ' + missing.join(', ') + ' (' + (audit.call2Elapsed ?? 'N/A') + 's)'
      : '❌ failed';
  return [
    '',
    '---',
    '',
    '## P10 RUN AUDIT',
    '*Generated: ' + audit.timestamp + '*',
    '',
    '| Field | Value |',
    '|---|---|',
    '| Keyword | ' + audit.keyword + ' |',
    '| Model | ' + audit.model + ' |',
    '| Call 1 | ' + (audit.call1Status === 'success' ? '✅ success' : '❌ failed') + ' (' + (audit.call1Elapsed ?? 'N/A') + 's) |',
    '| Call 2 | ' + call2Desc + ' |',
    '| Call 3 | ' + (audit.call3Status === 'success' ? '✅ success' : '❌ failed') + ' |',
    '| Flavor Count | ' + audit.flavorCount + '/5-7 |',
    '| Flavor Fallback Used | ' + audit.flavorFallbackUsed + ' |',
    '| Flavor Summary Present | ' + audit.flavorSummaryPresent + ' |',
    '| Total Tokens | ' + (audit.totalTokens || 0).toLocaleString() + ' |',
    '| Estimated Cost USD | $' + (audit.estimatedCostUsd ?? 'N/A') + ' |',
  ].join('\n');
}

async function run() {
  console.log(`\n${'â•'.repeat(62)}`);
  console.log(`P9: FORMULA QA & COMPETITIVE BENCHMARKING â€" "${KEYWORD}"`);
  console.log(`${'â•'.repeat(62)}\n`);


  // Dynamic category lookup - no hardcoded CAT_ID
  let CAT_ID;
  let catName;
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
  console.log(`Category: ${catName} (${CAT_ID})\n`);

  // Check if already done
  if (!FORCE) {
    const { data: existing } = await DASH.from('formula_briefs')
      .select('ingredients').eq('category_id', CAT_ID).limit(1).single();
    if (existing?.ingredients?.qa_report) {
      console.log(`âœ… P9 QA report already exists. Use --force to regenerate.`);
      return;
    }
  }

  // Load BOTH P9 formula briefs (Grok 4.2 + Claude Sonnet 4.6)
  console.log(`Loading dual P9 formula briefs (Grok 4.2 + Claude Sonnet 4.6)...`);
  const { data: briefRow } = await DASH.from('formula_briefs')
    .select('id, ingredients').eq('category_id', CAT_ID)
    .not('ingredients', 'is', null).limit(1).single();
  const grokBrief   = briefRow?.ingredients?.ai_generated_brief_grok   || briefRow?.ingredients?.ai_generated_brief || null;
  const claudeBrief = briefRow?.ingredients?.ai_generated_brief_claude || null;
  if (!grokBrief && !claudeBrief) {
    console.error('ERROR: No P9 formula briefs found. Run phase8-formula-brief.js first.');
    setTimeout(() => process.exit(1), 100);
  }
  console.log(`  Grok 4.2 brief:    ${grokBrief   ? Math.round(grokBrief.length/1000)+'k chars OK' : 'NOT FOUND'}`);
  console.log(`  Claude Opus brief: ${claudeBrief ? Math.round(claudeBrief.length/1000)+'k chars OK' : 'NOT FOUND (single model run)'}`);

  // Load P6 market intelligence
  console.log(`Loading P6 market intelligence...`);
  const marketIntel = loadMarketIntelFromVault(KEYWORD);
  console.log(`  ${marketIntel ? `OK Loaded from vault (${Math.round(marketIntel.length / 1000)}k chars)` : 'Not found in vault - P10 will run without market context'}`);

  // Load top 10 competitors
  console.log(`Loading top 10 competitors with formulas...`);
  const { data: competitors } = await DASH.from('products')
    .select(`asin, brand, title, bsr_current, price, monthly_revenue, monthly_sales,
             rating_value, rating_count, supplement_facts_raw, marketing_analysis`)
    .eq('category_id', CAT_ID)
    .not('bsr_current', 'is', null)
    .order('bsr_current', { ascending: true })
    .limit(20);
  console.log(`  OK ${competitors?.length || 0} competitors loaded\n`);

  // Build dual-comparison QA prompt
  console.log(`Building dual-comparison QA prompt...`);
  const prompt = buildQAPrompt(grokBrief, marketIntel, competitors || [], KEYWORD, claudeBrief);
  console.log(`  Prompt size: ${Math.round(prompt.length / 1000)}k chars\n`);

  // â"€â"€ Call Grok â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  console.log(`Calling Claude Sonnet 4.6 via OpenRouter (QA adjudicator)...`);
  const startTime = Date.now();
  const qaReport = await callClaudeSonnetQA(prompt, 16000);
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`  âœ… Done (${elapsed}s, ${Math.round(qaReport.length / 1000)}k chars)\n`);

  // â"€â"€ Parse output â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const verdict = parseQAVerdict(qaReport);
  const competitorNotes = parseCompetitorNotes(qaReport);
  const noteCount = Object.keys(competitorNotes).length;
  console.log(`QA Verdict: ${verdict.verdict} | Score: ${verdict.score}/10`);
  console.log(`Competitor notes parsed: ${noteCount}\n`);

  // ── Parse Final Formula Brief FIRST (written first in output) ──────────────
  const finalBriefMatch = qaReport.match(/## FINAL FORMULA BRIEF([\s\S]*?)(?:\n## QA VERDICT|$)/);
  const finalFormulaBrief = finalBriefMatch?.[1]?.trim() || null;
  if (finalFormulaBrief) {
    console.log(`  Final Formula Brief: ${Math.round(finalFormulaBrief.length / 1000)}k chars OK`);
  } else {
    console.log(`  WARNING: Final Formula Brief section not found in QA output`);
  }

  // ── Adjusted formula: standalone section OR extracted from brief ─────────────
  const adjustedFormulaMatch = qaReport.match(/## ADJUSTED FORMULA SPECIFICATION([\s\S]*?)(?:\n## |$)/);
  const adjustedFormulaFromBrief = finalFormulaBrief
    ? finalFormulaBrief.match(/### Recommended Formula[\s\S]*?(?=\n### |$)/)?.[0]?.trim() || null
    : null;
  const adjustedFormula = adjustedFormulaMatch?.[1]?.trim() || adjustedFormulaFromBrief || null;
  if (adjustedFormula) {
    const src = adjustedFormulaMatch ? 'standalone section' : 'extracted from Final Formula Brief';
    console.log(`  Adjusted formula: ${Math.round(adjustedFormula.length / 1000)}k chars OK (${src})`);
  } else {
    console.log(`  WARNING: Adjusted formula not found`);
  }

  const adjustmentsMatch = qaReport.match(/## FORMULA ADJUSTMENTS\s*\n[\s\S]*?\n(\|[\s\S]*?)(?:\n## )/);
  const adjustmentsTable = adjustmentsMatch?.[1]?.trim() || null;

  // ── Formula Validator — hard manufacturing constraint check ─────────────────
  const { validateFormula, formatValidationReport } = require('./formula-validator');
  const validationResult = validateFormula(adjustedFormula || finalFormulaBrief || '');
  const validationReport = formatValidationReport(validationResult);
  console.log('Formula Validation: ' + (validationResult.valid ? 'PASS ✅' : 'FAIL ❌') + ' | ' + validationResult.perGummy_mg + 'mg/gummy | ' + validationResult.errors.length + ' errors');
  validationResult.errors.forEach(e => console.log("  VALIDATOR ERROR:", e));
  validationResult.warnings.forEach(w => console.log("  VALIDATOR WARN:", w));

  // â"€â"€ Save QA report to formula_briefs â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  console.log(`Saving QA report to Supabase...`);
  const updatedIngredients = {
    ...(briefRow.ingredients || {}),
    qa_report: qaReport + '\n\n' + validationReport,
    qa_verdict: verdict,
    adjusted_formula: adjustedFormula,
    final_formula_brief: finalFormulaBrief,
    adjustments_table: adjustmentsTable,
    formula_validation: validationResult,
    qa_generated_at: new Date().toISOString(),
  };
  const { error: saveErr } = await DASH.from('formula_briefs')
    .update({ ingredients: updatedIngredients })
    .eq('id', briefRow.id);
  if (saveErr) console.error(`  âŒ Save error: ${saveErr.message}`);
  else console.log(`  âœ… Saved to formula_briefs.ingredients.qa_report`);

  // ── Call 2 invocation ──────────────────────────────────────────────────────
  const marketIntelText = marketIntel || '';
  let comprehensiveComparison = null;
  let flavorQA = null;
  let flavorRecommendations = [];
  let flavorSummary = null;
  let call2Notes = {};
  let call2Elapsed = null;
  let call2Status = 'not_started';
  let call2ParseStatus = null;

  try {
    const c2 = await runCall2(KEYWORD, grokBrief, claudeBrief, adjustedFormula, competitors, marketIntelText);
    comprehensiveComparison = c2.comprehensiveComparison;
    flavorQA = c2.flavorQA;
    flavorRecommendations = Array.isArray(c2.flavorRecommendations) ? c2.flavorRecommendations : [];
    flavorSummary = c2.flavorSummary || null;
    call2Notes = c2.competitorNotes || {};
    call2Elapsed = c2.elapsed || null;
    call2ParseStatus = c2.parseStatus || null;
    call2Status = (call2ParseStatus?.missing_sections?.length === 0) ? 'success' : 'partial';
  } catch (e) {
    console.error(`Call 2 failed: ${e.message}`);
    call2Status = 'failed';
  }

  let flavorCount = Array.isArray(flavorRecommendations) ? flavorRecommendations.length : 0;
  let flavorFallbackUsed = false;
  if (flavorCount < 5 || flavorCount > 7) {
    flavorFallbackUsed = true;
    console.warn(`⚠ Flavor recommendation count out of contract: ${flavorCount} (required 5-7)`);
    // Derive candidate flavors with provenance from competitor signals, then pad with category defaults
    const flavorList = ['apple','mixed berry','blackberry','raspberry','strawberry','lemon','citrus','tropical','mango','peach','cherry','watermelon'];
    const detectedFlavorMap = new Map(); // flavor_name -> { brand, asin, field }
    for (const c of (competitors || []).slice(0, 20)) {
      const fields = [
        { key: 'title',                                 text: (c?.title || '').toLowerCase() },
        { key: 'supplement_facts_raw',                  text: (c?.supplement_facts_raw || '').toLowerCase() },
        { key: 'marketing_analysis.other_ingredients',  text: (c?.marketing_analysis?.other_ingredients || '').toLowerCase() },
      ];
      for (const { key, text } of fields) {
        for (const f of flavorList) {
          if (text.includes(f) && !detectedFlavorMap.has(f)) {
            detectedFlavorMap.set(f, { brand: c.brand || '', asin: c.asin || '', field: key });
          }
        }
      }
    }
    const detectedFlavors = Array.from(detectedFlavorMap.keys());
    const categoryDefaults = ['apple','mixed berry','blackberry','raspberry','strawberry','lemon','citrus'];
    const existingNames = new Set(flavorRecommendations.map(r => (r.flavor_name || '').toLowerCase()));
    const candidates = [...new Set([...detectedFlavors, ...categoryDefaults])].filter(n => !existingNames.has(n));

    if (flavorCount < 5) {
      // Pad to minimum 5 using competitor signals then category defaults
      const needed = 5 - flavorCount;
      const padEntries = candidates.slice(0, needed).map((name, i) => {
        const prov = detectedFlavorMap.get(name);
        return {
          flavor_name: name,
          rank: flavorCount + i + 1,
          confidence: prov ? 55 : 25,
          provenance: {
            source_brand: prov?.brand || 'category-default',
            source_asin:  prov?.asin  || '',
            source_field: prov?.field || 'derived',
          },
          evidence: {
            competitor_presence: prov ? 'high' : 'medium',
            review_signal: prov
              ? `Detected in ${prov.brand} (${prov.asin}) ${prov.field}`
              : 'Category-relevant default for gummy supplements',
            market_fit_reason: 'Matches observed category flavor trend and positioning'
          },
          formulation_notes: {
            masking_strategy: 'acid + natural flavor blend balancing active notes',
            sweetener_system: 'erythritol + stevia/monk fruit blend',
            color_direction: 'natural fruit-aligned color'
          }
        };
      });
      flavorRecommendations = [...flavorRecommendations, ...padEntries];
      console.log(`  Padded flavor recommendations to ${flavorRecommendations.length} (added ${padEntries.length} from competitor/category signals)`);
    }

    // Cap to maximum 7
    if (flavorRecommendations.length > 7) {
      flavorRecommendations = flavorRecommendations.slice(0, 7);
      console.log(`  Trimmed flavor recommendations to 7`);
    }

    flavorCount = flavorRecommendations.length;
  } else {
    console.log(`✅ Flavor recommendation contract met: ${flavorCount}/5-7`);
  }

  // Hard-enforce 5-7 before persisting (safety net — runs even if Call 2 failed)
  flavorRecommendations = flavorRecommendations.slice(0, 7);
  while (flavorRecommendations.length < 5) {
    const emergencyFlavors = ['apple', 'mixed berry', 'strawberry', 'lemon', 'raspberry', 'citrus', 'peach'];
    const name = emergencyFlavors[flavorRecommendations.length] || `flavor-${flavorRecommendations.length + 1}`;
    flavorRecommendations.push({
      flavor_name: name, rank: flavorRecommendations.length + 1,
      confidence: 10,
      provenance: { source_brand: 'emergency-fallback', source_asin: '', source_field: 'derived' },
      evidence: { competitor_presence: 'medium', review_signal: 'Emergency category fallback', market_fit_reason: 'Category default for gummy supplements' },
      formulation_notes: { masking_strategy: 'natural flavor blend', sweetener_system: 'stevia blend', color_direction: 'natural' }
    });
  }
  flavorCount = flavorRecommendations.length;

  // Call 3: dedicated JSON-only competitor notes (always runs, always completes)
  const call3Notes = await runCall3CompetitorNotes(KEYWORD, adjustedFormula, competitors);
  const call3Status = Object.keys(call3Notes).length > 0 ? 'success' : 'failed';

  // Merge: call3 > call2 > call1 parsed notes
  const finalNotes = { ...competitorNotes, ...call2Notes, ...call3Notes };
  const finalNoteCount = Object.keys(finalNotes).length;
  console.log(`Competitor notes total: ${finalNoteCount}`);

  // Save call2 sections into formula_briefs.ingredients
  let mergedQaReport = updatedIngredients.qa_report; // will be updated below, used for vault
  {
    // Always append FLAVOR RECOMMENDATIONS section whenever flavor_recommendations exists
    const flavorSectionBody = renderFlavorRecommendationsTable(flavorRecommendations, flavorSummary);
    const flavorSection = flavorSectionBody ? `\n\n${flavorSectionBody}` : '';
    mergedQaReport = updatedIngredients.qa_report
      + (comprehensiveComparison ? '\n\n## COMPREHENSIVE INGREDIENT COMPARISON\n' + comprehensiveComparison : '')
      + (flavorQA ? '\n\n## FLAVOR & TASTE QA\n' + flavorQA : '')
      + flavorSection;

    const finalFormulaBriefWithFlavors = (updatedIngredients.final_formula_brief || '')
      + (flavorSectionBody ? `\n\n${flavorSectionBody}` : '');

    // Token cost estimate (claude-sonnet-4-6 via OpenRouter ~$3/1M tokens)
    const totalTokens = tokenLog.reduce((s, t) => s + (t.total_tokens || 0), 0);
    const estimatedCostUsd = parseFloat(((totalTokens / 1_000_000) * 3.0).toFixed(4));

    const pipelineMetadata = {
      keyword: KEYWORD,
      generated_at: new Date().toISOString(),
      call1_elapsed_s: elapsed,
      call2_elapsed_s: call2Elapsed,
      call1_prompt_chars: Math.round(prompt.length),
      call1_status: qaReport ? 'success' : 'failed',
      call2_status: call2Status,
      call2_parse_status: call2ParseStatus,
      call3_status: call3Status,
      flavor_count: flavorCount,
      flavor_fallback_used: flavorFallbackUsed,
      flavor_summary_present: flavorSummary !== null,
      flavor_source_breakdown: {
        high_confidence: flavorRecommendations.filter(f => (f.confidence ?? 0) >= 50).length,
        low_confidence: flavorRecommendations.filter(f => (f.confidence ?? 0) < 50).length,
        emergency_fallback: flavorRecommendations.filter(f => f.provenance?.source_brand === 'emergency-fallback').length,
      },
      token_log: tokenLog,
      total_tokens: totalTokens,
      estimated_cost_usd: estimatedCostUsd,
    };
    console.log(`  Token usage: ${totalTokens.toLocaleString()} total | est. cost: $${estimatedCostUsd}`);

    // Append structured run audit to qa_report
    const runAuditMd = buildRunAuditMarkdown({
      timestamp: pipelineMetadata.generated_at,
      keyword: KEYWORD,
      model: 'anthropic/claude-sonnet-4-6',
      call1Status: pipelineMetadata.call1_status,
      call1Elapsed: elapsed,
      call2Status,
      call2Elapsed,
      call2ParseStatus,
      call3Status,
      flavorCount,
      flavorFallbackUsed,
      flavorSummaryPresent: flavorSummary !== null,
      totalTokens,
      estimatedCostUsd,
    });
    mergedQaReport = mergedQaReport + runAuditMd;

    const { error: c2Err } = await DASH.from('formula_briefs')
      .update({
        ingredients: {
          ...updatedIngredients,
          comprehensive_comparison: comprehensiveComparison,
          flavor_qa: flavorQA,
          flavor_recommendations: flavorRecommendations,
          final_formula_brief: finalFormulaBriefWithFlavors,
          qa_report: mergedQaReport,
          qa_pipeline_metadata: pipelineMetadata,
          qa_run_audit: {
            timestamp: pipelineMetadata.generated_at,
            model: 'anthropic/claude-sonnet-4-6',
            call1_status: pipelineMetadata.call1_status,
            call2_status: call2Status,
            call2_parse_status: call2ParseStatus,
            call3_status: call3Status,
            flavor_count: flavorCount,
            flavor_fallback_used: flavorFallbackUsed,
            flavor_summary_present: flavorSummary !== null,
            total_tokens: totalTokens,
            estimated_cost_usd: estimatedCostUsd,
            token_log: tokenLog,
          },
        }
      })
      .eq('id', briefRow.id);
    if (c2Err) console.error('  Call 2 save error:', c2Err.message);
    else console.log('  Call 2 results saved (comparison + flavor QA + pipeline metadata + run audit) OK');
  }

  if (finalNoteCount > 0) {
    console.log('Saving ' + finalNoteCount + ' competitor notes to products...');
    let notesSaved = 0;
    for (const [asin, note] of Object.entries(finalNotes || {})) {
      const { data: prod } = await DASH.from('products')
        .select('marketing_analysis').eq('asin', asin).maybeSingle();
      if (!prod) continue;
      const existing = prod.marketing_analysis || {};
      const { error: ne } = await DASH.from('products').update({
        marketing_analysis: { ...existing, qa_comparison_note: note }
      }).eq('asin', asin);
      if (!ne) notesSaved++;
    }
    console.log('  Notes saved to products: ' + notesSaved + '/' + finalNoteCount + ' OK');
  } else {
    console.log('  No competitor notes to save');
  }

  // â"€â"€ Save to vault â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  console.log(`\nSaving to vault...`);
  const date = new Date().toISOString().split('T')[0];
  const slug = KEYWORD.replace(/\s+/g, '-').toLowerCase();
  const vaultDir = 'C:\\SirPercival-Vault\\07_ai-systems\\agents\\scout\\qa-reports';
  if (!fs.existsSync(vaultDir)) fs.mkdirSync(vaultDir, { recursive: true });
  const vaultPath = path.join(vaultDir, `${date}-${slug}-qa-report.md`);
  fs.writeFileSync(vaultPath, [
    `# P9 Formula QA Report — ${KEYWORD}`,
    `Generated: ${new Date().toISOString()}`,
    `Verdict: ${verdict.verdict} | Score: ${verdict.score}/10`,
    `Call 1 elapsed: ${elapsed}s | Call 2 elapsed: ${call2Elapsed ?? 'N/A'}s`,
    `Flavor recommendations: ${flavorCount} (high-conf: ${flavorRecommendations.filter(f => (f.confidence ?? 0) >= 50).length})`,
    ``,
    mergedQaReport,
  ].join('\n'));
  console.log(`  âœ… ${vaultPath}`);

  // â"€â"€ Preview â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  console.log(`\n${'â•'.repeat(62)}`);
  console.log(`P9 COMPLETE`);
  console.log(`Verdict: ${verdict.verdict} | Score: ${verdict.score}/10`);
  console.log(`Summary: ${verdict.summary}`);
  console.log(`Report: ${Math.round(qaReport.length / 1000)}k chars | Competitor notes: ${noteCount}`);
  if (adjustedFormula) console.log(`Adjusted formula: extracted âœ…`);
}


run()
  .then(() => setTimeout(() => process.exit(0), 500))
  .catch(function(e) {
    console.error(e.message);
    setTimeout(() => process.exit(1), 500);
  });