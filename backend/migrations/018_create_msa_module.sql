CREATE TABLE IF NOT EXISTS msa_studies (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  instrument_id BIGINT REFERENCES instruments(id) ON DELETE SET NULL,
  study_type TEXT NOT NULL,
  title TEXT NOT NULL,
  characteristic TEXT,
  method TEXT,
  design_type TEXT,
  tolerance_min NUMERIC(18,6),
  tolerance_max NUMERIC(18,6),
  resolution NUMERIC(18,6),
  reference_value NUMERIC(18,6),
  owner_name TEXT,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'Draft',
  review_notes TEXT,
  approved_by BIGINT REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);

ALTER TABLE msa_studies
  ADD CONSTRAINT msa_studies_type_check
  CHECK (study_type IN ('GRR', 'Bias', 'Linearity', 'Stability'));

ALTER TABLE msa_studies
  ADD CONSTRAINT msa_studies_status_check
  CHECK (status IN ('Draft', 'Data Collection', 'Calculated', 'Under Review', 'Approved', 'Rejected', 'Closed'));

CREATE TABLE IF NOT EXISTS msa_grr_design (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  study_id BIGINT NOT NULL REFERENCES msa_studies(id) ON DELETE CASCADE,
  operators_count INT NOT NULL DEFAULT 3,
  parts_count INT NOT NULL DEFAULT 10,
  trials_count INT NOT NULL DEFAULT 2,
  design_type TEXT NOT NULL DEFAULT 'Crossed',
  randomized BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (study_id)
);

ALTER TABLE msa_grr_design
  ADD CONSTRAINT msa_grr_design_type_check
  CHECK (design_type IN ('Crossed', 'Nested'));

CREATE TABLE IF NOT EXISTS msa_measurements (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  study_id BIGINT NOT NULL REFERENCES msa_studies(id) ON DELETE CASCADE,
  operator_name TEXT,
  part_name TEXT,
  trial_no INT,
  measured_value NUMERIC(18,6) NOT NULL,
  reference_value NUMERIC(18,6),
  measured_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS msa_results (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  study_id BIGINT NOT NULL REFERENCES msa_studies(id) ON DELETE CASCADE,
  result_type TEXT NOT NULL,
  metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  pass_fail TEXT NOT NULL DEFAULT 'Conditional',
  recommendation TEXT,
  calculated_by BIGINT REFERENCES users(id),
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by BIGINT REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE msa_results
  ADD CONSTRAINT msa_results_pass_fail_check
  CHECK (pass_fail IN ('Pass', 'Conditional', 'Fail'));

ALTER TABLE msa_results
  ADD CONSTRAINT msa_results_type_check
  CHECK (result_type IN ('GRR', 'Bias', 'Linearity', 'Stability'));

CREATE TABLE IF NOT EXISTS msa_actions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  study_id BIGINT NOT NULL REFERENCES msa_studies(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL DEFAULT 'MSA Failure',
  description TEXT NOT NULL,
  owner_name TEXT,
  target_date DATE,
  status TEXT NOT NULL DEFAULT 'Open',
  linked_nc_id BIGINT,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE msa_actions
  ADD CONSTRAINT msa_actions_status_check
  CHECK (status IN ('Open', 'In Progress', 'Closed'));

CREATE INDEX IF NOT EXISTS idx_msa_studies_tenant_type_status
  ON msa_studies (tenant_id, study_type, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_msa_measurements_tenant_study
  ON msa_measurements (tenant_id, study_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_msa_results_tenant_study
  ON msa_results (tenant_id, study_id, calculated_at DESC);

CREATE INDEX IF NOT EXISTS idx_msa_actions_tenant_study
  ON msa_actions (tenant_id, study_id, status, created_at DESC);
