/**
 * Dovive Scout - Cron Registration
 * Registers a daily cron job with OpenClaw Gateway
 *
 * Schedule: 6AM Manila (PHT), Mon-Fri
 * This is UTC 22:00 the previous day (PHT = UTC+8)
 */

require('dotenv').config();
const fetch = require('node-fetch');

const OPENCLAW_GATEWAY = process.env.OPENCLAW_GATEWAY;
const OPENCLAW_TOKEN = process.env.OPENCLAW_TOKEN;

// Convert 6AM Manila to UTC: Manila is UTC+8, so 6AM Manila = 10PM (22:00) UTC previous day
// Schedule: "0 22 * * 0-4" = 10PM UTC Sun-Thu = 6AM PHT Mon-Fri
const CRON_SCHEDULE = '0 22 * * 0-4';

const cronPayload = {
  name: 'Dovive Scout Daily Run',
  schedule: CRON_SCHEDULE,
  payload: {
    kind: 'agentTurn',
    message: `Run Dovive Scout now. Queue a new job in dovive_jobs with triggered_by='cron' by running: node C:\\Users\\Carl Rebadomia\\.openclaw\\workspace\\dovive\\scout\\trigger-scout.js cron`
  },
  enabled: true,
  description: 'Daily Amazon market research scrape for Dovive supplement brand'
};

async function registerCron() {
  if (!OPENCLAW_GATEWAY || !OPENCLAW_TOKEN) {
    console.error('Error: OPENCLAW_GATEWAY and OPENCLAW_TOKEN must be set in environment');
    console.error('');
    console.error('These are found in scout/.env');
    process.exit(1);
  }

  console.log('Registering Dovive Scout daily cron with OpenClaw Gateway...');
  console.log('');
  console.log(`Gateway: ${OPENCLAW_GATEWAY}`);
  console.log(`Schedule: ${CRON_SCHEDULE} (6AM Manila, Mon-Fri)`);
  console.log('');

  try {
    const res = await fetch(`${OPENCLAW_GATEWAY}/cron/jobs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENCLAW_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(cronPayload)
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to register cron: ${res.status} - ${text}`);
    }

    const result = await res.json();
    console.log('Cron job registered successfully!');
    console.log('');
    console.log('Job details:');
    console.log(JSON.stringify(result, null, 2));
    console.log('');
    console.log('Scout will run automatically at 6AM Manila time, Monday through Friday.');
    console.log('You can also manually trigger with: node trigger-scout.js manual');

    return result;
  } catch (err) {
    console.error('Error:', err.message);

    // If it's a connection error, provide helpful message
    if (err.message.includes('ECONNREFUSED') || err.message.includes('fetch')) {
      console.error('');
      console.error('The OpenClaw Gateway might not be running.');
      console.error('Start it first, then retry this registration.');
    }

    process.exit(1);
  }
}

// List existing cron jobs
async function listCrons() {
  try {
    const res = await fetch(`${OPENCLAW_GATEWAY}/cron/jobs`, {
      headers: {
        'Authorization': `Bearer ${OPENCLAW_TOKEN}`
      }
    });

    if (res.ok) {
      const jobs = await res.json();
      console.log('Existing cron jobs:');
      console.log(JSON.stringify(jobs, null, 2));
    }
  } catch (err) {
    // Silent fail for listing
  }
}

// Run
if (require.main === module) {
  if (process.argv.includes('--list')) {
    listCrons();
  } else {
    registerCron();
  }
}

module.exports = { registerCron };
