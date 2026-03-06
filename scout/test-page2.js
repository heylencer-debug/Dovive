require('dotenv').config();
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  // Go direct to page 2
  await page.goto('https://www.amazon.com/s?k=vitamin+D3+gummies&page=2', {
    waitUntil: 'domcontentloaded', timeout: 60000
  });
  await sleep(4000);
  console.log('Page 2 title:', await page.title());
  console.log('URL:', page.url());

  const cards = await page.evaluate(() =>
    document.querySelectorAll('[data-component-type="s-search-result"]').length
  );
  console.log('Result cards found:', cards);
  await browser.close();
  console.log('Done.');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
