/**
 * phase-living-brief.js — Living Formula Brief (Manufacturer Feedback Loop)
 *
 * Reads pending manufacturer feedback for a keyword, evaluates each feedback
 * item against the current active formula brief using Claude, then:
 *   - ACCEPTED: applies changes and creates a new formula_brief_versions entry
 *   - PARTIALLY ACCEPTED: applies valid changes, pushes back on the rest
 *   - QUESTIONED: keeps original formula, returns counter-argument with evidence
 *   - REJECTED: keeps original, explains why the change compromises quality
 *
 * Usage:
 *   node phase-living-brief.js --keyword "biotin gummies"
 *   node phase-living-brief.js --keyword "biotin gummies" --feedback-id <uuid>  (process one specific feedback)
 *   node phase-living-brief.js --keyword "biotin gummies" --dry-run             (preview without saving)
 */

'use strict';
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const fs = require('fs');

// ─── Supabase ─────────────────────────────────────────────────────────────────
const DASH = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const KEYWORD = args[args.indexOf('--keyword') + 1];
const FEEDBACK_ID = args.includes('--feedback-id') ? args[args.indexOf('--feedback-id') + 1] : null;
const DRY_RUN = args.includes('--dry-run');

if (!KEYWORD) {
  console.error('Usage: node phase-living-brief.js --keyword "biotin gummies"');
  process.exit(1);
}

// ─── OpenRouter (Claude) ──────────────────────────────────────────────────────
function getOpenRouterKey() {
  return process.env.OPENROUTER_API_KEY || null;
}

async function callClaude(prompt, maxTokens = 8000) {
  const key = getOpenRouterKey();
  if (!key) throw new Error('OPENROUTER_API_KEY not set');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://dovive.com',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4-6',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`Claude error: ${j.error.message}`);
  return j.choices?.[0]?.message?.content || '';
}

// ─── Claude Vision (for image feedback) ──────────────────────────────────────
async function callClaudeWithImages(textPrompt, imageUrls, maxTokens = 8000) {
  const key = getOpenRouterKey();
  if (!key) throw new Error('OPENROUTER_API_KEY not set');

  const content = [
    { type: 'text', text: textPrompt },
    ...imageUrls.map(url => ({
      type: 'image_url',
      image_url: { url }
    }))
  ];

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://dovive.com',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4-6',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content }],
    }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`Claude Vision error: ${j.error.message}`);
  return j.choices?.[0]?.message?.content || '';
}

