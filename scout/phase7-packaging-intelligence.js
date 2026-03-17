/**
 * phase7-packaging-intelligence.js
 * P7: Packaging Intelligence
 *
 * Analyzes competitor packaging strategy via:
 * 1. Marketing claims extracted from feature_bullets_text
 * 2. Visual color inference from title/claims keywords
 * 3. Badge/certification signals from supplement facts + bullets
 * 4. Generates Dovive packaging recommendation
 *
 * Usage: node phase7-packaging-intelligence.js [--top N]
 * Saves: packaging_intelligence JSON to products table + category summary to dovive_packaging_intelligence
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { resolveCategory } = require('./utils/category-resolver');

const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);
const DOVIVE = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const KEYWORD = process.argv.includes('--keyword') ? process.argv[process.argv.indexOf('--keyword') + 1] : 'ashwagandha gummies';
const TOP_N = process.argv.includes('--top')
  ? parseInt(process.argv[process.argv.indexOf('--top') + 1])
  : 999;

// Dynamic category lookup
async function lookupCategoryId(keyword) {
  const cat = await resolveCategory(DASH, keyword);
  console.log(`  → Resolved category (${cat.method}): "${cat.name}" (${cat.id})`);
  return cat.id;
}

// ─── Claim Patterns ───────────────────────────────────────────────────────────

const BENEFIT_CLAIMS = [
  { label: 'Stress Relief',         terms: ['stress relief', 'stress reduction', 'reduce stress', 'manage stress', 'cortisol', 'anti-stress'] },
  { label: 'Sleep Support',         terms: ['sleep', 'better sleep', 'sleep quality', 'restful', 'melatonin', 'bedtime', 'nighttime'] },
  { label: 'Calm / Relaxation',     terms: ['calm', 'calming', 'relaxation', 'relax', 'anxiety relief', 'mood balance', 'mood support'] },
  { label: 'Energy / Vitality',     terms: ['energy', 'vitality', 'stamina', 'endurance', 'fatigue', 'tiredness'] },
  { label: 'Focus / Mental Clarity',terms: ['focus', 'mental clarity', 'cognitive', 'brain', 'concentration', 'memory'] },
  { label: 'Immune Support',        terms: ['immune', 'immunity', 'immune system', 'defense', 'antioxidant'] },
  { label: 'Adaptogen',             terms: ['adaptogen', 'adaptogenic', 'adaptogenic herb'] },
  { label: 'Thyroid Support',       terms: ['thyroid', 'hormonal', 'hormone balance'] },
  { label: 'Muscle / Recovery',     terms: ['muscle', 'recovery', 'workout', 'exercise performance', 'athletic'] },
  { label: 'Libido / Testosterone', terms: ['testosterone', 'libido', 'sexual health', 'male vitality'] },
  { label: 'Weight Management',     terms: ['weight', 'metabolism', 'fat burning', 'appetite'] },
  { label: 'Overall Wellness',      terms: ['overall wellness', 'holistic', 'general health', 'whole body', 'wellbeing'] },
];

const BADGE_CLAIMS = [
  { label: 'Clinically Studied',    terms: ['clinically studied', 'clinical study', 'clinical trial', 'clinically tested', 'research-backed', 'science-backed', 'evidence-based'] },
  { label: 'Doctor Formulated',     terms: ['doctor formulated', 'doctor recommended', 'physician formulated', 'developed by doctors'] },
  { label: 'Made in USA',           terms: ['made in usa', 'made in the usa', 'manufactured in usa', 'made in america'] },
  { label: '#1 Brand / Best Seller',terms: ['#1', 'number 1', 'best seller', 'america\'s #1', 'top rated', 'best-selling'] },
  { label: 'Sugar-Free',            terms: ['sugar-free', 'sugar free', 'no added sugar', 'zero sugar'] },
  { label: 'Vegan',                 terms: ['vegan', '100% vegan', 'plant-based'] },
  { label: 'Non-GMO',               terms: ['non-gmo', 'non gmo'] },
  { label: 'Gluten-Free',           terms: ['gluten-free', 'gluten free'] },
  { label: 'Third-Party Tested',    terms: ['third-party tested', '3rd party tested', 'third party tested', 'independently tested', 'lab tested'] },
  { label: 'Organic',               terms: ['organic', 'usda organic', 'certified organic'] },
  { label: 'Premium Extract',       terms: ['ksm-66', 'sensoril', 'shoden', 'premium extract', 'full-spectrum', 'standardized'] },
  { label: 'No Artificial Flavor',  terms: ['no artificial', 'natural flavor', 'naturally flavored'] },
  { label: 'cGMP Certified',        terms: ['cgmp', 'gmp certified', 'gmp facility'] },
  { label: 'Satisfaction Guarantee',terms: ['money-back', 'satisfaction guarantee', 'return policy', '30-day', '60-day guarantee'] },
];

const COLOR_SIGNALS = [
  { color: 'Purple / Violet',   terms: ['calm', 'sleep', 'relax', 'lavender', 'melatonin', 'tranquil'] },
  { color: 'Green / Natural',   terms: ['organic', 'natural', 'herb', 'plant', 'clean', 'wellness', 'holistic'] },
  { color: 'Orange / Gold',     terms: ['energy', 'vitality', 'stamina', 'warm', 'strength', 'power'] },
  { color: 'Blue / Teal',       terms: ['focus', 'cognitive', 'brain', 'clarity', 'mental', 'ocean', 'refresh'] },
  { color: 'White / Clean',     terms: ['pure', 'clean', 'minimal', 'clinical', 'lab', 'certified', 'tested'] },
  { color: 'Pink / Berry',      terms: ['strawberry', 'berry', 'raspberry', 'cherry', 'peach', 'sweet', 'women'] },
  { color: 'Black / Premium',   terms: ['premium', '#1', 'advanced', 'professional', 'elite', 'performance'] },
];

// ─── Per-product analysis ─────────────────────────────────────────────────────

function analyzePackaging(product) {
  const text = [
    product.feature_bullets_text || '',
    product.title || '',
    product.supplement_facts_raw || '',
  ].join(' ').toLowerCase();

  // Extract benefit claims
  const claimsFound = BENEFIT_CLAIMS
    .filter(c => c.terms.some(t => text.includes(t)))
    .map(c => c.label);

  // Extract badge claims
  const badgesFound = BADGE_CLAIMS
    .filter(c => c.terms.some(t => text.includes(t)))
    .map(c => c.label);

  // Infer color palette (top 2 matches)
  const colorMatches = COLOR_SIGNALS
    .map(c => ({ color: c.color, score: c.terms.filter(t => text.includes(t)).length }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(c => c.color);

  // Primary message = first/strongest benefit claim
  const primaryMessage = claimsFound[0] || null;

  // Claim density = how many distinct claims packed onto packaging
  const claimDensity = claimsFound.length + badgesFound.length;
  const claimDensityLabel = claimDensity >= 8 ? 'Heavy' : claimDensity >= 4 ? 'Moderate' : 'Minimal';

  // Packaging message score: more targeted = better
  const messagingScore = Math.min(10, Math.max(1,
    (primaryMessage ? 3 : 0) +
    (badgesFound.includes('Clinically Studied') ? 2 : 0) +
    (badgesFound.includes('Premium Extract') ? 1.5 : 0) +
    (badgesFound.includes('Third-Party Tested') ? 1.5 : 0) +
    (badgesFound.includes('#1 Brand / Best Seller') ? 1 : 0) +
    (claimsFound.length > 0 ? Math.min(2, claimsFound.length * 0.4) : 0)
  ));

  // Extract the main headline hook from title
  const titleWords = (product.title || '').split(/[\-\|,]/)[0].trim();

  return {
    primary_benefit_claim: primaryMessage,
    benefit_claims: claimsFound,
    badge_claims: badgesFound,
    inferred_color_palette: colorMatches,
    claim_density: claimDensityLabel,
    messaging_score: Math.round(messagingScore * 10) / 10,
    headline_hook: titleWords.substring(0, 80),
    main_image_url: product.main_image_url,
    analyzed_at: new Date().toISOString(),
  };
}

// ─── Category summary ─────────────────────────────────────────────────────────

function buildPackagingSummary(products, analyses) {
  const valid = analyses.filter(a => a.benefit_claims);
  const total = valid.length;

  // Claim frequency maps
  const benefitFreq = {};
  const badgeFreq = {};
  const colorFreq = {};

  for (const a of valid) {
    for (const c of a.benefit_claims) benefitFreq[c] = (benefitFreq[c] || 0) + 1;
    for (const b of a.badge_claims) badgeFreq[b] = (badgeFreq[b] || 0) + 1;
    for (const col of a.inferred_color_palette) colorFreq[col] = (colorFreq[col] || 0) + 1;
  }

  const sortedBenefits = Object.entries(benefitFreq).sort((a, b) => b[1] - a[1]);
  const sortedBadges = Object.entries(badgeFreq).sort((a, b) => b[1] - a[1]);
  const sortedColors = Object.entries(colorFreq).sort((a, b) => b[1] - a[1]);

  // All defined claims
  const allBenefitLabels = BENEFIT_CLAIMS.map(c => c.label);
  const allBadgeLabels = BADGE_CLAIMS.map(c => c.label);

  // Find gaps (claims used by < 15% of products)
  const benefitGaps = allBenefitLabels
    .filter(label => (benefitFreq[label] || 0) / total < 0.15)
    .map(label => ({ label, count: benefitFreq[label] || 0, pct: Math.round(((benefitFreq[label] || 0) / total) * 100) }));

  const badgeGaps = allBadgeLabels
    .filter(label => (badgeFreq[label] || 0) / total < 0.10)
    .map(label => ({ label, count: badgeFreq[label] || 0, pct: Math.round(((badgeFreq[label] || 0) / total) * 100) }));

  // Saturated claims (used by > 60%)
  const saturatedClaims = sortedBenefits
    .filter(([, count]) => count / total > 0.6)
    .map(([label, count]) => ({ label, count, pct: Math.round((count / total) * 100) }));

  // Top products by messaging score
  const topByMessaging = valid
    .map((a, i) => ({ ...a, product: products[analyses.indexOf(a)] }))
    .sort((a, b) => b.messaging_score - a.messaging_score)
    .slice(0, 5)
    .map(a => ({
      asin: a.product?.asin,
      brand: a.product?.brand,
      bsr: a.product?.bsr_current,
      messaging_score: a.messaging_score,
      primary_claim: a.primary_benefit_claim,
      badge_count: a.badge_claims.length,
      headline: a.headline_hook,
    }));

  // Dovive recommended packaging strategy
  const dominantColor = sortedColors[0]?.[0] || 'Green / Natural';
  const topBenefits = sortedBenefits.slice(0, 3).map(([l]) => l);
  const topBadges = sortedBadges.slice(0, 5).map(([l]) => l);
  const unusedBadges = badgeGaps.slice(0, 3).map(b => b.label);
  const unusedBenefits = benefitGaps.slice(0, 3).map(b => b.label);

  const doviveStrategy = {
    recommended_primary_claim: saturatedClaims.length > 0
      ? (unusedBenefits[0] || topBenefits[0])  // avoid saturated
      : topBenefits[0],
    claims_to_avoid: saturatedClaims.slice(0, 3).map(c => c.label + ' (' + c.pct + '% of competitors use this)'),
    claims_to_own: unusedBenefits.slice(0, 3),
    badges_to_feature: unusedBadges.filter(b => ['Third-Party Tested','Clinically Studied','Doctor Formulated','Made in USA'].includes(b)).slice(0, 3),
    color_direction: sortedColors[1]?.[0] || 'Purple / Violet',  // go for second most common - familiar but not dominant
    color_rationale: `${dominantColor} dominates the category (${Math.round((colorFreq[dominantColor]||0)/total*100)}% of products). Use ${sortedColors[1]?.[0] || 'Purple / Violet'} to stand out while staying on-brand.`,
    packaging_headline_formula: 'Premium KSM-66 + [unique benefit] + [differentiation badge]',
    key_insight: saturatedClaims.length > 0
      ? `"${saturatedClaims[0]?.label}" is used by ${saturatedClaims[0]?.pct}% of competitors - owning "${unusedBenefits[0] || topBenefits[1]}" creates clear differentiation.`
      : `Lead with clinically-backed claims. Only ${Math.round((badgeFreq['Clinically Studied']||0)/total*100)}% of products mention clinical studies - high trust signal opportunity.`,
  };

  return {
    keyword: 'ashwagandha gummies',
    products_analyzed: total,
    generated_at: new Date().toISOString(),
    benefit_claim_frequency: Object.fromEntries(
      sortedBenefits.map(([label, count]) => [label, { count, pct: Math.round((count / total) * 100) }])
    ),
    badge_claim_frequency: Object.fromEntries(
      sortedBadges.map(([label, count]) => [label, { count, pct: Math.round((count / total) * 100) }])
    ),
    color_palette_frequency: Object.fromEntries(
      sortedColors.map(([color, count]) => [color, { count, pct: Math.round((count / total) * 100) }])
    ),
    saturated_claims: saturatedClaims,
    market_gaps: {
      benefit_gaps: benefitGaps.sort((a, b) => a.count - b.count).slice(0, 5),
      badge_gaps: badgeGaps.sort((a, b) => a.count - b.count).slice(0, 5),
    },
    top_packagers: topByMessaging,
    dovive_packaging_strategy: doviveStrategy,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  const CAT_ID = await lookupCategoryId(KEYWORD);
  console.log('=== Phase 7: Packaging Intelligence ===');
  console.log(`Keyword: "${KEYWORD}" | Limit: ${TOP_N}\n`);

  const query = DASH.from('products')
    .select('id, asin, title, brand, bsr_current, price, main_image_url, feature_bullets_text, supplement_facts_raw')
    .eq('category_id', CAT_ID)
    .order('bsr_current', { ascending: true });
  if (TOP_N < 999) query.limit(TOP_N);

  const { data: products, error } = await query;
  if (error) throw error;
  console.log(`Fetched ${products.length} products\n`);

  const analyses = [];
  let saved = 0;
  let errors = 0;

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const analysis = analyzePackaging(p);
    analyses.push(analysis);

    // Merge into existing marketing_analysis (keep product_intelligence from P6)
    const existing = (await DASH.from('products').select('marketing_analysis').eq('id', p.id).single()).data?.marketing_analysis || {};
    const { error: saveErr } = await DASH.from('products').update({
      marketing_analysis: { ...existing, packaging_intelligence: analysis },
      marketing_analysis_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', p.id);

    if (saveErr) {
      errors++;
    } else {
      saved++;
      if (i < 10 || saved % 25 === 0) {
        console.log(`  [${i+1}] ${(p.brand||'?').padEnd(20)} score:${analysis.messaging_score} | claims:${analysis.benefit_claims.length} | badges:${analysis.badge_claims.length} | ${analysis.primary_benefit_claim || 'no primary'}`);
      }
    }
  }

  console.log(`\nSaved: ${saved}/${products.length} | Errors: ${errors}\n`);

  // Category summary
  const summary = buildPackagingSummary(products, analyses);

  // Save to dovive DB
  const { error: catErr } = await DOVIVE
    .from('dovive_packaging_intelligence')
    .upsert({ keyword: KEYWORD, intelligence: summary, generated_at: summary.generated_at, products_analyzed: summary.products_analyzed }, { onConflict: 'keyword' });

  if (catErr) {
    console.log('⚠️  dovive_packaging_intelligence table not found - showing summary only\n');
  } else {
    console.log('✅ Category packaging intelligence saved\n');
  }

  // Print report
  const s = summary;
  console.log('📦 BENEFIT CLAIM FREQUENCY (top 8):');
  Object.entries(s.benefit_claim_frequency).slice(0, 8).forEach(([k, v]) => {
    const bar = '█'.repeat(Math.round(v.pct / 5));
    console.log(`  ${k.padEnd(28)} ${bar.padEnd(20)} ${v.pct}% (${v.count})`);
  });

  console.log('\n🏅 BADGE CLAIM FREQUENCY (top 8):');
  Object.entries(s.badge_claim_frequency).slice(0, 8).forEach(([k, v]) => {
    console.log(`  ${k.padEnd(28)} ${v.pct}% (${v.count})`);
  });

  console.log('\n🎨 COLOR PALETTE SIGNALS:');
  Object.entries(s.color_palette_frequency).forEach(([k, v]) => {
    console.log(`  ${k.padEnd(25)} ${v.pct}% (${v.count})`);
  });

  console.log('\n⚠️  SATURATED CLAIMS (avoid these):');
  s.saturated_claims.forEach(c => console.log(`  • ${c.label} - ${c.pct}% of competitors`));

  console.log('\n💡 MARKET GAPS (opportunity):');
  s.market_gaps.benefit_gaps.slice(0, 3).forEach(g => console.log(`  • ${g.label} - only ${g.pct}% using it`));
  s.market_gaps.badge_gaps.slice(0, 3).forEach(g => console.log(`  • ${g.label} (badge) - only ${g.pct}% using it`));

  console.log('\n🎯 DOVIVE PACKAGING STRATEGY:');
  const strat = s.dovive_packaging_strategy;
  console.log(`  Primary claim to lead with: "${strat.recommended_primary_claim}"`);
  console.log(`  Claims to AVOID (saturated): ${strat.claims_to_avoid.slice(0,2).join(' | ')}`);
  console.log(`  Claims to OWN: ${strat.claims_to_own.join(', ')}`);
  console.log(`  Badges to feature: ${strat.badges_to_feature.join(', ')}`);
  console.log(`  Color direction: ${strat.color_direction}`);
  console.log(`  Rationale: ${strat.color_rationale}`);
  console.log(`  Key insight: ${strat.key_insight}`);
  console.log(`  Headline formula: ${strat.packaging_headline_formula}`);
}

run().catch(console.error);
