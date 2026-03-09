/**
 * phase5-save.js
 * Saves Phase 5 deep research data to Supabase dovive_phase5_research
 * BMAD Architecture: AD-02
 * Usage: node phase5-save.js
 * Date: 2026-03-09
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ─── Phase 5 Research Data ─────────────────────────────────────────────────
// Keyword: ashwagandha gummies | Top 10 BSR | Researched: 2026-03-09

const RESEARCH_DATA = [
  {
    asin: 'B092H5DCJM',
    keyword: 'ashwagandha gummies',
    brand: 'Goli',
    bsr_rank: 445,
    benefits: [
      'Stress and anxiety reduction — users report calm, "night and day" mental relaxation',
      'Improved sleep — effective melatonin alternative for bedtime wind-down',
      'Mood and overall wellness — KSM-66 is clinically studied extract'
    ],
    features: [
      '300mg KSM-66 ashwagandha per serving (2 gummies)',
      'Vitamin D2 included',
      'Mixed Berry flavor',
      'Vegan, gluten-free, non-GMO',
      'cGMP-certified manufacturing'
    ],
    formula_notes: '300mg KSM-66 per serving is a moderate dose. Lower than some pill alternatives which offer 600mg+.',
    certifications: ['B Corp', 'cGMP', 'Vegan', 'Gluten-Free', 'Non-GMO'],
    awards: ['Self-described award-winning product line (no specific award named)'],
    third_party_tested: false,
    transparency_flag: false,
    reddit_sentiment: 'mixed',
    reddit_notes: 'Generally positive for sleep/stress. Some call it placebo. Side effects (nausea, migraines) reported by minority. Melting during shipping is common complaint.',
    reddit_sources: [],
    external_reviews: [
      { source: 'Amazon', rating: '4.4/5', summary: '53,000+ reviews. Praised for taste and sleep/stress relief. Texture complaints.', url: 'https://amazon.com/dp/B092H5DCJM' },
      { source: 'Garage Gym Reviews', rating: '5/5 taste', summary: 'Delicious but lower dose and less value than rivals.', url: null },
      { source: 'NAD (2022)', rating: null, summary: 'Recommended modifying/discontinuing claims on weight loss, sexual health, physical performance due to insufficient evidence.', url: null }
    ],
    healthline_covered: false,
    labdoor_score: null,
    key_weaknesses: 'No named 3rd-party lab (NSF/Informed Choice). NAD flagged claims. Melts in shipping. Perceived as overpriced vs. pill alternatives.',
    key_strengths: 'B Corp certified. 53K+ reviews. KSM-66 is premium extract. Great taste. Wide retail distribution.',
    competitor_angle: 'Dovive can differentiate with higher KSM-66 dose (600mg+), named 3rd-party testing, and cleaner label (no NAD issues).'
  },
  {
    asin: 'B094T2BZCK',
    keyword: 'ashwagandha gummies',
    brand: 'Goli',
    bsr_rank: 445,
    benefits: [
      'Same formula as B092H5DCJM — stress relief, sleep, mood',
      'Single pack variant of Goli Ashwagandha line'
    ],
    features: [
      '300mg KSM-66 ashwagandha per serving',
      'Vitamin D2',
      'Mixed Berry flavor, 60 count single pack'
    ],
    formula_notes: 'Same as B092H5DCJM — single pack vs 2-pack.',
    certifications: ['B Corp', 'cGMP', 'Vegan', 'Gluten-Free', 'Non-GMO'],
    awards: [],
    third_party_tested: false,
    transparency_flag: false,
    reddit_sentiment: 'mixed',
    reddit_notes: 'Same community feedback as 2-pack variant.',
    reddit_sources: [],
    external_reviews: [
      { source: 'Amazon', rating: '4.4/5', summary: 'Single pack of same product. Consistent reviews.', url: 'https://amazon.com/dp/B094T2BZCK' }
    ],
    healthline_covered: false,
    labdoor_score: null,
    key_weaknesses: 'Same as B092H5DCJM. Lower value per unit vs 2-pack.',
    key_strengths: 'Lower entry price point. Same premium KSM-66 formula.',
    competitor_angle: 'Same as B092H5DCJM. Goli dominates BSR 445 with two listings — market signal of strong brand presence.'
  },
  {
    asin: 'B01M1HYRNJ',
    keyword: 'ashwagandha gummies',
    brand: 'OLLY',
    bsr_rank: 1174,
    benefits: [
      'Rapid calming — effects within 30-60 minutes',
      'Sleep support without next-day grogginess',
      'Improved focus — useful midday for anxiety or ADHD med crashes'
    ],
    features: [
      'GABA + L-Theanine + Lemon Balm formula',
      'Berry-verbena flavor',
      '2 gummies per serving',
      'No melatonin — non-drowsy daytime option'
    ],
    formula_notes: 'No ashwagandha in core formula — positions under this keyword via multi-ingredient stress blend. GABA and L-Theanine are the active agents.',
    certifications: [],
    awards: [],
    third_party_tested: false,
    transparency_flag: true,
    reddit_sentiment: 'positive',
    reddit_notes: 'High repurchase rate. Best for mild-moderate stress. Some report diminishing effects over time. Slight salty aftertaste noted.',
    reddit_sources: [],
    external_reviews: [
      { source: 'Walmart / CVS / Target', rating: 'High', summary: 'Consistent positive reviews across retail. Dietitian endorsed for mild stress.', url: null },
      { source: 'Dietitian Review', rating: null, summary: '"Slight benefits for overstimulation — not a miracle fix but effective for mild-moderate stress."', url: null }
    ],
    healthline_covered: false,
    labdoor_score: null,
    key_weaknesses: 'No ashwagandha. Effects diminish with daily long-term use. Not for severe anxiety. Salty aftertaste.',
    key_strengths: 'Very strong brand trust (OLLY). Fast onset (30 min). Wide retail availability. Dietitian-backed.',
    competitor_angle: 'Dovive can capture users who want actual ashwagandha (KSM-66) with the same fast-acting positioning OLLY has. Target: "works like OLLY but with real adaptogen."'
  },
  {
    asin: 'B086KHBY2J',
    keyword: 'ashwagandha gummies',
    brand: 'ZzzQuil',
    bsr_rank: 1227,
    benefits: [
      'Faster sleep onset — 30-60 min on first use',
      'Deep initial sleep without mid-night wakings',
      'Triple action: melatonin + ashwagandha + botanicals'
    ],
    features: [
      '6mg total melatonin (3mg per gummy)',
      'Ashwagandha botanical blend',
      'Antioxidant action, calm mood support',
      '2.5g sugar per gummy'
    ],
    formula_notes: 'High melatonin dose (6mg per serving) may cause tolerance buildup. Ashwagandha is secondary ingredient in blend.',
    certifications: [],
    awards: [],
    third_party_tested: false,
    transparency_flag: true,
    reddit_sentiment: 'mixed',
    reddit_notes: 'Initial sleep benefits praised but tolerance builds after 5-7 nights. Taste described as "vile" / "disgusting" — many swallow whole. Side effects: heartburn, nausea, grogginess, dizziness.',
    reddit_sources: [],
    external_reviews: [
      { source: 'Amazon', rating: '4-5 stars (efficacy) / 1-3 stars (taste)', summary: 'Divided reviews. Sleep works initially but taste is a major barrier.', url: 'https://amazon.com/dp/B086KHBY2J' }
    ],
    healthline_covered: false,
    labdoor_score: null,
    key_weaknesses: 'Terrible taste (major). Tolerance builds fast (5-7 nights). Side effects common. Child-appeal packaging concern. Artificial colors.',
    key_strengths: 'P&G brand trust. Wide retail distribution. Strong first-night sleep effect. High melatonin dose.',
    competitor_angle: 'Dovive wins on taste and clean label. Position: "Sleep support with real ashwagandha — no artificial colors, no tolerance buildup." Target: ex-ZzzQuil users frustrated with taste + side effects.'
  },
  {
    asin: 'B0CYZZ55BH',
    keyword: 'ashwagandha gummies',
    brand: 'Adndale',
    bsr_rank: 1447,
    benefits: [
      'Improved sleep quality and relaxation',
      'Muscle tension relief via triple magnesium blend',
      'Stress management with ashwagandha adaptogen',
      'Cognitive and cardiovascular support'
    ],
    features: [
      '400mg Magnesium Glycinate + 200mg Malate + 200mg Taurate per serving',
      '400mg Ashwagandha extract (equiv. 8000mg powder)',
      '300mg Lemon Balm extract',
      'Tart cherry, magnolia bark, chamomile, L-theanine, Vitamin D3, Zinc',
      'Sugar-free, vegan, gluten-free, soy-free, dairy-free'
    ],
    formula_notes: '15-in-1 formula is extremely comprehensive. Sugar-free is a significant differentiator. 400mg KSM-66 equiv. is a strong dose.',
    certifications: ['Sugar-Free', 'Vegan', 'Gluten-Free', 'Soy-Free', 'Dairy-Free'],
    awards: [],
    third_party_tested: false,
    transparency_flag: true,
    reddit_sentiment: 'positive',
    reddit_notes: 'Limited Reddit data. Amazon reviews positive — users sleeping better, very pleased.',
    reddit_sources: [],
    external_reviews: [
      { source: 'Amazon', rating: '4.5+', summary: '"Very pleased," "definitely been sleeping better." Clean formula praised.', url: 'https://amazon.com/dp/B0CYZZ55BH' }
    ],
    healthline_covered: false,
    labdoor_score: null,
    key_weaknesses: 'Limited editorial coverage. No named 3rd-party testing. Relatively new brand (less social proof).',
    key_strengths: 'Most comprehensive formula in category. Sugar-free. High ashwagandha dose. Triple magnesium stack. Great price-to-value.',
    competitor_angle: 'Adndale is the formula benchmark. Dovive should match or exceed the sugar-free + comprehensive blend angle to compete at this tier.'
  },
  {
    asin: 'B0C415SWFX',
    keyword: 'ashwagandha gummies',
    brand: 'Adndale',
    bsr_rank: 1447,
    benefits: ['Same core benefits as B0CYZZ55BH — relaxation, muscle relief, stress management'],
    features: [
      '400mg Magnesium Glycinate + Malate + Taurate',
      '400mg Ashwagandha extract',
      'Sugar-free, vegan, gluten-free'
    ],
    formula_notes: 'Standard version of Adndale formula — without the 15-in-1 extras.',
    certifications: ['Sugar-Free', 'Vegan', 'Gluten-Free'],
    awards: [],
    third_party_tested: false,
    transparency_flag: true,
    reddit_sentiment: 'positive',
    reddit_notes: 'Same community feedback as 15-in-1 variant.',
    reddit_sources: [],
    external_reviews: [],
    healthline_covered: false,
    labdoor_score: null,
    key_weaknesses: 'Less comprehensive than 15-in-1 variant.',
    key_strengths: 'Simpler formula for users who want magnesium + ashwagandha without extras. Sugar-free.',
    competitor_angle: 'Two-listing strategy like Goli — covers both comprehensive and simple variants. Dovive can learn from this positioning.'
  },
  {
    asin: 'B0BG94RWYN',
    keyword: 'ashwagandha gummies',
    brand: 'Clean Nutraceuticals',
    bsr_rank: 1482,
    benefits: [
      'Steady energy boost — no crashes reported',
      'Improved skin clarity and immunity',
      'Stress adaptation via ashwagandha',
      'Replaces multiple supplements in one gummy'
    ],
    features: [
      'Sea moss + black seed oil + ashwagandha + turmeric + bladderwrack + burdock + Vit C + D3 + elderberry + manuka + dandelion + yellow dock + iodine + chlorophyll + ACV',
      'GMP-compliant, third-party tested',
      'High bioavailability formula'
    ],
    formula_notes: '16-in-1 mega-blend. Targets wellness shoppers who want to consolidate supplements. Sea moss is the hero ingredient, ashwagandha is supporting.',
    certifications: ['GMP', 'Third-Party Tested'],
    awards: [],
    third_party_tested: true,
    transparency_flag: true,
    reddit_sentiment: 'positive',
    reddit_notes: 'No Reddit threads found. Walmart reviewers report energy increase within 3 days. Replaces multiple supplements angle resonates.',
    reddit_sources: [],
    external_reviews: [
      { source: 'Walmart', rating: 'Positive', summary: 'Increased energy in 3 days. Replaces many supplements. Engaged and positive feeling.', url: null }
    ],
    healthline_covered: false,
    labdoor_score: null,
    key_weaknesses: 'Sea moss is hero — ashwagandha is secondary. Limited editorial coverage. Busy ingredient list may confuse buyers.',
    key_strengths: 'GMP + 3rd-party tested. All-in-one positioning. Strong energy claims backed by users.',
    competitor_angle: 'Dovive can counter with a cleaner, focused formula — "do one thing brilliantly" vs. this scatter-shot approach.'
  },
  {
    asin: 'B087QR7D1H',
    keyword: 'ashwagandha gummies',
    brand: 'ProHeight (TruHeight)',
    bsr_rank: 1721,
    benefits: [
      'Bone health support (Calcium + Vitamin D)',
      'Stress reduction supporting growth (ashwagandha)',
      'Better sleep for growing kids/teens',
      'Nutrient gap filling for picky eaters'
    ],
    features: [
      'Vitamin D + K + Calcium + Ashwagandha per serving',
      'Low sugar, high micronutrient density',
      'Part of TruHeight system (gummies + protein shake + sleep gummies)',
      'Targeted at kids 5+ and teens'
    ],
    formula_notes: 'Ashwagandha included for stress/sleep support in growth context, not as hero adaptogen ingredient.',
    certifications: [],
    awards: ['Dietitian endorsed'],
    third_party_tested: false,
    transparency_flag: true,
    reddit_sentiment: 'none',
    reddit_notes: 'No Reddit discussions found. YouTube reviewer rates 7-9/10 for teens. Dietitian changed from skeptical to recommending.',
    reddit_sources: [],
    external_reviews: [
      { source: 'iHerb', rating: 'Positive', summary: '"Seems to work — noticed growth progress. Pleasant taste, no side effects."', url: null },
      { source: 'Registered Dietitian Review', rating: null, summary: 'Science-backed, low sugar — changed from skeptical to recommending.', url: null }
    ],
    healthline_covered: false,
    labdoor_score: null,
    key_weaknesses: 'Very niche (kids/teens). No strong evidence for height increases. Not a pure ashwagandha product.',
    key_strengths: 'Unique growth angle — own niche, low competition. Dietitian-endorsed. System product (gummies + shake + sleep).',
    competitor_angle: 'No direct competition with Dovive — different audience (kids vs. adults). Note as non-competing niche.'
  },
  {
    asin: 'B0DPMDWMKC',
    keyword: 'ashwagandha gummies',
    brand: 'VivoNu',
    bsr_rank: 1848,
    benefits: [
      'Steady energy boost without jitters (30-day users)',
      'Improved focus and sleep quality',
      'Stress relief from ashwagandha',
      '85+ trace minerals from shilajit + fulvic acid for cellular energy'
    ],
    features: [
      '3000mg pure shilajit per gummy',
      'Ashwagandha + Gokshura + Black Musli',
      '85+ trace minerals + fulvic acid',
      'Individually wrapped, travel-friendly',
      'Organic, Non-GMO'
    ],
    formula_notes: 'Shilajit is the hero ingredient. Ashwagandha is supporting. Ayurvedic-inspired formula. Premium positioning.',
    certifications: ['Organic', 'Non-GMO'],
    awards: [],
    third_party_tested: false,
    transparency_flag: false,
    reddit_sentiment: 'none',
    reddit_notes: 'No Reddit discussions found. Some buyers call it a "sugar trap." Complaints about payment/shipping delays.',
    reddit_sources: [],
    external_reviews: [
      { source: 'Verified Amazon Purchase (30-day)', rating: 'Positive', summary: '"More energetic, conditioned, and revived."', url: null },
      { source: '2026 Investigation', rating: null, summary: 'No publicly visible COA or third-party lab reports. Limited transparency.', url: null }
    ],
    healthline_covered: false,
    labdoor_score: null,
    key_weaknesses: 'No COA / 3rd-party lab reports visible. "Sugar trap" complaints. Shipping delays. Effectiveness of shilajit in gummy form debated.',
    key_strengths: 'Premium Ayurvedic positioning. Unique shilajit angle. Individually wrapped (travel convenience). Organic + Non-GMO.',
    competitor_angle: 'Dovive wins on transparency — publish COA, show 3rd-party test results. Target: buyers burned by VivoNu\'s lack of transparency who still want an adaptogen gummy.'
  },
  {
    asin: 'B0DYHWRY27',
    keyword: 'ashwagandha gummies',
    brand: 'VivoNu',
    bsr_rank: 1848,
    benefits: ['Same as B0DPMDWMKC — energy, focus, stress, trace minerals'],
    features: [
      '85+ Trace Minerals + Fulvic Acid',
      'Ashwagandha + Gokshura',
      'Organic, Non-GMO, Pure & Natural'
    ],
    formula_notes: 'Variant listing of same VivoNu shilajit formula.',
    certifications: ['Organic', 'Non-GMO'],
    awards: [],
    third_party_tested: false,
    transparency_flag: false,
    reddit_sentiment: 'none',
    reddit_notes: 'Same as B0DPMDWMKC.',
    reddit_sources: [],
    external_reviews: [],
    healthline_covered: false,
    labdoor_score: null,
    key_weaknesses: 'Same as B0DPMDWMKC. Two listings with same transparency issues.',
    key_strengths: 'Organic + Non-GMO. Ayurvedic angle. Trace minerals positioning.',
    competitor_angle: 'Same as B0DPMDWMKC. VivoNu has dual listing strategy at BSR 1,848.'
  }
];

// ─── Save to Supabase ───────────────────────────────────────────────────────

async function saveResearch() {
  console.log(`\nPhase 5 Save — dovive_phase5_research`);
  console.log(`Keyword: ashwagandha gummies | Products: ${RESEARCH_DATA.length}\n`);

  let saved = 0;
  let failed = 0;

  for (const item of RESEARCH_DATA) {
    const { error } = await sb
      .from('dovive_phase5_research')
      .upsert(item, { onConflict: 'asin,keyword' });

    if (error) {
      console.error(`  ❌ FAILED: ${item.asin} (${item.brand}) — ${error.message}`);
      failed++;
    } else {
      console.log(`  ✅ Saved: ${item.asin} | ${item.brand} | BSR ${item.bsr_rank}`);
      saved++;
    }
  }

  console.log(`\n─────────────────────────────`);
  console.log(`Saved: ${saved} | Failed: ${failed}`);
  console.log(`Table: dovive_phase5_research`);
  console.log(`─────────────────────────────\n`);
}

saveResearch().catch(console.error);
