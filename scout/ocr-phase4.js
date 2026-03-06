/**
 * ocr-phase4.js — Phase 4: GPT-4o Vision OCR on product images
 *
 * Pulls product images from dovive_research → sends to GPT-4o Vision
 * → extracts structured supplement facts → saves to dovive_ocr table
 *
 * Usage: node ocr-phase4.js "<keyword>" [--test]
 */

require('dotenv').config();
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const KEYWORD    = process.argv[2] || 'ashwagandha gummies';
const TEST_MODE  = process.argv.includes('--test');
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const supabase   = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── GPT-4o Vision call with retry ────────────────────────────
async function analyzeImageWithGPT(imageUrl, asin, title, retries = 4) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await _analyzeImageWithGPT(imageUrl, asin, title);
    } catch (err) {
      const isRateLimit = err.message.includes('429') || err.message.includes('rate limit') || err.message.includes('Rate limit');
      const isServer    = err.message.includes('500') || err.message.includes('503');
      if ((isRateLimit || isServer) && attempt < retries) {
        const wait = isRateLimit ? attempt * 20000 : attempt * 5000; // 20s, 40s, 60s for rate limits
        console.log(`\n  ⏳ Rate limited. Waiting ${wait/1000}s before retry ${attempt+1}/${retries}...`);
        await sleep(wait);
      } else {
        throw err;
      }
    }
  }
}

