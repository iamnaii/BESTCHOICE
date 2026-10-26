ALTER TABLE signed_document_production_events ADD COLUMN initiator_user_id TEXT, ADD COLUMN initiator_channel TEXT, ADD COLUMN selected_company TEXT, ADD COLUMN template_choice JSONB;
ALTER TABLE signed_document_production_events ADD CONSTRAINT signed_event_initiator CHECK (
 (initiator_user_id IS NULL AND initiator_channel IS NULL AND selected_company IS NULL AND template_choice IS NULL)
 OR (initiator_user_id IS NOT NULL AND initiator_channel IS NOT NULL AND template_choice IS NOT NULL
   AND ((initiator_channel='MANAGED_STAFF' AND selected_company IS NOT NULL AND selected_company IN ('SHOP','FINANCE'))
     OR (initiator_channel='LEGACY_STAFF' AND selected_company IS NULL)))
);
CREATE TABLE signature_capture_identities (
 id TEXT PRIMARY KEY, signature_id TEXT NOT NULL UNIQUE REFERENCES signatures(id) ON DELETE RESTRICT,
 contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
 customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
 branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
 product_ids TEXT[] NOT NULL, captured_by_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 original_data_url TEXT NOT NULL, submitted_hash TEXT NOT NULL, submitted_size INTEGER NOT NULL,
 canonical_hash TEXT NOT NULL, canonical_size INTEGER NOT NULL, contract_hash TEXT NOT NULL,
 evidence_revision TEXT NOT NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (submitted_size BETWEEN 1 AND 375000 AND canonical_size BETWEEN 1 AND 375000),
 CHECK (length(original_data_url)<=500000 AND cardinality(product_ids) BETWEEN 1 AND 30)
);
CREATE FUNCTION reject_signature_capture_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Signature capture identity is immutable'; END; $$;
CREATE TRIGGER signature_capture_immutable BEFORE UPDATE OR DELETE ON signature_capture_identities FOR EACH ROW EXECUTE FUNCTION reject_signature_capture_change();
CREATE TABLE signed_document_production_consumptions (
 event_id TEXT PRIMARY KEY REFERENCES signed_document_production_events(id) ON DELETE RESTRICT,
 status TEXT NOT NULL CHECK(status IN ('RUNNING','SUCCESS','PARTIAL','FAILED')),
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TIMESTAMP(3)
);

ALTER TABLE signed_document_production_consumptions ADD CONSTRAINT signature_consumption_terminal CHECK ((status='RUNNING' AND completed_at IS NULL) OR (status IN ('SUCCESS','PARTIAL','FAILED') AND completed_at IS NOT NULL));
CREATE FUNCTION protect_signature_consumption() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Signature production consumption is retained'; END IF;
 IF OLD.status<>'RUNNING' OR NEW.status='RUNNING' OR NEW.event_id<>OLD.event_id OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'Signature production consumption is terminal'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER signature_consumption_terminal BEFORE UPDATE OR DELETE ON signed_document_production_consumptions FOR EACH ROW EXECUTE FUNCTION protect_signature_consumption();

ALTER TABLE generated_document_identities ADD COLUMN signature_event_id TEXT REFERENCES signed_document_production_events(id) ON DELETE RESTRICT;
