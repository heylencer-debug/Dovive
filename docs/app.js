// Dovive Scout Dashboard V3.2 - Main Application
// Features: Product type filters, reviews panel, specs panel, live progress tracking, Scout Settings panel
// V2.6: Product grid view + full detail modal with tabs
// V2.7: Keywords page with drill-down, AI report, per-keyword product grid
// V2.8: Full product data from dovive_research (images, bullets, reviews, specs, certifications), Product Explorer removed
// V2.9: Phase 5 badge — deep research indicator for top 10 BSR products per keyword
// V3.0: Phase 5 detail panel — live Supabase data from dovive_phase5_research, dynamic badge from DB
// V3.1: OCR fix — remove supplement_facts filter, show raw_text fallback, add re-extraction script
// V3.2: Phase coverage bars on keyword cards, fix duplicate loadPhaseCoverage, dovive_keepa.keyword backfill
// V3.2: Phase Coverage bars on keyword cards — P1→P5 progress per keyword, live from Supabase

(function() {
  'use strict';

  // Phase 5 Deep Research — populated dynamically from dovive_phase5_research (Supabase)
  // V3.0: No longer hardcoded — loaded at init from DB
  let PHASE5_RESEARCHED_ASINS = new Set();

  // V3.2: Phase coverage data — { keyword: { total, p1, p2, p3, p4, p5 } }
  let phaseCoverage = {};

  // Product type filter options
  const PRODUCT_TYPE_FILTERS = [
    'All',
    'Capsule',
    'Gummies',
    'Powder',
    'Liquid/Drops',
    'Softgel',
    'Tablet',
    'Spray',
    'Patch',
    'Tea',
    'Drink Mix',
    'Lozenge',
    'Liposomal',
    'Other'
  ];

  // State
  let keywords = [];
  let products = [];
  let reviews = [];
  let specs = {};
  let reports = [];
  let currentKeyword = null;
  let currentProductType = 'All';
  let currentSort = { column: 'rank_position', desc: false };
  let currentJobStatus = 'idle';
  let currentJobProgress = { keyword: '', type: '', products: 0, reviews: 0 };
  let currentJob = null; // Full job object for ETA calculations
  let pollIntervalId = null;
  let isPollingJob = false;
  let expandedProducts = new Set();

  // Product Grid State
  let currentGridKeyword = 'ALL';
  let modalReviewsLoaded = 0;
  let currentModalAsin = null;
  let currentModalTab = 'overview';
  let modalProductData = {};

  // V2.7: View State Management
  let currentView = 'keywords'; // 'keywords' | 'keyword-detail' | 'product-explorer' | 'settings' | 'overview'
  let selectedKeyword = null;
  let keywordDetailSort = 'bsr'; // 'bsr' | 'price' | 'rating' | 'reviews'

  // DOM Elements
  const keywordList = document.getElementById('keyword-list');
  const keywordCount = document.getElementById('keyword-count');
  const keywordInput = document.getElementById('keyword-input');
  const addKeywordBtn = document.getElementById('add-keyword-btn');
  const runScoutBtn = document.getElementById('run-scout-btn');
  const scoutStatus = document.getElementById('scout-status');
  const lastRunEl = document.getElementById('last-run');
  const keywordsTrackedEl = document.getElementById('keywords-tracked');
  const keywordTabs = document.getElementById('keyword-tabs');
  const resultsContainer = document.getElementById('results-container');
  const summaryContent = document.getElementById('summary-content');
  const summaryTime = document.getElementById('summary-time');
  const productTypeFilters = document.getElementById('product-type-filters');
  const progressSection = document.getElementById('progress-section');

  // Products Grid DOM Elements
  const productsGridContainer = document.getElementById('products-grid-container');
  const productsKeywordTabs = document.getElementById('products-keyword-tabs');
  const productsCount = document.getElementById('products-count');

  // Initialize
  async function init() {
    await loadKeywords();
    await loadReports();
    await loadProducts();
    await loadPhase5ASINs(); // V3.0: load Phase 5 researched ASINs from Supabase
    await loadPhaseCoverage(); // V3.2: load P1-P5 coverage counts per keyword
    await loadFormatFocusData();
    await loadScoutSettings();
    await checkScoutStatus();
    await refreshScoutStatus(); // sync Start Scout button with latest job state
    setupEventListeners();
    setupScoutSettingsToggle();
    startStatusPolling();
    renderProductsGrid();
    renderProductsKeywordTabs();
    setupProductsGridListeners();

    // V2.7: Setup navigation and render Keywords page by default
    setupNavigation();
    showKeywordsPage();
  }

  // ============================================================
  // FORMAT FOCUS - Gummies & Powder Specialized Dashboard
  // ============================================================

  let formatFocusData = {
    gummies: { count: 0, priceMin: null, priceMax: null, avgPricePerServing: null, topBrands: [], commonSweetener: null, veganPct: null, topFlavor: null },
    powder: { count: 0, priceMin: null, priceMax: null, avgPricePerServing: null, topBrands: [], commonSweetener: null, instantPct: null, topFlavor: null }
  };

  // Load format focus data from products and specs
  async function loadFormatFocusData() {
    try {
      // Filter gummies and powder products
      const gummiesProducts = products.filter(p => p.product_type === 'Gummies');
      const powderProducts = products.filter(p => p.product_type === 'Powder');

      // Load specs for format-specific data
      const specsData = await sbFetch('dovive_specs', {
        select: 'asin,gummies_data,powder_data',
        limit: 500
      });

      const specsMap = {};
      if (specsData) {
        specsData.forEach(s => { specsMap[s.asin] = s; });
      }

      // Process Gummies
      formatFocusData.gummies = processFormatData(gummiesProducts, specsMap, 'gummies');

      // Process Powder
      formatFocusData.powder = processFormatData(powderProducts, specsMap, 'powder');

      renderFormatFocus();
    } catch (err) {
      console.error('Failed to load format focus data:', err);
    }
  }

  // Process format-specific data
  function processFormatData(formatProducts, specsMap, formatType) {
    const result = {
      count: formatProducts.length,
      priceMin: null,
      priceMax: null,
      avgPricePerServing: null,
      topBrands: [],
      commonSweetener: null,
      veganPct: null,
      instantPct: null,
      topFlavor: null
    };

    if (formatProducts.length === 0) return result;

    // Price calculations
    const prices = formatProducts.filter(p => p.price).map(p => p.price);
    if (prices.length > 0) {
      result.priceMin = Math.min(...prices);
      result.priceMax = Math.max(...prices);
    }

    // Price per serving (from products with price_per_serving or format_data)
    const pricesPerServing = formatProducts
      .filter(p => p.price_per_serving)
      .map(p => p.price_per_serving);
    if (pricesPerServing.length > 0) {
      result.avgPricePerServing = (pricesPerServing.reduce((a, b) => a + b, 0) / pricesPerServing.length).toFixed(2);
    }

    // Top brands by review count
    const brandReviews = {};
    formatProducts.forEach(p => {
      if (p.brand) {
        brandReviews[p.brand] = (brandReviews[p.brand] || 0) + (p.review_count || 0);
      }
    });
    result.topBrands = Object.entries(brandReviews)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([brand]) => brand);

    // Extract format-specific data from specs
    const sweetenerCounts = {};
    const flavorCounts = {};
    let veganCount = 0;
    let instantCount = 0;
    let formatDataCount = 0;

    formatProducts.forEach(p => {
      const spec = specsMap[p.asin];
      const fmtData = formatType === 'gummies'
        ? (spec?.gummies_data || p.format_data || {})
        : (spec?.powder_data || p.format_data || {});

      if (fmtData && Object.keys(fmtData).length > 0) {
        formatDataCount++;

        // Sweetener
        if (fmtData.sweetener) {
          sweetenerCounts[fmtData.sweetener] = (sweetenerCounts[fmtData.sweetener] || 0) + 1;
        }

        // Flavors
        if (fmtData.flavors_mentioned && Array.isArray(fmtData.flavors_mentioned)) {
          fmtData.flavors_mentioned.forEach(f => {
            flavorCounts[f] = (flavorCounts[f] || 0) + 1;
          });
        }

        // Vegan (gummies only - pectin based)
        if (formatType === 'gummies' && fmtData.base_type && fmtData.base_type.includes('Pectin')) {
          veganCount++;
        }

        // Instant (powder only)
        if (formatType === 'powder' && fmtData.is_instant) {
          instantCount++;
        }
      }
    });

    // Most common sweetener
    const sortedSweeteners = Object.entries(sweetenerCounts).sort((a, b) => b[1] - a[1]);
    result.commonSweetener = sortedSweeteners.length > 0 ? sortedSweeteners[0][0] : '-';

    // Most mentioned flavor
    const sortedFlavors = Object.entries(flavorCounts).sort((a, b) => b[1] - a[1]);
    result.topFlavor = sortedFlavors.length > 0 ? sortedFlavors[0][0] : '-';

    // Vegan % (gummies)
    if (formatType === 'gummies' && formatDataCount > 0) {
      result.veganPct = Math.round((veganCount / formatDataCount) * 100);
    }

    // Instant % (powder)
    if (formatType === 'powder' && formatDataCount > 0) {
      result.instantPct = Math.round((instantCount / formatDataCount) * 100);
    }

    return result;
  }

  // Render Format Focus section
  function renderFormatFocus() {
    const formatFocusContainer = document.getElementById('format-focus-container');
    if (!formatFocusContainer) return;

    const gummies = formatFocusData.gummies;
    const powder = formatFocusData.powder;

    formatFocusContainer.innerHTML = `
      <div class="format-focus-grid">
        <!-- GUMMIES CARD -->
        <div class="format-focus-card">
          <div class="format-focus-title">🍬 GUMMIES</div>
          <div class="format-stat">
            <span class="format-stat-label">Products Found</span>
            <span class="format-stat-val">${gummies.count}</span>
          </div>
          <div class="format-stat">
            <span class="format-stat-label">Price Range</span>
            <span class="format-stat-val">${gummies.priceMin !== null ? '$' + gummies.priceMin.toFixed(2) + ' - $' + gummies.priceMax.toFixed(2) : '-'}</span>
          </div>
          <div class="format-stat">
            <span class="format-stat-label">Avg Price/Serving</span>
            <span class="format-stat-val">${gummies.avgPricePerServing ? '$' + gummies.avgPricePerServing : '-'}</span>
          </div>
          <div class="format-stat">
            <span class="format-stat-label">Top Brands</span>
            <span class="format-stat-val">${gummies.topBrands.length > 0 ? gummies.topBrands.slice(0, 2).join(', ') : '-'}</span>
          </div>
          <div class="format-stat">
            <span class="format-stat-label">Common Sweetener</span>
            <span class="format-stat-val">${gummies.commonSweetener || '-'}</span>
          </div>
          <div class="format-stat">
            <span class="format-stat-label">Vegan (Pectin)</span>
            <span class="format-stat-val">${gummies.veganPct !== null ? gummies.veganPct + '%' : '-'}</span>
          </div>
          <div class="format-stat">
            <span class="format-stat-label">Top Flavor</span>
            <span class="format-stat-val">${gummies.topFlavor || '-'}</span>
          </div>
        </div>

        <!-- POWDER CARD -->
        <div class="format-focus-card">
          <div class="format-focus-title">🥤 POWDER</div>
          <div class="format-stat">
            <span class="format-stat-label">Products Found</span>
            <span class="format-stat-val">${powder.count}</span>
          </div>
          <div class="format-stat">
            <span class="format-stat-label">Price Range</span>
            <span class="format-stat-val">${powder.priceMin !== null ? '$' + powder.priceMin.toFixed(2) + ' - $' + powder.priceMax.toFixed(2) : '-'}</span>
          </div>
          <div class="format-stat">
            <span class="format-stat-label">Avg Price/Serving</span>
            <span class="format-stat-val">${powder.avgPricePerServing ? '$' + powder.avgPricePerServing : '-'}</span>
          </div>
          <div class="format-stat">
            <span class="format-stat-label">Top Brands</span>
            <span class="format-stat-val">${powder.topBrands.length > 0 ? powder.topBrands.slice(0, 2).join(', ') : '-'}</span>
          </div>
          <div class="format-stat">
            <span class="format-stat-label">Common Sweetener</span>
            <span class="format-stat-val">${powder.commonSweetener || '-'}</span>
          </div>
          <div class="format-stat">
            <span class="format-stat-label">Instant Dissolve</span>
            <span class="format-stat-val">${powder.instantPct !== null ? powder.instantPct + '%' : '-'}</span>
          </div>
          <div class="format-stat">
            <span class="format-stat-label">Top Flavor</span>
            <span class="format-stat-val">${powder.topFlavor || '-'}</span>
          </div>
        </div>
      </div>
    `;
  }

  // ============================================================
  // SCOUT SETTINGS - Config & Changelog Panel
  // ============================================================

  // ---- SCOUT CONTROL (Start button + live job status) ----

  let scoutJobPollInterval = null;

  async function stopScoutJob() {
    const btn = document.getElementById('stop-scout-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Stopping…'; }
    try {
      const jobs = await sbFetch('dovive_jobs', { order: 'created_at.desc', limit: 1 });
      if (jobs && jobs.length > 0 && (jobs[0].status === 'queued' || jobs[0].status === 'running')) {
        await sbUpdate('dovive_jobs', `id=eq.${jobs[0].id}`, { status: 'cancelled', finished_at: new Date().toISOString() });
        updateScoutStatus('cancelled');
        showToast('🛑 Scout stopped', 'info');
        if (scoutJobPollInterval) { clearInterval(scoutJobPollInterval); scoutJobPollInterval = null; }
      }
    } catch (e) {
      console.error('Stop scout failed:', e);
      if (btn) { btn.disabled = false; btn.textContent = 'Stop'; }
    }
  }

  async function queueScoutJob() {
    const btn = document.getElementById('start-scout-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Queuing…'; }

    try {
      await sbInsert('dovive_jobs', {
        status: 'queued',
        triggered_by: 'dashboard',
        created_at: new Date().toISOString()
      });
      updateScoutStatus('queued');
      startScoutStatusPoll();
    } catch (err) {
      console.error('Failed to queue scout job:', err);
      if (btn) { btn.disabled = false; btn.textContent = 'Start Scout'; }
      alert('Failed to queue job: ' + err.message);
    }
  }

  function startScoutStatusPoll() {
    if (scoutJobPollInterval) clearInterval(scoutJobPollInterval);
    scoutJobPollInterval = setInterval(refreshScoutStatus, 8000);
    refreshScoutStatus();
  }

  let _lastJobStatus = null;

  async function refreshScoutStatus() {
    try {
      const jobs = await sbFetch('dovive_jobs', {
        order: 'created_at.desc',
        limit: 1
      });
      if (!jobs || jobs.length === 0) return;
      const job = jobs[0];

      updateScoutStatus(job.status, job);

      // Auto-start polling if job is active (handles page refresh / other device)
      const isActive = job.status === 'queued' || job.status === 'running';
      if (isActive && !scoutJobPollInterval) {
        startScoutStatusPoll();
      }

      // Detect transition to done → reload products + show toast
      if (_lastJobStatus && _lastJobStatus !== job.status) {
        if (job.status === 'done') {
          showToast(`✅ Scout done — ${job.products_scraped || 0} products saved`, 'success');
          await loadProducts();
          await loadKeywords();
          renderProductsGrid();
          renderKeywords();
        } else if (job.status === 'error' || job.status === 'failed') {
          showToast('⚠️ Scout run failed', 'error');
        }
      }
      _lastJobStatus = job.status;

      // Stop polling when terminal
      if (job.status === 'done' || job.status === 'error' || job.status === 'failed') {
        if (scoutJobPollInterval) { clearInterval(scoutJobPollInterval); scoutJobPollInterval = null; }
      }
    } catch (e) {
      console.error('Scout status poll error:', e);
    }
  }

  function showToast(message, type = 'info') {
    const existing = document.getElementById('scout-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'scout-toast';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed; bottom: 24px; right: 24px; z-index: 9999;
      background: ${type === 'success' ? '#4D7C0F' : type === 'error' ? '#DC2626' : '#1E40AF'};
      color: #fff; padding: 12px 20px; border-radius: 8px;
      font-size: 13px; font-weight: 600; letter-spacing: 0.03em;
      box-shadow: 0 4px 16px rgba(0,0,0,0.15);
      animation: fadeInUp 0.2s ease;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }

  function updateScoutStatus(status, job = null) {
    const pill = document.getElementById('scout-status-pill');
    const detail = document.getElementById('scout-status-detail');
    const btn = document.getElementById('start-scout-btn');

    const statusMap = {
      'queued':    { label: 'QUEUED',    color: '#0066FF' },
      'running':   { label: 'RUNNING',   color: '#00AA44' },
      'done':      { label: 'DONE',      color: '#0A0A0A' },
      'cancelled': { label: 'CANCELLED', color: '#888888' },
      'error':     { label: 'ERROR',     color: '#CC0000' },
      'failed':    { label: 'FAILED',    color: '#CC0000' },
      'idle':      { label: 'IDLE',      color: '#888888' }
    };

    const s = statusMap[status] || statusMap['idle'];

    if (pill) {
      pill.textContent = s.label;
      pill.style.color = s.color;
      pill.style.borderColor = s.color;
    }

    if (detail && job) {
      const parts = [];
      if (job.current_keyword) parts.push(`Keyword: ${job.current_keyword}`);
      if (job.products_scraped != null) parts.push(`${job.products_scraped} products`);
      if (job.finished_at) parts.push(`Done ${new Date(job.finished_at).toLocaleTimeString()}`);
      else if (job.started_at) parts.push(`Started ${new Date(job.started_at).toLocaleTimeString()}`);
      detail.textContent = parts.join(' · ');
    }

    const stopBtn = document.getElementById('stop-scout-btn');
    if (btn) {
      const busy = status === 'queued' || status === 'running';
      btn.disabled = busy;
      btn.textContent = busy ? (status === 'queued' ? 'Queued…' : 'Running…') : 'Start Scout';
    }
    if (stopBtn) {
      const busy = status === 'queued' || status === 'running';
      stopBtn.style.display = busy ? 'inline-block' : 'none';
      stopBtn.disabled = false;
      stopBtn.textContent = 'Stop';
    }
  }

  // ---- END SCOUT CONTROL ----

  let scoutSettings = {
    scrape_mode: 'best_sellers_first',
    product_types_active: [],
    best_sellers_categories: [],
    max_products_per_type: 50,
    max_reviews_per_product: 200,
    deep_scrape_top_n: 30
  };

  let scoutChangelog = [];

  // Load Scout settings from dovive_scout_config
  async function loadScoutSettings() {
    try {
      // Load config
      const configRows = await sbFetch('dovive_scout_config', {
        select: 'config_key,config_value'
      });

      if (configRows && configRows.length > 0) {
        configRows.forEach(r => {
          try {
            if (r.config_value && (r.config_value.startsWith('[') || r.config_value.startsWith('{'))) {
              scoutSettings[r.config_key] = JSON.parse(r.config_value);
            } else if (r.config_value && !isNaN(r.config_value)) {
              scoutSettings[r.config_key] = parseInt(r.config_value);
            } else {
              scoutSettings[r.config_key] = r.config_value;
            }
          } catch (e) {
            scoutSettings[r.config_key] = r.config_value;
          }
        });
      }

      // Load changelog
      const changelogRows = await sbFetch('dovive_scout_changelog', {
        order: 'created_at.desc',
        limit: 5
      });
      scoutChangelog = changelogRows || [];

      renderScoutSettings();
    } catch (err) {
      console.error('Failed to load scout settings:', err);
      // Show error state
      const container = document.getElementById('scout-settings-container');
      if (container) {
        container.innerHTML = '<div class="empty-text">Could not load settings</div>';
      }
    }
  }

  // Render Scout Settings panel
  function renderScoutSettings() {
    const container = document.getElementById('scout-settings-container');
    const changelogList = document.getElementById('scout-changelog-list');

    if (!container) return;

    // Mode badge
    const modeLabel = {
      'best_sellers_first': 'Best Sellers First',
      'best_sellers_only': 'Best Sellers Only',
      'keyword_only': 'Keyword Search Only'
    }[scoutSettings.scrape_mode] || scoutSettings.scrape_mode;

    // Active types chips
    const activeTypes = scoutSettings.product_types_active || [];
    const typesHtml = activeTypes.length > 0
      ? activeTypes.map(t => `<span class="chip">${t}</span>`).join('')
      : '<span class="muted">All types</span>';

    // Best Sellers categories
    const bsCategories = scoutSettings.best_sellers_categories || [];
    const categoriesHtml = bsCategories.length > 0
      ? bsCategories.map(c => `<div class="category-item">• ${c.name || c}</div>`).join('')
      : '<span class="muted">None configured</span>';

    container.innerHTML = `
      <div class="scout-control-bar">
        <div class="scout-status-row">
          <span class="settings-label">Status</span>
          <span id="scout-status-pill" class="scout-status-pill" style="color:#888;border-color:#888">IDLE</span>
          <span id="scout-status-detail" class="scout-status-detail"></span>
        </div>
        <div style="display:flex;gap:8px;">
          <button id="start-scout-btn" class="start-scout-btn" onclick="window._queueScoutJob()">Start Scout</button>
          <button id="stop-scout-btn" class="stop-scout-btn" onclick="window._stopScoutJob()" style="display:none">Stop</button>
        </div>
      </div>
      <div class="settings-row">
        <span class="settings-label">Scrape Mode</span>
        <span class="settings-value badge">${modeLabel}</span>
      </div>
      <div class="settings-row">
        <span class="settings-label">Active Types</span>
        <div class="settings-chips">${typesHtml}</div>
      </div>
      <div class="settings-row">
        <span class="settings-label">Best Sellers Categories</span>
        <div class="categories-list">${categoriesHtml}</div>
      </div>
      <div class="settings-row">
        <span class="settings-label">Products/Type</span>
        <span class="settings-value">${scoutSettings.max_products_per_type || 50}</span>
      </div>
      <div class="settings-row">
        <span class="settings-label">Deep Scrape Top N</span>
        <span class="settings-value">${scoutSettings.deep_scrape_top_n || 30}</span>
      </div>
      <div class="settings-row">
        <span class="settings-label">Max Reviews/Product</span>
        <span class="settings-value">${scoutSettings.max_reviews_per_product || 200}</span>
      </div>
    `;

    // Render changelog
    if (changelogList) {
      if (scoutChangelog.length > 0) {
        changelogList.innerHTML = scoutChangelog.map(c => `
          <div class="changelog-entry">
            <div class="changelog-version">${c.version || 'v?'}</div>
            <div class="changelog-desc">${c.description || ''}</div>
            <div class="changelog-date">${c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</div>
          </div>
        `).join('');
      } else {
        changelogList.innerHTML = '<div class="muted">No changelog entries</div>';
      }
    }
  }

  // Setup collapsible toggle for Scout Settings
  function setupScoutSettingsToggle() {
    const toggle = document.getElementById('scout-settings-toggle');
    const content = document.getElementById('scout-settings-content');
    const icon = toggle?.querySelector('.collapse-icon');

    if (!toggle || !content) return;

    // Start collapsed
    content.style.display = 'none';
    if (icon) icon.textContent = '▶';

    toggle.addEventListener('click', () => {
      const isCollapsed = content.style.display === 'none';
      content.style.display = isCollapsed ? 'block' : 'none';
      if (icon) icon.textContent = isCollapsed ? '▼' : '▶';
    });
  }

  // Load keywords from Supabase
  async function loadKeywords() {
    try {
      keywords = await sbFetch('dovive_keywords', {
        filter: 'active=eq.true',
        order: 'created_at.asc'
      });
      renderKeywords();
      renderKeywordTabs();
      updateKeywordCount();
    } catch (err) {
      console.error('Failed to load keywords:', err);
      showKeywordsError();
    }
  }

  // Load reports from Supabase
  async function loadReports() {
    try {
      reports = await sbFetch('dovive_reports', {
        order: 'analyzed_at.desc',
        limit: 100
      });
      renderSummary();
    } catch (err) {
      console.error('Failed to load reports:', err);
    }
  }

  // V3.2: Phase Coverage — stores P1-P5 product counts per keyword
  // V3.2: Load phase coverage counts per keyword from all 5 phase tables
  async function loadPhaseCoverage() {
    try {
      const [research, keepa, reviews, ocr, p5] = await Promise.all([
        sbFetch('dovive_research', { select: 'keyword,asin', limit: 1000 }),
        sbFetch('dovive_keepa', { select: 'asin', limit: 1000 }),
        sbFetch('dovive_reviews', { select: 'keyword,asin', limit: 1000 }),
        sbFetch('dovive_ocr', { select: 'keyword,asin', limit: 2000 }),
        sbFetch('dovive_phase5_research', { select: 'keyword,asin', limit: 500 })
      ]);

      const keepaAsins = new Set((keepa || []).map(r => r.asin));
      const reviewsByKw = {}, ocrByKw = {}, p5ByKw = {}, researchByKw = {};

      (research || []).forEach(r => {
        if (!researchByKw[r.keyword]) researchByKw[r.keyword] = new Set();
        researchByKw[r.keyword].add(r.asin);
      });
      (reviews || []).forEach(r => {
        if (!reviewsByKw[r.keyword]) reviewsByKw[r.keyword] = new Set();
        reviewsByKw[r.keyword].add(r.asin);
      });
      (ocr || []).forEach(r => {
        if (!ocrByKw[r.keyword]) ocrByKw[r.keyword] = new Set();
        ocrByKw[r.keyword].add(r.asin);
      });
      (p5 || []).forEach(r => {
        if (!p5ByKw[r.keyword]) p5ByKw[r.keyword] = new Set();
        p5ByKw[r.keyword].add(r.asin);
      });

      phaseCoverage = {};
      Object.entries(researchByKw).forEach(([kw, asins]) => {
        if (kw === 'test') return;
        const total = asins.size;
        const asinArr = [...asins];
        phaseCoverage[kw] = {
          total,
          p1: total,
          p2: asinArr.filter(a => keepaAsins.has(a)).length,
          p3: (reviewsByKw[kw] || new Set()).size,
          p4: (ocrByKw[kw] || new Set()).size,
          p5: (p5ByKw[kw] || new Set()).size
        };
      });
    } catch (e) {
      console.warn('Phase coverage load failed:', e.message);
    }
  }

  // V3.0: Load Phase 5 researched ASINs from Supabase into the dynamic Set
  async function loadPhase5ASINs() {
    try {
      const data = await sbFetch('dovive_phase5_research', {
        select: 'asin',
        limit: 500
      }) || [];
      PHASE5_RESEARCHED_ASINS = new Set(data.map(r => r.asin));
    } catch (e) {
      console.warn('Phase 5 ASIN load failed:', e.message);
    }
  }

  // V3.0: Fetch full Phase 5 research record for a single ASIN
  async function loadPhase5Data(asin) {
    try {
      const data = await sbFetch('dovive_phase5_research', {
        filter: `asin=eq.${asin}`,
        limit: 1
      });
      return data && data.length > 0 ? data[0] : null;
    } catch (e) {
      console.warn('Phase 5 data load failed for', asin, e.message);
      return null;
    }
  }

  // Load products from dovive_research (main product table)
  async function loadProducts() {
    try {
      // V2.9 FIX: Use dovive_research as primary source (has complete data)
      // dovive_products has missing columns and partial data - do NOT use as primary
      products = await sbFetch('dovive_research', {
        order: 'bsr.asc',
        limit: 1000
      }) || [];

      renderResults();
      renderProductsGrid();
      renderProductsKeywordTabs();
      await loadFormatFocusData();
    } catch (err) {
      console.error('Failed to load products from dovive_research:', err);
      products = []; // Ensure products is always an array
      renderResults();
      renderProductsGrid();
      renderProductsKeywordTabs();
    }
  }

  // Load reviews for a specific ASIN
  async function loadReviewsForProduct(asin) {
    try {
      const productReviews = await sbFetch('dovive_reviews', {
        filter: `asin=eq.${asin}`,
        order: 'scraped_at.desc',
        limit: 10
      });
      return productReviews;
    } catch (err) {
      console.error('Failed to load reviews:', err);
      return [];
    }
  }

  // Load specs for a specific ASIN
  async function loadSpecsForProduct(asin) {
    try {
      const productSpecs = await sbFetch('dovive_specs', {
        filter: `asin=eq.${asin}`,
        limit: 1,
        single: true
      });
      return productSpecs;
    } catch (err) {
      console.error('Failed to load specs:', err);
      return null;
    }
  }

  // Load images for a specific ASIN (for OCR pipeline)
  async function loadImagesForProduct(asin) {
    try {
      const images = await sbFetch('dovive_product_images', {
        filter: `asin=eq.${asin}`,
        order: 'image_index.asc'
      });
      return images || [];
    } catch (err) {
      console.error('Failed to load images:', err);
      return [];
    }
  }

  // Check Scout agent status with progress
  async function checkScoutStatus() {
    try {
      const jobs = await sbFetch('dovive_jobs', {
        order: 'created_at.desc',
        limit: 1
      });

      if (jobs && jobs.length > 0) {
        const latestJob = jobs[0];
        const prevStatus = currentJobStatus;
        currentJobStatus = latestJob.status;
        currentJob = latestJob; // Store full job for ETA

        // Update progress info
        currentJobProgress = {
          keyword: latestJob.current_keyword || '',
          type: latestJob.current_product_type || '',
          products: latestJob.products_scraped || 0,
          reviews: latestJob.reviews_scraped || 0
        };

        updateStatusBadge(latestJob.status);
        renderProgress();

        if (latestJob.status === 'complete') {
          lastRunEl.textContent = formatTimeAgo(latestJob.completed_at || latestJob.updated_at);

          if (prevStatus === 'running' || prevStatus === 'queued') {
            await loadProducts();
            await loadReports();
            showStatusMessage('Scout V2 completed! Results updated.', 'success');
          }
        } else if (latestJob.status === 'error') {
          lastRunEl.textContent = 'Error';
          if (latestJob.error_message) {
            showStatusMessage(`Error: ${latestJob.error_message}`, 'error');
          }
        } else if (latestJob.status === 'running' || latestJob.status === 'queued') {
          lastRunEl.textContent = 'In progress...';
        }
      } else {
        currentJobStatus = 'idle';
        updateStatusBadge('idle');
      }
    } catch (err) {
      console.error('Failed to check scout status:', err);
    }
  }

  // Render keywords
  function renderKeywords() {
    if (keywords.length === 0) {
      keywordList.innerHTML = '<div class="empty-state">No keywords added yet</div>';
      return;
    }

    keywordList.innerHTML = keywords.map(kw => `
      <span class="keyword-tag" data-id="${kw.id}">
        ${escapeHtml(kw.keyword)}
        <button class="remove-btn" data-id="${kw.id}" title="Remove keyword">&times;</button>
      </span>
    `).join('');
  }

  // Render keyword tabs with recommendation badges
  function renderKeywordTabs() {
    if (keywords.length === 0) {
      keywordTabs.innerHTML = '';
      return;
    }

    keywordTabs.innerHTML = keywords.map((kw, i) => {
      const report = reports.find(r => r.keyword === kw.keyword);
      const recommendation = report?.recommendation || null;
      const badgeClass = recommendation ? `rec-badge rec-${recommendation.toLowerCase()}` : '';
      const badgeText = recommendation ? recommendation.charAt(0) : '';

      return `
        <button class="keyword-tab ${i === 0 || currentKeyword === kw.keyword ? 'active' : ''}"
                data-keyword="${escapeHtml(kw.keyword)}">
          ${escapeHtml(kw.keyword)}
          ${recommendation ? `<span class="${badgeClass}" title="${recommendation}">${badgeText}</span>` : ''}
        </button>
      `;
    }).join('');

    if (!currentKeyword && keywords.length > 0) {
      currentKeyword = keywords[0].keyword;
    }
  }

  // Render product type filter tabs
  function renderProductTypeFilters() {
    if (!productTypeFilters) return;

    productTypeFilters.innerHTML = PRODUCT_TYPE_FILTERS.map(type => `
      <button class="type-filter-btn ${currentProductType === type ? 'active' : ''}"
              data-type="${type}">
        ${type}
      </button>
    `).join('');
  }

  // Update keyword count
  function updateKeywordCount() {
    keywordCount.textContent = `${keywords.length} active`;
    keywordsTrackedEl.textContent = keywords.length;
  }

  // Render research results with expandable rows
  function renderResults() {
    // Render product type filters first
    renderProductTypeFilters();

    let filteredProducts = currentKeyword
      ? products.filter(r => r.keyword === currentKeyword)
      : products;

    // Apply product type filter
    if (currentProductType !== 'All') {
      filteredProducts = filteredProducts.filter(r =>
        (r.product_type || 'Other') === currentProductType
      );
    }

    // Deduplicate by ASIN (keep most recent)
    const seenAsins = new Set();
    const uniqueProducts = filteredProducts.filter(r => {
      if (seenAsins.has(r.asin)) return false;
      seenAsins.add(r.asin);
      return true;
    });

    if (uniqueProducts.length === 0) {
      // Show progress panel in results area when Scout is running/queued
      if (currentJobStatus === 'running' || currentJobStatus === 'queued') {
        resultsContainer.innerHTML = '';
        return; // Progress panel shows in #progress-section
      }

      resultsContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📊</div>
          <div class="empty-title">No data yet</div>
          <div class="empty-text">Run Scout to start collecting market research data.</div>
        </div>
      `;
      return;
    }

    // Sort data
    const sorted = [...uniqueProducts].sort((a, b) => {
      let aVal = a[currentSort.column];
      let bVal = b[currentSort.column];

      if (aVal === null || aVal === undefined) aVal = currentSort.desc ? -Infinity : Infinity;
      if (bVal === null || bVal === undefined) bVal = currentSort.desc ? -Infinity : Infinity;

      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
      if (typeof bVal === 'string') bVal = bVal.toLowerCase();

      if (aVal < bVal) return currentSort.desc ? 1 : -1;
      if (aVal > bVal) return currentSort.desc ? -1 : 1;
      return 0;
    });

    const tableHtml = `
      <div class="results-count">${sorted.length} products found</div>
      <table class="results-table">
        <thead>
          <tr>
            <th data-column="product_type" class="${getSortClass('product_type')}">Type</th>
            <th data-column="rank_position" class="${getSortClass('rank_position')}">Rank</th>
            <th data-column="asin" class="${getSortClass('asin')}">ASIN</th>
            <th data-column="title" class="${getSortClass('title')}">Title</th>
            <th data-column="brand" class="${getSortClass('brand')}">Brand</th>
            <th data-column="price" class="${getSortClass('price')}">Price</th>
            <th data-column="rating" class="${getSortClass('rating')}">Rating</th>
            <th data-column="review_count" class="${getSortClass('review_count')}">Reviews</th>
            <th data-column="bsr" class="${getSortClass('bsr')}">BSR</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map(r => renderProductRow(r)).join('')}
        </tbody>
      </table>
    `;

    resultsContainer.innerHTML = tableHtml;
  }

  // Render a single product row with expand capability
  function renderProductRow(r) {
    const isExpanded = expandedProducts.has(r.asin);
    const productType = r.product_type || 'Other';
    const typeClass = productType.toLowerCase().replace(/[^a-z]/g, '-');

    let rowHtml = `
      <tr class="${r.is_sponsored ? 'sponsored-row' : ''} ${isExpanded ? 'expanded' : ''}" data-asin="${r.asin}">
        <td><span class="product-type-badge type-${typeClass}">${productType}</span></td>
        <td>${r.rank_position || '-'}</td>
        <td class="asin">
          <a href="https://www.amazon.com/dp/${r.asin}" target="_blank" rel="noopener">${r.asin || '-'}</a>
        </td>
        <td class="title" title="${escapeHtml(r.title || '')}">${escapeHtml(truncate(r.title, 50) || '-')}</td>
        <td>${escapeHtml(truncate(r.brand, 15) || '-')}</td>
        <td class="price">${r.price ? '$' + r.price.toFixed(2) : '-'}</td>
        <td class="rating">${r.rating ? renderStars(r.rating) : '-'}</td>
        <td>${r.review_count ? r.review_count.toLocaleString() : '-'}</td>
        <td>${r.bsr ? r.bsr.toLocaleString() : '-'}</td>
        <td>
          <button class="expand-btn" data-asin="${r.asin}" title="${isExpanded ? 'Collapse' : 'Expand details'}">
            ${isExpanded ? '▲' : '▼'}
          </button>
          ${r.images && r.images.length > 0 ? `<span class="image-count-badge" title="${r.images.length} images">📸${r.images.length}</span>` : ''}
          ${r.is_sponsored ? '<span class="flag-badge sponsored">AD</span>' : ''}
          ${r.bsr && r.bsr < 10000 ? '<span class="flag-badge top-seller">TOP</span>' : ''}
          ${PHASE5_RESEARCHED_ASINS.has(r.asin) ? '<span class="flag-badge phase5" title="Phase 5: Deep Research Complete">P5 🔬</span>' : ''}
        </td>
      </tr>
    `;

    // Add expanded details row if expanded
    if (isExpanded) {
      rowHtml += `
        <tr class="details-row" data-asin="${r.asin}">
          <td colspan="10">
            <div class="product-details-panel" id="details-${r.asin}">
              <div class="details-loading">Loading details...</div>
            </div>
          </td>
        </tr>
      `;
    }

    return rowHtml;
  }

  // Load and render expanded product details
  async function loadProductDetails(asin) {
    const panel = document.getElementById(`details-${asin}`);
    if (!panel) return;

    // Find the product
    const product = products.find(p => p.asin === asin);
    if (!product) return;

    // Load reviews, specs, images, and Phase 5 data in parallel
    const [productReviews, productSpecs, productImages, phase5Data] = await Promise.all([
      loadReviewsForProduct(asin),
      loadSpecsForProduct(asin),
      loadImagesForProduct(asin),
      PHASE5_RESEARCHED_ASINS.has(asin) ? loadPhase5Data(asin) : Promise.resolve(null)
    ]);

    // Group images by type
    const mainImages = productImages.filter(i => i.image_type === 'main');
    const galleryImages = productImages.filter(i => i.image_type === 'gallery');
    const aplusImages = productImages.filter(i => i.image_type === 'aplus');
    const ocrDone = productImages.filter(i => i.ocr_status === 'done').length;
    const hasOcr = ocrDone > 0;

    // Build enhanced images section
    const renderImageGallery = () => {
      if (productImages.length === 0 && (!product.images || product.images.length === 0)) {
        return '';
      }

      // Use new image data if available, fallback to product.images
      const useNewImages = productImages.length > 0;

      let html = `<div class="details-section images-section">
        <h4>Images <span class="image-count-badge">(${useNewImages ? productImages.length : product.images.length})</span>
          ${hasOcr ? '<span class="ocr-badge ready">OCR ready</span>' : '<span class="ocr-badge pending">OCR pending</span>'}
        </h4>`;

      if (useNewImages) {
        // Main image (large)
        if (mainImages.length > 0) {
          html += `<div class="image-type-label">Main Image</div>
            <a href="${escapeHtml(mainImages[0].url)}" target="_blank" rel="noopener">
              <img src="${escapeHtml(mainImages[0].url)}" alt="Main product image" class="product-img-main" loading="lazy">
            </a>`;
        }

        // Gallery thumbnails
        if (galleryImages.length > 0) {
          html += `<div class="image-type-label">Gallery (${galleryImages.length})</div>
            <div class="product-gallery">
              ${galleryImages.map(img => `
                <a href="${escapeHtml(img.url)}" target="_blank" rel="noopener">
                  <img src="${escapeHtml(img.url)}" alt="Gallery image" class="product-img-thumb" loading="lazy">
                </a>
              `).join('')}
            </div>`;
        }

        // A+ Content images
        if (aplusImages.length > 0) {
          html += `<div class="image-type-label">A+ Content (${aplusImages.length})</div>
            <div class="product-gallery">
              ${aplusImages.map(img => `
                <a href="${escapeHtml(img.url)}" target="_blank" rel="noopener">
                  <img src="${escapeHtml(img.url)}" alt="A+ content image" class="product-img-thumb" loading="lazy">
                </a>
              `).join('')}
            </div>`;
        }
      } else {
        // Fallback to legacy images array
        html += `<div class="product-gallery">
          ${product.images.slice(0, 6).map(img => `
            <a href="${escapeHtml(img)}" target="_blank" rel="noopener">
              <img src="${escapeHtml(img)}" alt="Product image" class="product-img-thumb" loading="lazy">
            </a>
          `).join('')}
        </div>`;
      }

      html += '</div>';
      return html;
    };

    // V3.0: Render Phase 5 deep research panel
    const renderPhase5Panel = () => {
      if (!phase5Data) return '';
      const sentimentIcon = { positive: '🟢', mixed: '🟡', negative: '🔴', none: '⚪' }[phase5Data.reddit_sentiment] || '⚪';
      const transparencyIcon = phase5Data.transparency_flag ? '✅' : '⚠️';

      return `
        <div class="details-section phase5-panel">
          <h4>🔬 Phase 5 Deep Research <span class="flag-badge phase5">P5</span></h4>

          ${phase5Data.benefits && phase5Data.benefits.length > 0 ? `
            <div class="p5-block">
              <div class="p5-label">Key Benefits</div>
              <ul class="p5-list">
                ${phase5Data.benefits.map(b => `<li>${escapeHtml(b)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}

          ${phase5Data.formula_notes ? `
            <div class="p5-block">
              <div class="p5-label">Formula Notes</div>
              <p class="p5-text">${escapeHtml(phase5Data.formula_notes)}</p>
            </div>
          ` : ''}

          ${phase5Data.certifications && phase5Data.certifications.length > 0 ? `
            <div class="p5-block">
              <div class="p5-label">Certifications ${transparencyIcon}</div>
              <div class="p5-certs">
                ${phase5Data.certifications.map(c => `<span class="cert-badge">${escapeHtml(c)}</span>`).join('')}
                ${phase5Data.third_party_tested ? '<span class="cert-badge cert-green">3rd Party Tested</span>' : ''}
              </div>
            </div>
          ` : ''}

          <div class="p5-row">
            <div class="p5-block p5-half">
              <div class="p5-label">${sentimentIcon} Reddit Sentiment</div>
              <div class="p5-sentiment p5-${phase5Data.reddit_sentiment || 'none'}">${(phase5Data.reddit_sentiment || 'None').toUpperCase()}</div>
              ${phase5Data.reddit_notes ? `<p class="p5-text p5-small">${escapeHtml(phase5Data.reddit_notes)}</p>` : ''}
            </div>

            ${phase5Data.external_reviews && phase5Data.external_reviews.length > 0 ? `
              <div class="p5-block p5-half">
                <div class="p5-label">External Reviews</div>
                ${phase5Data.external_reviews.map(r => `
                  <div class="p5-review-item">
                    <span class="p5-review-source">${escapeHtml(r.source)}</span>
                    ${r.rating ? `<span class="p5-review-rating">${escapeHtml(r.rating)}</span>` : ''}
                    <p class="p5-text p5-small">${escapeHtml(truncate(r.summary, 120))}</p>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>

          <div class="p5-row">
            ${phase5Data.key_strengths ? `
              <div class="p5-block p5-half p5-strengths">
                <div class="p5-label">💪 Key Strengths</div>
                <p class="p5-text">${escapeHtml(phase5Data.key_strengths)}</p>
              </div>
            ` : ''}
            ${phase5Data.key_weaknesses ? `
              <div class="p5-block p5-half p5-weaknesses">
                <div class="p5-label">⚠️ Key Weaknesses</div>
                <p class="p5-text">${escapeHtml(phase5Data.key_weaknesses)}</p>
              </div>
            ` : ''}
          </div>

          ${phase5Data.competitor_angle ? `
            <div class="p5-block p5-competitor">
              <div class="p5-label">🎯 Dovive Competitor Angle</div>
              <p class="p5-text">${escapeHtml(phase5Data.competitor_angle)}</p>
            </div>
          ` : ''}

          <div class="p5-meta">Researched by Scout · ${phase5Data.researched_at ? new Date(phase5Data.researched_at).toLocaleDateString() : ''}</div>
        </div>
      `;
    };

    // Render the details panel
    panel.innerHTML = `
      <div class="details-grid">
        <!-- Phase 5 Deep Research Panel (if available) -->
        ${renderPhase5Panel()}

        <!-- Images Section -->
        ${renderImageGallery()}

        <!-- Features Section -->
        ${product.features && product.features.length > 0 ? `
          <div class="details-section features-section">
            <h4>Key Features</h4>
            <ul class="features-list">
              ${product.features.slice(0, 5).map(f => `<li>${escapeHtml(f)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        <!-- Specs Section -->
        ${productSpecs ? `
          <div class="details-section specs-section">
            <h4>Specifications</h4>
            <div class="specs-grid">
              ${productSpecs.item_form ? `<div class="spec-item"><span class="spec-label">Form:</span> ${escapeHtml(productSpecs.item_form)}</div>` : ''}
              ${productSpecs.unit_count ? `<div class="spec-item"><span class="spec-label">Count:</span> ${escapeHtml(productSpecs.unit_count)}</div>` : ''}
              ${productSpecs.diet_type ? `<div class="spec-item"><span class="spec-label">Diet:</span> ${escapeHtml(productSpecs.diet_type)}</div>` : ''}
              ${productSpecs.manufacturer ? `<div class="spec-item"><span class="spec-label">Manufacturer:</span> ${escapeHtml(productSpecs.manufacturer)}</div>` : ''}
              ${productSpecs.country_of_origin ? `<div class="spec-item"><span class="spec-label">Origin:</span> ${escapeHtml(productSpecs.country_of_origin)}</div>` : ''}
            </div>
            ${productSpecs.certifications && productSpecs.certifications.length > 0 ? `
              <div class="certifications">
                <span class="spec-label">Certifications:</span>
                ${productSpecs.certifications.map(c => `<span class="cert-badge">${escapeHtml(c)}</span>`).join('')}
              </div>
            ` : ''}
            ${productSpecs.ingredients ? `
              <div class="ingredients-preview">
                <span class="spec-label">Ingredients:</span>
                <p>${escapeHtml(truncate(productSpecs.ingredients, 200))}</p>
              </div>
            ` : ''}
          </div>
        ` : ''}

        <!-- Reviews Section -->
        <div class="details-section reviews-section">
          <h4>Recent Reviews (${productReviews.length})</h4>
          ${productReviews.length > 0 ? `
            <div class="reviews-list">
              ${productReviews.slice(0, 5).map(rev => `
                <div class="review-item">
                  <div class="review-header">
                    <span class="reviewer-name">${escapeHtml(rev.reviewer_name || 'Anonymous')}</span>
                    <span class="review-rating">${rev.rating ? '★'.repeat(Math.floor(rev.rating)) : ''}</span>
                    ${rev.verified_purchase ? '<span class="verified-badge">Verified</span>' : ''}
                  </div>
                  <div class="review-title">${escapeHtml(rev.title || '')}</div>
                  <div class="review-body">${escapeHtml(truncate(rev.body, 150) || '')}</div>
                  ${rev.review_date ? `<div class="review-date">${rev.review_date}</div>` : ''}
                </div>
              `).join('')}
            </div>
            ${productReviews.length > 5 ? `
              <a href="https://www.amazon.com/product-reviews/${asin}" target="_blank" class="view-all-link">
                View all reviews on Amazon →
              </a>
            ` : ''}
          ` : '<p class="no-data">No reviews available</p>'}
        </div>
      </div>
    `;
  }

  // Render stars for rating
  function renderStars(rating) {
    const fullStars = Math.floor(rating);
    const hasHalf = rating - fullStars >= 0.5;
    let stars = '';
    for (let i = 0; i < fullStars; i++) stars += '★';
    if (hasHalf) stars += '½';
    return `<span class="stars">${stars}</span> ${rating.toFixed(1)}`;
  }

  // Truncate text
  function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len) + '...' : str;
  }

  // Render AI summary
  function renderSummary() {
    const report = currentKeyword
      ? reports.find(r => r.keyword === currentKeyword)
      : reports[0];

    if (!report || !report.ai_summary) {
      summaryContent.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🤖</div>
          <div class="empty-title">No analysis available</div>
          <div class="empty-text">AI summary will appear after Scout completes a research run.</div>
        </div>
      `;
      summaryTime.textContent = '';
      return;
    }

    const recBadge = report.recommendation
      ? `<div class="summary-recommendation rec-${report.recommendation.toLowerCase()}">${report.recommendation}</div>`
      : '';

    const statsHtml = `
      <div class="summary-stats">
        <div class="stat-item">
          <span class="stat-label">Products</span>
          <span class="stat-value">${report.total_products || '-'}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Avg Price</span>
          <span class="stat-value">${report.avg_price ? '$' + report.avg_price.toFixed(2) : '-'}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Avg Rating</span>
          <span class="stat-value">${report.avg_rating ? report.avg_rating.toFixed(1) + '★' : '-'}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Avg Reviews</span>
          <span class="stat-value">${report.avg_reviews ? report.avg_reviews.toLocaleString() : '-'}</span>
        </div>
      </div>
    `;

    const formattedSummary = formatSummary(report.ai_summary);
    summaryContent.innerHTML = recBadge + statsHtml + '<div class="summary-text">' + formattedSummary + '</div>';
    summaryTime.textContent = `Analyzed ${formatTimeAgo(report.analyzed_at)}`;
  }

  // Format summary text
  function formatSummary(text) {
    return text
      .replace(/^### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^## (.+)$/gm, '<h4>$1</h4>')
      .replace(/^\d+\.\s*\*?\*?([A-Z\s]+)\*?\*?:?\s*/gm, '<h4>$1</h4>')
      .replace(/^\* (.+)$/gm, '<li>$1</li>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
      .replace(/<\/ul>\s*<ul>/g, '')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n/g, '</p><p>');
  }

  // Render progress section with full progress panel
  function renderProgress() {
    if (!progressSection) return;

    // Show progress panel for running or queued status
    if (currentJobStatus !== 'running' && currentJobStatus !== 'queued') {
      progressSection.style.display = 'none';
      return;
    }

    progressSection.style.display = 'block';

    // For queued status, show simple waiting state
    if (currentJobStatus === 'queued') {
      progressSection.innerHTML = `
        <div class="scout-progress-panel">
          <div class="scout-radar">
            <div class="radar-ring r1"></div>
            <div class="radar-ring r2"></div>
            <div class="radar-ring r3"></div>
            <span class="radar-icon">🔭</span>
          </div>
          <div class="scout-running-title">SCOUT IS QUEUED</div>
          <div class="scout-running-sub">Waiting to start Amazon scraping...</div>
        </div>
      `;
      return;
    }

    // Calculate progress metrics
    const totalKeywords = keywords.length || 1;
    const currentKeywordIndex = keywords.findIndex(kw => kw.keyword === currentJobProgress.keyword);
    const keywordIndex = currentKeywordIndex >= 0 ? currentKeywordIndex : 0;

    // Progress calculation constants
    const TOTAL_PRODUCT_TYPES = 20;
    const PRODUCTS_PER_TYPE = 50;

    // Overall progress = (completed keywords / total) + partial current keyword progress
    const completedKeywordsPct = (keywordIndex / totalKeywords) * 100;
    const currentKeywordPct = (currentJobProgress.products / (TOTAL_PRODUCT_TYPES * PRODUCTS_PER_TYPE)) * (100 / totalKeywords);
    const overallPct = Math.min(99, Math.round(completedKeywordsPct + currentKeywordPct));

    // ETA calculation
    let etaStr = 'Calculating...';
    if (currentJob && currentJob.created_at) {
      const elapsedMs = Date.now() - new Date(currentJob.created_at).getTime();
      const elapsedMin = Math.round(elapsedMs / 60000);
      if (overallPct > 5) {
        const estimatedTotalMin = Math.round(elapsedMin / (overallPct / 100));
        const remainingMin = Math.max(1, estimatedTotalMin - elapsedMin);
        etaStr = remainingMin > 60
          ? `~${Math.floor(remainingMin / 60)}h ${remainingMin % 60}m`
          : `~${remainingMin}m`;
      } else {
        etaStr = '~4h (estimating)';
      }
    }

    // Format start time
    const startTime = currentJob && currentJob.created_at
      ? new Date(currentJob.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : '-';

    // Build keyword breakdown rows
    const keywordBreakdownHtml = keywords.map((kw, i) => {
      let status = 'queued';
      let statusText = 'queued';
      let pct = 0;

      if (i < keywordIndex) {
        status = 'done';
        statusText = '✓ complete';
        pct = 100;
      } else if (i === keywordIndex) {
        status = 'active';
        statusText = 'in progress...';
        pct = Math.min(99, Math.round((currentJobProgress.products / (TOTAL_PRODUCT_TYPES * PRODUCTS_PER_TYPE)) * 100));
      }

      return `
        <div class="keyword-row">
          <span class="keyword-name">${escapeHtml(kw.keyword)}</span>
          <div class="keyword-bar">
            <div class="progress-bar-wrap">
              <div class="progress-bar-fill ${status === 'active' ? 'active' : ''}" style="width: ${pct}%"></div>
            </div>
          </div>
          <span class="keyword-status ${status}">${statusText}</span>
        </div>
      `;
    }).join('');

    progressSection.innerHTML = `
      <div class="scout-progress-panel">
        <!-- Animated Scout Radar -->
        <div class="scout-radar">
          <div class="radar-ring r1"></div>
          <div class="radar-ring r2"></div>
          <div class="radar-ring r3"></div>
          <span class="radar-icon">🔭</span>
        </div>

        <div class="scout-running-title">SCOUT IS RUNNING</div>
        <div class="scout-running-sub">Scraping Amazon for supplement market data...</div>

        <!-- Overall Progress Bar -->
        <div class="overall-progress">
          <div class="progress-label">
            <span>OVERALL PROGRESS</span>
            <span>Keyword ${keywordIndex + 1} of ${totalKeywords}</span>
          </div>
          <div class="progress-bar-wrap large">
            <div class="progress-bar-fill active" style="width: ${overallPct}%"></div>
          </div>
          <div class="progress-pct">${overallPct}%</div>
        </div>

        <!-- Current Task Box -->
        <div class="scout-current-task">
          <div>🔍 Searching: <strong>"${escapeHtml(currentJobProgress.keyword) || 'Starting...'}"</strong></div>
          <div>📁 Product Type: <strong>${escapeHtml(currentJobProgress.type) || 'Initializing...'}</strong></div>
          <div>📦 Products found: <strong>${currentJobProgress.products.toLocaleString()}</strong></div>
          <div>⭐ Reviews scraped: <strong>${currentJobProgress.reviews.toLocaleString()}</strong></div>
        </div>

        <!-- Keyword Breakdown -->
        <div class="keyword-breakdown">
          <div class="progress-label" style="margin-bottom: 12px;"><span>KEYWORD PROGRESS</span></div>
          ${keywordBreakdownHtml}
        </div>

        <!-- Stats Row -->
        <div class="scout-stats-row">
          <div class="scout-stat">
            <div class="scout-stat-val">${etaStr}</div>
            <div class="scout-stat-label">Est. Remaining</div>
          </div>
          <div class="scout-stat">
            <div class="scout-stat-val">${startTime}</div>
            <div class="scout-stat-label">Started</div>
          </div>
          <div class="scout-stat">
            <div class="scout-stat-val">${currentJobProgress.products.toLocaleString()}</div>
            <div class="scout-stat-label">Products</div>
          </div>
          <div class="scout-stat">
            <div class="scout-stat-val">${currentJobProgress.reviews.toLocaleString()}</div>
            <div class="scout-stat-label">Reviews</div>
          </div>
        </div>
      </div>
    `;
  }

  // Update status badge with live indicator
  function updateStatusBadge(status) {
    const statusText = {
      idle: 'IDLE',
      queued: 'QUEUED',
      running: 'RUNNING',
      complete: 'COMPLETE',
      error: 'ERROR'
    };

    const statusMessages = {
      idle: '',
      queued: 'Scout V2 queued, waiting to start...',
      running: 'Scout V2 is scraping Amazon (20 product types per keyword)...',
      complete: '',
      error: ''
    };

    scoutStatus.textContent = statusText[status] || status.toUpperCase();
    scoutStatus.className = 'badge ' + status.toLowerCase();

    if (status === 'queued' || status === 'running') {
      scoutStatus.innerHTML = `<span class="pulse-dot ${status}"></span> ${statusText[status]}`;
      runScoutBtn.disabled = true;
    } else {
      runScoutBtn.disabled = false;
    }

    if (statusMessages[status]) {
      showStatusMessage(statusMessages[status], 'info');
    }
  }

  // Show status message
  function showStatusMessage(message, type = 'info') {
    let msgEl = document.querySelector('.scout-status-message');
    if (!msgEl) {
      msgEl = document.createElement('div');
      msgEl.className = 'scout-status-message';
      const scoutControl = document.querySelector('.scout-control');
      if (scoutControl) {
        scoutControl.insertBefore(msgEl, runScoutBtn);
      }
    }

    msgEl.textContent = message;
    msgEl.className = `scout-status-message ${type}`;
    msgEl.style.display = message ? 'block' : 'none';

    if (type === 'success') {
      setTimeout(() => { msgEl.style.display = 'none'; }, 5000);
    }
  }

  // Add keyword
  async function addKeyword() {
    const keyword = keywordInput.value.trim().toLowerCase();
    if (!keyword) return;

    if (keywords.some(k => k.keyword.toLowerCase() === keyword)) {
      alert('Keyword already exists');
      return;
    }

    try {
      addKeywordBtn.disabled = true;
      addKeywordBtn.textContent = 'Adding...';

      await sbInsert('dovive_keywords', { keyword, active: true });
      keywordInput.value = '';
      await loadKeywords();
    } catch (err) {
      console.error('Failed to add keyword:', err);
      alert('Failed to add keyword. Please try again.');
    } finally {
      addKeywordBtn.disabled = false;
      addKeywordBtn.textContent = 'Add';
    }
  }

  // Remove keyword (soft delete)
  async function removeKeyword(id) {
    if (!confirm('Remove this keyword from tracking?')) return;

    try {
      await sbUpdate('dovive_keywords', `id=eq.${id}`, { active: false });
      await loadKeywords();
    } catch (err) {
      console.error('Failed to remove keyword:', err);
      alert('Failed to remove keyword. Please try again.');
    }
  }

  // Trigger Scout run
  async function runScout() {
    try {
      runScoutBtn.disabled = true;
      currentJobStatus = 'queued';
      updateStatusBadge('queued');

      await sbInsert('dovive_jobs', {
        status: 'queued',
        triggered_by: 'manual'
      });

      showStatusMessage('Scout V2 queued! This will scrape 20 product types per keyword.', 'info');
      lastRunEl.textContent = 'Starting...';

      startJobPolling();
    } catch (err) {
      console.error('Failed to trigger Scout:', err);
      alert('Failed to trigger Scout. Please try again.');
      updateStatusBadge('error');
    }
  }

  // Get sort class for column
  function getSortClass(column) {
    if (currentSort.column !== column) return '';
    return 'sorted' + (currentSort.desc ? ' desc' : '');
  }

  // Handle column sort
  function handleSort(column) {
    if (currentSort.column === column) {
      currentSort.desc = !currentSort.desc;
    } else {
      currentSort.column = column;
      currentSort.desc = false;
    }
    renderResults();
  }

  // Format time ago
  function formatTimeAgo(dateStr) {
    if (!dateStr) return 'Unknown';

    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    return date.toLocaleDateString();
  }

  // Escape HTML
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Show keywords error
  function showKeywordsError() {
    keywordList.innerHTML = '<div class="empty-state">Failed to load keywords</div>';
  }

  // Toggle product expansion
  async function toggleProductExpansion(asin) {
    if (expandedProducts.has(asin)) {
      expandedProducts.delete(asin);
    } else {
      expandedProducts.add(asin);
    }

    renderResults();

    // Load details if expanding
    if (expandedProducts.has(asin)) {
      await loadProductDetails(asin);
    }
  }

  // Setup event listeners
  function setupEventListeners() {
    // Add keyword
    addKeywordBtn.addEventListener('click', addKeyword);
    keywordInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') addKeyword();
    });

    // Remove keyword
    keywordList.addEventListener('click', (e) => {
      if (e.target.classList.contains('remove-btn')) {
        removeKeyword(parseInt(e.target.dataset.id));
      }
    });

    // Run Scout
    runScoutBtn.addEventListener('click', runScout);

    // Keyword tabs
    keywordTabs.addEventListener('click', (e) => {
      if (e.target.classList.contains('keyword-tab')) {
        currentKeyword = e.target.dataset.keyword;
        currentProductType = 'All'; // Reset type filter when switching keywords

        document.querySelectorAll('.keyword-tab').forEach(tab => tab.classList.remove('active'));
        e.target.classList.add('active');

        renderResults();
        renderSummary();
      }
    });

    // Product type filters
    if (productTypeFilters) {
      productTypeFilters.addEventListener('click', (e) => {
        if (e.target.classList.contains('type-filter-btn')) {
          currentProductType = e.target.dataset.type;

          document.querySelectorAll('.type-filter-btn').forEach(btn => btn.classList.remove('active'));
          e.target.classList.add('active');

          renderResults();
        }
      });
    }

    // Table sort and expand
    resultsContainer.addEventListener('click', (e) => {
      // Column sort
      if (e.target.tagName === 'TH' && e.target.dataset.column) {
        handleSort(e.target.dataset.column);
      }

      // Expand button
      if (e.target.classList.contains('expand-btn')) {
        const asin = e.target.dataset.asin;
        toggleProductExpansion(asin);
      }
    });
  }

  // Start polling for status updates (slow - every 30 seconds)
  function startStatusPolling() {
    setInterval(async () => {
      if (!isPollingJob) {
        await checkScoutStatus();
      }
    }, 30000);
  }

  // Start faster polling when job is active (every 5 seconds)
  function startJobPolling() {
    if (isPollingJob) return;
    isPollingJob = true;

    pollIntervalId = setInterval(async () => {
      await checkScoutStatus();

      if (currentJobStatus === 'complete' || currentJobStatus === 'error' || currentJobStatus === 'idle') {
        clearInterval(pollIntervalId);
        isPollingJob = false;
      }
    }, 5000);
  }

  // ============================================================
  // PRODUCTS GRID - Card-based view with keyword filters
  // ============================================================

  // Render keyword filter tabs above products grid
  function renderProductsKeywordTabs() {
    if (!productsKeywordTabs) return;

    const allKeywords = ['ALL', ...keywords.map(k => k.keyword)];

    productsKeywordTabs.innerHTML = allKeywords.map(kw => `
      <button class="keyword-filter-tab ${currentGridKeyword === kw ? 'active' : ''}" data-keyword="${escapeHtml(kw)}">
        ${kw === 'ALL' ? 'ALL' : escapeHtml(kw)}
      </button>
    `).join('');
  }

  // Render products grid
  function renderProductsGrid() {
    if (!productsGridContainer) return;

    try {
      // Ensure products is an array (null-safe)
      const safeProducts = products || [];

      // Filter products by keyword (null-safe)
      let filteredProducts = currentGridKeyword === 'ALL'
        ? safeProducts
        : safeProducts.filter(p => p && p.keyword === currentGridKeyword);

      // Sort by BSR (ascending) - null-safe
      filteredProducts = [...filteredProducts].sort((a, b) => {
        const aBsr = (a && a.bsr) || Infinity;
        const bBsr = (b && b.bsr) || Infinity;
        return aBsr - bBsr;
      });

      // Deduplicate by ASIN (null-safe)
      const seenAsins = new Set();
      filteredProducts = filteredProducts.filter(p => {
        if (!p || !p.asin || seenAsins.has(p.asin)) return false;
        seenAsins.add(p.asin);
        return true;
      });

    // Limit to 100
    filteredProducts = filteredProducts.slice(0, 100);

    // Update count
    if (productsCount) {
      productsCount.textContent = `${filteredProducts.length} products`;
    }

    // Empty state
    if (filteredProducts.length === 0) {
      productsGridContainer.innerHTML = `
        <div class="products-empty-state">
          <div class="products-empty-icon">🔭</div>
          <div class="products-empty-title">No data yet</div>
          <div class="products-empty-text">Run Scout to start scraping Amazon market data</div>
          <button class="btn-run-scout" id="run-scout-empty-btn">⚡ RUN SCOUT NOW</button>
        </div>
      `;
      // Re-attach listener for empty state button
      const emptyBtn = document.getElementById('run-scout-empty-btn');
      if (emptyBtn) {
        emptyBtn.addEventListener('click', runScout);
      }
      return;
    }

    // Render grid
    productsGridContainer.innerHTML = `
      <div class="products-grid">
        ${filteredProducts.map(p => renderProductCard(p)).join('')}
      </div>
    `;
    } catch (err) {
      console.error('Error rendering products grid:', err);
      productsGridContainer.innerHTML = `
        <div class="products-empty-state">
          <div class="products-empty-icon">⚠️</div>
          <div class="products-empty-title">Error loading products</div>
          <div class="products-empty-text">Please refresh the page.</div>
        </div>
      `;
    }
  }

  // Render a single product card (null-safe)
  function renderProductCard(p) {
    // Guard against null/undefined product
    if (!p || !p.asin) {
      return '<div class="product-card product-card-error">Invalid product data</div>';
    }

    try {
      const productType = p.product_type || 'Other';
      const typeClass = productType.toLowerCase().replace(/[^a-z]/g, '-');
      // V2.8: Use main_image from dovive_research, fallback to images array
      const mainImage = p.main_image || (p.images && p.images.length > 0 ? (p.images[0].url || p.images[0]) : null);
      const ratingStars = p.rating ? renderStarsCompact(p.rating) : '';
      const source = p.source || (p.bsr && p.bsr < 10000 ? 'best_sellers' : 'keyword_search');
      const isBestSeller = source === 'best_sellers';

    // V2.8: Certifications - show first 3 as small badges
    const certs = p.certifications || [];
    const certsHtml = certs.length > 0
      ? `<div class="product-card-certs">${certs.slice(0, 3).map(c => `<span class="cert-mini">${escapeHtml(c)}</span>`).join('')}</div>`
      : '';

    // V2.8: Servings info
    const servingsInfo = p.total_servings ? `<span class="product-card-servings">${p.total_servings} servings</span>` : '';

    return `
      <div class="product-card" data-asin="${p.asin}" onclick="window.openProductModal('${p.asin}')">
        ${mainImage
          ? `<img src="${escapeHtml(mainImage)}" alt="${escapeHtml(p.title || '')}" class="product-card-img" loading="lazy">`
          : `<div class="product-card-img-placeholder">💊</div>`
        }
        <div class="product-card-badges">
          ${p.bsr ? `<span class="bsr-badge">#${p.bsr.toLocaleString()}${p.bsr_category ? ' in ' + escapeHtml(p.bsr_category.substring(0, 20)) : ''}</span>` : ''}
          <span class="product-type-badge type-${typeClass}">${productType.toUpperCase()}</span>
        </div>
        <div class="product-card-title">${escapeHtml(truncate(p.title, 60) || 'Unknown Product')}</div>
        <div class="product-card-brand">${escapeHtml(p.brand || '')}</div>
        <div class="product-card-price-row">
          <span class="product-card-price">${p.price ? '$' + p.price.toFixed(2) : '-'}</span>
          ${p.price_per_serving ? `<span class="product-card-pps">~$${p.price_per_serving.toFixed(2)}/serving</span>` : ''}
          ${servingsInfo}
        </div>
        <div class="product-card-rating">
          ${ratingStars} ${p.review_count ? `(${p.review_count.toLocaleString()} reviews)` : ''}
        </div>
        ${certsHtml}
        <div class="product-card-footer">
          <span class="source-badge ${isBestSeller ? 'best-seller' : 'keyword'}">
            ${isBestSeller ? 'BEST SELLER' : 'KEYWORD'}
          </span>
        </div>
      </div>
    `;
    } catch (err) {
      console.error('Error rendering product card:', p?.asin, err);
      return `<div class="product-card product-card-error">Error: ${escapeHtml(p?.asin || 'Unknown')}</div>`;
    }
  }

  // Compact star rendering for cards
  function renderStarsCompact(rating) {
    const fullStars = Math.floor(rating);
    const hasHalf = rating - fullStars >= 0.5;
    let stars = '★'.repeat(fullStars);
    if (hasHalf) stars += '½';
    const emptyStars = 5 - fullStars - (hasHalf ? 1 : 0);
    stars += '☆'.repeat(Math.max(0, emptyStars));
    return `<span class="stars">${stars}</span> ${rating.toFixed(1)}`;
  }

  // Setup products grid event listeners
  function setupProductsGridListeners() {
    // Keyword filter tabs
    if (productsKeywordTabs) {
      productsKeywordTabs.addEventListener('click', (e) => {
        if (e.target.classList.contains('keyword-filter-tab')) {
          currentGridKeyword = e.target.dataset.keyword;
          document.querySelectorAll('.keyword-filter-tab').forEach(tab => tab.classList.remove('active'));
          e.target.classList.add('active');
          renderProductsGrid();
        }
      });
    }

    // Empty state run scout button
    const emptyBtn = document.getElementById('run-scout-empty-btn');
    if (emptyBtn) {
      emptyBtn.addEventListener('click', runScout);
    }
  }

  // ============================================================
  // PRODUCT DETAIL MODAL
  // ============================================================

  // Simple fetch helper for modal
  async function sbFetchSimple(path) {
    const { url, anonKey } = window.DOVIVE_SB;
    try {
      const res = await fetch(url + '/rest/v1/' + path, {
        headers: { 'apikey': anonKey, 'Authorization': 'Bearer ' + anonKey }
      });
      return res.json();
    } catch (e) {
      return [];
    }
  }

  // Open product modal
  // Expose Scout controls to dashboard buttons
  window._queueScoutJob = queueScoutJob;
  window._stopScoutJob = stopScoutJob;

  window.openProductModal = async function(asin) {
    if (!asin) {
      showModal('<div class="modal-loading">Error: No product ASIN provided</div>');
      return;
    }

    currentModalAsin = asin;
    currentModalTab = 'overview';
    modalReviewsLoaded = 0;

    // Show modal with loading state
    showModal('<div class="modal-loading"><div class="spinner"></div> Loading product data...</div>');

    try {
      // V2.8: Fetch from dovive_research first (has full data), fallback to other tables
      const [researchArr, productArr, specsArr, reviewsArr, imagesArr, keepaArr, ocrArr] = await Promise.all([
        sbFetchSimple('dovive_research?asin=eq.' + asin + '&limit=1'),
        sbFetchSimple('dovive_products?asin=eq.' + asin + '&limit=1'),
        sbFetchSimple('dovive_specs?asin=eq.' + asin + '&limit=1'),
        sbFetchSimple('dovive_reviews?asin=eq.' + asin + '&order=rating.asc&limit=50'),
        sbFetchSimple('dovive_product_images?asin=eq.' + asin + '&order=image_index.asc'),
        sbFetchSimple('dovive_keepa?asin=eq.' + asin + '&limit=1'),
        sbFetchSimple('dovive_ocr?asin=eq.' + asin + '&raw_text=not.is.null&order=image_index.asc&limit=20')
      ]);

      // V2.8: Merge research data with product data
      const research = (researchArr && researchArr[0]) || {};
      const product = (productArr && productArr[0]) || {};

      // Find best OCR record (prefer one with supplement_facts)
      const ocrBest = (ocrArr || []).find(o => o.supplement_facts && o.supplement_facts.length) || (ocrArr && ocrArr[0]) || null;

      modalProductData = {
        product: { ...product, ...research }, // Research data takes precedence
        specs: (specsArr && specsArr[0]) || {},
        reviews: reviewsArr || [],
        images: imagesArr || [],
        research: research,
        keepa: (keepaArr && keepaArr[0]) || null,
        ocr: ocrBest,
        ocrAll: ocrArr || []
      };

      renderProductModal();
    } catch (err) {
      console.error('Error opening product modal:', asin, err);
      showModal(`
        <div class="modal-header">
          <span class="modal-title">Error</span>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body" style="text-align: center; padding: 40px;">
          <div style="font-size: 32px; margin-bottom: 16px;">⚠️</div>
          <div style="font-size: 14px;">Failed to load product data for ${escapeHtml(asin || 'Unknown')}</div>
          <div style="font-size: 12px; color: #64748B; margin-top: 8px;">Please try again or check the console.</div>
        </div>
      `);
    }
  };

  // Render product modal
  function renderProductModal() {
    const { product: p, specs: s, reviews: revs, images: imgs } = modalProductData;

    if (!p || !p.asin) {
      showModal('<div class="modal-loading">Product not found</div>');
      return;
    }

    const reviewCount = revs.length;
    const imageCount = imgs.length || (p.images ? p.images.length : 0);
    const scrapedDate = p.scraped_at ? new Date(p.scraped_at).toLocaleDateString() : 'Unknown';
    const source = p.source_type || (p.bsr && p.bsr < 10000 ? 'Best Seller' : 'Keyword Search');

    const modalHtml = `
      <div class="modal-header">
        <span class="modal-title">${escapeHtml(truncate(p.title || 'Product Details', 60))}</span>
        <button class="modal-close" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-tabs">
        <button class="modal-tab ${currentModalTab === 'overview' ? 'active' : ''}" data-tab="overview">Overview</button>
        <button class="modal-tab ${currentModalTab === 'specs' ? 'active' : ''}" data-tab="specs">Specs & Formula</button>
        <button class="modal-tab ${currentModalTab === 'reviews' ? 'active' : ''}" data-tab="reviews">Reviews (${reviewCount})</button>
        <button class="modal-tab ${currentModalTab === 'images' ? 'active' : ''}" data-tab="images">Images (${imageCount})</button>
        <button class="modal-tab ${currentModalTab === 'keepa' ? 'active' : ''}" data-tab="keepa">Keepa</button>
        <button class="modal-tab ${currentModalTab === 'ocr' ? 'active' : ''}" data-tab="ocr">🔬 Formula</button>
      </div>
      <div class="modal-body">
        ${renderModalTabContent()}
      </div>
      <div class="modal-footer">
        Data scraped ${scrapedDate} · Source: ${source}
      </div>
    `;

    showModal(modalHtml);

    // Setup tab switching
    document.querySelectorAll('.modal-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        currentModalTab = e.target.dataset.tab;
        document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        document.querySelector('.modal-body').innerHTML = renderModalTabContent();
        setupModalInteractions();
      });
    });

    setupModalInteractions();
  }

  // Setup modal interactions (expand reviews, raw specs toggle)
  function setupModalInteractions() {
    // Review expand (new style)
    document.querySelectorAll('.review-show-more').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const body = e.target.previousElementSibling;
        if (body) {
          body.classList.toggle('truncated');
          body.classList.toggle('expanded');
          e.target.textContent = body.classList.contains('expanded') ? 'Show less' : 'Show more';
        }
      });
    });

    // Legacy review expand
    document.querySelectorAll('.review-expand').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const body = e.target.previousElementSibling;
        if (body) {
          body.classList.toggle('expanded');
          e.target.textContent = body.classList.contains('expanded') ? 'Show less' : 'Show more';
        }
      });
    });

    // Raw specs toggle
    const rawToggle = document.querySelector('.raw-specs-toggle');
    if (rawToggle) {
      rawToggle.addEventListener('click', () => {
        const content = document.querySelector('.raw-specs-content');
        if (content) {
          content.classList.toggle('show');
          rawToggle.textContent = content.classList.contains('show') ? '▼ Hide raw data' : '▶ Show raw data';
        }
      });
    }

    // Load more reviews (new style)
    const loadMoreBtn = document.querySelector('.load-more-reviews-btn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', async () => {
        modalReviewsLoaded += 20;
        document.querySelector('.modal-body').innerHTML = renderModalTabContent();
        setupModalInteractions();
      });
    }

    // Legacy load more
    const legacyLoadMoreBtn = document.querySelector('.load-more-btn');
    if (legacyLoadMoreBtn) {
      legacyLoadMoreBtn.addEventListener('click', async () => {
        modalReviewsLoaded += 20;
        document.querySelector('.modal-body').innerHTML = renderModalTabContent();
        setupModalInteractions();
      });
    }
  }

  // Render modal tab content
  function renderModalTabContent() {
    const { product: p, specs: s, reviews: revs, images: imgs } = modalProductData;

    switch (currentModalTab) {
      case 'overview':
        return renderOverviewTab(p, s, imgs);
      case 'specs':
        return renderSpecsTab(p, s);
      case 'reviews':
        return renderReviewsTab(p, revs);
      case 'images':
        return renderImagesTab(p, imgs);
      case 'keepa':
        return renderKeepaTab(p);
      case 'ocr':
        return renderOCRTab();
      default:
        return renderOverviewTab(p, s, imgs);
    }
  }

  // TAB: OCR - Supplement Facts & Formula
  function renderOCRTab() {
    const ocr = modalProductData.ocr;
    const ocrAll = modalProductData.ocrAll || [];

    if (!ocr && !ocrAll.length) {
      return `<div style="padding:40px;text-align:center;color:#64748B;">
        <div style="font-size:32px;margin-bottom:16px;">🔬</div>
        <div>No OCR data yet. Run Phase 4 (ocr-phase4.js) for this keyword.</div>
      </div>`;
    }

    // V3.1: Use best record that has supplement_facts, fallback to first record with raw_text
    const ocrBestParsed = ocrAll.find(o => o.supplement_facts && o.supplement_facts.length);
    const ocrBestRaw = ocrAll.find(o => o.raw_text);
    const ocrDisplay = ocrBestParsed || ocrBestRaw || ocr;

    const facts = ocrDisplay?.supplement_facts || [];
    const claims = ocrAll.flatMap(o => o.health_claims || []).filter((v, i, a) => v && a.indexOf(v) === i); // dedupe across all images
    const certs = ocrDisplay?.certifications || [];
    const otherIngredients = ocrDisplay?.other_ingredients || '';
    const servingSize = ocrDisplay?.serving_size || 'N/A';
    const servingsPerContainer = ocrDisplay?.servings_per_container || 'N/A';
    const rawTextRecords = ocrAll.filter(o => o.raw_text && (!o.supplement_facts || !o.supplement_facts.length));
    const parsedCount = ocrAll.filter(o => o.supplement_facts && o.supplement_facts.length).length;

    return `
      <div style="padding:20px;font-family:inherit;">

        <!-- Serving Info -->
        <div style="display:flex;gap:16px;margin-bottom:20px;">
          <div style="flex:1;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:16px;text-align:center;">
            <div style="font-size:11px;color:#64748B;text-transform:uppercase;margin-bottom:6px;">Serving Size</div>
            <div style="font-size:16px;color:#0F172A;font-weight:600;">${escapeHtml(servingSize)}</div>
          </div>
          <div style="flex:1;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:16px;text-align:center;">
            <div style="font-size:11px;color:#64748B;text-transform:uppercase;margin-bottom:6px;">Servings / Container</div>
            <div style="font-size:16px;color:#0F172A;font-weight:600;">${escapeHtml(servingsPerContainer)}</div>
          </div>
          <div style="flex:1;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:16px;text-align:center;">
            <div style="font-size:11px;color:#64748B;text-transform:uppercase;margin-bottom:6px;">Images Analyzed</div>
            <div style="font-size:16px;color:#0F172A;font-weight:600;">${ocrAll.length}</div>
          </div>
          <div style="flex:1;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:16px;text-align:center;">
            <div style="font-size:11px;color:#64748B;text-transform:uppercase;margin-bottom:6px;">Structured Parsed</div>
            <div style="font-size:16px;color:${parsedCount > 0 ? '#4D7C0F' : '#D97706'};font-weight:600;">${parsedCount}</div>
          </div>
        </div>

        <!-- Supplement Facts Table -->
        ${facts.length ? `
        <div style="background:#fff;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;margin-bottom:20px;">
          <div style="padding:12px 16px;background:#F8FAFC;border-bottom:1px solid #E2E8F0;font-size:13px;font-weight:600;color:#2563EB;text-transform:uppercase;letter-spacing:1px;">
            📊 Supplement Facts
          </div>
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="background:#F8FAFC;">
                <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748B;text-transform:uppercase;border-bottom:1px solid #E2E8F0;">Ingredient</th>
                <th style="padding:10px 16px;text-align:right;font-size:11px;color:#64748B;text-transform:uppercase;border-bottom:1px solid #E2E8F0;">Amount</th>
                <th style="padding:10px 16px;text-align:right;font-size:11px;color:#64748B;text-transform:uppercase;border-bottom:1px solid #E2E8F0;">% DV</th>
              </tr>
            </thead>
            <tbody>
              ${facts.map((f, i) => `
                <tr style="border-bottom:1px solid #F1F5F9;background:${i % 2 === 0 ? '#fff' : '#F8FAFC'};">
                  <td style="padding:10px 16px;font-size:13px;color:#0F172A;">${escapeHtml(f.name || '')}</td>
                  <td style="padding:10px 16px;font-size:13px;color:#4D7C0F;text-align:right;">${escapeHtml(f.amount || '—')}</td>
                  <td style="padding:10px 16px;font-size:12px;color:#64748B;text-align:right;">${escapeHtml(f.dv_percent || '—')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>` : ''}

        <!-- Other Ingredients -->
        ${otherIngredients ? `
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:16px;margin-bottom:20px;">
          <div style="font-size:11px;color:#64748B;text-transform:uppercase;margin-bottom:8px;letter-spacing:1px;">Other Ingredients</div>
          <div style="font-size:13px;color:#475569;line-height:1.6;">${escapeHtml(otherIngredients)}</div>
        </div>` : ''}

        <!-- Health Claims -->
        ${claims.length ? `
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:16px;margin-bottom:20px;">
          <div style="font-size:11px;color:#64748B;text-transform:uppercase;margin-bottom:12px;letter-spacing:1px;">💬 Health Claims</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${claims.map(c => `<span style="background:rgba(132,204,22,0.1);border:1px solid rgba(132,204,22,0.3);color:#4D7C0F;padding:4px 10px;border-radius:4px;font-size:12px;">${escapeHtml(c)}</span>`).join('')}
          </div>
        </div>` : ''}

        <!-- Certifications -->
        ${certs.length ? `
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:16px;margin-bottom:20px;">
          <div style="font-size:11px;color:#64748B;text-transform:uppercase;margin-bottom:12px;letter-spacing:1px;">✅ Certifications</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${certs.map(c => `<span style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.25);color:#2563EB;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;">${escapeHtml(c)}</span>`).join('')}
          </div>
        </div>` : ''}

        <!-- V3.1: Raw OCR Text Fallback — shown when supplement_facts not yet extracted -->
        ${rawTextRecords.length > 0 ? `
        <div style="background:#FFFBEB;border:1px solid rgba(245,158,11,0.2);border-radius:8px;padding:16px;margin-bottom:20px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
            <div style="font-size:11px;color:#92400E;text-transform:uppercase;letter-spacing:1px;">📄 Raw OCR Text <span style="color:#D97706;margin-left:6px;">(${rawTextRecords.length} image${rawTextRecords.length > 1 ? 's' : ''} — structured extraction pending)</span></div>
          </div>
          ${rawTextRecords.slice(0, 5).map((r, i) => `
            <div style="margin-bottom:${i < rawTextRecords.length - 1 ? '12px' : '0'};padding-bottom:${i < rawTextRecords.length - 1 ? '12px' : '0'};border-bottom:${i < rawTextRecords.length - 1 ? '1px solid #FDE68A' : 'none'};">
              <div style="font-size:10px;color:#92400E;margin-bottom:6px;">Image ${r.image_index !== null ? r.image_index + 1 : i + 1}</div>
              <pre style="font-size:11px;color:#475569;white-space:pre-wrap;word-break:break-word;margin:0;line-height:1.6;font-family:inherit;">${escapeHtml(r.raw_text)}</pre>
            </div>
          `).join('')}
          ${rawTextRecords.length > 5 ? `<div style="font-size:11px;color:#92400E;margin-top:8px;">+ ${rawTextRecords.length - 5} more images. Run phase4-reprocess.js to extract structured data.</div>` : ''}
        </div>` : ''}

      </div>
    `;
  }

  // TAB: Keepa - Enhanced Visual (Amazon Analytics Style)
  function renderKeepaTab(p) {
    const k = modalProductData.keepa;
    if (!k) return '<div style="padding:40px;text-align:center;color:#64748B;">No Keepa data yet. Run Phase 2.</div>';
    
    // Calculate derived metrics
    const salesEst = k.monthly_sales_est || 0;
    const price = k.price_usd || 0;
    const monthlyRevenue = salesEst * price;
    
    // Calculate BSR averages
    const bsr30d = k.bsr_history_30d || [];
    const bsr90d = k.bsr_history_90d || [];
    const avg30d = bsr30d.length > 0 ? Math.round(bsr30d.reduce((sum, r) => sum + r.rank, 0) / bsr30d.length) : null;
    const avg90d = bsr90d.length > 0 ? Math.round(bsr90d.reduce((sum, r) => sum + r.rank, 0) / bsr90d.length) : null;
    const currentBSR = k.bsr_current || 0;
    
    // Horizontal BSR bar calculation (max at 5000 for scale)
    const maxBSR = 5000;
    const currentBSRwidth = Math.min(100, (currentBSR / maxBSR) * 100);
    const avg30dWidth = avg30d ? Math.min(100, (avg30d / maxBSR) * 100) : 0;
    const avg90dWidth = avg90d ? Math.min(100, (avg90d / maxBSR) * 100) : 0;
    
    // Sales bar width (max at 100k for scale)
    const salesBarWidth = Math.min(100, salesEst / 1000);
    
    // Revenue formatting
    const formatRevenue = (rev) => {
      if (rev >= 1000000) return '$' + (rev / 1000000).toFixed(2) + 'M';
      if (rev >= 1000) return '$' + (rev / 1000).toFixed(0) + 'K';
      return '$' + rev.toFixed(0);
    };
    
    // Key metrics with revenue
    const metricsHTML =
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;">' +
        '<div style="background:#fff;padding:16px;border-radius:12px;border:1px solid #E2E8F0;text-align:center;">' +
          '<div style="font-size:24px;font-weight:800;color:#F59E0B;">' + formatRevenue(monthlyRevenue) + '</div>' +
          '<div style="font-size:10px;color:#64748B;text-transform:uppercase;letter-spacing:0.5px;">Monthly Revenue</div>' +
        '</div>' +
        '<div style="background:#fff;padding:16px;border-radius:12px;border:1px solid #E2E8F0;text-align:center;">' +
          '<div style="font-size:24px;font-weight:800;color:#F59E0B;">~' + salesEst.toLocaleString() + '</div>' +
          '<div style="font-size:10px;color:#64748B;text-transform:uppercase;letter-spacing:0.5px;">Monthly Sales</div>' +
          '<div style="background:#E2E8F0;height:6px;border-radius:3px;margin-top:8px;overflow:hidden;"><div style="background:linear-gradient(90deg,#F59E0B,#FBBF24);width:' + salesBarWidth + '%;height:100%;"></div></div>' +
        '</div>' +
        '<div style="background:#fff;padding:16px;border-radius:12px;border:1px solid #E2E8F0;text-align:center;">' +
          '<div style="font-size:24px;font-weight:800;color:#4D7C0F;">$' + (price ? price.toFixed(2) : 'N/A') + '</div>' +
          '<div style="font-size:10px;color:#64748B;text-transform:uppercase;letter-spacing:0.5px;">Current Price</div>' +
        '</div>' +
        '<div style="background:#fff;padding:16px;border-radius:12px;border:1px solid #E2E8F0;text-align:center;">' +
          '<div style="font-size:24px;font-weight:800;color:#7C3AED;">' + (k.rating || 'N/A') + ' ⭐</div>' +
          '<div style="font-size:10px;color:#64748B;text-transform:uppercase;letter-spacing:0.5px;">Rating (' + (k.review_count || 0) + ')</div>' +
        '</div>' +
      '</div>';
    
    // BSR Horizontal Bar Chart (like the image)
    const bsrChartHTML =
      '<div style="background:#F8FAFC;padding:16px;border-radius:12px;margin-bottom:16px;border:1px solid #E2E8F0;">' +
        '<div style="font-weight:600;color:#0F172A;margin-bottom:16px;">📊 Best Seller Rank (BSR)</div>' +

        // Current BSR
        '<div style="margin-bottom:12px;">' +
          '<div style="display:flex;justify-content:space-between;font-size:11px;color:#64748B;margin-bottom:4px;">' +
            '<span>Current</span><span style="color:#0F172A;font-weight:600;">#' + currentBSR.toLocaleString() + '</span>' +
          '</div>' +
          '<div style="background:#E2E8F0;height:12px;border-radius:6px;overflow:hidden;">' +
            '<div style="background:linear-gradient(90deg,#3B82F6,#2563EB);width:' + currentBSRwidth + '%;height:100%;border-radius:6px;"></div>' +
          '</div>' +
        '</div>' +

        // 30-day avg BSR
        (avg30d ?
        '<div style="margin-bottom:12px;">' +
          '<div style="display:flex;justify-content:space-between;font-size:11px;color:#64748B;margin-bottom:4px;">' +
            '<span>30-day avg</span><span style="color:#0F172A;font-weight:600;">#' + avg30d.toLocaleString() + '</span>' +
          '</div>' +
          '<div style="background:#E2E8F0;height:8px;border-radius:4px;overflow:hidden;">' +
            '<div style="background:#94A3B8;width:' + avg30dWidth + '%;height:100%;"></div>' +
          '</div>' +
        '</div>' : '') +

        // 90-day avg BSR
        (avg90d ?
        '<div style="margin-bottom:12px;">' +
          '<div style="display:flex;justify-content:space-between;font-size:11px;color:#64748B;margin-bottom:4px;">' +
            '<span>90-day avg</span><span style="color:#0F172A;font-weight:600;">#' + avg90d.toLocaleString() + '</span>' +
          '</div>' +
          '<div style="background:#E2E8F0;height:8px;border-radius:4px;overflow:hidden;">' +
            '<div style="background:#CBD5E1;width:' + avg90dWidth + '%;height:100%;"></div>' +
          '</div>' +
        '</div>' : '') +

        '<div style="font-size:10px;color:#94A3B8;margin-top:8px;">Lower is better</div>' +
      '</div>';
    
    // Seller/fulfillment info
    const sellerInfoHTML =
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px;">' +
        '<div style="background:#fff;padding:12px;border-radius:8px;border:1px solid #E2E8F0;text-align:center;">' +
          '<div style="font-size:10px;color:#64748B;text-transform:uppercase;">Fulfillment</div>' +
          '<div style="font-weight:600;color:#0F172A;font-size:12px;">' + (k.fulfillment || 'N/A') + '</div>' +
        '</div>' +
        '<div style="background:#fff;padding:12px;border-radius:8px;border:1px solid #E2E8F0;text-align:center;">' +
          '<div style="font-size:10px;color:#64748B;text-transform:uppercase;">Sellers</div>' +
          '<div style="font-weight:600;color:#0F172A;font-size:12px;">' + (k.total_offers || 0) + ' total</div>' +
        '</div>' +
        '<div style="background:#fff;padding:12px;border-radius:8px;border:1px solid #E2E8F0;text-align:center;">' +
          '<div style="font-size:10px;color:#64748B;text-transform:uppercase;">BSR Drops 30d</div>' +
          '<div style="font-weight:600;color:' + ((k.bsr_drops_30d || 0) > 0 ? '#4D7C0F' : '#EF4444') + ';font-size:12px;">' +
            ((k.bsr_drops_30d || 0) > 0 ? '📉 ' + k.bsr_drops_30d : '📈 ' + Math.abs(k.bsr_drops_30d || 0)) +
          '</div>' +
        '</div>' +
      '</div>';
    
    return '<div style="padding:20px;max-height:70vh;overflow-y:auto;">' +
      metricsHTML + bsrChartHTML + sellerInfoHTML +
      '<div style="padding:12px;background:#F8FAFC;border-radius:8px;font-size:11px;color:#64748B;border:1px solid #E2E8F0;">' +
        'Brand: <span style="color:#0F172A;font-weight:600;">' + (k.brand || 'N/A') + '</span> | ' +
        'Category: <span style="color:#0F172A;font-weight:600;">' + (k.category || 'N/A') + '</span> | ' +
        'Listed: <span style="color:#0F172A;font-weight:600;">' + (k.listed_since || 'N/A') + '</span>' +
      '</div>' +
    '</div>';
    
    return '<div style="padding:20px;max-height:70vh;overflow-y:auto;">' +
      // Key Metrics Grid
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;">' +
        '<div style="background:linear-gradient(135deg,#1e293b,#0f172a);padding:16px;border-radius:12px;border:1px solid #334155;text-align:center;">' +
          '<div style="font-size:28px;font-weight:800;color:#4ade80;">$' + (k.price_usd ? k.price_usd.toFixed(2) : 'N/A') + '</div>' +
          '<div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Current Price</div>' +
        '</div>' +
        '<div style="background:linear-gradient(135deg,#1e293b,#0f172a);padding:16px;border-radius:12px;border:1px solid #334155;text-align:center;">' +
          '<div style="font-size:28px;font-weight:800;color:#60a5fa;">#' + (k.bsr_current ? k.bsr_current.toLocaleString() : 'N/A') + '</div>' +
          '<div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">BSR Rank</div>' +
        '</div>' +
        '<div style="background:linear-gradient(135deg,#1e293b,#0f172a);padding:16px;border-radius:12px;border:1px solid #334155;text-align:center;">' +
          '<div style="font-size:28px;font-weight:800;color:#f59e0b;">~' + salesEst.toLocaleString() + '</div>' +
          '<div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Monthly Sales</div>' + salesBar +
        '</div>' +
        '<div style="background:linear-gradient(135deg,#1e293b,#0f172a);padding:16px;border-radius:12px;border:1px solid #334155;text-align:center;">' +
          '<div style="font-size:28px;font-weight:800;color:#e879f9;">' + (k.rating || 'N/A') + ' ⭐</div>' +
          '<div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Rating (' + (k.review_count || 0) + ' reviews)</div>' +
        '</div>' +
      '</div>' +
      
      // BSR Trend
      '<div style="background:#0f172a;padding:16px;border-radius:12px;margin-bottom:16px;border:1px solid #1e293b;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
          '<div style="font-weight:600;color:#e2e8f0;">📊 BSR Trend (30 days)</div>' +
          '<div style="font-size:12px;color:' + ((k.bsr_drops_30d || 0) > 0 ? '#4ade80' : '#f87171') + ';">' +
            '📉 ' + (k.bsr_drops_30d || 0) + ' rank improvement</div>' +
        '</div>' +
        '<div style="font-size:11px;color:#64748b;margin-bottom:8px;">Category: ' + (k.bsr_category || 'N/A') + '</div>' +
        '<div style="overflow-x:auto;padding:8px 0;">' + bsrSparkline + '</div>' +
        '<div style="display:flex;justify-content:space-between;font-size:10px;color:#64748b;margin-top:4px;">' +
          '<span>30 days ago</span><span>Today</span>' +
        '</div>' +
      '</div>' +
      
      // Price Trend
      '<div style="background:#0f172a;padding:16px;border-radius:12px;margin-bottom:16px;border:1px solid #1e293b;">' +
        '<div style="font-weight:600;color:#e2e8f0;margin-bottom:12px;">💰 Price Trend (30 days)</div>' +
        '<div style="overflow-x:auto;padding:8px 0;">' + priceSparkline + '</div>' +
        '<div style="display:flex;justify-content:space-between;font-size:10px;color:#64748b;margin-top:4px;">' +
          '<span>30 days ago</span><span>Today</span>' +
        '</div>' +
      '</div>' +
      
      // Additional Info Grid
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">' +
        '<div style="background:#0f172a;padding:12px;border-radius:8px;border:1px solid #1e293b;">' +
          '<div style="font-size:11px;color:#64748b;text-transform:uppercase;">Fulfillment</div>' +
          '<div style="font-weight:600;color:#e2e8f0;">' + (k.fulfillment || 'N/A') + '</div>' +
        '</div>' +
        '<div style="background:#0f172a;padding:12px;border-radius:8px;border:1px solid #1e293b;">' +
          '<div style="font-size:11px;color:#64748b;text-transform:uppercase;">Sellers</div>' +
          '<div style="font-weight:600;color:#e2e8f0;">' + (k.total_offers || 0) + ' total</div>' +
        '</div>' +
        '<div style="background:#0f172a;padding:12px;border-radius:8px;border:1px solid #1e293b;">' +
          '<div style="font-size:11px;color:#64748b;text-transform:uppercase;">Availability</div>' +
          '<div style="font-weight:600;color:#e2e8f0;font-size:12px;">' + (k.availability || 'N/A') + '</div>' +
        '</div>' +
      '</div>' +
      
      // Brand/Category
      '<div style="margin-top:16px;padding:12px;background:#1e293b;border-radius:8px;">' +
        '<div style="font-size:11px;color:#64748b;">Brand: <span style="color:#e2e8f0;">' + (k.brand || 'N/A') + '</span> | ' +
        'Category: <span style="color:#e2e8f0;">' + (k.category || 'N/A') + '</span> | ' +
        'Listed: <span style="color:#e2e8f0;">' + (k.listed_since || 'N/A') + '</span></div>' +
      '</div>' +
    '</div>';
  }

  // TAB 1: Overview
  function renderOverviewTab(p, s, imgs) {
    // V2.8: Use main_image from dovive_research, fallback to images
    const mainImage = p.main_image || (p.images && p.images.length > 0 ? (p.images[0].url || p.images[0]) : (imgs.length > 0 ? imgs[0].url : null));

    // V2.8: Use images array from dovive_research
    let thumbImages = [];
    if (p.images && p.images.length > 0) {
      thumbImages = p.images.slice(0, 6).map(img => typeof img === 'string' ? img : img.url);
    } else if (imgs.length > 0) {
      thumbImages = imgs.slice(0, 6).map(img => img.url || img);
    }

    const productType = p.product_type || 'Other';
    const ratingStars = p.rating ? '★'.repeat(Math.floor(p.rating)) + (p.rating % 1 >= 0.5 ? '½' : '') : '-';

    // Format data based on product type
    let formatDataHtml = '';
    const fmtData = p.format_data || (productType === 'Gummies' ? s.gummies_data : s.powder_data) || {};

    if (productType === 'Gummies' && Object.keys(fmtData).length > 0) {
      formatDataHtml = `
        <div class="format-data-section">
          <div class="format-data-title">GUMMIES FORMAT DATA</div>
          <div class="format-data-grid">
            ${fmtData.base_type ? `<div class="format-data-item"><span class="format-data-label">Base:</span> <span class="format-data-value">${escapeHtml(fmtData.base_type)}</span></div>` : ''}
            ${fmtData.sugar_free !== undefined ? `<div class="format-data-item"><span class="format-data-label">Sugar:</span> <span class="format-data-value">${fmtData.sugar_free ? 'Sugar-Free' : 'Regular'}</span></div>` : ''}
            ${fmtData.sweetener ? `<div class="format-data-item"><span class="format-data-label">Sweetener:</span> <span class="format-data-value">${escapeHtml(fmtData.sweetener)}</span></div>` : ''}
            ${fmtData.flavors_mentioned && fmtData.flavors_mentioned.length > 0 ? `<div class="format-data-item"><span class="format-data-label">Flavors:</span> <span class="format-data-value">${escapeHtml(fmtData.flavors_mentioned.join(', '))}</span></div>` : ''}
          </div>
        </div>
      `;
    } else if (productType === 'Powder' && Object.keys(fmtData).length > 0) {
      formatDataHtml = `
        <div class="format-data-section">
          <div class="format-data-title">POWDER FORMAT DATA</div>
          <div class="format-data-grid">
            ${fmtData.sweetener ? `<div class="format-data-item"><span class="format-data-label">Sweetener:</span> <span class="format-data-value">${escapeHtml(fmtData.sweetener)}</span></div>` : ''}
            ${fmtData.packaging_type ? `<div class="format-data-item"><span class="format-data-label">Packaging:</span> <span class="format-data-value">${escapeHtml(fmtData.packaging_type)}</span></div>` : ''}
            ${fmtData.serving_size ? `<div class="format-data-item"><span class="format-data-label">Serving Size:</span> <span class="format-data-value">${escapeHtml(fmtData.serving_size)}</span></div>` : ''}
            ${fmtData.is_instant !== undefined ? `<div class="format-data-item"><span class="format-data-label">Instant:</span> <span class="format-data-value">${fmtData.is_instant ? 'Yes' : 'No'}</span></div>` : ''}
          </div>
        </div>
      `;
    }

    // V2.8: Certifications from dovive_research or specs
    const certs = p.certifications || s.certifications || [];
    const certsHtml = certs.length > 0
      ? `<div class="certifications-row">${certs.map(c => `<span class="cert-tag">${escapeHtml(c)}</span>`).join('')}</div>`
      : '';

    // V2.8: Bullet points from dovive_research (KEY SELLING POINTS section)
    const bulletPoints = p.bullet_points || p.features || s.features || [];
    const bulletPointsHtml = bulletPoints.length > 0
      ? `<div class="features-section"><div class="features-title">KEY SELLING POINTS</div><ul class="features-bullets">${bulletPoints.slice(0, 6).map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul></div>`
      : '';

    // V2.8: Source badge
    const source = p.source || 'keyword_search';
    const sourceLabel = source === 'best_sellers' ? 'Best Seller' : 'Keyword Search';

    return `
      <div class="modal-overview-grid">
        <div class="overview-left">
          ${mainImage
            ? `<img src="${escapeHtml(mainImage)}" alt="${escapeHtml(p.title || '')}" class="overview-main-img">`
            : '<div class="product-card-img-placeholder" style="height:200px;font-size:48px;">💊</div>'
          }
          ${thumbImages.length > 1 ? `
            <div class="overview-thumbs">
              ${thumbImages.map((img, i) => `
                <img src="${escapeHtml(img)}" alt="Thumbnail ${i + 1}" class="overview-thumb ${i === 0 ? 'active' : ''}">
              `).join('')}
            </div>
          ` : ''}
          <a href="https://www.amazon.com/dp/${p.asin}" target="_blank" rel="noopener" class="btn-amazon">
            View on Amazon ↗
          </a>
        </div>
        <div class="overview-right">
          <div class="overview-title">${escapeHtml(p.title || 'Unknown Product')}</div>
          <div class="overview-meta">${escapeHtml(p.brand || 'Unknown')} | ASIN: ${p.asin}</div>

          <div class="overview-price-row">
            <span class="overview-price">${p.price ? '$' + p.price.toFixed(2) : '-'}</span>
            ${p.price_per_serving ? `<span class="overview-price-detail">~$${p.price_per_serving.toFixed(2)}/serving</span>` : ''}
            ${p.total_servings ? `<span class="overview-price-detail">${p.total_servings} servings total</span>` : ''}
          </div>

          <div class="performance-badges">
            ${p.bsr ? `<span class="perf-badge bsr">BSR #${p.bsr.toLocaleString()} ${p.bsr_category ? 'in ' + escapeHtml(p.bsr_category) : ''}</span>` : ''}
            ${p.rating ? `<span class="perf-badge rating">${ratingStars} ${p.rating.toFixed(1)} (${(p.review_count || 0).toLocaleString()} reviews)</span>` : ''}
            <span class="perf-badge">${sourceLabel}</span>
            <span class="perf-badge">${escapeHtml(productType)}</span>
          </div>

          ${formatDataHtml}
          ${certsHtml}
          ${bulletPointsHtml}
        </div>
      </div>
    `;
  }

  // TAB 2: Specs & Formula
  function renderSpecsTab(p, s) {
    // V2.8: Ingredients from dovive_research or specs
    const ingredients = p.ingredients || s.ingredients || null;
    let ingredientsHtml = '';
    if (ingredients) {
      ingredientsHtml = `
        <div class="specs-section-box">
          <div class="specs-section-title">INGREDIENTS / SUPPLEMENT FACTS</div>
          <div class="ingredients-box">${escapeHtml(ingredients)}</div>
        </div>
      `;
    } else {
      ingredientsHtml = `
        <div class="specs-section-box">
          <div class="specs-section-title">INGREDIENTS / SUPPLEMENT FACTS</div>
          <div class="ocr-pending">⏳ OCR pending</div>
        </div>
      `;
    }

    // V2.8: Specs from dovive_research or dovive_specs
    const allSpecs = p.specs || s.all_specs || {};

    // Build specs table from all keys in the specs object
    const specsRows = Object.entries(allSpecs)
      .filter(([key, val]) => val && String(val).length > 0 && String(val).length < 500)
      .map(([key, val]) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(String(val))}</td></tr>`)
      .join('');

    const specsTableHtml = specsRows ? `
      <div class="specs-section-box">
        <div class="specs-section-title">ALL SPECIFICATIONS</div>
        <table class="specs-table">
          ${specsRows}
        </table>
      </div>
    ` : '<div class="specs-section-box"><div class="specs-section-title">SPECIFICATIONS</div><p class="no-data">No specs available</p></div>';

    // V2.8: Description from dovive_research
    const descriptionHtml = p.description ? `
      <div class="specs-section-box">
        <div class="specs-section-title">PRODUCT DESCRIPTION</div>
        <div class="description-box">${escapeHtml(p.description)}</div>
      </div>
    ` : '';

    // Raw specs JSON
    const rawData = { specs: allSpecs, ingredients, format_data: p.format_data || {} };
    const rawJson = JSON.stringify(rawData, null, 2);

    return `
      ${ingredientsHtml}
      ${specsTableHtml}
      ${descriptionHtml}
      <div class="raw-specs-toggle">▶ Show raw data</div>
      <div class="raw-specs-content">${escapeHtml(rawJson)}</div>
    `;
  }

  // TAB 3: Reviews - Now shows data from dovive_reviews table (individual rows)
  function renderReviewsTab(p, revs) {
    // V2.9: Use reviews from dovive_reviews table (revs) as primary source
    // Fall back to p.reviews only if revs is empty
    const allReviews = revs.length > 0 ? revs : (p.reviews || []);
    const totalReviews = allReviews.length;
    const avgRating = totalReviews > 0
      ? (allReviews.reduce((sum, r) => sum + (r.rating || 0), 0) / totalReviews)
      : (p.rating || 0);
    const ratingStars = '★'.repeat(Math.floor(avgRating)) + (avgRating % 1 >= 0.5 ? '½' : '');

    // Empty state
    if (totalReviews === 0) {
      return `
        <div class="reviews-empty-state">
          <div class="reviews-empty-icon">💬</div>
          <div class="reviews-empty-title">No reviews scraped yet for this product</div>
          <div class="reviews-empty-text">Run Scout to collect reviews.</div>
        </div>
      `;
    }

    // SENTIMENT BREAKDOWN - count by tag and show horizontal bars
    const sentimentCounts = {};
    allReviews.forEach(r => {
      if (r.sentiment_tags && Array.isArray(r.sentiment_tags)) {
        r.sentiment_tags.forEach(tag => {
          sentimentCounts[tag] = (sentimentCounts[tag] || 0) + 1;
        });
      }
    });

    const maxCount = Math.max(...Object.values(sentimentCounts), 1);
    const sentimentItems = Object.entries(sentimentCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([tag, count]) => {
        const isPositive = tag.includes('positive');
        const isNegative = tag.includes('negative') || tag.includes('side-effects');
        const barWidth = Math.round((count / maxCount) * 100);
        const colorClass = isPositive ? 'positive' : isNegative ? 'negative' : 'neutral';
        return `
          <div class="sentiment-row">
            <span class="sentiment-tag-name">${escapeHtml(tag)}</span>
            <div class="sentiment-bar-wrap">
              <div class="sentiment-bar-fill ${colorClass}" style="width:${barWidth}%"></div>
            </div>
            <span class="sentiment-count-num">${count}</span>
          </div>
        `;
      })
      .join('');

    // Reviews list (paginated, 20 per page)
    const displayReviews = allReviews.slice(0, 20 + modalReviewsLoaded);
    const hasMore = allReviews.length > displayReviews.length;

    const reviewsListHtml = displayReviews.map(r => {
      const stars = r.rating ? '★'.repeat(Math.floor(r.rating)) + (r.rating % 1 >= 0.5 ? '½' : '') : '';
      const verified = (r.verified_purchase || r.verified) ? '<span class="verified-badge-review">VERIFIED ✓</span>' : '';
      const tags = (r.sentiment_tags || []).map(t => {
        const isPos = t.includes('positive');
        const isNeg = t.includes('negative') || t.includes('side-effects');
        return `<span class="review-sentiment-chip ${isPos ? 'pos' : isNeg ? 'neg' : ''}">${escapeHtml(t)}</span>`;
      }).join('');

      // Body with 3 lines limit and expand toggle
      const bodyText = r.body || '';
      const isLong = bodyText.length > 200;

      return `
        <div class="review-card">
          <div class="review-header-row">
            <span class="review-rating-stars">${stars}</span>
            ${verified}
          </div>
          <div class="review-title-text"><strong>${escapeHtml(r.title || '')}</strong></div>
          <div class="review-body-text ${isLong ? 'truncated' : ''}">${escapeHtml(bodyText)}</div>
          ${isLong ? '<span class="review-show-more">Show more</span>' : ''}
          <div class="review-meta-line">
            ${escapeHtml(r.reviewer_name || 'Anonymous')} · ${r.review_date || r.date || ''} ${r.helpful_votes ? '· Helpful: ' + r.helpful_votes : ''}
          </div>
          ${tags ? `<div class="review-chips">${tags}</div>` : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="reviews-summary-header">
        <div class="reviews-overall-stats">
          <span class="reviews-total-badge">Total reviews: ${totalReviews}</span>
          <span class="reviews-avg-badge">Avg rating: <span class="stars">${ratingStars}</span> ${avgRating.toFixed(1)}</span>
        </div>
      </div>

      ${sentimentItems ? `
        <div class="sentiment-breakdown-section">
          <div class="sentiment-section-title">SENTIMENT BREAKDOWN</div>
          <div class="sentiment-bars-container">
            ${sentimentItems}
          </div>
        </div>
      ` : ''}

      <div class="reviews-list-section">
        ${reviewsListHtml}
      </div>

      ${hasMore ? '<button class="load-more-reviews-btn">Load more</button>' : ''}
    `;
  }

  // TAB 4: Images
  function renderImagesTab(p, imgs) {
    // V2.8: Use images from dovive_research first (has type info)
    const researchImages = p.images || [];

    // Group images by type from dovive_research
    const mainImages = researchImages.filter(i => i.type === 'main');
    const galleryImages = researchImages.filter(i => i.type === 'gallery');
    const aplusImages = researchImages.filter(i => i.type === 'aplus');

    // Also check dovive_product_images table
    const tableMainImages = imgs.filter(i => i.image_type === 'main');
    const tableGalleryImages = imgs.filter(i => i.image_type === 'gallery');
    const tableAplusImages = imgs.filter(i => i.image_type === 'aplus');

    const renderImageItem = (img, isUrl = false) => {
      const url = isUrl ? img : (img.url || img);
      const ocrStatus = isUrl ? 'pending' : (img.ocr_status || 'pending');
      return `
        <div class="image-item">
          <a href="${escapeHtml(url)}" target="_blank" rel="noopener">
            <img src="${escapeHtml(url)}" alt="Product image" class="listing-img" loading="lazy">
          </a>
          ${!isUrl && ocrStatus ? `
            <span class="ocr-badge-img ${ocrStatus === 'done' ? 'done' : 'pending'}">
              ${ocrStatus === 'done' ? '✓ Text Extracted' : '⏳ OCR Pending'}
            </span>
          ` : ''}
        </div>
      `;
    };

    let html = '';

    // Use research images if available, otherwise fall back to table images
    const useResearch = researchImages.length > 0;
    const finalMainImages = useResearch ? mainImages : tableMainImages;
    const finalGalleryImages = useResearch ? galleryImages : tableGalleryImages;
    const finalAplusImages = useResearch ? aplusImages : tableAplusImages;

    if (finalMainImages.length > 0) {
      const mainUrl = finalMainImages[0].url || finalMainImages[0];
      html += `
        <div class="images-group-title">MAIN IMAGE</div>
        <div class="main-image-display">
          <a href="${escapeHtml(mainUrl)}" target="_blank" rel="noopener">
            <img src="${escapeHtml(mainUrl)}" alt="Main product image">
          </a>
        </div>
      `;
    }

    if (finalGalleryImages.length > 0) {
      html += `
        <div class="images-group-title">GALLERY (${finalGalleryImages.length})</div>
        <div class="images-grid">
          ${finalGalleryImages.map(img => renderImageItem(img)).join('')}
        </div>
      `;
    }

    if (finalAplusImages.length > 0) {
      html += `
        <div class="images-group-title">A+ CONTENT (${finalAplusImages.length})</div>
        <div class="images-grid aplus">
          ${finalAplusImages.map(img => renderImageItem(img)).join('')}
        </div>
      `;
    }

    // Fallback to flat images array
    if (!html && researchImages.length > 0 && !researchImages[0].type) {
      html += `
        <div class="images-group-title">PRODUCT IMAGES (${researchImages.length})</div>
        <div class="images-grid">
          ${researchImages.map(img => renderImageItem(img, typeof img === 'string')).join('')}
        </div>
      `;
    }

    if (!html) {
      html = '<div class="no-data">No images available</div>';
    }

    html += `
      <div class="images-note">
        Click any image to open full size. Images marked OCR Pending will be analyzed for supplement facts and formula data.
      </div>
    `;

    return html;
  }

  // Show modal
  function showModal(html) {
    let overlay = document.getElementById('product-modal-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'product-modal-overlay';
      overlay.className = 'modal-overlay';
      overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = '<div class="modal-container">' + html + '</div>';
    overlay.style.display = 'flex';
    document.addEventListener('keydown', handleModalEsc);
  }

  // Close modal
  window.closeModal = function() {
    const overlay = document.getElementById('product-modal-overlay');
    if (overlay) overlay.style.display = 'none';
    document.removeEventListener('keydown', handleModalEsc);
    currentModalAsin = null;
  };

  // Handle Escape key for modal
  function handleModalEsc(e) {
    if (e.key === 'Escape') closeModal();
  }

  // ============================================================
  // V2.7: NAVIGATION AND VIEW MANAGEMENT
  // ============================================================

  // Setup sidebar navigation
  function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const view = item.dataset.view;
        if (view) {
          navigateToView(view);
        }
      });
    });
  }

  // Navigate to a specific view
  function navigateToView(view) {
    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === view);
    });

    // Hide all views
    document.querySelectorAll('.view-container').forEach(v => {
      v.style.display = 'none';
    });

    // Show target view
    const viewContainer = document.getElementById('view-' + view);
    if (viewContainer) {
      viewContainer.style.display = 'block';
    }

    // Update header
    const pageTitle = document.getElementById('page-title');
    const pageSubtitle = document.getElementById('page-subtitle');

    switch (view) {
      case 'keywords':
        pageTitle.textContent = 'Keywords';
        pageSubtitle.textContent = 'Track and analyze your target keywords';
        showKeywordsPage();
        break;
      case 'keyword-detail':
        // Header is set by showKeywordDetail
        break;
      case 'product-explorer':
        pageTitle.textContent = 'Product Explorer';
        pageSubtitle.textContent = 'Browse all tracked products';
        break;
      case 'settings':
        pageTitle.textContent = 'Scout Settings';
        pageSubtitle.textContent = 'Configure Scout behavior and view changelog';
        renderSettingsPage();
        break;
      case 'overview':
        pageTitle.textContent = 'Overview';
        pageSubtitle.textContent = 'Dashboard overview with Scout controls';
        renderOverviewSummary();
        break;
      case 'market-analysis':
        pageTitle.textContent = 'Market Analysis';
        pageSubtitle.textContent = 'Competitive intelligence across all keywords — Phase 6';
        renderMarketAnalysisPage();
        break;
      case 'formula':
        pageTitle.textContent = 'Formula';
        pageSubtitle.textContent = 'Final formula with FDA compliance & competitive benchmarking';
        renderFormulaPage();
        break;
    }

    currentView = view;
  }

  // ============================================================
  // PHASE 6: MARKET COMPETITIVE ANALYSIS
  // ============================================================

  let marketAnalysisKeyword = 'ashwagandha gummies'; // default

  // Render market analysis inside keyword detail tab
  async function renderKeywordMarketAnalysis(keyword) {
    const container = document.getElementById('kw-market-analysis-container');
    if (!container) return;
    marketAnalysisKeyword = keyword;
    await renderMarketAnalysisInContainer(container, keyword);
  }

  async function renderMarketAnalysisPage() {
    const container = document.getElementById('market-analysis-container');
    if (!container) return;
    await renderMarketAnalysisInContainer(container, marketAnalysisKeyword, true);
  }

  async function renderMarketAnalysisInContainer(container, keyword, showKeywordSelector = false) {
    if (!container) return;
    container.innerHTML = '<div class="ma-loading">⏳ Loading market intelligence...</div>';

    try {
      // Keyword selector (only for standalone page)
      const kwList = (keywords || []).map(k => k.keyword).filter(Boolean);
      if (!kwList.includes(keyword)) keyword = kwList[0] || 'ashwagandha gummies';
      marketAnalysisKeyword = keyword;

      // Load all data in parallel
      const [researchData, keepaData, reviewsData, ocrData, p5Data] = await Promise.all([
        sbFetch('dovive_research', { filter: `keyword=eq.${encodeURIComponent(marketAnalysisKeyword)}`, limit: 500 }),
        sbFetch('dovive_keepa', { filter: `keyword=eq.${encodeURIComponent(marketAnalysisKeyword)}`, limit: 500 }),
        sbFetch('dovive_reviews', { filter: `keyword=eq.${encodeURIComponent(marketAnalysisKeyword)}`, limit: 1000 }),
        sbFetch('dovive_ocr', { filter: `keyword=eq.${encodeURIComponent(marketAnalysisKeyword)}&raw_text=not.is.null`, limit: 1000 }),
        sbFetch('dovive_phase5_research', { filter: `keyword=eq.${encodeURIComponent(marketAnalysisKeyword)}`, limit: 20 })
      ]);

      const products = researchData || [];
      const keepa = keepaData || [];
      const reviews = reviewsData || [];
      const ocr = ocrData || [];
      const p5 = p5Data || [];

      // Build keepa map
      const keepaMap = {};
      keepa.forEach(k => { keepaMap[k.asin] = k; });

      container.innerHTML = `
        <!-- Keyword Selector (standalone page only) -->
        ${showKeywordSelector ? `
        <div class="ma-keyword-bar">
          <span class="ma-keyword-label">Analyzing:</span>
          <select class="ma-keyword-select" id="ma-keyword-select">
            ${kwList.map(kw => `<option value="${escapeHtml(kw)}" ${kw === keyword ? 'selected' : ''}>${escapeHtml(kw)}</option>`).join('')}
          </select>
          <span class="ma-product-count">${products.length} products</span>
        </div>` : ''}

        <!-- Section 1: Market Overview -->
        ${renderMAOverview(products, keepa)}

        <!-- Section 2: Brand Ranking Table -->
        ${renderMABrandRanking(products, keepaMap)}

        <!-- Section 2b: Brand BSR Bar Chart -->
        ${renderMABrandBSRChart(products)}

        <!-- Section 3: Price vs BSR Scatter -->
        ${renderMAPriceScatter(products)}

        <!-- Section 4: Formula Intelligence -->
        ${renderMAFormulaIntel(ocr, products)}

        <!-- Section 5: Review Sentiment -->
        ${renderMAReviewSentiment(products, reviews)}

        <!-- Section 6: Opportunity Gap Matrix -->
        ${renderMAOpportunityGap(products, ocr, p5)}

        <!-- Section 7: Competitive Comparison Table (P5) -->
        ${renderMACompetitiveTable(p5)}

        <!-- Section 8: Launch Readiness Score -->
        ${renderMALaunchScore(products, keepa, reviews, ocr, p5, keyword)}
      `;

      // Keyword change handler (standalone page only)
      document.getElementById('ma-keyword-select')?.addEventListener('change', (e) => {
        marketAnalysisKeyword = e.target.value;
        renderMarketAnalysisPage();
      });

    } catch (err) {
      console.error('Market analysis error:', err);
      container.innerHTML = `<div class="ma-error">⚠️ Error loading market analysis: ${err.message}</div>`;
    }
  }

  // ── Section 1: Market Overview ──────────────────────────────
  function renderMAOverview(products, keepa) {
    const prices = products.filter(p => p.price).map(p => p.price);
    const bsrs = products.filter(p => p.bsr).map(p => p.bsr);
    const ratings = products.filter(p => p.rating).map(p => p.rating);
    const reviewCounts = products.filter(p => p.review_count).map(p => p.review_count);
    const monthlySales = keepa.filter(k => k.monthly_sales_est).map(k => k.monthly_sales_est);
    const monthlyRevenue = keepa.filter(k => k.monthly_sales_est && k.price_usd).map(k => k.monthly_sales_est * k.price_usd);

    const avgPrice = prices.length ? (prices.reduce((a,b) => a+b, 0) / prices.length).toFixed(2) : 'N/A';
    const minPrice = prices.length ? Math.min(...prices).toFixed(2) : 'N/A';
    const maxPrice = prices.length ? Math.max(...prices).toFixed(2) : 'N/A';
    const avgBsr = bsrs.length ? Math.round(bsrs.reduce((a,b) => a+b, 0) / bsrs.length).toLocaleString() : 'N/A';
    const topBsr = bsrs.length ? Math.min(...bsrs).toLocaleString() : 'N/A';
    const avgRating = ratings.length ? (ratings.reduce((a,b) => a+b, 0) / ratings.length).toFixed(1) : 'N/A';
    const totalReviews = reviewCounts.reduce((a,b) => a+b, 0).toLocaleString();
    const totalRevenue = monthlyRevenue.reduce((a,b) => a+b, 0);
    const revenueStr = totalRevenue >= 1000000 ? '$' + (totalRevenue/1000000).toFixed(1) + 'M' : totalRevenue >= 1000 ? '$' + (totalRevenue/1000).toFixed(0) + 'K' : '$' + totalRevenue.toFixed(0);

    const brands = [...new Set(products.filter(p => p.brand).map(p => p.brand))];

    return `
    <div class="ma-section">
      <div class="ma-section-header">
        <span class="ma-section-icon">📊</span>
        <h2 class="ma-section-title">Market Overview</h2>
        <span class="ma-section-sub">Category-level intelligence</span>
      </div>
      <div class="ma-overview-grid">
        <div class="ma-stat-card ma-stat-primary">
          <div class="ma-stat-value">${products.length}</div>
          <div class="ma-stat-label">Total Products</div>
        </div>
        <div class="ma-stat-card">
          <div class="ma-stat-value">${brands.length}</div>
          <div class="ma-stat-label">Unique Brands</div>
        </div>
        <div class="ma-stat-card ma-stat-revenue">
          <div class="ma-stat-value">${revenueStr}</div>
          <div class="ma-stat-label">Est. Monthly Revenue</div>
        </div>
        <div class="ma-stat-card">
          <div class="ma-stat-value">$${avgPrice}</div>
          <div class="ma-stat-label">Avg Price</div>
          <div class="ma-stat-sub">$${minPrice} – $${maxPrice}</div>
        </div>
        <div class="ma-stat-card">
          <div class="ma-stat-value">#${avgBsr}</div>
          <div class="ma-stat-label">Avg BSR</div>
          <div class="ma-stat-sub">Best: #${topBsr}</div>
        </div>
        <div class="ma-stat-card">
          <div class="ma-stat-value">★ ${avgRating}</div>
          <div class="ma-stat-label">Avg Rating</div>
        </div>
        <div class="ma-stat-card">
          <div class="ma-stat-value">${totalReviews}</div>
          <div class="ma-stat-label">Total Reviews</div>
        </div>
        <div class="ma-stat-card">
          <div class="ma-stat-value">${keepa.length}</div>
          <div class="ma-stat-label">Keepa Enriched</div>
        </div>
      </div>
    </div>`;
  }

  // ── Section 2: Brand Ranking Table ──────────────────────────
  function renderMABrandRanking(products, keepaMap) {
    const brandMap = {};
    products.forEach(p => {
      if (!p.brand) return;
      if (!brandMap[p.brand]) brandMap[p.brand] = { brand: p.brand, products: 0, bsrs: [], prices: [], ratings: [], reviewCounts: [], monthlySales: [] };
      const b = brandMap[p.brand];
      b.products++;
      if (p.bsr) b.bsrs.push(p.bsr);
      if (p.price) b.prices.push(p.price);
      if (p.rating) b.ratings.push(p.rating);
      if (p.review_count) b.reviewCounts.push(p.review_count);
      const k = keepaMap[p.asin];
      if (k?.monthly_sales_est) b.monthlySales.push(k.monthly_sales_est);
    });

    const brands = Object.values(brandMap).map(b => ({
      ...b,
      bestBsr: b.bsrs.length ? Math.min(...b.bsrs) : 999999,
      avgPrice: b.prices.length ? (b.prices.reduce((a,c) => a+c, 0) / b.prices.length) : 0,
      avgRating: b.ratings.length ? (b.ratings.reduce((a,c) => a+c, 0) / b.ratings.length) : 0,
      totalReviews: b.reviewCounts.reduce((a,c) => a+c, 0),
      totalSales: b.monthlySales.reduce((a,c) => a+c, 0)
    })).sort((a, b) => a.bestBsr - b.bestBsr).slice(0, 20);

    return `
    <div class="ma-section">
      <div class="ma-section-header">
        <span class="ma-section-icon">🏆</span>
        <h2 class="ma-section-title">Brand Ranking</h2>
        <span class="ma-section-sub">Top 20 brands by BSR</span>
      </div>
      <div class="ma-table-wrap">
        <table class="ma-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Brand</th>
              <th>Products</th>
              <th>Best BSR</th>
              <th>Avg Price</th>
              <th>Avg Rating</th>
              <th>Total Reviews</th>
              <th>Est. Monthly Sales</th>
            </tr>
          </thead>
          <tbody>
            ${brands.map((b, i) => `
              <tr class="${i < 3 ? 'ma-row-top' : ''}">
                <td><span class="ma-rank">${i + 1}</span></td>
                <td class="ma-brand-name">${escapeHtml(b.brand)}</td>
                <td>${b.products}</td>
                <td>#${b.bestBsr.toLocaleString()}</td>
                <td>${b.avgPrice ? '$' + b.avgPrice.toFixed(2) : '-'}</td>
                <td>${b.avgRating ? '★ ' + b.avgRating.toFixed(1) : '-'}</td>
                <td>${b.totalReviews.toLocaleString()}</td>
                <td>${b.totalSales ? '~' + b.totalSales.toLocaleString() + '/mo' : '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  // ── Section 3: Price vs BSR Scatter (Chart.js) ──────────────
  function renderMAPriceScatter(products) {
    const data = products.filter(p => p.price && p.bsr && p.bsr < 50000).slice(0, 100);
    if (!data.length) return '<div class="ma-section"><div class="ma-empty">No price/BSR data available</div></div>';

    const canvasId = 'ma-scatter-canvas-' + Date.now();

    setTimeout(() => {
      const canvas = document.getElementById(canvasId);
      if (!canvas || !window.Chart) return;
      const topData = data.filter(p => p.bsr < 5000).map(p => ({ x: p.price, y: p.bsr, label: (p.brand || p.asin || '').substring(0, 30) }));
      const otherData = data.filter(p => p.bsr >= 5000).map(p => ({ x: p.price, y: p.bsr, label: (p.brand || p.asin || '').substring(0, 30) }));
      new window.Chart(canvas, {
        type: 'scatter',
        data: {
          datasets: [
            {
              label: 'Top Seller (BSR < 5K)',
              data: topData,
              backgroundColor: 'rgba(132,204,22,0.85)',
              pointRadius: 7,
              pointHoverRadius: 9
            },
            {
              label: 'Other Products',
              data: otherData,
              backgroundColor: 'rgba(59,130,246,0.4)',
              pointRadius: 4,
              pointHoverRadius: 6
            }
          ]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { labels: { color: '#475569', font: { size: 11 } } },
            tooltip: {
              callbacks: {
                label: ctx => {
                  const d = ctx.raw;
                  return ` ${d.label} | $${d.x} | BSR #${d.y.toLocaleString()}`;
                }
              }
            }
          },
          scales: {
            x: {
              title: { display: true, text: 'Price ($)', color: '#475569' },
              grid: { color: 'rgba(0,0,0,0.05)' },
              ticks: { color: '#475569' }
            },
            y: {
              title: { display: true, text: 'BSR (lower = better)', color: '#475569' },
              grid: { color: 'rgba(0,0,0,0.05)' },
              ticks: { color: '#475569' },
              reverse: false
            }
          }
        }
      });
    }, 50);

    return `
    <div class="ma-section">
      <div class="ma-section-header">
        <span class="ma-section-icon">🎯</span>
        <h2 class="ma-section-title">Price vs BSR Map</h2>
        <span class="ma-section-sub">Sweet spot: low price + low BSR (green = top seller)</span>
      </div>
      <div class="ma-chart-canvas-wrap">
        <canvas id="${canvasId}" height="300"></canvas>
        <div class="ma-scatter-legend" style="margin-top:8px;">
          <span class="ma-legend-dot ma-legend-top"></span> Top seller (BSR &lt; 5K)
          <span class="ma-legend-dot ma-legend-normal" style="margin-left:16px;"></span> Other products
        </div>
      </div>
    </div>`;
  }

  // ── Section 2b: Brand BSR Bar Chart (Chart.js) ───────────────
  function renderMABrandBSRChart(products) {
    const brandMap = {};
    products.forEach(p => {
      if (!p.brand || !p.bsr) return;
      if (!brandMap[p.brand]) brandMap[p.brand] = [];
      brandMap[p.brand].push(p.bsr);
    });
    const brands = Object.entries(brandMap)
      .map(([brand, bsrs]) => ({ brand, bestBsr: Math.min(...bsrs) }))
      .sort((a, b) => a.bestBsr - b.bestBsr)
      .slice(0, 15);

    if (!brands.length) return '';

    const canvasId = 'ma-brand-bsr-chart-' + Date.now();

    setTimeout(() => {
      const canvas = document.getElementById(canvasId);
      if (!canvas || !window.Chart) return;
      new window.Chart(canvas, {
        type: 'bar',
        data: {
          labels: brands.map(b => b.brand.length > 18 ? b.brand.substring(0, 18) + '…' : b.brand),
          datasets: [{
            label: 'Best BSR',
            data: brands.map(b => b.bestBsr),
            backgroundColor: brands.map((_, i) => i < 3 ? 'rgba(132,204,22,0.75)' : 'rgba(59,130,246,0.45)'),
            borderColor: brands.map((_, i) => i < 3 ? '#84CC16' : '#3B82F6'),
            borderWidth: 1,
            borderRadius: 4
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => ` BSR #${ctx.raw.toLocaleString()}` } }
          },
          scales: {
            x: {
              title: { display: true, text: 'Best BSR Rank', color: '#475569' },
              grid: { color: 'rgba(0,0,0,0.05)' },
              ticks: { color: '#475569' }
            },
            y: { grid: { display: false }, ticks: { color: '#475569', font: { size: 11 } } }
          }
        }
      });
    }, 50);

    return `
    <div class="ma-section">
      <div class="ma-section-header">
        <span class="ma-section-icon">📊</span>
        <h2 class="ma-section-title">Top Brands by BSR</h2>
        <span class="ma-section-sub">Best BSR rank per brand (top 15)</span>
      </div>
      <div class="ma-chart-canvas-wrap">
        <canvas id="${canvasId}" height="340"></canvas>
      </div>
    </div>`;
  }

  // ── Section 4: Formula Intelligence ─────────────────────────
  function renderMAFormulaIntel(ocr, products) {
    const ingredientFreq = {};
    const certFreq = {};
    const claimFreq = {};

    ocr.forEach(r => {
      (r.supplement_facts || []).forEach(f => {
        if (f.name) {
          const name = f.name.toLowerCase().trim();
          ingredientFreq[name] = (ingredientFreq[name] || 0) + 1;
        }
      });
      (r.certifications || []).forEach(c => {
        certFreq[c] = (certFreq[c] || 0) + 1;
      });
      (r.health_claims || []).forEach(cl => {
        if (cl && cl.length < 60) claimFreq[cl] = (claimFreq[cl] || 0) + 1;
      });
    });

    const topIngredients = Object.entries(ingredientFreq).sort((a,b) => b[1]-a[1]).slice(0, 15);
    const topCerts = Object.entries(certFreq).sort((a,b) => b[1]-a[1]).slice(0, 10);
    const topClaims = Object.entries(claimFreq).sort((a,b) => b[1]-a[1]).slice(0, 10);
    const maxIngCount = topIngredients[0]?.[1] || 1;

    return `
    <div class="ma-section">
      <div class="ma-section-header">
        <span class="ma-section-icon">🧪</span>
        <h2 class="ma-section-title">Formula Intelligence</h2>
        <span class="ma-section-sub">Most common ingredients, certifications & health claims across ${ocr.length} OCR records</span>
      </div>
      <div class="ma-formula-grid">
        <div class="ma-formula-col">
          <div class="ma-formula-title">Top Ingredients</div>
          ${topIngredients.length ? topIngredients.map(([name, count]) => `
            <div class="ma-ingredient-row">
              <span class="ma-ingredient-name">${escapeHtml(name)}</span>
              <div class="ma-ingredient-bar-wrap">
                <div class="ma-ingredient-bar" style="width:${Math.round((count/maxIngCount)*100)}%"></div>
              </div>
              <span class="ma-ingredient-count">${count}</span>
            </div>
          `).join('') : '<div class="ma-empty-small">No ingredient data yet</div>'}
        </div>
        <div class="ma-formula-col">
          <div class="ma-formula-title">Certifications</div>
          <div class="ma-cert-chips">
            ${topCerts.length ? topCerts.map(([cert, count]) => `
              <div class="ma-cert-chip"><span>${escapeHtml(cert)}</span><span class="ma-cert-count">${count}</span></div>
            `).join('') : '<div class="ma-empty-small">No cert data yet</div>'}
          </div>
          <div class="ma-formula-title" style="margin-top:20px;">Top Health Claims</div>
          <div class="ma-claims-list">
            ${topClaims.length ? topClaims.map(([claim, count]) => `
              <div class="ma-claim-row"><span class="ma-claim-text">${escapeHtml(claim)}</span><span class="ma-claim-count">${count}×</span></div>
            `).join('') : '<div class="ma-empty-small">No claims data yet</div>'}
          </div>
        </div>
      </div>
    </div>`;
  }

  // ── Section 5: Review Sentiment ──────────────────────────────
  function renderMAReviewSentiment(products, reviews) {
    const brandRatings = {};
    products.filter(p => p.brand && p.rating).forEach(p => {
      if (!brandRatings[p.brand]) brandRatings[p.brand] = { ratings: [], reviewCounts: [] };
      brandRatings[p.brand].ratings.push(p.rating);
      if (p.review_count) brandRatings[p.brand].reviewCounts.push(p.review_count);
    });

    const brandSentiment = Object.entries(brandRatings).map(([brand, d]) => ({
      brand,
      avgRating: d.ratings.reduce((a,b) => a+b, 0) / d.ratings.length,
      totalReviews: d.reviewCounts.reduce((a,b) => a+b, 0)
    })).sort((a,b) => b.totalReviews - a.totalReviews).slice(0, 15);

    const dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    reviews.forEach(r => { if (r.rating && dist[Math.floor(r.rating)] !== undefined) dist[Math.floor(r.rating)]++; });
    const totalRev = reviews.length || 1;

    return `
    <div class="ma-section">
      <div class="ma-section-header">
        <span class="ma-section-icon">💬</span>
        <h2 class="ma-section-title">Review Sentiment</h2>
        <span class="ma-section-sub">${reviews.length.toLocaleString()} reviews analyzed</span>
      </div>
      <div class="ma-sentiment-grid">
        <div class="ma-sentiment-dist">
          <div class="ma-formula-title">Rating Distribution</div>
          ${[5,4,3,2,1].map(star => `
            <div class="ma-rating-row">
              <span class="ma-star-label">${star}★</span>
              <div class="ma-rating-bar-wrap">
                <div class="ma-rating-bar ma-rating-${star}" style="width:${Math.round((dist[star]/totalRev)*100)}%"></div>
              </div>
              <span class="ma-rating-pct">${Math.round((dist[star]/totalRev)*100)}%</span>
            </div>
          `).join('')}
        </div>
        <div class="ma-brand-sentiment">
          <div class="ma-formula-title">Brand Sentiment (by review volume)</div>
          ${brandSentiment.map(b => {
            const pct = Math.round(((b.avgRating - 1) / 4) * 100);
            const color = b.avgRating >= 4.5 ? '#4ade80' : b.avgRating >= 4 ? '#a3e635' : b.avgRating >= 3.5 ? '#fbbf24' : '#f87171';
            return `
            <div class="ma-brand-sent-row">
              <span class="ma-brand-sent-name">${escapeHtml(b.brand.substring(0,20))}</span>
              <div class="ma-brand-sent-bar-wrap">
                <div class="ma-brand-sent-bar" style="width:${pct}%;background:${color};"></div>
              </div>
              <span class="ma-brand-sent-score" style="color:${color}">★${b.avgRating.toFixed(1)}</span>
              <span class="ma-brand-sent-reviews">${b.totalReviews.toLocaleString()}</span>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>`;
  }

  // ── Section 6: Opportunity Gap Matrix ───────────────────────
  function renderMAOpportunityGap(products, ocr, p5) {
    const allCerts = ['Vegan', 'Non-GMO', 'Organic', 'Gluten-Free', 'GMP', 'NSF', 'Sugar-Free', 'Keto', 'Third-Party Tested', 'B Corp'];
    const certPresence = {};
    allCerts.forEach(c => { certPresence[c] = 0; });

    ocr.forEach(r => {
      (r.certifications || []).forEach(c => {
        const match = allCerts.find(ac => ac.toLowerCase() === c.toLowerCase() || c.toLowerCase().includes(ac.toLowerCase()));
        if (match) certPresence[match]++;
      });
    });
    p5.forEach(r => {
      (r.certifications || []).forEach(c => {
        const match = allCerts.find(ac => ac.toLowerCase() === c.toLowerCase() || c.toLowerCase().includes(ac.toLowerCase()));
        if (match) certPresence[match] += 2;
      });
    });

    const totalProducts = products.length || 1;
    const gaps = allCerts.map(c => ({
      cert: c,
      count: certPresence[c],
      pct: Math.round((certPresence[c] / totalProducts) * 100)
    })).sort((a,b) => a.pct - b.pct);

    return `
    <div class="ma-section">
      <div class="ma-section-header">
        <span class="ma-section-icon">🎪</span>
        <h2 class="ma-section-title">Opportunity Gap Matrix</h2>
        <span class="ma-section-sub">Low % = fewer competitors have it = bigger opportunity for Dovive</span>
      </div>
      <div class="ma-gap-grid">
        ${gaps.map(g => {
          const isGap = g.pct < 20;
          const isSaturated = g.pct > 60;
          return `
          <div class="ma-gap-card ${isGap ? 'ma-gap-opportunity' : isSaturated ? 'ma-gap-saturated' : ''}">
            <div class="ma-gap-cert">${escapeHtml(g.cert)}</div>
            <div class="ma-gap-pct" style="color:${isGap ? '#4ade80' : isSaturated ? '#f87171' : '#fbbf24'}">${g.pct}%</div>
            <div class="ma-gap-label">${isGap ? '🟢 Gap' : isSaturated ? '🔴 Saturated' : '🟡 Moderate'}</div>
          </div>`;
        }).join('')}
      </div>
      <div class="ma-gap-legend">
        🟢 Gap = few competitors have it — <strong>Dovive can differentiate here</strong> &nbsp;|&nbsp;
        🔴 Saturated = everyone has it — table stakes
      </div>
    </div>`;
  }

  // ── Section 7: Competitive Comparison Table (P5) ────────────
  function renderMACompetitiveTable(p5) {
    if (!p5.length) return `
    <div class="ma-section">
      <div class="ma-section-header"><span class="ma-section-icon">🔬</span><h2 class="ma-section-title">Competitive Comparison</h2></div>
      <div class="ma-empty">No Phase 5 research yet for this keyword. Run Phase 5 first.</div>
    </div>`;

    const sorted = [...p5].sort((a,b) => (a.bsr_rank||9999) - (b.bsr_rank||9999));
    const sentimentIcon = { positive: '🟢', mixed: '🟡', negative: '🔴', none: '⚪' };

    return `
    <div class="ma-section">
      <div class="ma-section-header">
        <span class="ma-section-icon">🔬</span>
        <h2 class="ma-section-title">Competitive Deep-Dive</h2>
        <span class="ma-section-sub">Phase 5 research on top ${sorted.length} BSR products</span>
      </div>
      <div class="ma-table-wrap">
        <table class="ma-table ma-comp-table">
          <thead>
            <tr>
              <th>Brand</th>
              <th>BSR</th>
              <th>Reddit</th>
              <th>Key Strength</th>
              <th>Key Weakness</th>
              <th>Dovive Angle</th>
            </tr>
          </thead>
          <tbody>
            ${sorted.map(p => `
              <tr>
                <td class="ma-brand-name">${escapeHtml(p.brand || '-')}</td>
                <td>#${(p.bsr_rank||'').toLocaleString()}</td>
                <td>${sentimentIcon[p.reddit_sentiment] || '⚪'} ${escapeHtml(p.reddit_sentiment || 'none')}</td>
                <td class="ma-comp-cell">${escapeHtml(truncate(p.key_strengths||'-', 80))}</td>
                <td class="ma-comp-cell ma-weakness">${escapeHtml(truncate(p.key_weaknesses||'-', 80))}</td>
                <td class="ma-comp-cell ma-angle">${escapeHtml(truncate(p.competitor_angle||'-', 80))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  // ── Section 8: Launch Readiness Score ───────────────────────
  function renderMALaunchScore(products, keepa, reviews, ocr, p5, keyword) {
    // Score components (each out of 20, total 100)
    const marketSize = Math.min(20, Math.round((products.length / 200) * 20));
    const keepaCoverage = Math.min(20, Math.round((keepa.length / (products.length || 1)) * 20));
    const reviewVolume = Math.min(20, Math.round((reviews.length / 500) * 20));
    const formulaData = Math.min(20, Math.round((ocr.filter(r => r.supplement_facts).length / (products.length || 1)) * 20));
    const p5Research = Math.min(20, Math.round((p5.length / 10) * 20));

    const total = marketSize + keepaCoverage + reviewVolume + formulaData + p5Research;
    const grade = total >= 80 ? 'A' : total >= 60 ? 'B' : total >= 40 ? 'C' : 'D';
    const gradeColor = total >= 80 ? '#4ade80' : total >= 60 ? '#a3e635' : total >= 40 ? '#fbbf24' : '#f87171';
    const recommendation = total >= 80 ? 'Ready to Launch' : total >= 60 ? 'Nearly Ready — fill data gaps' : total >= 40 ? 'More research needed' : 'Early stage — run more phases';

    const components = [
      { label: 'Market Size', desc: `${products.length} products tracked`, score: marketSize, max: 20 },
      { label: 'Keepa Enrichment', desc: `${keepa.length}/${products.length} enriched`, score: keepaCoverage, max: 20 },
      { label: 'Review Coverage', desc: `${reviews.length} reviews analyzed`, score: reviewVolume, max: 20 },
      { label: 'Formula Intel', desc: `${ocr.filter(r => r.supplement_facts).length} formulas parsed`, score: formulaData, max: 20 },
      { label: 'Deep Research', desc: `${p5.length}/10 Phase 5 done`, score: p5Research, max: 20 },
    ];

    return `
    <div class="ma-section">
      <div class="ma-section-header">
        <span class="ma-section-icon">🚀</span>
        <h2 class="ma-section-title">Launch Readiness Score</h2>
        <span class="ma-section-sub">${escapeHtml(keyword)}</span>
      </div>
      <div class="ma-launch-grid">
        <div class="ma-launch-score-card">
          <div class="ma-launch-grade" style="color:${gradeColor}">${grade}</div>
          <div class="ma-launch-total" style="color:${gradeColor}">${total}/100</div>
          <div class="ma-launch-rec">${recommendation}</div>
        </div>
        <div class="ma-launch-components">
          ${components.map(c => `
            <div class="ma-launch-row">
              <span class="ma-launch-label">${c.label}</span>
              <div class="ma-launch-bar-wrap">
                <div class="ma-launch-bar" style="width:${Math.round((c.score/c.max)*100)}%;background:${c.score >= 16 ? '#4ade80' : c.score >= 10 ? '#fbbf24' : '#f87171'}"></div>
              </div>
              <span class="ma-launch-score">${c.score}/${c.max}</span>
              <span class="ma-launch-desc">${c.desc}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>`;
  }

  // ============================================================
  // V2.9: OVERVIEW SUMMARY BAR
  // ============================================================

  // Render Overview page summary stats bar
  async function renderOverviewSummary() {
    const container = document.getElementById('overview-summary-bar');
    if (!container) return;

    // Show loading state
    container.innerHTML = '<div class="scout-summary-bar"><span>Loading stats...</span></div>';

    // Fetch stats
    let productCount = 0, reviewCount = 0, lastScraped = null;
    try {
      const [productsRes, reviewsRes, lastScrapedRes] = await Promise.all([
        sbFetchSimple('dovive_research?select=count'),
        sbFetchSimple('dovive_reviews?select=count'),
        sbFetchSimple('dovive_research?select=scraped_at&order=scraped_at.desc&limit=1')
      ]);
      productCount = productsRes.length > 0 ? (productsRes[0].count || productsRes.length) : products.length;
      reviewCount = reviewsRes.length > 0 ? (reviewsRes[0].count || reviewsRes.length) : 0;
      if (lastScrapedRes.length > 0 && lastScrapedRes[0].scraped_at) {
        lastScraped = new Date(lastScrapedRes[0].scraped_at);
      }
    } catch (err) {
      console.error('Failed to fetch overview stats:', err);
      productCount = products.length;
    }

    const lastRunText = lastScraped ? formatTimeAgo(lastScraped) : 'Never';

    container.innerHTML = `
      <div class="scout-summary-bar">
        <div class="scout-summary-item">
          <span>Products tracked:</span>
          <strong>${productCount.toLocaleString()}</strong>
        </div>
        <div class="scout-summary-divider"></div>
        <div class="scout-summary-item">
          <span>Reviews collected:</span>
          <strong>${reviewCount.toLocaleString()}</strong>
        </div>
        <div class="scout-summary-divider"></div>
        <div class="scout-summary-item">
          <span>Last run:</span>
          <strong>${lastRunText}</strong>
        </div>
        <div class="scout-summary-divider"></div>
        <div class="scout-summary-item">
          <span>Next run:</span>
          <strong>Daily 6AM</strong>
        </div>
      </div>
    `;
  }

  // ============================================================
  // V2.7: KEYWORDS PAGE
  // ============================================================

  // Show Keywords landing page
  function showKeywordsPage() {
    currentView = 'keywords';
    selectedKeyword = null;

    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === 'keywords');
    });

    // Update header
    document.getElementById('page-title').textContent = 'Keywords';
    document.getElementById('page-subtitle').textContent = 'Track and analyze your target keywords';

    // Show keywords view, hide others
    document.querySelectorAll('.view-container').forEach(v => {
      v.style.display = 'none';
    });
    document.getElementById('view-keywords').style.display = 'block';

    renderKeywordsPage();
  }

  // Render Keywords page with keyword cards
  async function renderKeywordsPage() {
    const container = document.getElementById('keywords-page-container');
    if (!container) return;

    // Show loading
    container.innerHTML = '<div class="modal-loading">Loading keywords...</div>';

    try {
      // Ensure products array exists
      const safeProducts = products || [];

      // Fetch keywords with stats
      const keywordsWithStats = await Promise.all(
        (keywords || []).map(async (kw) => {
          try {
            // Get products for this keyword
            const kwProducts = safeProducts.filter(p => p && p.keyword === kw.keyword);
            const productCount = kwProducts.length;

            // Calculate stats (null-safe)
            const bsrs = kwProducts.filter(p => p && p.bsr).map(p => p.bsr);
            const avgBsr = bsrs.length > 0 ? Math.round(bsrs.reduce((a, b) => a + b, 0) / bsrs.length) : null;

            const prices = kwProducts.filter(p => p && p.price).map(p => p.price);
            const priceMin = prices.length > 0 ? Math.min(...prices) : null;
            const priceMax = prices.length > 0 ? Math.max(...prices) : null;

            const ratings = kwProducts.filter(p => p && p.rating).map(p => p.rating);
            const avgRating = ratings.length > 0 ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : null;

            // Get last scraped time
            const scrapedDates = kwProducts.filter(p => p && p.scraped_at).map(p => new Date(p.scraped_at));
            const lastScraped = scrapedDates.length > 0 ? new Date(Math.max(...scrapedDates)) : null;

            // Check for AI report
            const report = (reports || []).find(r => r && r.keyword === kw.keyword);

            return {
              ...kw,
              productCount,
              avgBsr,
              priceMin,
              priceMax,
              avgRating,
              lastScraped,
              hasReport: !!report
            };
          } catch (kwErr) {
            console.error('Error processing keyword:', kw.keyword, kwErr);
            return { ...kw, productCount: 0, avgBsr: null, priceMin: null, priceMax: null, avgRating: null, lastScraped: null, hasReport: false };
          }
        })
      );

    // Render cards
    if (keywordsWithStats.length === 0) {
      container.innerHTML = `
        <div class="keywords-empty">
          <div class="keywords-empty-icon">🔍</div>
          <div class="keywords-empty-title">No keywords tracked yet</div>
          <div class="keywords-empty-text">Add keywords in the Overview page to start tracking.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="keyword-grid">
        ${keywordsWithStats.map(kw => renderKeywordCard(kw)).join('')}
      </div>
    `;

    // Setup click handlers
    container.querySelectorAll('.keyword-card').forEach(card => {
      card.addEventListener('click', () => {
        const keyword = card.dataset.keyword;
        showKeywordDetail(keyword);
      });
    });
    } catch (err) {
      console.error('Error rendering keywords page:', err);
      container.innerHTML = `
        <div class="keywords-empty">
          <div class="keywords-empty-icon">⚠️</div>
          <div class="keywords-empty-title">Error loading keywords</div>
          <div class="keywords-empty-text">Please refresh the page or check console for details.</div>
        </div>
      `;
    }
  }

  // Render a single keyword card
  function renderKeywordCard(kw) {
    const productType = kw.product_type || detectProductType(kw.keyword);
    const typeClass = productType.toLowerCase().replace(/[^a-z]/g, '');

    const lastScrapedText = kw.lastScraped
      ? `Last scraped: ${kw.lastScraped.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${formatTimeAgo(kw.lastScraped)}`
      : 'Not yet scraped';

    return `
      <div class="keyword-card" data-keyword="${escapeHtml(kw.keyword)}">
        <div class="kw-header">
          <div class="kw-name">${escapeHtml(kw.keyword)}</div>
          <span class="kw-type-badge ${typeClass}">${productType.toUpperCase()}</span>
        </div>

        <div class="kw-stats">
          <div class="kw-stat">Products tracked: <span>${kw.productCount}</span></div>
          <div class="kw-stat">Avg BSR: <span>${kw.avgBsr ? '#' + kw.avgBsr.toLocaleString() : '-'}</span></div>
          <div class="kw-stat">Price range: <span>${kw.priceMin ? '$' + kw.priceMin.toFixed(2) + ' – $' + kw.priceMax.toFixed(2) : '-'}</span></div>
          <div class="kw-stat">Avg rating: <span>${kw.avgRating ? '★ ' + kw.avgRating : '-'}</span></div>
        </div>

        <div class="kw-last-scraped">${lastScrapedText}</div>

        <!-- V3.2: Phase Coverage Bar -->
        ${(() => {
          const cov = phaseCoverage[kw.keyword];
          if (!cov || !cov.total) return '';
          const phases = [
            { label: 'P1', key: 'p1', color: '#6366f1', title: 'Scrape' },
            { label: 'P2', key: 'p2', color: '#8b5cf6', title: 'Keepa' },
            { label: 'P3', key: 'p3', color: '#ec4899', title: 'Reviews' },
            { label: 'P4', key: 'p4', color: '#f59e0b', title: 'OCR' },
            { label: 'P5', key: 'p5', color: '#a78bfa', title: 'Research' }
          ];
          const bars = phases.map(p => {
            const count = cov[p.key] || 0;
            const pct = Math.round((count / cov.total) * 100);
            const done = pct >= 100;
            return `<div class="phase-bar-item" title="${p.title}: ${count}/${cov.total} (${pct}%)">
              <div class="phase-bar-label" style="color:${p.color}">${p.label}</div>
              <div class="phase-bar-track">
                <div class="phase-bar-fill" style="width:${Math.min(pct,100)}%;background:${p.color};opacity:${done?1:0.6}"></div>
              </div>
              <div class="phase-bar-pct" style="color:${done?p.color:'#666'}">${pct}%</div>
            </div>`;
          }).join('');
          return `<div class="phase-coverage">${bars}</div>`;
        })()}

        <div class="kw-report-chip ${kw.hasReport ? 'ready' : 'pending'}">
          ${kw.hasReport ? '✓ AI Report ready' : 'No report yet'}
        </div>

        <button class="kw-view-btn">View Products →</button>
      </div>
    `;
  }

  // Detect product type from keyword
  function detectProductType(keyword) {
    const kw = keyword.toLowerCase();
    if (kw.includes('gummies') || kw.includes('gummy')) return 'Gummies';
    if (kw.includes('powder')) return 'Powder';
    if (kw.includes('capsule')) return 'Capsule';
    if (kw.includes('liquid') || kw.includes('drops') || kw.includes('tincture')) return 'Liquid';
    return 'Other';
  }

  // ============================================================
  // V2.7: KEYWORD DETAIL VIEW
  // ============================================================

  // Show Keyword detail view
  function showKeywordDetail(keyword) {
    currentView = 'keyword-detail';
    selectedKeyword = keyword;

    // Update header
    document.getElementById('page-title').textContent = keyword;
    document.getElementById('page-subtitle').textContent = 'Keyword research details and products';

    // Hide all views, show detail view
    document.querySelectorAll('.view-container').forEach(v => {
      v.style.display = 'none';
    });
    document.getElementById('view-keyword-detail').style.display = 'block';

    renderKeywordDetail(keyword);
  }

  // Render Keyword detail view
  async function renderKeywordDetail(keyword) {
    const container = document.getElementById('keyword-detail-container');
    if (!container) return;

    // Show loading
    container.innerHTML = '<div class="modal-loading">Loading keyword data...</div>';

    try {
      // Ensure products array exists (null-safe)
      const safeProducts = products || [];

      // Get keyword info
      const kwInfo = (keywords || []).find(k => k && k.keyword === keyword);
      const productType = kwInfo?.product_type || detectProductType(keyword);

      // Get products for this keyword (null-safe filter)
      let kwProducts = safeProducts.filter(p => p && p.keyword === keyword);

      // Get last scraped time
      const scrapedDates = kwProducts.filter(p => p && p.scraped_at).map(p => new Date(p.scraped_at));
      const lastScraped = scrapedDates.length > 0 ? new Date(Math.max(...scrapedDates)) : null;

      // Get AI report
      const report = (reports || []).find(r => r && r.keyword === keyword);

    // Sort products
    kwProducts = sortProducts(kwProducts, keywordDetailSort);

    // Deduplicate by ASIN
    const seenAsins = new Set();
    kwProducts = kwProducts.filter(p => {
      if (seenAsins.has(p.asin)) return false;
      seenAsins.add(p.asin);
      return true;
    });

    // Build HTML
    const lastScrapedText = lastScraped
      ? lastScraped.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + formatTimeAgo(lastScraped)
      : 'Not yet scraped';

    container.innerHTML = `
      <button class="back-btn" id="back-to-keywords">← Keywords</button>

      <div class="kw-detail-header">
        <div>
          <div class="kw-detail-title">${escapeHtml(keyword)}</div>
          <div class="kw-detail-meta">
            <span class="kw-type-badge ${productType.toLowerCase()}">${productType.toUpperCase()}</span>
            <span style="font-size: 12px; color: #6B7280;">${lastScrapedText}</span>
          </div>
        </div>
      </div>

      ${renderAIReportSection(report)}

      <!-- Phase 6: Market Analysis Tabs -->
      <div class="kw-detail-tabs">
        <button class="kw-tab active" data-tab="products">📦 Products</button>
        <button class="kw-tab" data-tab="market">📈 Market Analysis</button>
      </div>

      <!-- Products Tab -->
      <div class="kw-tab-content" id="kw-tab-products">

      <div class="products-section-header">
        <div>
          <span class="products-section-title">Products</span>
          <span class="products-section-count">${kwProducts.length} products tracked</span>
        </div>
        <div class="sort-tabs">
          <button class="sort-tab ${keywordDetailSort === 'bsr' ? 'active' : ''}" data-sort="bsr">BSR</button>
          <button class="sort-tab ${keywordDetailSort === 'price' ? 'active' : ''}" data-sort="price">Price</button>
          <button class="sort-tab ${keywordDetailSort === 'rating' ? 'active' : ''}" data-sort="rating">Rating</button>
          <button class="sort-tab ${keywordDetailSort === 'reviews' ? 'active' : ''}" data-sort="reviews">Reviews</button>
        </div>
      </div>

      ${kwProducts.length > 0 ? `
        <div class="products-grid">
          ${kwProducts.slice(0, 50).map(p => renderProductCard(p)).join('')}
        </div>
      ` : `
        <div class="products-empty-state">
          <div class="products-empty-icon">📦</div>
          <div class="products-empty-title">No products yet</div>
          <div class="products-empty-text">Run Scout to collect products for this keyword.</div>
        </div>
      `}

      </div> <!-- end kw-tab-products -->

      <!-- Market Analysis Tab -->
      <div class="kw-tab-content" id="kw-tab-market" style="display:none;">
        <div id="kw-market-analysis-container">
          <div class="ma-loading">⏳ Click Market Analysis tab to load...</div>
        </div>
      </div>
    `;

    // Setup back button
    document.getElementById('back-to-keywords').addEventListener('click', () => {
      showKeywordsPage();
    });

    // Setup sort tabs
    container.querySelectorAll('.sort-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        keywordDetailSort = tab.dataset.sort;
        renderKeywordDetail(keyword);
      });
    });

    // Setup keyword detail tabs
    container.querySelectorAll('.kw-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        container.querySelectorAll('.kw-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const tabName = tab.dataset.tab;
        document.getElementById('kw-tab-products').style.display = tabName === 'products' ? 'block' : 'none';
        document.getElementById('kw-tab-market').style.display = tabName === 'market' ? 'block' : 'none';
        if (tabName === 'market') {
          marketAnalysisKeyword = keyword;
          renderKeywordMarketAnalysis(keyword);
        }
      });
    });

    } catch (err) {
      console.error('Error rendering keyword detail:', err);
      container.innerHTML = `
        <button class="back-btn" id="back-to-keywords-err">← Keywords</button>
        <div class="products-empty-state">
          <div class="products-empty-icon">⚠️</div>
          <div class="products-empty-title">Error loading keyword data</div>
          <div class="products-empty-text">Please refresh the page or check console for details.</div>
        </div>
      `;
      const backBtn = document.getElementById('back-to-keywords-err');
      if (backBtn) backBtn.addEventListener('click', () => showKeywordsPage());
    }
  }

  // Sort products by specified field
  function sortProducts(productsList, sortBy) {
    return [...productsList].sort((a, b) => {
      switch (sortBy) {
        case 'bsr':
          return (a.bsr || Infinity) - (b.bsr || Infinity);
        case 'price':
          return (a.price || Infinity) - (b.price || Infinity);
        case 'rating':
          return (b.rating || 0) - (a.rating || 0);
        case 'reviews':
          return (b.review_count || 0) - (a.review_count || 0);
        default:
          return 0;
      }
    });
  }

  // Render AI Report section
  function renderAIReportSection(report) {
    if (!report || !report.ai_summary) {
      return `
        <div class="ai-report-card empty">
          <div style="font-size: 32px; margin-bottom: 12px;">🤖</div>
          <div style="font-size: 14px; font-weight: 600; margin-bottom: 8px;">No AI report yet for this keyword</div>
          <div style="font-size: 13px;">Run Scout to generate an AI market analysis.</div>
        </div>
      `;
    }

    const summaryParagraphs = report.ai_summary.split('\n\n').map(p => `<p>${escapeHtml(p)}</p>`).join('');
    const generatedDate = report.analyzed_at
      ? new Date(report.analyzed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'Unknown';

    return `
      <div class="ai-report-card">
        <div class="ai-report-label">🤖 AI MARKET REPORT</div>
        <div class="ai-report-summary">${summaryParagraphs}</div>
        ${report.recommendation ? `
          <div class="ai-report-recommendation">
            <strong>Recommendation:</strong> ${escapeHtml(report.recommendation)}
          </div>
        ` : ''}
        <div class="ai-report-footer">Generated: ${generatedDate}</div>
      </div>
    `;
  }

  // ============================================================
  // V2.7: SETTINGS PAGE
  // ============================================================

  async function renderSettingsPage() {
    const container = document.getElementById('settings-page-container');
    if (!container) return;

    // Show loading first
    container.innerHTML = '<div class="modal-loading">Loading settings...</div>';

    // Fetch data stats in parallel
    let productCount = 0, reviewCount = 0, keywordCount = 0, reportCount = 0, lastScraped = null;
    try {
      const [productsRes, reviewsRes, keywordsRes, reportsRes, lastScrapedRes] = await Promise.all([
        sbFetchSimple('dovive_research?select=count'),
        sbFetchSimple('dovive_reviews?select=count'),
        sbFetchSimple('dovive_keywords?active=eq.true&select=count'),
        sbFetchSimple('dovive_reports?select=count'),
        sbFetchSimple('dovive_research?select=scraped_at&order=scraped_at.desc&limit=1')
      ]);
      productCount = productsRes.length > 0 ? (productsRes[0].count || productsRes.length) : products.length;
      reviewCount = reviewsRes.length > 0 ? (reviewsRes[0].count || reviewsRes.length) : 0;
      keywordCount = keywordsRes.length > 0 ? (keywordsRes[0].count || keywordsRes.length) : keywords.length;
      reportCount = reportsRes.length > 0 ? (reportsRes[0].count || reportsRes.length) : reports.length;
      if (lastScrapedRes.length > 0 && lastScrapedRes[0].scraped_at) {
        lastScraped = new Date(lastScrapedRes[0].scraped_at);
      }
    } catch (err) {
      console.error('Failed to fetch data stats:', err);
      // Use local data as fallback
      productCount = products.length;
      keywordCount = keywords.length;
      reportCount = reports.length;
    }

    const lastScrapedText = lastScraped ? formatTimeAgo(lastScraped) : 'Never';

    // Mode badge
    const modeLabel = {
      'best_sellers_first': 'Best Sellers First',
      'best_sellers_only': 'Best Sellers Only',
      'keyword_only': 'Keyword Search Only'
    }[scoutSettings.scrape_mode] || scoutSettings.scrape_mode;

    // Active types chips
    const activeTypes = scoutSettings.product_types_active || [];
    const typesHtml = activeTypes.length > 0
      ? activeTypes.map(t => `<span class="chip">${t}</span>`).join(' ')
      : '<span class="muted">All types</span>';

    // Best Sellers categories
    const bsCategories = scoutSettings.best_sellers_categories || [];
    const categoriesHtml = bsCategories.length > 0
      ? bsCategories.map(c => `<div class="category-item">• ${c.name || c}</div>`).join('')
      : '<span class="muted">None configured</span>';

    // Changelog
    const changelogHtml = scoutChangelog.length > 0
      ? scoutChangelog.map(c => `
          <div class="changelog-entry">
            <div class="changelog-version">${c.version || 'v?'}</div>
            <div class="changelog-desc">${c.description || ''}</div>
            <div class="changelog-date">${c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</div>
          </div>
        `).join('')
      : '<div class="muted">No changelog entries</div>';

    container.innerHTML = `
      <!-- DATA STATS Section -->
      <div class="data-stats-section">
        <div class="data-stats-title">DATA STATS</div>
        <div class="data-stats-grid">
          <div class="data-stat-item">
            <div class="data-stat-value">${productCount.toLocaleString()}</div>
            <div class="data-stat-label">Products tracked</div>
          </div>
          <div class="data-stat-item">
            <div class="data-stat-value">${reviewCount.toLocaleString()}</div>
            <div class="data-stat-label">Reviews collected</div>
          </div>
          <div class="data-stat-item">
            <div class="data-stat-value">${keywordCount}</div>
            <div class="data-stat-label">Keywords active</div>
          </div>
          <div class="data-stat-item">
            <div class="data-stat-value">${lastScrapedText}</div>
            <div class="data-stat-label">Last scrape</div>
          </div>
          <div class="data-stat-item">
            <div class="data-stat-value">${reportCount}</div>
            <div class="data-stat-label">AI reports</div>
          </div>
          <div class="data-stat-item">
            <div class="data-stat-value">Daily 6AM</div>
            <div class="data-stat-label">Next run</div>
          </div>
        </div>
      </div>

      <div class="card" style="max-width: 600px;">
        <div class="card-header">
          <span class="label">SCOUT CONFIGURATION</span>
        </div>

        <div class="settings-row">
          <span class="settings-label">Scrape Mode</span>
          <span class="settings-value badge">${modeLabel}</span>
        </div>
        <div class="settings-row">
          <span class="settings-label">Active Types</span>
          <div class="settings-chips">${typesHtml}</div>
        </div>
        <div class="settings-row">
          <span class="settings-label">Best Sellers Categories</span>
          <div class="categories-list">${categoriesHtml}</div>
        </div>
        <div class="settings-row">
          <span class="settings-label">Products/Type</span>
          <span class="settings-value">${scoutSettings.max_products_per_type || 50}</span>
        </div>
        <div class="settings-row">
          <span class="settings-label">Deep Scrape Top N</span>
          <span class="settings-value">${scoutSettings.deep_scrape_top_n || 30}</span>
        </div>
        <div class="settings-row">
          <span class="settings-label">Max Reviews/Product</span>
          <span class="settings-value">${scoutSettings.max_reviews_per_product || 200}</span>
        </div>

        <div class="changelog-section">
          <div class="changelog-title">Recent Changes</div>
          ${changelogHtml}
        </div>
      </div>
    `;
  }

  // ============================================================
  // FORMULA PAGE (P11 + P12 — DASH Supabase)
  // ============================================================

  let formulaPageKeyword = null;

  async function renderFormulaPage() {
    const container = document.getElementById('formula-page-container');
    if (!container) return;
    container.innerHTML = '<div class="ma-loading">⏳ Loading formula data...</div>';

    try {
      // Load categories from DASH
      const categories = await dashFetch('categories', { select: 'id,keyword', order: 'keyword.asc', limit: 100 });
      if (!categories || categories.length === 0) {
        container.innerHTML = `<div class="ai-report-card empty">
          <div style="font-size:32px;margin-bottom:12px;">🧪</div>
          <div style="font-size:14px;font-weight:600;margin-bottom:8px;">No categories found in DASH</div>
          <div style="font-size:13px;">Run the pipeline first to generate formula data.</div>
        </div>`;
        return;
      }

      // Select current keyword (default to first)
      if (!formulaPageKeyword || !categories.find(c => c.keyword === formulaPageKeyword)) {
        formulaPageKeyword = categories[0].keyword;
      }

      await renderFormulaForKeyword(container, categories, formulaPageKeyword);

    } catch (err) {
      container.innerHTML = `<div class="ai-report-card empty">
        <div style="font-size:32px;margin-bottom:12px;">⚠️</div>
        <div style="font-size:14px;font-weight:600;margin-bottom:8px;">Error loading formula</div>
        <div style="font-size:13px;">${escapeHtml(err.message)}</div>
      </div>`;
    }
  }

  async function renderFormulaForKeyword(container, categories, keyword) {
    const cat = categories.find(c => c.keyword === keyword);
    if (!cat) return;

    container.innerHTML = '<div class="ma-loading">⏳ Loading formula...</div>';

    // Fetch formula_briefs for this category
    const briefs = await dashFetch('formula_briefs', {
      select: 'id,ingredients,created_at,updated_at',
      filter: `category_id=eq.${cat.id}`,
      single: false,
      limit: 1
    });
    const brief = briefs?.[0];
    const ing = brief?.ingredients || {};

    // ── Keyword selector ──────────────────────────────────────
    const kwOptions = categories.map(c =>
      `<option value="${escapeHtml(c.keyword)}" ${c.keyword === keyword ? 'selected' : ''}>${escapeHtml(c.keyword)}</option>`
    ).join('');

    // ── Formula data ──────────────────────────────────────────
    const adjustedFormula = ing.adjusted_formula || null;
    const finalBrief      = ing.final_formula_brief || null;
    const qa              = ing.qa_report || null;
    const benchmarking    = ing.competitive_benchmarking || null;
    const fda             = ing.fda_compliance || null;

    const hasFormula = adjustedFormula || finalBrief;

    // ── P11 summary ───────────────────────────────────────────
    const p11Score  = benchmarking?.formula_score ?? null;
    const p11Result = benchmarking?.validation_result || null;
    const p11Date   = benchmarking?.generated_at ? new Date(benchmarking.generated_at).toLocaleDateString() : null;

    // ── P12 summary ───────────────────────────────────────────
    const p12Score  = fda?.compliance_score ?? null;
    const p12Status = fda?.compliance_status || null;
    const p12Date   = fda?.generated_at ? new Date(fda.generated_at).toLocaleDateString() : null;

    // ── Score badge colors ────────────────────────────────────
    const p11Color = p11Score >= 8 ? '#16a34a' : p11Score >= 6 ? '#d97706' : '#dc2626';
    const p12Color = p12Score >= 80 ? '#16a34a' : p12Score >= 60 ? '#d97706' : '#dc2626';

    container.innerHTML = `
      <!-- Keyword selector bar -->
      <div class="ma-keyword-bar" style="margin-bottom:24px;">
        <span class="ma-keyword-label">Formula for:</span>
        <select class="ma-keyword-select" id="formula-keyword-select">
          ${kwOptions}
        </select>
      </div>

      ${!hasFormula ? `
        <div class="ai-report-card empty">
          <div style="font-size:32px;margin-bottom:12px;">🧪</div>
          <div style="font-size:14px;font-weight:600;margin-bottom:8px;">No formula found for "${escapeHtml(keyword)}"</div>
          <div style="font-size:13px;">Run the pipeline through P10 to generate a formula, then run P11 and P12.</div>
        </div>
      ` : `
        <!-- Status bar -->
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px;">
          <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 24px;flex:1;min-width:200px;">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin-bottom:6px;">P11 Competitiveness</div>
            ${p11Score !== null
              ? `<div style="font-size:28px;font-weight:800;color:${p11Color};">${p11Score}/10</div>
                 <div style="font-size:12px;color:#64748b;margin-top:2px;">${escapeHtml(p11Result || '')} · ${p11Date || ''}</div>`
              : `<div style="font-size:13px;color:#94a3b8;">Not run yet</div>`
            }
          </div>
          <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 24px;flex:1;min-width:200px;">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin-bottom:6px;">P12 FDA Compliance</div>
            ${p12Score !== null
              ? `<div style="font-size:28px;font-weight:800;color:${p12Color};">${p12Score}/100</div>
                 <div style="font-size:12px;color:#64748b;margin-top:2px;">${escapeHtml(p12Status || '')} · ${p12Date || ''}</div>`
              : `<div style="font-size:13px;color:#94a3b8;">Not run yet</div>`
            }
          </div>
          <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 24px;display:flex;align-items:center;">
            <button id="formula-download-btn" style="background:#2563eb;color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;">
              ⬇ Download Formula (.md)
            </button>
          </div>
        </div>

        <!-- Final Formula Brief -->
        ${finalBrief ? `
          <div class="card" style="margin-bottom:20px;">
            <div class="card-header"><span class="label">📋 FINAL FORMULA BRIEF</span></div>
            <div style="padding:16px;font-size:13px;line-height:1.7;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;max-height:400px;overflow-y:auto;background:#f8fafc;border-radius:8px;">${escapeHtml(finalBrief)}</div>
          </div>
        ` : ''}

        <!-- Adjusted Formula Table -->
        ${adjustedFormula ? `
          <div class="card" style="margin-bottom:20px;">
            <div class="card-header"><span class="label">🔬 ADJUSTED FORMULA (P10 QA)</span></div>
            <div style="padding:16px;font-size:12px;line-height:1.7;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;max-height:500px;overflow-y:auto;background:#f8fafc;border-radius:8px;">${escapeHtml(adjustedFormula)}</div>
          </div>
        ` : ''}

        <!-- P11 Benchmarking Summary -->
        ${benchmarking?.opus_validation ? `
          <div class="card" style="margin-bottom:20px;">
            <div class="card-header">
              <span class="label">📊 P11 COMPETITIVE BENCHMARKING</span>
              ${p11Score !== null ? `<span class="badge" style="background:${p11Color};color:#fff;">${p11Score}/10 · ${escapeHtml(p11Result || '')}</span>` : ''}
            </div>
            <div style="padding:16px;font-size:12px;line-height:1.7;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;max-height:500px;overflow-y:auto;background:#f8fafc;border-radius:8px;">${escapeHtml(benchmarking.opus_validation)}</div>
          </div>
        ` : ''}

        <!-- P12 FDA Compliance Summary -->
        ${fda?.opus_analysis ? `
          <div class="card" style="margin-bottom:20px;">
            <div class="card-header">
              <span class="label">⚖️ P12 FDA COMPLIANCE</span>
              ${p12Score !== null ? `<span class="badge" style="background:${p12Color};color:#fff;">${p12Score}/100 · ${escapeHtml(p12Status || '')}</span>` : ''}
            </div>
            <div style="padding:16px;font-size:12px;line-height:1.7;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;max-height:500px;overflow-y:auto;background:#f8fafc;border-radius:8px;">${escapeHtml(fda.opus_analysis)}</div>
          </div>
        ` : ''}
      `}
    `;

    // ── Keyword select handler ─────────────────────────────────
    const kwSelect = document.getElementById('formula-keyword-select');
    if (kwSelect) {
      kwSelect.addEventListener('change', async () => {
        formulaPageKeyword = kwSelect.value;
        await renderFormulaForKeyword(container, categories, formulaPageKeyword);
      });
    }

    // ── Download handler ──────────────────────────────────────
    const dlBtn = document.getElementById('formula-download-btn');
    if (dlBtn && hasFormula) {
      dlBtn.addEventListener('click', () => downloadFormula(keyword, ing, p11Score, p11Result, p12Score, p12Status));
    }
  }

  function downloadFormula(keyword, ing, p11Score, p11Result, p12Score, p12Status) {
    const lines = [
      `# DOVIVE Formula — ${keyword}`,
      `Generated: ${new Date().toISOString()}`,
      '',
      `## Scores`,
      `- P11 Competitiveness: ${p11Score !== null ? `${p11Score}/10 (${p11Result})` : 'Not run'}`,
      `- P12 FDA Compliance: ${p12Score !== null ? `${p12Score}/100 (${p12Status})` : 'Not run'}`,
      '',
      '---',
      '',
    ];

    if (ing.final_formula_brief) {
      lines.push('## Final Formula Brief', '', ing.final_formula_brief, '', '---', '');
    }
    if (ing.adjusted_formula) {
      lines.push('## Adjusted Formula (P10 QA)', '', ing.adjusted_formula, '', '---', '');
    }
    if (ing.competitive_benchmarking?.opus_validation) {
      lines.push('## P11 Competitive Benchmarking — Claude Opus Validation', '', ing.competitive_benchmarking.opus_validation, '', '---', '');
    }
    if (ing.competitive_benchmarking?.sonnet_draft) {
      lines.push('## P11 Competitive Benchmarking — Claude Sonnet Draft', '', ing.competitive_benchmarking.sonnet_draft, '', '---', '');
    }
    if (ing.fda_compliance?.opus_analysis) {
      lines.push('## P12 FDA Compliance — Claude Opus Analysis', '', ing.fda_compliance.opus_analysis, '', '---', '');
    }
    if (ing.fda_compliance?.sonnet_validation) {
      lines.push('## P12 FDA Compliance — Claude Sonnet Validation', '', ing.fda_compliance.sonnet_validation);
    }

    const content = lines.join('\n');
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${keyword.replace(/\s+/g, '-').toLowerCase()}-formula.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
