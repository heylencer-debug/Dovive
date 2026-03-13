const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, 'phase8-formula-brief.js');
let src = fs.readFileSync(FILE, 'utf8');

if (src.includes('P8 PACKAGING INTELLIGENCE')) {
  console.log('Already patched. Skipping.');
  process.exit(0);
}

const claimsMarker = '${claimsAnalysis}';
const idx = src.indexOf(claimsMarker);
if (idx === -1) { console.error('claimsAnalysis marker not found'); process.exit(1); }

const insertAfter = idx + claimsMarker.length;
const pkgInject = `

---

## \u{1F4E6} P8 PACKAGING INTELLIGENCE \u2014 EXPLOIT THESE GAPS
AI analysis of competitor packaging. Use to design DOVIVE packaging that stands out and captures whitespace.

\${packagingSection}`;

src = src.slice(0, insertAfter) + pkgInject + src.slice(insertAfter);
fs.writeFileSync(FILE, src, 'utf8');
console.log('P8 packaging section injected at position:', insertAfter);
