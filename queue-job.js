const https = require('https');
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoZnFqY3Z3Y3hpemJpb2Z0dmR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNTcxMzgsImV4cCI6MjA4NzkzMzEzOH0.g8K40DjhvxE7u4JdHICqKc1dMxS4eZdMhfA11M8ZMBc';
const body = JSON.stringify({ status: 'queued', triggered_by: 'test', created_at: new Date().toISOString() });
const req = https.request({
  hostname: 'fhfqjcvwcxizbioftvdw.supabase.co',
  path: '/rest/v1/dovive_jobs',
  method: 'POST',
  headers: {
    'apikey': KEY,
    'Authorization': 'Bearer ' + KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
    'Content-Length': Buffer.byteLength(body)
  }
}, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const job = JSON.parse(d);
    console.log('Job queued! ID:', Array.isArray(job) ? job[0]?.id : job.id);
  });
});
req.on('error', e => console.error(e.message));
req.write(body);
req.end();