// ─── Build evaluation prompt ──────────────────────────────────────────────────
function buildEvaluationPrompt(keyword, currentFormula, feedbackText) {
  return `You are a senior supplement formulator and scientific advisor for DOVIVE brand.

A manufacturer has submitted feedback on our current formula brief for **${keyword}**.
Your job is to evaluate each point of feedback objectively and decide:
- **ACCEPTED**: The change improves the formula (better clinical outcome, manufacturability, cost, or safety)
- **PARTIALLY ACCEPTED**: Some points are valid, others are not — apply the valid ones, push back on the rest
- **QUESTIONED**: The change needs justification — ask a specific, evidence-based question back to the manufacturer
- **REJECTED**: The change compromises clinical quality, safety, or lean formula principles — explain why with evidence

## CURRENT ACTIVE FORMULA BRIEF
${currentFormula}

---

## MANUFACTURER FEEDBACK
${feedbackText}

---

## YOUR EVALUATION RULES

1. **Clinical quality is non-negotiable** — do not accept changes that reduce doses below clinical minimums or swap bioavailable forms for inferior ones unless there is a hard manufacturing constraint
2. **Lean formula principle** — do not accept adding ingredients without clinical justification
3. **Manufacturing constraints are valid reasons to change** — if the manufacturer flags a real constraint (active load, heat stability, pH issue, sourcing problem), accept it and find the best clinical alternative
4. **Cost reduction is valid IF it doesn't compromise efficacy** — switching to a less expensive but equally bioavailable form is acceptable; switching to an inferior form to cut cost is not
5. **Be specific** — when questioning or rejecting, cite the clinical reason, the study, or the manufacturing principle. Do not give vague pushback.

---

## YOUR DELIVERABLE

Respond in this exact structure:

## OVERALL VERDICT
[ACCEPTED / PARTIALLY ACCEPTED / QUESTIONED / REJECTED]

## FEEDBACK EVALUATION
For each distinct feedback point from the manufacturer:
| # | Feedback Point | Verdict | Reasoning |
|---|---------------|---------|-----------|
[One row per feedback point with ACCEPTED/QUESTIONED/REJECTED verdict and specific reasoning]

## UPDATED FORMULA
[If any changes were ACCEPTED or PARTIALLY ACCEPTED: write the complete updated formula brief with all accepted changes applied. Mark each change with [UPDATED] inline. If nothing was accepted, write "No changes applied — see counter-arguments below."]

## COUNTER-ARGUMENTS / QUESTIONS FOR MANUFACTURER
[For each QUESTIONED or REJECTED point: write a specific, respectful, evidence-based response. If questioning, ask a precise question. If rejecting, cite the clinical or manufacturing reason.]

## CHANGE SUMMARY
[One sentence describing what changed in this version, suitable for the version history label. Example: "Applied CMO's zinc form change to bisglycinate; rejected biotin dose reduction (below clinical floor)."]`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔄 Living Formula Brief — ${KEYWORD}`);
  if (DRY_RUN) console.log('  ⚠️  DRY RUN — no changes will be saved\n');

  // 1. Resolve category
  const { data: cat } = await DASH.from('categories')
    .select('id, name').ilike('name', `%${KEYWORD}%`).limit(1).single();
  if (!cat) { console.error(`Category not found for: ${KEYWORD}`); process.exit(1); }
  const CAT_ID = cat.id;
  console.log(`  Category: ${cat.name} (${CAT_ID})`);

  // 2. Load current active formula brief
  const { data: activeVersion } = await DASH.from('formula_brief_versions')
    .select('*').eq('category_id', CAT_ID).eq('is_active', true).maybeSingle();

  let currentFormula = null;
  let parentVersionId = null;

  if (activeVersion) {
    currentFormula = activeVersion.formula_brief_content;
    parentVersionId = activeVersion.id;
    console.log(`  Active version: v${activeVersion.version_number} (${activeVersion.change_summary || 'original'})`);
  } else {
    // Fall back to formula_briefs table
    const { data: briefRow } = await DASH.from('formula_briefs')
      .select('ingredients').eq('category_id', CAT_ID).limit(1).single();
    currentFormula = briefRow?.ingredients?.final_formula_brief
      || briefRow?.ingredients?.adjusted_formula
      || null;
    console.log(`  No versioned formula yet — using original formula_briefs entry`);
  }

  if (!currentFormula) {
    console.error('  ❌ No formula brief found. Run P8 + P9 first.');
    process.exit(1);
  }

  // 3. Load pending manufacturer feedback
  let feedbackQuery = DASH.from('manufacturer_feedback')
    .select('*')
    .eq('category_id', CAT_ID)
    .eq('status', 'pending')
    .order('submitted_at', { ascending: true });

  if (FEEDBACK_ID) feedbackQuery = feedbackQuery.eq('id', FEEDBACK_ID);

  const { data: feedbackRows } = await feedbackQuery;
  if (!feedbackRows || feedbackRows.length === 0) {
    console.log('  ✅ No pending manufacturer feedback found.');
    return;
  }

  console.log(`  Found ${feedbackRows.length} pending feedback item(s)\n`);

  // 4. Process each feedback item
  for (const fb of feedbackRows) {
    console.log(`\n  📋 Processing feedback ${fb.id} (submitted ${new Date(fb.submitted_at).toLocaleDateString()})`);
    if (fb.feedback_text) console.log(`     Text: ${fb.feedback_text.substring(0, 100)}...`);
    if (fb.image_urls?.length) console.log(`     Images: ${fb.image_urls.length} attached`);

    // Mark as processing
    if (!DRY_RUN) {
      await DASH.from('manufacturer_feedback')
        .update({ status: 'processing' }).eq('id', fb.id);
    }

    // Build feedback text (extract from images if needed)
    let fullFeedbackText = fb.feedback_text || '';
    if (fb.image_urls?.length > 0) {
      console.log(`     📷 Extracting text from ${fb.image_urls.length} image(s) via Claude Vision...`);
      const imageExtractionPrompt = `Extract all text and content from these manufacturer feedback images for a supplement formula.
Transcribe everything visible: ingredient names, doses, notes, comments, markups, diagrams, tables.
Format clearly with each distinct point on a new line.`;
      try {
        const extractedText = await callClaudeWithImages(imageExtractionPrompt, fb.image_urls, 4000);
        fullFeedbackText = [fullFeedbackText, '\n\n[FROM IMAGES]\n' + extractedText].filter(Boolean).join('\n');
        console.log(`     ✅ Image text extracted (${Math.round(extractedText.length / 100) / 10}k chars)`);
      } catch (e) {
        console.error(`     ⚠️  Image extraction failed: ${e.message}`);
      }
    }

    if (!fullFeedbackText.trim()) {
      console.log('     ⚠️  No feedback content found — skipping');
      continue;
    }

    // 5. Evaluate feedback with Claude
    console.log(`     🤖 Evaluating feedback with Claude...`);
    const prompt = buildEvaluationPrompt(KEYWORD, currentFormula, fullFeedbackText);
    const evaluation = await callClaude(prompt, 10000);

    // Parse verdict
    const verdictMatch = evaluation.match(/##\s*OVERALL VERDICT\s*\n+\[?(ACCEPTED|PARTIALLY ACCEPTED|QUESTIONED|REJECTED)\]?/i);
    const verdict = verdictMatch ? verdictMatch[1].toLowerCase().replace(' ', '_') : 'questioned';

    // Parse updated formula
    const updatedFormulaMatch = evaluation.match(/##\s*UPDATED FORMULA\s*\n+([\s\S]*?)(?=\n##\s*COUNTER-ARGUMENTS|$)/i);
    const updatedFormula = updatedFormulaMatch?.[1]?.trim() || null;
    const hasChanges = updatedFormula && !updatedFormula.startsWith('No changes applied');

    // Parse change summary
    const changeSummaryMatch = evaluation.match(/##\s*CHANGE SUMMARY\s*\n+([\s\S]*?)(?=\n##|$)/i);
    const changeSummary = changeSummaryMatch?.[1]?.trim() || `Manufacturer feedback review — ${verdict}`;

    console.log(`     Verdict: ${verdict.toUpperCase()}`);
    console.log(`     Changes: ${hasChanges ? 'Yes — new version will be created' : 'No changes to formula'}`);

    if (DRY_RUN) {
      console.log('\n     [DRY RUN] Evaluation output:');
      console.log(evaluation.substring(0, 500) + '...\n');
      continue;
    }

    // 6. Create new formula version if changes were accepted
    let newVersionId = null;
    if (hasChanges && (verdict === 'accepted' || verdict === 'partially_accepted')) {
      // Deactivate current version
      await DASH.from('formula_brief_versions')
        .update({ is_active: false }).eq('category_id', CAT_ID);

      // Get next version number
      const { data: versions } = await DASH.from('formula_brief_versions')
        .select('version_number').eq('category_id', CAT_ID)
        .order('version_number', { ascending: false }).limit(1);
      const nextVersion = versions?.[0]?.version_number ? versions[0].version_number + 1 : 1;

      const { data: newVersion, error: vErr } = await DASH.from('formula_brief_versions')
        .insert({
          category_id: CAT_ID,
          version_number: nextVersion,
          formula_brief_content: updatedFormula,
          change_summary: `[MFR FEEDBACK] ${changeSummary}`,
          parent_version_id: parentVersionId,
          is_active: true,
        })
        .select().single();

      if (vErr) {
        console.error(`     ❌ Failed to create version: ${vErr.message}`);
      } else {
        newVersionId = newVersion.id;
        currentFormula = updatedFormula; // chain: next feedback evaluates updated formula
        parentVersionId = newVersionId;
        console.log(`     ✅ Created formula v${nextVersion}`);
      }
    }

    // 7. Save evaluation back to feedback row
    await DASH.from('manufacturer_feedback').update({
      status: 'reviewed',
      reviewed_at: new Date().toISOString(),
      claude_verdict: verdict,
      claude_response: evaluation,
      resulting_version_id: newVersionId,
    }).eq('id', fb.id);

    console.log(`     ✅ Feedback marked as reviewed`);
  }

  console.log('\n✅ Living brief update complete.\n');
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
