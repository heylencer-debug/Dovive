// Dovive Scout Dashboard V2 - Main Application
// Features: Product type filters, reviews panel, specs panel, progress tracking

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
  let pollIntervalId = null;
  let isPollingJob = false;
  let expandedProducts = new Set();

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

  // Initialize
  async function init() {
    await loadKeywords();
    await loadReports();
    await loadProducts();
    await checkScoutStatus();
    setupEventListeners();
    startStatusPolling();
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
    } catch (err) {
      console.error('Failed to load products:', err);
      // Fallback to legacy dovive_research table
      try {
        products = await sbFetch('dovive_research', {
          order: 'scraped_at.desc',
          limit: 500
        });
        renderResults();
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

    // Load reviews and specs in parallel
    const [productReviews, productSpecs] = await Promise.all([
      loadReviewsForProduct(asin),
      loadSpecsForProduct(asin)
    ]);

    // Render the details panel
    panel.innerHTML = `
      <div class="details-grid">
        <!-- Images Section -->
        ${product.images && product.images.length > 0 ? `
          <div class="details-section images-section">
            <h4>Images</h4>
            <div class="product-images">
              ${product.images.slice(0, 4).map(img => `
                <img src="${escapeHtml(img)}" alt="Product image" class="product-thumb" loading="lazy">
              `).join('')}
            </div>
          </div>
        ` : ''}

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

  // Render progress section
  function renderProgress() {
    if (!progressSection) return;

    if (currentJobStatus !== 'running') {
      progressSection.style.display = 'none';
      return;
    }

    progressSection.style.display = 'block';
    progressSection.innerHTML = `
      <div class="progress-info">
        <div class="progress-item">
          <span class="progress-label">Current Keyword:</span>
          <span class="progress-value">${escapeHtml(currentJobProgress.keyword) || '-'}</span>
        </div>
        <div class="progress-item">
          <span class="progress-label">Product Type:</span>
          <span class="progress-value">${escapeHtml(currentJobProgress.type) || '-'}</span>
        </div>
        <div class="progress-item">
          <span class="progress-label">Products Scraped:</span>
          <span class="progress-value">${currentJobProgress.products.toLocaleString()}</span>
        </div>
        <div class="progress-item">
          <span class="progress-label">Reviews Scraped:</span>
          <span class="progress-value">${currentJobProgress.reviews.toLocaleString()}</span>
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

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
