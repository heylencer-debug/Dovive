const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
);

async function main() {
  // P1: dovive_research
  const { data: p1, error: e1 } = await supabase
    .from('dovive_research')
    .select('keyword');
  if (e1) console.error('P1 error:', e1.message);

  // P2: dovive_keepa
  const { data: p2, error: e2 } = await supabase
    .from('dovive_keepa')
    .select('keyword');
  if (e2) console.error('P2 error:', e2.message);

  // P3: dovive_reviews
  const { data: p3, error: e3 } = await supabase
    .from('dovive_reviews')
    .select('keyword');
  if (e3) console.error('P3 error:', e3.message);

  // P4: dovive_ocr
  const { data: p4, error: e4 } = await supabase
    .from('dovive_ocr')
    .select('keyword');
  if (e4) console.error('P4 error:', e4.message);

  const count = (arr, kw) => arr ? arr.filter(r => r.keyword === kw).length : 0;
  
  // Get unique keywords from P1
  const keywords = [...new Set((p1 || []).map(r => r.keyword))].sort();
  
  const rows = keywords.map(kw => ({
    keyword: kw,
    p1: count(p1, kw),
    p2: count(p2, kw),
    p3: count(p3, kw),
    p4: count(p4, kw),
  }));

  console.log(JSON.stringify({
    totals: {
      p1: p1 ? p1.length : 0,
      p2: p2 ? p2.length : 0,
      p3: p3 ? p3.length : 0,
      p4: p4 ? p4.length : 0,
    },
    rows
  }, null, 2));
}

main().catch(console.error);
