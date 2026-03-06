const https = require('https');
const K = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoZnFqY3Z3Y3hpemJpb2Z0dmR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNTcxMzgsImV4cCI6MjA4NzkzMzEzOH0.g8K40DjhvxE7u4JdHICqKc1dMxS4eZdMhfA11M8ZMBc';

async function patch(filter, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = https.request({
      hostname: 'fhfqjcvwcxizbioftvdw.supabase.co',
      path: `/rest/v1/dovive_jobs?${filter}`,
      method: 'PATCH',
      headers: { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ console.log(res.statusCode, filter); resolve(); }); });
    req.on('error', reject); req.write(body); req.end();
  });
}

(async () => {
  // Cancel stale running/queued jobs
  await patch('status=eq.running', { status: 'cancelled', finished_at: new Date().toISOString() });
  await patch('id=eq.31', { status: 'cancelled', finished_at: new Date().toISOString() });
  await patch('id=eq.32', { status: 'cancelled', finished_at: new Date().toISOString() });
  console.log('Cleaned up stale jobs.');
})();
