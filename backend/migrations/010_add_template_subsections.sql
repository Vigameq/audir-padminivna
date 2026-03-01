ALTER TABLE audit_templates
ADD COLUMN IF NOT EXISTS subsections JSONB NOT NULL DEFAULT '[]'::jsonb;
