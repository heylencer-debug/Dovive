require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const DOVIVE = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);

// Only audit real categories we care about
const REAL_KEYWORDS = [
  'ashwagandha gummies', 'collagen gummies', 'elderberry gummies',
  'magnesium gummies', 'melatonin gummies', 'vitamin c gummies',
  'vitamin d3 gummies', 'berberine gummies', 'creatine gummies', "lion's mane gummies"
];

async function auditOne(cat, total) {
  const id = cat.id;
  const issues = [];
  const ok = [];

  // Get one sample product for field checks
  const { data: sample } = await DASH.from('products')
    .select('title,price,main_image_url,bsr_current,monthly_revenue,review_analysis,supplement_facts_raw,all_nutrients,marketing_analysis')
    .eq('category_id', id).limit(1);
  const p = sample?.[0] || {};
  const ma = p.marketing_analysis || {};
  const pi = ma.product_intelligence;
  const ra = p.review_analysis || {};

  // Count fields
  const count = async (col, notNull=true) => {
    const q = DASH.from('products').select('*',{count:'exact',head:true}).eq('category_id',id);
    const {count:c} = await (notNull ? q.not(col,'is',null) : q.is(col,null));
    return c||0;
  };

  const p3n = await count('review_analysis');
  const p4sfr = await count('supplement_facts_raw');
  const p4an = await count('all_nutrients');
  const p6n = await count('marketing_analysis');

  // P3 check
  const pct3 = Math.round(p3n/total*100);
  pct3>=90 ? ok.push(`P3 reviews: ${pct3}%`) : issues.push(`P3 reviews: ${pct3}% (need ≥90%)`);
  ra.top_reviews?.length ? ok.push(`P3 review text: ✅`) : issues.push(`P3 review text: ❌ missing (modal empty)`);

  // P4 check
  const pct4sfr = Math.round(p4sfr/total*100);
  const pct4an = Math.round(p4an/total*100);
  pct4sfr>=70 ? ok.push(`P4 supplement_facts_raw: ${pct4sfr}%`) : issues.push(`P4 supplement_facts_raw: ${pct4sfr}% — OCR not migrated`);
  pct4an>=70 ? ok.push(`P4 all_nutrients: ${pct4an}%`) : issues.push(`P4 all_nutrients: ${pct4an}%`);

  // P6 check
  const pct6 = Math.round(p6n/total*100);
  pct6>=90 ? ok.push(`P6 marketing_analysis: ${pct6}%`) : issues.push(`P6 marketing_analysis: ${pct6}% (need ≥90%)`);
  if (!pi) issues.push(`P6: no product_intelligence key — P6 schema broken`);
  else if (!pi.primary_active_ingredient) issues.push(`P6: old schema — no primary_active_ingredient (rerun P6)`);
  else ok.push(`P6 generic fields: ✅ (${pi.primary_active_ingredient})`);

  // P8 packaging
  ma.packaging_intelligence ? ok.push(`P8 packaging: ✅`) : issues.push(`P8: no packaging_intelligence`);

  // P9/P10 formula_briefs
  const { data: fb } = await DASH.from('formula_briefs').select('ingredients,positioning').eq('category_id', id).maybeSingle();
  const ing = fb?.ingredients || {};
  ing.ai_generated_brief_grok ? ok.push(`P9 Grok brief: ✅ ${Math.round((ing.ai_generated_brief_grok.length)/1000)}k`) : issues.push(`P9: no Grok brief`);
  ing.ai_generated_brief_claude ? ok.push(`P9 Claude brief: ✅ ${Math.round((ing.ai_generated_brief_claude.length)/1000)}k`) : issues.push(`P9: no Claude brief`);
  ing.adjusted_formula ? ok.push(`P10 adjusted_formula: ✅`) : issues.push(`P10: no adjusted_formula`);
  ing.comprehensive_comparison ? ok.push(`P10 comparison: ✅`) : issues.push(`P10: no comprehensive_comparison`);
  ing.market_intelligence ? ok.push(`P7 market_intel: ✅`) : issues.push(`P7: no market_intelligence`);

  return { name: cat.name, id, total, issues, ok };
}

async function main() {
  console.log('\n🔍 BARRY AUDIT v2 — Production Categories Only\n' + '═'.repeat(60));

  const { data: cats } = await DASH.from('categories').select('id,name').order('name');

  // Filter to real categories: no "=" prefix, name matches our keywords
  const realCats = (cats||[]).filter(c => {
    if (c.name.startsWith('=')) return false;
    if (c.name.toLowerCase().includes('demo')) return false;
    const lower = c.name.toLowerCase();
    return REAL_KEYWORDS.some(k => {
      const words = k.split(' ');
      return words.every(w => lower.includes(w.replace("'",'')));
    });
  });

  // Also get counts for each
  const results = [];
  for (const cat of realCats) {
    const { count: total } = await DASH.from('products').select('*',{count:'exact',head:true}).eq('category_id', cat.id);
    if (!total || total < 5) continue; // skip near-empty
    process.stdout.write(`Auditing ${cat.name} (${total} products)...\n`);
    const r = await auditOne(cat, total);
    results.push(r);
  }

  // Print results
  const pass = [], fail = [];
  for (const r of results) {
    console.log(`\n${'─'.repeat(60)}`);
    const status = r.issues.length === 0 ? '✅ CLEAN' : `⚠️  ${r.issues.length} ISSUE(S)`;
    console.log(`${status} | ${r.name} | ${r.total} products`);
    if (r.issues.length) {
      console.log('  ISSUES:');
      r.issues.forEach(i => console.log(`    ❌ ${i}`));
    }
    console.log('  OK:');
    r.ok.forEach(o => console.log(`    ✅ ${o}`));
    (r.issues.length ? fail : pass).push(r.name);
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`\n📊 SUMMARY: ${pass.length} clean / ${fail.length} need fixes`);
  if (fail.length) {
    console.log('\nNEED ACTION:');
    fail.forEach(n => console.log(`  🔧 ${n}`));
  }
  if (pass.length) {
    console.log('\nCLEAN:');
    pass.forEach(n => console.log(`  ✅ ${n}`));
  }
}
main().catch(console.error);
