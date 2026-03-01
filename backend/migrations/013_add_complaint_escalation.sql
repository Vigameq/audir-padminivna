ALTER TABLE complaints
  ADD COLUMN IF NOT EXISTS target_close_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalation_level INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS escalation_status TEXT NOT NULL DEFAULT 'None',
  ADD COLUMN IF NOT EXISTS last_escalated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalation_owner TEXT,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS complaint_escalation_rules (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  complaint_type TEXT NOT NULL,
  category TEXT NOT NULL,
  level INT NOT NULL,
  threshold_hours INT NOT NULL,
  notify_role TEXT NOT NULL DEFAULT 'Manager',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, complaint_type, category, level)
);

CREATE TABLE IF NOT EXISTS complaint_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  complaint_id BIGINT NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  message TEXT,
  old_data JSONB,
  new_data JSONB,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_complaints_tenant_status_escalation
  ON complaints (tenant_id, status, escalation_level, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_complaint_events_tenant_complaint
  ON complaint_events (tenant_id, complaint_id, created_at DESC);

INSERT INTO complaint_escalation_rules
  (tenant_id, complaint_type, category, level, threshold_hours, notify_role)
SELECT t.id, r.complaint_type, r.category, r.level, r.threshold_hours, 'Manager'
FROM tenants t
CROSS JOIN (
  VALUES
    ('Customer', 'Inprocess', 1, 48),
    ('Customer', 'Inprocess', 2, 72),
    ('Customer', 'Inprocess', 3, 120),
    ('Customer', 'Supplier', 1, 48),
    ('Customer', 'Supplier', 2, 72),
    ('Customer', 'Supplier', 3, 120),
    ('Internal', 'Inprocess', 1, 72),
    ('Internal', 'Inprocess', 2, 120),
    ('Internal', 'Inprocess', 3, 168),
    ('Internal', 'Supplier', 1, 72),
    ('Internal', 'Supplier', 2, 120),
    ('Internal', 'Supplier', 3, 168)
) AS r(complaint_type, category, level, threshold_hours)
ON CONFLICT (tenant_id, complaint_type, category, level) DO NOTHING;
