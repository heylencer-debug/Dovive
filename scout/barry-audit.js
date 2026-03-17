/**
 * barry-audit.js — Full system audit: Supabase data integrity check
 * Checks every category for data completeness across all phases P1-P10
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const DOVIVE = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);

const CHECK = (val, label) => val ? `✅ ${label}` : `❌ ${label}`;
const PCT = (num, total) => total ? `${num}/${total} (${Math.round(num/total*100)}%)` : '0/0';

async function auditCategory(cat) {
  const id = cat.id;
  const { count: total } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', id);
  if (!total) return { name: cat.name, total: 0, issues: ['No products in DASH'] };

  const issues = [];
  const stats = { name: cat.name, id, total };

  // P1 — basic product data
  const { count: hasTitle } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', id).not('title', 'is', null);
  const { count: hasPrice } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', id).not('price', 'is', null);
  const { count: hasImage } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', id).not('main_image_url', 'is', null);
  stats.p1_titles = PCT(hasTitle, total);
  stats.p1_prices = PCT(hasPrice, total);
  stats.p1_images = PCT(hasImage, total);
  if (hasTitle < total * 0.9) issues.push(`P1: Only ${PCT(hasTitle,total)} have titles`);

  // P2 — Keepa
  const { count: hasBSR } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', id).not('bsr_current', 'is', null);
  const { count: hasRevenue } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', id).not('monthly_revenue', 'is', null);
  stats.p2_bsr = PCT(hasBSR, total);
  stats.p2_revenue = PCT(hasRevenue, total);
  if (hasBSR < total * 0.5) issues.push(`P2: Only ${PCT(hasBSR,total)} have BSR (Keepa may have failed)`);

  // P3 — Reviews
  const { count: hasReviews } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', id).not('review_analysis', 'is', null);
  const { data: reviewSample } = await DASH.from('products').select('review_analysis').eq('category_id', id).not('review_analysis', 'is', null).limit(1);
  const hasTopReviews = reviewSample?.[0]?.review_analysis?.top_reviews?.length > 0;
  stats.p3_review_analysis = PCT(hasReviews, total);
  stats.p3_has_review_text = hasTopReviews ? '✅ top_reviews with text' : '❌ review_analysis exists but no review text';
  if (hasReviews < total * 0.5) issues.push(`P3: Only ${PCT(hasReviews,total)} have review_analysis`);
  if (!hasTopReviews) issues.push(`P3: review_analysis missing top_reviews text (modal will be empty)`);

  // P4 — OCR
  const { count: hasOCR } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', id).not('supplement_facts_raw', 'is', null);
  const { count: hasNutrients } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', id).not('all_nutrients', 'is', null);
  stats.p4_supplement_facts_raw = PCT(hasOCR, total);
  stats.p4_all_nutrients = PCT(hasNutrients, total);
  if (hasOCR < total * 0.5) issues.push(`P4: Only ${PCT(hasOCR,total)} have supplement_facts_raw — OCR migration incomplete`);

  // P5 — Deep Research
  const { count: p5Count } = await DOVIVE.from('dovive_phase5_research').select('*', { count: 'exact', head: true }).ilike('keyword', `%${cat.name.split(' ')[0].toLowerCase()}%`);
  stats.p5_records = p5Count || 0;
  if (!p5Count) issues.push(`P5: No records in dovive_phase5_research`);

  // P6 — Product Intelligence
  const { count: hasPI } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', id).not('marketing_analysis', 'is', null);
  const { data: piSample } = await DASH.from('products').select('marketing_analysis').eq('category_id', id).not('marketing_analysis', 'is', null).limit(1);
  const hasPIKey = !!piSample?.[0]?.marketing_analysis?.product_intelligence;
  const hasPAI = !!piSample?.[0]?.marketing_analysis?.product_intelligence?.primary_active_ingredient;
  stats.p6_marketing_analysis = PCT(hasPI, total);
  stats.p6_has_product_intelligence = hasPIKey ? '✅' : '❌ marketing_analysis exists but no product_intelligence key';
  stats.p6_has_primary_active = hasPAI ? '✅ generic fields populated' : '❌ no primary_active_ingredient (old schema)';
  if (!hasPIKey) issues.push(`P6: products have marketing_analysis but no product_intelligence sub-key`);
  if (!hasPAI) issues.push(`P6: old schema — no primary_active_ingredient field (needs P6 rerun)`);

  // P7+P8 — Market + Packaging Intel
  const { count: hasPkgIntel } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', id);
  const { data: pkgSample } = await DASH.from('products').select('marketing_analysis').eq('category_id', id).not('marketing_analysis', 'is', null).limit(1);
  const hasPkg = !!pkgSample?.[0]?.marketing_analysis?.packaging_intelligence;
  stats.p8_packaging_intelligence = hasPkg ? '✅' : '❌ no packaging_intelligence';
  if (!hasPkg) issues.push(`P8: No packaging_intelligence in marketing_analysis`);

  // P9+P10 — Formula Brief
  const { data: fb } = await DASH.from('formula_briefs').select('ingredients, positioning').eq('category_id', id).maybeSingle();
  const ing = fb?.ingredients || {};
  const hasGrokBrief = !!ing.ai_generated_brief_grok;
  const hasClaudeBrief = !!ing.ai_generated_brief_claude;
  const hasQA = !!ing.qa_verdict;
  const hasAdjusted = !!ing.adjusted_formula;
  const hasMarketIntel = !!ing.market_intelligence;
  const hasComparison = !!ing.comprehensive_comparison;
  stats.p9_grok_brief = hasGrokBrief ? `✅ ${Math.round((ing.ai_generated_brief_grok?.length||0)/1000)}k chars` : '❌ MISSING';
  stats.p9_claude_brief = hasClaudeBrief ? `✅ ${Math.round((ing.ai_generated_brief_claude?.length||0)/1000)}k chars` : '❌ MISSING';
  stats.p10_qa_verdict = hasQA ? '✅' : '❌ MISSING';
  stats.p10_adjusted_formula = hasAdjusted ? '✅' : '❌ MISSING';
  stats.p10_comprehensive_comparison = hasComparison ? '✅' : '❌ MISSING';
  stats.p7_market_intelligence = hasMarketIntel ? '✅' : '❌ MISSING';
  if (!hasGrokBrief) issues.push(`P9: No Grok formula brief`);
  if (!hasAdjusted) issues.push(`P10: No adjusted_formula — QA may have failed`);
  if (!hasComparison) issues.push(`P10: No comprehensive_comparison — benchmark tab will be empty`);
  if (!hasMarketIntel) issues.push(`P7: No market_intelligence in formula_briefs`);

  stats.issues = issues;
  return stats;
}

async function main() {
  console.log('\n🔍 BARRY AUDIT — Full System Check\n' + '═'.repeat(60));

  const { data: cats } = await DASH.from('categories').select('id, name').order('name');
  const gummyCats = (cats || []).filter(c => c.name.toLowerCase().includes('gummies') || c.name.toLowerCase().includes('gummy'));

  console.log(`Found ${gummyCats.length} gummy categories\n`);

  for (const cat of gummyCats) {
    const r = await auditCategory(cat);
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📦 ${r.name} | ${r.total} products`);
    if (r.total === 0) { console.log('   ⚠️  EMPTY — needs P1 scrape'); continue; }

    console.log(`  P1  | titles:${r.p1_titles} | prices:${r.p1_prices} | images:${r.p1_images}`);
    console.log(`  P2  | BSR:${r.p2_bsr} | revenue:${r.p2_revenue}`);
    console.log(`  P3  | review_analysis:${r.p3_review_analysis} | text:${r.p3_has_review_text}`);
    console.log(`  P4  | supplement_facts_raw:${r.p4_supplement_facts_raw} | nutrients:${r.p4_all_nutrients}`);
    console.log(`  P5  | deep_research records:${r.p5_records}`);
    console.log(`  P6  | marketing_analysis:${r.p6_marketing_analysis} | PI:${r.p6_has_product_intelligence} | generic:${r.p6_has_primary_active}`);
    console.log(`  P8  | packaging:${r.p8_packaging_intelligence}`);
    console.log(`  P7  | market_intel:${r.p7_market_intelligence}`);
    console.log(`  P9  | grok:${r.p9_grok_brief} | claude:${r.p9_claude_brief}`);
    console.log(`  P10 | qa:${r.p10_qa_verdict} | formula:${r.p10_adjusted_formula} | comparison:${r.p10_comprehensive_comparison}`);

    if (r.issues.length) {
      console.log(`\n  ⚠️  ISSUES (${r.issues.length}):`);
      r.issues.forEach(i => console.log(`     - ${i}`));
    } else {
      console.log(`\n  ✅ CLEAN — all phases complete`);
    }
  }
  console.log('\n' + '═'.repeat(60) + '\nAudit complete.\n');
}

main().catch(console.error);
