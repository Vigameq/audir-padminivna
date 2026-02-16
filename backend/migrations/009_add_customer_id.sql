ALTER TABLE audit_plans
  ADD COLUMN IF NOT EXISTS customer_id TEXT;