async function _analyzeImageWithGPT(imageUrl, asin, title) {
  const prompt = `You are analyzing an Amazon product image for a supplement product.
ASIN: ${asin}
Product: ${title}

Extract ALL text visible in this image and return a JSON object with these fields:
{
  "has_supplement_facts": boolean,
  "serving_size": "string or null",
  "servings_per_container": "string or null",
  "supplement_facts": [
    { "name": "nutrient/ingredient name", "amount": "amount per serving", "dv_percent": "% DV or null" }
  ],
  "other_ingredients": "full list as string or null",
  "health_claims": ["array of health claims/benefits shown"],
  "certifications": ["Non-GMO", "Organic", "GMP", "NSF", "Vegan", etc],
  "raw_text": "all visible text concatenated"
}

If no supplement facts panel is visible, still extract any product claims, ingredients, or certifications visible.
Return ONLY valid JSON, no markdown.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
        ]
      }]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  const usage = data.usage;

  try {
    return { result: JSON.parse(content), usage };
  } catch {
    // Try to extract JSON from markdown
    const match = content.match(/\{[\s\S]*\}/);
    if (match) return { result: JSON.parse(match[0]), usage };
    throw new Error('Could not parse GPT response: ' + content.slice(0, 100));
  }
}

// ── Save to Supabase ──────────────────────────────────────────
async function saveOCR(record) {
  const { error } = await supabase
    .from('dovive_ocr')
    .upsert(record, { onConflict: 'asin,image_index' });
  if (error) throw new Error('Save error: ' + error.message);
}

// ── Get already processed ASINs ───────────────────────────────
async function getProcessed(keyword) {
  let allData = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('dovive_ocr')
      .select('asin, image_index')
      .eq('keyword', keyword)
      .range(from, from + pageSize - 1);
    if (error || !data?.length) break;
    allData = allData.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  // An ASIN is "fully processed" if image_index 0 exists (we attempted it)
  return new Set(allData.filter(r => r.image_index === 0).map(r => r.asin));
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔍 Phase 4 — OCR with GPT-4o Vision`);
  console.log(`   Keyword: "${KEYWORD}"`);
  console.log(`   Mode: ${TEST_MODE ? 'TEST (1 product)' : 'FULL'}`);

  // Get products
  const { data: products, error } = await supabase
    .from('dovive_research')
    .select('asin, title, keyword, images, main_image')
    .ilike('title', `%${KEYWORD.split(' ')[0]}%`)
    .not('images', 'is', null);

  if (error) throw new Error(error.message);
  console.log(`\nFound ${products.length} products with images`);

  const processed = await getProcessed(KEYWORD);
  const toProcess = products.filter(p => !processed.has(p.asin));
  console.log(`Already processed: ${processed.size} | To process: ${toProcess.length}`);

  const list = TEST_MODE ? toProcess.slice(0, 1) : toProcess;
  if (!list.length) { console.log('✅ All products already processed!'); return; }

  let saved = 0, skipped = 0, totalTokens = 0;

  for (let i = 0; i < list.length; i++) {
    const product = list[i];
    try {
    let images = product.images || [];
    // Handle case where images is stored as a JSON string
    if (typeof images === 'string') {
      try { images = JSON.parse(images); } catch { images = [images]; }
    }
    if (!Array.isArray(images)) images = [images];
    images = images.filter(u => u && typeof u === 'string' && u.startsWith('http'));
    if (!images.length) { skipped++; continue; }

    console.log(`\n[${i + 1}/${list.length}] ${product.asin} — ${product.title?.slice(0, 55)}`);
    console.log(`  Images: ${images.length}`);

    // Analyze ALL images, find the one with supplement facts
    let bestResult = null;
    let bestImageIdx = 0;
    let bestImageUrl = images[0];

    for (let imgIdx = 0; imgIdx < Math.min(images.length, 5); imgIdx++) {
      const imageUrl = images[imgIdx];
      // Skip invalid URLs
      if (!imageUrl || !imageUrl.startsWith('http')) {
        console.log(`  [img ${imgIdx}] Skipped (invalid URL)`);
        continue;
      }
      try {
        process.stdout.write(`  [img ${imgIdx}] Analyzing... `);
        const { result, usage } = await analyzeImageWithGPT(imageUrl, product.asin, product.title);
        totalTokens += usage?.total_tokens || 0;
        process.stdout.write(`${result.has_supplement_facts ? '✅ SUPPLEMENT FACTS' : '⬜ no facts'} | tokens: ${usage?.total_tokens}\n`);

        // Save each image result
        await saveOCR({
          asin:                  product.asin,
          keyword:               KEYWORD,
          image_url:             imageUrl,
          image_index:           imgIdx,
          serving_size:          result.serving_size || null,
          servings_per_container: result.servings_per_container || null,
          supplement_facts:      result.supplement_facts?.length ? result.supplement_facts : null,
          other_ingredients:     result.other_ingredients || null,
          health_claims:         result.health_claims?.length ? result.health_claims : null,
          certifications:        result.certifications?.length ? result.certifications : null,
          raw_text:              result.raw_text || null,
          gpt_model:             'gpt-4o',
          processed_at:          new Date().toISOString()
        });

        if (result.has_supplement_facts && !bestResult) {
          bestResult = result;
          bestImageIdx = imgIdx;
          bestImageUrl = imageUrl;
        }

        await sleep(1500); // Rate limit buffer between images
      } catch (err) {
        console.log(`  [img ${imgIdx}] Error: ${err.message.slice(0, 80)}`);
        await sleep(1000);
      }
    }

    if (bestResult) {
      console.log(`  ✓ Supplement facts found at image ${bestImageIdx}`);
      console.log(`    Serving: ${bestResult.serving_size} | Nutrients: ${bestResult.supplement_facts?.length}`);
      console.log(`    Claims: ${bestResult.health_claims?.join(', ').slice(0, 80)}`);
      console.log(`    Certs: ${bestResult.certifications?.join(', ')}`);
    }

    saved++;
    } catch (productErr) {
      console.error(`  ✗ Product ${product.asin} fatal error: ${productErr.message?.slice(0, 100)}`);
      skipped++;
    }
    await sleep(2000); // Buffer between products
  }

  console.log(`\n✅ Done. ${saved} products processed | ${skipped} skipped | ~${totalTokens} total tokens`);
  console.log(`   Estimated cost: ~$${(totalTokens * 0.000005).toFixed(3)}`);
}

main().catch(err => { console.error('Fatal:', err.message, err.stack?.slice(0,300)); process.exit(1); });
