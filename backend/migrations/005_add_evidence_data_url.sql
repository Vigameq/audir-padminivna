ALTER TABLE audit_answers
  ADD COLUMN IF NOT EXISTS evidence_data_url TEXT;
