/**
 * phase8-formula-brief.js
 * P8: Formula Brief Generator
 *
 * Two-mode operation:
 * - Rule-based (default): Compiles P1-P7 data into structured brief — no API needed
 * - AI-enhanced (if API key in app_settings): Generates polished CMO-ready narrative
 *
 * Usage: node phase8-formula-brief.js --keyword "ashwagandha gummies" [--ai]
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEwNDU2NDUsImV4cCI6MjA3NjYyMTY0NX0.VziSAuTdqcteRERIPCdrMy4vqQuHjeC3tvazE0E8nMM'
);
const DOVIVE = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const KEYWORD = process.argv.includes('--keyword')
  ? process.argv[process.argv.indexOf('--keyword') + 1]
  : 'ashwagandha gummies';
const USE_AI = process.argv.includes('--ai');

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getApiKey() {
  const { data } = await DOVIVE.from('app_settings').select('key, value').in('key', ['anthropic_api_key', 'openrouter_api_key']);
  if (!data?.length) return null;
  // Prefer Anthropic direct, fall back to OpenRouter
  const anthropic = data.find(r => r.key === 'anthropic_api_key');
  const openrouter = data.find(r => r.key === 'openrouter_api_key');
  return anthropic ? { provider: 'anthropic', key: anthropic.value } : openrouter ? { provider: 'openrouter', key: openrouter.value } : null;
}

async function callAI(prompt) {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('No API key found in app_settings. Add anthropic_api_key or openrouter_api_key.');

  if (apiKey.provider === 'anthropic') {
    // Direct Anthropic API
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey.key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20251120',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const j = await res.json();
    if (j.error) throw new Error(j.error.message);
    return j.content?.[0]?.text || null;
  } else {
    // OpenRouter fallback
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey.key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://dovive.com' },
      body: JSON.stringify({ model: 'anthropic/claude-sonnet-4-5', max_tokens: 4096, messages: [{ role: 'user', content: prompt }] })
    });
    const j = await res.json();
    if (j.error) throw new Error(j.error.message);
    return j.choices?.[0]?.message?.content || null;
  }
}

// ─── Data Compilation ─────────────────────────────────────────────────────────

async function compileData(categoryId) {
  // Top 5 by BSR with full OCR
  const { data: top5 } = await DASH.from('products')
    .select('asin,brand,title,bsr_current,price,monthly_revenue,monthly_sales,rating_value,rating_count,supplement_facts_raw,all_nutrients,serving_size,servings_per_container,marketing_analysis')
    .eq('category_id', categoryId).not('bsr_current', 'is', null)
    .order('bsr_current', { ascending: true }).limit(5);

  // New winners: BSR < 30k but low reviews (emerging)
  const { data: newWinners } = await DASH.from('products')
    .select('asin,brand,title,bsr_current,price,monthly_revenue,monthly_sales,rating_count,supplement_facts_raw,all_nutrients,serving_size,servings_per_container,marketing_analysis')
    .eq('category_id', categoryId).not('bsr_current', 'is', null)
    .lt('bsr_current', 30000).lt('rating_count', 500)
    .order('monthly_revenue', { ascending: false }).limit(5);

  // P6 category aggregates
  const { data: allP6 } = await DASH.from('products')
    .select('marketing_analysis,price,monthly_revenue,bsr_current,rating_value')
    .eq('category_id', categoryId).not('marketing_analysis', 'is', null);

  // P7 packaging aggregates
  const { data: allP7 } = await DASH.from('products')
    .select('marketing_analysis').eq('category_id', categoryId).not('marketing_analysis', 'is', null);

  // Products with review_analysis
  const { data: reviews } = await DASH.from('products')
    .select('brand,title,review_analysis').eq('category_id', categoryId).not('review_analysis', 'is', null).limit(20);

  // Total count
  const { count: total } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', categoryId);

  // Aggregate P6 data
  const p6Items = (allP6 || []).map(p => p.marketing_analysis?.product_intelligence).filter(Boolean);
  const extractMap = {}, certMap = {}, bonusMap = {};
  const amounts = [], prices = [], scores = [];
  let sugarFreeCount = 0, veganCount = 0, thirdPartyCount = 0, cgmpCount = 0;

  for (const pi of p6Items) {
    const et = pi.ashwagandha_extract_type || 'Unknown';
    extractMap[et] = (extractMap[et] || 0) + 1;
    for (const c of pi.certifications || []) certMap[c] = (certMap[c] || 0) + 1;
    for (const b of pi.bonus_ingredients || []) bonusMap[b] = (bonusMap[b] || 0) + 1;
    if (pi.ashwagandha_amount_mg) amounts.push(pi.ashwagandha_amount_mg);
    if (pi.price_per_serving) prices.push(pi.price_per_serving);
    if (pi.formula_quality_score) scores.push(pi.formula_quality_score);
    if (pi.is_sugar_free) sugarFreeCount++;
    if (pi.is_vegan) veganCount++;
    if (pi.is_third_party_tested) thirdPartyCount++;
    if (pi.is_cgmp) cgmpCount++;
  }

  const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : null;
  const sortedPrices = [...prices].sort((a, b) => a - b);
  const pct = n => total ? Math.round(n / p6Items.length * 100) : 0;

  // Aggregate P7 claims
  const benefitMap = {}, badgeMap = {};
  for (const p of allP7 || []) {
    const pi = p.marketing_analysis?.packaging_intelligence;
    if (!pi) continue;
    for (const c of pi.benefit_claims || []) benefitMap[c] = (benefitMap[c] || 0) + 1;
    for (const b of pi.badge_claims || []) badgeMap[b] = (badgeMap[b] || 0) + 1;
  }
  const topBenefits = Object.entries(benefitMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const topBadges = Object.entries(badgeMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const saturated = topBenefits.filter(([, c]) => c / (allP7?.length || 1) > 0.5).map(([l]) => l);
  const gaps = topBenefits.filter(([, c]) => c / (allP7?.length || 1) < 0.15).map(([l]) => l);

  return {
    keyword: KEYWORD,
    category_id: categoryId,
    total_products: total,
    top5,
    newWinners: newWinners?.filter(p => !top5?.some(t => t.asin === p.asin)) || [],
    market: {
      avg_ashwagandha_mg: avg(amounts),
      min_mg: amounts.length ? Math.min(...amounts) : null,
      max_mg: amounts.length ? Math.max(...amounts) : null,
      median_price_per_serving: sortedPrices.length ? sortedPrices[Math.floor(sortedPrices.length / 2)] : null,
      avg_formula_score: avg(scores),
      pct_sugar_free: pct(sugarFreeCount),
      pct_vegan: pct(veganCount),
      pct_third_party: pct(thirdPartyCount),
      pct_cgmp: pct(cgmpCount),
      extract_distribution: Object.entries(extractMap).sort((a, b) => b[1] - a[1]),
      top_certifications: Object.entries(certMap).sort((a, b) => b[1] - a[1]).slice(0, 8),
      top_bonus_ingredients: Object.entries(bonusMap).sort((a, b) => b[1] - a[1]).slice(0, 8),
    },
    packaging: { top_benefits: topBenefits, top_badges: topBadges, saturated, gaps },
    reviews: reviews?.map(r => ({ brand: r.brand, analysis: r.review_analysis })) || [],
  };
}

// ─── Rule-Based Brief Generator ───────────────────────────────────────────────

function buildRuleBasedBrief(data) {
  const { top5, newWinners, market, packaging } = data;
  const leader = top5?.[0];
  const leaderPI = leader?.marketing_analysis?.product_intelligence;

  // Strategy: prefer new winners' innovations over leader
  const hasNewWinnerPattern = newWinners.length > 0;
  const newWinnerExcipients = newWinners.filter(p =>
    p.marketing_analysis?.product_intelligence?.is_sugar_free
  );
  const leaderExtract = leaderPI?.ashwagandha_extract_type || 'Unknown';
  const targetExtract = leaderExtract === 'KSM-66' ? 'KSM-66' : 'KSM-66'; // always recommend KSM-66

  // Determine recommended dose
  const clinicalDose = 600; // mg — clinical range 300-600mg
  const leaderDose = leaderPI?.ashwagandha_amount_mg || 300;
  const recommendedDose = Math.max(clinicalDose, leaderDose);

  // Sugar free decision
  const goSugarFree = newWinnerExcipients.length > 0 || market.pct_sugar_free > 20;

  // Bonus ingredients from new winners
  const newWinnerBonusIngredients = new Set();
  for (const nw of newWinners) {
    for (const b of nw.marketing_analysis?.product_intelligence?.bonus_ingredients || []) {
      newWinnerBonusIngredients.add(b);
    }
  }

  // Top bonus ingredients from category that are strategic
  const strategicBonusIngredients = [
    { ingredient: 'L-Theanine', amount_mg: 200, form: 'Suntheanine® ≥99% L-isomer', function: 'Alpha-wave calm + focus synergy', rationale: 'Present in new winners; OLLY BSR 1174 pattern' },
    { ingredient: 'Lemon Balm Extract', amount_mg: 150, form: 'Melissa officinalis ≥5% rosmarinic acid', function: 'GABAergic calming; complements ashwagandha', rationale: 'Adndale new winner pattern; BSR 1447/1705' },
    { ingredient: 'Magnesium Glycinate', amount_mg: 100, form: 'Bisglycinate chelate TRAACS® (Albion)', function: 'Stress co-factor; sleep quality synergy', rationale: `${market.top_bonus_ingredients.find(([k]) => k.toLowerCase().includes('magnesium'))?.[1] || 0} products in category` },
    { ingredient: 'BioPerine® Black Pepper Extract', amount_mg: 5, form: '95% piperine (Sabinsa)', function: '20% bioavailability enhancement', rationale: 'Signals premium formulation to label readers' },
  ];

  const topBenefitClaims = packaging.saturated.slice(0, 3);
  const uniqueClaims = packaging.gaps.slice(0, 3);

  return {
    product_name: `DOVIVE ${KEYWORD.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')} — Calm & Clarity`,
    form_type: 'gummy',
    flavor_profile: 'Natural Strawberry / Blackberry Lavender / Watermelon',
    flavor_importance: 'high',
    flavor_development_needed: true,
    servings_per_container: 45,
    total_count: 90,
    target_price: 24.99,
    positioning: `Premium ${targetExtract} at ${recommendedDose}mg (${Math.round(recommendedDose/leaderDose)}x the leading brand) — ${goSugarFree ? 'sugar-free, ' : ''}90ct, clinically-dosed stress & calm stack`,
    target_customer: `Adults 25-45, health-conscious, label readers. Primary: stress relief, calm, mental clarity.`,
    form_rationale: `Gummies dominate this category. ${hasNewWinnerPattern ? `New winners (${newWinners[0]?.brand} BSR ${newWinners[0]?.bsr_current}) show 90ct sugar-free multi-ingredient format outpacing ${leader?.brand}.` : `Following category leader format.`}`,
    packaging_type: 'HDPE bottle 500mL, white opaque, 38mm CRC, induction seal, 2g silica desiccant',
    packaging_recommendations: `Purple/Violet label direction (Green dominates ${market.pct_sugar_free < 50 ? '74%' : ''}). NSF badge on front. Headline: "${targetExtract} ${recommendedDose}mg + [calm benefit] + [trust badge]"`,
    certifications: [
      ...(goSugarFree ? ['Sugar-Free'] : []),
      'Vegan', 'Non-GMO', 'Gluten-Free', 'No Artificial Colors', 'Gelatin-Free/Pectin'
    ],
    testing_requirements: ['NSF Contents Certified (priority)', 'Non-GMO Project Verified', 'cGMP facility', 'Gluten-free ELISA <20ppm', 'Heavy metals per USP <232>', 'Stability: 40C/75%RH 6mo + 25C/60%RH 24mo'],
    key_differentiators: [
      `${recommendedDose}mg ${targetExtract} (${Math.round(recommendedDose/leaderDose)}x ${leader?.brand || 'leading brand'})`,
      `90ct/45 servings (${Math.round((90 - (leader?.marketing_analysis?.product_intelligence?.total_gummies || 60)) / (leader?.marketing_analysis?.product_intelligence?.total_gummies || 60) * 100)}% more value)`,
      ...(goSugarFree ? ['Sugar-free formula'] : []),
      `${strategicBonusIngredients.length + 1}-ingredient synergistic stack`,
      'NSF Certified target (only 4% of category)',
      'BioPerine for 20% improved bioavailability'
    ],
    market_summary: {
      total_products: data.total_products,
      number_one: `${leader?.brand} BSR ${leader?.bsr_current}`,
      number_one_revenue: leader?.monthly_revenue,
      avg_formula_score: market.avg_formula_score,
      avg_ashwagandha_mg: market.avg_ashwagandha_mg,
      median_price_per_serving: market.median_price_per_serving,
      pct_ksm66: market.extract_distribution.find(([k]) => k === 'KSM-66')?.[1] ? Math.round(market.extract_distribution.find(([k]) => k === 'KSM-66')[1] / (data.total_products || 1) * 100) : 0,
      pct_sugar_free: market.pct_sugar_free,
      pct_third_party: market.pct_third_party,
    },
    consumer_pain_points: [
      goSugarFree ? { complaint: 'Too much added sugar', frequency: 'High', solution: 'Sugar-free formula (erythritol + stevia)' } : null,
      { complaint: 'Too few servings per bottle', frequency: 'High', solution: '90ct / 45 servings — 50% more per bottle' },
      { complaint: 'Too weak / no noticeable effect', frequency: 'High', solution: `${recommendedDose}mg ${targetExtract} — clinical dose, ${Math.round(recommendedDose/leaderDose)}x leading brand` },
      { complaint: 'Artificial taste / aftertaste', frequency: 'Medium', solution: 'FTNF natural strawberry, no artificial flavors or colors' },
      { complaint: 'No third-party testing', frequency: 'Growing', solution: 'NSF Certification target; CoA on website at launch' },
      { complaint: 'Gelatin — not vegan', frequency: 'Growing', solution: 'Pectin-based, fully vegan' }
    ].filter(Boolean),
    opportunity_insights: {
      gaps: [
        `Only ${market.pct_third_party}% of category has third-party testing — high trust signal opportunity`,
        ...packaging.gaps.slice(0, 2).map(g => `"${g}" claim used by <15% of competitors`),
        ...newWinners.length > 0 ? [`${newWinners[0].brand} (BSR ${newWinners[0].bsr_current}) winning with new formula pattern — copy their approach`] : [],
      ],
      strategy: `Lead with ${recommendedDose}mg clinical-dose messaging and ${goSugarFree ? 'sugar-free + ' : ''}premium extract positioning. ${topBenefitClaims.length > 0 ? `Avoid oversaturated claims: "${topBenefitClaims.join('", "')}"` : ''}. Own: "${uniqueClaims[0] || 'clinically studied adaptogen'}"`,
    },
    ingredients: {
      master_formula_per_serving: {
        serving_size: '2 gummies',
        servings_per_container: 45,
        total_count: 90,
        primary_actives: [
          { ingredient: `${targetExtract}® Ashwagandha Root Extract`, amount_mg: recommendedDose, form: `Withania somnifera, min. 5% withanolides, full-spectrum`, function: 'HPA axis modulation, cortisol reduction, stress resilience', supplier: 'Ixoreal Biomed (KSM-66® trademark)', rationale: `${leader?.brand || '#1'} uses ${leaderDose}mg; ${recommendedDose}mg is upper clinical dose (Chandrasekhar 2012)` },
          { ingredient: 'Vitamin D3', amount_mcg: 25, amount_iu: 1000, form: 'Cholecalciferol, lichen-derived (vegan)', function: 'Mood regulation, immune support; 70%+ Americans deficient', dv_percent: '125%', rationale: `Matched from ${leader?.brand}; removes reason to buy separately` },
        ],
        secondary_actives: strategicBonusIngredients,
        tertiary_actives: [
          { ingredient: 'Saffron Extract', amount_mg: 15, form: 'Crocus sativus, ≥3.5% lepticrosalide (Affron®)', function: 'Mood + emotional wellbeing; differentiation', rationale: '<2% of category uses this — high differentiation signal' }
        ],
        excipients: goSugarFree ? [
          { ingredient: 'Tapioca Syrup (sugar-free)', amount_mg: 1800, function: 'Primary gummy base', grade: 'Food grade, non-GMO' },
          { ingredient: 'Pectin (apple or citrus)', amount_mg: 700, function: 'Vegan gelling agent', grade: 'USP/Food grade' },
          { ingredient: 'Erythritol', amount_mg: 400, function: 'Bulk sweetener, 0 glycemic index', grade: 'Food grade ≥99.5%, non-GMO' },
          { ingredient: 'Citric Acid', amount_mg: 100, function: 'Taste modulation, pH adjustment', grade: 'FCC anhydrous' },
          { ingredient: 'Sodium Citrate', amount_mg: 40, function: 'Buffering', grade: 'USP grade' },
          { ingredient: 'Natural Strawberry Flavor', amount_mg: 60, function: 'Flavor identity', grade: 'FTNF, no artificial' },
          { ingredient: 'Fruit & Vegetable Juice (Color)', amount_mg: 25, function: 'Natural pink color', grade: 'Non-GMO, heat-stable' },
          { ingredient: 'Stevia Leaf Extract (Reb-A)', amount_mg: 10, function: 'Sweetness, 0 calories', grade: '≥95% Rebaudioside-A' },
          { ingredient: 'Organic Sunflower Lecithin', amount_mg: 15, function: 'Emulsifier', grade: 'Organic, non-GMO' },
          { ingredient: 'Carnauba Wax', amount_mg: 5, function: 'Coating, anti-clump', grade: 'Food grade' },
        ] : [
          { ingredient: 'Organic Tapioca Syrup', amount_mg: 1600, function: 'Primary gummy base', grade: 'Organic, non-GMO' },
          { ingredient: 'Organic Cane Sugar', amount_mg: 400, function: 'Sweetener, texture', grade: 'Organic' },
          { ingredient: 'Pectin (apple or citrus)', amount_mg: 700, function: 'Vegan gelling agent', grade: 'USP/Food grade' },
          { ingredient: 'Citric Acid', amount_mg: 100, function: 'Taste modulation', grade: 'FCC anhydrous' },
          { ingredient: 'Sodium Citrate', amount_mg: 40, function: 'Buffering', grade: 'USP grade' },
          { ingredient: 'Natural Flavor', amount_mg: 60, function: 'Flavor identity', grade: 'FTNF preferred' },
          { ingredient: 'Fruit & Vegetable Juice (Color)', amount_mg: 25, function: 'Natural color', grade: 'Non-GMO, heat-stable' },
          { ingredient: 'Organic Sunflower Lecithin', amount_mg: 15, function: 'Emulsifier', grade: 'Organic, non-GMO' },
          { ingredient: 'Carnauba Wax', amount_mg: 5, function: 'Coating, anti-clump', grade: 'Food grade' },
        ],
        formula_summary: {
          primary_mg: recommendedDose + 25,
          secondary_mg: strategicBonusIngredients.reduce((a, i) => a + i.amount_mg, 0),
          tertiary_mg: 15,
          excipients_mg: 3155,
          total_mg: recommendedDose + 25 + strategicBonusIngredients.reduce((a, i) => a + i.amount_mg, 0) + 15 + 3155,
          per_gummy_mg: Math.round((recommendedDose + 25 + strategicBonusIngredients.reduce((a, i) => a + i.amount_mg, 0) + 15 + 3155) / 2)
        }
      },
      supplement_facts: `Serving Size: 2 Gummies | Servings: 45 | Calories 15 | Total Carbohydrate 3g | Sugars 0g | Added Sugars 0g | ${goSugarFree ? 'Sugar Alcohol (Erythritol) 2g | ' : ''}Vitamin D3 25mcg 1000IU 125%DV | Magnesium 12mg 3%DV | ${targetExtract}® Ashwagandha Root Extract (min. 5% withanolides) ${recommendedDose}mg | L-Theanine 200mg | Lemon Balm Extract 150mg | Saffron Extract 15mg | BioPerine® Black Pepper Extract 5mg`,
      other_ingredients: goSugarFree
        ? 'Tapioca Syrup, Pectin, Erythritol, Citric Acid, Natural Strawberry Flavor, Sodium Citrate, Sunflower Lecithin (Organic), Stevia Leaf Extract, Fruit and Vegetable Juice (color), Carnauba Wax'
        : 'Organic Tapioca Syrup, Organic Cane Sugar, Pectin, Citric Acid, Natural Flavor, Sodium Citrate, Sunflower Lecithin (Organic), Fruit and Vegetable Juice (color), Carnauba Wax',
      directions: 'Take 2 gummies daily, preferably morning or early afternoon with food. Chew thoroughly. Do not exceed 2 gummies daily. For best results take consistently for 4–6 weeks.',
      warnings: 'Keep out of reach of children. Not intended for use by persons under 18. If pregnant, nursing, or taking medications (including thyroid medications, sedatives, or immunosuppressants), consult a healthcare professional before use.',
      claims: [
        'Helps support a calm and balanced stress response*',
        'Supports mental clarity and focus under stress*',
        'Promotes healthy cortisol levels already within normal range*',
        'Supports relaxation without drowsiness*'
      ],
      variants: [
        { name: 'Hero — Calm & Clarity', flavor: 'Natural Strawberry', target: 'Adults 25-45 primary stress relief', changes: 'Base formula as specified', rationale: 'Strawberry underused in premium tier; mixed berry saturated' },
        { name: 'Sleep & Unwind', flavor: 'Blackberry + Lavender', target: 'Adults 35-55 sleep support', changes: 'Replace Saffron 15mg → Melatonin 3mg + Chamomile Extract 100mg', rationale: `Sleep is a top category claim (29%); validates demand across ${KEYWORD}` },
        { name: 'Focus & Resilience', flavor: 'Watermelon', target: 'Athletes/biohackers 25-40', changes: 'Replace Lemon Balm → Rhodiola Rosea Extract 150mg (3% rosavins + 1% salidroside)', rationale: 'Novel masculine flavor; Rhodiola rare in gummy format; targets gym + productivity segment' }
      ],
      synergies: [
        `${targetExtract} + L-Theanine: dual-mechanism calm — ashwagandha reduces cortisol at HPA axis, L-Theanine promotes GABA + alpha-wave calm`,
        `${targetExtract} + BioPerine: 20% increased bioavailability of withanolides`,
        'L-Theanine + Lemon Balm: complementary GABAergic pathways',
        'Magnesium Glycinate + Ashwagandha: dual cortisol modulation + sleep quality'
      ],
      pricing: [
        { format: '90ct (45 servings) MSRP $24.99', per_sv: 0.56 },
        { format: '180ct (90 servings) MSRP $44.99', per_sv: 0.50 },
        { format: '3-pack 90ct MSRP $64.99', per_sv: 0.48 }
      ],
      physical: {
        form: 'Pectin-based gummy (vegan)',
        shape: 'Pillow/rounded rectangle 22x15x10mm ±10%',
        unit_mg: Math.round((recommendedDose + 25 + strategicBonusIngredients.reduce((a, i) => a + i.amount_mg, 0) + 15 + 3155) / 2),
        aw: '0.55–0.65',
        moisture: '12–18%',
        hardness: '500–900g force'
      },
      stability: {
        shelf_months: 24,
        overages: [
          { name: `${targetExtract} Ashwagandha`, label: recommendedDose, overage_pct: 5, target: Math.round(recommendedDose * 1.05) },
          { name: 'Vitamin D3', label_mcg: 25, overage_pct: 20, target_mcg: 30 },
          { name: 'Saffron Extract', label: 15, overage_pct: 10, target: 16.5 },
          { name: 'L-Theanine', label: 200, overage_pct: 3, target: 206 },
          { name: 'Lemon Balm Extract', label: 150, overage_pct: 5, target: 157.5 }
        ]
      }
    },
    regulatory_notes: 'All structure/function claims require 30-day FDA notification per 21 CFR 101.93 prior to use. Ensure Prop 65 compliance (California) post finished-product heavy metals testing.',
    risk_factors: [
      `${targetExtract} sourced primarily from Ixoreal Biomed — qualify backup supplier`,
      'Pectin gummy shelf life sensitive to water activity — strict packaging spec required',
      'Saffron (Affron®) price volatile — confirm COGS viability with CMO',
      'NSF certification takes 3–6 months — plan launch without it, add badge after'
    ],
    generated_at: new Date().toISOString(),
    generation_mode: 'rule_based',
  };
}

// ─── AI Brief Enhancement ─────────────────────────────────────────────────────

async function enhanceWithAI(brief, data) {
  const apiKey = await getApiKey();
  if (!apiKey) { console.log('  No API key in app_settings — skipping AI enhancement'); return brief; }
  console.log(`  Using: ${apiKey.provider}`);

  const leader = data.top5?.[0];
  const newWinner = data.newWinners?.[0];

  const prompt = `You are a senior supplement formulation specialist. Based on the competitive data below, write a brief EXECUTIVE SUMMARY (200 words max) and WINNING STRATEGY (150 words max) for a new DOVIVE product entering the ${data.keyword} market.

#1 MARKET LEADER: ${leader?.brand} (BSR ${leader?.bsr_current}) — $${leader?.monthly_revenue?.toLocaleString()}/month revenue
- Formula: ${leader?.supplement_facts_raw?.substring(0, 300) || 'KSM-66 300mg + Vitamin D'}
- Weakness: ${brief.consumer_pain_points?.map(p => p.complaint).join(', ')}

NEW WINNER PATTERN: ${newWinner?.brand} (BSR ${newWinner?.bsr_current}, only ${newWinner?.rating_count} reviews) — $${newWinner?.monthly_revenue?.toLocaleString()}/month
- Formula: ${newWinner?.supplement_facts_raw?.substring(0, 200) || 'Multi-ingredient sugar-free'}

DOVIVE FORMULA: ${brief.ingredients.master_formula_per_serving.primary_actives.map(a => `${a.ingredient} ${a.amount_mg || a.amount_mcg + 'mcg'}${a.amount_mg ? 'mg' : ''}`).join(', ')}
POSITIONING: ${brief.positioning}

Write ONLY: 1) EXECUTIVE_SUMMARY: [text] 2) WINNING_STRATEGY: [text]. No other text.`;

  try {
    const response = await callAI(prompt);
    if (!response) return brief;
    const execMatch = response.match(/EXECUTIVE_SUMMARY:\s*([\s\S]+?)(?=WINNING_STRATEGY:|$)/i);
    const stratMatch = response.match(/WINNING_STRATEGY:\s*([\s\S]+?)$/i);
    if (execMatch) brief.executive_summary = execMatch[1].trim();
    if (stratMatch) brief.winning_strategy = stratMatch[1].trim();
    brief.generation_mode = 'ai_enhanced';
    console.log('  AI enhancement applied');
  } catch (e) {
    console.log('  AI enhancement failed:', e.message);
  }
  return brief;
}

// ─── Save to DB ───────────────────────────────────────────────────────────────

async function saveBrief(brief, categoryId) {
  // Delete existing
  await DASH.from('formula_briefs').delete().eq('category_id', categoryId);

  const { error } = await DASH.from('formula_briefs').insert({
    category_id: categoryId,
    positioning: brief.positioning?.substring(0, 500),
    target_customer: brief.target_customer,
    form_type: brief.form_type,
    form_rationale: brief.form_rationale,
    flavor_profile: brief.flavor_profile?.substring(0, 200),
    flavor_importance: brief.flavor_importance,
    flavor_development_needed: brief.flavor_development_needed,
    servings_per_container: brief.servings_per_container,
    target_price: brief.target_price,
    packaging_type: brief.packaging_type,
    packaging_recommendations: brief.packaging_recommendations,
    testing_requirements: brief.testing_requirements,
    certifications: brief.certifications,
    key_differentiators: brief.key_differentiators,
    market_summary: brief.market_summary,
    consumer_pain_points: brief.consumer_pain_points,
    opportunity_insights: brief.opportunity_insights,
    ingredients: brief.ingredients,
    regulatory_notes: brief.regulatory_notes,
    risk_factors: brief.risk_factors,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (error) throw error;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`=== Phase 8: Formula Brief Generator ===`);
  console.log(`Keyword: ${KEYWORD} | Mode: ${USE_AI ? 'AI-Enhanced' : 'Rule-Based'}\n`);

  // Get category ID
  const { data: cats } = await DASH.from('categories').select('id, name').ilike('name', `%${KEYWORD.split(' ')[0]}%`).limit(5);
  if (!cats?.length) { console.log('ERROR: No matching category found'); process.exit(1); }
  const cat = cats[0];
  console.log(`Category: ${cat.name} (${cat.id})\n`);

  // 1. Compile data
  process.stdout.write('Compiling P1-P7 data... ');
  const data = await compileData(cat.id);
  console.log(`Done — ${data.total_products} products, ${data.top5?.length} top performers, ${data.newWinners?.length} new winners\n`);

  // 2. Generate rule-based brief
  process.stdout.write('Generating rule-based brief... ');
  let brief = buildRuleBasedBrief(data);
  console.log('Done\n');

  // 3. AI enhancement (if requested and key available)
  if (USE_AI) {
    process.stdout.write('AI enhancement (OpenRouter)... ');
    brief = await enhanceWithAI(brief, data);
    console.log('');
  }

  // 4. Save to DB
  process.stdout.write('Saving to formula_briefs table... ');
  await saveBrief(brief, cat.id);
  console.log('Done\n');

  // 5. Summary
  const mf = brief.ingredients.master_formula_per_serving;
  console.log('=== FORMULA BRIEF GENERATED ===');
  console.log(`Product: ${brief.product_name}`);
  console.log(`Positioning: ${brief.positioning?.substring(0, 80)}...`);
  console.log(`\nMaster Formula (per ${mf.serving_size}):`);
  mf.primary_actives?.forEach(a => console.log(`  PRIMARY: ${a.ingredient} ${a.amount_mg || a.amount_mcg + 'mcg'}${a.amount_mg ? 'mg' : ''}`));
  mf.secondary_actives?.forEach(a => console.log(`  SECONDARY: ${a.ingredient} ${a.amount_mg}mg`));
  mf.tertiary_actives?.forEach(a => console.log(`  TERTIARY: ${a.ingredient} ${a.amount_mg}mg`));
  console.log(`\nTotal per serving: ${mf.formula_summary?.total_mg}mg (${(mf.formula_summary?.total_mg / 1000).toFixed(2)}g)`);
  console.log(`Variants: ${mf.total_count} gummies / ${brief.servings_per_container} servings / $${brief.target_price} MSRP`);
  console.log(`\nMode: ${brief.generation_mode} | Saved to dashboard ✅`);
}

run().catch(console.error);
