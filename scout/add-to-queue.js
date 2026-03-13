/**
 * add-to-queue.js — Add a keyword to the pm2 pipeline queue
 *
 * Usage:
 *   node add-to-queue.js "vitamin c gummies"
 *   node add-to-queue.js "vitamin c gummies" --from P5
 *   node add-to-queue.js "vitamin c gummies" --from P5 --force
 *   node add-to-queue.js "vitamin c gummies" --force
 *
 * The pm2 scout-pipeline daemon picks it up within 30s and runs it.
 */

const fs = require('fs');
const path = require('path');

const QUEUE_FILE = path.join(__dirname, 'pipeline-queue.json');

const args = process.argv.slice(2);

// First non-flag arg is the keyword
const keyword = args.find(a => !a.startsWith('--'));
if (!keyword) {
  console.error('Usage: node add-to-queue.js "keyword" [--from P5] [--force]');
  process.exit(1);
}

// Parse --from flag
const fromIdx = args.indexOf('--from');
const fromPhase = fromIdx > -1 ? parseInt(args[fromIdx + 1].replace('P', '')) : 1;
const force = args.includes('--force');

// Load existing queue
let queue = [];
if (fs.existsSync(QUEUE_FILE)) {
  try { queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')); }
  catch { queue = []; }
}

// Build entry
const entry = { keyword, fromPhase, force };

// Avoid duplicates
const alreadyQueued = queue.some(e => {
  const k = typeof e === 'string' ? e : e.keyword;
  return k === keyword;
});

if (alreadyQueued) {
  console.log(`⚠️  "${keyword}" already in queue — skipping`);
  process.exit(0);
}

queue.push(entry);
fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));

const fromLabel = fromPhase > 1 ? ` from P${fromPhase}` : '';
const forceLabel = force ? ' (force)' : '';
console.log(`✅ Queued: "${keyword}"${fromLabel}${forceLabel}`);
console.log(`   Queue length: ${queue.length}`);
console.log(`   pm2 scout-pipeline will pick it up within 30s`);
