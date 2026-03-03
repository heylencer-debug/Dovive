/**
 * Dovive Database Migrations
 * Adds missing columns to existing tables
 */

require('dotenv').config();
const fetch = require('node-fetch');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// SQL migrations
const migrations = [
  // dovive_jobs table additions
  `ALTER TABLE dovive_jobs ADD COLUMN IF NOT EXISTS started_at timestamptz;`,
  `ALTER TABLE dovive_jobs ADD COLUMN IF NOT EXISTS completed_at timestamptz;`,
  `ALTER TABLE dovive_jobs ADD COLUMN IF NOT EXISTS error_message text;`,
  `ALTER TABLE dovive_jobs ADD COLUMN IF NOT EXISTS triggered_by text DEFAULT 'manual';`,

  // dovive_research table additions
  `ALTER TABLE dovive_research ADD COLUMN IF NOT EXISTS brand text;`,
  `ALTER TABLE dovive_research ADD COLUMN IF NOT EXISTS category text;`,
  `ALTER TABLE dovive_research ADD COLUMN IF NOT EXISTS is_sponsored boolean DEFAULT false;`,

  // dovive_reports table additions (for recommendation field)
  `ALTER TABLE dovive_reports ADD COLUMN IF NOT EXISTS recommendation text;`,

  // DEDUP FIX: Add unique constraint on (asin, keyword) to prevent duplicates
  // First clean up existing duplicates (keep oldest row per asin+keyword)
  `DELETE FROM dovive_products WHERE id NOT IN (SELECT MIN(id) FROM dovive_products GROUP BY asin, keyword);`,

  // Then add unique constraint for upsert to work properly
  `ALTER TABLE dovive_products DROP CONSTRAINT IF EXISTS dovive_products_asin_keyword_key;`,
  `ALTER TABLE dovive_products ADD CONSTRAINT dovive_products_asin_keyword_key UNIQUE (asin, keyword);`,

  // Same for dovive_research table
  `DELETE FROM dovive_research WHERE id NOT IN (SELECT MIN(id) FROM dovive_research GROUP BY asin, keyword);`,
  `ALTER TABLE dovive_research DROP CONSTRAINT IF EXISTS dovive_research_asin_keyword_key;`,
  `ALTER TABLE dovive_research ADD CONSTRAINT dovive_research_asin_keyword_key UNIQUE (asin, keyword);`,

  // dovive_reports - add unique constraint on keyword for upsert
  `DELETE FROM dovive_reports WHERE id NOT IN (SELECT MIN(id) FROM dovive_reports GROUP BY keyword);`,
  `ALTER TABLE dovive_reports DROP CONSTRAINT IF EXISTS dovive_reports_keyword_key;`,
  `ALTER TABLE dovive_reports ADD CONSTRAINT dovive_reports_keyword_key UNIQUE (keyword);`
];

async function runMigration(sql) {
  try {
    // Use Supabase's RPC endpoint for raw SQL
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sql })
    });

    if (!res.ok) {
      // Try alternative approach - direct query (may not work without function)
      console.log(`  Note: RPC method not available, columns may already exist or need manual migration`);
      return { success: false, method: 'rpc' };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function checkColumnExists(table, column) {
  try {
    // Try to select the column - if it doesn't exist, will error
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=${column}&limit=1`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log('Dovive Database Migration');
  console.log('=========================\n');

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_KEY must be set');
    process.exit(1);
  }

  // Check which columns already exist
  console.log('Checking existing columns...\n');

  const checks = [
    ['dovive_jobs', 'started_at'],
    ['dovive_jobs', 'completed_at'],
    ['dovive_jobs', 'error_message'],
    ['dovive_jobs', 'triggered_by'],
    ['dovive_research', 'brand'],
    ['dovive_research', 'category'],
    ['dovive_research', 'is_sponsored'],
    ['dovive_reports', 'recommendation']
  ];

  const missingColumns = [];

  for (const [table, column] of checks) {
    const exists = await checkColumnExists(table, column);
    const status = exists ? 'EXISTS' : 'MISSING';
    console.log(`  ${table}.${column}: ${status}`);
    if (!exists) {
      missingColumns.push({ table, column });
    }
  }

  console.log('');

  if (missingColumns.length === 0) {
    console.log('All columns already exist! No migrations needed.');
    return;
  }

  console.log(`Found ${missingColumns.length} missing columns.`);
  console.log('');
  console.log('To add these columns, run the following SQL in Supabase SQL Editor:');
  console.log('');
  console.log('------------------------------------------------------------');

  for (const sql of migrations) {
    console.log(sql);
  }

  console.log('------------------------------------------------------------');
  console.log('');
  console.log('Copy the above SQL statements and run them in:');
  console.log('https://supabase.com/dashboard/project/fhfqjcvwcxizbioftvdw/sql/new');
}

main().catch(console.error);
