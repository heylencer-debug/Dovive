const https = require('https');

const queries = [
  `CREATE POLICY "Allow anon insert dovive_research" ON dovive_research FOR INSERT TO anon WITH CHECK (true)`,
  `CREATE POLICY "Allow anon update dovive_research" ON dovive_research FOR UPDATE TO anon USING (true) WITH CHECK (true)`,
  `CREATE POLICY "Allow anon insert dovive_reviews" ON dovive_reviews FOR INSERT TO anon WITH CHECK (true)`,
  `CREATE POLICY "Allow anon insert dovive_jobs patch" ON dovive_jobs FOR UPDATE TO anon USING (true) WITH CHECK (true)`
];

async function runQuery(sql) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql });
    const req = https.request({
      hostname: 'api.supabase.com',
      path: '/v1/projects/fhfqjcvwcxizbioftvdw/database/query',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer sbp_930d9e5fe75da4d2415263ec1d37aaaa8b5aaab7',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  for (const sql of queries) {
    const label = sql.substring(0, 60) + '...';
    try {
      const r = await runQuery(sql);
      const parsed = JSON.parse(r.body);
      // policy already exists = ok
      if (parsed.message && parsed.message.includes('already exists')) {
        console.log('SKIP (exists):', label);
      } else {
        console.log(r.status === 201 ? 'OK:' : 'ERR:', label, r.status !== 201 ? r.body : '');
      }
    } catch (e) {
      console.error('ERR:', label, e.message);
    }
  }
  console.log('Done.');
})();
