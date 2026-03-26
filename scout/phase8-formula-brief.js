/**
 * phase8-formula-brief.js
 * P8: Formula Brief Generator
 *
 * Uses Carlo's exact CMO prompt template â€" feeds compiled P1-P7 data to Claude
 * and lets AI generate the COMPLETE formula specification (not rule-based).
 *
 * Usage:
 *   node phase8-formula-brief.js --keyword "ashwagandha gummies"
 *   node phase8-formula-brief.js --keyword "ashwagandha gummies" --force  (regenerate even if exists)
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { resolveCategory } = require('./utils/category-resolver');

const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);
const DOVIVE = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const KEYWORD = process.argv.includes('--keyword')
  ? process.argv[process.argv.indexOf('--keyword') + 1]
  : 'ashwagandha gummies';
const FORCE = process.argv.includes('--force');

// â"€â"€â"€ API Key â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

// ─── API Keys ─────────────────────────────────────────────────────────────────

function getXaiKey() {
  return process.env.XAI_API_KEY || null;
}

function getOpenRouterKey() {
  return process.env.OPENROUTER_API_KEY || null;
}

// ─── DUAL AI Formulation ───────────────────────────────────────────────────────
// P9 generates TWO independent formula briefs in parallel:
//   1. Grok 4.2 Beta Reasoning  - deep scientific reasoning, like a PhD formulator
//   2. Claude Sonnet 4.6          - via OpenRouter, 1M context synthesis
// P10 QA then compares both and produces a final adjudicated formula.

async function callGrok42(prompt) {
  const key = getXaiKey();
  if (!key) throw new Error('XAI_API_KEY not found in sterling/.env');
  const start = Date.now();
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'grok-4.20-beta-0309-reasoning',
      max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`Grok 4.2 error: ${j.error.message}`);
  const output = j.choices?.[0]?.message?.content || null;
  console.log(`  ✅ Grok 4.2 done (${Math.round((Date.now()-start)/1000)}s, ${Math.round((output?.length||0)/1000)}k chars)`);
  return output;
}

async function callClaudeSonnet(prompt) {
  const key = getOpenRouterKey();
  if (!key) throw new Error('OPENROUTER_API_KEY not found in sterling/.env');
  const start = Date.now();
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://dovive.com',
      'X-Title': 'DOVIVE Scout',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4-6',
      max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`Claude Sonnet 4.6 error: ${j.error.message}`);
  const output = j.choices?.[0]?.message?.content || null;
  console.log(`  ✅ Claude Sonnet 4.6 done (${Math.round((Date.now()-start)/1000)}s, ${Math.round((output?.length||0)/1000)}k chars)`);
  return output;
}
// ─── P5 Deep Research Fetch ───────────────────────────────────────────────────
async function fetchP5DeepResearch(keyword) {
  try {
    const firstWord = keyword.split(' ')[0].toLowerCase();
    const { data } = await DOVIVE.from('dovive_phase5_research')
      .select('asin, brand, title, bsr, monthly_revenue, research_type, ai_analysis, key_findings, formula_insights, competitive_strengths, competitive_weaknesses, market_opportunity, recommended_positioning')
      .or(`keyword.ilike.%${firstWord}%,keyword.ilike.%${keyword}%`)
      .order('bsr', { ascending: true })
      .limit(20);
    return data || [];
  } catch (e) {
    console.warn('  ⚠️ P5 data fetch failed (non-fatal):', e.message);
    return [];
  }
}

// ─── Full Packaging Intelligence Fetch ───────────────────────────────────────
function extractPackagingIntelligence(allProducts) {
  const colorSignals = {};
  const whiteSpaceGaps = [];
  const visualPatterns = {};
  const differentiationOpps = [];
  const competitorWeaknesses = [];
  const labelHierarchyPatterns = [];

  for (const p of allProducts || []) {
    const pk = p.marketing_analysis?.packaging_intelligence;
    if (!pk) continue;

    // Color signals
    if (pk.color_signals || pk.dominant_colors) {
      const colors = pk.color_signals || pk.dominant_colors || [];
      const colorArr = Array.isArray(colors) ? colors : [colors];
      for (const c of colorArr) {
        const key = typeof c === 'string' ? c : (c.color || c.name || JSON.stringify(c));
        if (key) colorSignals[key] = (colorSignals[key] || 0) + 1;
      }
    }

    // Whitespace gaps
    if (pk.whitespace_gaps || pk.market_gaps || pk.gaps) {
      const gaps = pk.whitespace_gaps || pk.market_gaps || pk.gaps || [];
      const gapArr = Array.isArray(gaps) ? gaps : [gaps];
      whiteSpaceGaps.push(...gapArr.filter(g => g && typeof g === 'string'));
    }

    // Visual differentiation opportunities
    if (pk.differentiation_opportunities || pk.visual_differentiation) {
      const opps = pk.differentiation_opportunities || pk.visual_differentiation || [];
      const oppArr = Array.isArray(opps) ? opps : [opps];
      differentiationOpps.push(...oppArr.filter(o => o && typeof o === 'string'));
    }

    // Competitor weaknesses from packaging
    if (pk.competitor_weaknesses || pk.weaknesses) {
      const wks = pk.competitor_weaknesses || pk.weaknesses || [];
      const wkArr = Array.isArray(wks) ? wks : [wks];
      competitorWeaknesses.push(...wkArr.filter(w => w && typeof w === 'string'));
    }

    // Label hierarchy patterns
    if (pk.label_hierarchy || pk.hierarchy) {
      const h = pk.label_hierarchy || pk.hierarchy;
      if (h) labelHierarchyPatterns.push(typeof h === 'string' ? h : JSON.stringify(h));
    }
  }

  // Deduplicate and count
  const topColorSignals = Object.entries(colorSignals)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([color, count]) => `${color}: ${count} products`).join('\n');

  const uniqueGaps = [...new Set(whiteSpaceGaps)].slice(0, 15);
  const uniqueOpps = [...new Set(differentiationOpps)].slice(0, 10);
  const uniqueWeaknesses = [...new Set(competitorWeaknesses)].slice(0, 10);

  return {
    topColorSignals,
    whiteSpaceGaps: uniqueGaps,
    differentiationOpps: uniqueOpps,
    competitorWeaknesses: uniqueWeaknesses,
    labelHierarchyPatterns: labelHierarchyPatterns.slice(0, 5),
  };
}

async function compileMarketData(categoryId) {
  // Pull P6 market intelligence doc (new single-doc market analysis)
  const { data: marketIntelDocs } = await DASH.from('market_intelligence')
    .select('ai_market_analysis, aggregated_data, generated_at')
    .eq('category_id', categoryId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Fallback: check formula_briefs for market_analysis type (saved by phase6-market-analysis.js)
  let marketIntelDoc = marketIntelDocs;
  if (!marketIntelDoc) {
    const { data: fbDoc } = await DASH.from('formula_briefs')
      .select('ingredients, generated_at, brief_type')
      .eq('category_id', categoryId)
      .eq('brief_type', 'market_analysis')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fbDoc?.ingredients?.ai_generated_brief) {
      marketIntelDoc = {
        ai_market_analysis: fbDoc.ingredients.ai_generated_brief,
        aggregated_data: fbDoc.ingredients.data_sources,
        generated_at: fbDoc.generated_at,
        source: 'formula_briefs.market_analysis',
      };
    }
  }

  // Top 20 all-time performers by BSR (expanded from 5 for richer formula comparison)
  const { data: top20 } = await DASH.from('products')
    .select(`
      asin, brand, title, bsr_current, bsr_30_days_avg, bsr_90_days_avg,
      price, monthly_revenue, monthly_sales, rating_value, rating_count,
      packaging_type, serving_size, servings_per_container,
      claims_on_label, supplement_facts_raw, all_nutrients, other_ingredients,
      proprietary_blends, feature_bullets_text, marketing_analysis
    `)
    .eq('category_id', categoryId)
    .not('bsr_current', 'is', null)
    .order('bsr_current', { ascending: true })
    .limit(20);

  const top5 = top20?.slice(0, 5) || [];

  // New winners: high revenue, low review count, BSR < 30k
  const { data: newWinners } = await DASH.from('products')
    .select(`
      asin, brand, title, bsr_current, price, monthly_revenue, monthly_sales,
      rating_count, packaging_type, serving_size, servings_per_container,
      claims_on_label, supplement_facts_raw, all_nutrients, other_ingredients,
      proprietary_blends, feature_bullets_text, marketing_analysis
    `)
    .eq('category_id', categoryId)
    .not('bsr_current', 'is', null)
    .lt('bsr_current', 30000)
    .lt('rating_count', 500)
    .order('monthly_revenue', { ascending: false })
    .limit(5);

  // All products for aggregates
  const { data: allProducts } = await DASH.from('products')
    .select('price, packaging_type, all_nutrients, marketing_analysis, review_analysis')
    .eq('category_id', categoryId)
    .not('marketing_analysis', 'is', null);

  const { count: total } = await DASH.from('products')
    .select('*', { count: 'exact', head: true })
    .eq('category_id', categoryId);

  // â"€â"€ Aggregate ingredient frequency from P6 â"€â"€
  const ingredientMap = {};
  const claimMap = {};
  const painPointMap = {};
  const formMap = {};
  let totalPrice = 0, priceCount = 0, totalIngCount = 0, ingCountN = 0;

  for (const p of allProducts || []) {
    // Price avg
    if (p.price) { totalPrice += p.price; priceCount++; }

    // Form types
    if (p.packaging_type) {
      const f = p.packaging_type.toLowerCase().includes('gummy') ? 'Gummy' :
                p.packaging_type.toLowerCase().includes('capsule') ? 'Capsule' :
                p.packaging_type.toLowerCase().includes('tablet') ? 'Tablet' :
                p.packaging_type.toLowerCase().includes('powder') ? 'Powder' :
                p.packaging_type.toLowerCase().includes('liquid') ? 'Liquid' : 'Other';
      formMap[f] = (formMap[f] || 0) + 1;
    }

    // Ingredient frequency from P6 bonus_ingredients
    const pi = p.marketing_analysis?.product_intelligence;
    if (pi?.bonus_ingredients) {
      const count = pi.bonus_ingredients.length;
      totalIngCount += count; ingCountN++;
      for (const ing of pi.bonus_ingredients) {
        ingredientMap[ing] = (ingredientMap[ing] || 0) + 1;
      }
    }

    // Claims from packaging intelligence
    const pk = p.marketing_analysis?.packaging_intelligence;
    if (pk?.benefit_claims) {
      for (const c of pk.benefit_claims) claimMap[c] = (claimMap[c] || 0) + 1;
    }

    // Pain points from reviews
    if (p.review_analysis?.pain_points) {
      for (const pt of p.review_analysis.pain_points) {
        const key = typeof pt === 'string' ? pt : (pt.issue || pt.theme || pt.pain_point || '');
        if (key) painPointMap[key] = (painPointMap[key] || 0) + (pt.frequency || 1);
      }
    }
  }

  const topIngredients = Object.entries(ingredientMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([ingredient, count]) => ({
      ingredient,
      count,
      percent_of_products: Math.round(count / (allProducts?.length || 1) * 100),
    }));

  const topClaims = Object.entries(claimMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([claim, count]) => ({ claim, count }));

  const topPainPoints = Object.entries(painPointMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([keyword, mentions]) => ({ keyword, mentions }));

  const commonForms = Object.entries(formMap)
    .sort((a, b) => b[1] - a[1])
    .map(([form]) => form);

  // ── Serving size distribution ──────────────────────────────────────────────
  const servingSizeMap = {};
  for (const p of allProducts || []) {
    if (p.serving_size) {
      const ss = String(p.serving_size).toLowerCase().trim();
      servingSizeMap[ss] = (servingSizeMap[ss] || 0) + 1;
    }
  }
  const servingSizeDistribution = Object.entries(servingSizeMap)
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([ss, count]) => `"${ss}": ${count} products`).join('\n');

  // ── Ingredient dosage ranges from OCR (all_nutrients) ─────────────────────
  const dosageRangeMap = {}; // ingredient → [amounts]
  for (const p of (top20 || [])) {
    const nutrients = p.all_nutrients;
    if (!Array.isArray(nutrients)) continue;
    for (const n of nutrients) {
      const name = (n.name || n.ingredient || '').trim();
      const amt = parseFloat((n.amount || n.quantity || '').toString().replace(/[^0-9.]/g, ''));
      if (name && !isNaN(amt) && amt > 0) {
        if (!dosageRangeMap[name]) dosageRangeMap[name] = [];
        dosageRangeMap[name].push(amt);
      }
    }
  }
  const dosageRanges = Object.entries(dosageRangeMap)
    .filter(([, vals]) => vals.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 20)
    .map(([ing, vals]) => {
      const min = Math.min(...vals), max = Math.max(...vals), avg = Math.round(vals.reduce((a,b)=>a+b,0)/vals.length);
      return `${ing}: min ${min} / avg ${avg} / max ${max} (${vals.length} products)`;
    }).join('\n');

  // ── Price-per-serving from top competitors ────────────────────────────────
  const pricePerServing = (top20 || [])
    .filter(p => p.price && p.servings_per_container)
    .map(p => {
      const pps = (p.price / p.servings_per_container).toFixed(3);
      return `${p.brand} (BSR ${p.bsr_current?.toLocaleString()}): $${p.price}/${p.servings_per_container} servings = $${pps}/serving`;
    }).join('\n') || 'Price-per-serving data not available';

  // ── Positive ingredient signals from reviews ──────────────────────────────
  const positiveIngredientSignals = {};
  const negativeIngredientSignals = {};
  for (const p of allProducts || []) {
    const ra = p.review_analysis;
    if (!ra) continue;
    // Pull loved/praised ingredients from review analysis
    const praised = ra.praised_ingredients || ra.top_ingredients || ra.loved_ingredients || [];
    const criticized = ra.criticized_ingredients || ra.disliked_ingredients || [];
    for (const ing of praised) {
      const key = typeof ing === 'string' ? ing : (ing.ingredient || ing.name || '');
      if (key) positiveIngredientSignals[key] = (positiveIngredientSignals[key] || 0) + 1;
    }
    for (const ing of criticized) {
      const key = typeof ing === 'string' ? ing : (ing.ingredient || ing.name || '');
      if (key) negativeIngredientSignals[key] = (negativeIngredientSignals[key] || 0) + 1;
    }
  }
  const topPositiveIngredients = Object.entries(positiveIngredientSignals)
    .sort((a,b)=>b[1]-a[1]).slice(0,10)
    .map(([ing, n]) => `${ing}: praised in ${n} product reviews`).join('\n') || 'Insufficient review data';
  const topNegativeIngredients = Object.entries(negativeIngredientSignals)
    .sort((a,b)=>b[1]-a[1]).slice(0,10)
    .map(([ing, n]) => `${ing}: criticized in ${n} product reviews`).join('\n') || 'None flagged';

  // ── P5 Deep Research ──────────────────────────────────────────────────────
  console.log('  Fetching P5 deep research...');
  const p5Research = await fetchP5DeepResearch(KEYWORD);
  console.log(`  P5 records: ${p5Research.length}`);

  // ── Full Packaging Intelligence from P8 ──────────────────────────────────
  console.log('  Extracting full P8 packaging intelligence...');
  const packagingIntel = extractPackagingIntelligence(allProducts);
  console.log(`  P8 packaging: ${packagingIntel.whiteSpaceGaps.length} gaps, ${packagingIntel.differentiationOpps.length} opps`);

  // ── Pull actual raw review text from dovive_reviews ───────────────────────
  let rawReviewText = { positive: [], negative: [] };
  try {
    const allAsins = (top20 || []).map(p => p.asin).filter(Boolean);
    if (allAsins.length) {
      const { data: rawPos } = await DOVIVE.from('dovive_reviews')
        .select('asin, rating, title, body').in('asin', allAsins)
        .gte('rating', 4).not('body', 'is', null).limit(30);
      const { data: rawNeg } = await DOVIVE.from('dovive_reviews')
        .select('asin, rating, title, body').in('asin', allAsins)
        .lte('rating', 2).not('body', 'is', null).limit(30);
      rawReviewText.positive = (rawPos || []).sort(() => Math.random()-0.5).slice(0,20)
        .map(r => `[★${r.rating}] "${r.title || ''}" — ${(r.body||'').slice(0,250)}`);
      rawReviewText.negative = (rawNeg || []).sort(() => Math.random()-0.5).slice(0,20)
        .map(r => `[★${r.rating}] "${r.title || ''}" — ${(r.body||'').slice(0,250)}`);
    }
  } catch(e) { /* reviews optional */ }

  return {
    category_summary: {
      total_products: total,
      avg_price: priceCount ? `$${(totalPrice / priceCount).toFixed(2)}` : 'N/A',
      avg_ingredients_count: ingCountN ? Math.round(totalIngCount / ingCountN) : 'N/A',
      common_forms: commonForms,
      top_pain_points: topPainPoints,
      top_claims: topClaims,
      top_ingredients: topIngredients,
      serving_size_distribution: servingSizeDistribution,
      dosage_ranges: dosageRanges,
      price_per_serving: pricePerServing,
      positive_ingredient_signals: topPositiveIngredients,
      negative_ingredient_signals: topNegativeIngredients,
      raw_reviews_positive: rawReviewText.positive,
      raw_reviews_negative: rawReviewText.negative,
      top_performers: (top5 || []).map(p => ({
        ...p,
        nutrients: p.all_nutrients,
        ingredients: p.all_nutrients,
        flavor_options: [],
        nutrients_count: p.all_nutrients ? Object.keys(p.all_nutrients).length : 'Unknown',
      })),
    },
    formula_references: (newWinners || [])
      .filter(p => !top5?.some(t => t.asin === p.asin))
      .map(p => ({
        ...p,
        age_months: Math.round((p.rating_count || 0) / 30),
        nutrients: p.all_nutrients,
        ingredients: p.supplement_facts_raw,
      })),
    // NEW: P6 market intelligence (single holistic analysis)
    market_intelligence: marketIntelDoc ? {
      report: marketIntelDoc.ai_market_analysis,
      generated_at: marketIntelDoc.generated_at,
      has_data: true,
    } : { has_data: false },
    // P5 deep research — top 20 BSR + new brands AI analysis
    p5_deep_research: p5Research,
    // P8 full packaging intelligence
    packaging_intelligence: packagingIntel,
    // NEW: Top 20 competitor formulas with full detail
    top20_competitors: (top20 || []).map((p, idx) => {
      const pi = p.marketing_analysis?.product_intelligence || {};
      return {
        rank: idx + 1,
        brand: p.brand,
        title: (p.title || '').substring(0, 70),
        asin: p.asin,
        bsr: p.bsr_current,
        monthly_revenue: p.monthly_revenue,
        price: p.price,
        rating: p.rating_value,
        reviews: p.rating_count,
        // Extracted formula data
        ashwagandha_mg: pi.ashwagandha_amount_mg,
        extract_type: pi.ashwagandha_extract_type,
        withanolides: pi.withanolide_percentage,
        bonus_ingredients: pi.bonus_ingredients || [],
        certifications: pi.certifications || [],
        is_sugar_free: pi.is_sugar_free,
        is_vegan: pi.is_vegan,
        is_third_party_tested: pi.is_third_party_tested,
        formula_score: pi.formula_quality_score,
        threat_level: pi.competitor_threat_level,
        bsr_trend: pi.bsr_trend_label,
        price_tier: pi.price_positioning_label,
        market_opportunity_gap: pi.market_opportunity_gap,
        key_strengths: pi.key_strengths || [],
        key_weaknesses: pi.key_weaknesses || [],
        // Raw OCR for accurate formula reconstruction
        supplement_facts_raw: (p.supplement_facts_raw || '').substring(0, 800),
        other_ingredients: p.other_ingredients,
      };
    }),
  };
}

