const https = require('https');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;

function sbUpsert(table, rows) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(rows);
    const url = new URL('/rest/v1/' + table, SB_URL);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve({status:res.statusCode,body:d})); });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

const config = [
  {
    config_key: 'product_types_active',
    config_value: JSON.stringify(['gummies', 'gummy', 'powder']),
    description: 'Active product types Scout searches. Phase 1: Gummies + Powder only.'
  },
  {
    config_key: 'product_types_all',
    config_value: JSON.stringify(['gummies','gummy','powder','capsule','capsules','tablet','tablets','softgel','softgels','liquid','drops','tincture','spray','patch','tea','drink mix','stick pack','lozenge','chewable','liposomal']),
    description: 'All product types available. Activate by adding to product_types_active.'
  },
  {
    config_key: 'max_products_per_type',
    config_value: '50',
    description: 'Max products to scrape per keyword+type combination.'
  },
  {
    config_key: 'max_reviews_per_product',
    config_value: '200',
    description: 'Max reviews to scrape per product ASIN.'
  },
  {
    config_key: 'deep_scrape_top_n',
    config_value: '20',
    description: 'Number of top products to deep-scrape (product page + reviews) per keyword+type.'
  },
  {
    config_key: 'best_sellers_categories',
    config_value: JSON.stringify([
      { name: 'Gummy Vitamins & Supplements', node_id: '6973664011', format: 'gummies', url: 'https://www.amazon.com/best-sellers-health-personal-care/zgbs/hpc/6973664011' },
      { name: 'Herbal Supplements', node_id: '3764441', format: 'all', url: 'https://www.amazon.com/Best-Sellers-Health-Personal-Care-Herbal-Supplements/zgbs/hpc/3764441' },
      { name: 'Sports Nutrition Protein Powders', node_id: '3773961', format: 'powder', url: 'https://www.amazon.com/Best-Sellers-Sports-Nutrition-Protein/zgbs/sporting-goods/3773961' },
      { name: 'Vitamins & Dietary Supplements', node_id: '3764461', format: 'all', url: 'https://www.amazon.com/Best-Sellers-Health-Personal-Care-Vitamins-Dietary-Supplements/zgbs/hpc/3764461' },
      { name: 'Mushroom Supplements', node_id: '16318361011', format: 'all', url: 'https://www.amazon.com/Best-Sellers-Health-Personal-Care-Mushroom-Supplements/zgbs/hpc/16318361011' }
    ]),
    description: 'Amazon Best Seller category pages to scrape for true market leaders. Sorted by real sales velocity.'
  },
  {
    config_key: 'scrape_mode',
    config_value: '"best_sellers_first"',
    description: 'How Scout finds products. Options: keyword_only | best_sellers_only | best_sellers_first (scrape BS pages then fill with keyword search)'
  },
  {
    config_key: 'request_delay_ms',
    config_value: '{ "min": 2000, "max": 4000 }',
    description: 'Random delay range between Amazon requests to avoid rate limiting.'
  },
  {
    config_key: 'scout_version',
    config_value: '"v2.1"',
    description: 'Current Scout version.'
  }
];

const changelog = [
  { version: 'v1.0', change_type: 'initial', description: 'Initial build: keyword search scraping, 20 products per keyword, basic ASIN data.' },
  { version: 'v2.0', change_type: 'major', description: 'Product type categorization (20 types x 50 products), full review scraping (200/product), deep ASIN specs, images, certifications.' },
  { version: 'v2.1', change_type: 'focus', description: 'Phase 1 focus: Gummies + Powder only. 9 targeted keywords. Other product types commented out.' },
  { version: 'v2.2', change_type: 'intelligence', description: 'Gummies: pectin/gelatin, sugar-free, sweetener, flavor extraction. Powder: sweetener, packaging, serving grams. Price-per-serving calc. Review sentiment tagging.' },
  { version: 'v2.3', change_type: 'ui', description: 'Live progress UI: radar animation, progress bars, ETA, keyword breakdown, stats counters.' },
  { version: 'v2.4', change_type: 'data_source', description: 'Switched to Best Sellers pages as primary source (true sales-ranked order). Keyword search as fallback/supplement.' }
];

(async () => {
  console.log('Seeding Scout config...');
  let r = await sbUpsert('dovive_scout_config', config);
  console.log('Config:', r.status);

  console.log('Seeding changelog...');
  r = await sbUpsert('dovive_scout_changelog', changelog);
  console.log('Changelog:', r.status);

  console.log('Done. Scout config saved to Supabase.');
})();
