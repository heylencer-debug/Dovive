// Dovive Scout Dashboard V2.8 - Main Application
// Features: Product type filters, reviews panel, specs panel, live progress tracking, Scout Settings panel
// V2.6: Product grid view + full detail modal with tabs
// V2.7: Keywords page with drill-down, AI report, per-keyword product grid
// V2.8: Full product data from dovive_research (images, bullets, reviews, specs, certifications), Product Explorer removed

(function() {
  'use strict';

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
    await loadFormatFocusData();
    await loadScoutSettings();
    await checkScoutStatus();
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

  // Load products from dovive_products
  async function loadProducts() {
    try {
      products = await sbFetch('dovive_products', {
        order: 'scraped_at.desc',
        limit: 1000
      });
      renderResults();
      renderProductsGrid(); // V2.6: Render product cards grid
      renderProductsKeywordTabs(); // V2.6: Update keyword tabs
      await loadFormatFocusData(); // Refresh format focus when products change
    } catch (err) {
      console.error('Failed to load products:', err);
      // Fallback to legacy dovive_research table
      try {
        products = await sbFetch('dovive_research', {
          order: 'scraped_at.desc',
          limit: 500
        });
        renderResults();
        renderProductsGrid();
        renderProductsKeywordTabs();
      } catch (e) {
        console.error('Failed to load legacy research:', e);
      }
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

    // Load reviews, specs, and images in parallel
    const [productReviews, productSpecs, productImages] = await Promise.all([
      loadReviewsForProduct(asin),
      loadSpecsForProduct(asin),
      loadImagesForProduct(asin)
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

    // Render the details panel
    panel.innerHTML = `
      <div class="details-grid">
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

    // Filter products by keyword
    let filteredProducts = currentGridKeyword === 'ALL'
      ? products
      : products.filter(p => p.keyword === currentGridKeyword);

    // Sort by BSR (ascending)
    filteredProducts = [...filteredProducts].sort((a, b) => {
      const aBsr = a.bsr || Infinity;
      const bBsr = b.bsr || Infinity;
      return aBsr - bBsr;
    });

    // Deduplicate by ASIN
    const seenAsins = new Set();
    filteredProducts = filteredProducts.filter(p => {
      if (seenAsins.has(p.asin)) return false;
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
  }

  // Render a single product card
  function renderProductCard(p) {
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
  window.openProductModal = async function(asin) {
    currentModalAsin = asin;
    currentModalTab = 'overview';
    modalReviewsLoaded = 0;

    // Show modal with loading state
    showModal('<div class="modal-loading"><div class="spinner"></div> Loading product data...</div>');

    // V2.8: Fetch from dovive_research first (has full data), fallback to other tables
    const [researchArr, productArr, specsArr, reviewsArr, imagesArr] = await Promise.all([
      sbFetchSimple('dovive_research?asin=eq.' + asin + '&limit=1'),
      sbFetchSimple('dovive_products?asin=eq.' + asin + '&limit=1'),
      sbFetchSimple('dovive_specs?asin=eq.' + asin + '&limit=1'),
      sbFetchSimple('dovive_reviews?asin=eq.' + asin + '&order=scraped_at.desc&limit=50'),
      sbFetchSimple('dovive_product_images?asin=eq.' + asin + '&order=image_index.asc')
    ]);

    // V2.8: Merge research data with product data
    const research = researchArr[0] || {};
    const product = productArr[0] || {};

    modalProductData = {
      product: { ...product, ...research }, // Research data takes precedence
      specs: specsArr[0] || {},
      reviews: reviewsArr || [],
      images: imagesArr || [],
      research: research // Keep full research object for modal tabs
    };

    renderProductModal();
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
    // Review expand
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

    // Load more reviews
    const loadMoreBtn = document.querySelector('.load-more-btn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', async () => {
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
      default:
        return renderOverviewTab(p, s, imgs);
    }
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

  // TAB 3: Reviews
  function renderReviewsTab(p, revs) {
    // V2.8: Merge reviews from dovive_research (p.reviews) with dovive_reviews (revs)
    const researchReviews = p.reviews || [];
    const allReviews = researchReviews.length > 0 ? researchReviews : revs;
    const totalReviews = allReviews.length;
    const avgRating = p.rating || (totalReviews > 0 ? (allReviews.reduce((sum, r) => sum + (r.rating || 0), 0) / totalReviews) : 0);
    const ratingStars = '★'.repeat(Math.floor(avgRating)) + (avgRating % 1 >= 0.5 ? '½' : '');

    // V2.8: Note about data source
    const dataSourceNote = researchReviews.length > 0
      ? '<div class="reviews-note">Showing top 10 reviews from product page</div>'
      : '<div class="reviews-note">Showing reviews from full scrape</div>';

    // Sentiment breakdown (only for full reviews from dovive_reviews)
    const sentimentCounts = {};
    revs.forEach(r => {
      if (r.sentiment_tags && Array.isArray(r.sentiment_tags)) {
        r.sentiment_tags.forEach(tag => {
          sentimentCounts[tag] = (sentimentCounts[tag] || 0) + 1;
        });
      }
    });

    const sentimentItems = Object.entries(sentimentCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([tag, count]) => {
        const isPositive = tag.includes('positive');
        const isNegative = tag.includes('negative') || tag.includes('side-effects');
        const pct = Math.min(100, Math.round((count / Math.max(revs.length, 1)) * 100));
        return `
          <div class="sentiment-item">
            <span class="sentiment-label">${escapeHtml(tag)}</span>
            <div class="sentiment-bar"><div class="sentiment-fill ${isPositive ? 'positive' : isNegative ? 'negative' : ''}" style="width:${pct}%"></div></div>
            <span class="sentiment-count">${count}</span>
          </div>
        `;
      })
      .join('');

    // Reviews list (paginated)
    const displayReviews = allReviews.slice(0, 20 + modalReviewsLoaded);
    const hasMore = allReviews.length > displayReviews.length;

    const reviewsListHtml = displayReviews.map(r => {
      const stars = r.rating ? '★'.repeat(Math.floor(r.rating)) : '';
      const verified = (r.verified_purchase || r.verified) ? '<span class="verified-check">✓ Verified</span>' : '';
      const tags = (r.sentiment_tags || []).map(t => {
        const isPos = t.includes('positive');
        const isNeg = t.includes('negative') || t.includes('side-effects');
        return `<span class="sentiment-tag ${isPos ? 'positive' : isNeg ? 'negative' : ''}">${escapeHtml(t)}</span>`;
      }).join('');

      return `
        <div class="review-item">
          <div class="review-top">
            <span class="review-stars">${stars}</span>
            ${verified}
          </div>
          <div class="review-title">${escapeHtml(r.title || '')}</div>
          <div class="review-body">${escapeHtml(r.body || '')}</div>
          ${r.body && r.body.length > 200 ? '<span class="review-expand">Show more</span>' : ''}
          <div class="review-meta">
            ${escapeHtml(r.reviewer_name || 'Anonymous')} · ${r.review_date || r.date || ''} ${r.helpful_votes ? '· Helpful: ' + r.helpful_votes : ''}
          </div>
          ${tags ? `<div class="review-tags">${tags}</div>` : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="review-summary-bar">
        <span class="review-overall"><span class="stars">${ratingStars}</span> ${avgRating.toFixed(1)} overall</span>
        <span class="review-scraped-count">${totalReviews} reviews</span>
      </div>

      ${dataSourceNote}

      ${sentimentItems ? `<div class="sentiment-breakdown">${sentimentItems}</div>` : ''}

      <div class="reviews-list-modal">
        ${reviewsListHtml || '<p class="no-data">No reviews available</p>'}
      </div>

      ${hasMore ? '<button class="load-more-btn">Load more reviews</button>' : ''}
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
        break;
    }

    currentView = view;
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

    // Fetch keywords with stats
    const keywordsWithStats = await Promise.all(
      keywords.map(async (kw) => {
        // Get products for this keyword
        const kwProducts = products.filter(p => p.keyword === kw.keyword);
        const productCount = kwProducts.length;

        // Calculate stats
        const bsrs = kwProducts.filter(p => p.bsr).map(p => p.bsr);
        const avgBsr = bsrs.length > 0 ? Math.round(bsrs.reduce((a, b) => a + b, 0) / bsrs.length) : null;

        const prices = kwProducts.filter(p => p.price).map(p => p.price);
        const priceMin = prices.length > 0 ? Math.min(...prices) : null;
        const priceMax = prices.length > 0 ? Math.max(...prices) : null;

        const ratings = kwProducts.filter(p => p.rating).map(p => p.rating);
        const avgRating = ratings.length > 0 ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : null;

        // Get last scraped time
        const scrapedDates = kwProducts.filter(p => p.scraped_at).map(p => new Date(p.scraped_at));
        const lastScraped = scrapedDates.length > 0 ? new Date(Math.max(...scrapedDates)) : null;

        // Check for AI report
        const report = reports.find(r => r.keyword === kw.keyword);

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

    // Get keyword info
    const kwInfo = keywords.find(k => k.keyword === keyword);
    const productType = kwInfo?.product_type || detectProductType(keyword);

    // Get products for this keyword
    let kwProducts = products.filter(p => p.keyword === keyword);

    // Get last scraped time
    const scrapedDates = kwProducts.filter(p => p.scraped_at).map(p => new Date(p.scraped_at));
    const lastScraped = scrapedDates.length > 0 ? new Date(Math.max(...scrapedDates)) : null;

    // Get AI report
    const report = reports.find(r => r.keyword === keyword);

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

  function renderSettingsPage() {
    const container = document.getElementById('settings-page-container');
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

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
