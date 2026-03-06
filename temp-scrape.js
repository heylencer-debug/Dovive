/**
 * Dovive Scout - Browser Scrape Data Processor
 * Processes scraped Amazon data and saves to Supabase
 */
require('dotenv').config({ path: require('path').join(__dirname, 'scout/.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// PHP to USD conversion (approximate)
const PHP_TO_USD = 58.5;

function parsePhpPrice(priceText) {
  if (!priceText) return null;
  const match = priceText.match(/PHP\s*([\d,]+(?:\.\d{2})?)/);
  if (!match) return null;
  const phpAmount = parseFloat(match[1].replace(/,/g, ''));
  const usdAmount = phpAmount / PHP_TO_USD;
  return Math.round(usdAmount * 100) / 100; // Round to 2 decimal places
}

async function sbUpsert(table, data, onConflict = '') {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const url = new URL('/rest/v1/' + table + (onConflict ? '?on_conflict=' + onConflict : ''), SUPABASE_URL);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation,resolution=merge-duplicates',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`Supabase error ${res.statusCode}: ${d}`));
        } else {
          resolve({ status: res.statusCode, body: d });
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function saveProducts(keyword, products) {
  const timestamp = new Date().toISOString();
  let saved = 0;
  
  for (const p of products) {
    try {
      const usdPrice = parsePhpPrice(p.priceText);
      
      const data = {
        keyword: keyword,
        asin: p.asin,
        title: p.title,
        price: usdPrice,
        rating: p.rating,
        review_count: p.reviewCount,
        rank_position: p.rank,
        is_sponsored: p.isSponsored || false,
        main_image: p.imageUrl,
        images: p.imageUrl ? [{ type: 'main', url: p.imageUrl }] : [],
        source: 'browser_scrape',
        scraped_at: timestamp
      };
      
      await sbUpsert('dovive_research', data, 'asin,keyword');
      saved++;
    } catch (err) {
      console.error(`Failed to save ${p.asin}: ${err.message}`);
    }
  }
  
  return saved;
}

// Parse command line args: node temp-scrape.js <keyword> <json-data>
async function main() {
  const keyword = process.argv[2];
  const jsonData = process.argv[3];
  
  if (!keyword || !jsonData) {
    console.error('Usage: node temp-scrape.js <keyword> <json-data>');
    process.exit(1);
  }
  
  let products;
  try {
    products = JSON.parse(jsonData);
  } catch (e) {
    console.error('Invalid JSON data');
    process.exit(1);
  }
  
  console.log(`Processing ${products.length} products for "${keyword}"...`);
  const saved = await saveProducts(keyword, products);
  console.log(`✅ Saved ${saved}/${products.length} products to dovive_research`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
