-- New server-created uploads only. No historical provenance backfill.
CREATE TABLE uploaded_contract_document_identities (
 id TEXT PRIMARY KEY, document_id TEXT NOT NULL UNIQUE REFERENCES contract_documents(id) ON DELETE RESTRICT,
 contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
 customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
 branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
 producer_kind TEXT NOT NULL CHECK (producer_kind IN ('MANAGED_SOURCE','LEGACY_CURRENT_ROLE')),
 creation_company TEXT,
 CONSTRAINT uploaded_contract_document_producer_company CHECK (
  (producer_kind='MANAGED_SOURCE' AND creation_company IS NOT NULL AND creation_company IN ('SHOP','FINANCE')) OR
  (producer_kind='LEGACY_CURRENT_ROLE' AND creation_company IS NULL)
 ),
 mime_type TEXT NOT NULL CHECK (mime_type IN ('application/pdf','image/png','image/jpeg','image/gif','image/webp')),
 file_size INTEGER NOT NULL CHECK(file_size>0 AND file_size<=10485760),
 file_hash TEXT NOT NULL CHECK(file_hash ~ '^[0-9a-f]{64}$'),
 inline_value_hash TEXT NOT NULL CHECK(inline_value_hash ~ '^[0-9a-f]{64}$'),
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE FUNCTION immutable_uploaded_contract_document_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Uploaded contract document identity is immutable' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER uploaded_contract_document_identity_immutable BEFORE UPDATE OR DELETE ON uploaded_contract_document_identities
 FOR EACH ROW EXECUTE FUNCTION immutable_uploaded_contract_document_identity();
