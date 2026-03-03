/**
 * Dovive Scout Trigger
 * Queues a new Scout job for processing
 *
 * Usage:
 *   node trigger-scout.js manual   - Manual trigger
 *   node trigger-scout.js cron     - Cron trigger
 */

require('dotenv').config();
const fetch = require('node-fetch');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function triggerScout(triggeredBy = 'manual') {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_KEY must be set in environment');
    process.exit(1);
  }

  console.log(`Queuing Scout job (triggered_by: ${triggeredBy})...`);

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/dovive_jobs`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        status: 'queued',
        triggered_by: triggeredBy
      })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to queue job: ${res.status} - ${text}`);
    }

    const [job] = await res.json();
    console.log(`Job queued successfully!`);
    console.log(`  Job ID: ${job.id}`);
    console.log(`  Status: ${job.status}`);
    console.log(`  Created: ${job.created_at}`);
    console.log('');
    console.log('Scout agent will pick this up within 60 seconds.');
    console.log('Watch the Dovive dashboard for results: https://heylencer-debug.github.io/Dovive');

    return job;
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  const triggeredBy = process.argv[2] || 'manual';
  triggerScout(triggeredBy);
}

module.exports = { triggerScout };
