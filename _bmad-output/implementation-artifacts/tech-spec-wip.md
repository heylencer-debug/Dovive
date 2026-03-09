---
title: 'OCR Dashboard Fix — Show Raw Text + Re-extract Missing Supplement Facts'
slug: 'ocr-dashboard-fix'
created: '2026-03-09'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['JavaScript (vanilla)', 'Supabase REST', 'Node.js', 'OpenAI GPT-4o']
files_to_modify:
  - 'dovive/docs/app.js'
  - 'dovive/scout/phase4-reprocess.js (new)'
code_patterns:
  - 'sbFetchSimple() for modal data fetching'
  - 'renderOCRTab() for OCR display'
  - 'modalProductData.ocrAll for image array'
  - 'dotenv + @supabase/supabase-js for scripts'
  - 'upsert on (asin, image_index) pattern'
test_patterns: ['manual — open product modal OCR tab, verify count and raw text display']
---

# Tech-Spec: OCR Dashboard Fix — Show Raw Text + Re-extract Missing Supplement Facts

**Created:** 2026-03-09
**Author:** BMAD Quick-Spec (Scout)

---

## Overview

### Problem Statement

The dashboard OCR tab shows "No OCR data yet" for ashwagandha gummies products despite 817 OCR records existing in `dovive_ocr`. The query in `app.js` (line ~1968) filters by `supplement_facts=not.is.null`, which excludes 677 records that have `raw_text` but no structured `supplement_facts`. Only 140/817 ashwagandha rows have `supplement_facts` parsed — so the tab appears empty for most products.

**Numbers:**
- Total dovive_ocr rows: 1,484
- Rows with supplement_facts: 274 (18%)
- Rows with raw_text: 1,484 (100%)
- Ashwagandha gummies total OCR rows: 817
- Ashwagandha with supplement_facts: 140 (17%)
- Ashwagandha missing supplement_facts: 677 (83%)

### Solution

**Track A — Dashboard fix (immediate):**
Remove the `supplement_facts=not.is.null` filter from the modal data query. Update `renderOCRTab()` to gracefully display `raw_text` when `supplement_facts` is null, and always show total images analyzed count.

**Track B — Data fix (background script):**
Build `phase4-reprocess.js` — queries all rows with `raw_text IS NOT NULL AND supplement_facts IS NULL` for a given keyword, re-sends images to GPT-4o for structured extraction, upserts results back to `dovive_ocr`.

### Scope

**In Scope:**
- Fix modal query to remove supplement_facts filter
- Update renderOCRTab() to show raw_text fallback
- Show correct "Images Analyzed" count (all OCR rows, not just parsed ones)
- New script: phase4-reprocess.js for re-extraction of missing supplement_facts

**Out of Scope:**
- Re-scraping images from scratch
- Changing the OCR pipeline (ocr-phase4.js) itself
- Changing Supabase schema

---

## Context for Development

### Codebase Patterns

- Modal data loaded via `Promise.all([sbFetchSimple(...)])` at line ~1961 in app.js
- OCR query currently: `dovive_ocr?asin=eq.{asin}&supplement_facts=not.is.null&order=image_index.asc&limit=10`
- `renderOCRTab()` reads from `modalProductData.ocr` (best record) and `modalProductData.ocrAll` (array)
- `ocr.supplement_facts` is a jsonb array: `[{name, amount, dv_percent}, ...]`
- `ocr.raw_text` is plain string — OCR text extracted from image
- `ocr.health_claims` is jsonb array of strings
- Script pattern: `require('dotenv').config()` → `createClient()` → query → GPT → upsert
- GPT model used in existing pipeline: `gpt-4o`
- Existing OCR script: `dovive/scout/ocr-phase4.js` — reference for GPT prompt structure

### Files to Reference

| File | Purpose |
|------|---------|
| `dovive/docs/app.js` line ~1961 | Modal data fetch — OCR query to fix |
| `dovive/docs/app.js` line ~2137 | renderOCRTab() — display logic to update |
| `dovive/scout/ocr-phase4.js` | Reference for GPT extraction prompt and upsert pattern |
| `dovive/docs/data/sb.js` | Supabase anon key and sbFetch helper |
| `dovive/scout/.env` | SUPABASE_URL, SUPABASE_KEY, OPENAI (from app_settings table) |

