// Dovive Scout - Content Script
// Injected into Amazon pages to extract product data

// ============ HUMAN BEHAVIOR HELPERS ============

// Random delay between min and max milliseconds
function randomDelay(min, max) {
  return new Promise(resolve => setTimeout(resolve, min + Math.random() * (max - min)));
}

// Simulate natural scroll — scrolls gradually in steps, like a human reading
async function humanScroll(targetY = null) {
  const target = targetY || document.body.scrollHeight;
  const current = window.scrollY;
  const distance = target - current;
  const steps = 8 + Math.floor(Math.random() * 6); // 8-14 steps
  const stepSize = distance / steps;

  for (let i = 0; i < steps; i++) {
    window.scrollBy(0, stepSize + (Math.random() - 0.5) * 30);
    await randomDelay(80, 200); // 80-200ms between scroll steps
  }
}

// Simulate mouse moving over an element (dispatches mouseover/mousemove events)
function humanHover(element) {
  if (!element) return;
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2 + (Math.random() - 0.5) * 10;
  const y = rect.top + rect.height / 2 + (Math.random() - 0.5) * 10;
  element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y }));
  element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
}

// Click an element like a human (hover first, small delay, then click)
async function humanClick(element) {
  if (!element) return;
  humanHover(element);
  await randomDelay(200, 500);
  element.click();
  await randomDelay(300, 700);
}

// Wait for an element to appear in DOM
function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);
    const observer = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (found) { observer.disconnect(); resolve(found); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); reject(new Error('Timeout: ' + selector)); }, timeout);
  });
}

// ============ URL HELPERS ============

function getUrlParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

function isSearchPage() {
  return window.location.pathname.includes('/s') && getUrlParam('k');
}

function isProductPage() {
  return window.location.pathname.includes('/dp/');
}

function isReviewsPage() {
  return window.location.pathname.includes('/product-reviews/');
}

// ============ SEARCH PAGE SCRAPER ============

async function scrapeSearchResults() {
  try {
    const keyword = getUrlParam('k');
    if (!keyword) return;

    console.log('[Dovive Scout] Scraping search results for:', keyword);

    // Human reading pause after page loads
    await randomDelay(1500, 3000);

    // Scroll down naturally like reading the page
    await humanScroll(document.body.scrollHeight * 0.3);
    await randomDelay(800, 1500);
    await humanScroll(document.body.scrollHeight * 0.6);
    await randomDelay(600, 1200);
    await humanScroll(document.body.scrollHeight * 0.9);
    await randomDelay(500, 1000);

    // Hover over a few random products before extracting (looks like browsing)
    const allCards = document.querySelectorAll('[data-asin]:not([data-asin=""])');
    const randomCard = allCards[Math.floor(Math.random() * Math.min(3, allCards.length))];
    if (randomCard) {
      humanHover(randomCard);
      await randomDelay(400, 800);
    }

    // Extract non-sponsored products
    const products = [];
    const productDivs = document.querySelectorAll('[data-asin]:not([data-asin=""])');

    for (const div of productDivs) {
      if (products.length >= 5) break;

      // Skip sponsored products
      const isSponsored =
        div.querySelector('[data-component-type="sp-sponsored-result"]') ||
        div.querySelector('.s-label-popover-default') ||
        div.textContent.includes('Sponsored');

      if (isSponsored) continue;

      const asin = div.getAttribute('data-asin');
      if (!asin || asin.length < 5) continue;

      // Check if this is actually a product card (has title)
      const titleEl = div.querySelector('h2 a span, h2 span');
      if (!titleEl) continue;

      const priceEl = div.querySelector('.a-price .a-offscreen');
      const ratingEl = div.querySelector('.a-icon-alt');
      const reviewCountEl = div.querySelector('.a-size-base.s-underline-text, [data-csa-c-slot-id="alf-reviews"] span.a-size-base');

      products.push({
        asin,
        title: titleEl.textContent?.trim(),
        price: priceEl ? parseFloat(priceEl.textContent?.replace(/[^0-9.]/g, '')) : null,
        rating: ratingEl ? parseFloat(ratingEl.textContent) : null,
        review_count: reviewCountEl ? parseInt(reviewCountEl.textContent?.replace(/[^0-9]/g, '')) : null,
        is_sponsored: false,
        rank_position: products.length + 1
      });
    }

    console.log('[Dovive Scout] Found products:', products.length);

    // Hover over the first result naturally before background navigates
    if (products.length > 0) {
      const firstResult = document.querySelector(`[data-asin="${products[0].asin}"]`);
      if (firstResult) {
        humanHover(firstResult);
        await randomDelay(500, 1000);
        firstResult.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await randomDelay(600, 1000);
      }
    }

    // Send results to background
    chrome.runtime.sendMessage({
      type: 'SEARCH_RESULTS',
      keyword,
      products
    });

  } catch (e) {
    console.error('[Dovive Scout] Search scrape error:', e);
    chrome.runtime.sendMessage({
      type: 'SCRAPE_ERROR',
      error: e.message
    });
  }
}

