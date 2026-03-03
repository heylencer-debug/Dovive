// Dovive Scout - Background Service Worker
// Handles Supabase communication, tab management, and scout orchestration

const SB_URL = 'https://fhfqjcvwcxizbioftvdw.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoZnFqY3Z3Y3hpemJpb2Z0dmR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNTcxMzgsImV4cCI6MjA4NzkzMzEzOH0.g8K40DjhvxE7u4JdHICqKc1dMxS4eZdMhfA11M8ZMBc';

// Default state
const DEFAULT_STATE = {
  running: false,
  currentKeyword: '',
  currentKeywordIndex: 0,
  totalKeywords: 0,
  productsScraped: 0,
  errors: 0,
  log: []
};

// ============ SUPABASE FUNCTIONS ============

async function sbUpsert(table, data, onConflict) {
  const url = `${SB_URL}/rest/v1/${table}${onConflict ? `?on_conflict=${onConflict}` : ''}`;
  const headers = {
    'apikey': SB_KEY,
    'Authorization': `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json',
    // Only use merge-duplicates if we have an onConflict key
    'Prefer': onConflict ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal'
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supabase upsert failed: ${error}`);
  }

  return response;
}

async function sbFetch(table, params = {}) {
  const url = new URL(`${SB_URL}/rest/v1/${table}`);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'apikey': SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supabase fetch failed: ${error}`);
  }

  return response.json();
}

async function getActiveKeywords() {
  const data = await sbFetch('dovive_keywords', {
    'active': 'eq.true',
    'select': 'keyword'
  });
  return data.map(row => row.keyword);
}

async function saveProduct(productData) {
  await sbUpsert('dovive_research', productData, 'asin,keyword');
}

async function saveReviews(asin, keyword, reviews) {
  if (!reviews || reviews.length === 0) return;

  const reviewsWithKeys = reviews.map(r => ({
    ...r,
    asin,
    keyword
  }));

  // No unique constraint - just insert all reviews
  await sbUpsert('dovive_reviews', reviewsWithKeys, null);
}

// ============ STATE MANAGEMENT ============

async function getState() {
  const result = await chrome.storage.local.get('scoutState');
  return result.scoutState || { ...DEFAULT_STATE };
}

async function setState(updates) {
  const current = await getState();
  const newState = { ...current, ...updates };
  await chrome.storage.local.set({ scoutState: newState });
  return newState;
}

async function addLog(message, type = 'info') {
  const state = await getState();
  const timestamp = new Date().toLocaleTimeString();
  const logEntry = { timestamp, message, type };
  const log = [logEntry, ...state.log].slice(0, 50); // Keep last 50
  await setState({ log });
  console.log(`[Dovive Scout] ${type}: ${message}`);
}

// ============ TAB MANAGEMENT ============

async function getScoutTabId() {
  const result = await chrome.storage.local.get('scoutTabId');
  return result.scoutTabId;
}

async function setScoutTabId(tabId) {
  await chrome.storage.local.set({ scoutTabId: tabId });
}

async function openSearchTab(keyword) {
  let tabId = await getScoutTabId();

  // Navigate directly to search URL — typing triggers bot detection
  const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(keyword)}`;

  if (tabId) {
    try {
      await chrome.tabs.update(tabId, { url: searchUrl, active: true });
    } catch (e) {
      const tab = await chrome.tabs.create({ url: searchUrl, active: true });
      tabId = tab.id;
      await setScoutTabId(tabId);
    }
  } else {
    const tab = await chrome.tabs.create({ url: searchUrl, active: true });
    tabId = tab.id;
    await setScoutTabId(tabId);
  }

  // Wait for search results to load
  await new Promise(resolve => setTimeout(resolve, 6000 + Math.random() * 3000));

  // Start timeout for content script response
  setScrapeTimeout();

  return tabId;
}

async function closeScoutTab() {
  const tabId = await getScoutTabId();
  if (tabId) {
    try {
      await chrome.tabs.remove(tabId);
    } catch (e) {
      // Tab might already be closed
    }
    await chrome.storage.local.remove('scoutTabId');
  }
}

