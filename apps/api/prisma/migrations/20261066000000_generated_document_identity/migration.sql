CREATE TABLE generated_document_identities (
 id TEXT PRIMARY KEY, document_id TEXT NOT NULL UNIQUE REFERENCES e_documents(id) ON DELETE RESTRICT,
 contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
 customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
 branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
 producer_kind TEXT NOT NULL, creation_company TEXT,
 operation_token TEXT NOT NULL UNIQUE, storage_key TEXT NOT NULL UNIQUE,
 mime_type TEXT NOT NULL CHECK(mime_type='application/pdf'), file_size INTEGER NOT NULL CHECK(file_size>0 AND file_size<=20971520),
 file_hash TEXT NOT NULL CHECK(file_hash ~ '^[0-9a-f]{64}$'), source_revision TEXT NOT NULL,
 dependency_revision TEXT NOT NULL, document_type TEXT NOT NULL CHECK(document_type IN ('CONTRACT','PDPA_CONSENT')),
 source_complete BOOLEAN NOT NULL, manifest JSONB NOT NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((producer_kind='MANAGED_SOURCE' AND creation_company IS NOT NULL AND creation_company IN ('SHOP','FINANCE')) OR (producer_kind='LEGACY_CURRENT_ROLE' AND creation_company IS NULL))
);
CREATE TABLE generated_contract_document_links (
 id TEXT PRIMARY KEY, document_id TEXT NOT NULL UNIQUE REFERENCES contract_documents(id) ON DELETE RESTRICT,
 identity_id TEXT NOT NULL REFERENCES generated_document_identities(id) ON DELETE RESTRICT,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE signed_document_production_events (
 id TEXT PRIMARY KEY, contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
 source_revision TEXT NOT NULL CHECK(source_revision ~ '^[0-9a-f]{64}$'), signature_ids TEXT[] NOT NULL,
 producer_kind TEXT NOT NULL CHECK(producer_kind='CANONICAL_SIGNATURE_COMPLETION'),
 contract_manifest JSONB NOT NULL, pdpa_manifest JSONB NOT NULL,
 contract_dependency_revision TEXT NOT NULL CHECK(contract_dependency_revision ~ '^[0-9a-f]{64}$'),
 pdpa_dependency_revision TEXT NOT NULL CHECK(pdpa_dependency_revision ~ '^[0-9a-f]{64}$'),
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(cardinality(signature_ids) BETWEEN 1 AND 20)
);
CREATE FUNCTION retain_generated_document_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Generated document provenance is immutable'; END; $$;
CREATE TRIGGER retain_generated_identity BEFORE UPDATE OR DELETE ON generated_document_identities FOR EACH ROW EXECUTE FUNCTION retain_generated_document_identity();
CREATE TRIGGER retain_generated_link BEFORE UPDATE OR DELETE ON generated_contract_document_links FOR EACH ROW EXECUTE FUNCTION retain_generated_document_identity();
CREATE TRIGGER retain_signed_production_event BEFORE UPDATE OR DELETE ON signed_document_production_events FOR EACH ROW EXECUTE FUNCTION retain_generated_document_identity();
