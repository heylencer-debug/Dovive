---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - dovive-scout-workflow.md
  - 2026-03-09-ashwagandha-gummies-phase5.md
  - dovive/docs/app.js (V2.9)
  - Supabase schema: dovive_research, dovive_keepa, dovive_reviews, dovive_ocr
workflowType: 'architecture'
project_name: 'dovive'
user_name: 'Carl Rebadomia'
date: '2026-03-09'
feature: 'Phase 5 — Deep Research Storage & Dashboard Integration'
---

# Architecture Decision Document
## Dovive — Phase 5 Deep Research Feature

---

## 1. Problem Statement

Phase 5 deep research results are currently saved only as markdown files in the vault. They are:
- Not queryable
- Not visible in the dashboard beyond a static badge
- Not structured for future analysis or AI processing
- Not linked to the products already in dovive_research / dovive_keepa

**Goal:** Store Phase 5 research data in Supabase, link it to existing products, and surface it in the dashboard with rich detail.

---

## 2. Architectural Decisions

### AD-01: New Table — `dovive_phase5_research`

**Decision:** Create a dedicated Supabase table for Phase 5 deep research data.

**Rationale:**
- Keeps Phase 5 data separate from scrape data (different lifecycle, different sources)
- ASIN is the natural join key to dovive_research and dovive_keepa
- Structured columns allow dashboard filtering and future AI analysis

**Schema:**
```sql
CREATE TABLE dovive_phase5_research (
  id              bigserial PRIMARY KEY,
  asin            text NOT NULL,
  keyword         text NOT NULL,
  brand           text,
  bsr_rank        integer,

  -- Benefits & Features
  benefits        jsonb,        -- array of strings: key benefits from external sites
  features        jsonb,        -- array of strings: formula features, ingredients
  formula_notes   text,         -- free text about formula composition

  -- Certifications & Awards
  certifications  jsonb,        -- array: ["B Corp", "cGMP", "NSF", "Organic"]
  awards          jsonb,        -- array: any editorial awards or recognitions
  third_party_tested boolean DEFAULT false,
  transparency_flag boolean DEFAULT true,  -- false = COA missing / claims flagged

  -- Community Sentiment
  reddit_sentiment  text,       -- "positive" | "mixed" | "negative" | "none"
  reddit_notes      text,       -- summary of Reddit community comments
  reddit_sources    jsonb,      -- array of subreddit/thread URLs if found

  -- External Reviews
  external_reviews  jsonb,      -- array of {source, rating, summary, url}
  healthline_covered boolean DEFAULT false,
  labdoor_score      text,      -- e.g. "A+" or null if not listed

  -- Competitive Intelligence
  key_weaknesses    text,       -- notable user complaints / product gaps
  key_strengths     text,       -- main differentiators vs competitors
  competitor_angle  text,       -- how Dovive can position against this product

  -- Metadata
  researched_at   timestamptz DEFAULT now(),
  researched_by   text DEFAULT 'scout',
  phase           integer DEFAULT 5,

  UNIQUE(asin, keyword)
);
```

**Indexes:**
```sql
CREATE INDEX idx_p5_keyword ON dovive_phase5_research(keyword);
CREATE INDEX idx_p5_asin    ON dovive_phase5_research(asin);
CREATE INDEX idx_p5_bsr     ON dovive_phase5_research(bsr_rank ASC);
```

---

### AD-02: Script — `phase5-save.js`

**Decision:** Build a dedicated Node.js script that takes research findings and upserts them into `dovive_phase5_research`.

**Location:** `C:\Users\Carl Rebadomia\.openclaw\workspace\dovive\scout\phase5-save.js`

**Input:** Structured JSON object per product (from web_search results)
**Output:** Upserted row in Supabase, confirmation log

**Pattern:** Same as existing scripts — dotenv, @supabase/supabase-js, upsert on (asin, keyword)

---

### AD-03: Script — `phase5-research.js`

**Decision:** Build a semi-automated Phase 5 research script that:
1. Pulls top 10 BSR ASINs for a given keyword from dovive_research
2. For each ASIN, runs structured web searches (benefits, Reddit, external reviews)
3. Saves results to dovive_phase5_research via upsert

**This replaces manual web search + markdown vault storage for future keywords.**

---

### AD-04: Dashboard — Phase 5 Detail Panel

**Decision:** Expand the existing P5 badge into a clickable detail panel in the product expanded view.

**When user expands a P5-badged product:**
- Show: Benefits, Formula Notes, Certifications, Reddit Sentiment, Key Strengths/Weaknesses, Competitor Angle
- Data source: Supabase `dovive_phase5_research` joined on asin

**Implementation:** Add to `loadProductDetails()` in app.js — fetch from Supabase if PHASE5_RESEARCHED_ASINS includes the ASIN.

---

### AD-05: Data Flow

```
web_search results
      ↓
phase5-research.js (structured extraction)
      ↓
dovive_phase5_research (Supabase)
      ↓
Dashboard loadProductDetails() → Phase 5 panel
```

---

## 3. Implementation Plan

### Step 1 — Database (now)
- Create `dovive_phase5_research` table via migration script
- Verify schema in Supabase

### Step 2 — Save Script (now)
- Build `phase5-save.js`
- Test upsert with ashwagandha gummies data already researched

### Step 3 — Research Script (next session)
- Build `phase5-research.js` for automated research runs
- Integrate with web_search

### Step 4 — Dashboard (next session)
- Update `loadProductDetails()` to fetch + display Phase 5 data panel
- Dynamic badge (from Supabase, not hardcoded ASIN list)

---

## 4. Boring Tech Decisions (Intentionally Simple)

| Decision | Choice | Why |
|---|---|---|
| DB | Supabase (existing) | Already connected, no new infra |
| Script lang | Node.js (existing) | Same stack as all other scripts |
| Join key | asin + keyword | Natural unique key already in use |
| Dashboard fetch | Direct Supabase JS client | Already used in sb.js |
| No API layer | Direct DB calls | Small project, no need for abstraction |

---

*Architecture by: Winston (BMAD Architect via Scout)*
*Date: 2026-03-09*
*Status: APPROVED — proceed to implementation*
