# Dashboard Integration Plan — supplement-scope-dash × Scout Phases
> Generated: 2026-03-10 03:30 AM | Status: PLANNING → IMPLEMENTATION

---

## Current Dashboard Audit

### Two Tabs
- **Tab 1: Products Analysis** — 10 sections (most n8n-dependent)
- **Tab 2: Market Analysis** — 8 sections (added by tidal-coral, Scout-computed ✅)

### Section Status

| Section | Current Source | Scout Data Available | Action |
|---|---|---|---|
| HeroHeader | `category_analyses` (n8n AI) | P1: product count, top images | SIMPLIFY — show computed stats |
| Formula Version Selector | `formula_brief_versions` (n8n) | None | **REMOVE** |
| n8n Progress Banner | n8n analysis phases | None | **REMOVE** (or replace w/ Scout status) |
| KPI Metrics Grid | AI: profitMargin, riskScore | P2: revenue, P1: brandCount | **RECOMPUTE from Scout** |
| EnhancedBenchmarkComparison | AI analysis + top products | P1/P2: top BSR products | **REPLACE** w/ top competitors table |
| Brand Market Share | `monthly_revenue` (not populated) | P2: `monthly_sales_est × price` | **WIRE UP** P2 revenue |
| LowConfidenceProducts | `ocr_confidence` | P4: `ocr_extracted` | Keep (shows OCR quality) |
| PackagingIntelligence | n8n AI analysis | P4: `claims_on_label` | **REMOVE** (no AI, sparse OCR) |
| DeepDiveSection (18-pt) | n8n AI | None | **REMOVE** |
| CustomerIntelligence | n8n AI `customer_insights` | P3: `review_analysis` JSON | **REPLACE** or hide if empty |
| FinancialProjections | n8n AI financials | P2: monthly_sales_est | **REPLACE** w/ computed projections |
| LaunchPlanSection | n8n AI go_to_market | None | **REMOVE** |
| RiskAnalysis | n8n AI risks | None | **REMOVE** |
| Market Analysis tab | Scout-computed (tidal-coral) | ✅ All from P1/P2 | **KEEP + ENHANCE** |

### ProductDetailModal Tabs (tidal-coral additions)
| Tab | Status | Data |
|---|---|---|
| Overview | ✅ Working | P1: title/brand/price/rating/reviews/BSR |
| Formula | ✅ Working | P4: supplement_facts_raw, all_nutrients |
| Keepa | ⚠️ Partial | P2: bsr_current ✅, bsr_30/90 day history (check) |
| Reviews | ❌ Empty | P3: review_analysis not yet wired up |

### Pages
| Page | Status | Action |
|---|---|---|
| Dashboard | Current focus | See above |
| NewAnalysis | n8n WEBHOOK_URL hardcoded | **REPLACE** with keyword selector from DB |
| ProductExplorer | Good — uses products data | Keep + minor improvements |
| AddProduct | Manual ASIN add | Keep |
| MarketTrend | n8n edge function | **REPLACE** with redirect to Market Analysis tab |
| StrategyBrief | n8n AI | **STUB** with "powered by Scout data coming soon" |

---

## Implementation Plan (Priority Order)

### Phase A — Dashboard Cleanup (Remove n8n clutter)
1. **REMOVE** Formula Version Selector block (lines ~555-585 in Dashboard.tsx)
2. **REMOVE** Version History Timeline block
3. **REMOVE** Version Comparison View block  
4. **REMOVE** n8n Progress Banner block
5. **REMOVE** `DeepDiveSection` component from Products tab
6. **REMOVE** `PackagingIntelligence` component
7. **REMOVE** `LaunchPlanSection` component
8. **REMOVE** `RiskAnalysis` component
9. **REMOVE** `FinancialProjections` component (replace with computed version)

### Phase B — Wire Up Scout Data
1. **KPIMetricsGrid** — replace 4 KPI values:
   - Market Size: `sum(p.monthly_sales_est * p.price)` from P2 data
   - Avg BSR Leader: lowest BSR in category
   - Brand Count: `uniqueBrands` (already computed) ✅
   - Avg Price: compute from products
   
