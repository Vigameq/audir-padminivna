ALTER TABLE nc_actions
  ADD COLUMN IF NOT EXISTS fishbone_data JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE nc_actions
  ADD COLUMN IF NOT EXISTS why_why_data JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE nc_actions
  ADD COLUMN IF NOT EXISTS gd_summary TEXT;