async function navigateToProduct(asin) {
  const tabId = await getScoutTabId();
  if (!tabId) return;

  // Human pause before clicking — like deciding to click
  await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1500));

  // Click the product title link naturally
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (asin) => {
        const link = document.querySelector(`[data-asin="${asin}"] h2 a`);
        if (link) {
          // Scroll into view first
          link.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => link.click(), 600 + Math.random() * 400);
        } else {
          const card = document.querySelector(`[data-asin="${asin}"]`);
          const anyLink = card?.querySelector('a[href*="/dp/"]');
          if (anyLink) {
            anyLink.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => anyLink.click(), 600 + Math.random() * 400);
          }
        }
      },
      args: [asin]
    });
  } catch (e) {
    console.error('Failed to click product link:', e);
    await chrome.tabs.update(tabId, { url: `https://www.amazon.com/dp/${asin}` });
  }

  // Start timeout for content script response
  setScrapeTimeout();
}

// ============ SCOUT FLOW ============

let keywords = [];
let currentProducts = [];

async function startScout() {
  try {
    await addLog('Starting scout...', 'info');

    // Fetch active keywords
    keywords = await getActiveKeywords();

    if (keywords.length === 0) {
      await addLog('No active keywords found!', 'error');
      await setState({ running: false });
      return;
    }

    await setState({
      running: true,
      currentKeywordIndex: 0,
      totalKeywords: keywords.length,
      productsScraped: 0,
      errors: 0,
      currentKeyword: keywords[0]
    });

    await addLog(`Found ${keywords.length} keywords`, 'success');

    // Start with first keyword
    await processNextKeyword();

  } catch (e) {
    await addLog(`Start failed: ${e.message}`, 'error');
    await setState({ running: false });
  }
}

async function checkIfCancelled() {
  try {
    const jobs = await sbFetch('dovive_jobs', { 'order': 'created_at.desc', 'limit': '1' });
    if (jobs && jobs.length > 0 && jobs[0].status === 'cancelled') {
      await addLog('Job cancelled from dashboard', 'info');
      await setState({ running: false, currentKeyword: '' });
      await closeScoutTab();
      await chrome.storage.local.remove('activeJobId');
      return true;
    }
  } catch (e) { /* ignore */ }
  return false;
}

async function processNextKeyword() {
  const state = await getState();

  if (!state.running) {
    await addLog('Scout stopped', 'info');
    return;
  }

  // Check if dashboard cancelled the job
  if (await checkIfCancelled()) return;

  if (state.currentKeywordIndex >= keywords.length) {
    // Done!
    await addLog(`Scout complete! ${state.productsScraped} products saved.`, 'success');
    await setState({ running: false, currentKeyword: '' });
    await closeScoutTab();
    // Mark job done in Supabase so dashboard shows updated status
    const result = await chrome.storage.local.get('activeJobId');
    if (result.activeJobId) {
      await markJobDone(result.activeJobId, state.productsScraped, state.errors);
    }
    return;
  }

  const keyword = keywords[state.currentKeywordIndex];
  await setState({ currentKeyword: keyword });
  await addLog(`Searching: ${keyword}`, 'info');

  await openSearchTab(keyword);
}

async function handleSearchResults(keyword, products) {
  const state = await getState();
  if (!state.running) return;

  if (!products || products.length === 0) {
    await addLog(`No products found for: ${keyword}`, 'error');
    await setState({ errors: state.errors + 1 });
    await moveToNextKeyword();
    return;
  }

  currentProducts = products;
  const topProduct = products[0];

  await addLog(`Found ${products.length} products, scraping: ${topProduct.asin}`, 'info');

  // Save search results for top product
  try {
    await saveProduct({
      asin: topProduct.asin,
      keyword: keyword,
      title: topProduct.title,
      price: topProduct.price,
      rating: topProduct.rating,
      review_count: topProduct.review_count,
      rank_position: topProduct.rank_position,
      is_sponsored: topProduct.is_sponsored,
      scraped_at: new Date().toISOString()
    });
  } catch (e) {
    await addLog(`Failed to save search data: ${e.message}`, 'error');
  }

  // Navigate to product page for deep scrape
  await navigateToProduct(topProduct.asin);
}

