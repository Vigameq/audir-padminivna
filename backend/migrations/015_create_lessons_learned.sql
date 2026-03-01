CREATE TABLE IF NOT EXISTS lessons_learned (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  problem_statement TEXT,
  root_cause TEXT,
  what_worked TEXT,
  what_failed TEXT,
  preventive_recommendation TEXT,
  standardization_action TEXT,
  source_type TEXT NOT NULL DEFAULT 'Manual',
  source_ref TEXT,
  category TEXT,
  department TEXT,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_level TEXT NOT NULL DEFAULT 'Medium',
  applicability TEXT NOT NULL DEFAULT 'Plant',
  status TEXT NOT NULL DEFAULT 'Draft',
  owner_id BIGINT REFERENCES users(id),
  approved_by BIGINT REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  effective_from DATE,
  review_due_at DATE,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);

ALTER TABLE lessons_learned
  ADD CONSTRAINT lessons_source_type_check
  CHECK (source_type IN ('Audit', 'NC', 'Complaint', 'Change', 'Manual'));

ALTER TABLE lessons_learned
  ADD CONSTRAINT lessons_risk_level_check
  CHECK (risk_level IN ('Low', 'Medium', 'High', 'Critical'));

ALTER TABLE lessons_learned
  ADD CONSTRAINT lessons_applicability_check
  CHECK (applicability IN ('Plant', 'Line', 'Product', 'Global'));

ALTER TABLE lessons_learned
  ADD CONSTRAINT lessons_status_check
  CHECK (status IN ('Draft', 'Published', 'Archived'));

CREATE TABLE IF NOT EXISTS lesson_acknowledgements (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lesson_id BIGINT NOT NULL REFERENCES lessons_learned(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, lesson_id, user_id)
);

CREATE TABLE IF NOT EXISTS lesson_attachments (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lesson_id BIGINT NOT NULL REFERENCES lessons_learned(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_key TEXT,
  file_url TEXT,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lesson_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lesson_id BIGINT NOT NULL REFERENCES lessons_learned(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  message TEXT,
  old_data JSONB,
  new_data JSONB,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lessons_tenant_status_created
  ON lessons_learned (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lessons_tenant_source_created
  ON lessons_learned (tenant_id, source_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lesson_ack_tenant_lesson
  ON lesson_acknowledgements (tenant_id, lesson_id, acknowledged_at DESC);
