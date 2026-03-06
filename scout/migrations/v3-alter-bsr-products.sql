-- Migration: Phase 1 v3
-- Add missing columns to dovive_bsr_products
-- Run this in the Supabase SQL Editor

ALTER TABLE dovive_bsr_products
  ADD COLUMN IF NOT EXISTS brand          text,
  ADD COLUMN IF NOT EXISTS bullet_points  jsonb,
  ADD COLUMN IF NOT EXISTS specifications jsonb,
  ADD COLUMN IF NOT EXISTS images         jsonb,
  ADD COLUMN IF NOT EXISTS format_type    text,
  ADD COLUMN IF NOT EXISTS bsr_rank       integer,
  ADD COLUMN IF NOT EXISTS rating         numeric,
  ADD COLUMN IF NOT EXISTS review_count   integer,
  ADD COLUMN IF NOT EXISTS price          text;

-- Verify columns exist
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'dovive_bsr_products'
ORDER BY ordinal_position;
