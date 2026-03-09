/**
 * phase4-reprocess.js
 * Re-extracts supplement_facts for dovive_ocr rows that have raw_text but null supplement_facts
 * BMAD Tech-Spec: ocr-dashboard-fix | Track B
 *
 * Usage: node phase4-reprocess.js "<keyword>" [--test] [--limit <n>]
 *
 * What it does:
 * 1. Queries dovive_ocr for rows where keyword=<arg>, raw_text IS NOT NULL, supplement_facts IS NULL
 * 2. Re-sends each image to GPT-4o for structured extraction
 * 3. Upserts supplement_facts (and other fields) back to dovive_ocr
 * 4. Skips rows where image_url is missing
 */

require('dotenv').config();
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const KEYWORD   = process.argv[2] || 'ashwagandha gummies';
const TEST_MODE = process.argv.includes('--test');
const LIMIT_IDX = process.argv.indexOf('--limit');
const LIMIT     = LIMIT_IDX > -1 ? parseInt(process.argv[LIMIT_IDX + 1]) : null;

const supabase  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

let OPENAI_KEY  = process.env.OPENAI_API_KEY;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Fetch OpenAI key from Supabase if not in env (same as ocr-phase4.js) ──
async function getOpenAIKey() {
  if (OPENAI_KEY) return OPENAI_KEY;
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'openai_api_key')
    .single();
  if (data?.value) { OPENAI_KEY = data.value; return OPENAI_KEY; }
  throw new Error('No OpenAI API key found in env or Supabase app_settings');
}

// ── GPT-4o re-extraction call ───────────────────────────────
async function reextractWithGPT(imageUrl, asin, rawText, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await _callGPT(imageUrl, asin, rawText);
    } catch (err) {
      const isRateLimit = err.message.includes('429') || err.message.toLowerCase().includes('rate limit');
      if (isRateLimit && attempt < retries) {
        const wait = attempt * 20000;
        console.log(`  ⏳ Rate limited. Waiting ${wait / 1000}s (attempt ${attempt + 1}/${retries})...`);
        await sleep(wait);
      } else {
        throw err;
      }
    }
  }
}

async function _callGPT(imageUrl, asin, rawText) {
  const prompt = `You are re-analyzing an Amazon supplement product image.
ASIN: ${asin}

The image was previously OCR-processed and produced this raw text:
"""
${rawText}
"""

Now extract structured supplement facts from this image. Return a JSON object:
{
  "has_supplement_facts": boolean,
  "serving_size": "string or null",
  "servings_per_container": "string or null",
  "supplement_facts": [
    { "name": "ingredient name", "amount": "amount per serving", "dv_percent": "% DV or null" }
  ],
  "other_ingredients": "full list as string or null",
  "health_claims": ["array of health claims/benefits"],
  "certifications": ["Non-GMO", "Organic", "GMP", "NSF", "Vegan", etc]
}

If no supplement facts panel exists in the image, return empty arrays for supplement_facts.
Return ONLY valid JSON, no markdown.`;

  const body = {
    model: 'gpt-4o',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
      ]
    }]
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Could not parse GPT response: ' + content.slice(0, 100));
  }
}

// ── Main ───────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔄 Phase 4 Re-process — Supplement Facts Re-extraction`);
  console.log(`   Keyword : "${KEYWORD}"`);
  console.log(`   Mode    : ${TEST_MODE ? 'TEST (1 row)' : LIMIT ? `LIMIT ${LIMIT}` : 'FULL'}`);

  await getOpenAIKey();

  // Fetch rows: raw_text NOT NULL and supplement_facts IS NULL
  let query = supabase
    .from('dovive_ocr')
    .select('id, asin, keyword, image_url, image_index, raw_text')
    .eq('keyword', KEYWORD)
    .not('raw_text', 'is', null)
    .is('supplement_facts', null)
    .not('image_url', 'is', null)
    .order('asin', { ascending: true });

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);

  const toProcess = TEST_MODE ? rows.slice(0, 1) : LIMIT ? rows.slice(0, LIMIT) : rows;
  console.log(`\nRows needing re-extraction : ${rows.length}`);
  console.log(`Processing                 : ${toProcess.length}\n`);

  if (!toProcess.length) {
    console.log('✅ Nothing to reprocess — all rows already have supplement_facts or no raw_text.');
    return;
  }

  let updated = 0, skipped = 0, failed = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const row = toProcess[i];
    const progress = `[${i + 1}/${toProcess.length}]`;

    try {
      console.log(`${progress} ASIN: ${row.asin} | Image ${row.image_index}`);

      const extracted = await reextractWithGPT(row.image_url, row.asin, row.raw_text);

      // Only update if GPT found something meaningful
      const hasFacts = extracted.supplement_facts && extracted.supplement_facts.length > 0;
      const hasClaims = extracted.health_claims && extracted.health_claims.length > 0;
      const hasCerts = extracted.certifications && extracted.certifications.length > 0;

      if (!hasFacts && !hasClaims && !hasCerts) {
        console.log(`  ⚪ No structured data found — leaving as-is`);
        skipped++;
      } else {
        const update = {};
        if (hasFacts) update.supplement_facts = extracted.supplement_facts;
        if (extracted.serving_size) update.serving_size = extracted.serving_size;
        if (extracted.servings_per_container) update.servings_per_container = extracted.servings_per_container;
        if (extracted.other_ingredients) update.other_ingredients = extracted.other_ingredients;
        if (hasClaims) update.health_claims = extracted.health_claims;
        if (hasCerts) update.certifications = extracted.certifications;

        const { error: upsertErr } = await supabase
          .from('dovive_ocr')
          .update(update)
          .eq('id', row.id);

        if (upsertErr) throw new Error(upsertErr.message);

        console.log(`  ✅ Updated — facts: ${hasFacts ? extracted.supplement_facts.length + ' items' : 'none'} | claims: ${extracted.health_claims?.length || 0} | certs: ${extracted.certifications?.length || 0}`);
        updated++;
      }

      // Rate limit: 1 req/sec
      if (i < toProcess.length - 1) await sleep(1000);

    } catch (err) {
      console.error(`  ❌ Failed: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n─────────────────────────────────────────`);
  console.log(`Updated : ${updated}`);
  console.log(`Skipped : ${skipped} (no structured data in image)`);
  console.log(`Failed  : ${failed}`);
  console.log(`Total   : ${toProcess.length}`);
  console.log(`─────────────────────────────────────────\n`);
}

main().catch(console.error);
