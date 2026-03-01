CREATE TABLE IF NOT EXISTS instruments (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  instrument_type TEXT,
  serial_number TEXT,
  location TEXT,
  owner_department TEXT,
  calibration_frequency_days INT NOT NULL DEFAULT 180,
  last_calibrated_at DATE,
  next_calibration_due DATE,
  status TEXT NOT NULL DEFAULT 'Active',
  remarks TEXT,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);

ALTER TABLE instruments
  ADD CONSTRAINT instruments_status_check
  CHECK (status IN ('Active', 'Inactive', 'Out of Service'));

CREATE TABLE IF NOT EXISTS instrument_calibrations (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  instrument_id BIGINT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  calibration_date DATE NOT NULL,
  calibrated_by TEXT,
  result TEXT NOT NULL DEFAULT 'Pass',
  certificate_no TEXT,
  notes TEXT,
  next_due_date DATE NOT NULL,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE instrument_calibrations
  ADD CONSTRAINT instrument_calibrations_result_check
  CHECK (result IN ('Pass', 'Fail', 'Conditional'));

CREATE INDEX IF NOT EXISTS idx_instruments_tenant_due
  ON instruments (tenant_id, next_calibration_due, status);

CREATE INDEX IF NOT EXISTS idx_calibrations_tenant_instrument
  ON instrument_calibrations (tenant_id, instrument_id, calibration_date DESC);