// ============ REVIEWS PAGE SCRAPER ============

async function scrapeReviewsPage() {
  try {
    const asinMatch = window.location.pathname.match(/\/product-reviews\/([A-Z0-9]+)/i);
    if (!asinMatch) return;
    const asin = asinMatch[1];
    const pageMatch = new URLSearchParams(window.location.search).get('pageNumber') || '1';
    const page = parseInt(pageMatch);

    console.log(`[Dovive Scout] Scraping reviews page ${page} for ${asin}`);

    await randomDelay(2000, 3500);

    // Human scroll through reviews
    await humanScroll(document.body.scrollHeight * 0.5);
    await randomDelay(800, 1500);
    await humanScroll(document.body.scrollHeight * 0.95);
    await randomDelay(600, 1200);

    const reviewCards = document.querySelectorAll('[data-hook="review"]');
    const reviews = [];

    for (const card of reviewCards) {
      const ratingEl = card.querySelector('[data-hook="review-star-rating"] .a-icon-alt, [data-hook="cmps-review-star-rating"] .a-icon-alt');
      const titleEl = card.querySelector('[data-hook="review-title"] span:not(.a-icon-alt)');
      const bodyEl = card.querySelector('[data-hook="review-body"] span');
      const dateEl = card.querySelector('[data-hook="review-date"]');
      const authorEl = card.querySelector('.a-profile-name');
      const verifiedEl = card.querySelector('[data-hook="avp-badge"]');

      // Parse the review date to extract just the date portion
      const dateText = dateEl?.textContent?.replace('Reviewed in', '').trim() || '';
      const dateMatch = dateText.match(/on\s+(\w+\s+\d+,\s+\d+)/);
      const reviewDateStr = dateMatch ? dateMatch[1] : null;

      reviews.push({
        asin,
        reviewer_name: authorEl?.textContent?.trim(),
        rating: ratingEl ? parseFloat(ratingEl.textContent) : null,
        title: titleEl?.textContent?.trim(),
        body: bodyEl?.textContent?.trim()?.substring(0, 2000),
        review_date: reviewDateStr,  // Will be converted to date format
        verified_purchase: !!verifiedEl,
        helpful_votes: 0,
        scraped_at: new Date().toISOString()
      });
    }

    const hasNextPage = !!document.querySelector('.a-pagination .a-last:not(.a-disabled) a');
    console.log(`[Dovive Scout] Reviews page ${page}: ${reviews.length} reviews, hasNext: ${hasNextPage}`);

    chrome.runtime.sendMessage({
      type: 'REVIEWS_DATA',
      asin,
      reviews,
      page,
      hasNextPage
    });

  } catch (e) {
    console.error('[Dovive Scout] Reviews page error:', e);
    chrome.runtime.sendMessage({ type: 'SCRAPE_ERROR', error: e.message });
  }
}

// ============ PRODUCT PAGE SCRAPER ============