// â"€â"€â"€ Build Prompt (Carlo's exact template + P6 market intel + top20 formulas) â"€â"€

function buildPrompt(marketData) {
  const cs = marketData.category_summary;
  const leader = cs.top_performers[0];
  const refs = marketData.formula_references;
  const mi = marketData.market_intelligence;
  const top20 = marketData.top20_competitors || [];
  const p5 = marketData.p5_deep_research || [];
  const pkgIntel = marketData.packaging_intelligence || {};

  // ── P5 Deep Research Section ──────────────────────────────────────────────
  const p5Section = p5.length > 0
    ? p5.map((r, i) => `
### P5 Research #${i + 1}: ${r.brand} — BSR ${r.bsr?.toLocaleString()} | $${(r.monthly_revenue || 0).toLocaleString()}/mo [${r.research_type || 'bsr'}]
**AI Analysis:** ${r.ai_analysis || 'N/A'}
**Key Findings:** ${Array.isArray(r.key_findings) ? r.key_findings.join('; ') : (r.key_findings || 'N/A')}
**Formula Insights:** ${r.formula_insights || 'N/A'}
**Competitive Strengths:** ${Array.isArray(r.competitive_strengths) ? r.competitive_strengths.join('; ') : (r.competitive_strengths || 'N/A')}
**Competitive Weaknesses:** ${Array.isArray(r.competitive_weaknesses) ? r.competitive_weaknesses.join('; ') : (r.competitive_weaknesses || 'N/A')}
**Market Opportunity:** ${r.market_opportunity || 'N/A'}
**Recommended Positioning:** ${r.recommended_positioning || 'N/A'}
`).join('\n---\n')
    : '⚠️ P5 deep research not yet run for this keyword. Run phase5-deep-research.js first.';

  // ── P8 Packaging Intelligence Section ────────────────────────────────────
  const packagingSection = `
### Dominant Color Signals (what competitors use — AVOID to differentiate):
${pkgIntel.topColorSignals || 'Not available'}

### Packaging Whitespace Gaps (unmet visual needs — EXPLOIT these):
${pkgIntel.whiteSpaceGaps?.map(g => `- ${g}`).join('\n') || 'Not available'}

### Differentiation Opportunities (from packaging AI analysis):
${pkgIntel.differentiationOpps?.map(o => `- ${o}`).join('\n') || 'Not available'}

### Competitor Packaging Weaknesses (exploit in your design brief):
${pkgIntel.competitorWeaknesses?.map(w => `- ${w}`).join('\n') || 'Not available'}

### Label Hierarchy Patterns (what the market emphasizes):
${pkgIntel.labelHierarchyPatterns?.join('\n') || 'Not available'}
`;

  // P6 market intelligence section â€" full report from phase6-market-analysis.js
  const marketIntelSection = mi?.has_data
    ? `## P6 MARKET INTELLIGENCE REPORT
*AI-generated single market analysis across all ${cs.total_products} products. Source: phase6-market-analysis.js*

${mi.report?.substring(0, 6000) || 'Not available'}
${(mi.report?.length || 0) > 6000 ? '\n[... report continues â€" using first 6k chars for context ...]\n' : ''}`
    : `## P6 MARKET INTELLIGENCE
âš ï¸ Not yet generated. Run: node phase6-market-analysis.js --keyword "${KEYWORD}"
P8 will still run but with reduced market context.`;

  // Top 20 competitor formula table
  const top20FormulasSection = top20.slice(0, 20).map(c => `
### #${c.rank} ${c.brand} â€" BSR ${c.bsr?.toLocaleString()} | $${c.monthly_revenue?.toLocaleString()}/mo | $${c.price} | ${c.rating}â­ (${c.reviews?.toLocaleString()} reviews)
**Formula:** ${c.ashwagandha_mg || '?'}mg ${c.extract_type || 'Unknown'} ${c.withanolides ? `(${c.withanolides} withanolides)` : ''}
**Bonus ingredients:** ${c.bonus_ingredients.join(', ') || 'None'}
**Certifications:** ${c.certifications.join(', ') || 'None'} | Sugar-Free: ${c.is_sugar_free} | Vegan: ${c.is_vegan} | 3rd Party Tested: ${c.is_third_party_tested}
**Formula Score:** ${c.formula_score}/10 | **Threat:** ${c.threat_level} | **BSR Trend:** ${c.bsr_trend}
**Price Tier:** ${c.price_tier} | **Revenue/Review:** $${c.revenue_per_review}/review
**Key Strengths:** ${c.key_strengths.join('; ') || 'N/A'}
**Key Weaknesses:** ${c.key_weaknesses.join('; ') || 'N/A'}
**Market Gap:** ${c.market_opportunity_gap || 'N/A'}
**OCR Supplement Facts:** ${c.supplement_facts_raw || 'Not available'}
${c.other_ingredients ? `**Other Ingredients:** ${c.other_ingredients}` : ''}
`).join('\n---\n');

  const leaderSection = leader ? `
#1 BESTSELLER: ${leader.brand}
- ASIN: ${leader.asin || 'N/A'}
- Product Form: ${leader.packaging_type || 'Not specified'}
- Serving Size: ${leader.serving_size || 'Not specified'}
- Servings Per Container: ${leader.servings_per_container || 'Not specified'}
- Total Ingredients: ${leader.nutrients_count || 'Unknown'}
- Key Claims: ${(leader.claims_on_label || []).join(', ') || 'Not available'}
- Price Point: ${leader.price ? `$${leader.price}` : 'Not available'}
- Monthly Revenue: $${(leader.monthly_revenue || 0).toLocaleString()}

#1's Full Ingredient List (OCR Extracted):
${leader.supplement_facts_raw || JSON.stringify(leader.all_nutrients || 'Not available', null, 2)}
` : 'Top performer data not available';

  const newWinnersSection = refs && refs.length > 0
    ? refs.slice(0, 5).map((p, i) => `
New Winner #${i + 1}: ${p.brand} (BSR: ${p.bsr_current?.toLocaleString()}, Rev: $${(p.monthly_revenue || 0).toLocaleString()}/mo, Reviews: ${p.rating_count || 'unknown'})
- Form: ${p.packaging_type || 'Not specified'} | Serving: ${p.serving_size || 'Not specified'}
- Claims: ${(p.claims_on_label || []).join(', ') || 'Not available'}

ðŸ" DETAILED SUPPLEMENT FACTS (Extracted via OCR):
${p.supplement_facts_raw || JSON.stringify(p.all_nutrients || 'No detailed nutrients found', null, 2)}

ðŸ§ª PROPRIETARY BLENDS:
${p.proprietary_blends && p.proprietary_blends.length > 0 ? JSON.stringify(p.proprietary_blends, null, 2) : 'None'}

ðŸ"¹ OTHER INGREDIENTS / EXCIPIENTS:
${p.other_ingredients || 'Not specified'}
`).join('\n---\n')
    : 'No specific new winners identified.';

  const top5Section = cs.top_performers.slice(0, 5).map((p, i) => `
#${i + 1}: ${p.brand}
- Form: ${p.packaging_type || 'Not specified'}
- Serving Size: ${p.serving_size || 'Not specified'}
- Ingredient Count: ${p.nutrients_count || 'Unknown'}
- Price: ${p.price ? `$${p.price}` : 'N/A'}
- Key Claims: ${(p.claims_on_label || []).slice(0, 5).join(', ') || 'Not available'}
- Monthly Revenue: $${(p.monthly_revenue || 0).toLocaleString()}
- Ingredients: ${p.supplement_facts_raw ? p.supplement_facts_raw.substring(0, 400) : JSON.stringify((p.all_nutrients || []).slice ? (p.all_nutrients || []).slice(0, 10) : p.all_nutrients || 'Not available')}
`).join('\n---\n');

  const ingredientFrequency = cs.top_ingredients.length > 0
    ? cs.top_ingredients.map((ing, idx) =>
        ` ${idx + 1}. **${ing.ingredient}**: ${ing.percent_of_products}% of products`
      ).join('\n')
    : 'Ingredient frequency data not available';

  const formPainPoints = cs.top_pain_points.filter(p =>
    ['taste', 'flavor', 'texture', 'dissolve', 'smell', 'size', 'swallow', 'aftertaste', 'chalky', 'gritty', 'bitter']
      .some(w => p.keyword.toLowerCase().includes(w))
  ).map(p => `- ${p.keyword}: ${p.mentions} mentions`).join('\n') || 'No specific formulation feedback';

  // Build flavor intelligence from top competitor data
  const flavorIntelSection = (() => {
    const lines = [];
    // Flavor data from top competitors (titles + other_ingredients)
    const flavorCompetitors = top20.slice(0, 10).filter(c => c.supplement_facts_raw || c.other_ingredients);
    flavorCompetitors.forEach(c => {
      const raw = ((c.supplement_facts_raw || '') + ' ' + (c.other_ingredients || '')).toLowerCase();
      const flavors = [];
      if (raw.includes('strawberry')) flavors.push('strawberry');
      if (raw.includes('raspberry')) flavors.push('raspberry');
      if (raw.includes('lemon')) flavors.push('lemon');
      if (raw.includes('mango')) flavors.push('mango');
      if (raw.includes('peach')) flavors.push('peach');
      if (raw.includes('cherry')) flavors.push('cherry');
      if (raw.includes('mixed berry') || raw.includes('mixed fruit')) flavors.push('mixed berry');
      if (raw.includes('apple')) flavors.push('apple');
      if (raw.includes('watermelon')) flavors.push('watermelon');
      if (raw.includes('citrus')) flavors.push('citrus');
      if (flavors.length) lines.push(`- ${c.brand} BSR#${c.rank}: ${flavors.join(', ')}`);
    });
    // Taste/flavor pain points from reviews
    const tastePains = cs.top_pain_points.filter(p =>
      ['taste', 'flavor', 'texture', 'smell', 'aftertaste', 'chalky', 'gritty', 'bitter', 'sweet', 'sugar']
        .some(w => p.keyword.toLowerCase().includes(w))
    ).map(p => `- "${p.keyword}": ${p.mentions} review mentions`);
    return [
      '### Competitor Flavor Profiles',
      lines.length ? lines.join('\n') : '- Flavor data not extracted from supplement facts',
      '',
      '### Consumer Taste Complaints (from reviews - solve these)',
      tastePains.length ? tastePains.join('\n') : '- No specific taste complaints found',
      '',
      '### Flavor Strategy Directive',
      '- Gummies must taste GREAT - taste is a purchase repeat driver',
      '- Ashwagandha has a bitter/earthy note - must be masked aggressively',
      '- Recommend: natural fruit flavor with citric acid brightness to cut bitterness',
      '- Include flavor name, intensity level, and masking agent recommendations in spec',
    ].join('\n');
  })();

  const efficacyPainPoints = cs.top_pain_points.filter(p =>
    ['work', 'effect', 'result', 'notice', 'difference', 'help', 'benefit']
      .some(w => p.keyword.toLowerCase().includes(w))
  ).map(p => `- ${p.keyword}: ${p.mentions} mentions`).join('\n') || 'No specific efficacy feedback';

  const allPainPoints = cs.top_pain_points.map(p =>
    `- ${p.keyword}: ${p.mentions} mentions`
  ).join('\n') || 'Pain point data not available';

  const claimsAnalysis = cs.top_claims.map((c, i) =>
    `${i + 1}. ${c.claim}: ${c.count} products`
  ).join('\n') || 'Claims data not available';

  return `You are a senior supplement formulation specialist and CMO consultant creating a FORMULA SPECIFICATION to BEAT the #1 market leader for DOVIVE brand.

# DATA SOURCES FEEDING THIS BRIEF (ALL must be used):
- P1: Amazon scrape — ${cs.total_products} products (titles, BSR, prices, bullets, claims)
- P2: Keepa enrichment — revenue, monthly sales, BSR trends per product
- P3: Customer reviews — raw VOC quotes, sentiment, pain points, ingredient signals
- P4: OCR supplement facts — exact dosages, serving sizes, certifications across competitors
- P5: Deep AI research — ${p5.length} products researched (top BSR + new winners)
- P6: Product intelligence scores — formula quality, threat levels, market gaps
- P7: Market intelligence report — category-level AI analysis
- P8: Packaging intelligence — color signals, whitespace gaps, differentiation opportunities


# MISSION: CLINICALLY DIFFERENTIATE — BUILD A BETTER FORMULA, NOT A COPY

Your job:
1. Study the exact formulas of the top 20 competitors (OCR-extracted supplement facts below)
2. Identify what is clinically suboptimal in competitor formulas: underdosed ingredients, inferior forms, unnecessary filler ingredients
3. Build a formula that wins on CLINICAL EFFICACY and INGREDIENT QUALITY — not by copying trends
4. Apply the DIFFERENTIATION HIERARCHY (in order of priority):
   a. **Superior bioavailable forms**: Use the most bioavailable form of each ingredient (e.g., L-5-MTHF methylated folate instead of folic acid, chelated minerals instead of oxides, beta-carotene instead of retinyl palmitate). ~40% of people carry MTHFR variants — methylated forms are a credible differentiator.
   b. **Clinically effective doses**: Meet or exceed the minimum clinically studied dose for each active. Do NOT inflate doses beyond clinical utility for marketing optics (e.g., 5,000 mcg biotin is clinically sufficient — 10,000 mcg is trend-chasing with no added benefit).
   c. **Lean formula principle**: Fewer well-dosed actives beats a kitchen-sink formula. Every ingredient must earn its place. An 8–10 ingredient formula at clinical doses is stronger than a 14-ingredient formula with diluted amounts.
   d. **Consumer pain point solutions**: Solve taste, texture, or side effect complaints using the excipient system, not by adding more actives.
5. Output a complete, production-ready CMO formula specification

---

---

${marketIntelSection}

---

## 🔬 P5 DEEP RESEARCH — AI ANALYSIS OF TOP BSR + NEW WINNERS
Per-product deep research covering formula advantages, weaknesses, and market gaps.
USE THIS to understand WHY top products win and where to attack.

${p5Section}

---

## ðŸ† TOP 20 COMPETITOR FORMULA DECONSTRUCTION

These are the formulas you must analyze, reconstruct, and BEAT. Full OCR supplement facts included.

${top20FormulasSection}

---

## ðŸ¥‡ PRIMARY BENCHMARK: THE #1 MARKET LEADER (THE GIANT)

This is the established standard to match:

${leaderSection}

---

## ðŸš€ THE NEW WINNERS (High Growth, Low Reviews = Recently Launched)
These are the new products stealing market share right now. Prioritize their innovations over the old giant.

${newWinnersSection}

---

## ðŸ"Š COMPETITIVE INTELLIGENCE: TOP 5 ANALYSIS (ALL TIME)

${top5Section}

---

## ðŸ§ª INGREDIENT FREQUENCY ANALYSIS

These ingredients appear most frequently across successful products:

${ingredientFrequency}

STRATEGIC INSIGHT: 50%+ = MUST-HAVE. 20-50% = Differentiator. <20% = Unique selling point.

---

## ðŸ"ˆ CATEGORY STATISTICS

- Total Products Analyzed: ${cs.total_products || 'N/A'}
- Average Ingredient Count: ${cs.avg_ingredients_count || 'N/A'}
- Common Dosage Forms: ${cs.common_forms?.join(', ') || 'N/A'}
- Average Price Point: ${cs.avg_price || 'N/A'}

---

## SERVING SIZE DISTRIBUTION (what the market actually uses)
${cs.serving_size_distribution || 'Not available'}

---

## PRICE-PER-SERVING ANALYSIS (value benchmark)
${cs.price_per_serving || 'Not available'}

---

## COMPETITOR INGREDIENT DOSAGE RANGES (from OCR supplement facts)
These are real dosage ranges across all top competitors — min, average, and max per ingredient.
Use these to understand what the market currently uses, and where to position DOVIVE.
${cs.dosage_ranges || 'OCR data not yet available'}

---

## VOICE OF CUSTOMER — WHAT PEOPLE LOVE (Positive Reviews)
Real customer quotes from top competitor products. Study what outcomes and ingredients they praise.
${(cs.raw_reviews_positive && cs.raw_reviews_positive.length) ? cs.raw_reviews_positive.join('\n') : 'Reviews not yet available — run P3 first'}

---

## VOICE OF CUSTOMER — WHAT PEOPLE HATE (Critical Reviews)  
Real 1-2 star reviews. Study what problems your formula must solve.
${(cs.raw_reviews_negative && cs.raw_reviews_negative.length) ? cs.raw_reviews_negative.join('\n') : 'Reviews not yet available'}

---

## INGREDIENT REVIEW SENTIMENT
Ingredients customers PRAISE: ${cs.positive_ingredient_signals || 'Insufficient data'}
Ingredients customers CRITICIZE: ${cs.negative_ingredient_signals || 'None flagged'}

---

## âš ï¸ CONSUMER PAIN POINTS (Problems to SOLVE)

Formulation-Related Complaints:
${formPainPoints}

Efficacy-Related Complaints:
${efficacyPainPoints}

All Consumer Pain Points:
${allPainPoints}

---

## ðŸ·ï¸ CLAIMS ANALYSIS

${claimsAnalysis}

---

## 📦 P8 PACKAGING INTELLIGENCE — EXPLOIT THESE GAPS
AI analysis of competitor packaging. Use to design DOVIVE packaging that stands out and captures whitespace.

${packagingSection}

---

# YOUR DELIVERABLE: FORMULA SPECIFICATION FOR CONTRACT MANUFACTURER

Create a specification document focused on WHAT to make (not HOW - the CMO has their own processes).

---

## 1. EXECUTIVE SUMMARY

Brief overview: Product name, dosage form, target market, key differentiators vs #1, serving size, servings per container.

---

## 2. FORMULA COMPOSITION

### Master Formula (Per Serving)

FORMULATION STRATEGY:
1. STEP 1: AUDIT COMPETITOR FORMS — for each active ingredient across all top-20 competitors, record: (a) which form they use, (b) what dose they use. Identify the most common form AND the most bioavailable form. If they differ, default to the most bioavailable form for DOVIVE.
   * FORM HIERARCHY (always prefer the higher-ranked form):
     - Folate: L-5-MTHF (methylfolate) > folic acid
     - Vitamin A: beta-carotene > retinyl palmitate (lower toxicity risk)
     - Magnesium: glycinate/bisglycinate/malate > citrate > oxide
     - Zinc: bisglycinate/picolinate/gluconate > sulfate > oxide
     - Iron: bisglycinate/ferrochel > fumarate > sulfate
     - B12: methylcobalamin > cyanocobalamin
     - Any mineral: chelated (amino acid chelate) > inorganic salt
   * If a New Winner is gaining ground specifically because of a form upgrade (e.g., switching to methylated folate), note it and adopt it.
2. STEP 2: SET CLINICAL DOSE FLOORS — for each active in THIS formula, identify the minimum clinically effective dose from published human research for its stated function. NEVER go below this floor. If competitors are underdosing, match or exceed the clinical minimum. Do NOT exceed the clinical ceiling without a clear reason — if a competitor uses a dose that exceeds clinical need just to claim a higher number on the label, DO NOT match that inflation.
3. STEP 3: APPLY LEAN FORMULA PRINCIPLE — review the full ingredient list. Remove any ingredient that:
   * Appears at a dose too low to have clinical effect (e.g., 1 mg of an ingredient studied at 100 mg)
   * Duplicates the function of another ingredient already at an effective dose
   * Is included only for label aesthetics ("label dressing")
   Target: 8–12 active ingredients, each at a meaningful dose, over 14+ ingredients at diluted amounts.
4. STEP 4: SOLVE PAIN POINTS via the EXCIPIENT SYSTEM, not by adding more actives. Taste complaints → flavor/sweetener adjustment. Texture issues → gummy base/coating adjustment. Upset stomach → add with food guidance or switch mineral form.
5. STEP 5: MANUFACTURABILITY VALIDATION — before finalizing, run every active through these checks for the chosen dosage form:
   * **Active load limit**: For gummies, total actives per gummy must stay within 250–350 mg. Divide total actives by servings per serving size. If over limit, reduce serving size count or remove lowest-priority actives.
   * **Heat-sensitive ingredients**: Flag any ingredient that degrades above 60°C (common in gummy molding). Examples: probiotics, certain enzymes, omega-3s, some methylated vitamins. Recommend encapsulated or cold-process form if needed.
   * **pH-sensitive ingredients**: Flag ingredients that degrade in acidic gummy matrix (pH 3–4). Examples: iron (oxidation), calcium (precipitation), zinc at high doses. Note required buffering or encapsulation.
   * **Taste/bitterness threshold**: Flag any ingredient with a known bitter or metallic taste at the proposed dose (e.g., zinc, magnesium, certain herbals). Require masking strategy in excipient system.
   * **Hygroscopicity**: Flag highly hygroscopic actives that will cause gummy stickiness or clumping (e.g., magnesium chloride, some amino acids). Recommend anhydrous or encapsulated forms.
   * **Incompatibilities**: Flag known ingredient-ingredient interactions (e.g., calcium blocks iron absorption — separate if both present; fat-soluble vitamins require lipid carrier in gummies).
   If the dosage form is NOT a gummy, apply the equivalent constraints for that form (capsule fill weight limits, tablet compression issues, powder flowability, etc.).

#### PRIMARY ACTIVE INGREDIENTS:
| Ingredient | Amount per Serving | Form/Standardization | Function | Clinical Evidence | vs #1 Rationale |
|------------|-------------------|---------------------|----------|-------------------|-----------------|
[EVERY primary active with EXACT mg/mcg/IU. For Clinical Evidence: cite the specific study (author/year, population size, dose used, outcome measured) that justifies this dose. If no human RCT exists at this dose, say so explicitly.]

#### SECONDARY ACTIVE INGREDIENTS:
| Ingredient | Amount per Serving | Form/Standardization | Function | Clinical Evidence |
|------------|-------------------|---------------------|----------|-------------------|
[ALL supporting ingredients with exact amounts and study citation per ingredient]

#### TERTIARY ACTIVES (Differentiation):
| Ingredient | Amount per Serving | Form/Standardization | Function | Clinical Evidence |
|------------|-------------------|---------------------|----------|-------------------|
[Unique differentiating ingredients with study citation per ingredient]

#### FUNCTIONAL EXCIPIENTS:
| Ingredient | Amount per Serving | Function | Grade/Spec |
|------------|-------------------|----------|------------|
[ALL inactive ingredients: base, binders, fillers, flow agents, flavors, preservatives, sweeteners]

### FORMULA SUMMARY:
| Category | Total Weight | % of Formula |
|----------|--------------|--------------|
| Primary Actives | X mg | X% |
| Secondary Actives | X mg | X% |
| Tertiary Actives | X mg | X% |
| Excipients | X mg | X% |
| TOTAL per Serving | X mg | 100% |

### Ingredient Selection Rationale:

Form Upgrades vs Competitors: [For each ingredient where we chose a superior form, state: which competitors use the inferior form, which form we chose, and the clinical/bioavailability reason]

Dose Decisions: [For each active, state: competitor dose range, clinical minimum from published research, our chosen dose, and whether we are at/above/below the clinical floor and why]

Removed / Not Included: [List any ingredients common in competitors that we excluded, and why — underdosed, label dressing, redundant function, or exceeds clinical utility]

### Clinical Citations:
For every active ingredient in the formula, provide the supporting evidence:
| Ingredient | Dose Used | Key Study | Population | Outcome | Verdict |
|------------|-----------|-----------|------------|---------|---------|
[One row per active. Verdict = SUPPORTED / UNDERPOWERED / NO HUMAN RCT — be honest if evidence is weak]

Consumer Pain Point Solutions:
| Complaint | Frequency | Our Solution |
|-----------|-----------|--------------|
[Address each major complaint via excipient/form/dose — not by adding more actives]

Synergistic Combinations: [Key ingredient pairs that enhance efficacy]

### Manufacturability Checklist:
| Check | Status | Notes |
|-------|--------|-------|
| Active load per unit (mg) | PASS / FAIL | [Total actives ÷ units per serving = X mg/unit vs. limit] |
| Heat-sensitive ingredients | PASS / FLAG | [List any flagged + mitigation] |
| pH-sensitive ingredients | PASS / FLAG | [List any flagged + mitigation] |
| Taste/bitterness conflicts | PASS / FLAG | [List any flagged + masking strategy] |
| Hygroscopic ingredients | PASS / FLAG | [List any flagged + form recommendation] |
| Ingredient incompatibilities | PASS / FLAG | [List any absorption conflicts + resolution] |

---

## 3. PHYSICAL SPECIFICATIONS

| Parameter | Specification |
|-----------|---------------|
| Dosage Form | [Soft chew/Tablet/Capsule/Gummy/Powder] |
| Shape | [Description] |
| Dimensions | [L x W x H Â± tolerance] |
| Individual Unit Weight | [X mg Â± X%] |
| Serving Size | [X units] |
| Servings Per Container | [90/120/etc.] |
| Net Weight Per Container | [X g / X oz] |

### Organoleptic Targets:
| Property | Target Specification |
|----------|---------------------|
| Color | [Description with acceptable range] |
| Odor | [Characteristic description] |
| Taste | [REQUIRED: Specific flavor name + masking strategy for ashwagandha bitterness] |
| Sweetener System | [Type + amount - sugar-free preferred; use stevia/monk fruit/erythritol blend] |
| Flavor Masking | [How to neutralize earthy/bitter ashwagandha notes] |
| Texture | [Description] |
| Hardness | [X-X Newtons or Shore A] |
| Water Activity (Aw) | [X.XX - X.XX] |
| Moisture Content | [X.X - X.X %] |

---

## 4. RAW MATERIAL REQUIREMENTS

### Active Ingredient Specifications:
| Ingredient | Purity/Assay | Source/Form | Key Specs | Heavy Metals |
|------------|--------------|-------------|-----------|--------------|
[EVERY active ingredient with minimum purity, form requirements, and limits]

### Excipient Specifications:
| Ingredient | Grade | Key Requirements |
|------------|-------|------------------|
[ALL excipients with grade and critical specs]

---

## 5. FINISHED PRODUCT SPECIFICATIONS

### Potency Targets:
| Ingredient | Label Claim | Acceptable Range |
|------------|-------------|------------------|
[EVERY active - typically 90-110% of label]

### Physical Tests:
| Test | Specification |
|------|---------------|
| Unit Weight | X mg Â± X% |
| Weight Uniformity (RSD) | â‰¤X% |
| Hardness | X-X N |
| Moisture | X.X-X.X% |
| Water Activity | X.XX-X.XX |

### Microbiological Limits:
| Test | Specification |
|------|---------------|
| Total Aerobic Count | â‰¤10,000 CFU/g |
| Yeast & Mold | â‰¤1,000 CFU/g |
| Coliforms | â‰¤100 CFU/g |
| E. coli | Negative/10g |
| Salmonella | Negative/25g |
| S. aureus | Negative/10g |

### Heavy Metals Limits:
| Metal | Limit |
|-------|-------|
| Lead (Pb) | â‰¤0.5 ppm |
| Cadmium (Cd) | â‰¤0.3 ppm |
| Mercury (Hg) | â‰¤0.1 ppm |
| Arsenic (As) | â‰¤1.0 ppm |

---

## 6. STABILITY & OVERAGE

Target Shelf Life: 24 months at room temperature (below 25Â°C/77Â°F)

### Overage Requirements:
| Ingredient | Label Claim | Overage % | Manufacturing Target | Reason |
|------------|-------------|-----------|---------------------|--------|
[Vitamins, probiotics, omega-3s, and other degradable ingredients]

---

## 7. PACKAGING SPECIFICATIONS

| Component | Specification |
|-----------|---------------|
| Container Type | [Bottle/Jar/Pouch] |
| Material | [HDPE/PET/Glass] |
| Capacity | [X mL / X oz] |
| Color | [White/Amber/Clear] |
| Closure | [CRC/Non-CRC, material] |
| Liner/Seal | [Induction seal, pressure seal, etc.] |
| Desiccant | [Type, size - e.g., 2g silica gel canister] |
| Count Per Container | [90/120/150] |

---

## 8. ALLERGEN & DIETARY STATUS

### Allergen Declaration:
CONTAINS: [List all allergens - shellfish, fish, milk, soy, tree nuts, etc.]
FREE FROM: [Gluten, wheat, corn, artificial colors, artificial flavors, etc.]

### Dietary Certifications:
| Claim | Status | Notes |
|-------|--------|-------|
| Vegetarian | Yes/No | [Details] |
| Vegan | Yes/No | [Details] |
| Non-GMO | Yes/No | [Ingredient requirements] |
| Gluten-Free | Yes/No | [<20 ppm target] |
| Kosher | Possible/No | [Requirements] |
| Halal | Possible/No | [Requirements] |

---

## 9. LABEL CONTENT

### Supplement Facts Panel:

[Complete Supplement Facts panel with all nutrients, amounts, %DV]
[Other Ingredients list in descending order]
[Allergen statement]

### Directions for Use:
[Complete dosing instructions by weight/age if applicable]

### Warnings:
[All required warning statements]

### Suggested Claims:
- [Structure/function claim 1]
- [Structure/function claim 2]
- [Structure/function claim 3]

---

## 10. SUGGESTED VARIANT LINEUP

Based on competitor gaps and popular demand, suggest 3 distinct variants for this product line:

| Variant | Flavor Profile | Target Audience | Rationale |
|---------|---------------|-----------------|-----------|
| Hero SKU | [Best-selling flavor profile] | [Mass Market] | [Why this flavor wins] |
| Variant 2 | [Alternative flavor] | [Secondary segment] | [Fills a gap/Differentiation] |
| Variant 3 | [Unique/Unflavored] | [Specific need] | [Captures missed audience] |

---

END OF FORMULA SPECIFICATION

---

## OUTPUT REQUIREMENTS:

âœ… MUST INCLUDE:
- Complete Executive Summary
- ALL ingredient tables with EVERY ingredient (no "etc." or abbreviations)
- EXACT amounts for every ingredient (mg, mcg, IU, CFU)
- Complete raw material specifications
- Complete finished product specifications
- Complete Supplement Facts Panel
- Complete Directions for Use
- All Warning Statements
- Complete Variant Lineup (Section 10)

âŒ DO NOT INCLUDE:
- Manufacturing process steps (CMO has their own)
- Equipment lists (CMO has their own)
- Detailed SOPs or CCPs
- Cost estimations (CMO provides quote)
- Batch documentation requirements
- QC flow charts
- Supplier qualification procedures
- CAPA procedures

Target Length: 3,000-4,000 words (focused on FORMULA, not process)`;
}

