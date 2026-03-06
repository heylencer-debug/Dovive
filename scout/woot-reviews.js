/**
 * woot-reviews.js — Node.js Amazon Review Scraper
 * Uses woot.com AJAX API (same as mrlong0129 scraper)
 * No API key, no login needed
 * 
 * Usage: node woot-reviews.js B094T2BZCK [max|basic|full]
 */

const https = require('https');
const fs = require('fs');

const SORT_ORDERS = ['recent', 'helpful', 'oldest'];
const STAR_RATINGS = ['five_star', 'four_star', 'three_star', 'two_star', 'one_star'];

const MODE_LIMITS = { basic: 100, full: 500, max: 700 };
const MODE = process.argv[3] || 'max';
const MAX_REVIEWS = MODE_LIMITS[MODE] || 500;

function fetchReviews(asin, sort, star) {
  return new Promise((resolve, reject) => {
    const url = `https://www.woot.com/Reviews/${asin}?sortBy=${sort}&filterByStar=${star}`;
    
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      },
      timeout: 15000
    };

    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.reviews || []);
        } catch (e) {
          resolve([]);
        }
      });
    }).on('error', reject).setTimeout(15000, () => {
      reject(new Error('Timeout'));
    });
  });
}

async function scrape(asin) {
  console.error(`Scraping ${asin} (mode: ${MODE}, max: ${MAX_REVIEWS})...`);
  
  const allReviews = [];
  const seenIds = new Set();

  for (const sort of SORT_ORDERS) {
    if (allReviews.length >= MAX_REVIEWS) break;
    
    for (const star of STAR_RATINGS) {
      if (allReviews.length >= MAX_REVIEWS) break;
      
      console.error(`  Fetching ${sort}/${star}...`);
      
      try {
        const reviews = await fetchReviews(asin, sort, star);
        
        for (const r of reviews) {
          const id = r.Id || r.reviewId;
          if (id && !seenIds.has(id)) {
            seenIds.add(id);
            allReviews.push(r);
          }
        }
        
        console.error(`    Got ${reviews.length} reviews (total: ${allReviews.length})`);
      } catch (e) {
        console.error(`    Error: ${e.message}`);
      }
      
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return allReviews.slice(0, MAX_REVIEWS);
}

async function main() {
  const asin = process.argv[2];
  if (!asin) {
    console.error('Usage: node woot-reviews.js B094T2BZCK [max|basic|full]');
    process.exit(1);
  }

  const reviews = await scrape(asin);
  
  const output = {
    asin,
    mode: MODE,
    total_reviews: reviews.length,
    reviews
  };
  
  console.log(JSON.stringify(output, null, 2));
}

main().catch(console.error);
