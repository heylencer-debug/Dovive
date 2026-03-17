// patch-queue.js — Update elderberry and magnesium queue entries from P6 to P4
const fs = require('fs');
const path = require('path');
const QUEUE_FILE = path.join(__dirname, 'pipeline-queue.json');

let queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
console.log('Before:', JSON.stringify(queue));

queue = queue.map(entry => {
  const kw = (typeof entry === 'string' ? entry : entry.keyword).toLowerCase();
  if (kw === 'elderberry gummies' || kw === 'magnesium gummies') {
    return { keyword: kw, fromPhase: 4, force: true };
  }
  return entry;
});

fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
console.log('After:', JSON.stringify(queue));
