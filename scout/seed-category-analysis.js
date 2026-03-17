require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { resolveCategory } = require('./utils/category-resolver');

const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);

const KEYWORD_ARG = process.argv.includes('--keyword') ? process.argv[process.argv.indexOf('--keyword') + 1] : 'ashwagandha gummies';
const CAT_ID_ARG  = process.argv.includes('--cat-id')  ? process.argv[process.argv.indexOf('--cat-id')  + 1] : null;

async function resolveCatId() {
  if (CAT_ID_ARG) return CAT_ID_ARG;
  const cat = await resolveCategory(DASH, KEYWORD_ARG);
  console.log(`  → Resolved category (${cat.method}): "${cat.name}" (${cat.id})`);
  return cat.id;
}

const buildRecord = (catId, keyword) => ({
  category_id: catId,
  category_name: keyword,
  overall_score: 82,
  opportunity_index: 78,
  opportunity_tier: 'A',
  opportunity_tier_label: 'Strong Opportunity',
  recommendation: 'Enter with premium positioning. Target stress-relief consumers wanting clean, transparent supplements. Differentiate on KSM-66 dose (400mg vs Goli 300mg), L-Theanine synergy, and sugar-free formula.',
  confidence: 0.85,
  executive_summary: 'Ashwagandha gummies is a high-velocity supplement category dominated by Goli (BSR 420) at the mass-market tier. A significant premium gap exists between $14-17 mass products and $25-30 premium competitors. DOVIVE targets $21.99-$22.99 with a clean, clinical-dose formula: 400mg KSM-66 + 100mg L-Theanine + 25mcg Vit D3. P9 QA verified: APPROVED PREMIUM BUILD (8/10). Key advantages: higher KSM-66 dose than Goli, stress-focused L-Theanine synergy, sugar-free, third-party tested.',
  analysis_1_category_scores: {
    analyzed_at: new Date().toISOString(),
    analysis_type: 'scout_p9_qa',
    category_name: 'ashwagandha gummies',
    opportunity_score: {
      overall: 78,
      market_size: 85,
      profit_potential: 75,
      competition_intensity: 65,
      barriers_to_entry: 70
    },
    product_development: {
      formulation: {
        recommended_ingredients: [
          { ingredient: 'KSM-66 Ashwagandha Root Extract', dosage: '400mg', rationale: 'Clinically effective (300-600mg range). Beats Goli (300mg). Within gummy active load limits.' },
          { ingredient: 'L-Theanine', dosage: '100mg', rationale: 'Premium differentiator. Synergistic stress + calm effect. Justifies premium price.' },
          { ingredient: 'Vitamin D3 (Cholecalciferol)', dosage: '25mcg (1000 IU)', rationale: 'Mood + immune support. Matches Goli standard.' }
        ],
        form_factor: 'Gummies (2 per serving)',
        serving_size: '2 gummies',
        key_features: [
          'Sugar-free (Maltitol/Isomalt base)',
          'Vegan + Non-GMO + Gluten-Free',
          'Third-party tested for potency & purity',
          'KSM-66 standardized to 5% Withanolides',
          '30 servings per bottle (60 gummies)'
        ],
        things_to_avoid: [
          'Generic ashwagandha (not KSM-66)',
          'Added sugars',
          'Proprietary blends without dosage disclosure',
          'Sub-therapeutic doses below 300mg'
        ]
      },
      pricing: {
        recommended_price: 21.99,
        pricing_tier: 'Premium',
        justification: 'Above Goli ($14.96) mass tier. Below Adndale ($25.83) upper premium. Sweet spot for clinical-dose clean formula.'
      }
    },
    customer_insights: {
      buyer_profile: 'Health-conscious adults 25-45 seeking natural stress relief. Values clinical-dose transparency. Willing to pay premium for KSM-66 over generic ashwagandha.',
      primary_pain_points: [
        { pain_point: 'Stress and cortisol management', frequency: 85 },
        { pain_point: 'Sleep quality and relaxation', frequency: 72 },
        { pain_point: 'Hidden sugars in other gummies', frequency: 58 },
        { pain_point: 'Undisclosed or low ashwagandha doses', frequency: 65 },
        { pain_point: 'Lack of third-party testing transparency', frequency: 48 }
      ]
    },
    competitive_landscape: {
      exploitable_weaknesses: [
        'Goli (BSR 420) uses only 300mg KSM-66 with 4g added sugar',
        'OLLY uses unspecified ashwagandha dose with sugar',
        'Most competitors under $20 use generic (non-KSM-66) extracts',
        'No clear market leader at $20-23 price point with L-Theanine synergy'
      ],
      market_gaps: [
        'Premium sugar-free ashwagandha gummy at $21-23 price point',
        'KSM-66 + L-Theanine stress synergy stack in gummy format',
        'Transparent clinical dosing with third-party testing at mid-premium price'
      ],
      things_to_avoid: [
        'Undercutting Goli on price',
        'Overcrowding formula with sub-therapeutic doses',
        'Exceeding 500mg total actives per serving (gummy texture risk)'
      ]
    }
  },
  key_insights: {
    go_to_market: {
      positioning: 'The clean, clinical-dose ashwagandha gummy for serious stress relief — KSM-66 + L-Theanine, sugar-free, third-party tested.',
      messaging: [
        'Clinically studied KSM-66 at 400mg — the dose that actually works',
        'Sugar-free stress relief — no compromise on clean ingredients',
        'L-Theanine synergy for deeper calm, not just edge-off relaxation',
        'Third-party tested. Every batch. No exceptions.'
      ],
      key_differentiators: [
        '400mg KSM-66 vs Goli 300mg — 33% more per serving',
        'Sugar-free vs Goli 4g added sugars',
        'L-Theanine 100mg synergy stack (unique at this price tier)',
        'Transparent label — every ingredient dosed and disclosed',
        'Third-party tested (COA available)'
      ],
      launch_tactics: [
        'Launch at $21.99 with 20% coupon for first 30 days',
        'Target ashwagandha gummies and stress relief gummies primary keywords',
        'A+ content emphasizing KSM-66 clinical study and dose comparison vs Goli',
        'Influencer seeding: stress/wellness micro-influencers (10k-100k followers)'
      ]
    },
    financials: {
      startup_investment: '25000-40000',
      target_margin: '55-60%',
      breakeven_timeline: '3-4 months at 500 units/month',
      revenue_projection: '$15k-$25k/month at 700-1100 units/month by month 6'
    },
    risks: [
      { risk: 'Goli price war', mitigation: 'Hold premium positioning — never match on price. Differentiate on dose, L-Theanine, testing.' },
      { risk: 'Vitamin D3 + L-Theanine heat degradation in gummy processing', mitigation: 'Validate with CMO. Request low-heat processing or microencapsulation.' },
      { risk: 'KSM-66 supply chain disruption', mitigation: 'Secure 6-month inventory buffer. Identify backup suppliers.' }
    ],
    top_strengths: [
      '400mg KSM-66 — highest transparent dose at this price point',
      'Sugar-free formula appeals to health-conscious buyers',
      'L-Theanine synergy differentiates from simple ashwagandha products',
      'P9 QA verified formula — manufacturable and clinically sound'
    ],
    top_weaknesses: [
      'No brand equity yet vs established Goli/OLLY',
      'Higher COGS than mass competitors due to KSM-66 + L-Theanine',
      'Heat sensitivity of actives requires CMO validation'
    ],
    customer_pain_points: [
      'Stress and cortisol management',
      'Poor sleep quality',
      'Gummies with hidden sugars',
      'Low or undisclosed ashwagandha doses',
      'Lack of testing transparency'
    ],
    market_gaps: [
      'Clinical-dose sugar-free ashwagandha at $21-23',
      'KSM-66 + L-Theanine stress synergy in gummy format',
      'Transparent dosing with third-party testing at mid-premium'
    ]
  },
  products_snapshot: {
    formula_references: [
      { asin: 'B094T2BZCK', brand: 'Goli', title: 'Goli Ashwagandha & Vitamin D Gummies', monthly_revenue: 448800, monthly_sales: 30000 },
      { asin: 'B086KHBY2J', brand: 'ZzzQuil', title: 'ZzzQuil PURE Zzzs Triple Action', monthly_revenue: 339400, monthly_sales: 20000 },
      { asin: 'B0BG94RWYN', brand: 'Clean Nutraceuticals', title: 'Clean Nutraceuticals Sea Moss Ashwagandha', monthly_revenue: 295200, monthly_sales: 10000 },
      { asin: 'B01M1HYRNJ', brand: 'OLLY', title: 'OLLY Goodbye Stress Gummy', monthly_revenue: 185000, monthly_sales: 16000 },
      { asin: 'B0CYZZ55BH', brand: 'Adndale', title: 'Adndale Ashwagandha Gummies', monthly_revenue: 142000, monthly_sales: 5500 }
    ],
    top_performers: [
      { asin: 'B094T2BZCK', monthly_revenue: 448800, monthly_sales: 30000 },
      { asin: 'B086KHBY2J', monthly_revenue: 339400, monthly_sales: 20000 }
    ]
  },
  recommended_price: 21.99,
  packaging_type: 'Bottle — 60 gummies (30 servings)',
  estimated_profit_margin: 57.5,
  products_analyzed: 159,
  reviews_analyzed: 491,
  analysis_date: new Date().toISOString(),
  run_number: 1
});