// Dovive Supabase Configuration
// Powered by Scout
window.DOVIVE_SB = {
  url: 'https://fhfqjcvwcxizbioftvdw.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoZnFqY3Z3Y3hpemJpb2Z0dmR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNTcxMzgsImV4cCI6MjA4NzkzMzEzOH0.g8K40DjhvxE7u4JdHICqKc1dMxS4eZdMhfA11M8ZMBc'
};

// Helper: Supabase REST API fetch
window.sbFetch = async function(table, options = {}) {
  const { url, anonKey } = window.DOVIVE_SB;
  const { select = '*', filter = '', order = '', limit = '', single = false } = options;

  let endpoint = `${url}/rest/v1/${table}?select=${encodeURIComponent(select)}`;
  if (filter) endpoint += `&${filter}`;
  if (order) endpoint += `&order=${order}`;
  if (limit) endpoint += `&limit=${limit}`;

  const headers = {
    'apikey': anonKey,
    'Authorization': `Bearer ${anonKey}`,
    'Content-Type': 'application/json'
  };
  if (single) headers['Accept'] = 'application/vnd.pgrst.object+json';

  const res = await fetch(endpoint, { headers });
  if (!res.ok) throw new Error(`Supabase error: ${res.status}`);
  return res.json();
};

// Helper: Supabase insert
window.sbInsert = async function(table, data) {
  const { url, anonKey } = window.DOVIVE_SB;
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(`Supabase insert error: ${res.status}`);
  return res.json();
};

// Helper: Supabase update
window.sbUpdate = async function(table, filter, data) {
  const { url, anonKey } = window.DOVIVE_SB;
  const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(`Supabase update error: ${res.status}`);
  return res.json();
};

// Helper: Supabase delete
window.sbDelete = async function(table, filter) {
  const { url, anonKey } = window.DOVIVE_SB;
  const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
    method: 'DELETE',
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`,
      'Content-Type': 'application/json'
    }
  });
  if (!res.ok) throw new Error(`Supabase delete error: ${res.status}`);
  return true;
};