### Technical Decisions

- **Remove filter, not replace**: Remove `supplement_facts=not.is.null` entirely — fetch all OCR rows for ASIN. This is correct because we want to show any OCR data we have.
- **Graceful degradation in renderOCRTab()**: If supplement_facts is null but raw_text exists, show raw_text in a "Raw OCR Text" section. Don't block the tab.
- **Images Analyzed count**: Use `ocrAll.length` (already in template) — will now reflect true count since filter removed.
- **phase4-reprocess.js**: Pull rows per keyword where `raw_text IS NOT NULL AND supplement_facts IS NULL`, batch through GPT-4o with same prompt as ocr-phase4.js, upsert result. Include rate limiting (1 req/sec).

---

## Implementation Plan

### Tasks

- [ ] Task 1: Fix modal OCR query in app.js
  - File: `dovive/docs/app.js` line ~1968
  - Action: Change `sbFetchSimple('dovive_ocr?asin=eq.' + asin + '&supplement_facts=not.is.null&order=image_index.asc&limit=10')` to `sbFetchSimple('dovive_ocr?asin=eq.' + asin + '&raw_text=not.is.null&order=image_index.asc&limit=20')`
  - Notes: Increase limit to 20 to cover more images per product

- [ ] Task 2: Update renderOCRTab() to handle null supplement_facts
  - File: `dovive/docs/app.js` line ~2137 renderOCRTab()
  - Action: After the supplement facts table block, add a "Raw OCR Text" fallback section that shows `ocrAll` records with raw_text when supplement_facts is null. Show health_claims if available even without supplement_facts.
  - Notes: Show raw text in a styled pre/code block. Label it "Raw OCR Text (structured extraction pending)"

- [ ] Task 3: Build phase4-reprocess.js
  - File: `dovive/scout/phase4-reprocess.js` (new)
  - Action: Query `dovive_ocr` for rows where `keyword = <arg>` AND `raw_text IS NOT NULL` AND `supplement_facts IS NULL`. For each, call GPT-4o with the same structured extraction prompt from ocr-phase4.js. Upsert result. Log progress.
  - Notes: Accept keyword as CLI arg. Rate limit 1 req/sec. Skip rows with no raw_text.

- [ ] Task 4: Deploy dashboard fix to GitHub Pages
  - File: `dovive/docs/app.js`, `dovive/docs/style.css` (if needed)
  - Action: `git add`, `git commit`, `git push`

### Acceptance Criteria

- [ ] AC 1: Given a product with OCR raw_text but no supplement_facts, when user opens the OCR tab in the modal, then the tab shows the raw text and health claims instead of "No OCR data yet"
- [ ] AC 2: Given any product with OCR data, when the modal loads, then "Images Analyzed" shows the correct count of all OCR rows (not just parsed ones)
- [ ] AC 3: Given a product with supplement_facts parsed, when the OCR tab opens, then the Supplement Facts table still renders correctly (no regression)
- [ ] AC 4: Given `node phase4-reprocess.js "ashwagandha gummies"` is run, when complete, then rows with raw_text but null supplement_facts are updated with extracted supplement_facts where possible

---

## Additional Context

### Dependencies
- `dovive_ocr` table — existing, no schema changes
- OpenAI API key — fetched from Supabase `app_settings` table (same as ocr-phase4.js)
- GPT-4o model — same as existing pipeline

### Testing Strategy
- Open dashboard → search ashwagandha gummies product → expand modal → OCR tab → verify shows raw text or facts (not empty)
- Run `node phase4-reprocess.js "ashwagandha gummies"` on 1 product first, verify supplement_facts populated

### Notes
- Risk: Some raw_text may be too sparse for GPT to extract supplement_facts (e.g., product front image with no nutrition panel). phase4-reprocess.js should handle gracefully — if GPT returns empty facts, leave supplement_facts null rather than writing empty array.
- Future: Once re-extraction runs, "Images Analyzed" and "Supplement Facts" counts should match more closely.
