# History Table Patch — Apply After Phase 1 Finishes

## What changes in human-bsr.js

Replace the `upsertProducts` function (lines 64–80) with the version below.
It does TWO things per scrape:
1. Upserts `dovive_research` (current snapshot — same as before)
2. Inserts a new row into `dovive_history` (timestamped log — never overwrites)

## Replacement function

```js
async function upsertProducts(products) {
  if (!products.length) return;

  // 1. Upsert into dovive_research (always latest snapshot)
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/dovive_research?on_conflict=asin,keyword`,
    {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(products),
    }
  );
  if (!res.ok) throw new Error(`Upsert failed: ${res.status} ${await res.text()}`);

  // 2. Insert into dovive_history (append-only trend log)
  const historyRows = products.map(p => ({
    asin:          p.asin,
    keyword:       p.keyword,
    title:         p.title,
    brand:         p.brand,
    price:         p.price,
    bsr:           p.bsr,
    rating:        p.rating,
    review_count:  p.review_count,
    rank_position: p.rank_position,
    is_sponsored:  p.is_sponsored,
    category:      p.category,
    source:        p.source,
    scraped_at:    new Date().toISOString(),
  }));

  const res2 = await fetch(
    `${SUPABASE_URL}/rest/v1/dovive_history`,
    {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(historyRows),
    }
  );
  if (!res2.ok) console.warn(`History insert warning: ${res2.status} ${await res2.text()}`);
}
```

## Steps to apply

1. Run the migration: `node migrations/create-history-table.js`
2. Paste the replacement function into `human-bsr.js` (lines 64–80)
3. Test with a small keyword first

## Result

- `dovive_research` = always current state (fast lookups, no duplicates)
- `dovive_history` = every scrape timestamped (BSR trends, price history)
