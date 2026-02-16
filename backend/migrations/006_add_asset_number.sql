ALTER TABLE audit_answers
  ADD COLUMN IF NOT EXISTS asset_number INTEGER;

UPDATE audit_answers
SET asset_number = 1
WHERE asset_number IS NULL;

ALTER TABLE audit_answers
  ALTER COLUMN asset_number SET DEFAULT 1;

ALTER TABLE audit_answers
  DROP CONSTRAINT IF EXISTS audit_answers_tenant_id_audit_plan_id_question_index_key;

DROP INDEX IF EXISTS audit_answers_tenant_id_audit_plan_id_question_index_key;

CREATE UNIQUE INDEX IF NOT EXISTS audit_answers_unique_asset
  ON audit_answers (tenant_id, audit_plan_id, asset_number, question_index);
