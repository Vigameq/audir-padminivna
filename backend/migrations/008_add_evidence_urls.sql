ALTER TABLE audit_answers
  ADD COLUMN IF NOT EXISTS evidence_urls JSONB;