// â"€â"€â"€ Save to DB â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

async function saveToDB(categoryId, grokBrief, claudeBrief, marketData) {
  // Preserve market_intelligence before delete (it gets wiped otherwise)
  const { data: existingFB } = await DASH.from('formula_briefs').select('ingredients').eq('category_id', categoryId).limit(1).maybeSingle();
  const preservedMarketIntel = existingFB?.ingredients?.market_intelligence || null;

  // Delete existing brief for this category
  await DASH.from('formula_briefs').delete().eq('category_id', categoryId);

  const leader = marketData.category_summary.top_performers[0];
  const primaryBrief = grokBrief || claudeBrief; // Grok is primary; fallback to Claude

  const { error } = await DASH.from('formula_briefs').insert({
    category_id: categoryId,
    positioning: `Dual AI formula brief for ${KEYWORD} - Grok 4.2 + Claude Sonnet 4.6 vs ${marketData.category_summary.total_products} products`,
    target_customer: `Adults seeking ${KEYWORD} supplementation`,
    form_type: 'gummy',
    form_rationale: 'Category leader uses gummy format',
    flavor_profile: 'See variant lineup in brief',
    flavor_importance: 'high',
    flavor_development_needed: true,
    servings_per_container: leader?.servings_per_container || 45,
    target_price: leader?.price ? Math.round(leader.price * 1.1 * 100) / 100 : 24.99,
    packaging_type: 'HDPE bottle, white opaque, CRC closure, induction seal',
    market_summary: {
      total_products: marketData.category_summary.total_products,
      number_one: `${leader?.brand} BSR ${leader?.bsr_current}`,
      number_one_revenue: leader?.monthly_revenue,
      avg_price: marketData.category_summary.avg_price,
      common_forms: marketData.category_summary.common_forms,
    },
    consumer_pain_points: marketData.category_summary.top_pain_points.slice(0, 8).map(p => ({
      complaint: p.keyword,
      frequency: p.mentions,
      solution: 'See AI brief',
    })),
    ingredients: {
      // Primary (Grok) - used by dashboard and backward-compat fields
      ai_generated_brief: primaryBrief,
      // Dual outputs - both stored separately for P10 QA comparison
      ai_generated_brief_grok:   grokBrief   || null,
      ai_generated_brief_claude: claudeBrief || null,
      formula_brief_model_grok:   'grok-4.20-beta-0309-reasoning',
      formula_brief_model_claude: 'anthropic/claude-sonnet-4-6',
      grok_chars:   grokBrief?.length   || 0,
      claude_chars: claudeBrief?.length || 0,
      generated_at: new Date().toISOString(),
      keyword: KEYWORD,
      market_intelligence: preservedMarketIntel, // Preserved from pre-delete
      data_sources: {
        top5_used: marketData.category_summary.top_performers.length,
        new_winners_used: marketData.formula_references.length,
        pain_points_used: marketData.category_summary.top_pain_points.length,
        ingredients_analyzed: marketData.category_summary.top_ingredients.length,
      },
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (error) throw error;
}

async function saveToVault(grokBrief, claudeBrief) {
  const fs = require('fs');
  const date = new Date().toISOString().split('T')[0];
  const dir = 'C:\\SirPercival-Vault\\07_ai-systems\\agents\\scout\\formula-briefs';
  if (grokBrief) {
    const p = `${dir}\\${date}-${KEYWORD.replace(/\s+/g, '-')}-grok42-brief.md`;
    fs.writeFileSync(p, `# P9 Formula Brief (Grok 4.2 Reasoning) - ${KEYWORD}\n**Date:** ${date}\n**Model:** grok-4.20-beta-0309-reasoning\n\n---\n\n${grokBrief}`, 'utf8');
    console.log(`\n  Grok vault: ${p}`);
  }
  if (claudeBrief) {
    const p = `${dir}\\${date}-${KEYWORD.replace(/\s+/g, '-')}-claude-opus-brief.md`;
    fs.writeFileSync(p, `# P9 Formula Brief (Claude Sonnet 4.6) - ${KEYWORD}\n**Date:** ${date}\n**Model:** anthropic/claude-sonnet-4-6\n\n---\n\n${claudeBrief}`, 'utf8');
    console.log(`  Claude vault: ${p}`);
  }
}
async function run() {
  console.log(`\n${'â•'.repeat(60)}`);
  console.log(`ðŸ§ª PHASE 8: FORMULA BRIEF â€" "${KEYWORD}"`);
  console.log(`${'â•'.repeat(60)}\n`);

  // Get category
  const cat = await resolveCategory(DASH, KEYWORD);
  console.log(`  → Resolved category (${cat.method}): "${cat.name}" (${cat.id})`);
  console.log(`Category: ${cat.name} (${cat.id})\n`);

  // Check if brief already exists WITH actual AI content (not just a market intel stub)
  if (!FORCE) {
    const { data: existing } = await DASH.from('formula_briefs')
      .select('id, created_at, ingredients')
      .eq('category_id', cat.id)
      .limit(1);
    const hasActualBrief = existing?.[0]?.ingredients?.ai_generated_brief ||
                           existing?.[0]?.ingredients?.ai_generated_brief_grok;
    if (hasActualBrief) {
      console.log(`Brief already exists with AI content (${existing[0].created_at?.split('T')[0]}). Use --force to regenerate.`);
      process.exit(0);
    }
    if (existing?.length) {
      console.log(`formula_briefs record exists but has no AI brief — regenerating...`);
    }
  }

  // 1. Compile P1-P7 data
  process.stdout.write('Compiling P1-P7 market data... ');
  const marketData = await compileMarketData(cat.id);
  const { category_summary: cs, formula_references: refs } = marketData;
  console.log(`Done`);
  console.log(`  Products: ${cs.total_products} | Top5: ${cs.top_performers.length} | New Winners: ${refs.length}`);
  console.log(`  Pain Points: ${cs.top_pain_points.length} | Ingredients tracked: ${cs.top_ingredients.length}\n`);

  // 2. Build prompt
  process.stdout.write('Building prompt... ');
  const prompt = buildPrompt(marketData);
  console.log(`Done (${Math.round(prompt.length / 1000)}k chars)\n`);

  // 3. Run DUAL formulation in parallel - Grok 4.2 Deep Reasoning + Claude Sonnet 4.6
  console.log("Running dual AI formulation in parallel...");
  console.log("  [Grok]   grok-4.20-beta-0309-reasoning - deep scientific thinking");
  console.log("  [Claude] anthropic/claude-sonnet-4-6 via OpenRouter - 1M context synthesis\n");

  const [grokResult, claudeResult] = await Promise.allSettled([
    callGrok42(prompt),
    callClaudeSonnet(prompt),
  ]);

  const grokBrief  = grokResult.status  === "fulfilled" ? grokResult.value  : null;
  const claudeBrief = claudeResult.status === "fulfilled" ? claudeResult.value : null;

  if (grokResult.status === "rejected")   console.error("  WARNING: Grok 4.2 failed:", grokResult.reason?.message);
  if (claudeResult.status === "rejected") console.error("  WARNING: Claude Opus failed:", claudeResult.reason?.message);
  if (!grokBrief && !claudeBrief) throw new Error("Both AI models failed - no formula output");

  console.log("\nDual formulation complete:");
  console.log(`  Grok 4.2 Reasoning:  ${grokBrief  ? Math.round(grokBrief.length/1000)+"k chars OK" : "FAILED"}`);
  console.log(`  Claude Sonnet 4.6:     ${claudeBrief ? Math.round(claudeBrief.length/1000)+"k chars OK" : "FAILED"}\n`);

  // 4. Save to Supabase - both outputs
  process.stdout.write("Saving both briefs to formula_briefs table... ");
  await saveToDB(cat.id, grokBrief, claudeBrief, marketData);
  console.log("Done\n");

  // 5. Save to vault - both outputs
  process.stdout.write("Saving to vault... ");
  await saveToVault(grokBrief, claudeBrief);
  console.log("Done\n");

  // 6. Previews
  if (grokBrief) {
    console.log("=== GROK 4.2 PREVIEW (first 400 chars) ===");
    console.log(grokBrief.substring(0, 400));
  }
  if (claudeBrief) {
    console.log("\n=== CLAUDE OPUS 4.6 PREVIEW (first 400 chars) ===");
    console.log(claudeBrief.substring(0, 400));
  }
  const total = (grokBrief?.length||0) + (claudeBrief?.length||0);
  console.log(`\nComplete - ${Math.round(total/1000)}k chars total (both briefs) saved to Supabase + vault`);
  console.log("Next: run phase9-formula-qa.js --keyword to compare and adjudicate final formula.");
}

run().catch(e => {
  console.error('\nFAILED:', e.message);
  process.exit(1);
});
