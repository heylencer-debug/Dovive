// Supabase save helper — called by the OpenClaw scout agent
// Usage: node sb-save.js <table> <json_data>
require('dotenv').config();
const fetch = require('node-fetch');

const SB_URL = process.env.SUPABASE_URL || 'https://fhfqjcvwcxizbioftvdw.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function upsert(table, data, onConflict) {
  const url = `${SB_URL}/rest/v1/${table}${onConflict ? `?on_conflict=${onConflict}` : ''}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(Array.isArray(data) ? data : [data])
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} - ${text}`);
  }
  return true;
}

async function fetchKeywords() {
  const res = await fetch(`${SB_URL}/rest/v1/dovive_keywords?active=eq.true&select=*&order=priority.asc`, {
    headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` }
  });
  return res.json();
}

const [,, action, ...args] = process.argv;

(async () => {
  if (action === 'keywords') {
    const kws = await fetchKeywords();
    console.log(JSON.stringify(kws));
  } else if (action === 'save-product') {
    const data = JSON.parse(args[0]);
    await upsert('dovive_research', data, 'asin,keyword');
    console.log('OK saved ' + data.asin);
  } else if (action === 'save-products') {
    const rows = JSON.parse(args[0]);
    await upsert('dovive_research', rows, 'asin,keyword');
    console.log('OK saved ' + rows.length + ' products');
  } else if (action === 'save-report') {
    const data = JSON.parse(args[0]);
    await upsert('dovive_reports', data, 'keyword');
    console.log('OK saved report for ' + data.keyword);
  } else {
    console.error('Unknown action:', action);
    process.exit(1);
  }
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
