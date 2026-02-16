ALTER TABLE audit_plans
  ADD COLUMN IF NOT EXISTS asset_scope JSONB;
