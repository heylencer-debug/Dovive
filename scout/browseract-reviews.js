/**
 * browseract-reviews.js - Node.js version of BrowserAct Amazon Reviews scraper
 * Uses BrowserAct API to get Amazon reviews
 * 
 * Usage: node browseract-reviews.js <ASIN>
 */

const https = require('https');

const API_KEY = process.argv[3] || 'app-d8qwxsuRtsFYCFVmb88k1BsJ';
const TEMPLATE_ID = '77817507798321724';
const API_BASE = 'api.browseract.com';

const ASIN = process.argv[2] || 'B094T2BZCK';

function request(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: API_BASE,
      port: 443,
      method: method,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve(body);
        }
      });
    });

    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function runReviewsTask(asin) {
  console.log(`Starting BrowserAct task for ASIN: ${asin}`);
  
  // 1. Start Task - use correct endpoint
  const startRes = await request('POST', '/v2/workflow/run-task', {
    workflow_id: TEMPLATE_ID,
    input: [asin]
  });

  if (!startRes.id) {
    console.error('Error starting task:', startRes);
    return;
  }

  const taskId = startRes.id;
  console.log(`Task started. ID: ${taskId}`);

  // 2. Poll for Completion
  while (true) {
    await new Promise(r => setTimeout(r, 10000)); // 10 second delay
    
    const statusRes = await request('GET', `/v2/workflow/get-task-status?task_id=${taskId}`);
    const status = statusRes.status;
    
    console.log(`[${new Date().toLocaleTimeString()}] Status: ${status}`);
    
    if (status === 'finished') {
      console.log('Task finished!');
      break;
    } else if (status === 'failed' || status === 'canceled') {
      console.error(`Task ${status}. Check BrowserAct dashboard.`);
      return;
    }
  }

  // 3. Get Results
  const taskResult = await request('GET', `/v2/workflow/get-task?task_id=${taskId}`);
  const output = taskResult.output?.string;
  
  if (!output) {
    console.log('No output returned');
    return [];
  }
  
  let reviews = [];
  try {
    reviews = JSON.parse(output);
    console.log(`Got ${reviews.length} reviews`);
  } catch (e) {
    console.log('Failed to parse reviews:', e.message);
    return [];
  }
  
  // Save to Supabase
  const { createClient } = require('@supabase/supabase-js');
  require('dotenv').config();
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  
  const rows = reviews.map(r => ({
    asin: ASIN,
    keyword: null,
    reviewer_name: r.Commentator,
    rating: r.Rating,
    title: r.reviewTitle,
    body: r.review_Description,
    review_date: r.Published_at,
    verified_purchase: r.Is_Verified,
    helpful_votes: 0,
    scraped_at: new Date().toISOString(),
  }));
  
  const { error } = await supabase.from('dovive_reviews').insert(rows);
  if (error) {
    console.error('Save error:', error.message);
  } else {
    console.log(`Saved ${rows.length} reviews to dovive_reviews`);
  }
  
  return reviews;
}

runReviewsTask(ASIN).catch(console.error);
