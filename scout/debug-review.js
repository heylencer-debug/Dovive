const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    locale: 'en-US'
  });
  const page = await ctx.newPage();
  await page.goto('https://www.amazon.com/product-reviews/B0D2S6H23L?sortBy=helpful&pageNumber=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  const info = await page.evaluate(() => {
    const counts = {};
    const selectors = [
      '[data-hook="review"]',
      '[data-hook="review-body"]',
      '.review',
      '#cm_cr-review_list',
      '.cr-lighthouse-terms',
      '#reviews-medley-lighthouse',
    ];
    selectors.forEach(s => { counts[s] = document.querySelectorAll(s).length; });
    counts.title = document.title.slice(0, 80);
    counts.bodyText = document.body.innerText.slice(0, 400);
    return counts;
  });

  console.log(JSON.stringify(info, null, 2));
  await page.screenshot({ path: 'debug-review.png' });
  console.log('Screenshot saved: debug-review.png');
  await browser.close();
})().catch(console.error);
