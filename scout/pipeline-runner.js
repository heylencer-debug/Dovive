#!/usr/bin/env node
/**
 * pipeline-runner.js — pm2-managed Scout pipeline daemon
 *
 * Long-running process (never exits). Polls pipeline-queue.json every 30s.
 * When a keyword is found:
 *   1. Removes keyword from queue
 *   2. Spawns run-pipeline.js with that keyword
 *   3. Monitors for stalls (>10 min no log output = alert + kill + retry)
 *   4. Sends Telegram alerts on start / complete / fail / stall
 *   5. Retries up to MAX_RETRIES on failure
 *
 * To add a keyword: echo '["keyword"]' >> pipeline-queue.json
 * Or use: node add-to-queue.js "keyword"
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const QUEUE_FILE  = path.join(__dirname, 'pipeline-queue.json');
const LOG_DIR     = path.join(__dirname, 'logs');
const LOCK_GLOB   = path.join(__dirname, '.pipeline-lock-*');

const TELEGRAM_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '1424637649';
const MAX_RETRIES      = 2;
const POLL_INTERVAL_MS = 30_000;       // 30s between queue checks
const STALL_TIMEOUT_MS = 10 * 60_000; // 10 min no output = stall

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// ─── Telegram ─────────────────────────────────────────────────────────────────
async function telegram(msg) {
  if (!TELEGRAM_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg }),
    });
  } catch (e) { /* best effort */ }
}

// ─── Queue helpers ────────────────────────────────────────────────────────────
function loadQueue() {
  if (!fs.existsSync(QUEUE_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')); }
  catch { return []; }
}

function saveQueue(q) {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(q, null, 2));
}

function dequeue() {
  const q = loadQueue();
  if (!q.length) return null;
  const next = q.shift();
  saveQueue(q);
  return next;
}

// ─── Clear stale lock files ────────────────────────────────────────────────────
function clearLocks() {
  try {
    const files = fs.readdirSync(__dirname).filter(f => f.startsWith('.pipeline-lock-'));
    for (const f of files) {
      fs.unlinkSync(path.join(__dirname, f));
      log(`🔓 Cleared stale lock: ${f}`);
    }
  } catch {}
}

// ─── Logger ───────────────────────────────────────────────────────────────────
function log(msg) {
  console.log(`[${new Date().toISOString().replace('T',' ').slice(0,19)}] ${msg}`);
}

// ─── Run pipeline for a keyword (with stall detection + retries) ──────────────
async function runKeyword(keyword) {
  const slug = keyword.replace(/\s+/g, '-');
  const logFile = path.join(LOG_DIR, `pipeline-${slug}.log`);

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    if (attempt > 1) {
      log(`⟳  Retry ${attempt - 1}/${MAX_RETRIES} for "${keyword}" in 30s...`);
      await telegram(`⟳ Scout retry ${attempt-1}/${MAX_RETRIES} for "${keyword}"`);
      await sleep(30_000);
    }

    log(`▶️  Starting pipeline: "${keyword}" (attempt ${attempt})`);
    if (attempt === 1) await telegram(`▶️ Scout pipeline starting: "${keyword}"\nAttempt ${attempt}/${MAX_RETRIES + 1}`);

    // Clear any stale lock before spawning
    clearLocks();

    const logStream = fs.createWriteStream(logFile, { flags: attempt === 1 ? 'w' : 'a' });
    const child = spawn('node', ['run-pipeline.js', '--keyword', keyword], {
      cwd: __dirname,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let lastOutputTime = Date.now();
    let stallTimer = null;
    let exitCode = null;

    // Stream output to log file + stdout
    const onData = (data) => {
      lastOutputTime = Date.now();
      process.stdout.write(data);
      logStream.write(data);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    // Stall watchdog: check every 2 min, alert if no output for STALL_TIMEOUT_MS
    stallTimer = setInterval(async () => {
      const sinceLastOutput = Date.now() - lastOutputTime;
      if (sinceLastOutput > STALL_TIMEOUT_MS) {
        const mins = Math.round(sinceLastOutput / 60000);
        log(`⚠️  STALL DETECTED — "${keyword}" — no output for ${mins} minutes. Killing.`);
        await telegram(`⚠️ Scout STALLED: "${keyword}"\nNo output for ${mins} mins — killing and will retry.`);
        clearInterval(stallTimer);
        child.kill('SIGKILL');
      }
    }, 2 * 60_000);

    // Wait for exit
    exitCode = await new Promise((resolve) => {
      child.on('close', (code) => resolve(code));
      child.on('error', (err) => {
        log(`Process error: ${err.message}`);
        resolve(1);
      });
    });

    clearInterval(stallTimer);
    logStream.end();

    if (exitCode === 0) {
      log(`✅ Pipeline complete: "${keyword}"`);
      await telegram(`✅ Scout pipeline COMPLETE: "${keyword}"\nAll phases done. Check DASH for results.`);
      return true; // success
    } else {
      log(`❌ Pipeline failed (code ${exitCode}): "${keyword}"`);
      if (attempt <= MAX_RETRIES) {
        // Will retry
      } else {
        await telegram(`❌ Scout pipeline FAILED: "${keyword}"\nAll ${MAX_RETRIES + 1} attempts exhausted. Manual intervention needed.\nLog: ${logFile}`);
        return false;
      }
    }
  }
  return false;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Main loop ────────────────────────────────────────────────────────────────
async function main() {
  log('🔍 Scout Pipeline Runner started');
  log(`   Queue file: ${QUEUE_FILE}`);
  log(`   Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
  log(`   Stall timeout: ${STALL_TIMEOUT_MS / 60000} min`);
  log(`   Max retries: ${MAX_RETRIES}`);

  await telegram('🔍 Scout Pipeline Runner started on Hostinger\nPolling queue every 30s. Ready.');

  // Clear any stale locks from previous crashes
  clearLocks();

  // Continuous poll loop — NEVER exits
  while (true) {
    const keyword = dequeue();

    if (keyword) {
      await runKeyword(keyword);
    } else {
      // Queue empty — check every POLL_INTERVAL_MS
      log(`Queue empty — sleeping ${POLL_INTERVAL_MS / 1000}s`);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

main().catch(async (err) => {
  const msg = `💥 Scout Runner CRASHED: ${err.message}`;
  console.error(msg);
  try { await telegram(msg); } catch {}
  process.exit(1); // pm2 will auto-restart
});
