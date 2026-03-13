/**
 * patch-p9-p5-packaging.js
 * Injects P5 deep research + full P8 packaging intelligence sections into the prompt
 * in phase8-formula-brief.js (already has the data compilation — just needs prompt injection)
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'phase8-formula-brief.js');
let src = fs.readFileSync(FILE, 'utf8');

// ── 1. Inject P5 + packaging sections into the prompt body ──────────────────
// Find the spot right after the marketIntelSection and before the TOP 20 section
const TOP20_MARKER = '## \uD83C\uDFC6 TOP 20 COMPETITOR FORMULA DECONSTRUCTION';
const TOP20_MARKER2 = 'TOP 20 COMPETITOR FORMULA DECONSTRUCTION';

if (!src.includes('p5Section') || !src.includes('packagingSection')) {
  console.error('ERROR: p5Section or packagingSection variables not found in file. Run the main patch first.');
  process.exit(1);
}

// Check if already patched
if (src.includes('P5 DEEP RESEARCH') || src.includes('P5 Deep Research — AI')) {
  console.log('✅ Already patched — P5 section already in prompt. Skipping.');
} else {
  // Find the TOP 20 marker and inject before it
  const idx = src.indexOf(TOP20_MARKER2);
  if (idx === -1) {
    console.error('Could not find TOP 20 marker. Check file manually.');
    process.exit(1);
  }
  // Find the line start before this marker (going backwards to find the `##` line)
  const insertAt = src.lastIndexOf('##', idx);
  
  const p5Inject = `## \u{1F52C} P5 DEEP RESEARCH \u2014 AI ANALYSIS OF TOP BSR + NEW WINNERS
Per-product deep research covering formula advantages, weaknesses, and market gaps.
USE THIS to understand WHY top products win and where to attack.

\${p5Section}

---

`;
  src = src.slice(0, insertAt) + p5Inject + src.slice(insertAt);
  console.log('✅ P5 section injected into prompt');
}

// ── 2. Inject packaging intelligence after claims analysis ──────────────────
if (src.includes('PACKAGING INTELLIGENCE') && src.includes('packagingSection')) {
  console.log('✅ Packaging section already in prompt. Skipping.');
} else {
  // Inject after the claims analysis section and before the YOUR DELIVERABLE section
  const CLAIMS_AFTER = '## YOUR DELIVERABLE: FORMULA SPECIFICATION FOR CONTRACT MANUFACTURER';
  const claimsIdx = src.indexOf(CLAIMS_AFTER);
  if (claimsIdx === -1) {
    console.log('⚠️ Could not find YOUR DELIVERABLE marker. Appending packaging near claims.');
  } else {
    const pkgInject = `---

## \u{1F4E6} P8 PACKAGING INTELLIGENCE
These are insights from analyzing packaging across all ${'{cs.total_products}'} competitor products.
USE THESE to design DOVIVE packaging that stands out and exploits gaps.

\${packagingSection}

---

`;
    src = src.slice(0, claimsIdx) + pkgInject + src.slice(claimsIdx);
    console.log('✅ Packaging intelligence section injected into prompt');
  }
}

fs.writeFileSync(FILE, src, 'utf8');
console.log('✅ phase8-formula-brief.js patched successfully');
