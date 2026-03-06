require('dotenv').config();
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();
  console.log('Navigating to Amazon sign-out...');
  await page.goto('https://www.amazon.com/gp/sign-in.html', { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Direct sign-out URL
  await page.goto('https://www.amazon.com/gp/flex/sign-out.html?action=sign-out', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  const title = await page.title();
  console.log('Page after sign-out:', title);
  console.log('Done. Closing browser...');
  await browser.close();
}

main().catch(console.error);
