CREATE TABLE IF NOT EXISTS complaints (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  code TEXT NOT NULL,
  complaint_type TEXT NOT NULL CHECK (complaint_type IN ('Customer', 'Internal')),
  category TEXT NOT NULL CHECK (category IN ('Inprocess', 'Supplier')),
  title TEXT NOT NULL,
  description TEXT,
  source_name TEXT,
  reported_by TEXT,
  complaint_date DATE,
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'In Progress', 'Closed')),
  assigned_to TEXT,
  resolution TEXT,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_complaints_tenant_created
  ON complaints (tenant_id, created_at DESC);
