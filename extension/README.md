# Dovive Scout Extension

Amazon market research scraper for Dovive supplement intelligence.

## Install

1. Open Chrome → `chrome://extensions`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select: `C:\Users\Carl Rebadomia\.openclaw\workspace\dovive\extension\`
5. Pin the extension to toolbar

## Usage

1. Click the Dovive Scout icon in Chrome toolbar
2. Click "Start Scout"
3. Extension opens Amazon tabs automatically
4. Watch progress in the popup
5. Data saves to Supabase `dovive_research` table
6. Dovive dashboard updates automatically

## Features

- **Human-like behavior**: Random delays, natural scrolling, mouse hover simulation
- **Smart extraction**: Skips sponsored products, extracts BSR, ingredients, certifications
- **Auto-save**: Products upserted to Supabase on conflict (asin, keyword)
- **Visual feedback**: Real-time progress, activity log, status indicators

## Notes

- Keep Chrome open while scraping
- Don't close the Scout tabs while running
- Each run scrapes 1 product per keyword (9 keywords = 9 products)
- Extension uses natural click navigation, not direct URL changes

## Data Collected

For each product:
- ASIN, title, brand, price
- Rating, review count
- Main image + gallery images
- Bullet points, description
- Ingredients (extracted from page text)
- Best Sellers Rank (BSR)
- Product specs table
- Certifications (non-gmo, vegan, organic, etc.)

## Troubleshooting

**"No active keywords found"**
- Check that `dovive_keywords` table has rows with `active = true`

**Scraping stops mid-way**
- Amazon might have shown a CAPTCHA
- Manually solve it, then restart scout

**Products not saving**
- Check browser console for Supabase errors
- Verify API key is valid