async function scrapeProductPage() {
  try {
    const asinMatch = window.location.pathname.match(/\/dp\/([A-Z0-9]+)/i);
    if (!asinMatch) return;

    const asin = asinMatch[1];
    console.log('[Dovive Scout] Scraping product:', asin);

    // Human pause — "just arrived on the page"
    await randomDelay(2000, 4000);

    // Scroll down slowly like actually reading the listing
    await humanScroll(400);  // scroll past hero image
    await randomDelay(1000, 2000); // read the title + price area
    await humanScroll(900);  // scroll to bullet points
    await randomDelay(1500, 2500); // read the bullets
    await humanScroll(1600); // scroll to product details
    await randomDelay(1000, 1800); // read specs

    // Hover over the main image (like a real shopper checking images)
    const mainImg = document.querySelector('#landingImage');
    if (mainImg) {
      humanHover(mainImg);
      await randomDelay(800, 1500);
    }

    // Click through 2-3 gallery images naturally
    const galleryThumbs = document.querySelectorAll('#altImages li.item');
    for (let i = 1; i < Math.min(3, galleryThumbs.length); i++) {
      await humanClick(galleryThumbs[i]);
      await randomDelay(600, 1200);
    }

    // Scroll down to reviews section
    const reviewSection = document.querySelector('#reviewsMedley, #customer-reviews-content');
    if (reviewSection) {
      reviewSection.scrollIntoView({ behavior: 'smooth' });
      await randomDelay(1000, 2000);
    }

    // Extract product data
    const productData = {
      asin,
      title: document.querySelector('#productTitle')?.textContent?.trim(),
      brand: document.querySelector('#bylineInfo')?.textContent?.replace(/Visit the|Store|Brand:/g, '').trim(),
      price: (() => {
        const priceEl = document.querySelector('.a-price .a-offscreen, #priceblock_ourprice, #priceblock_dealprice, .priceToPay .a-offscreen');
        return priceEl ? parseFloat(priceEl.textContent?.replace(/[^0-9.]/g, '')) : null;
      })(),
      rating: (() => {
        const ratingEl = document.querySelector('#acrPopover .a-icon-alt, .averageStarRatingNumerical');
        return ratingEl ? parseFloat(ratingEl.textContent) : null;
      })(),
      review_count: (() => {
        const reviewEl = document.querySelector('#acrCustomerReviewText');
        return reviewEl ? parseInt(reviewEl.textContent?.replace(/[^0-9]/g, '')) : null;
      })(),
      main_image: document.querySelector('#landingImage')?.getAttribute('data-old-hires') || document.querySelector('#landingImage')?.src,
      images: Array.from(document.querySelectorAll('#altImages li.item img'))
        .map(img => (img.getAttribute('data-old-hires') || img.src || '').replace(/\._[A-Z0-9_,]+_\./g, '.'))
        .filter(u => u.includes('amazon')),
      bullet_points: Array.from(document.querySelectorAll('#feature-bullets li span.a-list-item'))
        .map(el => el.textContent.trim())
        .filter(t => t.length > 5),
      description: document.querySelector('#productDescription p, #productDescription_feature_div')?.textContent?.trim()?.substring(0, 2000),
      ingredients: (() => {
        const full = document.body.innerText;
        const m = full.match(/ingredients[:\s]+([^\n]{20,500})/i);
        return m ? m[1].trim() : null;
      })(),
      bsr: (() => {
        const bsrEl = Array.from(document.querySelectorAll('#detailBulletsWrapper_feature_div li, #productDetails_detailBullets_sections1 tr, .prodDetSectionEntry'))
          .find(el => el.textContent.includes('Best Sellers Rank'));
        return bsrEl ? parseInt(bsrEl.textContent.match(/#([\d,]+)/)?.[1]?.replace(/,/g, '')) : null;
      })(),
      specs: (() => {
        const data = {};
        document.querySelectorAll('#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr, .prodDetTable tr').forEach(row => {
          const cells = row.querySelectorAll('td, th');
          if (cells.length >= 2) {
            const k = cells[0].textContent.replace(/[\u200F\u200E:]/g, '').trim();
            const v = cells[1].textContent.trim();
            if (k && v) data[k] = v;
          }
        });
        return data;
      })(),
      certifications: (() => {
        const text = document.body.innerText.toLowerCase();
        return ['non-gmo', 'vegan', 'vegetarian', 'gluten-free', 'organic', 'kosher', 'gmp', 'nsf', 'third-party tested', 'made in usa']
          .filter(k => text.includes(k));
      })(),
      scraped_at: new Date().toISOString()
    };

    console.log('[Dovive Scout] Extracted product data:', productData.title);

    // Send product data back — background will navigate to reviews page next
    chrome.runtime.sendMessage({
      type: 'PRODUCT_DATA',
      data: productData
    });

  } catch (e) {
    console.error('[Dovive Scout] Product scrape error:', e);
    chrome.runtime.sendMessage({
      type: 'SCRAPE_ERROR',
      error: e.message
    });
  }
}

// ============ SEARCH TYPER ============

async function typeAndSearch(keyword) {
  try {
    // Find search box
    const searchBox = document.querySelector('#twotabsearchtextbox, input[name="field-keywords"]');
    if (!searchBox) {
      console.error('[Dovive Scout] Search box not found');
      return;
    }

    // Move mouse over search area naturally
    humanHover(searchBox);
    await randomDelay(500, 1000);

    // Click search box
    searchBox.focus();
    searchBox.click();
    await randomDelay(400, 800);

    // Clear any existing text
    searchBox.value = '';
    searchBox.dispatchEvent(new Event('input', { bubbles: true }));
    await randomDelay(200, 400);

    // Type each character with natural cadence
    for (const char of keyword) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeInputValueSetter.call(searchBox, searchBox.value + char);
      searchBox.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      await randomDelay(70, 160);
    }

    // Pause like re-reading what you typed
    await randomDelay(1000, 2000);

    // Find and click the search BUTTON (not form.submit)
    const submitBtn = document.querySelector('#nav-search-submit-button, input[value="Go"], .nav-input[type="submit"]');
    if (submitBtn) {
      humanHover(submitBtn);
      await randomDelay(300, 600);
      submitBtn.click();
    } else {
      // Fallback: press Enter naturally
      searchBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, code: 'Enter', bubbles: true, cancelable: true }));
      await randomDelay(100, 200);
      searchBox.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, code: 'Enter', bubbles: true }));
    }

    console.log('[Dovive Scout] Typed and submitted search:', keyword);
  } catch (e) {
    console.error('[Dovive Scout] Type search error:', e);
  }
}

