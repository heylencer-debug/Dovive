/**
 * phase5-deep-research.js — Automated P5 Deep Research
 *
 * Fetches two pools of products from Supabase and runs Grok 4.2 deep
 * reasoning on each to generate competitive intelligence:
 *
 *   Pool A — TOP 10 BSR:    The 10 best-ranking products in the category
 *   Pool B — TOP 10 NEW:    Top BSR products with < 500 reviews (fast-moving new brands)
 *
 * Each product gets a full AI research brief covering:
 *   - Formula intelligence (extract type, dose, certs, bonus ingredients)
 *   - Consumer sentiment (review patterns, pain points, wins)
 *   - Market positioning (pricing, claims, differentiation)
 *   - DOVIVE competitive angle (how to beat this product)
 *
 * Saves to: dovive_phase5_research (DOVIVE Supabase)
 * Also saves to: products.marketing_analysis.p5_research (DASH Supabase — for dashboard)
 *
 * Usage:
 *   node phase5-deep-research.js --keyword "ashwagandha gummies"
 *   node phase5-deep-research.js --keyword "ashwagandha gummies" --force
 *   node phase5-deep-research.js --keyword "ashwagandha gummies" --pool top10    (only Pool A)
 *   node phase5-deep-research.js --keyword "ashwagandha gummies" --pool newbrands (only Pool B)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { resolveCategory } = require('./utils/category-resolver');

const DASH   = createClient('https://jwkitkfufigldpldqtbq.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc');
const DOVIVE = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const KEYWORD  = process.argv.includes('--keyword')  ? process.argv[process.argv.indexOf('--keyword')  + 1] : 'ashwagandha gummies';
const FORCE    = process.argv.includes('--force');
const POOL_ARG = process.argv.includes('--pool')     ? process.argv[process.argv.indexOf('--pool')     + 1] : 'both';

// ─── xAI Key ──────────────────────────────────────────────────────────────────

function getXaiKey() {
  return process.env.XAI_API_KEY || null;
}

// ─── Grok 4.2 Deep Research Call ──────────────────────────────────────────────

async function callGrok(prompt) {
  const key = getXaiKey();
  if (!key) throw new Error('XAI_API_KEY not found in sterling/.env');

  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'grok-4-1-fast-non-reasoning',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`Grok error: ${j.error.message}`);
  return j.choices?.[0]?.message?.content || null;
}

// ─── Build Prompt for one product ─────────────────────────────────────────────

function buildProductPrompt(product, rank, pool, keyword) {
  const pi  = product.marketing_analysis?.product_intelligence || {};
  const rev = product.review_analysis || {};
  const pkg = product.marketing_analysis?.packaging_intelligence || {};

  const poolLabel = pool === 'top10'
    ? `TOP 10 BSR — Rank #${rank} in "${keyword}"`
    : `TOP 10 NEW BRAND — BSR ${product.bsr_current?.toLocaleString()} | Only ${product.rating_count} reviews (fast mover)`;

  return `You are a senior supplement competitive intelligence analyst with 20+ years of Amazon supplement market experience. Your job is to produce a DEEP RESEARCH BRIEF on a single competitor product for DOVIVE brand.

## PRODUCT: ${product.brand || 'Unknown'} — ${(product.title || '').substring(0, 80)}
**ASIN:** ${product.asin}
**Pool:** ${poolLabel}
**BSR:** ${product.bsr_current?.toLocaleString() || 'N/A'} | **Price:** $${product.price || 'N/A'} | **Revenue:** $${(product.monthly_revenue || 0).toLocaleString()}/mo
**Rating:** ${product.rating_value || 'N/A'} ⭐ (${(product.rating_count || 0).toLocaleString()} reviews)
**Keyword:** ${keyword}

---

## FORMULA DATA (from P4 OCR + P6 Intelligence)

**Extract Type:** ${pi.ashwagandha_extract_type || 'Unknown'}
**Ashwagandha Dose:** ${pi.ashwagandha_amount_mg || '?'}mg
**Withanolide %:** ${pi.withanolide_percentage || 'Not disclosed'}
**Bonus Ingredients:** ${(pi.bonus_ingredients || []).join(', ') || 'None'}
**Certifications:** ${(pi.certifications || []).join(', ') || 'None'}
**Sugar-Free:** ${pi.is_sugar_free} | **Vegan:** ${pi.is_vegan} | **3rd Party Tested:** ${pi.is_third_party_tested}
**Formula Quality Score:** ${pi.formula_quality_score || '?'}/10
**Competitor Threat Level:** ${pi.competitor_threat_level || '?'}
**Price Tier:** ${pi.price_positioning_label || '?'}
**Market Gap:** ${pi.market_opportunity_gap || 'N/A'}

**Full OCR Supplement Facts:**
${product.supplement_facts_raw || 'Not available'}

**Other Ingredients / Excipients:**
${product.other_ingredients || 'Not available'}

---

## MARKETING DATA

**Key Claims on Label:** ${(product.claims_on_label || []).join(', ') || 'N/A'}
**Feature Bullets:**
${(product.feature_bullets_text || '').substring(0, 800) || 'Not available'}

**Packaging Notes:** ${pkg.packaging_summary || 'Not analyzed'}
**Color/Design Signals:** ${pkg.color_signals || 'N/A'}

---

## CONSUMER SENTIMENT (from P3 Reviews)

**Top Positive Themes:** ${JSON.stringify(rev.positive_themes || rev.top_positive || []).slice(0, 400)}
**Top Negative Themes:** ${JSON.stringify(rev.negative_themes || rev.top_negative || []).slice(0, 400)}
**Common Complaints:** ${JSON.stringify(rev.common_complaints || []).slice(0, 400)}
**Efficacy Mentions:** ${JSON.stringify(rev.efficacy_mentions || []).slice(0, 300)}
**NPS/Sentiment Summary:** ${rev.sentiment_summary || rev.overall_sentiment || 'Not available'}

---

## YOUR DELIVERABLE: DEEP RESEARCH BRIEF

Write a structured competitive intelligence report covering all sections below. Be analytical, specific, and actionable. Think like a scientist AND a marketer.

### 1. FORMULA DECONSTRUCTION
- Break down the formula precisely: what every ingredient does at this dose
- Is the ashwagandha dose clinically effective? Compare to research standards (600mg KSM-66 = clinical; 300mg = subthreshold)
- Which bonus ingredients are meaningful vs filler?
- What is the withanolide % and why it matters
- Manufacturing risks or quality flags

### 2. MARKET POSITION ANALYSIS
- How is this brand positioned (premium/value/mass)?
- What makes it win at this BSR / revenue level?
- Pricing vs value delivered — are customers getting fair value?
- Label claims vs actual formula — is it truthful?

### 3. CONSUMER SENTIMENT DEEP DIVE
- What do customers love most? (top 3 genuine drivers of 5-star reviews)
- What drives 1-3 star reviews? (top 3 complaints — formula, packaging, effects, service)
- Are there recurring red flags that signal a market gap?
- What do customers wish this product had?

### 4. THIRD-PARTY TESTING & TRANSPARENCY
- Is this product NSF Certified / Informed Sport / USP verified?
- Any known NAD challenges, FDA warnings, or recall history?
- Transparency of dosing (prop blends vs disclosed)?
- Country of origin / manufacturing standards visible?

### 5. DOVIVE COMPETITIVE ANGLE
- How can DOVIVE beat this specific product?
- What formula improvements would capture customers from this brand?
- Pricing strategy to position against it
- Claims we can make that they cannot (due to our formula advantages)
- One-line positioning statement: "DOVIVE vs [Brand] — [our advantage]"

### 6. THREAT ASSESSMENT
- **Threat Level:** [Critical / High / Medium / Low] — justify
- **Why they win:** [top 2-3 reasons]
- **Where they're vulnerable:** [top 2-3 weaknesses to exploit]
- **12-month trajectory:** [Growing fast / Stable / Declining] — reasoning

### 7. KEY INTELLIGENCE SUMMARY
(3-5 bullet points — the most important facts for DOVIVE's product team)

---

Be brutally honest. If this product is outperforming DOVIVE's target formula, say so and explain why. If it's vulnerable, explain exactly how to exploit it.`;
}

// ─── Parse AI output into structured fields ────────────────────────────────────

function parseResearchOutput(rawText, product, pool) {
  // Extract threat level
  const threatMatch = rawText.match(/\*\*Threat Level:\*\*\s*([^\n\-–]+)/i);
  const threatLevel = threatMatch?.[1]?.trim().split(/[\s,]/)[0] || 'Unknown';

  // Extract DOVIVE angle
  const angleSection = rawText.match(/### 5\. DOVIVE COMPETITIVE ANGLE([\s\S]*?)(?:### 6|$)/)?.[1]?.trim() || '';
  const positioningMatch = angleSection.match(/DOVIVE vs[^\n]+/i);

  // Extract key intelligence bullets
  const summarySection = rawText.match(/### 7\. KEY INTELLIGENCE SUMMARY([\s\S]*?)(?:---|$)/)?.[1]?.trim() || '';
  const keyBullets = summarySection
    .split('\n')
    .filter(l => l.trim().startsWith('-') || l.trim().startsWith('•'))
    .map(l => l.replace(/^[-•]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 5);

  // Extract formula section
  const formulaSection = rawText.match(/### 1\. FORMULA DECONSTRUCTION([\s\S]*?)(?:### 2|$)/)?.[1]?.trim() || '';

  // Extract threats section
  const threatsSection = rawText.match(/### 6\. THREAT ASSESSMENT([\s\S]*?)(?:### 7|$)/)?.[1]?.trim() || '';

  const pi = product.marketing_analysis?.product_intelligence || {};

  return {
    asin: product.asin,
    keyword: product.keyword || KEYWORD,
    brand: product.brand || 'Unknown',
    bsr_rank: product.bsr_current || null,
    pool: pool,  // 'top10' or 'newbrands'
    benefits: keyBullets.slice(0, 3),
    features: [
      `${pi.ashwagandha_amount_mg || '?'}mg ${pi.ashwagandha_extract_type || 'Unknown'} ashwagandha`,
      ...(pi.bonus_ingredients || []).slice(0, 3),
      ...(pi.certifications || []).slice(0, 2),
    ].filter(Boolean),
    formula_notes: formulaSection.substring(0, 800),
    certifications: pi.certifications || [],
    awards: [],
    third_party_tested: pi.is_third_party_tested || false,
    transparency_flag: !pi.is_third_party_tested,
    reddit_sentiment: 'unknown',
    reddit_notes: '',
    reddit_sources: [],
    external_reviews: [],
    healthline_covered: false,
    labdoor_score: null,
    key_weaknesses: (threatsSection.match(/Where they're vulnerable[:\s]+([\s\S]*?)(?:\n-|\n###|$)/i)?.[1] || '').substring(0, 400),
    key_strengths: (threatsSection.match(/Why they win[:\s]+([\s\S]*?)(?:\n-|\n###|$)/i)?.[1] || '').substring(0, 400),
    competitor_angle: angleSection.substring(0, 600),
    full_research: rawText,
    researched_at: new Date().toISOString(),
    researched_by: 'grok-4-1-fast-non-reasoning',
    phase: 5,
  };
}

// ─── Fetch products from Supabase ──────────────────────────────────────────────

async function getProducts(categoryId) {
  // Pool A: Top 10 by BSR
  const { data: top10 } = await DASH.from('products')
    .select(`asin, brand, title, bsr_current, price, monthly_revenue, monthly_sales,
             rating_value, rating_count, supplement_facts_raw, other_ingredients,
             claims_on_label, feature_bullets_text, marketing_analysis, review_analysis`)
    .eq('category_id', categoryId)
    .not('bsr_current', 'is', null)
    .order('bsr_current', { ascending: true })
    .limit(10);

  // Pool B: Top 10 new/emerging brands — strong BSR but low review count
  const { data: newBrands } = await DASH.from('products')
    .select(`asin, brand, title, bsr_current, price, monthly_revenue, monthly_sales,
             rating_value, rating_count, supplement_facts_raw, other_ingredients,
             claims_on_label, feature_bullets_text, marketing_analysis, review_analysis`)
    .eq('category_id', categoryId)
    .not('bsr_current', 'is', null)
    .lt('rating_count', 500)
    .gt('monthly_revenue', 0)
    .order('bsr_current', { ascending: true })
    .limit(10);

  return { top10: top10 || [], newBrands: newBrands || [] };
}

// ─── Check already researched ──────────────────────────────────────────────────

async function getAlreadyResearched() {
  const { data } = await DOVIVE.from('dovive_phase5_research')
    .select('asin, pool, researched_by')
    .ilike('keyword', `%${KEYWORD.split(' ')[0]}%`);
  return new Set((data || [])
    .filter(r => r.researched_by?.includes('grok-4'))  // only skip AI-researched ones
    .map(r => `${r.asin}_${r.pool}`));
}

// ─── Save to DOVIVE Supabase ───────────────────────────────────────────────────

async function saveToSupabase(record) {
  const { error } = await DOVIVE.from('dovive_phase5_research')
    .upsert(record, { onConflict: 'asin,keyword' });

  if (error) {
    // Gracefully handle missing columns (pool, full_research) — retry without them
    if (error.message?.includes('pool') || error.message?.includes('full_research') || error.message?.includes('column')) {
      console.log(`  NOTE: Missing columns in dovive_phase5_research — retrying without pool/full_research`);
      console.log(`  Run this SQL in DOVIVE Supabase: ALTER TABLE dovive_phase5_research ADD COLUMN IF NOT EXISTS pool text; ALTER TABLE dovive_phase5_research ADD COLUMN IF NOT EXISTS full_research text;`);
      const { pool, full_research, ...safeRecord } = record;
      const { error: error2 } = await DOVIVE.from('dovive_phase5_research')
        .upsert(safeRecord, { onConflict: 'asin,keyword' });
      if (error2) throw new Error(`Save failed for ${record.asin}: ${error2.message}`);
    } else {
      throw new Error(`Save failed for ${record.asin}: ${error.message}`);
    }
  }
}

// ─── Save to DASH products table ──────────────────────────────────────────────

async function saveToDashProduct(asin, research) {
  const { data: product } = await DASH.from('products')
    .select('marketing_analysis')
    .eq('asin', asin)
    .single();

  const existing = product?.marketing_analysis || {};
  await DASH.from('products').update({
    marketing_analysis: {
      ...existing,
      p5_research: {
        pool: research.pool,
        competitor_angle: research.competitor_angle,
        key_strengths: research.key_strengths,
        key_weaknesses: research.key_weaknesses,
        threat_assessment: research.full_research?.match(/### 6\. THREAT ASSESSMENT([\s\S]*?)(?:### 7|$)/)?.[1]?.trim()?.substring(0, 800) || '',
        dovive_angle: research.competitor_angle,
        researched_at: research.researched_at,
      },
    },
  }).eq('asin', asin);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function lookupCategoryId(keyword) {
  const cat = await resolveCategory(DASH, keyword);
  console.log(`  → Resolved category (${cat.method}): "${cat.name}" (${cat.id})`);
  return { id: cat.id, name: cat.name };
}

async function run() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🔎 PHASE 5: DEEP RESEARCH — "${KEYWORD}"`);
  console.log(`Pool: ${POOL_ARG === 'both' ? 'Top 10 BSR + Top 10 New Brands' : POOL_ARG === 'top10' ? 'Top 10 BSR only' : 'Top 10 New Brands only'}`);
  console.log(`Model: grok-4-1-fast-non-reasoning (deep thinking)`);
  console.log(`${'═'.repeat(60)}\n`);

  // Get category (strict keyword match + largest product count on ties)
  const cat = await lookupCategoryId(KEYWORD);
  console.log(`Category: ${cat.name} (${cat.id})`);

  // Fetch products
  console.log('\nFetching products...');
  const { top10, newBrands } = await getProducts(cat.id);
  console.log(`  Top 10 BSR:      ${top10.length} products loaded`);
  console.log(`  Top 10 New Brands: ${newBrands.length} products loaded`);

  // Check already done
  const already = FORCE ? new Set() : await getAlreadyResearched();
  console.log(`  Already researched (AI): ${already.size} products${FORCE ? ' (--force: re-running all)' : ''}\n`);

  // Build work queue
  const queue = [];
  if (POOL_ARG !== 'newbrands') {
    top10.forEach((p, i) => queue.push({ product: p, rank: i + 1, pool: 'top10' }));
  }
  if (POOL_ARG !== 'top10') {
    // Deduplicate — don't re-research what's already in top10
    const top10Asins = new Set(top10.map(p => p.asin));
    newBrands.forEach((p, i) => {
      if (!top10Asins.has(p.asin)) {
        queue.push({ product: p, rank: i + 1, pool: 'newbrands' });
      }
    });
  }

  console.log(`Total products to research: ${queue.length}`);
  const toRun = queue.filter(q => !already.has(`${q.product.asin}_${q.pool}`));
  const toSkip = queue.length - toRun.length;
  console.log(`  Running: ${toRun.length} | Skipping (already done): ${toSkip}\n`);

  if (toRun.length === 0) {
    console.log('All products already researched. Use --force to re-run.');
    return;
  }

  // Research each product
  let done = 0;
  let failed = 0;

  for (const { product, rank, pool } of toRun) {
    const poolLabel = pool === 'top10' ? `Top 10 BSR #${rank}` : `New Brand #${rank}`;
    console.log(`\n[${done + 1}/${toRun.length}] ${poolLabel} — ${product.brand || product.asin} (BSR ${product.bsr_current?.toLocaleString()})`);

    try {
      // Build and run prompt
      const prompt = buildProductPrompt(product, rank, pool, KEYWORD);
      console.log(`  Prompt: ${Math.round(prompt.length / 1000)}k chars | Calling Grok 4.1 fast...`);

      const start = Date.now();
      const rawOutput = await callGrok(prompt);
      const elapsed = Math.round((Date.now() - start) / 1000);

      if (!rawOutput) throw new Error('Empty response from Grok 4.2');
      console.log(`  Done (${elapsed}s, ${Math.round(rawOutput.length / 1000)}k chars)`);

      // Parse and save
      const record = parseResearchOutput(rawOutput, product, pool);
      await saveToSupabase(record);
      await saveToDashProduct(product.asin, record);
      console.log(`  Saved to dovive_phase5_research + products.marketing_analysis.p5_research`);

      done++;

      // Throttle — avoid rate limits
      if (done < toRun.length) await new Promise(r => setTimeout(r, 2000));

    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      failed++;
    }
  }

  // Final summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`P5 DEEP RESEARCH COMPLETE — "${KEYWORD}"`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`Researched: ${done} | Failed: ${failed} | Skipped: ${toSkip}`);
  console.log(`Pools: Top 10 BSR + Top 10 New Brands`);
  console.log(`Model: grok-4-1-fast-non-reasoning`);
  console.log(`\nNext: run phase6-product-intelligence.js to score all 159 products`);
}

run().catch(e => {
  console.error('\nFAILED:', e.message);
  process.exit(1);
});
