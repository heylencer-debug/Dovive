/**
 * phase6-market-analysis.js
 * P6: MARKET ANALYSIS — single AI-generated market intelligence report
 *
 * Aggregates ALL product data (159 products) into one comprehensive market
 * intelligence document using Grok AI. This is the strategic foundation for P8.
 *
 * Feeds into P8:
 *  - Full market landscape overview
 *  - Price tier distribution and white space
 *  - BSR velocity leaders (rising stars)
 *  - Formula quality distribution
 *  - Ingredient frequency and emerging combos
 *  - Consumer pain points (from P3 reviews)
 *  - Market gaps and opportunities
 *
 * Output saved to:
 *  - Supabase: market_intelligence table
 *  - Vault: C:\SirPercival-Vault\07_ai-systems\agents\scout\market-analysis\
 *
 * Usage:
 *   node phase6-market-analysis.js
 *   node phase6-market-analysis.js --force   # regenerate existing
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEwNDU2NDUsImV4cCI6MjA3NjYyMTY0NX0.VziSAuTdqcteRERIPCdrMy4vqQuHjeC3tvazE0E8nMM'
);

const CAT_ID   = '820537da-3994-4a11-a2e0-a636d751b26f';
const CAT_NAME = 'Ashwagandha Gummies';
const FORCE    = process.argv.includes('--force');

// ─── xAI Key ─────────────────────────────────────────────────────────────────

function getXaiKey() {
  const sterlingEnv = path.join(__dirname, '../../sterling/.env');
  if (fs.existsSync(sterlingEnv)) {
    const content = fs.readFileSync(sterlingEnv, 'utf8');
    const match = content.match(/XAI_API_KEY\s*=\s*(.+)/);
    if (match) return match[1].trim();
  }
  return process.env.XAI_API_KEY || null;
}

async function callGrok(prompt, maxTokens = 8000) {
  const key = getXaiKey();
  if (!key) throw new Error('No xAI key found. Check sterling/.env');
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

// ─── Data aggregation ─────────────────────────────────────────────────────────

function aggregateMarketData(products) {
  const total = products.length;

  // ── Price analysis ──
  const prices = products.map(p => parseFloat(p.price || 0)).filter(Boolean).sort((a,b)=>a-b);
  const medianPrice = prices[Math.floor(prices.length/2)];
  const avgPrice = prices.reduce((a,b)=>a+b,0)/prices.length;
  const priceTiers = { budget: 0, value: 0, mid_market: 0, above_average: 0, premium: 0 };
  prices.forEach(p => {
    const r = p/medianPrice;
    if (r >= 1.5) priceTiers.premium++;
    else if (r >= 1.15) priceTiers.above_average++;
    else if (r >= 0.85) priceTiers.mid_market++;
    else if (r >= 0.60) priceTiers.value++;
    else priceTiers.budget++;
  });

  // ── BSR analysis ──
  const bsrs = products.map(p=>p.bsr_current).filter(Boolean).sort((a,b)=>a-b);
  const top20ByBSR = products.filter(p=>p.bsr_current).sort((a,b)=>a.bsr_current-b.bsr_current).slice(0,20);

  // ── BSR velocity (rising stars) ──
  const velocityProducts = products
    .filter(p => p.bsr_current && p.bsr_30_days_avg && p.bsr_90_days_avg)
    .map(p => {
      const vs90d = Math.round(((p.bsr_90_days_avg - p.bsr_current) / p.bsr_90_days_avg) * 100);
      return { ...p, velocity_score: vs90d };
    })
    .sort((a,b) => b.velocity_score - a.velocity_score);
  const risingStars = velocityProducts.slice(0, 10);
  const sinkingProducts = velocityProducts.slice(-10).reverse();

  // ── Revenue analysis ──
  const revenues = products.map(p=>p.monthly_revenue||0).filter(Boolean).sort((a,b)=>b-a);
  const totalMarketRevenue = revenues.reduce((a,b)=>a+b,0);
  const top5Revenue = products.sort((a,b)=>(b.monthly_revenue||0)-(a.monthly_revenue||0)).slice(0,5);

  // ── Per-product intelligence (from P4b formula extraction) ──
  const withIntel = products.filter(p=>p.marketing_analysis?.product_intelligence);
  const intel = withIntel.map(p=>p.marketing_analysis.product_intelligence);

  // Extract type distribution
  const extractDist = {};
  intel.forEach(i => {
    const et = i.ashwagandha_extract_type || 'Unknown';
    extractDist[et] = (extractDist[et]||0)+1;
  });

  // Dosage distribution
  const doses = intel.map(i=>i.ashwagandha_amount_mg).filter(Boolean);
  const avgDose = doses.length ? Math.round(doses.reduce((a,b)=>a+b,0)/doses.length) : null;
  const doseRanges = {
    'Under 200mg': doses.filter(d=>d<200).length,
    '200-399mg':   doses.filter(d=>d>=200&&d<400).length,
    '400-599mg':   doses.filter(d=>d>=400&&d<600).length,
    '600-999mg':   doses.filter(d=>d>=600&&d<1000).length,
    '1000mg+':     doses.filter(d=>d>=1000).length,
    'Not listed':  intel.length - doses.length,
  };

  // Certification distribution
  const certCounts = {};
  intel.forEach(i => (i.certifications||[]).forEach(c => { certCounts[c]=(certCounts[c]||0)+1; }));

  // Bonus ingredient frequency
  const bonusCounts = {};
  intel.forEach(i => (i.bonus_ingredients||[]).forEach(b => { bonusCounts[b]=(bonusCounts[b]||0)+1; }));
  const topBonusIngredients = Object.entries(bonusCounts).sort((a,b)=>b[1]-a[1]).slice(0,20);

  // Formula quality distribution
  const formulaScores = intel.map(i=>i.formula_quality_score).filter(Boolean);
  const avgFormulaScore = formulaScores.length ? (formulaScores.reduce((a,b)=>a+b,0)/formulaScores.length).toFixed(1) : null;
  const highQuality = intel.filter(i=>i.formula_quality_score>=7).length;
  const lowQuality  = intel.filter(i=>i.formula_quality_score<=4).length;

  // Threat levels
  const threatDist = { 'Very High':0, 'High':0, 'Medium':0, 'Low':0 };
  intel.forEach(i => { if(i.competitor_threat_level) threatDist[i.competitor_threat_level]++; });

  // Price positioning
  const priceTierDist = { premium:0, above_average:0, mid_market:0, value:0, budget:0, unknown:0 };
  intel.forEach(i => { if(i.price_positioning_tier) priceTierDist[i.price_positioning_tier]++; });

  // Market opportunity gaps (aggregate from per-product)
  const opportunityGaps = intel
    .map(i=>i.market_opportunity_gap)
    .filter(Boolean)
    .slice(0,30);

  // Sugar-free / vegan / 3rd-party stats
  const sugarFree     = intel.filter(i=>i.is_sugar_free).length;
  const vegan         = intel.filter(i=>i.is_vegan).length;
  const thirdParty    = intel.filter(i=>i.is_third_party_tested).length;
  const artificialCol = intel.filter(i=>i.artificial_colors).length;

  // ── Review pain points (P3) ──
  const withReviews = products.filter(p=>p.review_analysis?.pain_points||p.review_analysis?.top_complaints);
  const painPoints = [];
  withReviews.forEach(p => {
    const ra = p.review_analysis;
    if (ra?.pain_points) painPoints.push(...(Array.isArray(ra.pain_points) ? ra.pain_points : [ra.pain_points]));
    if (ra?.top_complaints) painPoints.push(...(Array.isArray(ra.top_complaints) ? ra.top_complaints : [ra.top_complaints]));
  });

  // ── Top competitor detailed formulas (P8 input) ──
  const topCompetitorFormulas = top20ByBSR.map(p => {
    const pi = p.marketing_analysis?.product_intelligence || {};
    return {
      rank: top20ByBSR.indexOf(p)+1,
      brand: p.brand || 'Unknown',
      title: (p.title||'').substring(0,80),
      asin: p.asin,
      bsr: p.bsr_current,
      monthly_revenue: p.monthly_revenue,
      monthly_sales: p.monthly_sales,
      price: p.price,
      rating: p.rating_value,
      review_count: p.rating_count,
      // Formula details
      ashwagandha_mg: pi.ashwagandha_amount_mg,
      extract_type: pi.ashwagandha_extract_type,
      withanolides: pi.withanolide_percentage,
      bonus_ingredients: pi.bonus_ingredients,
      certifications: pi.certifications,
      is_sugar_free: pi.is_sugar_free,
      is_vegan: pi.is_vegan,
      is_third_party_tested: pi.is_third_party_tested,
      formula_score: pi.formula_quality_score,
      threat_level: pi.competitor_threat_level,
      key_strengths: pi.key_strengths,
      key_weaknesses: pi.key_weaknesses,
      market_opportunity_gap: pi.market_opportunity_gap,
      bsr_trend: pi.bsr_trend_label,
      price_tier: pi.price_positioning_label,
      revenue_per_review: pi.revenue_per_review,
      supplement_facts_raw: (p.supplement_facts_raw||'').substring(0,600),
    };
  });

  return {
    meta: { total, withIntel: withIntel.length, withReviews: withReviews.length, generated_at: new Date().toISOString() },
    market_size: { total_products: total, total_monthly_revenue: totalMarketRevenue, avg_monthly_revenue: Math.round(totalMarketRevenue/total) },
    pricing: { median: medianPrice, avg: Math.round(avgPrice*100)/100, min: prices[0], max: prices[prices.length-1], tiers: priceTiers },
    bsr: { top_bsr: bsrs[0], median_bsr: bsrs[Math.floor(bsrs.length/2)], total_ranked: bsrs.length },
    rising_stars: risingStars.map(p=>({ brand:p.brand, title:(p.title||'').substring(0,60), bsr:p.bsr_current, velocity_score:p.velocity_score, monthly_revenue:p.monthly_revenue })),
    sinking_products: sinkingProducts.map(p=>({ brand:p.brand, bsr:p.bsr_current, velocity_score:p.velocity_score })),
    top5_by_revenue: top5Revenue.map(p=>({ brand:p.brand, title:(p.title||'').substring(0,60), asin:p.asin, bsr:p.bsr_current, monthly_revenue:p.monthly_revenue, price:p.price, rating:p.rating_value })),
    formula_landscape: {
      extract_type_distribution: extractDist,
      avg_ashwagandha_dose_mg: avgDose,
      dose_ranges: doseRanges,
      avg_formula_quality_score: avgFormulaScore,
      high_quality_formulas: highQuality,
      low_quality_formulas: lowQuality,
      pct_sugar_free: Math.round(sugarFree/total*100),
      pct_vegan: Math.round(vegan/total*100),
      pct_third_party_tested: Math.round(thirdParty/total*100),
      pct_artificial_colors: Math.round(artificialCol/total*100),
    },
    certifications: certCounts,
    top_bonus_ingredients: topBonusIngredients,
    threat_distribution: threatDist,
    price_positioning: priceTierDist,
    consumer_pain_points: painPoints.slice(0, 40),
    market_opportunity_gaps: opportunityGaps,
    top20_competitor_formulas: topCompetitorFormulas,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n${'═'.repeat(62)}`);
  console.log(`P6: MARKET ANALYSIS — ${CAT_NAME}`);
  console.log(`${'═'.repeat(62)}\n`);

  // Check if already done
  if (!FORCE) {
    const { data: existing } = await DASH.from('market_intelligence')
      .select('id, generated_at')
      .eq('category_id', CAT_ID)
      .order('generated_at', { ascending: false })
      .limit(1);
    if (existing?.length) {
      console.log(`⚠️  Already exists (${existing[0].generated_at}). Use --force to regenerate.`);
      return;
    }
  }

  // Fetch all products with all fields
  console.log('Fetching all product data...');
  const { data: products, error } = await DASH.from('products')
    .select(`asin, brand, title, bsr_current, bsr_30_days_avg, bsr_90_days_avg,
             price, monthly_revenue, monthly_sales, rating_value, rating_count,
             supplement_facts_raw, review_analysis, marketing_analysis`)
    .eq('category_id', CAT_ID)
    .order('bsr_current', { ascending: true, nullsFirst: false });
  if (error) throw error;
  console.log(`  Loaded ${products.length} products`);

  // Aggregate data
  console.log('Aggregating market data...');
  const aggregated = aggregateMarketData(products);
  console.log(`  Extract types: ${Object.keys(aggregated.formula_landscape.extract_type_distribution).length}`);
  console.log(`  Bonus ingredients tracked: ${aggregated.top_bonus_ingredients.length}`);
  console.log(`  Pain points: ${aggregated.consumer_pain_points.length}`);
  console.log(`  Market opportunity gaps: ${aggregated.market_opportunity_gaps.length}`);
  console.log(`  Top 20 competitor formulas: ${aggregated.top20_competitor_formulas.length}`);

  // Build Grok prompt
  console.log('\nBuilding market analysis prompt...');

  const competitorFormulasText = aggregated.top20_competitor_formulas.map(c => `
#${c.rank} ${c.brand} — BSR ${c.bsr?.toLocaleString()}
  Revenue: $${c.monthly_revenue?.toLocaleString()}/mo | Price: $${c.price} | Rating: ${c.rating}⭐ (${c.review_count?.toLocaleString()} reviews)
  Formula: ${c.ashwagandha_mg||'?'}mg ${c.extract_type||'Unknown'} ${c.withanolides?`(${c.withanolides} withanolides)`:''}
  Bonus: ${(c.bonus_ingredients||[]).join(', ')||'None'}
  Certs: ${(c.certifications||[]).join(', ')||'None'} | Sugar-Free: ${c.is_sugar_free} | Vegan: ${c.is_vegan} | 3rd Party: ${c.is_third_party_tested}
  Formula Score: ${c.formula_score}/10 | Threat: ${c.threat_level} | BSR Trend: ${c.bsr_trend}
  Price Tier: ${c.price_tier} | Revenue/Review: $${c.revenue_per_review}/review
  Strengths: ${(c.key_strengths||[]).join('; ')}
  Weaknesses: ${(c.key_weaknesses||[]).join('; ')}
  Opportunity Gap: ${c.market_opportunity_gap||'N/A'}
  Supplement Facts (OCR): ${c.supplement_facts_raw||'Not available'}
`).join('\n---\n');

  const prompt = `You are a senior market intelligence analyst and CMO consultant for DOVIVE, a supplement brand entering the ashwagandha gummies market on Amazon.

Analyze the complete market data below and produce a comprehensive, actionable market intelligence report. This will be used to design a winning product formula and launch strategy.

═══════════════════════════════════════
MARKET OVERVIEW — ${CAT_NAME} (Amazon US)
Generated: ${new Date().toLocaleDateString()}
═══════════════════════════════════════

MARKET SIZE
- Total products: ${aggregated.meta.total}
- Total monthly revenue: $${aggregated.market_size.total_monthly_revenue.toLocaleString()}
- Avg revenue per product: $${aggregated.market_size.avg_monthly_revenue.toLocaleString()}/mo

PRICING LANDSCAPE
- Median price: $${aggregated.pricing.median}
- Avg price: $${aggregated.pricing.avg}
- Range: $${aggregated.pricing.min} – $${aggregated.pricing.max}
- Price tier breakdown: ${JSON.stringify(aggregated.pricing.tiers)}

BSR LANDSCAPE
- #1 BSR: ${aggregated.bsr.top_bsr?.toLocaleString()}
- Median BSR: ${aggregated.bsr.median_bsr?.toLocaleString()}
- Total ranked products: ${aggregated.bsr.total_ranked}

🚀 RISING STARS (BSR velocity leaders — biggest BSR improvement vs 90 days ago):
${aggregated.rising_stars.map(r=>`  ${r.brand} — BSR ${r.bsr?.toLocaleString()} | +${r.velocity_score}% improvement | $${r.monthly_revenue?.toLocaleString()}/mo`).join('\n')}

📉 DECLINING PRODUCTS (losing rank fastest):
${aggregated.sinking_products.map(s=>`  ${s.brand} — BSR ${s.bsr?.toLocaleString()} | ${s.velocity_score}% change`).join('\n')}

TOP 5 BY REVENUE:
${aggregated.top5_by_revenue.map(t=>`  ${t.brand} — $${t.monthly_revenue?.toLocaleString()}/mo | BSR ${t.bsr?.toLocaleString()} | $${t.price} | ${t.rating}⭐`).join('\n')}

FORMULA LANDSCAPE
- Extract type distribution: ${JSON.stringify(aggregated.formula_landscape.extract_type_distribution)}
- Average ashwagandha dose: ${aggregated.formula_landscape.avg_ashwagandha_dose_mg}mg
- Dose range distribution: ${JSON.stringify(aggregated.formula_landscape.dose_ranges)}
- Avg formula quality score: ${aggregated.formula_landscape.avg_formula_quality_score}/10
- High quality formulas (≥7/10): ${aggregated.formula_landscape.high_quality_formulas}
- Low quality formulas (≤4/10): ${aggregated.formula_landscape.low_quality_formulas}
- % Sugar-free: ${aggregated.formula_landscape.pct_sugar_free}%
- % Vegan: ${aggregated.formula_landscape.pct_vegan}%
- % 3rd party tested: ${aggregated.formula_landscape.pct_third_party_tested}%
- % Uses artificial colors: ${aggregated.formula_landscape.pct_artificial_colors}%

CERTIFICATION DISTRIBUTION: ${JSON.stringify(aggregated.certifications)}

TOP BONUS INGREDIENTS (by frequency across all products):
${aggregated.top_bonus_ingredients.map(([name,count])=>`  ${name}: ${count} products (${Math.round(count/aggregated.meta.total*100)}%)`).join('\n')}

PRICE POSITIONING DISTRIBUTION: ${JSON.stringify(aggregated.price_positioning)}
THREAT LEVEL DISTRIBUTION: ${JSON.stringify(aggregated.threat_distribution)}

CONSUMER PAIN POINTS (from ${aggregated.meta.withReviews} products with review data):
${aggregated.consumer_pain_points.slice(0,20).map((p,i)=>`  ${i+1}. ${p}`).join('\n') || '  No review data available yet'}

MARKET OPPORTUNITY GAPS (AI-identified per product, aggregated):
${aggregated.market_opportunity_gaps.slice(0,15).map((g,i)=>`  ${i+1}. ${g}`).join('\n')}

═══════════════════════════════════════
TOP 20 COMPETITOR FORMULAS (detailed)
═══════════════════════════════════════
${competitorFormulasText}

═══════════════════════════════════════
YOUR TASK — MARKET INTELLIGENCE REPORT
═══════════════════════════════════════

Write a comprehensive market intelligence report structured as follows:

## 1. MARKET SNAPSHOT
Key metrics, total market size, competitive intensity, category maturity assessment.

## 2. COMPETITIVE LANDSCAPE
Who owns the market? BSR leaders, revenue concentration, brand dominance patterns. Which brands are rising vs declining and why.

## 3. FORMULA LANDSCAPE ANALYSIS
What formulas dominate? Extract type wars (KSM-66 vs generic), dosage patterns, the quality gap (most products are low-quality — is this the opportunity?). What does a winning formula look like vs a losing one?

## 4. PRICING & POSITIONING MAP
Price tier breakdown. Where is the white space? Premium vs budget dynamics. Best price/value positioning for a new entrant.

## 5. CONSUMER DEMAND SIGNALS
Based on pain points, review patterns, and rising stars — what are consumers ACTUALLY buying and why? What are they complaining about? What unmet needs exist?

## 6. INGREDIENT TREND ANALYSIS
Which bonus ingredients are appearing in winning products? Which are overused (saturated)? Which are emerging (opportunity)? What combinations are working?

## 7. MARKET ENTRY OPPORTUNITIES
Specific white space: formula quality gap, price positioning gap, certification gap, ingredient combo gap. Where can DOVIVE enter and WIN?

## 8. COMPETITIVE THREATS
Top 5 most dangerous competitors with specific reasons. What makes each hard to beat? What would neutralize them?

## 9. STRATEGIC RECOMMENDATIONS FOR DOVIVE
Specific actionable recommendations:
  - Target BSR range to be competitive
  - Optimal price point and positioning
  - Must-have formula features
  - Differentiators to pursue
  - What to absolutely avoid

## 10. KEY NUMBERS TO REMEMBER
A quick-reference table of the most important market facts for formula development.

Write with precision and specificity. Use actual numbers, brand names, and percentages. This is an internal strategic document — be direct, not diplomatic. Identify winners and losers clearly.`;

  console.log(`Prompt: ${(prompt.length/1000).toFixed(1)}k chars`);

  // Call Grok
  console.log('\nCalling Grok AI (grok-3)...');
  const startTime = Date.now();
  const report = await callGrok(prompt, 8000);
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`  Done (${elapsed}s, ${report.length.toLocaleString()} chars)`);

  // Save to Supabase market_intelligence table
  console.log('\nSaving to Supabase...');
  const record = {
    category_id: CAT_ID,
    category_name: CAT_NAME,
    generated_at: new Date().toISOString(),
    aggregated_data: aggregated,
    ai_market_analysis: report,
    meta: {
      products_analyzed: aggregated.meta.total,
      with_formula_data: aggregated.meta.withIntel,
      with_review_data: aggregated.meta.withReviews,
      grok_model: 'grok-3',
      elapsed_seconds: elapsed,
      report_chars: report.length,
    }
  };

  // Upsert into market_intelligence
  const { error: saveErr } = await DASH.from('market_intelligence')
    .upsert(record, { onConflict: 'category_id' });

  if (saveErr) {
    if (saveErr.message?.includes('relation "market_intelligence" does not exist')) {
      // Table doesn't exist — save to formula_briefs with type tag instead
      console.log('  market_intelligence table not found — saving to formula_briefs (type: market_analysis)...');
      const { error: fbErr } = await DASH.from('formula_briefs')
        .upsert({
          category_id: CAT_ID,
          category_name: CAT_NAME,
          ingredients: { type: 'market_analysis', ai_generated_brief: report, aggregated_data: aggregated },
          generated_at: new Date().toISOString(),
        }, { onConflict: 'category_id' });
      if (fbErr) throw fbErr;
      console.log('  Saved to formula_briefs table');
    } else {
      throw saveErr;
    }
  } else {
    console.log('  Saved to market_intelligence table');
  }

  // Save to vault
  console.log('\nSaving to vault...');
  const today = new Date().toISOString().split('T')[0];
  const vaultDir = 'C:\\SirPercival-Vault\\07_ai-systems\\agents\\scout\\market-analysis';
  const vaultFile = path.join(vaultDir, `${today}-${CAT_NAME.toLowerCase().replace(/\s+/g,'-')}-market-analysis.md`);
  if (!fs.existsSync(vaultDir)) fs.mkdirSync(vaultDir, { recursive: true });

  const vaultContent = `# Market Analysis: ${CAT_NAME}
Generated: ${new Date().toISOString()}
Products Analyzed: ${aggregated.meta.total}
Grok Model: grok-3

---

${report}

---

## Raw Aggregated Data
\`\`\`json
${JSON.stringify({ meta: aggregated.meta, market_size: aggregated.market_size, pricing: aggregated.pricing, formula_landscape: aggregated.formula_landscape, top_bonus_ingredients: aggregated.top_bonus_ingredients }, null, 2)}
\`\`\`
`;
  fs.writeFileSync(vaultFile, vaultContent, 'utf8');
  console.log(`  Saved: ${vaultFile}`);

  // Preview
  console.log(`\n${'═'.repeat(62)}`);
  console.log('MARKET ANALYSIS PREVIEW (first 600 chars)');
  console.log('═'.repeat(62));
  console.log(report.substring(0, 600));
  console.log('\n...\n');
  console.log('═'.repeat(62));
  console.log('P6 MARKET ANALYSIS COMPLETE');
  console.log(`Report: ${report.length.toLocaleString()} chars | Products: ${aggregated.meta.total} | Time: ${elapsed}s`);
}

run().catch(e => { console.error('\n❌ FAILED:', e.message); process.exit(1); });
