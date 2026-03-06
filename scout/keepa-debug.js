require('dotenv').config();
const fetch = require('node-fetch');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function getKeepaKey() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/dovive_scout_config?config_key=eq.keepa_api_key&select=config_value`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
  const data = await res.json();
  return data[0].config_value.replace(/"/g, '');
}

async function main() {
  const keepaKey = await getKeepaKey();
  const asin = 'B078KJLT6G';
  const url = `https://api.keepa.com/product?key=${keepaKey}&domain=1&asin=${asin}&stats=180&history=1&offers=20&buybox=1`;
  const res = await fetch(url);
  const data = await res.json();
  const product = data.products?.[0];
  const raw = JSON.stringify(product);
  console.log('Raw Keepa size:', raw.length, 'chars');
  console.log('Tokens left:', data.tokensLeft);

  // Show top-level keys
  console.log('\nTop-level keys:', Object.keys(product).join(', '));

  // Show important fields
  console.log('\ntitle:', product.title);
  console.log('brand:', product.brand);
  console.log('manufacturer:', product.manufacturer);
  console.log('productGroup:', product.productGroup);
  console.log('categoryTree:', JSON.stringify(product.categoryTree?.slice(0,2)));
  console.log('imagesCSV:', product.imagesCSV?.slice(0,100));
  console.log('upc:', product.upc);
  console.log('ean:', product.ean);
  console.log('partNumber:', product.partNumber);
  console.log('releaseDate:', product.releaseDate);
  console.log('stats keys:', Object.keys(product.stats || {}).join(', '));
  console.log('monthlySold:', product.monthlySold);
  console.log('current BSR:', product.stats?.current?.[3]);

  // Save the raw product to a file so we can inspect
  const fs = require('fs');
  fs.writeFileSync('keepa-sample.json', JSON.stringify(product, null, 2));
  console.log('\nFull product saved to keepa-sample.json');
}

main().catch(console.error);
