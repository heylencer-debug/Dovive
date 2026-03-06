require('dotenv').config();
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36', viewport: { width: 1280, height: 800 } });
  await context.route('**/*', route => ['image','font'].includes(route.request().resourceType()) ? route.abort() : route.continue());

  const page = await context.newPage();
  await page.goto(`https://www.amazon.com/s?k=lion%27s+mane+powder&s=exact-aware-popularity-rank`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 4000));

  // Dump first card's inner HTML to find title structure
  const debug = await page.evaluate(() => {
    const card = document.querySelector('[data-component-type="s-search-result"]');
    if (!card) return 'no card';
    // Try to find all span and a elements that might be titles
    const h2 = card.querySelector('h2');
    const spans = h2 ? Array.from(h2.querySelectorAll('span')).map(s => s.textContent.trim().slice(0, 80)) : [];
    const allSpans = Array.from(card.querySelectorAll('span[class*="text-normal"], span[class*="a-text"]')).map(s => ({ cls: s.className, text: s.textContent.trim().slice(0, 80) }));
    return { 
      h2Text: h2 ? h2.textContent.trim().slice(0, 120) : 'no h2',
      h2SpanTexts: spans,
      allSpans: allSpans.slice(0, 10),
      cardHtml: card.innerHTML.slice(0, 1500)
    };
  });

  console.log('h2Text:', debug.h2Text);
  console.log('h2SpanTexts:', JSON.stringify(debug.h2SpanTexts));
  console.log('allSpans:', JSON.stringify(debug.allSpans, null, 2));
  await browser.close();
}

main().catch(console.error);
