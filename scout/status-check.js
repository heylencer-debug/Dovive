const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

let supabaseUrl, supabaseKey;

try {
  const env = fs.readFileSync('.env', 'utf8');
  env.split('\n').forEach(line => {
    const [k, ...rest] = line.split('=');
    if (k && rest.length) {
      const key = k.trim();
      const val = rest.join('=').trim().replace(/["']/g, '');
      if (key === 'SUPABASE_URL') supabaseUrl = val;
      if (key === 'SUPABASE_KEY' || key === 'SUPABASE_ANON_KEY' || key === 'SUPABASE_SERVICE_KEY') supabaseKey = val;
    }
  });
} catch(e) {
  console.error('No .env:', e.message);
}

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const sb = createClient(supabaseUrl, supabaseKey);

async function run() {
  const [p1all, p2all, p3all, p4all, p1kw, p2kw, p3kw, p4kw, p2null] = await Promise.all([
    sb.from('dovive_research').select('*', { count: 'exact', head: true }),
    sb.from('dovive_keepa').select('*', { count: 'exact', head: true }),
    sb.from('dovive_reviews').select('*', { count: 'exact', head: true }),
    sb.from('dovive_ocr').select('*', { count: 'exact', head: true }),
    sb.from('dovive_research').select('keyword').not('keyword', 'is', null),
    sb.from('dovive_keepa').select('keyword').not('keyword', 'is', null),
    sb.from('dovive_reviews').select('keyword').not('keyword', 'is', null),
    sb.from('dovive_ocr').select('keyword').not('keyword', 'is', null),
    sb.from('dovive_keepa').select('*', { count: 'exact', head: true }).is('keyword', null),
  ]);

  const countByKw = (arr) => {
    if (!arr) return {};
    return arr.reduce((acc, r) => {
      acc[r.keyword] = (acc[r.keyword] || 0) + 1;
      return acc;
    }, {});
  };

  console.log('P1_TOTAL:', p1all.count);
  console.log('P2_TOTAL:', p2all.count);
  console.log('P2_NULL:', p2null.count);
  console.log('P3_TOTAL:', p3all.count);
  console.log('P4_TOTAL:', p4all.count);
  console.log('P1_KW:', JSON.stringify(countByKw(p1kw.data)));
  console.log('P2_KW:', JSON.stringify(countByKw(p2kw.data)));
  console.log('P3_KW:', JSON.stringify(countByKw(p3kw.data)));
  console.log('P4_KW:', JSON.stringify(countByKw(p4kw.data)));
}

run().catch(e => { console.error('Error:', e); process.exit(1); });
