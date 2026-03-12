#!/usr/bin/env node
/**
 * add-to-queue.js — Add a keyword to the Scout pipeline queue
 * Usage: node add-to-queue.js "collagen gummies"
 *        node add-to-queue.js "vitamin c gummies" "creatine gummies"
 */
const fs = require('fs');
const path = require('path');

const QUEUE_FILE = path.join(__dirname, 'pipeline-queue.json');

const keywords = process.argv.slice(2);
if (!keywords.length) {
  console.error('Usage: node add-to-queue.js "keyword1" "keyword2" ...');
  process.exit(1);
}

let queue = [];
if (fs.existsSync(QUEUE_FILE)) {
  try { queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')); } catch {}
}

let added = 0;
for (const kw of keywords) {
  if (queue.includes(kw)) {
    console.log(`⚠  Already in queue: "${kw}"`);
  } else {
    queue.push(kw);
    console.log(`✅ Added to queue: "${kw}"`);
    added++;
  }
}

fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
console.log(`\nQueue now has ${queue.length} keyword(s):`);
queue.forEach((k, i) => console.log(`  ${i + 1}. ${k}`));