2. **Brand Market Share** — wire up `monthly_revenue`:
   - Add computed field: `monthly_revenue = monthly_sales_est * price`
   - Already in `brandMarketShare` useMemo — just needs data
   
3. **EnhancedBenchmarkComparison** → **Replace** with `TopCompetitorsTable`:
   - Simple table: top 10 by BSR
   - Columns: Rank, ASIN, Brand, Title, BSR, Price, Rating, Reviews, Monthly Sales Est
   - Source: `products` where `category_id = selectedCategory`, order by `bsr_current ASC`

4. **CustomerIntelligence** — check if `review_analysis` JSON has data:
   - Show if populated (pain points, positive themes, sentiment)
   - Hide with "Awaiting P3 review scraping" if empty

5. **HeroHeader** — replace AI fields with computed:
   - `opportunityIndex` = computed score from avg BSR + product count
   - Remove `recommendation` and `executiveSummary` (AI-only)

### Phase C — ProductDetailModal Reviews Tab
- Wire `review_analysis` JSON column to Reviews tab
- Show: pain_points, positive_themes, sentiment_distribution
- Fallback: "No review analysis yet for this product"

### Phase D — NewAnalysis Page Rebuild
- Remove n8n WEBHOOK_URL completely
- Replace analysis trigger with: show existing keywords from `categories` table
- Add "Request new keyword research" → triggers Scout P1 (future)
- For now: "Select a keyword to view its analysis" dropdown

### Phase E — Other Pages
- MarketTrend → redirect to Dashboard?category=X&tab=market
- StrategyBrief → stub page with "Phase 5 research powered by Scout"

---

## Data Mapping (Scout → Dashboard)

### Computed Fields Needed

```js
// Monthly Revenue (estimated)
monthly_revenue = monthly_sales_est * price_usd   // P2 × P1

// Market Size
marketSize = products.reduce((s, p) => s + (p.monthly_sales_est ?? 0) * (p.price ?? 0), 0)

// Avg BSR  
avgBSR = avg(products.bsr_current)

// Competition Level (heuristic)
topBrandShare = maxBrandProductCount / totalProducts
competitionLevel = topBrandShare > 0.3 ? "High" : topBrandShare > 0.15 ? "Medium" : "Low"

// Launch Readiness (already in market tab ✅)
launchScore = marketSizeScore + competitionScore + priceScore
```

### Tables Used
| Data | Supabase Table | Columns |
|---|---|---|
| P1 products | `products` | asin, title, brand, price, rating, reviews, bsr_current, image_url, category_id |
| P2 Keepa | `products` | bsr_30_days_avg, bsr_90_days_avg, monthly_sales_est, price_usd |
| P3 Reviews | `products.review_analysis` | JSON: pain_points, positive_themes, sentiment_distribution |
| P4 OCR | `products` | supplement_facts_raw, all_nutrients, serving_size, ocr_extracted |
| P5 Research | `dovive_phase5_research` | NOT YET migrated to supplement-scope-dash |

---

## What's Blocked / Deferred

- **P5 deep research** in dashboard → needs migration to supplement-scope-dash
- **Reviews tab in ProductDetailModal** → needs P3 `review_analysis` populated (run NLP)
- **CustomerVoice component** → needs `nlp_aspects` table populated from P3 scrape
- **n8n AI features** (financial projections with ROI models, 18-pt scoring, packaging AI) → DEFERRED — these are AI analysis jobs that can be re-triggered later against our data

---

## Files to Modify
1. `src/pages/Dashboard.tsx` — major surgery
2. `src/components/dashboard/KPIMetricsGrid.tsx` — new props
3. `src/pages/NewAnalysis.tsx` — remove webhook, show keyword list
4. `src/components/ProductDetailModal.tsx` — wire Reviews tab  
5. NEW: `src/components/dashboard/TopCompetitorsTable.tsx` — replace EnhancedBenchmarkComparison
6. `src/pages/MarketTrend.tsx` — redirect to dashboard market tab
7. `src/pages/StrategyBrief.tsx` — stub page
