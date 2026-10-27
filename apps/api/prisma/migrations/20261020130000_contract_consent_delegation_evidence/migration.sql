-- No historical backfill. Existing tokens retain explicit legacy compatibility.
ALTER TABLE pdpa_consents ADD COLUMN captured_by_id TEXT REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD COLUMN notice_digest TEXT;
ALTER TABLE customer_access_tokens
 ADD COLUMN issued_by_id TEXT REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD COLUMN recipient_customer_id TEXT REFERENCES customers(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD COLUMN access_company_code TEXT REFERENCES company_info(company_code) ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD COLUMN source_branch_id TEXT REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD COLUMN projection_version INTEGER;
ALTER TABLE customer_access_tokens ADD CONSTRAINT customer_access_provenance_complete CHECK (
 (issued_by_id IS NULL AND recipient_customer_id IS NULL AND access_company_code IS NULL AND source_branch_id IS NULL AND projection_version IS NULL)
 OR (issued_by_id IS NOT NULL AND recipient_customer_id IS NOT NULL AND access_company_code IS NOT NULL AND projection_version IS NOT NULL AND access_company_code = 'FINANCE' AND source_branch_id IS NOT NULL AND projection_version = 1)
);
CREATE FUNCTION preserve_customer_delegation_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.issued_by_id, NEW.recipient_customer_id, NEW.access_company_code, NEW.source_branch_id, NEW.projection_version, NEW.contract_id, NEW.token, NEW.expires_at)
 IS DISTINCT FROM ROW(OLD.issued_by_id, OLD.recipient_customer_id, OLD.access_company_code, OLD.source_branch_id, OLD.projection_version, OLD.contract_id, OLD.token, OLD.expires_at)
 THEN RAISE EXCEPTION 'Customer delegation evidence is immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER customer_delegation_evidence_immutable BEFORE UPDATE ON customer_access_tokens
 FOR EACH ROW EXECUTE FUNCTION preserve_customer_delegation_evidence();
