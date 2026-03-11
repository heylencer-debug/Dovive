const fs = require('fs');
const filepath = 'C:/Users/Carl Rebadomia/.openclaw/workspace/dovive/scout/phase9-formula-qa.js';
const content = fs.readFileSync(filepath, 'utf8');
const lines = content.split('\n');

// Keep only up to the closing brace of run() (line index 414, line number 415)
const keep = lines.slice(0, 415);

const runner = [
  '',
  'run()',
  '  .then(() => setTimeout(() => process.exit(0), 500))',
  '  .catch(function(e) {',
  '    console.error(e.message);',
  '    setTimeout(() => process.exit(1), 500);',
  '  });'
];

const result = keep.concat(runner).join('\n');
fs.writeFileSync(filepath, result, 'utf8');
console.log('Done. Total lines:', keep.length + runner.length);
