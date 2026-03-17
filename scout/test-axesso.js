// Test axesso_data/amazon-reviews-scraper actor schema
const fetch = require('node-fetch');
const APIFY_KEY = process.env.APIFY_API_TOKEN || process.env.APIFY_KEY;
const ACT_ID = 'axesso_data~amazon-reviews-scraper';

async function main() {
  // Try different input schemas
  const inputs = [
    { input: [{ asin: 'B094T2BZCK', countryCode: 'US' }], maxReviews: 5 },
    { input: [{ asin: 'B094T2BZCK' }], countryCode: 'US', maxReviews: 5 },
    { input: [{ productUrl: 'https://www.amazon.com/dp/B094T2BZCK/product-reviews/B094T2BZCK' }], maxReviews: 5 },
    { input: ['B094T2BZCK'], countryCode: 'US', maxReviews: 5 },
  ];

  for (const input of inputs) {
    console.log('Trying input:', JSON.stringify(input));
    const res = await fetch(`https://api.apify.com/v2/acts/${ACT_ID}/runs?token=${APIFY_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    });
    const data = await res.json();
    if (data.data?.id) {
      console.log('✅ Run started with input:', JSON.stringify(input));
      console.log('Run ID:', data.data.id);
      // Wait and get result
      await new Promise(r => setTimeout(r, 20000));
      const rRes = await fetch(`https://api.apify.com/v2/actor-runs/${data.data.id}?token=${APIFY_KEY}`);
      const rData = await rRes.json();
      console.log('Status:', rData.data?.status);
      if (rData.data?.status === 'SUCCEEDED') {
        const items = await fetch(`https://api.apify.com/v2/datasets/${rData.data.defaultDatasetId}/items?token=${APIFY_KEY}&limit=2`);
        const reviews = await items.json();
        console.log('Sample output keys:', reviews[0] ? Object.keys(reviews[0]).join(', ') : 'empty');
        console.log('Review count:', reviews.length);
      }
      break;
    } else {
      console.log('❌ Failed:', data.error?.message || JSON.stringify(data).slice(0, 200));
    }
  }
}
main().catch(console.error);
