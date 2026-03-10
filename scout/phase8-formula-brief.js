/**
 * phase8-formula-brief.js
 * P8: Formula Brief Generator
 *
 * Uses Carlo's exact CMO prompt template — feeds compiled P1-P7 data to Claude
 * and lets AI generate the COMPLETE formula specification (not rule-based).
 *
 * Usage:
 *   node phase8-formula-brief.js --keyword "ashwagandha gummies"
 *   node phase8-formula-brief.js --keyword "ashwagandha gummies" --force  (regenerate even if exists)
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
const FORCE = process.argv.includes('--force');

// ─── API Key ──────────────────────────────────────────────────────────────────

// Priority order: xAI Grok (from sterling/.env) → Anthropic → OpenRouter
function getXaiKey() {
  // Load from sterling/.env directly since that's where it lives
  const fs = require('fs');
  const path = require('path');
  const sterlingEnv = path.join(__dirname, '../../sterling/.env');
  if (fs.existsSync(sterlingEnv)) {
    const content = fs.readFileSync(sterlingEnv, 'utf8');
    const match = content.match(/XAI_API_KEY\s*=\s*(.+)/);
    if (match) return match[1].trim();
  }
  return process.env.XAI_API_KEY || null;
}

async function getApiKey() {
  // 1. Try xAI Grok first (from sterling/.env)
  const xaiKey = getXaiKey();
  if (xaiKey) return { provider: 'xai', key: xaiKey };

  // 2. Try Supabase app_settings (Anthropic or OpenRouter)
  const { data } = await DOVIVE
    .from('app_settings')
    .select('key, value')
    .in('key', ['anthropic_api_key', 'openrouter_api_key']);
  if (!data?.length) return null;
  const anthropic = data.find(r => r.key === 'anthropic_api_key');
  const openrouter = data.find(r => r.key === 'openrouter_api_key');
  if (anthropic) return { provider: 'anthropic', key: anthropic.value };
  if (openrouter) return { provider: 'openrouter', key: openrouter.value };
  return null;
}

async function callAI(prompt) {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('No API key found. Add XAI_API_KEY to sterling/.env or anthropic_api_key to app_settings.');

  console.log(`  Provider: ${apiKey.provider}`);

  if (apiKey.provider === 'xai') {
    // xAI Grok — OpenAI-compatible API
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'grok-3',
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const j = await res.json();
    if (j.error) throw new Error(`xAI error: ${j.error.message}`);
    return j.choices?.[0]?.message?.content || null;

  } else if (apiKey.provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey.key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20251120',
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const j = await res.json();
    if (j.error) throw new Error(`Anthropic error: ${j.error.message}`);
    return j.content?.[0]?.text || null;

  } else {
    // OpenRouter fallback
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey.key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://dovive.com',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4-5',
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const j = await res.json();
    if (j.error) throw new Error(`OpenRouter error: ${j.error.message}`);
    return j.choices?.[0]?.message?.content || null;
  }
}

// ─── Data Compilation ─────────────────────────────────────────────────────────

async function compileMarketData(categoryId) {
  // Top 5 all-time performers by BSR
  const { data: top5 } = await DASH.from('products')
    .select(`
      asin, brand, title, bsr_current, price, monthly_revenue, monthly_sales,
      rating_value, rating_count, packaging_type, serving_size, servings_per_container,
      claims_on_label, supplement_facts_raw, all_nutrients, other_ingredients,
      proprietary_blends, feature_bullets_text, marketing_analysis
    `)
    .eq('category_id', categoryId)
    .not('bsr_current', 'is', null)
    .order('bsr_current', { ascending: true })
    .limit(5);

  // New winners: high revenue, low review count (< 2 years implied by few reviews), BSR < 30k
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

  // ── Aggregate ingredient frequency from P6 ──
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

  return {
    category_summary: {
      total_products: total,
      avg_price: priceCount ? `$${(totalPrice / priceCount).toFixed(2)}` : 'N/A',
      avg_ingredients_count: ingCountN ? Math.round(totalIngCount / ingCountN) : 'N/A',
      common_forms: commonForms,
      top_pain_points: topPainPoints,
      top_claims: topClaims,
      top_ingredients: topIngredients,
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
        age_months: Math.round((p.rating_count || 0) / 30), // rough proxy
        nutrients: p.all_nutrients,
        ingredients: p.supplement_facts_raw,
      })),
  };
}

// ─── Build Prompt (Carlo's exact template) ───────────────────────────────────

function buildPrompt(marketData) {
  const cs = marketData.category_summary;
  const leader = cs.top_performers[0];
  const refs = marketData.formula_references;

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

🔍 DETAILED SUPPLEMENT FACTS (Extracted via OCR):
${p.supplement_facts_raw || JSON.stringify(p.all_nutrients || 'No detailed nutrients found', null, 2)}

🧪 PROPRIETARY BLENDS:
${p.proprietary_blends && p.proprietary_blends.length > 0 ? JSON.stringify(p.proprietary_blends, null, 2) : 'None'}

🔹 OTHER INGREDIENTS / EXCIPIENTS:
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

  return `You are a senior supplement formulation specialist creating a FORMULA SPECIFICATION to BEAT the #1 market leader.

# MISSION: CREATE A FORMULA THAT CAN COMPETE WITH THE #1 BESTSELLER BY LEVERAGING INNOVATIONS FROM NEW HIGH-GROWTH WINNERS

---

## 🥇 PRIMARY BENCHMARK: THE #1 MARKET LEADER (THE GIANT)

This is the established standard to match:

${leaderSection}

---

## 🚀 THE NEW WINNERS (High Growth, Low Reviews = Recently Launched)
These are the new products stealing market share right now. Prioritize their innovations over the old giant.

${newWinnersSection}

---

## 📊 COMPETITIVE INTELLIGENCE: TOP 5 ANALYSIS (ALL TIME)

${top5Section}

---

## 🧪 INGREDIENT FREQUENCY ANALYSIS

These ingredients appear most frequently across successful products:

${ingredientFrequency}

STRATEGIC INSIGHT: 50%+ = MUST-HAVE. 20-50% = Differentiator. <20% = Unique selling point.

---

## 📈 CATEGORY STATISTICS

- Total Products Analyzed: ${cs.total_products || 'N/A'}
- Average Ingredient Count: ${cs.avg_ingredients_count || 'N/A'}
- Common Dosage Forms: ${cs.common_forms?.join(', ') || 'N/A'}
- Average Price Point: ${cs.avg_price || 'N/A'}

---

## ⚠️ CONSUMER PAIN POINTS (Problems to SOLVE)

Formulation-Related Complaints:
${formPainPoints}

Efficacy-Related Complaints:
${efficacyPainPoints}

All Consumer Pain Points:
${allPainPoints}

---

## 🏷️ CLAIMS ANALYSIS

${claimsAnalysis}

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
1. STEP 1: ANALYZE NEW WINNERS FIRST: Look immediately at the "NEW WINNERS" section above. Use the DETAILED SUPPLEMENT FACTS and PROPRIETARY BLENDS data.
   * Check Form Factor: Are the New Winners using a different delivery form (e.g., Liquid, Powder, Stick Pack) than the #1 Leader? If YES, COPY THE NEW WINNERS' FORM.
   * Check Primary Actives & Dosages: Look at the specific milligrams (mg) in the New Winners' "all_nutrients" section. Use these specific dosages.
2. STEP 2: DEFINE THE BASE:
   * Scenario A (New Winner Pattern Found): Base the Master Formula primarily on the "New Winner" specifications.
   * Scenario B (No Distinct Pattern or No New Winners): If the New Winners are just clones of the Leader (or list is empty), then (and only then) use the #1 Market Leader as the base.
3. STEP 3: SOLVE PAIN POINTS: Finally, modify the base to address the specific consumer complaints listed in the "Consumer Pain Points" section (e.g., fix taste, texture, or side effects).

#### PRIMARY ACTIVE INGREDIENTS:
| Ingredient | Amount per Serving | Form/Standardization | Function | vs #1 Rationale |
|------------|-------------------|---------------------|----------|-----------------|
[EVERY primary active with EXACT mg/mcg/IU - NO abbreviations]

#### SECONDARY ACTIVE INGREDIENTS:
| Ingredient | Amount per Serving | Form/Standardization | Function |
|------------|-------------------|---------------------|----------|
[ALL supporting ingredients with exact amounts]

#### TERTIARY ACTIVES (Differentiation):
| Ingredient | Amount per Serving | Form/Standardization | Function |
|------------|-------------------|---------------------|----------|
[Unique ingredients that differentiate from competition]

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

Matched from #1: [List with reasoning]

Improvements based on New Winners: [List upgrades with scientific justification and reference the specific New Winner brand]

Consumer Pain Point Solutions:
| Complaint | Frequency | Our Solution |
|-----------|-----------|--------------|
[Address each major complaint]

Synergistic Combinations: [Key ingredient pairs that enhance efficacy]

---

## 3. PHYSICAL SPECIFICATIONS

| Parameter | Specification |
|-----------|---------------|
| Dosage Form | [Soft chew/Tablet/Capsule/Gummy/Powder] |
| Shape | [Description] |
| Dimensions | [L x W x H ± tolerance] |
| Individual Unit Weight | [X mg ± X%] |
| Serving Size | [X units] |
| Servings Per Container | [90/120/etc.] |
| Net Weight Per Container | [X g / X oz] |

### Organoleptic Targets:
| Property | Target Specification |
|----------|---------------------|
| Color | [Description with acceptable range] |
| Odor | [Characteristic description] |
| Taste | [If applicable - flavor profile] |
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
| Unit Weight | X mg ± X% |
| Weight Uniformity (RSD) | ≤X% |
| Hardness | X-X N |
| Moisture | X.X-X.X% |
| Water Activity | X.XX-X.XX |

### Microbiological Limits:
| Test | Specification |
|------|---------------|
| Total Aerobic Count | ≤10,000 CFU/g |
| Yeast & Mold | ≤1,000 CFU/g |
| Coliforms | ≤100 CFU/g |
| E. coli | Negative/10g |
| Salmonella | Negative/25g |
| S. aureus | Negative/10g |

### Heavy Metals Limits:
| Metal | Limit |
|-------|-------|
| Lead (Pb) | ≤0.5 ppm |
| Cadmium (Cd) | ≤0.3 ppm |
| Mercury (Hg) | ≤0.1 ppm |
| Arsenic (As) | ≤1.0 ppm |

---

## 6. STABILITY & OVERAGE

Target Shelf Life: 24 months at room temperature (below 25°C/77°F)

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

✅ MUST INCLUDE:
- Complete Executive Summary
- ALL ingredient tables with EVERY ingredient (no "etc." or abbreviations)
- EXACT amounts for every ingredient (mg, mcg, IU, CFU)
- Complete raw material specifications
- Complete finished product specifications
- Complete Supplement Facts Panel
- Complete Directions for Use
- All Warning Statements
- Complete Variant Lineup (Section 10)

❌ DO NOT INCLUDE:
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

// ─── Save to DB ───────────────────────────────────────────────────────────────

async function saveToDB(categoryId, aiOutput, marketData) {
  // Delete existing brief for this category
  await DASH.from('formula_briefs').delete().eq('category_id', categoryId);

  const leader = marketData.category_summary.top_performers[0];

  const { error } = await DASH.from('formula_briefs').insert({
    category_id: categoryId,
    positioning: `AI-generated formula brief for ${KEYWORD} — based on ${marketData.category_summary.total_products} products`,
    target_customer: `Adults seeking ${KEYWORD} supplementation`,
    form_type: 'gummy',
    form_rationale: `Category leader uses gummy format`,
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
    // Store the full AI-generated markdown output in ingredients field for dashboard display
    ingredients: {
      ai_generated_brief: aiOutput,
      generated_at: new Date().toISOString(),
      keyword: KEYWORD,
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

// ─── Save markdown to vault ───────────────────────────────────────────────────

async function saveToVault(aiOutput) {
  const fs = require('fs');
  const date = new Date().toISOString().split('T')[0];
  const vaultPath = `C:\\SirPercival-Vault\\07_ai-systems\\agents\\scout\\formula-briefs\\${date}-${KEYWORD.replace(/\s+/g, '-')}-ai-brief.md`;
  const content = `# P8 Formula Brief — ${KEYWORD} (AI Generated)\n**Date:** ${date}\n**Keyword:** ${KEYWORD}\n\n---\n\n${aiOutput}`;
  fs.writeFileSync(vaultPath, content, 'utf8');
  console.log(`  Vault: ${vaultPath}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🧪 PHASE 8: FORMULA BRIEF — "${KEYWORD}"`);
  console.log(`${'═'.repeat(60)}\n`);

  // Get category — match full keyword first, fall back to first word
  let cats = null;
  const { data: exact } = await DASH.from('categories')
    .select('id, name')
    .ilike('name', `%${KEYWORD}%`)
    .limit(5);
  if (exact?.length) {
    cats = exact;
  } else {
    const { data: partial } = await DASH.from('categories')
      .select('id, name')
      .ilike('name', `%${KEYWORD.split(' ')[0]}%`)
      .limit(10);
    cats = partial;
  }
  if (!cats?.length) { console.log('ERROR: Category not found'); process.exit(1); }
  // Pick the one with the most products if multiple matches
  let cat = cats[0];
  if (cats.length > 1) {
    const counts = await Promise.all(cats.map(async c => {
      const { count } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', c.id);
      return { ...c, count };
    }));
    cat = counts.sort((a, b) => b.count - a.count)[0];
  }
  console.log(`Category: ${cat.name} (${cat.id})\n`);

  // Check if brief already exists
  if (!FORCE) {
    const { data: existing } = await DASH.from('formula_briefs')
      .select('id, created_at')
      .eq('category_id', cat.id)
      .limit(1);
    if (existing?.length) {
      console.log(`Brief already exists (${existing[0].created_at?.split('T')[0]}). Use --force to regenerate.`);
      process.exit(0);
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

  // 3. Call Claude
  process.stdout.write('Calling Claude API... ');
  const startTime = Date.now();
  const aiOutput = await callAI(prompt);
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  if (!aiOutput) throw new Error('No output from AI');
  console.log(`Done (${elapsed}s, ${Math.round(aiOutput.length / 1000)}k chars output)\n`);

  // 4. Save to Supabase
  process.stdout.write('Saving to formula_briefs table... ');
  await saveToDB(cat.id, aiOutput, marketData);
  console.log('Done\n');

  // 5. Save to vault
  process.stdout.write('Saving to vault... ');
  await saveToVault(aiOutput);
  console.log('Done\n');

  // 6. Print preview
  console.log('=== FORMULA BRIEF PREVIEW (first 800 chars) ===');
  console.log(aiOutput.substring(0, 800));
  console.log('\n...\n');
  console.log(`✅ Complete — ${Math.round(aiOutput.length / 1000)}k chars saved to Supabase + vault`);
}

run().catch(e => {
  console.error('\n❌ FAILED:', e.message);
  process.exit(1);
});
