/**
 * run-pipeline.js — Full Scout Pipeline Orchestrator
 *
 * Runs P1 → P2 → P3 → P4 → P5 → P6 → P7 → P8 → P9 → P10 for a keyword.
 * P6 = Product Intelligence (per-product AI scoring — powers 9 dashboard sections)
 * P7 = Market Intelligence (category-level Grok report — powers Market tab)
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
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
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
const _fromFlag = process.argv.includes('--from-phase') ? '--from-phase' : process.argv.includes('--from') ? '--from' : null;
const FROM_PHASE = _fromFlag
  ? parseInt(process.argv[process.argv.indexOf(_fromFlag) + 1].replace('P', ''))
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

// ─── Pipeline Lock File (prevent duplicate runs) ──────────────────────────────
const LOCK_FILE = path.join(SCOUT_DIR, `.pipeline-lock-${KEYWORD.replace(/\s+/g, '-')}`);
if (require('fs').existsSync(LOCK_FILE)) {
  const lockAge = Date.now() - require('fs').statSync(LOCK_FILE).mtimeMs;
  if (lockAge < 4 * 60 * 60 * 1000) { // 4 hour max
    console.error(`❌ Pipeline already running for "${KEYWORD}" (lock file exists, age: ${Math.round(lockAge/60000)}m). Kill it first or delete: ${LOCK_FILE}`);
    process.exit(1);
  }
  console.warn(`⚠ Stale lock file removed (age: ${Math.round(lockAge/60000)}m)`);
}
require('fs').writeFileSync(LOCK_FILE, String(process.pid));
process.on('exit', () => { try { require('fs').unlinkSync(LOCK_FILE); } catch {} });
process.on('SIGINT', () => process.exit(1));
process.on('SIGTERM', () => process.exit(1));

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
  const words = KEYWORD.toLowerCase().split(' ');
  // Get all candidate categories
  const { data: cats } = await DASH.from('categories').select('id, name').ilike('name', `%${words[0]}%`).limit(30);
  if (!cats?.length) return null;

  // Score by word match count
  const scored = cats.map(c => {
    const lower = c.name.toLowerCase();
    const score = words.filter(w => lower.includes(w)).length;
    return { ...c, score };
  }).filter(c => c.score >= words.length) // must match ALL words
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;

  // If multiple exact-word matches, pick the one with the most products
  const topScore = scored[0].score;
  const tied = scored.filter(c => c.score === topScore);
  if (tied.length === 1) {
    console.log(`  → Category resolved: "${tied[0].name}" (${tied[0].id})`);
    return tied[0].id;
  }

  // Tie-break: pick category with most products
  const counts = await Promise.all(tied.map(async c => {
    const { count } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', c.id);
    return { ...c, count: count || 0 };
  }));
  counts.sort((a, b) => b.count - a.count);
  console.log(`  → Category resolved (largest): "${counts[0].name}" (${counts[0].id}) — ${counts[0].count} products`);
  return counts[0].id;
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
      // Require ≥50% coverage before considering P3 done (avoid skipping on partial Apify runs)
      return { done: count >= total * 0.5, count, total, msg: `${count}/${total} have review analysis` };
    }
    case 4: {
      const { count } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', categoryId).not('supplement_facts_raw', 'is', null);
      return { done: count >= total * 0.8, count, total, msg: `${count}/${total} have OCR data` };
    }
    case 5: {
      const { count } = await DOVIVE.from('dovive_phase5_research').select('*', { count: 'exact', head: true }).ilike('keyword', `%${KEYWORD.split(' ')[0]}%`);
      return { done: count >= 10, count, total: 20, msg: `${count}/20 deep research records (Top 10 BSR + Top 10 New Brands)` };
    }
    case 6: {
      const { count } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', categoryId).not('marketing_analysis', 'is', null);
      return { done: count >= total * 0.9, count, total, msg: `${count}/${total} have P6 intel` };
    }
    case 7: {
      // P7 = Market Intelligence (phase6-market-analysis.js)
      const { data: fb } = await DASH.from('formula_briefs').select('ingredients').eq('category_id', categoryId).single();
      const hasMarketIntel = !!(fb?.ingredients?.market_intelligence?.ai_market_analysis);
      return { done: hasMarketIntel, count: hasMarketIntel ? 1 : 0, total: 1, msg: hasMarketIntel ? 'Market intelligence report exists' : 'Market intelligence not generated yet' };
    }
    case 8: {
      // P8 = Packaging Intelligence (phase7-packaging-intelligence.js)
      const { data: sample } = await DASH.from('products').select('marketing_analysis').eq('category_id', categoryId).not('marketing_analysis', 'is', null).limit(5);
      const hasP8 = sample?.some(p => p.marketing_analysis?.packaging_intelligence);
      const { count } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', categoryId).not('marketing_analysis', 'is', null);
      return { done: hasP8 && count >= total * 0.9, count, total, msg: hasP8 ? `${count}/${total} have packaging data` : 'Packaging not run yet' };
    }
    case 9: {
      // P9 = Formula Brief (phase8-formula-brief.js)
      const { data } = await DASH.from('formula_briefs').select('id, created_at, ingredients').eq('category_id', categoryId).limit(1);
      const hasBrief = !!(data?.[0]?.ingredients?.ai_generated_brief);
      return { done: hasBrief, count: hasBrief ? 1 : 0, total: 1, msg: hasBrief ? `Brief exists (${data[0].created_at?.split('T')[0]})` : 'No brief yet' };
    }
    default: return { done: false, count: 0, total: 0 };
  }
}

// ─── Pipeline Phases ──────────────────────────────────────────────────────────

const PHASES = [
  {
    num: 1, name: 'Amazon Scrape', description: 'Scrape Amazon search results for keyword',
    run: async () => {
      // human-bsr.js reads process.argv[2] as keyword (positional, not --keyword)
      await runScript('human-bsr.js', [KEYWORD]);
      console.log('\n→ Creating DASH category + migrating P1 products (migrate-p1-to-dash.js)...');
      await runScript('migrate-p1-to-dash.js', [KEYWORD]);
    }
  },
  {
    num: 2, name: 'Keepa Enrichment', description: 'Fetch BSR history, sales & revenue from Keepa',
    run: async () => {
      await runScript('keepa-phase2.js', [KEYWORD]);
      console.log('\n→ Syncing Keepa data to dashboard (migrate-keepa-to-dash.js)...');
      await runScript('migrate-keepa-to-dash.js', [KEYWORD]);
    }
  },
  {
    num: 3, name: 'Reviews', description: 'Scrape and analyze customer reviews (Apify)',
    run: async () => {
      // Use Apify scraper — avoids Amazon CAPTCHA blocks
      await runScript('apify-reviews.js', [KEYWORD]);
      console.log('\n→ Syncing reviews to dashboard (migrate-reviews-to-dash.js)...');
      await runScript('migrate-reviews-to-dash.js', [KEYWORD]);
    }
  },
  {
    num: 4, name: 'OCR / Formula Extraction', description: 'Extract supplement facts from product images',
    run: async () => {
      await runScript('phase4-text-extract.js', ['--keyword', KEYWORD]);
      console.log('\n→ Syncing OCR data to dashboard (migrate-ocr-to-dash.js)...');
      await runScript('migrate-ocr-to-dash.js', [KEYWORD]);
    }
  },
  {
    num: 5, name: 'Deep Research', description: 'Top 10 BSR + Top 10 New Brands — Grok 4.2 deep reasoning per product',
    run: async () => runScript('phase5-deep-research.js', ['--keyword', KEYWORD])
  },
  {
    num: 6, name: 'Product Intelligence', description: 'Per-product AI scoring — powers Formula Landscape, Extract Types, Dosage, Certs, Threat Levels, Top 10 (9 dashboard sections)',
    run: async () => runScript('phase6-product-intelligence.js', ['--keyword', KEYWORD])
  },
  {
    num: 7, name: 'Market Intelligence', description: 'Category-level Grok market report — powers Market tab analysis',
    run: async () => runScript('phase6-market-analysis.js', ['--keyword', KEYWORD])
  },
  {
    num: 8, name: 'Packaging Intelligence', description: 'Claims, badges, color signals, market gaps',
    run: async () => runScript('phase7-packaging-intelligence.js', ['--keyword', KEYWORD])
  },
  {
    num: 9, name: 'Formula Brief', description: 'CMO-ready formula specification',
    run: async () => runScript('phase8-formula-brief.js', ['--keyword', KEYWORD, ...(USE_AI ? ['--ai'] : [])])
  },
  {
    num: 10, name: 'Formula QA', description: 'QA specialist: dose validation, competitor head-to-head, formula adjustments',
    run: async () => {
      await runScript('phase9-formula-qa.js', ['--keyword', KEYWORD]);
      // Re-run market intelligence AFTER QA so formula_briefs record has fresh data
      console.log('\n→ Refreshing market intelligence in formula_briefs (post-QA)...');
      await runScript('phase6-market-analysis.js', ['--keyword', KEYWORD, '--force']);
      console.log('\n→ Seeding category_analyses for dashboard Benchmark Comparison...');
      await runScript('seed-category-analysis.js', [KEYWORD]);
    }
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

    // ── Strict sequential dependency gate ─────────────────────
    // Every phase requires ALL previous phases to be complete.
    // If previous phase failed, STOP immediately.
    if (phase.num > 1 && categoryId) {
      const prevResult = results[results.length - 1];
      if (prevResult && prevResult.status === 'error') {
        const msg = `🚫 P${phase.num} BLOCKED — P${prevResult.phase} (${prevResult.name}) failed.\nError: ${prevResult.error}\n\nFix P${prevResult.phase} first.`;
        console.error(`\n${'═'.repeat(60)}`);
        console.error(msg);
        console.error(`${'═'.repeat(60)}\n`);
        await notify(`🚫 Scout STOPPED at P${phase.num} for "${KEYWORD}"\n\nP${prevResult.phase} failed: ${prevResult.error?.slice(0,200)}\n\nFix P${prevResult.phase} then retry.`);
        results.push({ phase: phase.num, name: phase.name, status: 'blocked', msg: `P${prevResult.phase} not complete` });
        break;
      }
    }

    const phaseStart = Date.now();
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`P${phase.num}: ${phase.name}`);
    console.log(`Description: ${phase.description}`);

    // Remove skipping phases based on existing data - always run each phase
    const status = categoryId ? await checkPhaseStatus(phase.num, categoryId) : { done: false };

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
      await notify(`❌ P${phase.num} FAILED: ${phase.name}\nKeyword: "${KEYWORD}"\nError: ${err.message?.slice(0,300)}\n\nPipeline STOPPED. Fix this phase then restart from P${phase.num}.`);
      console.error('Pipeline stopped — fix this phase before continuing.');
      break; // ALWAYS stop on any phase failure
    }

    // Small delay between phases
    await new Promise(r => setTimeout(r, 2000));
  }

  // Final summary
  const totalElapsed = Math.round((Date.now() - startTime) / 1000);
  const completed = results.filter(r => r.status === 'complete').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const failed = results.filter(r => r.status === 'error').length;

  // Update DASH categories table with latest run_timestamp & updated_at
  if (categoryId) {
    try {
      const { error } = await DASH.from('categories').update({ run_timestamp: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', categoryId);
      if (error) {
        console.error('Failed to update category run_timestamp:', error.message);
      } else {
        console.log('Category run_timestamp updated in DASH');
      }
    } catch (e) {
      console.error('Error updating category:', e.message);
    }
  }

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
