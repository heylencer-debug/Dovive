// Check if product page has any review content
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36', locale: 'en-US' });
  const page = await ctx.newPage();

  await page.goto('https://www.amazon.com/dp/B07P2CWWVV', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000); // wait for AJAX reviews to load

  const info = await page.evaluate(() => {
    const reviewSelectors = [
      '[data-hook="review"]',
      '[data-hook="review-body"]',
      '.customer-review',
      '#customer-reviews-top-picks',
      '#cr-medley-summary',
      '.cr-widget-FocalReviews',
      '[cel_widget_id*="review"]',
    ];
    const counts = {};
    reviewSelectors.forEach(s => counts[s] = document.querySelectorAll(s).length);

    // Also grab snippet of review section area
    const section = document.querySelector('#reviewsMedley, #customerReviews, [data-feature-name="reviewsMediaTabBar"]');
    counts.sectionText = section?.innerText?.slice(0, 200) || 'NOT FOUND';
    return counts;
  });

  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})().catch(console.error);
