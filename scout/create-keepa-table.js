const fetch = require('node-fetch');
const ACCESS_TOKEN = 'sbp_930d9e5fe75da4d2415263ec1d37aaaa8b5aaab7';

const SQL = `
DROP TABLE IF EXISTS dovive_keepa;
CREATE TABLE dovive_keepa (
  id                   bigint generated always as identity primary key,
  asin                 text unique not null,
  title                text,
  brand                text,
  manufacturer         text,
  category             text,
  product_group        text,
  description          text,
  features             jsonb,
  dimensions           jsonb,
  images               jsonb,
  upc                  text,
  ean                  text,
  part_number          text,
  release_date         date,
  listed_since         date,
  price_usd            numeric,
  price_history_30d    jsonb,
  bsr_current          integer,
  bsr_category         text,
  bsr_history_30d      jsonb,
  bsr_history_90d      jsonb,
  bsr_drops_30d        integer,
  bsr_drops_90d        integer,
  monthly_sales_est    integer,
  monthly_sold_history jsonb,
  rating               numeric,
  review_count         integer,
  buybox_seller        text,
  fulfillment          text,
  availability         text,
  total_offers         integer,
  fba_offers           integer,
  fbm_offers           integer,
  is_sns_eligible      boolean,
  parsed_at            timestamptz default now()
);
`;

fetch('https://api.supabase.com/v1/projects/fhfqjcvwcxizbioftvdw/database/query', {
  method: 'POST',
  headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: SQL })
}).then(r => r.json()).then(d => console.log('Result:', JSON.stringify(d))).catch(console.error);