const MAX_REVIEW_PAGES = 3;

async function navigateToReviews(asin, page = 1) {
  const tabId = await getScoutTabId();
  if (!tabId) return;
  await randomDelay(2000, 4000);
  const url = `https://www.amazon.com/product-reviews/${asin}?pageNumber=${page}&sortBy=recent&reviewerType=all_reviews`;
  await chrome.tabs.update(tabId, { url });

  // Start timeout for content script response
  setScrapeTimeout();
}

async function handleReviewsData(asin, reviews, page, hasNextPage) {
  const state = await getState();
  if (!state.running) return;

  // Save this page's reviews
  if (reviews && reviews.length > 0) {
    try {
      await saveReviews(asin, state.currentKeyword, reviews);
      await addLog(`Reviews p${page}: ${reviews.length} saved for ${asin}`, 'success');
    } catch (e) {
      await addLog(`Reviews save failed: ${e.message}`, 'error');
    }
  }

  // Go to next page or move to next keyword
  if (hasNextPage && page < MAX_REVIEW_PAGES) {
    await navigateToReviews(asin, page + 1);
  } else {
    await addLog(`Reviews done for ${asin} (${page} page${page > 1 ? 's' : ''})`, 'info');
    await moveToNextKeyword();
  }
}

async function handleProductData(data) {
  const state = await getState();
  if (!state.running) return;

  try {
    // Merge with keyword
    const productData = {
      ...data,
      keyword: state.currentKeyword,
      specs: data.specs ? JSON.stringify(data.specs) : null,
      images: data.images ? JSON.stringify(data.images) : null,
      bullet_points: data.bullet_points ? JSON.stringify(data.bullet_points) : null,
      certifications: data.certifications ? JSON.stringify(data.certifications) : null
    };

    await saveProduct(productData);
    await addLog(`Saved: ${data.asin} (${state.currentKeyword})`, 'success');
    await setState({ productsScraped: state.productsScraped + 1 });

  } catch (e) {
    await addLog(`Save failed: ${e.message}`, 'error');
    await setState({ errors: state.errors + 1 });
    await moveToNextKeyword();
    return;
  }

  // Navigate to reviews page — content script will handle scraping
  await navigateToReviews(data.asin, 1);
}

async function moveToNextKeyword() {
  const state = await getState();
  const nextIndex = state.currentKeywordIndex + 1;
  await setState({ currentKeywordIndex: nextIndex });

  // Human pause between keywords — like taking a break before next search
  await new Promise(resolve => setTimeout(resolve, 5000 + Math.random() * 5000));

  await processNextKeyword();
}

async function stopScout() {
  await setState({ running: false, currentKeyword: '' });
  await addLog('Scout stopped by user', 'info');
  await closeScoutTab();
  clearScrapeTimeout();
}

// ============ TIMEOUT HANDLING ============

let scrapeTimeoutId = null;
const SCRAPE_TIMEOUT_MS = 60000; // 60 seconds

function setScrapeTimeout() {
  clearScrapeTimeout();
  scrapeTimeoutId = setTimeout(async () => {
    const state = await getState();
    if (state.running) {
      await addLog('Page scrape timeout - moving to next keyword', 'error');
      await setState({ errors: state.errors + 1 });
      await moveToNextKeyword();
    }
  }, SCRAPE_TIMEOUT_MS);
}

function clearScrapeTimeout() {
  if (scrapeTimeoutId) {
    clearTimeout(scrapeTimeoutId);
    scrapeTimeoutId = null;
  }
}

