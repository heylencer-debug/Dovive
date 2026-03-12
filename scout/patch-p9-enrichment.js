/**
 * patch-p9-enrichment.js
 * Patches phase8-formula-brief.js to inject enriched market data sections
 * into the prompt: serving sizes, dosage ranges, price-per-serving,
 * raw reviews, and ingredient sentiment signals.
 * Run once then delete.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'phase8-formula-brief.js');
let src = fs.readFileSync(file, 'utf8');

// 1. Inject new data sections after CATEGORY STATISTICS block
// Find the anchor: "- Average Price Point:" line
const anchor = `- Average Price Point: \${cs.avg_price || 'N/A'}`;
const injection = `- Average Price Point: \${cs.avg_price || 'N/A'}

---

## SERVING SIZE DISTRIBUTION (what the market actually uses)
\${cs.serving_size_distribution || 'Not available'}

---

## PRICE-PER-SERVING ANALYSIS (value benchmark)
\${cs.price_per_serving || 'Not available'}

---

## COMPETITOR INGREDIENT DOSAGE RANGES (from OCR supplement facts)
These are real dosage ranges across all top competitors — min, average, and max per ingredient.
Use these to understand what the market currently uses, and where to position DOVIVE.
\${cs.dosage_ranges || 'OCR data not yet available'}

---

## VOICE OF CUSTOMER — WHAT PEOPLE LOVE (Positive Reviews)
Real customer quotes from top competitor products. Study what outcomes and ingredients they praise.
\${(cs.raw_reviews_positive && cs.raw_reviews_positive.length) ? cs.raw_reviews_positive.join('\\n') : 'Reviews not yet available — run P3 first'}

---

## VOICE OF CUSTOMER — WHAT PEOPLE HATE (Critical Reviews)  
Real 1-2 star reviews. Study what problems your formula must solve.
\${(cs.raw_reviews_negative && cs.raw_reviews_negative.length) ? cs.raw_reviews_negative.join('\\n') : 'Reviews not yet available'}

---

## INGREDIENT REVIEW SENTIMENT
Ingredients customers PRAISE: \${cs.positive_ingredient_signals || 'Insufficient data'}
Ingredients customers CRITICIZE: \${cs.negative_ingredient_signals || 'None flagged'}`;

if (!src.includes(anchor)) {
  console.error('ERROR: Anchor not found. File may have been modified.');
  process.exit(1);
}

if (src.includes('SERVING SIZE DISTRIBUTION')) {
  console.log('Patch already applied — skipping.');
  process.exit(0);
}

src = src.replace(anchor, injection);
fs.writeFileSync(file, src, 'utf8');
console.log('✅ phase8-formula-brief.js patched — enriched market data sections injected into prompt');
