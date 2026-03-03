// Dovive Scout Dashboard - Main Application
// Powered by Scout Agent

(function() {
  'use strict';

  // State
  let keywords = [];
  let research = [];
  let reports = [];
  let currentKeyword = null;
  let currentSort = { column: 'rank_position', desc: false };
  let currentJobStatus = 'idle';
  let pollIntervalId = null;
  let isPollingJob = false;

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

  // Initialize
  async function init() {
    await loadKeywords();
    await loadReports();
    await loadResearch();
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

  // Load research data from Supabase
  async function loadResearch() {
    try {
      research = await sbFetch('dovive_research', {
        order: 'scraped_at.desc',
        limit: 500
      });
      renderResults();
    } catch (err) {
      console.error('Failed to load research:', err);
    }
  }

  // Check Scout agent status
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

        updateStatusBadge(latestJob.status);

        if (latestJob.status === 'complete') {
          lastRunEl.textContent = formatTimeAgo(latestJob.completed_at || latestJob.updated_at);

          // If just completed, refresh data
          if (prevStatus === 'running' || prevStatus === 'queued') {
            await loadResearch();
            await loadReports();
            showStatusMessage('Scout completed! Results updated.', 'success');
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

  // Render keyword tabs for results with recommendation badges
  function renderKeywordTabs() {
    if (keywords.length === 0) {
      keywordTabs.innerHTML = '';
      return;
    }

    keywordTabs.innerHTML = keywords.map((kw, i) => {
      // Find latest report for this keyword
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

  // Update keyword count
  function updateKeywordCount() {
    keywordCount.textContent = `${keywords.length} active`;
    keywordsTrackedEl.textContent = keywords.length;
  }

  // Render research results
  function renderResults() {
    const filteredResearch = currentKeyword
      ? research.filter(r => r.keyword === currentKeyword)
      : research;

    // Deduplicate by ASIN (keep most recent)
    const seenAsins = new Set();
    const uniqueResearch = filteredResearch.filter(r => {
      if (seenAsins.has(r.asin)) return false;
      seenAsins.add(r.asin);
      return true;
    });

    if (uniqueResearch.length === 0) {
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
    const sorted = [...uniqueResearch].sort((a, b) => {
      let aVal = a[currentSort.column];
      let bVal = b[currentSort.column];

      // Handle nulls
      if (aVal === null || aVal === undefined) aVal = currentSort.desc ? -Infinity : Infinity;
      if (bVal === null || bVal === undefined) bVal = currentSort.desc ? -Infinity : Infinity;

      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
      if (typeof bVal === 'string') bVal = bVal.toLowerCase();

      if (aVal < bVal) return currentSort.desc ? 1 : -1;
      if (aVal > bVal) return currentSort.desc ? -1 : 1;
      return 0;
    });

    const tableHtml = `
      <table class="results-table">
        <thead>
          <tr>
            <th data-column="rank_position" class="${getSortClass('rank_position')}">Rank</th>
            <th data-column="asin" class="${getSortClass('asin')}">ASIN</th>
            <th data-column="title" class="${getSortClass('title')}">Product Title</th>
            <th data-column="price" class="${getSortClass('price')}">Price</th>
            <th data-column="bsr" class="${getSortClass('bsr')}">BSR</th>
            <th data-column="rating" class="${getSortClass('rating')}">Rating</th>
            <th data-column="review_count" class="${getSortClass('review_count')}">Reviews</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map(r => `
            <tr class="${r.is_sponsored ? 'sponsored-row' : ''}">
              <td>${r.rank_position || '-'}</td>
              <td class="asin">
                <a href="https://www.amazon.com/dp/${r.asin}" target="_blank" rel="noopener">${r.asin || '-'}</a>
              </td>
              <td class="title" title="${escapeHtml(r.title || '')}">${escapeHtml(truncate(r.title, 60) || '-')}</td>
              <td class="price">${r.price ? '$' + r.price.toFixed(2) : '-'}</td>
              <td>${r.bsr ? r.bsr.toLocaleString() : '-'}</td>
              <td class="rating">${r.rating ? renderStars(r.rating) : '-'}</td>
              <td>${r.review_count ? r.review_count.toLocaleString() : '-'}</td>
              <td>
                ${r.is_sponsored ? '<span class="flag-badge sponsored">AD</span>' : ''}
                ${r.bsr && r.bsr < 10000 ? '<span class="flag-badge top-seller">TOP</span>' : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    resultsContainer.innerHTML = tableHtml;
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

    // Show recommendation badge prominently
    const recBadge = report.recommendation
      ? `<div class="summary-recommendation rec-${report.recommendation.toLowerCase()}">${report.recommendation}</div>`
      : '';

    // Stats row
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

    // Convert markdown-ish text to HTML
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
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(.+)$/gm, (match) => {
        if (match.startsWith('<')) return match;
        return match;
      });
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
      queued: 'Scout queued, waiting to start...',
      running: 'Scout is scraping Amazon...',
      complete: '',
      error: ''
    };

    scoutStatus.textContent = statusText[status] || status.toUpperCase();
    scoutStatus.className = 'badge ' + status.toLowerCase();

    // Add pulsing dot for active states
    if (status === 'queued' || status === 'running') {
      scoutStatus.innerHTML = `<span class="pulse-dot ${status}"></span> ${statusText[status]}`;
      runScoutBtn.disabled = true;
    } else {
      runScoutBtn.disabled = false;
    }

    // Show status message
    if (statusMessages[status]) {
      showStatusMessage(statusMessages[status], 'info');
    }
  }

  // Show status message
  function showStatusMessage(message, type = 'info') {
    // Check if status message element exists, create if not
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

    // Auto-hide success messages
    if (type === 'success') {
      setTimeout(() => {
        msgEl.style.display = 'none';
      }, 5000);
    }
  }

  // Add keyword
  async function addKeyword() {
    const keyword = keywordInput.value.trim().toLowerCase();
    if (!keyword) return;

    // Check for duplicates
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

      showStatusMessage('Scout queued! Results will appear shortly.', 'info');
      lastRunEl.textContent = 'Starting...';

      // Start faster polling
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

        // Update active state
        document.querySelectorAll('.keyword-tab').forEach(tab => tab.classList.remove('active'));
        e.target.classList.add('active');

        renderResults();
        renderSummary();
      }
    });

    // Table sort
    resultsContainer.addEventListener('click', (e) => {
      if (e.target.tagName === 'TH' && e.target.dataset.column) {
        handleSort(e.target.dataset.column);
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

      // Stop fast polling when job is done
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
