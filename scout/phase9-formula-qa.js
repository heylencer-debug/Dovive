/**
 * phase9-formula-qa.js — Formula QA & Competitive Benchmarking
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
const fs = require('fs');
const path = require('path');

const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEwNDU2NDUsImV4cCI6MjA3NjYyMTY0NX0.VziSAuTdqcteRERIPCdrMy4vqQuHjeC3tvazE0E8nMM'
);

const CAT_ID  = '820537da-3994-4a11-a2e0-a636d751b26f';
const KEYWORD = process.argv.includes('--keyword')
  ? process.argv[process.argv.indexOf('--keyword') + 1]
  : 'ashwagandha gummies';
const FORCE   = process.argv.includes('--force');

// ─── xAI Key ─────────────────────────────────────────────────────────────────

function getXaiKey() {
  const sterlingEnv = path.join(__dirname, '../../sterling/.env');
  if (fs.existsSync(sterlingEnv)) {
    const m = fs.readFileSync(sterlingEnv, 'utf8').match(/XAI_API_KEY\s*=\s*(.+)/);
    if (m) return m[1].trim();
  }
  return process.env.XAI_API_KEY || null;
}

async function callGrok(prompt, maxTokens = 12000) {
  const key = getXaiKey();
  if (!key) throw new Error('No xAI key');
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'grok-3',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`Grok: ${j.error.message}`);
  return j.choices?.[0]?.message?.content || null;
}

// ─── Load P6 market intelligence from vault ────────────────────────────────

function loadMarketIntelFromVault(keyword) {
  const slug = keyword.replace(/\s+/g, '-').toLowerCase();
  const dir = 'C:\\SirPercival-Vault\\07_ai-systems\\agents\\scout\\market-intelligence';
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.includes(slug)).sort().reverse();
  if (!files.length) return null;
  return fs.readFileSync(path.join(dir, files[0]), 'utf8');
}

// ─── Build QA prompt ─────────────────────────────────────────────────────────

function buildQAPrompt(p8Brief, marketIntel, competitors, keyword) {
  const competitorSection = competitors.map((c, i) => {
    const pi = c.marketing_analysis?.product_intelligence || {};
    return `
### COMPETITOR ${i + 1}: ${c.brand || 'Unknown'} [ASIN: ${c.asin}]
- BSR: ${c.bsr_current?.toLocaleString() || 'N/A'} | Price: $${c.price || 'N/A'} | Revenue: $${(c.monthly_revenue || 0).toLocaleString()}/mo
- Rating: ${c.rating_value || 'N/A'}⭐ (${(c.rating_count || 0).toLocaleString()} reviews)
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
1. **Critically review** every ingredient, every dose — question everything
2. **Compare head-to-head** against each of the top 20 competitors
3. **Identify what's too much, what's too little, what's unjustified**
4. **Produce an adjusted formula** with precise reasoning for every change
5. **Write competitor comparison notes** that will show on each competitor's card

This is a CRITICAL QA gate. P8 AI may have over-engineered the formula. Be the expert who catches that.

---

## P8 PROPOSED FORMULA (to be reviewed)

${p8Brief.substring(0, 5000)}
${p8Brief.length > 5000 ? '\n[brief continues — key formula section above]\n' : ''}

---

## P6 MARKET INTELLIGENCE (category context)

${(marketIntel || 'Not available').substring(0, 3000)}

---

## TOP 20 COMPETITORS (formula-by-formula comparison)

${competitorSection}

---

## YOUR DELIVERABLE — produce this exact markdown structure:

# P9 FORMULA QA REPORT — ${keyword.toUpperCase()}

## QA VERDICT
**Overall:** [APPROVED / APPROVED WITH ADJUSTMENTS / NEEDS MAJOR REVISION]
**QA Score:** X/10
**Summary:** 2-3 sentences — did P8 AI over-engineer this? What's the critical finding?

## CRITICAL ISSUES ⛔
(Issues that MUST be fixed before manufacturing)
| # | Issue | Ingredient/Element | Problem | Fix |
|---|---|---|---|---|
| 1 | ... | ... | ... | ... |

## WARNINGS ⚠️
(Important but not blocking)
| # | Warning | Detail | Recommendation |
|---|---|---|---|

## DOSE ANALYSIS TABLE
(Every active ingredient — is the dose right?)
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
(One section per competitor — be specific)

### vs [Brand] — BSR [X] | $[price]
**Our formula vs theirs:**
- Ashwagandha: our [Xmg KSM-66] vs their [Ymg Unknown] → [ADVANTAGE OURS / THEIRS / TIE]
- Bonus ingredients: we have [A,B,C] they have [D,E] → [analysis]
- Price positioning: [analysis]
- Sugar content: [comparison]
- Third-party testing: [comparison]
**Can we beat them?** [Yes/No/Maybe + one-line reason]
**Comparison note (for card display):** [One concise sentence for the competitor card]
**ASIN:** [asin]

[repeat for each competitor]

## FORMULA ADJUSTMENTS
(What P8 got wrong and what we're fixing)
| Ingredient | P8 Original | P9 Adjusted | Reason |
|---|---|---|---|

## ADJUSTED FORMULA SPECIFICATION
(Complete revised formula — production ready)

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
- Estimated COGS per serving: $X.XX–$X.XX
- Target MSRP: $XX.XX
- Estimated margin: XX%

## QA SIGN-OFF NOTES
(What to tell the contract manufacturer)
[paragraph — key QA requirements, testing protocols, stability concerns]

## COMPETITOR_NOTES_JSON
(Do NOT skip this section — used to populate competitor cards in dashboard)
Return a valid JSON object mapping each ASIN to a one-line comparison note:
{"ASIN1": "note", "ASIN2": "note", ...}

---

Be brutally honest. If P8 over-engineered the formula with 16 ingredients when the market only supports 4-6, say so. If our KSM-66 dose is unrealistically high for a gummy, flag it. This is the final QA gate before we send specs to a manufacturer.`;
}

// ─── Parse competitor notes from QA output ────────────────────────────────────

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

// ─── Parse QA verdict ─────────────────────────────────────────────────────────

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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n${'═'.repeat(62)}`);
  console.log(`P9: FORMULA QA & COMPETITIVE BENCHMARKING — "${KEYWORD}"`);
  console.log(`${'═'.repeat(62)}\n`);

  // Check if already done
  if (!FORCE) {
    const { data: existing } = await DASH.from('formula_briefs')
      .select('ingredients').eq('category_id', CAT_ID).limit(1).single();
    if (existing?.ingredients?.qa_report) {
      console.log(`✅ P9 QA report already exists. Use --force to regenerate.`);
      process.exit(0);
    }
  }

  // ── Load P8 formula brief ────────────────────────────────────────────────
  console.log(`Loading P8 formula brief...`);
  const { data: briefRow } = await DASH.from('formula_briefs')
    .select('id, ingredients').eq('category_id', CAT_ID)
    .not('ingredients', 'is', null).limit(1).single();
  const p8Brief = briefRow?.ingredients?.ai_generated_brief;
  if (!p8Brief) {
    console.error('❌ No P8 formula brief found. Run phase8-formula-brief.js first.');
    process.exit(1);
  }
  console.log(`  ✅ P8 brief loaded (${Math.round(p8Brief.length / 1000)}k chars)`);

  // ── Load P6 market intelligence ──────────────────────────────────────────
  console.log(`Loading P6 market intelligence...`);
  const marketIntel = loadMarketIntelFromVault(KEYWORD);
  console.log(`  ${marketIntel ? `✅ Loaded from vault (${Math.round(marketIntel.length / 1000)}k chars)` : '⚠️  Not found in vault — P9 will run without market context'}`);

  // ── Load top 20 competitors ──────────────────────────────────────────────
  console.log(`Loading top 20 competitors with formulas...`);
  const { data: competitors } = await DASH.from('products')
    .select(`asin, brand, title, bsr_current, price, monthly_revenue, monthly_sales,
             rating_value, rating_count, supplement_facts_raw, marketing_analysis`)
    .eq('category_id', CAT_ID)
    .not('bsr_current', 'is', null)
    .order('bsr_current', { ascending: true })
    .limit(20);
  console.log(`  ✅ ${competitors?.length || 0} competitors loaded\n`);

  // ── Build prompt ─────────────────────────────────────────────────────────
  console.log(`Building QA prompt...`);
  const prompt = buildQAPrompt(p8Brief, marketIntel, competitors || [], KEYWORD);
  console.log(`  Prompt size: ${Math.round(prompt.length / 1000)}k chars\n`);

  // ── Call Grok ────────────────────────────────────────────────────────────
  console.log(`Calling Grok (grok-3)...`);
  const startTime = Date.now();
  const qaReport = await callGrok(prompt, 12000);
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`  ✅ Done (${elapsed}s, ${Math.round(qaReport.length / 1000)}k chars)\n`);

  // ── Parse output ─────────────────────────────────────────────────────────
  const verdict = parseQAVerdict(qaReport);
  const competitorNotes = parseCompetitorNotes(qaReport);
  const noteCount = Object.keys(competitorNotes).length;
  console.log(`QA Verdict: ${verdict.verdict} | Score: ${verdict.score}/10`);
  console.log(`Competitor notes parsed: ${noteCount}\n`);

  // ── Extract adjusted formula section ─────────────────────────────────────
  const adjustedFormulaMatch = qaReport.match(/## ADJUSTED FORMULA SPECIFICATION([\s\S]*?)(?:\n## |$)/);
  const adjustedFormula = adjustedFormulaMatch?.[1]?.trim() || null;

  const adjustmentsMatch = qaReport.match(/## FORMULA ADJUSTMENTS\s*\n[\s\S]*?\n(\|[\s\S]*?)(?:\n## )/);
  const adjustmentsTable = adjustmentsMatch?.[1]?.trim() || null;

  // ── Save QA report to formula_briefs ────────────────────────────────────
  console.log(`Saving QA report to Supabase...`);
  const updatedIngredients = {
    ...(briefRow.ingredients || {}),
    qa_report: qaReport,
    qa_verdict: verdict,
    adjusted_formula: adjustedFormula,
    adjustments_table: adjustmentsTable,
    qa_generated_at: new Date().toISOString(),
  };
  const { error: saveErr } = await DASH.from('formula_briefs')
    .update({ ingredients: updatedIngredients })
    .eq('id', briefRow.id);
  if (saveErr) console.error(`  ❌ Save error: ${saveErr.message}`);
  else console.log(`  ✅ Saved to formula_briefs.ingredients.qa_report`);

  // ── Save competitor notes to products ────────────────────────────────────
  if (noteCount > 0) {
    console.log(`\nSaving comparison notes to ${noteCount} products...`);
    let notesSaved = 0;
    for (const [asin, note] of Object.entries(competitorNotes)) {
      const { data: prod } = await DASH.from('products')
        .select('marketing_analysis').eq('asin', asin).single();
      if (!prod) continue;
      const existing = prod.marketing_analysis || {};
      const { error: ne } = await DASH.from('products').update({
        marketing_analysis: { ...existing, qa_comparison_note: note }
      }).eq('asin', asin);
      if (!ne) notesSaved++;
    }
    console.log(`  ✅ Notes saved: ${notesSaved}/${noteCount}`);
  }

  // ── Save to vault ─────────────────────────────────────────────────────────
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
    ``,
    qaReport,
  ].join('\n'));
  console.log(`  ✅ ${vaultPath}`);

  // ── Preview ───────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(62)}`);
  console.log(`P9 COMPLETE`);
  console.log(`Verdict: ${verdict.verdict} | Score: ${verdict.score}/10`);
  console.log(`Summary: ${verdict.summary}`);
  console.log(`Report: ${Math.round(qaReport.length / 1000)}k chars | Competitor notes: ${noteCount}`);
  if (adjustedFormula) console.log(`Adjusted formula: extracted ✅`);
}

run().catch(e => { console.error('\n❌ FAILED:', e.message); process.exit(1); });
