/**
 * phase0-market-opportunity.js — Market Opportunity Scanner (Pre-Pipeline)
 *
 * Analyzes all existing categories + products in DASH DB to rank supplement
 * keywords by market opportunity — helping prioritize which pipeline runs to do next.
 *
 * Ranking criteria (composite 0-100 score):
 *   40pts — Total category monthly revenue (market size proxy)
 *   20pts — BSR velocity (growth proxy — % rising/surging products)
 *   15pts — Avg revenue per product (per-unit opportunity)
 *   15pts — Competition gap (inverse of high-threat product density)
 *   10pts — Consumer quality signal (avg rating normalized)
 *
 * Works with partial data: categories with only P1 scrape score lower but still appear,
 * flagged with their data completeness level.
 *
 * Output:
 *   - Console: ranked table + per-category rationale
 *   - Vault: C:\SirPercival-Vault\07_ai-systems\agents\scout\market-intelligence\
 *            YYYY-MM-DD-phase0-opportunities.md
 *
 * Usage:
 *   node phase0-market-opportunity.js
 *   node phase0-market-opportunity.js --top 15
 *   node phase0-market-opportunity.js --min-products 5
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const DASH = createClient(
  'https://jwkitkfufigldpldqtbq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3a2l0a2Z1ZmlnbGRwbGRxdGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA0NTY0NSwiZXhwIjoyMDc2NjIxNjQ1fQ.FjLFaMPE4VO5vVwFEAAvLiub3Xc1hhjsv9fd2jWFIAc'
);

// ─── Args ─────────────────────────────────────────────────────────────────────

const TOP_N = process.argv.includes('--top')
  ? Math.max(1, parseInt(process.argv[process.argv.indexOf('--top') + 1]) || 10)
  : 10;

const MIN_PRODUCTS = process.argv.includes('--min-products')
  ? Math.max(1, parseInt(process.argv[process.argv.indexOf('--min-products') + 1]) || 3)
  : 3;

// ─── Math helpers ─────────────────────────────────────────────────────────────

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function fmt$(n) {
  if (!n) return '$0';
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}k`;
  return `$${Math.round(n)}`;
}

// ─── Per-category metrics ─────────────────────────────────────────────────────

function computeMetrics(products) {
  const total = products.length;
  const revenues = products.map(p => p.monthly_revenue || 0).filter(r => r > 0);
  const bsrs = products.map(p => p.bsr_current).filter(Boolean);
  const ratings = products.map(p => p.rating_value).filter(Boolean);
  const reviewCounts = products.map(p => p.rating_count).filter(Boolean);
  const prices = products.map(p => parseFloat(p.price || 0)).filter(Boolean);

  let risingCount = 0;
  let highThreatCount = 0;
  const formulaScores = [];
  const certCounts = {};
  const gaps = [];

  for (const p of products) {
    const pi = p.marketing_analysis?.product_intelligence || {};
    const velocity = pi.velocity_direction;
    if (velocity === 'rocket' || velocity === 'rising') risingCount++;
    const threat = pi.competitor_threat_level;
    if (threat === 'Very High' || threat === 'High') highThreatCount++;
    if (pi.formula_quality_score) formulaScores.push(pi.formula_quality_score);
    for (const c of (pi.certifications || [])) certCounts[c] = (certCounts[c] || 0) + 1;
    if (pi.market_opportunity_gap) gaps.push(pi.market_opportunity_gap);
  }

  const totalRevenue = revenues.reduce((s, r) => s + r, 0);
  const avgRevenue = revenues.length ? totalRevenue / revenues.length : 0;
  const avgRating = avg(ratings);
  const medianBsr = median(bsrs);
  const avgPrice = avg(prices);
  const growthPct = total > 0 ? risingCount / total : 0;
  const threatPct = total > 0 ? highThreatCount / total : 0;
  const avgFormula = formulaScores.length ? avg(formulaScores) : null;

  // Data completeness flags
  const hasKeepa = revenues.length > 0;
  const hasP6 = products.some(p => p.marketing_analysis?.product_intelligence);
  const keepaCoverage = total > 0 ? Math.round(revenues.length / total * 100) : 0;
  const p6Coverage = total > 0
    ? Math.round(products.filter(p => p.marketing_analysis?.product_intelligence).length / total * 100)
    : 0;

  const topCerts = Object.entries(certCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c);

  return {
    total,
    totalRevenue,
    avgRevenue,
    avgRating,
    avgPrice,
    medianBsr,
    growthPct,
    threatPct,
    avgFormula,
    hasKeepa,
    hasP6,
    keepaCoverage,
    p6Coverage,
    topCerts,
    gaps: gaps.slice(0, 5),
    risingCount,
    highThreatCount,
    // placeholders filled by scoreCategories()
    scores: null,
    totalScore: 0,
  };
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function scoreCategories(allMetrics) {
  const totalRevenues = allMetrics.map(m => m.metrics.totalRevenue);
  const avgRevenues = allMetrics.map(m => m.metrics.avgRevenue);
  const maxTotalRevenue = Math.max(...totalRevenues, 1);
  const maxAvgRevenue = Math.max(...avgRevenues, 1);

  for (const entry of allMetrics) {
    const m = entry.metrics;

    // 40pts: Total revenue (log-normalized to dampen outlier dominance)
    const revScore = Math.log(m.totalRevenue + 1) / Math.log(maxTotalRevenue + 1) * 40;

    // 20pts: Growth proxy — % of products rising/surging (only meaningful when P6 run)
    const growthScore = m.growthPct * 20;

    // 15pts: Avg revenue per product (per-unit opportunity, log-normalized)
    const perProdScore = Math.log(m.avgRevenue + 1) / Math.log(maxAvgRevenue + 1) * 15;

    // 15pts: Competition gap — fewer high-threat products = more room to enter
    const gapScore = (1 - m.threatPct) * 15;

    // 10pts: Consumer quality signal (avg rating, normalized 1-5 → 0-1; default 5/10 if no data)
    const qualityScore = m.avgRating > 0 ? ((m.avgRating - 1) / 4) * 10 : 5;

    m.scores = {
      rev: Math.round(revScore * 10) / 10,
      growth: Math.round(growthScore * 10) / 10,
      perProd: Math.round(perProdScore * 10) / 10,
      gap: Math.round(gapScore * 10) / 10,
      quality: Math.round(qualityScore * 10) / 10,
    };
    m.totalScore = Math.round(revScore + growthScore + perProdScore + gapScore + qualityScore);
  }

  return allMetrics.sort((a, b) => b.metrics.totalScore - a.metrics.totalScore);
}

// ─── Rationale builder ────────────────────────────────────────────────────────

function buildRationale(metrics) {
  const parts = [];

  if (metrics.hasKeepa && metrics.totalRevenue > 0) {
    parts.push(`${fmt$(metrics.totalRevenue)}/mo across ${metrics.total} products`);
  } else {
    parts.push(`${metrics.total} products (Keepa not run — revenue unknown)`);
  }

  if (metrics.avgRevenue > 0) {
    parts.push(`avg ${fmt$(metrics.avgRevenue)}/mo per product`);
  }

  if (metrics.medianBsr) {
    parts.push(`median BSR ${metrics.medianBsr.toLocaleString()}`);
  }

  if (metrics.growthPct > 0.2) {
    parts.push(`strong growth (${Math.round(metrics.growthPct * 100)}% rising/surging)`);
  } else if (metrics.growthPct > 0) {
    parts.push(`${Math.round(metrics.growthPct * 100)}% rising`);
  }

  if (metrics.threatPct < 0.4 && metrics.hasP6) {
    parts.push(`low competition density (${Math.round(metrics.threatPct * 100)}% high-threat)`);
  } else if (metrics.threatPct > 0.7 && metrics.hasP6) {
    parts.push(`⚠ high competition (${Math.round(metrics.threatPct * 100)}% high-threat)`);
  }

  if (metrics.avgRating) {
    parts.push(`avg ${metrics.avgRating.toFixed(1)}★`);
  }

  if (metrics.avgPrice) {
    parts.push(`avg price $${metrics.avgPrice.toFixed(2)}`);
  }

  if (metrics.topCerts.length) {
    parts.push(`certs: ${metrics.topCerts.join(', ')}`);
  }

  if (metrics.avgFormula) {
    parts.push(`formula score ${metrics.avgFormula.toFixed(1)}/10`);
  }

  if (metrics.gaps.length) {
    parts.push(`opp: "${metrics.gaps[0]}"`);
  }

  const completeness = [];
  if (!metrics.hasKeepa) completeness.push('P2 not run');
  if (!metrics.hasP6) completeness.push('P6 not run');
  if (completeness.length) parts.push(`⚠ data gaps: ${completeness.join(', ')}`);

  return parts.join(' · ');
}

// ─── Save to vault ────────────────────────────────────────────────────────────

function saveToVault(ranked, date) {
  const vaultDir = 'C:\\SirPercival-Vault\\07_ai-systems\\agents\\scout\\market-intelligence';
  const vaultPath = path.join(vaultDir, `${date}-phase0-opportunities.md`);

  if (!fs.existsSync(vaultDir)) fs.mkdirSync(vaultDir, { recursive: true });

  const displayCount = Math.min(TOP_N, ranked.length);
  const lines = [
    `# Phase 0 — Market Opportunity Ranking`,
    `Generated: ${new Date().toISOString()}`,
    `Categories analyzed: ${ranked.length} | Top ${displayCount} shown | Min products threshold: ${MIN_PRODUCTS}`,
    '',
    '---',
    '',
    '## Ranked Category Opportunities',
    '',
    '| Rank | Category | Score | Revenue/mo | Avg/Product | BSR Median | Growth% | Competition | Rating | Data Completeness |',
    '|------|----------|-------|------------|-------------|------------|---------|-------------|--------|-------------------|',
  ];

  for (let i = 0; i < displayCount; i++) {
    const { cat, metrics: m } = ranked[i];
    const dataLabel = m.hasKeepa && m.hasP6 ? 'Full (P1-P6+)' : m.hasKeepa ? 'P1+P2' : 'P1 only';
    const growth = m.hasP6 ? `${Math.round(m.growthPct * 100)}%` : '—';
    const comp = m.hasP6 ? `${Math.round(m.threatPct * 100)}% hi-threat` : '—';
    lines.push(
      `| #${i + 1} | **${cat.name}** | ${m.totalScore}/100 | ${fmt$(m.totalRevenue)} | ${fmt$(m.avgRevenue)} | ${m.medianBsr ? m.medianBsr.toLocaleString() : '—'} | ${growth} | ${comp} | ${m.avgRating ? m.avgRating.toFixed(1) + '★' : '—'} | ${dataLabel} |`
    );
  }

  lines.push('', '---', '', '## Category Details & Rationale', '');

  for (let i = 0; i < displayCount; i++) {
    const { cat, metrics: m } = ranked[i];
    lines.push(`### #${i + 1} — ${cat.name}`);
    lines.push('');
    lines.push(`**Search term:** \`${cat.search_term}\``);
    lines.push(`**Score:** ${m.totalScore}/100`);
    lines.push(`**Products in DB:** ${m.total} (last scanned: ${cat.last_scanned ? cat.last_scanned.split('T')[0] : 'unknown'})`);
    lines.push('');
    lines.push('**Score breakdown:**');
    if (m.scores) {
      lines.push(`- Revenue size (40pts): ${m.scores.rev}`);
      lines.push(`- Growth momentum (20pts): ${m.scores.growth}`);
      lines.push(`- Per-product opportunity (15pts): ${m.scores.perProd}`);
      lines.push(`- Competition gap (15pts): ${m.scores.gap}`);
      lines.push(`- Consumer quality signal (10pts): ${m.scores.quality}`);
    }
    lines.push('');
    lines.push(`**Rationale:** ${buildRationale(m)}`);
    if (m.gaps.length) {
      lines.push('');
      lines.push('**Detected opportunity gaps (from P6):**');
      for (const g of m.gaps) lines.push(`- ${g}`);
    }
    lines.push('');
    lines.push(`**Run command:** \`node run-pipeline.js --keyword "${cat.search_term}"\``);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  lines.push('*Generated by phase0-market-opportunity.js (Dovive Scout)*');

  fs.writeFileSync(vaultPath, lines.join('\n'));
  return vaultPath;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n${'═'.repeat(62)}`);
  console.log(`PHASE 0 — MARKET OPPORTUNITY SCANNER`);
  console.log(`${'═'.repeat(62)}\n`);

  console.log('Loading categories from DASH...');
  const { data: categories, error: catErr } = await DASH
    .from('categories')
    .select('id, name, search_term, total_products, last_scanned')
    .order('last_scanned', { ascending: false, nullsFirst: false });

  if (catErr) {
    console.error('❌ Failed to load categories:', catErr.message);
    process.exit(1);
  }

  if (!categories?.length) {
    console.warn('⚠ No categories in DASH DB. Run P1 first for at least one keyword.');
    process.exit(0);
  }

  console.log(`  ${categories.length} categories found\n`);

  console.log('Loading product signals per category...');
  const allMetrics = [];

  for (const cat of categories) {
    const { data: products, error: prodErr } = await DASH
      .from('products')
      .select('asin, bsr_current, price, monthly_revenue, monthly_sales, rating_value, rating_count, marketing_analysis')
      .eq('category_id', cat.id)
      .not('asin', 'is', null);

    if (prodErr) {
      console.warn(`  ⚠ Could not load products for "${cat.name}": ${prodErr.message}`);
      continue;
    }

    if (!products?.length || products.length < MIN_PRODUCTS) {
      console.log(`  ⤵ Skipping "${cat.name}" — ${products?.length || 0} products (min: ${MIN_PRODUCTS})`);
      continue;
    }

    const metrics = computeMetrics(products);
    allMetrics.push({ cat, metrics });
    const dataTag = metrics.hasKeepa && metrics.hasP6 ? '[FULL]' : metrics.hasKeepa ? '[P1+P2]' : '[P1]';
    console.log(`  ✓ ${cat.name.padEnd(35)} ${metrics.total} products  rev ${fmt$(metrics.totalRevenue)}/mo  ${dataTag}`);
  }

  if (!allMetrics.length) {
    console.warn('\n⚠ No qualifying categories (all below min-products threshold).');
    console.warn(`  Try: node phase0-market-opportunity.js --min-products 1`);
    process.exit(0);
  }

  console.log('\nScoring & ranking opportunities...');
  const ranked = scoreCategories(allMetrics);
  console.log(`  ✅ ${ranked.length} categories ranked\n`);

  // ─── Console summary ─────────────────────────────────────────────────────────

  const date = new Date().toISOString().split('T')[0];
  const displayCount = Math.min(TOP_N, ranked.length);

  console.log(`${'═'.repeat(62)}`);
  console.log(`TOP ${displayCount} MARKET OPPORTUNITIES  —  ${date}`);
  console.log(`${'═'.repeat(62)}\n`);

  for (let i = 0; i < displayCount; i++) {
    const { cat, metrics: m } = ranked[i];
    const dataTag = m.hasKeepa && m.hasP6 ? '[FULL]' : m.hasKeepa ? '[P1+P2]' : '[P1 only]';
    const scoreBar = '█'.repeat(Math.round(m.totalScore / 10)) + '░'.repeat(10 - Math.round(m.totalScore / 10));
    console.log(`#${String(i + 1).padStart(2)}  ${scoreBar}  ${String(m.totalScore).padStart(3)}/100  ${cat.name}  ${dataTag}`);
    console.log(`      ${buildRationale(m)}`);
    if (i < displayCount - 1) console.log('');
  }

  console.log(`\n${'─'.repeat(62)}`);
  console.log('RECOMMENDED NEXT PIPELINE RUN:');
  if (ranked[0]) {
    console.log(`  node run-pipeline.js --keyword "${ranked[0].cat.search_term}"`);
  }
  if (ranked[1]) {
    console.log(`  node run-pipeline.js --keyword "${ranked[1].cat.search_term}"  ← 2nd pick`);
  }
  console.log(`${'─'.repeat(62)}\n`);

  // ─── Save to vault ────────────────────────────────────────────────────────────

  console.log('Saving to vault...');
  try {
    const vaultPath = saveToVault(ranked, date);
    console.log(`  ✅ ${vaultPath}\n`);
  } catch (e) {
    console.warn(`  ⚠ Vault save failed (non-fatal): ${e.message}\n`);
  }

  console.log('✅ Phase 0 complete\n');
}

run().catch(e => {
  console.error('\n❌ FAILED:', e.message);
  process.exit(1);
});
