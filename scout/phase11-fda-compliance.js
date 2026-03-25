/**
 * phase11-fda-compliance.js — FDA Regulatory Compliance & Label Claim Validation (P12)
 *
 * Validates our final formula against REAL FDA/NIH data fetched at runtime.
 * Designed to minimize hallucination by grounding every UL claim in live-fetched data.
 *
 * Anti-hallucination architecture:
 *   1. Fetches actual NIH ODS fact sheets per ingredient at runtime (real UL values)
 *   2. Claude Opus 4.6 (primary) — validates using ONLY fetched data, flags unverifiable claims
 *   3. Claude Sonnet 4.6 validates Claude Opus findings — adversarial cross-check for missed issues
 *   4. Every dose limit must cite a fetched URL — "training_data_unverified" if not found
 *   5. No disease claims, only DSHEA-compliant structure/function claims
 *
 * Output:
 *   - formula_briefs.ingredients.fda_compliance (JSON + markdown)
 *   - Vault: C:\SirPercival-Vault\07_ai-systems\agents\scout\fda-compliance\
 *
 * Usage:
 *   node phase11-fda-compliance.js --keyword "biotin gummies"
 *   node phase11-fda-compliance.js --keyword "biotin gummies" --force
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

// ─── NIH ODS URL Map ───────────────────────────────────────────────────────────
// Only include ingredients with actual NIH ODS fact sheets.
// Ingredients NOT in this map → "No NIH UL established" (accurate for botanicals).

const NIH_ODS_MAP = {
  'biotin':              'https://ods.od.nih.gov/factsheets/Biotin-HealthProfessional/',
  'vitamin a':           'https://ods.od.nih.gov/factsheets/VitaminA-HealthProfessional/',
  'retinol':             'https://ods.od.nih.gov/factsheets/VitaminA-HealthProfessional/',
  'beta-carotene':       'https://ods.od.nih.gov/factsheets/VitaminA-HealthProfessional/',
  'vitamin c':           'https://ods.od.nih.gov/factsheets/VitaminC-HealthProfessional/',
  'ascorbic acid':       'https://ods.od.nih.gov/factsheets/VitaminC-HealthProfessional/',
  'vitamin d':           'https://ods.od.nih.gov/factsheets/VitaminD-HealthProfessional/',
  'vitamin d3':          'https://ods.od.nih.gov/factsheets/VitaminD-HealthProfessional/',
  'cholecalciferol':     'https://ods.od.nih.gov/factsheets/VitaminD-HealthProfessional/',
  'vitamin e':           'https://ods.od.nih.gov/factsheets/VitaminE-HealthProfessional/',
  'tocopherol':          'https://ods.od.nih.gov/factsheets/VitaminE-HealthProfessional/',
  'vitamin k':           'https://ods.od.nih.gov/factsheets/VitaminK-HealthProfessional/',
  'thiamin':             'https://ods.od.nih.gov/factsheets/Thiamin-HealthProfessional/',
  'vitamin b1':          'https://ods.od.nih.gov/factsheets/Thiamin-HealthProfessional/',
  'riboflavin':          'https://ods.od.nih.gov/factsheets/Riboflavin-HealthProfessional/',
  'vitamin b2':          'https://ods.od.nih.gov/factsheets/Riboflavin-HealthProfessional/',
  'niacin':              'https://ods.od.nih.gov/factsheets/Niacin-HealthProfessional/',
  'vitamin b3':          'https://ods.od.nih.gov/factsheets/Niacin-HealthProfessional/',
  'niacinamide':         'https://ods.od.nih.gov/factsheets/Niacin-HealthProfessional/',
  'pantothenic acid':    'https://ods.od.nih.gov/factsheets/PantothenicAcid-HealthProfessional/',
  'vitamin b5':          'https://ods.od.nih.gov/factsheets/PantothenicAcid-HealthProfessional/',
  'vitamin b6':          'https://ods.od.nih.gov/factsheets/VitaminB6-HealthProfessional/',
  'pyridoxine':          'https://ods.od.nih.gov/factsheets/VitaminB6-HealthProfessional/',
  'folate':              'https://ods.od.nih.gov/factsheets/Folate-HealthProfessional/',
  'folic acid':          'https://ods.od.nih.gov/factsheets/Folate-HealthProfessional/',
  'vitamin b9':          'https://ods.od.nih.gov/factsheets/Folate-HealthProfessional/',
  'vitamin b12':         'https://ods.od.nih.gov/factsheets/VitaminB12-HealthProfessional/',
  'cobalamin':           'https://ods.od.nih.gov/factsheets/VitaminB12-HealthProfessional/',
  'methylcobalamin':     'https://ods.od.nih.gov/factsheets/VitaminB12-HealthProfessional/',
  'calcium':             'https://ods.od.nih.gov/factsheets/Calcium-HealthProfessional/',
  'iron':                'https://ods.od.nih.gov/factsheets/Iron-HealthProfessional/',
  'magnesium':           'https://ods.od.nih.gov/factsheets/Magnesium-HealthProfessional/',
  'phosphorus':          'https://ods.od.nih.gov/factsheets/Phosphorus-HealthProfessional/',
  'zinc':                'https://ods.od.nih.gov/factsheets/Zinc-HealthProfessional/',
  'iodine':              'https://ods.od.nih.gov/factsheets/Iodine-HealthProfessional/',
  'selenium':            'https://ods.od.nih.gov/factsheets/Selenium-HealthProfessional/',
  'copper':              'https://ods.od.nih.gov/factsheets/Copper-HealthProfessional/',
  'manganese':           'https://ods.od.nih.gov/factsheets/Manganese-HealthProfessional/',
  'chromium':            'https://ods.od.nih.gov/factsheets/Chromium-HealthProfessional/',
  'molybdenum':          'https://ods.od.nih.gov/factsheets/Molybdenum-HealthProfessional/',
  'omega-3':             'https://ods.od.nih.gov/factsheets/Omega3FattyAcids-HealthProfessional/',
  'dha':                 'https://ods.od.nih.gov/factsheets/Omega3FattyAcids-HealthProfessional/',
  'epa':                 'https://ods.od.nih.gov/factsheets/Omega3FattyAcids-HealthProfessional/',
  'melatonin':           'https://ods.od.nih.gov/factsheets/Melatonin-HealthProfessional/',
  'coenzyme q10':        'https://ods.od.nih.gov/factsheets/Coenzyme10-HealthProfessional/',
  'coq10':               'https://ods.od.nih.gov/factsheets/Coenzyme10-HealthProfessional/',
  'ashwagandha':         'https://ods.od.nih.gov/factsheets/Ashwagandha-HealthProfessional/',
  'withania somnifera':  'https://ods.od.nih.gov/factsheets/Ashwagandha-HealthProfessional/',
  'elderberry':          'https://ods.od.nih.gov/factsheets/Elderberry-HealthProfessional/',
  'sambucus':            'https://ods.od.nih.gov/factsheets/Elderberry-HealthProfessional/',
  'probiotics':          'https://ods.od.nih.gov/factsheets/Probiotics-HealthProfessional/',
  'lactobacillus':       'https://ods.od.nih.gov/factsheets/Probiotics-HealthProfessional/',
  'bifidobacterium':     'https://ods.od.nih.gov/factsheets/Probiotics-HealthProfessional/',
  'creatine':            'https://ods.od.nih.gov/factsheets/Creatine-HealthProfessional/',
  'berberine':           'https://ods.od.nih.gov/factsheets/Berberine-HealthProfessional/',
};

// ─── API Helpers ───────────────────────────────────────────────────────────────

function getOpenRouterKey()  { return process.env.OPENROUTER_API_KEY || null; }

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
        'X-Title': 'DOVIVE Scout P12 FDA Compliance',
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

async function callClaudeSonnet(prompt, maxTokens = 8000) {
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
        'X-Title': 'DOVIVE Scout P12 FDA Compliance',
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

// ─── NIH ODS Fetcher ──────────────────────────────────────────────────────────

async function fetchNIHData(ingredientNames) {
  const results = {};
  const seen = new Set(); // avoid duplicate fetches for same URL

  for (const name of ingredientNames) {
    const normalized = name.toLowerCase().trim()
      .replace(/\s*\(.*?\)/g, '')     // strip parenthetical
      .replace(/\d+\s*mg.*$/, '')     // strip dose suffix
      .trim();

    const url = NIH_ODS_MAP[normalized];
    if (!url) {
      results[name] = { url: null, text: null, status: 'no_nih_page' };
      continue;
    }
    if (seen.has(url)) {
      // Already fetched this URL for a different name variant
      const existing = Object.values(results).find(r => r.url === url && r.status === 'ok');
      results[name] = existing ? { ...existing } : { url, text: null, status: 'deduped' };
      continue;
    }
    seen.add(url);

    console.log(`  Fetching NIH ODS: ${name} → ${url}`);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; research/dietary-supplement-review)' },
      });
      clearTimeout(timeout);

      if (!res.ok) {
        results[name] = { url, text: null, status: `http_${res.status}` };
        continue;
      }

      const html = await res.text();
      // Strip HTML, collapse whitespace
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Extract the safety / UL section (most relevant for compliance)
      const safetyIdx = text.search(/tolerable upper intake|upper intake level|safety|adverse effect|toxicity|overdose/i);
      const dosageIdx = text.search(/recommended dietary allowance|rda|adequate intake|ai for |daily value/i);
      const startIdx = Math.min(
        safetyIdx >= 0 ? safetyIdx : text.length,
        dosageIdx >= 0 ? dosageIdx : text.length
      );
      // Take 3000 chars around the safety section, or first 2000 chars if no safety section
      const excerpt = startIdx < text.length
        ? text.slice(Math.max(0, startIdx - 300), startIdx + 2700)
        : text.slice(0, 2000);

      results[name] = { url, text: excerpt, status: 'ok' };
      console.log(`  ✅ ${name}: ${Math.round(excerpt.length / 100) * 100} chars of safety data`);
    } catch (e) {
      results[name] = { url, text: null, status: `error: ${e.message.slice(0, 100)}` };
      console.warn(`  ⚠ Failed to fetch NIH data for ${name}: ${e.message.slice(0, 80)}`);
    }
    await new Promise(r => setTimeout(r, 800)); // Rate-limit NIH requests
  }
  return results;
}

// ─── Extract ingredient names from formula text ────────────────────────────────

function extractIngredientNames(formulaText) {
  if (!formulaText) return [];
  const names = new Set();

  // Match markdown table rows: | Ingredient | Amount | ...
  const tableRows = formulaText.matchAll(/^\|\s*([^|]+?)\s*\|\s*[\d,\.]+\s*(?:mcg|mg|g|IU|%|billion)/gm);
  for (const row of tableRows) {
    const name = row[1].trim().replace(/[*_`]/g, '');
    if (name && name.length > 2 && !name.match(/^[-=]+$/)) names.add(name);
  }

  // Also match "Ingredient: Xmg" patterns
  const inlineMatches = formulaText.matchAll(/([A-Za-z][A-Za-z\s\-']+?):\s*[\d,\.]+\s*(?:mcg|mg|g|IU)/g);
  for (const m of inlineMatches) {
    const name = m[1].trim();
    if (name.length > 2) names.add(name);
  }

  return [...names].slice(0, 20); // Cap at 20 to avoid excessive NIH fetches
}

// ─── Build Claude Opus Primary Prompt ─────────────────────────────────────────

function buildOpusPrimaryPrompt(adjustedFormula, nihData, keyword) {
  const nihSection = Object.entries(nihData).map(([ingredient, data]) => {
    if (data.status === 'ok' && data.text) {
      return `### ${ingredient}
Source: ${data.url}
Key safety data (NIH ODS excerpt):
${data.text.slice(0, 1500)}
`;
    }
    return `### ${ingredient}
Status: ${data.status === 'no_nih_page' ? 'No dedicated NIH ODS fact sheet' : `Fetch failed: ${data.status}`}
⚠ No NIH UL data available — flag this ingredient as "UL not established by NIH"
`;
  }).join('\n---\n');

  return `You are an FDA regulatory specialist for dietary supplements with expertise in DSHEA compliance. You are performing a pre-launch compliance review.

## CRITICAL INSTRUCTIONS
1. For UL (Tolerable Upper Limit) values: ONLY use numbers from the NIH ODS data provided below. NEVER use numbers from your training data. If no NIH data was provided for an ingredient, write "UL not established by NIH ODS" — do not invent a number.
2. For GRAS status: Use your regulatory knowledge but mark confidence as HIGH/MEDIUM/LOW.
3. For label claims: Flag as "DISEASE CLAIM" only if a claim explicitly references treating, curing, preventing, or mitigating a disease. Structure/function claims about supporting normal body functions are DSHEA-compliant.
4. If you are unsure about any regulatory classification, write "REGULATORY_UNCERTAIN: [reason]" rather than guessing.

## DOVIVE FORMULA TO REVIEW
${adjustedFormula || 'ERROR: No formula provided'}

## REAL NIH ODS DATA (fetched live — these are the authoritative UL values for this review)
${nihSection}

---

## YOUR DELIVERABLE

# P12 FDA COMPLIANCE REVIEW — ${keyword.toUpperCase()}
*Primary analysis: Claude Opus 4.6*
*NIH data: fetched live at ${new Date().toISOString().split('T')[0]}*

## EXECUTIVE SUMMARY
| | |
|---|---|
| Overall compliance status | COMPLIANT / COMPLIANT WITH REVISIONS / NON-COMPLIANT |
| Critical issues (must fix) | [count] |
| Warnings (should fix) | [count] |
| Ingredients with NIH UL data | [count] / [total] |
| All doses within NIH UL | Yes / No — [N ingredients at or above UL] |

## INGREDIENT COMPLIANCE TABLE
| Ingredient | Our Dose | NIH UL (source URL) | GRAS Status | Dose vs UL | Status | Confidence |
|---|---|---|---|---|---|---|
[Status: ✅ COMPLIANT / ⚠ WARNING / ❌ CRITICAL]
[Dose vs UL: WELL BELOW (<50% UL) / SAFE (50-80% UL) / NEAR LIMIT (80-100% UL) / EXCEEDS UL / UL NOT ESTABLISHED]
[Confidence: HIGH (NIH data available) / MEDIUM (regulatory knowledge) / LOW (uncertain)]

For every ingredient with NIH data provided above: cite the exact URL and UL value from that data.
For every ingredient without NIH data: write "UL not established by NIH ODS" in the NIH UL column.

## LABEL CLAIMS REVIEW
Review each marketing/label claim in our formula specification:

| Claim | Type | DSHEA Status | Issue / Approved Language |
|---|---|---|---|
[Type: Structure/Function / Nutrient Content / Disease (NOT ALLOWED)]
[DSHEA Status: ✅ APPROVED / ⚠ NEEDS REVISION / ❌ PROHIBITED]

For each ❌ PROHIBITED claim, write the approved alternative.
For each ⚠ NEEDS REVISION claim, suggest the corrected language.

## SUPPLEMENT FACTS PANEL CHECK
Review the proposed Supplement Facts panel format against 21 CFR 101.36:
- [ ] Proper heading "Supplement Facts"
- [ ] Serving size and servings per container
- [ ] Daily Value (DV) or "†" (no DV established) for each ingredient
- [ ] Other ingredients listed after Supplement Facts box
- [ ] Net quantity statement
- [ ] Required disclaimer for structure/function claims: *These statements have not been evaluated by the Food and Drug Administration. This product is not intended to diagnose, treat, cure, or prevent any disease.

## CRITICAL COMPLIANCE ISSUES (must fix before launch)
| # | Issue | Ingredient/Element | FDA Citation | Required Fix |
|---|---|---|---|---|

## WARNINGS (should address before launch)
| # | Warning | Detail | Recommended Action |
|---|---|---|---|

## NDI (NEW DIETARY INGREDIENT) CHECK
List any ingredients that may require an NDI notification (ingredients not marketed before October 15, 1994 as a dietary supplement, or in a significantly different form):
| Ingredient | NDI Required? | Basis | Action |
|---|---|---|---|

## RECOMMENDED CERTIFICATIONS
| Certification | Priority | Why It Matters for This Product |
|---|---|---|
| NSF International Certified for Sport | MUST-HAVE / NICE-TO-HAVE | [reason] |
| USP Verified | ... | ... |
| Non-GMO Project Verified | ... | ... |
| Informed-Sport | ... | ... |
| Vegan / Vegetarian Society | ... | ... |
| Certified Gluten-Free | ... | ... |

## COMPLIANCE SCORE
**Score: X/100**
| Category | Score | Weight | Notes |
|---|---|---|---|
| Ingredient safety (UL compliance) | X/30 | 30% | [key finding] |
| Label claims accuracy | X/25 | 25% | [key finding] |
| Supplement Facts format | X/20 | 20% | [key finding] |
| GRAS / DSHEA status | X/15 | 15% | [key finding] |
| Labeling completeness | X/10 | 10% | [key finding] |

## REGULATORY_UNCERTAIN ITEMS
List every item where you wrote REGULATORY_UNCERTAIN and explain:
[If none: "✅ No uncertain regulatory classifications in this formula"]`;
}

// ─── Build Sonnet Validation Prompt ───────────────────────────────────────────

function buildSonnetValidationPrompt(adjustedFormula, nihData, opusAnalysis, keyword) {
  const nihSummary = Object.entries(nihData)
    .filter(([, d]) => d.status === 'ok')
    .map(([name, d]) => `${name}: ${d.url} — data available`)
    .join('\n') || 'None fetched';

  return `You are a dietary supplement regulatory expert cross-validating a compliance analysis.

## YOUR MISSION
Review the FDA compliance analysis below (produced by Claude Opus 4.6). Your job is to:
1. Verify that UL values cited are consistent with the NIH data available
2. Check for disease claims that were MISSED by Claude Opus
3. Check for over-flagged structure/function claims (false positives)
4. Identify any DSHEA compliance issues that were missed
5. Verify the compliance score is appropriate

## DOVIVE FORMULA
${(adjustedFormula || '').slice(0, 2000)}

## NIH DATA AVAILABILITY (ingredients with fetched data)
${nihSummary}

## CLAUDE OPUS 4.6 COMPLIANCE ANALYSIS (to validate)
${opusAnalysis?.slice(0, 6000) || 'Not available'}
${opusAnalysis && opusAnalysis.length > 6000 ? '\n[Analysis continues — key sections shown]\n' : ''}

---

## YOUR DELIVERABLE

# P12 GROK VALIDATION REPORT
*Validating Claude Opus 4.6 compliance analysis for ${keyword}*

## VALIDATION SUMMARY
| Check | Result |
|---|---|
| UL values accurate | ✅ Confirmed / ⚠ [N] corrections needed |
| Missed disease claims | ✅ None missed / ⚠ Found: [list] |
| False positives (over-flagged) | ✅ None / ⚠ Found: [list] |
| Missing DSHEA issues | ✅ None missed / ⚠ Found: [list] |
| Compliance score appropriate | ✅ Agrees / ⚠ Would score [X] instead because [reason] |
| Overall validation | PASS / PASS WITH MINOR CORRECTIONS / FAIL |

## CORRECTIONS TO CLAUDE'S ANALYSIS
(Only list items where Claude made an error)
| # | Claude Said | Correction | Reason |
|---|---|---|---|
[If none: "✅ No corrections needed — Claude Opus analysis is accurate."]

## ADDITIONAL ISSUES CLAUDE MISSED
| # | Issue | Severity | Detail |
|---|---|---|---|
[If none: "✅ No additional issues found — analysis is comprehensive."]

## FALSE POSITIVES (things Claude flagged that are actually fine)
| # | Claude Flagged | Why It's Actually OK | DSHEA Reference |
|---|---|---|---|
[If none: "✅ No false positives — all flags are valid."]

## GROK'S FINAL COMPLIANCE VERDICT
**Validation result**: [PASS / PASS WITH MINOR CORRECTIONS / FAIL]
**Adjusted compliance score**: [X/100 or "Agrees with Claude's score of X/100"]
**Summary**: [2-3 sentences — is this formula compliant? What's the most important action item?]
**Top 3 pre-launch actions**:
1. [Most critical]
2. [Second priority]
3. [Third priority]`;
}

// ─── Parse compliance score ────────────────────────────────────────────────────

function parseComplianceScore(opusAnalysis) {
  const m = opusAnalysis?.match(/Score:\s*(\d+(?:\.\d+)?)\/100/i);
  return m ? parseFloat(m[1]) : null;
}

function parseComplianceStatus(opusAnalysis) {
  if (!opusAnalysis) return 'UNKNOWN';
  // Try table format first
  const tableMatch = opusAnalysis.match(/Overall compliance status\s*[|│]\s*(COMPLIANT WITH REVISIONS|COMPLIANT|NON-COMPLIANT)/i);
  if (tableMatch) return tableMatch[1].trim();
  // Fallback: scan full text for status keywords
  if (/NON-COMPLIANT/i.test(opusAnalysis)) return 'NON-COMPLIANT';
  if (/COMPLIANT WITH REVISIONS/i.test(opusAnalysis)) return 'COMPLIANT WITH REVISIONS';
  if (/\bCOMPLIANT\b/i.test(opusAnalysis)) return 'COMPLIANT';
  return 'UNKNOWN';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n${'═'.repeat(62)}`);
  console.log(`P12: FDA COMPLIANCE & LABEL CLAIM VALIDATION — "${KEYWORD}"`);
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
    if (existing?.ingredients?.fda_compliance) {
      console.log(`✅ P12 FDA compliance already exists. Use --force to regenerate.`);
      return;
    }
  }

  // Load formula
  console.log(`Loading formula from formula_briefs...`);
  const { data: briefRow } = await DASH.from('formula_briefs')
    .select('id, ingredients').eq('category_id', CAT_ID).not('ingredients', 'is', null).limit(1).single();
  const adjustedFormula = briefRow?.ingredients?.adjusted_formula
    || briefRow?.ingredients?.final_formula_brief
    || briefRow?.ingredients?.ai_generated_brief;
  if (!adjustedFormula) {
    console.error('ERROR: No formula found. Run P9/P10 first.');
    setTimeout(() => process.exit(1), 100);
    return;
  }
  console.log(`  ✅ Formula loaded (${Math.round(adjustedFormula.length / 1000)}k chars)`);

  // Extract ingredient names
  const ingredientNames = extractIngredientNames(adjustedFormula);
  console.log(`  Ingredients detected: ${ingredientNames.join(', ') || 'None extracted — using full formula text'}`);

  // ── Fetch NIH ODS data ─────────────────────────────────────────────────────
  console.log(`\nFetching NIH ODS safety data for ${ingredientNames.length} ingredients...`);
  const nihData = await fetchNIHData(ingredientNames);
  const nihHits  = Object.values(nihData).filter(d => d.status === 'ok').length;
  const nihMiss  = Object.values(nihData).filter(d => d.status === 'no_nih_page').length;
  const nihFail  = Object.values(nihData).filter(d => d.status !== 'ok' && d.status !== 'no_nih_page').length;
  console.log(`  NIH data: ${nihHits} fetched | ${nihMiss} no page | ${nihFail} failed`);

  // ── Call 1: Claude Opus primary analysis ──────────────────────────────────
  console.log(`\nCall 1: Claude Opus 4.6 primary compliance analysis...`);
  const opusPrompt = buildOpusPrimaryPrompt(adjustedFormula, nihData, KEYWORD);
  console.log(`  Prompt: ${Math.round(opusPrompt.length / 1000)}k chars`);
  const opusAnalysis = await callClaudeOpus(opusPrompt, 10000);

  // ── Call 2: Claude Sonnet validation ──────────────────────────────────────
  console.log(`\nCall 2: Claude Sonnet 4.6 validating Claude Opus findings...`);
  const sonnetPrompt = buildSonnetValidationPrompt(adjustedFormula, nihData, opusAnalysis, KEYWORD);
  console.log(`  Prompt: ${Math.round(sonnetPrompt.length / 1000)}k chars`);
  const sonnetValidation = await callClaudeSonnet(sonnetPrompt, 6000);

  // ── Parse results ──────────────────────────────────────────────────────────
  const complianceScore  = parseComplianceScore(opusAnalysis);
  const complianceStatus = parseComplianceStatus(opusAnalysis);
  const validationMatch  = sonnetValidation?.match(/Overall validation\s*[|│]\s*(PASS WITH MINOR CORRECTIONS|PASS|FAIL)/i);
  let validationResult   = validationMatch?.[1]?.trim();
  if (!validationResult) {
    // Fallback: scan text
    if (/PASS WITH MINOR CORRECTIONS/i.test(sonnetValidation)) validationResult = 'PASS WITH MINOR CORRECTIONS';
    else if (/VALIDATION PASS|FINAL.*?PASS/i.test(sonnetValidation)) validationResult = 'PASS';
    else if (/FAIL/i.test(sonnetValidation)) validationResult = 'FAIL';
    else validationResult = 'UNKNOWN';
  }
  console.log(`\nCompliance score: ${complianceScore}/100`);
  console.log(`Compliance status: ${complianceStatus}`);
  console.log(`Sonnet validation: ${validationResult}`);

  // ── Save to formula_briefs ────────────────────────────────────────────────
  console.log(`\nSaving to Supabase...`);
  const complianceData = {
    opus_analysis: opusAnalysis,
    sonnet_validation: sonnetValidation,
    compliance_score: complianceScore,
    compliance_status: complianceStatus,
    validation_result: validationResult,
    nih_coverage: { fetched: nihHits, no_page: nihMiss, failed: nihFail, total: ingredientNames.length },
    ingredients_reviewed: ingredientNames,
    generated_at: new Date().toISOString(),
    models_used: { primary: 'anthropic/claude-opus-4-6', validation: 'anthropic/claude-sonnet-4-6' },
    data_sources: Object.fromEntries(
      Object.entries(nihData).filter(([,d]) => d.url).map(([name, d]) => [name, d.url])
    ),
  };

  const updatedIngredients = {
    ...(briefRow.ingredients || {}),
    fda_compliance: complianceData,
  };
  const { error: saveErr } = await DASH.from('formula_briefs')
    .update({ ingredients: updatedIngredients })
    .eq('id', briefRow.id);
  if (saveErr) console.error(`  ❌ Save error: ${saveErr.message}`);
  else console.log(`  ✅ Saved to formula_briefs.ingredients.fda_compliance`);

  // ── Save to vault ─────────────────────────────────────────────────────────
  console.log(`\nSaving to vault...`);
  const date = new Date().toISOString().split('T')[0];
  const slug = KEYWORD.replace(/\s+/g, '-').toLowerCase();
  const vaultDir = 'C:\\SirPercival-Vault\\07_ai-systems\\agents\\scout\\fda-compliance';
  const nihSourcesSection = Object.entries(nihData)
    .filter(([, d]) => d.url)
    .map(([name, d]) => `- ${name}: ${d.url} (${d.status})`)
    .join('\n');

  const fullReport = [
    `# P12 FDA Compliance Review — ${KEYWORD}`,
    `Generated: ${new Date().toISOString()}`,
    `Compliance score: ${complianceScore}/100 | Status: ${complianceStatus}`,
    `Sonnet validation: ${validationResult}`,
    `NIH data sources: ${nihHits} fetched live`,
    ``,
    `## NIH DATA SOURCES USED`,
    nihSourcesSection || 'None',
    ``,
    `---`,
    ``,
    `## CLAUDE OPUS 4.6 — PRIMARY COMPLIANCE ANALYSIS`,
    opusAnalysis || 'Not available',
    ``,
    `---`,
    ``,
    `## CLAUDE SONNET 4.6 — VALIDATION REPORT`,
    sonnetValidation || 'Not available',
  ].join('\n');

  try {
    if (!fs.existsSync(vaultDir)) fs.mkdirSync(vaultDir, { recursive: true });
    const vaultPath = path.join(vaultDir, `${date}-${slug}-fda-compliance.md`);
    fs.writeFileSync(vaultPath, fullReport);
    console.log(`  ✅ ${vaultPath}`);
  } catch (e) {
    console.warn(`  ⚠ Vault save failed (non-fatal): ${e.message}`);
    const outDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${date}-${slug}-fda-compliance.md`);
    fs.writeFileSync(outPath, fullReport);
    console.log(`  ✅ Saved to ${outPath}`);
  }

  // ── Preview ────────────────────────────────────────────────────────────────
  const criticalMatch = opusAnalysis?.match(/## CRITICAL COMPLIANCE ISSUES[\s\S]*?\n\|([\s\S]*?)(?:\n## |$)/);
  const hasCritical = criticalMatch && criticalMatch[1].trim().length > 5;

  console.log(`\n${'═'.repeat(62)}`);
  console.log(`P12 COMPLETE`);
  console.log(`Compliance score: ${complianceScore}/100`);
  console.log(`Status: ${complianceStatus}`);
  console.log(`Sonnet validation: ${validationResult}`);
  console.log(`NIH sources used: ${nihHits} live-fetched URLs`);
  if (hasCritical) console.log(`⚠ Critical issues found — review before launch`);
  console.log(`${'═'.repeat(62)}\n`);
}

run()
  .then(() => setTimeout(() => process.exit(0), 500))
  .catch(e => {
    console.error(e.message);
    setTimeout(() => process.exit(1), 500);
  });
