require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const DASH = createClient('https://jwkitkfufigldpldqtbq.supabase.co','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc');
DASH.from('formula_briefs').select('ingredients').eq('category_id','820537da-3994-4a11-a2e0-a636d751b26f').single().then(r => {
  const qa = r.data?.ingredients?.qa_report || '';
  const hasQA = qa.length > 0;
  console.log('Has QA report:', hasQA, '| Length:', qa.length);
  // Find the COMPETITOR_NOTES_JSON section
  const notesSection = qa.match(/## COMPETITOR_NOTES_JSON[\s\S]{0,2000}/);
  console.log('Notes section sample:', notesSection?.[0]?.substring(0, 300));
  // Check score
  console.log('Verdict:', r.data?.ingredients?.qa_verdict);
});
