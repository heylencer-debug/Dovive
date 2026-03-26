require('dotenv').config({ path: '/tmp/Dovive/scout/.env' });
const { createClient } = require('@supabase/supabase-js');
const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);

async function check() {
  const { data: fb } = await DASH.from('formula_briefs').select('ingredients,updated_at').eq('category_id','2a57f3af-7d9e-4ef0-998f-ce60b3532dc5').single();
  const ing = (fb && fb.ingredients) || {};
  const cb  = ing.competitive_benchmarking || {};
  const fda = ing.fda_compliance || {};
  const p9  = (ing.ai_generated_brief_grok || '').length > 100 || (ing.ai_generated_brief || '').length > 100;
  const p10 = (ing.qa_report || '').length > 100;
  const p11 = (cb.sonnet_draft || cb.grok_draft || '').length > 100;
  const p12 = (fda.opus_analysis || '').length > 100;
  const { count: total }   = await DASH.from('products').select('*',{count:'exact',head:true}).eq('category_id','2a57f3af-7d9e-4ef0-998f-ce60b3532dc5');
  const { count: withOcr } = await DASH.from('products').select('*',{count:'exact',head:true}).eq('category_id','2a57f3af-7d9e-4ef0-998f-ce60b3532dc5').not('supplement_facts_raw','is',null);
  console.log('══════════════════════════════════════');
  console.log('  Biotin Gummies — Pipeline Status   ');
  console.log('══════════════════════════════════════');
  console.log('  OCR Coverage:  ' + withOcr + '/' + total + ' (' + Math.round(withOcr/total*100) + '%)');
  console.log('  Last updated:  ' + (fb && fb.updated_at ? new Date(fb.updated_at).toLocaleTimeString() : 'unknown'));
  console.log('');
  console.log('  P9  Formula Brief:     ' + (p9  ? 'DONE' : 'pending...'));
  console.log('  P10 Formula QA:        ' + (p10 ? 'DONE' : 'pending...'));
  console.log('  P11 Comp Benchmark:    ' + (p11 ? 'DONE' + (cb.formula_score != null ? ' ('+cb.formula_score+'/10)':'') : 'pending...'));
  console.log('  P12 FDA Compliance:    ' + (p12 ? 'DONE' + (fda.compliance_score != null ? ' ('+fda.compliance_score+'/100 · '+fda.compliance_status+')':'') : 'pending...'));
  console.log('══════════════════════════════════════');
}
check().catch(console.error);
