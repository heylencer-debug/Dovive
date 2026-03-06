const fetch = require('node-fetch');

(async () => {
  const h = await (await fetch('https://apify.com/web_wanderer/amazon-reviews-extractor')).text();
  const needles = [
    'Field input.products is required',
    '"products"',
    'products:',
    'allStarsMode',
    'pagesPerProduct',
    'amazonRegion',
    'filterByStars',
    'reviewsPerStar',
    'Input',
    'ASINs/URLs',
    'All Stars Mode',
    'Amazon Region'
  ];

  for (const n of needles) {
    const i = h.indexOf(n);
    console.log('\n===', n, '=>', i);
    if (i > -1) {
      console.log(h.slice(Math.max(0, i - 220), i + 700));
    }
  }
})();