// ============ MESSAGE HANDLING ============

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case 'START_SCOUT':
          await startScout();
          sendResponse({ success: true });
          break;

        case 'STOP_SCOUT':
          await stopScout();
          sendResponse({ success: true });
          break;

        case 'GET_STATE':
          const state = await getState();
          sendResponse({ state });
          break;

        case 'SEARCH_RESULTS':
          clearScrapeTimeout();
          await handleSearchResults(message.keyword, message.products);
          sendResponse({ success: true });
          break;

        case 'PRODUCT_DATA':
          clearScrapeTimeout();
          await handleProductData(message.data);
          sendResponse({ success: true });
          break;

        case 'REVIEWS_DATA':
          clearScrapeTimeout();
          await handleReviewsData(message.asin, message.reviews, message.page, message.hasNextPage);
          sendResponse({ success: true });
          break;

        case 'SCRAPE_ERROR':
          clearScrapeTimeout();
          await addLog(`Scrape error: ${message.error}`, 'error');
          const currentState = await getState();
          await setState({ errors: currentState.errors + 1 });
          await moveToNextKeyword();
          sendResponse({ success: true });
          break;

        default:
          sendResponse({ error: 'Unknown message type' });
      }
    } catch (e) {
      console.error('Message handler error:', e);
      sendResponse({ error: e.message });
    }
  })();

  return true; // Keep channel open for async response
});

// ============ JOB QUEUE POLLING ============
// Polls dovive_jobs every 60s for queued jobs triggered from the dashboard

async function pollJobQueue() {
  try {
    const state = await getState();
    if (state.running) return; // already scraping, skip

    const jobs = await sbFetch('dovive_jobs', {
      'status': 'eq.queued',
      'order': 'created_at.asc',
      'limit': '1'
    });

    if (jobs && jobs.length > 0) {
      const job = jobs[0];
      console.log('[Dovive Scout] Found queued job:', job.id);

      // Mark job as running
      await fetch(`${SB_URL}/rest/v1/dovive_jobs?id=eq.${job.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': SB_KEY,
          'Authorization': `Bearer ${SB_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: 'running', started_at: new Date().toISOString() })
      });

      // Store job id so we can mark it done later
      await chrome.storage.local.set({ activeJobId: job.id });
      await addLog(`Picked up job #${job.id} from dashboard`, 'info');
      await startScout();
    }
  } catch (e) {
    console.error('[Dovive Scout] Poll error:', e.message);
  }
}

async function markJobDone(jobId, productsScraped, errors) {
  if (!jobId) return;
  await fetch(`${SB_URL}/rest/v1/dovive_jobs?id=eq.${jobId}`, {
    method: 'PATCH',
    headers: {
      'apikey': SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      status: 'done',
      finished_at: new Date().toISOString(),
      products_scraped: productsScraped,
      error_count: errors
    })
  });
  await chrome.storage.local.remove('activeJobId');
}

// Reset stale state on service worker startup
async function resetStaleState() {
  const state = await getState();
  if (state.running) {
    // Check if there's actually a scout tab open
    const tabId = await getScoutTabId();
    let tabExists = false;
    if (tabId) {
      try {
        await chrome.tabs.get(tabId);
        tabExists = true;
      } catch (e) {
        // Tab doesn't exist
      }
    }
    
    if (!tabExists) {
      console.log('[Dovive Scout] Found stale running state, resetting...');
      await setState({ ...DEFAULT_STATE });
      await chrome.storage.local.remove(['scoutTabId', 'activeJobId']);
      
      // Also mark any "running" jobs as cancelled in Supabase
      try {
        await fetch(`${SB_URL}/rest/v1/dovive_jobs?status=eq.running`, {
          method: 'PATCH',
          headers: {
            'apikey': SB_KEY,
            'Authorization': `Bearer ${SB_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ status: 'cancelled' })
        });
      } catch (e) {
        console.error('[Dovive Scout] Failed to cancel stale jobs:', e);
      }
    }
  }
}

// Start polling on service worker boot
resetStaleState().then(() => {
  setInterval(pollJobQueue, 60000);
  pollJobQueue(); // check immediately on startup
});

// Log when service worker starts
console.log('[Dovive Scout] Service worker started — polling for dashboard jobs every 60s');
