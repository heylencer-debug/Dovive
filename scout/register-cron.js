/**
 * Register Dovive Scout Daily Cron Job
 * Registers a cron job with OpenClaw Gateway to run Scout daily at 6AM Manila time
 *
 * Run: node register-cron.js
 */

require('dotenv').config({ path: '../../.env' });
const fetch = require('node-fetch');

const OPENCLAW_GATEWAY = process.env.OPENCLAW_GATEWAY || 'http://127.0.0.1:18789';
const OPENCLAW_TOKEN = process.env.OPENCLAW_TOKEN || 'c2625f8b566a28a235d5ea2c7ce2883739948d9322f8f217';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fhfqjcvwcxizbioftvdw.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function registerCron() {
  console.log('📅 Registering Dovive Scout Daily Cron Job');
  console.log(`Gateway: ${OPENCLAW_GATEWAY}`);

  try {
    const res = await fetch(`${OPENCLAW_GATEWAY}/cron/add`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENCLAW_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Dovive Scout Daily',
        schedule: '0 6 * * 1-5', // 6AM weekdays
        timezone: 'Asia/Manila',
        action: {
          type: 'supabase_insert',
          url: SUPABASE_URL,
          table: 'dovive_jobs',
          data: {
            status: 'queued',
            triggered_by: 'cron'
          }
        }
      })
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('❌ Failed to register cron:', text);
      return;
    }

    const result = await res.json();
    console.log('✅ Cron job registered:', result);
  } catch (err) {
    console.error('❌ Error:', err.message);

    // Fallback: if gateway is not available, just output instructions
    console.log('\n📝 Manual Setup Instructions:');
    console.log('If OpenClaw Gateway is not running, you can:');
    console.log('1. Run scout manually: cd scout && npm start');
    console.log('2. Or use Windows Task Scheduler to run: node scout-agent.js --once');
    console.log('3. Or add a cron job when gateway is available');
  }
}

// Alternative: Insert job directly via Supabase
async function insertJobDirectly() {
  if (!SUPABASE_KEY) {
    console.log('No SUPABASE_KEY set, skipping direct job insert');
    return;
  }

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
        triggered_by: 'setup'
      })
    });

    if (res.ok) {
      console.log('✅ Test job queued successfully');
    }
  } catch (err) {
    console.error('Failed to insert job:', err.message);
  }
}

async function main() {
  await registerCron();

  // Optionally queue a test job
  const shouldTest = process.argv.includes('--test');
  if (shouldTest) {
    console.log('\n🧪 Queueing test job...');
    await insertJobDirectly();
  }
}

main();
