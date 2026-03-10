/**
 * phase6-product-intelligence.js
 * P6: Product Intelligence — AI-powered via xAI Grok
 *
 * Sends each product's full data (OCR facts, title, BSR, price, reviews, claims)
 * to Grok for accurate formula extraction and competitive scoring.
 * Falls back to rule-based for any product where AI fails.
 *
 * Usage:
 *   node phase6-product-intelligence.js              # all products
 *   node phase6-product-intelligence.js --top 20     # first 20
 *   node phase6-product-intelligence.js --force      # re-analyze already done
 *   node phase6-product-intelligence.js --batch 5    # products per AI batch (default 5)
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEwNDU2NDUsImV4cCI6MjA3NjYyMTY0NX0.VziSAuTdqcteRERIPCdrMy4vqQuHjeC3tvazE0E8nMM'
);
const DOVIVE = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const CAT_ID = '820537da-3994-4a11-a2e0-a636d751b26f';
const TOP_N = process.argv.includes('--top') ? parseInt(process.argv[process.argv.indexOf('--top') + 1]) : 999;
const FORCE = process.argv.includes('--force');
const BATCH_SIZE = process.argv.includes('--batch') ? parseInt(process.argv[process.argv.indexOf('--batch') + 1]) : 5;

// ─── Grok API ─────────────────────────────────────────────────────────────────

function getXaiKey() {
  const sterlingEnv = path.join(__dirname, '../../sterling/.env');
  if (fs.existsSync(sterlingEnv)) {
    const content = fs.readFileSync(sterlingEnv, 'utf8');
    const match = content.match(/XAI_API_KEY\s*=\s*(.+)/);
    if (match) return match[1].trim();
  }
  return process.env.XAI_API_KEY || null;
}

async function callGrok(prompt, maxTokens = 2048) {
  const key = getXaiKey();
  if (!key) throw new Error('No xAI key found. Check sterling/.env');
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'grok-3-mini',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`Grok error: ${j.error.message}`);
  return j.choices?.[0]?.message?.content || null;
}

// ─── Rule-based fallback ──────────────────────────────────────────────────────

function extractAshwagandhaAmountRule(facts) {
  if (!facts) return null;
  const patterns = [
    /(?:ashwagandha|ksm-66|sensoril|shoden|withania)[^0-9\n]{0,40}(\d+(?:\.\d+)?)\s*mg/i,
    /(\d+(?:\.\d+)?)\s*mg[^,\n]{0,20}ashwagandha/i,
  ];
  for (const p of patterns) {
    const m = facts.match(p); if (m) return parseFloat(m[1]);
  }
  return null;
}

function extractExtractTypeRule(facts) {
  if (!facts) return 'Unknown';
  const f = facts.toLowerCase();
  if (f.includes('ksm-66')) return 'KSM-66';
  if (f.includes('sensoril')) return 'Sensoril';
  if (f.includes('shoden')) return 'Shoden';
  if (f.includes('10:1 extract')) return '10:1 Extract';
  if (f.includes('organic extract') || f.includes('root extract')) return 'Organic Extract';
  if (f.includes('extract')) return 'Generic Extract';
  if (f.includes('root powder')) return 'Root Powder';
  return 'Unknown';
}

function detectCertsRule(facts, title) {
  const text = ((facts || '') + ' ' + (title || '')).toLowerCase();
  const certs = [];
  if (text.includes('nsf')) certs.push('NSF Certified');
  if (text.includes('usp verified') || text.includes('usp certified')) certs.push('USP Verified');
  if (text.includes('cgmp') || text.includes('gmp certified')) certs.push('cGMP');
  if (text.includes('third-party tested') || text.includes('3rd party tested')) certs.push('3rd Party Tested');
  if (text.includes('non-gmo') || text.includes('non gmo')) certs.push('Non-GMO');
  if (text.includes('vegan') && !text.includes('non-vegan')) certs.push('Vegan');
  if (text.includes('gluten-free') || text.includes('gluten free')) certs.push('Gluten-Free');
  if (text.includes('sugar-free') || text.includes('sugar free') || text.includes('no added sugar')) certs.push('Sugar-Free');
  if (text.includes('organic')) certs.push('Organic');
  return certs;
}

function detectBonusRule(facts) {
  if (!facts) return [];
  const f = facts.toLowerCase();
  const found = [];
  const checks = [
    ['Black Pepper / BioPerine', ['black pepper', 'bioperine', 'piper nigrum']],
    ['Vitamin D', ['vitamin d3', 'vitamin d2', 'cholecalciferol']],
    ['Vitamin B12', ['vitamin b12', 'cyanocobalamin', 'methylcobalamin']],
    ['Vitamin C', ['vitamin c', 'ascorbic acid']],
    ['Zinc', ['zinc']],
    ['Magnesium', ['magnesium']],
    ['L-Theanine', ['l-theanine', 'theanine']],
    ['Melatonin', ['melatonin']],
    ['Rhodiola', ['rhodiola']],
    ['Turmeric', ['turmeric', 'curcumin']],
    ['Lemon Balm', ['lemon balm']],
    ['GABA', ['gaba']],
    ['5-HTP', ['5-htp', '5htp']],
    ['Elderberry', ['elderberry', 'sambucus']],
    ['Ginseng', ['ginseng']],
    ['Sea Moss', ['sea moss', 'irish moss']],
    ['Lion\'s Mane', ['lion\'s mane', 'lions mane']],
  ];
  for (const [name, terms] of checks) {
    if (terms.some(t => f.includes(t))) found.push(name);
  }
  return found;
}

function scoreFormulaRule(extractType, amount, isThirdParty, certs) {
  let score = 5;
  if (extractType === 'KSM-66') score += 3;
  else if (extractType === 'Sensoril') score += 2.5;
  else if (extractType === 'Shoden') score += 3;
  else if (extractType.includes('Organic')) score += 1.5;
  else if (extractType.includes('10:1')) score += 1;
  else if (extractType === 'Unknown') score -= 1;
  if (amount) { if (amount >= 600) score += 1; else if (amount < 200) score -= 1; }
  if (isThirdParty) score += 1;
  if (certs.includes('NSF Certified') || certs.includes('USP Verified')) score += 0.5;
  return Math.min(10, Math.max(1, Math.round(score * 10) / 10));
}

function ruleBasedAnalysis(product) {
  const facts = product.supplement_facts_raw || '';
  const title = product.title || '';
  const price = parseFloat(product.price || 0);
  const ashwagandhaAmt = extractAshwagandhaAmountRule(facts);
  const extractType = extractExtractTypeRule(facts);
  const certs = detectCertsRule(facts, title);
  const bonusIngredients = detectBonusRule(facts);
  const isThirdParty = certs.some(c => ['3rd Party Tested', 'NSF Certified', 'USP Verified', 'Informed Sport'].includes(c));
  const servings = product.servings_per_container;
  const pricePerServing = (price && servings) ? Math.round(price / servings * 100) / 100 : null;
  const pricePerMg = (pricePerServing && ashwagandhaAmt) ? Math.round(pricePerServing / ashwagandhaAmt * 10000) / 10000 : null;
  const formulaScore = scoreFormulaRule(extractType, ashwagandhaAmt, isThirdParty, certs);
  const bsr = product.bsr_current;
  const rating = product.rating_value;
  const threatLevel = !bsr ? 'Low' : bsr < 1000 ? 'Very High' : bsr < 5000 && (formulaScore >= 7 || rating >= 4.5) ? 'High' : bsr < 20000 ? 'Medium' : 'Low';
  return {
    ashwagandha_amount_mg: ashwagandhaAmt,
    ashwagandha_extract_type: extractType,
    withanolide_percentage: null,
    price_per_serving: pricePerServing,
    price_per_mg_ashwagandha: pricePerMg,
    is_sugar_free: certs.includes('Sugar-Free'),
    is_vegan: certs.includes('Vegan'),
    is_gluten_free: certs.includes('Gluten-Free'),
    is_non_gmo: certs.includes('Non-GMO'),
    is_cgmp: certs.includes('cGMP'),
    is_third_party_tested: isThirdParty,
    certifications: certs,
    bonus_ingredients: bonusIngredients,
    artificial_colors: (facts + title).toLowerCase().includes('fd&c') || (facts + title).toLowerCase().includes('red 40'),
    formula_quality_score: formulaScore,
    competitor_threat_level: threatLevel,
    key_strengths: [],
    key_weaknesses: [],
    analysis_method: 'rule_based',
    analyzed_at: new Date().toISOString(),
  };
}

// ─── Grok batch analysis ──────────────────────────────────────────────────────

async function analyzeProductsWithGrok(products) {
  const productList = products.map((p, i) => `
PRODUCT ${i + 1}: ${p.brand || 'Unknown'} — ${p.title?.substring(0, 80) || 'No title'}
- ASIN: ${p.asin}
- BSR: ${p.bsr_current?.toLocaleString() || 'N/A'} | Price: $${p.price || 'N/A'} | Rating: ${p.rating_value || 'N/A'} (${p.rating_count?.toLocaleString() || 'N/A'} reviews)
- Monthly Revenue: $${(p.monthly_revenue || 0).toLocaleString()} | Monthly Sales: ${p.monthly_sales?.toLocaleString() || 'N/A'}
- Servings Per Container: ${p.servings_per_container || 'N/A'} | Serving Size: ${p.serving_size || 'N/A'}
- Claims on Label: ${(p.claims_on_label || []).join(', ') || 'N/A'}
- Feature Bullets: ${(p.feature_bullets_text || '').substring(0, 300) || 'N/A'}
- Supplement Facts (OCR): ${(p.supplement_facts_raw || p.all_nutrients ? JSON.stringify(p.all_nutrients) : 'Not available')?.substring(0, 600) || 'N/A'}
`).join('\n---\n');

  const prompt = `You are a supplement industry expert analyzing competitor products for Dovive, a gummy supplement brand entering the ashwagandha gummies market.

Analyze each product below and return a JSON array with one object per product. Be precise — extract exact values from the supplement facts when available.

PRODUCTS TO ANALYZE:
${productList}

Return ONLY a valid JSON array with exactly ${products.length} objects. For each product use this exact schema:
[
  {
    "asin": "string — product ASIN",
    "ashwagandha_amount_mg": number or null — exact mg from supplement facts,
    "ashwagandha_extract_type": "KSM-66" | "Sensoril" | "Shoden" | "Organic Extract" | "Generic Extract" | "10:1 Extract" | "Root Powder" | "Unknown",
    "withanolide_percentage": "string like 5% or null",
    "price_per_serving": number or null,
    "price_per_mg_ashwagandha": number or null,
    "is_sugar_free": boolean,
    "is_vegan": boolean,
    "is_gluten_free": boolean,
    "is_non_gmo": boolean,
    "is_cgmp": boolean,
    "is_third_party_tested": boolean,
    "certifications": ["array of strings"],
    "bonus_ingredients": ["array of ingredient names beyond ashwagandha"],
    "artificial_colors": boolean,
    "formula_quality_score": number 1-10 (KSM-66 + high dose + 3rd party = highest),
    "competitor_threat_level": "Very High" | "High" | "Medium" | "Low",
    "key_strengths": ["max 3 strengths"],
    "key_weaknesses": ["max 3 weaknesses"],
    "analysis_method": "grok_ai",
    "form_factor_notes": "brief note about what makes this product unique or generic"
  }
]

Rules:
- formula_quality_score: KSM-66 = +3pts, clinical dose (≥600mg) = +1pt, 3rd party tested = +1pt, NSF = +0.5pt, start from 5
- competitor_threat_level: BSR<1000 = Very High, BSR<5000 + quality≥7 = High, BSR<20000 = Medium, else Low
- Be strict: only mark is_third_party_tested true if explicitly stated
- Return ONLY the JSON array, no other text`;

  const response = await callGrok(prompt, 4096);
  if (!response) throw new Error('Empty response from Grok');

  // Extract JSON from response
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('No JSON array found in Grok response');
  return JSON.parse(jsonMatch[0]);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`P6: PRODUCT INTELLIGENCE (Grok AI) — Ashwagandha Gummies`);
  console.log(`${'═'.repeat(60)}\n`);

  const xaiKey = getXaiKey();
  console.log(`API: ${xaiKey ? '✅ xAI Grok found' : '⚠️  No xAI key — using rule-based fallback'}\n`);

  // Fetch all products
  const { data: products, error } = await DASH.from('products')
    .select(`asin, brand, title, bsr_current, price, monthly_revenue, monthly_sales,
             rating_value, rating_count, serving_size, servings_per_container,
             supplement_facts_raw, all_nutrients, feature_bullets_text,
             claims_on_label, other_ingredients, marketing_analysis`)
    .eq('category_id', CAT_ID)
    .order('bsr_current', { ascending: true })
    .limit(TOP_N);

  if (error) throw error;
  console.log(`Fetched ${products.length} products\n`);

  // Filter: skip already analyzed unless --force
  let toProcess = products;
  if (!FORCE) {
    toProcess = products.filter(p => {
      const pi = p.marketing_analysis?.product_intelligence;
      return !pi || !pi.analyzed_at;
    });
    console.log(`${products.length - toProcess.length} already analyzed → skipping`);
    console.log(`${toProcess.length} to process\n`);
  }

  let saved = 0, errors = 0, aiAnalyzed = 0, ruleAnalyzed = 0;
  const batches = [];
  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    batches.push(toProcess.slice(i, i + BATCH_SIZE));
  }

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    process.stdout.write(`Batch ${bi + 1}/${batches.length} (${batch.length} products)... `);

    let analyses = [];

    // Try Grok first
    if (xaiKey) {
      try {
        const grokResults = await analyzeProductsWithGrok(batch);
        // Map results back to products
        for (let i = 0; i < batch.length; i++) {
          const grokResult = grokResults.find(r => r.asin === batch[i].asin) || grokResults[i];
          if (grokResult) {
            // Merge with computed price stats
            const price = parseFloat(batch[i].price || 0);
            const servings = batch[i].servings_per_container;
            const ashwagandhaAmt = grokResult.ashwagandha_amount_mg;
            const pricePerServing = grokResult.price_per_serving || (price && servings ? Math.round(price / servings * 100) / 100 : null);
            const pricePerMg = grokResult.price_per_mg_ashwagandha || (pricePerServing && ashwagandhaAmt ? Math.round(pricePerServing / ashwagandhaAmt * 10000) / 10000 : null);
            analyses.push({ product: batch[i], intel: { ...grokResult, price_per_serving: pricePerServing, price_per_mg_ashwagandha: pricePerMg, analyzed_at: new Date().toISOString() } });
            aiAnalyzed++;
          }
        }
        process.stdout.write(`✅ Grok AI (${batch.length})`);
      } catch (e) {
        process.stdout.write(`⚠️  Grok failed (${e.message.substring(0, 50)}) → rule-based`);
        analyses = batch.map(p => ({ product: p, intel: ruleBasedAnalysis(p) }));
        ruleAnalyzed += batch.length;
      }
    } else {
      analyses = batch.map(p => ({ product: p, intel: ruleBasedAnalysis(p) }));
      ruleAnalyzed += batch.length;
    }

    // Save each product
    for (const { product, intel } of analyses) {
      const existing = product.marketing_analysis || {};
      const { error: saveErr } = await DASH.from('products').update({
        marketing_analysis: { ...existing, product_intelligence: intel }
      }).eq('asin', product.asin);

      if (saveErr) {
        errors++;
        process.stdout.write(`\n  ❌ Save failed for ${product.asin}: ${saveErr.message}`);
      } else {
        saved++;
      }
    }

    console.log(` → saved ${analyses.length}`);

    // Rate limit: pause between batches to avoid hammering Grok
    if (bi < batches.length - 1) await new Promise(r => setTimeout(r, 1500));
  }

  // Final summary
  const { count: total } = await DASH.from('products')
    .select('*', { count: 'exact', head: true })
    .eq('category_id', CAT_ID)
    .not('marketing_analysis', 'is', null);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`PHASE 6 COMPLETE`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`Processed: ${toProcess.length} | Saved: ${saved} | Errors: ${errors}`);
  console.log(`AI analyzed: ${aiAnalyzed} | Rule-based: ${ruleAnalyzed}`);
  console.log(`Total with P6 data: ${total}/${products.length}`);
}

run().catch(e => { console.error('\n❌ FAILED:', e.message); process.exit(1); });
