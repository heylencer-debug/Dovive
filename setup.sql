-- Dovive Phase 1: Scout Agent Database Setup
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard/project/fhfqjcvwcxizbioftvdw/sql)

-- Keywords table: stores research keywords
CREATE TABLE IF NOT EXISTS dovive_keywords (
  id bigint generated always as identity primary key,
  keyword text NOT NULL,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Research table: stores scraped product data
CREATE TABLE IF NOT EXISTS dovive_research (
  id bigint generated always as identity primary key,
  keyword text NOT NULL,
  asin text,
  title text,
  price numeric,
  bsr integer,
  rating numeric,
  review_count integer,
  rank_position integer,
  scraped_at timestamptz DEFAULT now()
);

-- Reports table: stores AI-generated market summaries
CREATE TABLE IF NOT EXISTS dovive_reports (
  id bigint generated always as identity primary key,
  keyword text NOT NULL,
  ai_summary text,
  total_products integer,
  avg_price numeric,
  avg_rating numeric,
  avg_reviews integer,
  analyzed_at timestamptz DEFAULT now()
);

-- Jobs table: tracks scout agent jobs
CREATE TABLE IF NOT EXISTS dovive_jobs (
  id bigint generated always as identity primary key,
  status text DEFAULT 'idle',
  triggered_by text DEFAULT 'manual',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE dovive_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE dovive_research ENABLE ROW LEVEL SECURITY;
ALTER TABLE dovive_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE dovive_jobs ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Allow anon read access
CREATE POLICY "anon_read_keywords" ON dovive_keywords FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_research" ON dovive_research FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_reports" ON dovive_reports FOR SELECT TO anon USING (true);
CREATE POLICY "anon_all_jobs" ON dovive_jobs FOR ALL TO anon USING (true) WITH CHECK (true);

-- RLS Policies: Allow anon inserts and updates
CREATE POLICY "anon_insert_keywords" ON dovive_keywords FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_keywords" ON dovive_keywords FOR UPDATE TO anon USING (true);
CREATE POLICY "anon_insert_research" ON dovive_research FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_insert_reports" ON dovive_reports FOR INSERT TO anon WITH CHECK (true);

-- Seed default keywords
INSERT INTO dovive_keywords (keyword) VALUES
  ('lion''s mane supplement'),
  ('berberine supplement'),
  ('collagen peptides'),
  ('ashwagandha supplement'),
  ('magnesium glycinate')
ON CONFLICT DO NOTHING;
