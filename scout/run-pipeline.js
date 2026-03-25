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
const { execSync, spawn, spawnSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const { resolveCategory } = require('./utils/category-resolver');

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
const RECOVER_SYNC = process.argv.includes('--recover') && process.argv[process.argv.indexOf('--recover') + 1] === 'sync';
const RUN_PHASE0 = process.argv.includes('--phase0');

if (!KEYWORD && !RUN_PHASE0) {
  console.error('Usage: node run-pipeline.js --keyword "ashwagandha gummies" [--from P3] [--ai] [--force]');
  console.error('       node run-pipeline.js --phase0              (market opportunity scan, no keyword needed)');
  console.error('       node run-pipeline.js --keyword "..." --phase0  (scan then run pipeline)');
  process.exit(1);
}

// Phase 0 standalone mode — scan all categories without running the main pipeline
if (RUN_PHASE0 && !KEYWORD) {
  console.log('\n→ Phase 0 standalone: Market Opportunity Scanner');
  const p0Args = process.argv.slice(2).filter(a => a !== '--phase0');
  const result = spawnSync('node', [path.join(__dirname, 'phase0-market-opportunity.js'), ...p0Args], { stdio: 'inherit' });
  process.exit(result.status || 0);
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

// ─── Phase-level retry with backoff ──────────────────────────────────────────
// 3 attempts: immediate → 30s → 60s
const MAX_PHASE_RETRIES = 3;
const RETRY_DELAYS_MS = [0, 30000, 60000];

async function runPhaseWithRetry(phase, categoryId) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_PHASE_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        const waitSec = RETRY_DELAYS_MS[attempt - 1] / 1000;
        console.log(`\n⏳ Retry ${attempt}/${MAX_PHASE_RETRIES} for P${phase.num} in ${waitSec}s...`);
        await notify(`⚠️ P${phase.num} retry ${attempt}/${MAX_PHASE_RETRIES}: ${phase.name}\nKeyword: "${KEYWORD}"\nError was: ${lastErr?.message?.slice(0, 200)}\nWaiting ${waitSec}s then retrying...`);
        await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
      }
      await phase.run();
      return; // success
    } catch (err) {
      lastErr = err;
      console.error(`\n❌ P${phase.num} attempt ${attempt} failed: ${err.message}`);
    }
  }
  throw lastErr; // all retries exhausted
}

// ─── Clear DASH/Dovive data for a phase (used with --force) ──────────────────
async function clearPhaseData(phaseNum, categoryId) {
  if (!categoryId) return;
  console.log(`  🗑️  Force-clearing P${phaseNum} data in DASH...`);
  try {
    switch (phaseNum) {
      case 3: // reviews
        await DASH.from('products').update({ review_analysis: null }).eq('category_id', categoryId);
        break;
      case 4: // OCR
        // IMPORTANT: do NOT wipe existing supplement_facts_raw before rerun.
        // Keep prior OCR visible in DASH while reprocessing to avoid temporary 0/X coverage in UI.
        // We only clear raw source rows so Phase 4 can repopulate fresh data.
        await DOVIVE.from('dovive_ocr').delete().eq('keyword', KEYWORD);
        break;
      case 5: // deep research
        await DOVIVE.from('dovive_phase5_research').delete().ilike('keyword', `%${KEYWORD.split(' ')[0]}%`);
        break;
      case 6: // product intelligence — only clear product_intelligence key, preserve packaging_intelligence
        {
          const { data: prods } = await DASH.from('products').select('id, marketing_analysis').eq('category_id', categoryId);
          for (const p of prods || []) {
            const existing = p.marketing_analysis || {};
            const { product_intelligence, ...rest } = existing; // remove only product_intelligence
            await DASH.from('products').update({ marketing_analysis: Object.keys(rest).length ? rest : null }).eq('id', p.id);
          }
        }
        break;
      case 7: // market intelligence — let P7 upsert handle it
        break;
      case 8: // packaging — only clear packaging_intelligence key, preserve product_intelligence
        {
          const { data: prods } = await DASH.from('products').select('id, marketing_analysis').eq('category_id', categoryId);
          for (const p of prods || []) {
            const existing = p.marketing_analysis || {};
            const { packaging_intelligence, ...rest } = existing; // remove only packaging_intelligence
            await DASH.from('products').update({ marketing_analysis: Object.keys(rest).length ? rest : null }).eq('id', p.id);
          }
        }
        break;
      case 9: // formula brief
        await DASH.from('formula_briefs').delete().eq('category_id', categoryId);
        break;
      case 10: // QA
        // No separate table — QA updates formula_briefs, let it overwrite
        break;
      case 11: // competitive benchmarking
        {
          const { data: prods } = await DASH.from('formula_briefs').select('id, ingredients').eq('category_id', categoryId).single();
          if (prods?.ingredients?.competitive_benchmarking) {
            const { competitive_benchmarking, ...rest } = prods.ingredients;
            await DASH.from('formula_briefs').update({ ingredients: Object.keys(rest).length ? rest : null }).eq('id', prods.id);
          }
        }
        break;
      case 12: // FDA compliance
        {
          const { data: prods } = await DASH.from('formula_briefs').select('id, ingredients').eq('category_id', categoryId).single();
          if (prods?.ingredients?.fda_compliance) {
            const { fda_compliance, ...rest } = prods.ingredients;
            await DASH.from('formula_briefs').update({ ingredients: Object.keys(rest).length ? rest : null }).eq('id', prods.id);
          }
        }
        break;
    }
    console.log(`  ✅ P${phaseNum} data cleared`);
  } catch (e) {
    console.warn(`  ⚠️ Clear warning (non-fatal): ${e.message}`);
  }
}

