/**
 * run-pipeline.js — Full Scout Pipeline Orchestrator
 *
 * Runs P1 → P2 → P3 → P4 → P5 → P6 → P7 → P8 for a keyword.
 * Checks existing data before each phase (skip if already done).
 * Sends Telegram status updates after each phase.
 *
 * Usage:
 *   node run-pipeline.js --keyword "ashwagandha gummies"
 *   node run-pipeline.js --keyword "ashwagandha gummies" --from P6
 *   node run-pipeline.js --keyword "ashwagandha gummies" --phases P6,P7,P8
 *   node run-pipeline.js --keyword "ashwagandha gummies" --ai   (enables AI for P8)
 *   node run-pipeline.js --keyword "ashwagandha gummies" --force (re-run all phases)
 */

require('dotenv').config();
const { execSync, spawn } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEwNDU2NDUsImV4cCI6MjA3NjYyMTY0NX0.VziSAuTdqcteRERIPCdrMy4vqQuHjeC3tvazE0E8nMM'
);
const DOVIVE = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const SCOUT_DIR = __dirname;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const OPENCLAW_GATEWAY = process.env.OPENCLAW_GATEWAY;
const OPENCLAW_TOKEN = process.env.OPENCLAW_TOKEN;

// ─── Args ─────────────────────────────────────────────────────────────────────

const KEYWORD = process.argv.includes('--keyword')
  ? process.argv[process.argv.indexOf('--keyword') + 1]
  : null;
const FROM_PHASE = process.argv.includes('--from')
  ? parseInt(process.argv[process.argv.indexOf('--from') + 1].replace('P', ''))
  : 1;
const ONLY_PHASES = process.argv.includes('--phases')
  ? process.argv[process.argv.indexOf('--phases') + 1].split(',').map(p => parseInt(p.replace('P', '')))
  : null;
const USE_AI = process.argv.includes('--ai');
const FORCE = process.argv.includes('--force');

if (!KEYWORD) {
  console.error('Usage: node run-pipeline.js --keyword "ashwagandha gummies" [--from P3] [--ai] [--force]');
  process.exit(1);
}

// ─── Telegram Notifications ───────────────────────────────────────────────────

async function notify(message) {
  if (!OPENCLAW_GATEWAY || !OPENCLAW_TOKEN) return;
  try {
    await fetch(`${OPENCLAW_GATEWAY}/api/message/send`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENCLAW_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'telegram', to: TELEGRAM_CHAT_ID, message })
    });
  } catch (e) {
    // Silent fail — notifications are best-effort
  }
}

// ─── Run a script with live output ───────────────────────────────────────────

function runScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [scriptPath, ...args], { cwd: SCOUT_DIR, stdio: 'inherit' });
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`Script exited with code ${code}`)));
  });
}

// ─── Phase Status Checks ──────────────────────────────────────────────────────

async function getCategoryId() {
  const { data } = await DASH.from('categories').select('id, name').ilike('name', `%${KEYWORD.split(' ')[0]}%`).limit(5);
  if (!data?.length) return null;
  // Find best match
  const exact = data.find(c => c.name.toLowerCase().includes(KEYWORD.toLowerCase()));
  return (exact || data[0]).id;
}

async function checkPhaseStatus(phaseNum, categoryId) {
  if (FORCE) return { done: false, count: 0, total: 0 };

  const { count: total } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', categoryId);
  if (!total) return { done: false, count: 0, total: 0 };

  switch (phaseNum) {
    case 1: return { done: total > 0, count: total, total, msg: `${total} products in DB` };
    case 2: {
      const { count } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', categoryId).not('monthly_sales', 'is', null);
      return { done: count >= total * 0.9, count, total, msg: `${count}/${total} have Keepa data` };
    }
    case 3: {
      const { count } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', categoryId).not('review_analysis', 'is', null);
      return { done: count > 0, count, total, msg: `${count}/${total} have review analysis` };
    }
    case 4: {
      const { count } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', categoryId).not('supplement_facts_raw', 'is', null);
      return { done: count >= total * 0.8, count, total, msg: `${count}/${total} have OCR data` };
    }
    case 5: {
      const { count } = await DOVIVE.from('dovive_phase5_research').select('*', { count: 'exact', head: true }).ilike('keyword', `%${KEYWORD.split(' ')[0]}%`);
      return { done: count >= 5, count, total: 10, msg: `${count}/10 deep research records` };
    }
    case 6: {
      const { count } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', categoryId).not('marketing_analysis', 'is', null);
      return { done: count >= total * 0.9, count, total, msg: `${count}/${total} have P6 intel` };
    }
    case 7: {
      const { data: sample } = await DASH.from('products').select('marketing_analysis').eq('category_id', categoryId).not('marketing_analysis', 'is', null).limit(5);
      const hasP7 = sample?.some(p => p.marketing_analysis?.packaging_intelligence);
      const { count } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', categoryId).not('marketing_analysis', 'is', null);
      return { done: hasP7 && count >= total * 0.9, count, total, msg: hasP7 ? `${count}/${total} have P7 data` : 'P7 not run yet' };
    }
    case 8: {
      const { data } = await DASH.from('formula_briefs').select('id, created_at').eq('category_id', categoryId).limit(1);
      return { done: data?.length > 0, count: data?.length || 0, total: 1, msg: data?.length ? `Brief exists (${data[0].created_at?.split('T')[0]})` : 'No brief yet' };
    }
    default: return { done: false, count: 0, total: 0 };
  }
}

// ─── Pipeline Phases ──────────────────────────────────────────────────────────

