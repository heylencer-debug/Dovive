// Dovive Scout - Popup Logic

// DOM Elements
const statusPill = document.getElementById('status-pill');
const statusText = document.getElementById('status-text');
const currentAction = document.getElementById('current-action');
const statKeywords = document.getElementById('stat-keywords');
const statProducts = document.getElementById('stat-products');
const statErrors = document.getElementById('stat-errors');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const logContainer = document.getElementById('log-container');

let pollInterval = null;

// ============ STATE RENDERING ============

function renderState(state) {
  if (!state) return;

  // Status pill
  statusPill.className = 'status-pill';
  if (state.running) {
    statusPill.classList.add('status-running');
    statusText.textContent = 'RUNNING';
  } else if (state.productsScraped > 0 && state.currentKeywordIndex >= state.totalKeywords) {
    statusPill.classList.add('status-done');
    statusText.textContent = 'DONE';
  } else if (state.errors > 0 && !state.running) {
    statusPill.classList.add('status-error');
    statusText.textContent = 'ERROR';
  } else {
    statusPill.classList.add('status-idle');
    statusText.textContent = 'IDLE';
  }

  // Current action
  if (state.running && state.currentKeyword) {
    currentAction.textContent = `Scraping: ${state.currentKeyword} (${state.currentKeywordIndex + 1}/${state.totalKeywords})`;
  } else if (state.productsScraped > 0 && !state.running) {
    currentAction.textContent = `Completed ${state.productsScraped} products`;
  } else {
    currentAction.textContent = 'Ready to start';
  }

  // Stats
  statKeywords.textContent = state.totalKeywords || 0;
  statProducts.textContent = state.productsScraped || 0;
  statErrors.textContent = state.errors || 0;

  // Progress
  const progress = state.totalKeywords > 0
    ? Math.round((state.currentKeywordIndex / state.totalKeywords) * 100)
    : 0;
  progressFill.style.width = `${progress}%`;
  progressText.textContent = `${progress}%`;

  // Animate progress bar when running
  if (state.running) {
    progressFill.classList.add('animated');
  } else {
    progressFill.classList.remove('animated');
  }

  // Buttons
  if (state.running) {
    btnStart.classList.add('hidden');
    btnStop.classList.remove('hidden');
  } else {
    btnStart.classList.remove('hidden');
    btnStop.classList.add('hidden');
  }

  // Log
  renderLog(state.log || []);
}

function renderLog(log) {
  if (!log || log.length === 0) return;

  logContainer.innerHTML = log.slice(0, 10).map(entry => {
    const typeClass = entry.type === 'success' ? 'log-success'
      : entry.type === 'error' ? 'log-error'
      : 'log-info';
    return `
      <div class="log-entry ${typeClass}">
        <span class="log-time">${entry.timestamp}</span>
        <span class="log-message">${escapeHtml(entry.message)}</span>
      </div>
    `;
  }).join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============ ACTIONS ============

async function fetchState() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (response?.state) {
      renderState(response.state);
    }
  } catch (e) {
    console.error('Failed to fetch state:', e);
  }
}

async function startScout() {
  try {
    btnStart.disabled = true;
    btnStart.textContent = 'STARTING...';

    await chrome.runtime.sendMessage({ type: 'START_SCOUT' });

    // Start polling
    startPolling();

    // Fetch state immediately
    await fetchState();
  } catch (e) {
    console.error('Failed to start scout:', e);
    btnStart.disabled = false;
    btnStart.textContent = 'START SCOUT';
  }
}

async function stopScout() {
  try {
    btnStop.disabled = true;
    btnStop.textContent = 'STOPPING...';

    await chrome.runtime.sendMessage({ type: 'STOP_SCOUT' });

    // Stop polling
    stopPolling();

    // Fetch final state
    await fetchState();

    btnStop.disabled = false;
    btnStop.textContent = 'STOP';
  } catch (e) {
    console.error('Failed to stop scout:', e);
    btnStop.disabled = false;
    btnStop.textContent = 'STOP';
  }
}

// ============ POLLING ============

function startPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(fetchState, 2000);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// ============ EVENT LISTENERS ============

btnStart.addEventListener('click', startScout);
btnStop.addEventListener('click', stopScout);

// ============ INIT ============

(async () => {
  // Fetch initial state
  await fetchState();

  // Check if we should start polling (if already running)
  const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  if (response?.state?.running) {
    startPolling();
  }
})();
