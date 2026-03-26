-- Manufacturer Feedback Table
-- Stores feedback submissions from manufacturers (text + image uploads)
-- Scout phase-living-brief.js reads pending rows, evaluates them, creates new formula_brief_versions

CREATE TABLE IF NOT EXISTS manufacturer_feedback (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  keyword text NOT NULL,
  feedback_text text,
  image_urls jsonb DEFAULT '[]',         -- array of Supabase Storage URLs
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'reviewed', 'dismissed')),
  submitted_at timestamptz DEFAULT now(),
  reviewed_at timestamptz,
  -- Scout response
  claude_verdict text CHECK (claude_verdict IN ('accepted', 'partially_accepted', 'questioned', 'rejected')),
  claude_response text,                  -- full Claude reasoning
  claude_changes jsonb DEFAULT '[]',     -- array of {ingredient, change, reason, verdict}
  resulting_version_id uuid REFERENCES formula_brief_versions(id) ON DELETE SET NULL,
  -- metadata
  submitted_by text DEFAULT 'user',
  notes text
);

CREATE INDEX IF NOT EXISTS idx_manufacturer_feedback_category ON manufacturer_feedback(category_id);
CREATE INDEX IF NOT EXISTS idx_manufacturer_feedback_status ON manufacturer_feedback(status);
CREATE INDEX IF NOT EXISTS idx_manufacturer_feedback_keyword ON manufacturer_feedback(keyword);
