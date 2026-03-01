CREATE TABLE IF NOT EXISTS change_requests (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  request_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  four_m_category TEXT NOT NULL,
  change_reason TEXT,
  impact_assessment TEXT,
  risk_level TEXT NOT NULL DEFAULT 'Medium',
  status TEXT NOT NULL DEFAULT 'Open',
  requested_by TEXT,
  requested_date DATE,
  target_date DATE,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  implemented_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);

ALTER TABLE change_requests
  ADD CONSTRAINT change_requests_request_type_check
  CHECK (request_type IN ('ECR', 'ECN'));

ALTER TABLE change_requests
  ADD CONSTRAINT change_requests_four_m_category_check
  CHECK (four_m_category IN ('Man', 'Machine', 'Method', 'Material'));

ALTER TABLE change_requests
  ADD CONSTRAINT change_requests_risk_level_check
  CHECK (risk_level IN ('Low', 'Medium', 'High', 'Critical'));

ALTER TABLE change_requests
  ADD CONSTRAINT change_requests_status_check
  CHECK (status IN ('Draft', 'Open', 'In Review', 'Approved', 'Implemented', 'Rejected', 'Closed'));

CREATE INDEX IF NOT EXISTS idx_change_requests_tenant_status_created
  ON change_requests (tenant_id, status, created_at DESC);
