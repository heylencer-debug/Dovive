const fetch = require('node-fetch');
const fs = require('fs');

(async () => {
  const h = await (await fetch('https://apify.com/web_wanderer/amazon-reviews-extractor/input-schema')).text();

  const anchor = '"input":{"title":"Extract product reviews';
  const i = h.indexOf(anchor);
  const j = h.indexOf('},"storages"', i);

  console.log('i', i, 'j', j);
  if (i < 0) {
    console.log('Anchor not found');
    process.exit(1);
  }

  const s = h.slice(i, j > i ? j + 1 : i + 18000);
  fs.writeFileSync('web-wanderer-input-snippet.txt', s);
  console.log('written', s.length);
})();
