/**
 * Save scraped Amazon data to Supabase dovive_research table
 * Usage: node save-scrape.js
 */
require('dotenv').config();
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// PHP to USD conversion (approximate rate)
const PHP_TO_USD = 58.5;

function parsePhpPrice(priceText) {
  if (!priceText) return null;
  const match = priceText.match(/PHP\s*([\d,]+(?:\.\d{2})?)/);
  if (!match) return null;
  const phpAmount = parseFloat(match[1].replace(/,/g, ''));
  const usdAmount = phpAmount / PHP_TO_USD;
  return Math.round(usdAmount * 100) / 100;
}

function sbUpsert(table, data, onConflict = '') {
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
      process.stdout.write('.');
    } catch (err) {
      console.error(`\nFailed to save ${p.asin}: ${err.message}`);
    }
  }
  
  console.log(`\n✅ Saved ${saved}/${products.length} products for "${keyword}"`);
  return saved;
}

// Data from browser scrape - to be populated
const scrapedData = {
  "lion's mane gummies": [
    {"rank":1,"asin":"B09K4MBQ22","title":"Fungies Lion's Mane Mushroom Gummies, Mixed Blueberry & Strawberry Flavor","priceText":"PHP 1,143.58","rating":4.4,"reviewCount":3495,"imageUrl":"https://m.media-amazon.com/images/I/81DBdC5t4ML._AC_UL320_.jpg","isSponsored":false,"isPrime":false},
    {"rank":3,"asin":"B0DG166L59","title":"Lions Mane Gummies Sugar Free – 120 Gummies for Clarity & Brain Nutrition Support","priceText":"PHP 1,460.62","rating":4.5,"reviewCount":95,"imageUrl":"https://m.media-amazon.com/images/I/81YW8s799GL._AC_UL320_.jpg","isSponsored":false,"isPrime":false},
    {"rank":5,"asin":"B0CPQ81DNB","title":"Horbäach Lion's Mane Supplement | 60 Vegan Gummies for Adults","priceText":"PHP 291.89","rating":4.5,"reviewCount":448,"imageUrl":"https://m.media-amazon.com/images/I/711IF3rfflL._AC_UL320_.jpg","isSponsored":false,"isPrime":false},
    {"rank":10,"asin":"B0B7VKJCFM","title":"OM MUSHROOM SUPERFOOD Lion's Mane Mushroom Gummies – USA Grown Organic","priceText":"PHP 1,231.32","rating":4.2,"reviewCount":null,"imageUrl":"https://m.media-amazon.com/images/I/61xUnrPcETL._AC_UL320_.jpg","isSponsored":false,"isPrime":false},
    {"rank":12,"asin":"B0DB64RGYM","title":"Lions Mane Mushroom Gummies for Adults, 140 Count Bulk","priceText":"PHP 1,517.95","rating":4.4,"reviewCount":null,"imageUrl":"https://m.media-amazon.com/images/I/71+mukuST8L._AC_UL320_.jpg","isSponsored":false,"isPrime":false},
    {"rank":14,"asin":"B0DG5KK4F3","title":"Lions Mane Gummies, Organic Lion's Mane, with Ashwagandha & Alpha GPC","priceText":"PHP 1,169.32","rating":4.6,"reviewCount":null,"imageUrl":"https://m.media-amazon.com/images/I/71yWSmztP-L._AC_UL320_.jpg","isSponsored":false,"isPrime":false},
    {"rank":16,"asin":"B0D88CHZ38","title":"Sugar Free Lions Mane Supplement Gummies with KSM-66 Ashwagandha","priceText":"PHP 1,459.45","rating":4.4,"reviewCount":369,"imageUrl":"https://m.media-amazon.com/images/I/71wUVt4BVaL._AC_UL320_.jpg","isSponsored":false,"isPrime":false},
    {"rank":18,"asin":"B0CQRRKQ5K","title":"Gaia Herbs Lion's Mane Mushroom Gummies - Brain Support Supplement","priceText":"PHP 1,578.78","rating":4.4,"reviewCount":null,"imageUrl":"https://m.media-amazon.com/images/I/81-15RZ8ubL._AC_UL320_.jpg","isSponsored":false,"isPrime":false},
    {"rank":20,"asin":"B0957TXZ2Q","title":"World's First Mushroom Complex Gummies with Lions Mane","priceText":"PHP 1,754.27","rating":4.3,"reviewCount":null,"imageUrl":"https://m.media-amazon.com/images/I/71ImZ9k9FLL._AC_UL320_.jpg","isSponsored":false,"isPrime":false},
    {"rank":22,"asin":"B0DB66S85H","title":"Lions Mane Mushroom Gummies for Adults, 280 Count Bulk, 2 Pack","priceText":"PHP 2,746.34","rating":4.4,"reviewCount":null,"imageUrl":"https://m.media-amazon.com/images/I/718Pj-wSMsL._AC_UL320_.jpg","isSponsored":false,"isPrime":false},
    {"rank":24,"asin":"B0FY73T2M6","title":"Lifeable Lions Mane Gummies for Adults","priceText":"PHP 584.37","rating":4.6,"reviewCount":null,"imageUrl":"https://m.media-amazon.com/images/I/71tKVxwP8jL._AC_UL320_.jpg","isSponsored":false,"isPrime":false},
    {"rank":26,"asin":"B0962DG24B","title":"Plant People WonderDay Mushroom Gummies - Lion's Mane, Cordyceps, Chaga","priceText":"PHP 1,754.27","rating":4.6,"reviewCount":null,"imageUrl":"https://m.media-amazon.com/images/I/81f0YAHEQCL._AC_UL320_.jpg","isSponsored":false,"isPrime":false},
    {"rank":28,"asin":"B0FY752KG9","title":"Lifeable Lions Mane Gummies for Kids","priceText":"PHP 818.35","rating":4.8,"reviewCount":null,"imageUrl":"https://m.media-amazon.com/images/I/71UF-jGWXWL._AC_UL320_.jpg","isSponsored":false,"isPrime":false},
    {"rank":30,"asin":"B0BX74PQ55","title":"Fungies Mushroom Gummy 3-Pack Bundle, Lion's Mane, Cordyceps & Reishi","priceText":"PHP 2,798.99","rating":4.4,"reviewCount":null,"imageUrl":"https://m.media-amazon.com/images/I/81u04qEQbRL._AC_UL320_.jpg","isSponsored":false,"isPrime":false},
    {"rank":32,"asin":"B0DPR69556","title":"Lions Mane Mushroom Gummies (60 Count) Focus Gummies & Brain Supplement","priceText":"PHP 465.04","rating":4.3,"reviewCount":null,"imageUrl":"https://m.media-amazon.com/images/I/815zSu4ya8L._AC_UL320_.jpg","isSponsored":false,"isPrime":false},
    {"rank":34,"asin":"B0DF6KZTVV","title":"Lion's Mane Mushroom Gummies, 5400mg per Serving","priceText":"PHP 645.20","rating":4.4,"reviewCount":null,"imageUrl":"https://m.media-amazon.com/images/I/71HqKaH6UwL._AC_UL320_.jpg","isSponsored":false,"isPrime":false},
    {"rank":36,"asin":"B0DHJXVDG3","title":"Ashwagandha Gummies - Organic Ashwagandha & Lions Mane Gummies","priceText":"PHP 1,309.70","rating":4.6,"reviewCount":null,"imageUrl":"https://m.media-amazon.com/images/I/81TiOTb4CgL._AC_UL320_.jpg","isSponsored":false,"isPrime":false},
    {"rank":38,"asin":"B0DR82J544","title":"Charlotte's Web Focus Support Mushroom Gummies for Focus and Energy","priceText":"PHP 2,046.74","rating":4.2,"reviewCount":null,"imageUrl":"https://m.media-amazon.com/images/I/51FxfXnBpbL._AC_UL320_.jpg","isSponsored":false,"isPrime":false},
    {"rank":40,"asin":"B0DCFQ6ZY4","title":"Lions Mane Mushroom Gummies for Nootropic Brain Supplement","priceText":"PHP 584.37","rating":4.3,"reviewCount":null,"imageUrl":"https://m.media-amazon.com/images/I/71cjn0rs0xL._AC_UL320_.jpg","isSponsored":false,"isPrime":false},
    {"rank":42,"asin":"B0D9YT6XZB","title":"Mushie 100% Organic Lion's Mane Mushroom Gummies - 2000mg","priceText":"PHP 1,461.79","rating":4.1,"reviewCount":null,"imageUrl":"https://m.media-amazon.com/images/I/716nYrRINWL._AC_UL320_.jpg","isSponsored":false,"isPrime":false},
    {"rank":44,"asin":"B0DTLD151H","title":"Lion's Mane Mushroom Gummies 10:1 Extract with L-Theanine 200mg","priceText":"PHP 2,005.21","rating":4.2,"reviewCount":null,"imageUrl":"https://m.media-amazon.com/images/I/61wH0gc4sYL._AC_UL320_.jpg","isSponsored":false,"isPrime":false},
    {"rank":46,"asin":"B0DKB19KKS","title":"NEW AGE Mushroom Lion's Mane Supplement Gummies - 120 Count","priceText":"PHP 1,927.41","rating":4.3,"reviewCount":null,"imageUrl":"https://m.media-amazon.com/images/I/91qJAky6zGL._AC_UL320_.jpg","isSponsored":false,"isPrime":false},
    {"rank":48,"asin":"B0CHK1J3SP","title":"Auri Nutrition Super Mushroom Focus Gummies w/Lion's Mane","priceText":"PHP 2,631.69","rating":4.0,"reviewCount":null,"imageUrl":"https://m.media-amazon.com/images/I/71mtIHjFLCL._AC_UL320_.jpg","isSponsored":false,"isPrime":false}
  ]
};

async function main() {
  console.log('Saving browser-scraped data to Supabase...\n');
  
  let totalSaved = 0;
  for (const [keyword, products] of Object.entries(scrapedData)) {
    if (products.length > 0) {
      const saved = await saveProducts(keyword, products);
      totalSaved += saved;
    }
  }
  
  console.log(`\n✅ TOTAL: ${totalSaved} products saved to dovive_research`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
