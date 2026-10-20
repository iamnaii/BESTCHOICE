CREATE TABLE managed_payoff_evidence (
 id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE,
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
 finance_company_id TEXT NOT NULL REFERENCES company_info(id) ON DELETE RESTRICT,
 origin_shop_company_id TEXT NOT NULL REFERENCES company_info(id) ON DELETE RESTRICT,
 origin_branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
 object_key TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL, byte_length INTEGER NOT NULL,
 content_hash TEXT NOT NULL, reading JSONB NOT NULL, checks JSONB NOT NULL, verified BOOLEAN NOT NULL,
 effective_discount_pct TEXT NOT NULL, payment_date TEXT NOT NULL,
 money_snapshot JSONB NOT NULL, money_fingerprint TEXT NOT NULL, slip_fingerprint TEXT,
 token_hash TEXT UNIQUE, expires_at TIMESTAMP(3),
 request_id TEXT UNIQUE REFERENCES payment_approval_requests(id) ON DELETE RESTRICT,
 consumed_at TIMESTAMP(3), receipt_id TEXT UNIQUE REFERENCES receipts(id) ON DELETE RESTRICT,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT payoff_evidence_shape CHECK (
   byte_length > 0 AND byte_length <= 5242880 AND mime_type IN ('image/jpeg','image/png','image/webp')
   AND content_hash ~ '^[a-f0-9]{64}$' AND money_fingerprint ~ '^[a-f0-9]{64}$'
   AND effective_discount_pct::numeric BETWEEN 0 AND 50
   AND ((token_hash IS NULL AND expires_at IS NULL) OR
     (token_hash IS NOT NULL AND token_hash ~ '^[a-f0-9]{64}$' AND expires_at IS NOT NULL AND expires_at > created_at AND expires_at <= created_at + INTERVAL '15 minutes' AND verified AND effective_discount_pct::numeric = 0))
   AND ((consumed_at IS NULL AND receipt_id IS NULL) OR
     (consumed_at IS NOT NULL AND receipt_id IS NOT NULL AND token_hash IS NOT NULL AND request_id IS NULL))
   AND (request_id IS NULL OR (effective_discount_pct::numeric > 0 AND token_hash IS NULL AND consumed_at IS NULL))
 )
);
CREATE INDEX managed_payoff_evidence_contract_id_created_at_idx ON managed_payoff_evidence(contract_id, created_at);
CREATE INDEX managed_payoff_evidence_content_hash_idx ON managed_payoff_evidence(content_hash);
-- Verification never claims payment; only the same atomic monetary transaction does.
CREATE UNIQUE INDEX managed_payoff_evidence_consumed_content_key ON managed_payoff_evidence(content_hash) WHERE consumed_at IS NOT NULL;
CREATE FUNCTION guard_managed_payoff_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Payoff evidence is immutable'; END IF;
 IF TG_OP = 'INSERT' THEN
   IF NEW.request_id IS NOT NULL OR NEW.consumed_at IS NOT NULL OR NEW.receipt_id IS NOT NULL THEN
     RAISE EXCEPTION 'Payoff evidence must start unlinked';
   END IF;
   RETURN NEW;
 END IF;
 IF (to_jsonb(NEW) - ARRAY['request_id','consumed_at','receipt_id']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['request_id','consumed_at','receipt_id']) OR
    OLD.request_id IS NOT NULL OR OLD.consumed_at IS NOT NULL OR OLD.receipt_id IS NOT NULL THEN
   RAISE EXCEPTION 'Payoff evidence is immutable';
 END IF;
 IF NEW.request_id IS NOT NULL AND NEW.consumed_at IS NULL AND NEW.receipt_id IS NULL THEN
   IF NOT EXISTS (SELECT 1 FROM payment_approval_requests r WHERE r.id=NEW.request_id
     AND r.action='EARLY_PAYOFF' AND r.status='PENDING' AND r.deleted_at IS NULL
     AND r.contract_id=NEW.contract_id AND r.target_id=NEW.contract_id AND r.requested_by_id=NEW.actor_id
     AND r.snapshot->>'managedPayoffEvidenceId'=NEW.id
     AND r.snapshot->'managedEarlyPayoffSource' = jsonb_build_object('version',1,'requesterId',NEW.actor_id,
       'contractId',NEW.contract_id,'financeCompanyId',NEW.finance_company_id,
       'originShopCompanyId',NEW.origin_shop_company_id,'originBranchId',NEW.origin_branch_id)) THEN
     RAISE EXCEPTION 'Payoff request linkage invalid';
   END IF;
 ELSIF NEW.request_id IS NULL AND NEW.consumed_at IS NOT NULL AND NEW.receipt_id IS NOT NULL THEN
   IF NEW.expires_at < NEW.consumed_at OR NOT EXISTS (SELECT 1 FROM receipts r WHERE r.id=NEW.receipt_id
     AND r.contract_id=NEW.contract_id AND r."receiptType"='EARLY_PAYOFF' AND r.issued_by_id=NEW.actor_id
     AND r.deleted_at IS NULL AND NOT r.is_voided) THEN
     RAISE EXCEPTION 'Payoff consumption invalid';
   END IF;
 ELSE RAISE EXCEPTION 'Payoff transition invalid';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER managed_payoff_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON managed_payoff_evidence
 FOR EACH ROW EXECUTE FUNCTION guard_managed_payoff_evidence();