// ─── Phase Status Checks ──────────────────────────────────────────────────────

async function getCategoryId() {
  try {
    const cat = await resolveCategory(DASH, KEYWORD);
    console.log(`  → Category resolved (${cat.method}): "${cat.name}" (${cat.id})`);
    return cat.id;
  } catch (e) {
    console.error(`Category resolve error for "${KEYWORD}": ${e.message}`);
    return null;
  }
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
      // Strict P4 quality gate: only count rows with actual nutrients extracted.
      const { count } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', categoryId).gt('nutrients_count', 0);

      // Directive: if full completion isn't possible, top-20 BSR formula coverage is acceptable to proceed.
      const { data: top20 } = await DASH.from('products')
        .select('nutrients_count')
        .eq('category_id', categoryId)
        .not('bsr_current', 'is', null)
        .order('bsr_current', { ascending: true })
        .limit(20);
      const top20Done = (top20 || []).filter(p => (p.nutrients_count || 0) > 0).length;

      const doneByCoverage = count >= total * 0.8;
      const doneByTop20 = top20Done >= 20;
      return {
        done: doneByCoverage || doneByTop20,
        count,
        total,
        msg: `${count}/${total} have VALID OCR facts | Top20: ${top20Done}/20`
      };
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
    case 11: {
      // P11 = Competitive Formula Benchmarking (phase10-competitive-benchmarking.js)
      const { data: fb } = await DASH.from('formula_briefs').select('ingredients').eq('category_id', categoryId).single();
      const hasBenchmarking = !!(fb?.ingredients?.competitive_benchmarking?.sonnet_draft);
      return { done: hasBenchmarking, count: hasBenchmarking ? 1 : 0, total: 1, msg: hasBenchmarking ? 'Competitive benchmarking exists' : 'Benchmarking not run yet' };
    }
    case 12: {
      // P12 = FDA Compliance (phase11-fda-compliance.js)
      const { data: fb } = await DASH.from('formula_briefs').select('ingredients').eq('category_id', categoryId).single();
      const hasCompliance = !!(fb?.ingredients?.fda_compliance?.opus_analysis);
      return { done: hasCompliance, count: hasCompliance ? 1 : 0, total: 1, msg: hasCompliance ? `FDA compliance exists (score: ${fb.ingredients.fda_compliance.compliance_score}/100)` : 'FDA compliance not run yet' };
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
    run: async () => runScript('phase5-deep-research.js', ['--keyword', KEYWORD, ...(FORCE ? ['--force'] : [])])
  },
  {
    num: 6, name: 'Product Intelligence', description: 'Per-product AI scoring — powers Formula Landscape, Extract Types, Dosage, Certs, Threat Levels, Top 10 (9 dashboard sections)',
    run: async () => runScript('phase6-product-intelligence.js', ['--keyword', KEYWORD, ...(FORCE ? ['--force'] : [])])
  },
  {
    num: 7, name: 'Market Intelligence', description: 'Category-level Grok market report — powers Market tab analysis',
    run: async () => runScript('phase6-market-analysis.js', ['--keyword', KEYWORD, ...(FORCE ? ['--force'] : [])])
  },
  {
    num: 8, name: 'Packaging Intelligence', description: 'Claims, badges, color signals, market gaps',
    run: async () => runScript('phase7-packaging-intelligence.js', ['--keyword', KEYWORD, ...(FORCE ? ['--force'] : [])])
  },
  {
    num: 9, name: 'Formula Brief', description: 'CMO-ready formula specification',
    run: async () => runScript('phase8-formula-brief.js', ['--keyword', KEYWORD, ...(FORCE ? ['--force'] : []), ...(USE_AI ? ['--ai'] : [])])
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
  {
    num: 11, name: 'Competitive Formula Benchmarking', description: 'Ingredient-by-ingredient vs every competitor — Grok drafts, Claude Opus 4.6 validates',
    run: async () => runScript('phase10-competitive-benchmarking.js', ['--keyword', KEYWORD, ...(FORCE ? ['--force'] : [])])
  },
  {
    num: 12, name: 'FDA Compliance', description: 'FDA/DSHEA compliance with live NIH ODS data — Claude Opus 4.6 primary, Grok validates',
    run: async () => runScript('phase11-fda-compliance.js', ['--keyword', KEYWORD, ...(FORCE ? ['--force'] : [])])
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function runFinalVerifier(categoryId) {
  const { count: total } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', categoryId);
  const q = async (col) => (await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', categoryId).not(col, 'is', null)).count || 0;

  const p2 = await q('monthly_sales');
  const p3 = await q('review_analysis');
  const p4 = (await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', categoryId).gt('nutrients_count', 0)).count || 0;
  // P5 data lives in dovive_phase5_research (DOVIVE DB), not in DASH products table
  const p5 = (await DOVIVE.from('dovive_phase5_research').select('*', { count: 'exact', head: true }).ilike('keyword', `%${KEYWORD.split(' ')[0]}%`)).count || 0;
  const p6 = await q('marketing_analysis');
  const p8 = (await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', categoryId).filter('marketing_analysis->packaging_intelligence', 'not.is', null)).count || 0;

  const { data: top20 } = await DASH.from('products').select('nutrients_count').eq('category_id', categoryId).not('bsr_current', 'is', null).order('bsr_current', { ascending: true }).limit(20);
  const top20P4 = (top20 || []).filter(x => (x.nutrients_count || 0) > 0).length;

  const { data: fb } = await DASH.from('formula_briefs').select('ingredients').eq('category_id', categoryId).single();
  const p7 = !!(fb?.ingredients?.market_intelligence?.ai_market_analysis);
  const p9 = !!(fb?.ingredients?.ai_generated_brief);
  const p10 = !!(fb?.ingredients?.qa_report);
  const p11 = !!(fb?.ingredients?.competitive_benchmarking?.sonnet_draft);
  const p12 = !!(fb?.ingredients?.fda_compliance?.opus_analysis);

  const failures = [];
  if (!(p2 >= total * 0.9)) failures.push(`P2 ${p2}/${total} < 90%`);
  if (!(p3 >= total * 0.5)) failures.push(`P3 ${p3}/${total} < 50%`);
  if (!((p4 >= total * 0.8) || (top20P4 === 20))) failures.push(`P4 ${p4}/${total} and Top20 ${top20P4}/20`);
  if (!(p5 >= 20)) failures.push(`P5 ${p5}/20`);
  if (!(p6 >= total * 0.9)) failures.push(`P6 ${p6}/${total} < 90%`);
  if (!p7) failures.push('P7 market_intelligence missing');
  if (!(p8 >= total * 0.9)) failures.push(`P8 ${p8}/${total} < 90%`);
  if (!p9) failures.push('P9 ai_generated_brief missing');
  if (!p10) failures.push('P10 qa_report missing');
  if (!p11) failures.push('P11 competitive_benchmarking missing');
  if (!p12) failures.push('P12 fda_compliance missing');

  return { pass: failures.length === 0, failures, metrics: { total, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, top20P4 } };
}

async function run() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🔍 SCOUT PIPELINE — "${KEYWORD}"`);
  console.log(`${'═'.repeat(60)}\n`);

  // Get category
  const categoryId = await getCategoryId();
  if (!categoryId && (FROM_PHASE > 1 || RECOVER_SYNC)) {
    console.error('ERROR: Category not found. Run P1 first.');
    process.exit(1);
  }

  const startTime = Date.now();
  const results = [];
  const phasesToRun = ONLY_PHASES || PHASES.map(p => p.num);

  await notify(`🔍 Scout pipeline started for "${KEYWORD}"\nPhases: P${phasesToRun.join(', P')} | ${USE_AI ? 'AI-Enhanced' : 'Rule-Based'}`);

  // Phase 0: Market Opportunity Scan — runs before the main pipeline when --phase0 is passed with --keyword
  if (RUN_PHASE0) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log('P0: Market Opportunity Scan (pre-pipeline)');
    console.log(`${'─'.repeat(60)}`);
    try {
      await runScript('phase0-market-opportunity.js', []);
      console.log('\n→ Phase 0 complete. Continuing pipeline...\n');
    } catch (e) {
      console.warn(`\n⚠ Phase 0 failed (non-fatal, pipeline continues): ${e.message}\n`);
    }
  }

  if (RECOVER_SYNC) {
    console.log('\\n🔧 Recover mode: sync (keepa/reviews/ocr) + verifier');
    try {
      await runScript('migrate-keepa-to-dash.js', [KEYWORD]);
      await runScript('migrate-reviews-to-dash.js', [KEYWORD]);
      await runScript('migrate-ocr-to-dash.js', [KEYWORD]);
      const v = await runFinalVerifier(categoryId);
      console.log('Verifier metrics:', v.metrics);
      if (!v.pass) {
        console.error('❌ Verifier FAIL in recover sync:', v.failures.join(' | '));
        process.exit(2);
      }
      console.log('✅ Recover sync PASS');
      return;
    } catch (e) {
      console.error(`❌ Recover sync failed: ${e.message}`);
      process.exit(2);
    }
  }

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

    // Force-clear existing data so we get a clean overwrite
    if (FORCE && categoryId) {
      await clearPhaseData(phase.num, categoryId);
    }

    try {
      await runPhaseWithRetry(phase, categoryId);
      const elapsed = Math.round((Date.now() - phaseStart) / 1000);
      console.log(`\n✅ P${phase.num} Complete (${elapsed}s)`);
      results.push({ phase: phase.num, name: phase.name, status: 'complete', elapsed });
      await notify(`✅ P${phase.num} Complete: ${phase.name} (${elapsed}s)`);
    } catch (err) {
      console.error(`\n❌ P${phase.num} FAILED after ${MAX_PHASE_RETRIES} attempts: ${err.message}`);
      results.push({ phase: phase.num, name: phase.name, status: 'error', error: err.message });
      await notify(`🚨 P${phase.num} FAILED (${MAX_PHASE_RETRIES} retries exhausted): ${phase.name}\nKeyword: "${KEYWORD}"\nError: ${err.message?.slice(0,300)}\n\nPipeline STOPPED at P${phase.num}. Manual fix required.`);
      console.error('Pipeline stopped — all retries exhausted for this phase.');
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

  const verifier = categoryId ? await runFinalVerifier(categoryId) : { pass: false, failures: ['category not resolved'], metrics: {} };

  if (verifier.pass && failed === 0) {
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
  } else {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`PIPELINE INCOMPLETE — "${KEYWORD}"`);
    console.log(`${'═'.repeat(60)}`);
    console.log('Verifier FAIL:', verifier.failures.join(' | '));
    await notify(`❌ Pipeline incomplete for "${KEYWORD}"\nVerifier FAIL:\n- ${verifier.failures.join('\n- ')}`);
    process.exitCode = 2;
  }
}

run().catch(async (e) => {
  console.error('PIPELINE ERROR:', e.message);
  await notify(`❌ Pipeline crashed: ${e.message}`);
  process.exit(1);
});