// ============ MAIN ============

let hasScraped = false;

async function checkAndScrape() {
  // Only scrape once per page load
  if (hasScraped) return;

  // Wait for page to fully load
  if (document.readyState !== 'complete') {
    return;
  }

  // Check if scout is running — retry once if service worker is sleeping (MV3)
  let isRunning = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      if (response?.state?.running) {
        isRunning = true;
      }
      break; // Got a response, no need to retry
    } catch (e) {
      if (attempt === 0) {
        // Service worker may be waking up — wait and retry
        await new Promise(r => setTimeout(r, 1000));
      }
      // If second attempt also fails, context is truly invalidated
    }
  }
  if (!isRunning) return;

  hasScraped = true;

  if (isSearchPage()) {
    await scrapeSearchResults();
  } else if (isProductPage()) {
    await scrapeProductPage();
  } else if (isReviewsPage()) {
    await scrapeReviewsPage();
  }
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TYPE_SEARCH') {
    typeAndSearch(message.keyword);
    sendResponse({ ok: true });
  }
  return true;
});

// Check on load
if (document.readyState === 'complete') {
  checkAndScrape();
} else {
  window.addEventListener('load', () => {
    setTimeout(checkAndScrape, 500);
  });
}

// Also check when URL changes (SPA navigation)
let lastUrl = window.location.href;
const urlObserver = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    hasScraped = false;
    setTimeout(checkAndScrape, 1000);
  }
});
urlObserver.observe(document.body, { childList: true, subtree: true });

console.log('[Dovive Scout] Content script loaded');
