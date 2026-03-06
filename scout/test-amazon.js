require('dotenv').config();
const path = require('path');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());

(async () => {
  const userDataDir = path.join(__dirname, '.browser-profile');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--start-maximized'],
    viewport: null,
    locale: 'en-US'
  });

  const page = await context.newPage();
  console.log('Navigating to Amazon search...');
  await page.goto('https://www.amazon.com/s?k=ashwagandha+gummies', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  const title = await page.title();
  const url = page.url();
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
  const asinCount = await page.evaluate(() => document.querySelectorAll('[data-asin]:not([data-asin=""])').length);

  console.log('Title:', title);
  console.log('URL:', url);
  console.log('ASIN count:', asinCount);
  console.log('Body preview:', bodyText.replace(/\n/g, ' ').substring(0, 300));

  await page.screenshot({ path: path.join(__dirname, 'test-screenshot.png') });
  console.log('Screenshot saved to test-screenshot.png');

  await context.close();
})();
