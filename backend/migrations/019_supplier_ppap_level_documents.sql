CREATE TABLE IF NOT EXISTS supplier_ppap_documents (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ppap_id BIGINT NOT NULL REFERENCES supplier_ppap(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_key TEXT NOT NULL,
  file_url TEXT NOT NULL,
  uploaded_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_ppap_documents_tenant_ppap
  ON supplier_ppap_documents (tenant_id, ppap_id, created_at DESC);
