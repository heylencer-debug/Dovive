const fs = require('fs');
const file = require('path').join(__dirname, 'phase9-formula-qa.js');
let c = fs.readFileSync(file, 'utf8');
const lines = c.split('\n');

// Find both blocks and remove the second (lines 719-727, 0-indexed)
const occurrences = lines.reduce((acc, l, i) => l.includes('Formula Validator') ? [...acc, i] : acc, []);
console.log('Formula Validator occurrences at (0-indexed):', occurrences);

if (occurrences.length >= 2) {
  // Remove second block — lines 719 to 728 (0-indexed)
  const removeStart = occurrences[1] - 1; // blank line before
  const removeEnd = occurrences[1] + 8;   // 8 lines of the block
  console.log('Removing 0-indexed lines', removeStart, 'to', removeEnd);
  lines.splice(removeStart, removeEnd - removeStart + 1);
}

c = lines.join('\n');
fs.writeFileSync(file, c, 'utf8');
require('child_process').execSync(`node -c "${file}"`, { stdio: 'pipe' });
console.log('Syntax OK — duplicate removed');
