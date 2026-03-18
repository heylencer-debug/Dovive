/**
 * phase4-text-extract.js
 * Extracts supplement facts from bullet_points text in dovive_research
 * Much faster + cheaper than image OCR — covers 158/159 ashwagandha gummies products
 *
 * Usage: node phase4-text-extract.js "<keyword>" [--test] [--limit <n>]
 *
 * Flow:
 * 1. Pull products from dovive_research with bullet_points for given keyword
 * 2. For each product, send bullet_points to GPT-4o (text only — no vision)
 * 3. Extract: ingredients, dosages, serving size, certifications, health claims
 * 4. Upsert into dovive_ocr with image_index = 99 (text-extraction marker)
 */

require('dotenv').config();
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const { parseModelJson, normalizeFacts, isValidFacts } = require('./utils/ocr-utils');

// Support both: node phase4-text-extract.js "keyword" AND node phase4-text-extract.js --keyword "keyword"
const _kwIdx = process.argv.indexOf('--keyword');
const KEYWORD   = _kwIdx > -1 ? process.argv[_kwIdx + 1] : (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'ashwagandha gummies');
const TEST_MODE = process.argv.includes('--test');
const LIMIT_IDX = process.argv.indexOf('--limit');
const LIMIT     = LIMIT_IDX > -1 ? parseInt(process.argv[LIMIT_IDX + 1]) : null;

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Validate OpenRouter key ─────────────────────────────────
async function getOpenAIKey() {
  if (!OPENROUTER_KEY) throw new Error('No OPENROUTER_API_KEY found in environment');
  return OPENROUTER_KEY;
}

// ── GPT text extraction ─────────────────────────────────────
async function extractFromText(asin, title, bulletPoints, retries = 3) {
  const bullets = Array.isArray(bulletPoints)
    ? bulletPoints.join('\n')
    : String(bulletPoints);

  const prompt = `You are analyzing an Amazon supplement product listing.

Product: ${title}
ASIN: ${asin}

Product bullet points / description:
"""
${bullets}
"""

Extract structured supplement information from this text. Return a JSON object:
{
  "has_supplement_facts": boolean,
  "serving_size": "string or null",
  "servings_per_container": "string or null",
  "supplement_facts": [
    { "name": "ingredient name", "amount": "amount per serving", "dv_percent": "% DV or null" }
  ],
  "other_ingredients": "full list as string or null",
  "health_claims": ["array of health claims and benefits mentioned"],
  "certifications": ["Non-GMO", "Organic", "GMP", "NSF", "Vegan", "Gluten-Free", etc],
  "key_ingredients_summary": "1-2 sentence summary of main active ingredients and their doses"
}

Extract every ingredient and dose mentioned. If no specific doses are mentioned, still list the ingredients.
Return ONLY valid JSON, no markdown.`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENROUTER_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://dovive.com',
          'X-Title': 'Dovive Scout P4'
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`OpenRouter error ${res.status}: ${err.slice(0, 200)}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '';
      const parsed = parseModelJson(content);
      if (!parsed.parsed) throw new Error(`Could not parse GPT response (${parsed.method})`);
      return parsed.parsed;
    } catch (err) {
      const isRateLimit = err.message.includes('429') || err.message.toLowerCase().includes('rate limit');
      if (isRateLimit && attempt < retries) {
        const wait = attempt * 15000;
        console.log(`  ⏳ Rate limited. Waiting ${wait / 1000}s (attempt ${attempt + 1})...`);
        await sleep(wait);
      } else if (attempt === retries) {
        throw err;
      }
    }
  }
}

// ── Main ───────────────────────────────────────────────────
async function main() {
  console.log(`\n📄 Phase 4 Text Extract — Formula from Bullet Points`);
  console.log(`   Keyword : "${KEYWORD}"`);
  console.log(`   Mode    : ${TEST_MODE ? 'TEST (1 product)' : LIMIT ? `LIMIT ${LIMIT}` : 'FULL'}`);

  await getOpenAIKey();

  // Get products with bullet_points
  const { data: products, error } = await sb
    .from('dovive_research')
    .select('asin, title, keyword, bullet_points')
    .eq('keyword', KEYWORD)
    .not('bullet_points', 'is', null)
    .order('bsr', { ascending: true });

  if (error) throw new Error(error.message);

  // Check which ASINs already have text extraction (image_index = 99)
  const { data: existing } = await sb
    .from('dovive_ocr')
    .select('asin')
    .eq('keyword', KEYWORD)
    .eq('image_index', 99);

  const alreadyDone = new Set((existing || []).map(r => r.asin));
  const toProcess = products.filter(p => !alreadyDone.has(p.asin));

  const list = TEST_MODE ? toProcess.slice(0, 1) : LIMIT ? toProcess.slice(0, LIMIT) : toProcess;

  console.log(`\nProducts with bullet_points : ${products.length}`);
  console.log(`Already extracted           : ${alreadyDone.size}`);
  console.log(`To process                  : ${list.length}\n`);

  if (!list.length) {
    console.log('✅ All products already have text extraction! (image_index=99)');
    return;
  }

  let saved = 0, skipped = 0, failed = 0;

  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const progress = `[${i + 1}/${list.length}]`;

    try {
      console.log(`${progress} ${p.asin} | ${(p.title || '').substring(0, 55)}`);

      const extracted = await extractFromText(p.asin, p.title, p.bullet_points);

      const facts = normalizeFacts(extracted.supplement_facts);
      const hasFacts = isValidFacts(facts);
      const hasClaims = extracted.health_claims && extracted.health_claims.length > 0;

      if (!hasFacts && !hasClaims) {
        console.log(`  ⚪ No structured data found`);
        skipped++;
      } else {
        const record = {
          asin: p.asin,
          keyword: KEYWORD,
          image_url: null,
          image_index: 99, // marker: text extraction, not image OCR
          serving_size: extracted.serving_size || null,
          servings_per_container: extracted.servings_per_container || null,
          supplement_facts: hasFacts ? facts : null,
          other_ingredients: extracted.other_ingredients || null,
          health_claims: hasClaims ? extracted.health_claims : null,
          certifications: extracted.certifications?.length ? extracted.certifications : null,
          raw_text: Array.isArray(p.bullet_points) ? p.bullet_points.join('\n') : p.bullet_points,
          gpt_model: 'openrouter/gpt-4o-text',
          processed_at: new Date().toISOString()
        };

        const { error: upsertErr } = await sb
          .from('dovive_ocr')
          .upsert(record, { onConflict: 'asin,image_index' });

        if (upsertErr) throw new Error(upsertErr.message);

        console.log(`  ✅ Saved — facts: ${hasFacts ? extracted.supplement_facts.length + ' items' : 'none'} | claims: ${extracted.health_claims?.length || 0} | certs: ${extracted.certifications?.length || 0}`);
        if (extracted.key_ingredients_summary) {
          console.log(`  📋 ${extracted.key_ingredients_summary.substring(0, 100)}`);
        }
        saved++;
      }

      if (i < list.length - 1) await sleep(500); // 500ms between requests (text is fast)

    } catch (err) {
      console.error(`  ❌ Failed: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n─────────────────────────────────────────`);
  console.log(`Saved   : ${saved}`);
  console.log(`Skipped : ${skipped}`);
  console.log(`Failed  : ${failed}`);
  console.log(`Total   : ${list.length}`);
  console.log(`Table   : dovive_ocr (image_index=99 = text extraction)`);
  console.log(`─────────────────────────────────────────\n`);
}

main().catch(console.error);
