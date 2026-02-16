ALTER TABLE response_types
  ADD COLUMN IF NOT EXISTS negative_types JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS audit_answers (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id),
  audit_plan_id BIGINT NOT NULL REFERENCES audit_plans(id),
  question_index INT NOT NULL,
  question_text TEXT NOT NULL,
  response TEXT,
  response_is_negative BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_nc TEXT,
  note TEXT,
  evidence_name TEXT,
  status TEXT NOT NULL DEFAULT 'Saved',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, audit_plan_id, question_index)
);

CREATE TABLE IF NOT EXISTS nc_actions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id),
  audit_answer_id BIGINT NOT NULL REFERENCES audit_answers(id) ON DELETE CASCADE,
  root_cause TEXT,
  containment_action TEXT,
  corrective_action TEXT,
  preventive_action TEXT,
  evidence_name TEXT,
  status TEXT NOT NULL DEFAULT 'Assigned',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, audit_answer_id)
);

ALTER TABLE nc_actions
  ALTER COLUMN status SET DEFAULT 'Assigned';