const PHASES = [
  {
    num: 1, name: 'Amazon Scrape', description: 'Scrape Amazon search results for keyword',
    run: async () => runScript('human-bsr.js', ['--keyword', KEYWORD])
  },
  {
    num: 2, name: 'Keepa Enrichment', description: 'Fetch BSR history, sales & revenue from Keepa',
    run: async () => runScript('keepa-phase2.js', [KEYWORD])
  },
  {
    num: 3, name: 'Reviews', description: 'Scrape and analyze customer reviews',
    run: async () => runScript('human-reviews.js', ['--keyword', KEYWORD])
  },
  {
    num: 4, name: 'OCR / Formula Extraction', description: 'Extract supplement facts from product images',
    run: async () => runScript('phase4-text-extract.js', ['--keyword', KEYWORD])
  },
  {
    num: 5, name: 'Deep Research', description: 'Top-10 competitor deep dive (Reddit, certs, clinical)',
    run: async () => runScript('phase5-save.js', ['--keyword', KEYWORD])
  },
  {
    num: 6, name: 'Product Intelligence', description: 'Formula scoring, extract types, dosage analysis',
    run: async () => runScript('phase6-product-intelligence.js')
  },
  {
    num: 7, name: 'Packaging Intelligence', description: 'Claims, badges, color signals, market gaps',
    run: async () => runScript('phase7-packaging-intelligence.js')
  },
  {
    num: 8, name: 'Formula Brief', description: 'CMO-ready formula specification',
    run: async () => runScript('phase8-formula-brief.js', ['--keyword', KEYWORD, ...(USE_AI ? ['--ai'] : [])])
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🔍 SCOUT PIPELINE — "${KEYWORD}"`);
  console.log(`${'═'.repeat(60)}\n`);

  // Get category
  const categoryId = await getCategoryId();
  if (!categoryId && FROM_PHASE > 1) {
    console.error('ERROR: Category not found. Run P1 first.');
    process.exit(1);
  }

  const startTime = Date.now();
  const results = [];
  const phasesToRun = ONLY_PHASES || PHASES.map(p => p.num);

  await notify(`🔍 Scout pipeline started for "${KEYWORD}"\nPhases: P${phasesToRun.join(', P')} | ${USE_AI ? 'AI-Enhanced' : 'Rule-Based'}`);

  for (const phase of PHASES) {
    if (!phasesToRun.includes(phase.num)) continue;
    if (phase.num < FROM_PHASE) continue;

    const phaseStart = Date.now();
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`P${phase.num}: ${phase.name}`);
    console.log(`Description: ${phase.description}`);

    // Check if already done
    const status = categoryId ? await checkPhaseStatus(phase.num, categoryId) : { done: false };
    if (status.done && !FORCE) {
      console.log(`✅ Already complete — ${status.msg} — SKIPPING`);
      results.push({ phase: phase.num, name: phase.name, status: 'skipped', msg: status.msg });
      continue;
    }

    if (status.count > 0 && !status.done) {
      console.log(`🔄 Partial data: ${status.msg} — RUNNING`);
    } else {
      console.log(`⬜ Not started — RUNNING`);
    }

    await notify(`▶️ P${phase.num} Starting: ${phase.name}`);

    try {
      await phase.run();
      const elapsed = Math.round((Date.now() - phaseStart) / 1000);
      console.log(`\n✅ P${phase.num} Complete (${elapsed}s)`);
      results.push({ phase: phase.num, name: phase.name, status: 'complete', elapsed });
      await notify(`✅ P${phase.num} Complete: ${phase.name} (${elapsed}s)`);
    } catch (err) {
      console.error(`\n❌ P${phase.num} FAILED: ${err.message}`);
      results.push({ phase: phase.num, name: phase.name, status: 'error', error: err.message });
      await notify(`❌ P${phase.num} Failed: ${phase.name}\n${err.message}`);

      // Stop pipeline on critical phases (P1, P2), continue on others
      if (phase.num <= 2) {
        console.error('Critical phase failed — stopping pipeline');
        break;
      }
      console.log('Non-critical phase failed — continuing...');
    }

    // Small delay between phases
    await new Promise(r => setTimeout(r, 2000));
  }

  // Final summary
  const totalElapsed = Math.round((Date.now() - startTime) / 1000);
  const completed = results.filter(r => r.status === 'complete').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const failed = results.filter(r => r.status === 'error').length;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`PIPELINE COMPLETE — "${KEYWORD}"`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`Total time: ${Math.floor(totalElapsed / 60)}m ${totalElapsed % 60}s`);
  console.log(`Results: ${completed} complete | ${skipped} skipped | ${failed} failed\n`);
  results.forEach(r => {
    const icon = r.status === 'complete' ? '✅' : r.status === 'skipped' ? '⏭️ ' : '❌';
    console.log(`  ${icon} P${r.phase}: ${r.name} — ${r.status}${r.elapsed ? ` (${r.elapsed}s)` : ''}${r.msg ? ` — ${r.msg}` : ''}${r.error ? ` — ${r.error}` : ''}`);
  });

  const summary = `🔍 Scout Pipeline Done: "${KEYWORD}"\n✅ ${completed} complete | ⏭️ ${skipped} skipped | ❌ ${failed} failed\nTotal: ${Math.floor(totalElapsed / 60)}m ${totalElapsed % 60}s\n\nPhases:\n${results.map(r => `${r.status === 'complete' ? '✅' : r.status === 'skipped' ? '⏭️' : '❌'} P${r.phase}: ${r.name}`).join('\n')}`;
  await notify(summary);
}

run().catch(async (e) => {
  console.error('PIPELINE ERROR:', e.message);
  await notify(`❌ Pipeline crashed: ${e.message}`);
  process.exit(1);
});
