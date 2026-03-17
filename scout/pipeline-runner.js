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
const { createClient } = require('@supabase/supabase-js');
const { resolveCategory } = require('./utils/category-resolver');

const QUEUE_FILE  = path.join(__dirname, 'pipeline-queue.json');
const LOG_DIR     = path.join(__dirname, 'logs');
const LOCK_GLOB   = path.join(__dirname, '.pipeline-lock-*');

const TELEGRAM_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '1424637649';
const MAX_RETRIES      = 2;
const POLL_INTERVAL_MS = 30_000;       // 30s between queue checks
const STALL_TIMEOUT_MS = 10 * 60_000; // 10 min no output = stall
const AUTO_FIX_MAX_ATTEMPTS = parseInt(process.env.AUTO_FIX_MAX_ATTEMPTS || '2', 10);

// Auto-fix: if P4 completion < threshold after a full run, auto-queue re-run from P4.
const AUTO_FIX_P4_THRESHOLD = parseInt(process.env.AUTO_FIX_P4_THRESHOLD || '95', 10);

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// DASH client for post-run coverage checks
const DASH = createClient(
  process.env.DASH_URL || 'https://jwkitkfufigldpldqtbq.supabase.co',
  process.env.DASH_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);

async function lookupCategoryId(keyword) {
  try {
    const cat = await resolveCategory(DASH, keyword);
    return cat.id;
  } catch {
    return null;
  }
}

async function getP4Coverage(keyword) {
  const categoryId = await lookupCategoryId(keyword);
  if (!categoryId) return null;
  const { count: total } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', categoryId);
  if (!total) return { categoryId, total: 0, p4: 0, pct: 0 };
  const { count: p4 } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', categoryId).not('supplement_facts_raw', 'is', null);
  const pct = Math.round(((p4 || 0) / total) * 100);
  return { categoryId, total, p4: p4 || 0, pct };
}

function enqueueFront(item) {
  const q = loadQueue();
  q.unshift(item);
  saveQueue(q);
}


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

// Queue entries can be:
//   "keyword string"  → { keyword, fromPhase: 1, force: false }
//   { keyword, fromPhase, force }  → used as-is
function dequeue() {
  const q = loadQueue();
  if (!q.length) return null;
  const next = q.shift();
  saveQueue(q);
  if (typeof next === 'string') return { keyword: next, fromPhase: 1, force: false };
  return { keyword: next.keyword, fromPhase: next.fromPhase || 1, force: !!next.force };
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
async function runKeyword({ keyword, fromPhase = 1, force = false }) {
  const slug = keyword.replace(/\s+/g, '-');
  const logFile = path.join(LOG_DIR, `pipeline-${slug}.log`);

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    if (attempt > 1) {
      log(`⟳  Retry ${attempt - 1}/${MAX_RETRIES} for "${keyword}" in 30s...`);
      await telegram(`⟳ Scout retry ${attempt-1}/${MAX_RETRIES} for "${keyword}"`);
      await sleep(30_000);
    }

    const fromLabel = fromPhase > 1 ? ` from P${fromPhase}` : '';
    const forceLabel = force ? ' --force' : '';
    log(`▶️  Starting pipeline: "${keyword}"${fromLabel}${forceLabel} (attempt ${attempt})`);
    if (attempt === 1) await telegram(`▶️ Scout pipeline starting: "${keyword}"${fromLabel}${forceLabel}\nAttempt ${attempt}/${MAX_RETRIES + 1}`);

    // Clear any stale lock before spawning
    clearLocks();

    // Build args
    const args = ['run-pipeline.js', '--keyword', keyword];
    if (fromPhase > 1) args.push('--from', `P${fromPhase}`);
    if (force) args.push('--force');

    const logStream = fs.createWriteStream(logFile, { flags: attempt === 1 ? 'w' : 'a' });
    const child = spawn('node', args, {
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
      // Post-run auto-fix check: verify P4 coverage and auto-queue from P4 if low.
      let autoFixQueued = false;
      try {
        const c = await getP4Coverage(keyword);
        if (c && c.total > 0) {
          log(`📊 P4 coverage for "${keyword}": ${c.p4}/${c.total} (${c.pct}%)`);
          if (c.pct < AUTO_FIX_P4_THRESHOLD) {
            const qNow = loadQueue();
            const priorAttempts = qNow.filter(e => {
              const obj = typeof e === 'string' ? { keyword: e } : e;
              return (obj.keyword || '').toLowerCase() === keyword.toLowerCase() && String(obj.reason || '').startsWith('auto-fix:p4<');
            }).length;

            if (priorAttempts < AUTO_FIX_MAX_ATTEMPTS) {
              const fixItem = {
                keyword,
                fromPhase: 4,
                force: true,
                reason: `auto-fix:p4<${AUTO_FIX_P4_THRESHOLD}`,
                autoFixAttempt: priorAttempts + 1,
              };
              enqueueFront(fixItem);
              autoFixQueued = true;
              const msg = `🛠️ Auto-fix queued for "${keyword}"\nP4 coverage ${c.p4}/${c.total} (${c.pct}%) below threshold ${AUTO_FIX_P4_THRESHOLD}%\nQueued rerun: --from P4 --force (attempt ${priorAttempts + 1}/${AUTO_FIX_MAX_ATTEMPTS})`;
              log(msg.replace(/\n/g, ' | '));
              await telegram(msg);
            } else {
              const msg = `⚠️ Auto-fix limit reached for "${keyword}"\nP4 coverage still ${c.p4}/${c.total} (${c.pct}%) below ${AUTO_FIX_P4_THRESHOLD}% after ${AUTO_FIX_MAX_ATTEMPTS} auto-fix attempts.`;
              log(msg.replace(/\n/g, ' | '));
              await telegram(msg);
            }
          }
        }
      } catch (e) {
        log(`⚠️ Auto-fix check failed for "${keyword}": ${e.message}`);
      }

      log(`✅ Pipeline complete: "${keyword}"`);
      await telegram(`✅ Scout pipeline COMPLETE: "${keyword}"\nAll phases done. Check DASH for results.${autoFixQueued ? '\nAuto-fix from P4 has been queued.' : ''}`);
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
