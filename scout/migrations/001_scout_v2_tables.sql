-- Scout V2 Migration: New Tables for Product Types, Reviews, and Specs
-- Run this SQL in your Supabase SQL editor or via pg client

-- Enhanced products table (expands dovive_research)
CREATE TABLE IF NOT EXISTS dovive_products (
  id bigint generated always as identity primary key,
  asin text NOT NULL,
  keyword text NOT NULL,
  product_type text,
  title text,
  brand text,
  price numeric,
  price_text text,
  bsr integer,
  bsr_category text,
  rating numeric,
  review_count integer,
  images jsonb DEFAULT '[]',
  features jsonb DEFAULT '[]',
  is_sponsored boolean DEFAULT false,
  is_prime boolean DEFAULT false,
  url text,
  rank_position integer,
  search_query text,
  scraped_at timestamptz DEFAULT now(),
  UNIQUE(asin, keyword)
);

-- Full reviews table
CREATE TABLE IF NOT EXISTS dovive_reviews (
  id bigint generated always as identity primary key,
  asin text NOT NULL,
  keyword text,
  reviewer_name text,
  rating numeric,
  title text,
  body text,
  review_date date,
  verified_purchase boolean DEFAULT false,
  helpful_votes integer DEFAULT 0,
  scraped_at timestamptz DEFAULT now()
);

-- Product specifications table
CREATE TABLE IF NOT EXISTS dovive_specs (
  id bigint generated always as identity primary key,
  asin text UNIQUE NOT NULL,
  keyword text,
  item_form text,
  unit_count text,
  flavor text,
  primary_ingredient text,
  weight text,
  dimensions text,
  diet_type text,
  allergen_info text,
  country_of_origin text,
  manufacturer text,
  ingredients text,
  certifications jsonb DEFAULT '[]',
  all_specs jsonb DEFAULT '{}',
  scraped_at timestamptz DEFAULT now()
);

-- Add progress tracking columns to dovive_jobs
ALTER TABLE dovive_jobs ADD COLUMN IF NOT EXISTS current_keyword text;
ALTER TABLE dovive_jobs ADD COLUMN IF NOT EXISTS current_product_type text;
ALTER TABLE dovive_jobs ADD COLUMN IF NOT EXISTS products_scraped integer DEFAULT 0;
ALTER TABLE dovive_jobs ADD COLUMN IF NOT EXISTS reviews_scraped integer DEFAULT 0;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_dovive_products_keyword ON dovive_products(keyword);
CREATE INDEX IF NOT EXISTS idx_dovive_products_asin ON dovive_products(asin);
CREATE INDEX IF NOT EXISTS idx_dovive_products_product_type ON dovive_products(product_type);
CREATE INDEX IF NOT EXISTS idx_dovive_reviews_asin ON dovive_reviews(asin);
CREATE INDEX IF NOT EXISTS idx_dovive_specs_asin ON dovive_specs(asin);

-- RLS policies
ALTER TABLE dovive_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE dovive_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE dovive_specs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "anon_all_products" ON dovive_products;
DROP POLICY IF EXISTS "anon_all_reviews" ON dovive_reviews;
DROP POLICY IF EXISTS "anon_all_specs" ON dovive_specs;

-- Create RLS policies for anonymous access
CREATE POLICY "anon_all_products" ON dovive_products FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_reviews" ON dovive_reviews FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_specs" ON dovive_specs FOR ALL TO anon USING (true) WITH CHECK (true);
