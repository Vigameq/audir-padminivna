CREATE TABLE IF NOT EXISTS suppliers (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  status TEXT NOT NULL DEFAULT 'Active',
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);

ALTER TABLE suppliers
  ADD CONSTRAINT suppliers_status_check
  CHECK (status IN ('Active', 'Inactive', 'Blocked'));

CREATE TABLE IF NOT EXISTS supplier_ppap (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  part_no TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'Level 3',
  submission_date DATE,
  approval_status TEXT NOT NULL DEFAULT 'Pending',
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  remarks TEXT,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE supplier_ppap
  ADD CONSTRAINT supplier_ppap_approval_status_check
  CHECK (approval_status IN ('Pending', 'Approved', 'Rejected'));

CREATE TABLE IF NOT EXISTS supplier_performance (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  quality_score NUMERIC(6,2) NOT NULL DEFAULT 0,
  delivery_score NUMERIC(6,2) NOT NULL DEFAULT 0,
  service_score NUMERIC(6,2) NOT NULL DEFAULT 0,
  total_score NUMERIC(6,2) GENERATED ALWAYS AS (
    COALESCE(quality_score,0) + COALESCE(delivery_score,0) + COALESCE(service_score,0)
  ) STORED,
  remarks TEXT,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, supplier_id, period_month)
);

CREATE TABLE IF NOT EXISTS supplier_ppm (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  delivered_qty BIGINT NOT NULL DEFAULT 0,
  defective_qty BIGINT NOT NULL DEFAULT 0,
  ppm NUMERIC(12,2) GENERATED ALWAYS AS (
    CASE WHEN delivered_qty > 0 THEN (defective_qty::numeric * 1000000.0) / delivered_qty::numeric ELSE 0 END
  ) STORED,
  remarks TEXT,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, supplier_id, period_month)
);

CREATE TABLE IF NOT EXISTS supplier_audits (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  audit_date DATE NOT NULL,
  audit_type TEXT,
  auditor_name TEXT,
  score NUMERIC(6,2),
  status TEXT NOT NULL DEFAULT 'Planned',
  findings TEXT,
  action_owner TEXT,
  target_close_date DATE,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE supplier_audits
  ADD CONSTRAINT supplier_audits_status_check
  CHECK (status IN ('Planned', 'In Progress', 'Closed'));

CREATE INDEX IF NOT EXISTS idx_suppliers_tenant_status
  ON suppliers (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_ppap_tenant_supplier
  ON supplier_ppap (tenant_id, supplier_id, submission_date DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_performance_tenant_month
  ON supplier_performance (tenant_id, period_month DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_ppm_tenant_month
  ON supplier_ppm (tenant_id, period_month DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_audits_tenant_date
  ON supplier_audits (tenant_id, audit_date DESC);
