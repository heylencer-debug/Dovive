const https = require('https');

const SUPABASE_URL = 'https://fhfqjcvwcxizbioftvdw.supabase.co';
const SUPABASE_KEY = 'sb_secret_Urw2XKj4d9QUsvcEnQrKBA_TzA_KEnH';

function fetchJson(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SUPABASE_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'count=exact'
      }
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ body: JSON.parse(data), headers: res.headers }); }
        catch(e) { resolve({ body: data, headers: res.headers }); }
      });
    }).on('error', reject);
  });
}

async function countByKeyword(table) {
  // Get all rows with keyword field
  const r = await fetchJson(`/rest/v1/${table}?select=keyword&limit=10000`);
  const rows = r.body;
  if (!Array.isArray(rows)) { console.error(`Error fetching ${table}:`, rows); return {}; }
  const counts = {};
  let nullCount = 0;
  for (const row of rows) {
    const k = row.keyword;
    if (!k) { nullCount++; continue; }
    counts[k] = (counts[k] || 0) + 1;
  }
  counts['(null/unknown)'] = nullCount;
  counts['_total'] = rows.length;
  return counts;
}

async function main() {
  console.log('Fetching live Supabase counts...\n');
  const [p1, p2, p3, p4] = await Promise.all([
    countByKeyword('dovive_research'),
    countByKeyword('dovive_keepa'),
    countByKeyword('dovive_reviews'),
    countByKeyword('dovive_ocr'),
  ]);

  console.log('=== P1 (dovive_research) ===');
  console.log(JSON.stringify(p1, null, 2));
  console.log('\n=== P2 (dovive_keepa) ===');
  console.log(JSON.stringify(p2, null, 2));
  console.log('\n=== P3 (dovive_reviews) ===');
  console.log(JSON.stringify(p3, null, 2));
  console.log('\n=== P4 (dovive_ocr) ===');
  console.log(JSON.stringify(p4, null, 2));

  // Build summary table
  const allKeywords = new Set([
    ...Object.keys(p1), ...Object.keys(p2), ...Object.keys(p3), ...Object.keys(p4)
  ]);
  allKeywords.delete('(null/unknown)');
  allKeywords.delete('_total');

  console.log('\n=== SUMMARY TABLE ===');
  console.log('Keyword | P1 | P2 | P3 | P4 | Status');
  console.log('--------|----|----|----|----|-------');
  for (const kw of [...allKeywords].sort()) {
    const p1c = p1[kw] || 0;
    const p2c = p2[kw] || 0;
    const p3c = p3[kw] || 0;
    const p4c = p4[kw] || 0;
    const status = p2c === 0 ? 'P2 MISSING' : p3c === 0 ? 'P3 MISSING' : p4c === 0 ? 'P4 MISSING' : 
                   (p2c < p1c ? 'P2 PARTIAL' : p4c < p1c ? 'P4 PARTIAL' : 'OK');
    console.log(`${kw} | ${p1c} | ${p2c} | ${p3c} | ${p4c} | ${status}`);
  }

  console.log('\nTotals: P1=' + p1['_total'] + ' P2=' + p2['_total'] + ' P3=' + p3['_total'] + ' P4=' + p4['_total']);
  console.log('Null/unknown: P2=' + p2['(null/unknown)'] + ' P3=' + p3['(null/unknown)'] + ' P4=' + p4['(null/unknown)']);
}

main().catch(console.error);
