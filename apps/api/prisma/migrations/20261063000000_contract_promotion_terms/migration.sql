-- Future-only committed named rates; no historical inference/backfill.
ALTER TABLE contracts ADD COLUMN promotion_fingerprint TEXT;
CREATE TABLE contract_promotion_terms (
 id TEXT PRIMARY KEY, contract_id TEXT NOT NULL UNIQUE REFERENCES contracts(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 promotion_id TEXT NOT NULL REFERENCES promotions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 baseline_source TEXT NOT NULL, baseline_amount DECIMAL(12,2) NOT NULL CHECK (baseline_amount > 0),
 monthly_rate DECIMAL(5,4) NOT NULL CHECK (monthly_rate >= 0),
 selling_price DECIMAL(12,2) NOT NULL, down_payment DECIMAL(12,2) NOT NULL,
 financed_amount DECIMAL(12,2) NOT NULL, interest_total DECIMAL(12,2) NOT NULL,
 store_commission DECIMAL(12,2) NOT NULL, vat_amount DECIMAL(12,2) NOT NULL, vat_pct DECIMAL(5,4) NOT NULL,
 monthly_payment DECIMAL(12,2) NOT NULL, total_months INTEGER NOT NULL, payment_due_day INTEGER,
 bundle_product_ids TEXT[] NOT NULL DEFAULT '{}', schedule JSONB NOT NULL, definition JSONB NOT NULL,
 fingerprint TEXT NOT NULL, recorded_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER contract_promotion_terms_immutable BEFORE UPDATE OR DELETE ON contract_promotion_terms FOR EACH ROW EXECUTE FUNCTION prevent_sale_promotion_benefit_change();
CREATE TABLE contract_promotion_reservations (
 id TEXT PRIMARY KEY, terms_id TEXT NOT NULL UNIQUE REFERENCES contract_promotion_terms(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 state TEXT NOT NULL DEFAULT 'RESERVED' CHECK (state IN ('RESERVED','CONSUMED','RELEASED')),
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL
);
CREATE FUNCTION protect_contract_promotion_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' OR OLD.state <> 'RESERVED' OR NEW.state NOT IN ('CONSUMED','RELEASED') OR NEW.terms_id <> OLD.terms_id OR NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at THEN
 RAISE EXCEPTION 'Invalid promotion reservation transition'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER contract_promotion_reservation_transition BEFORE UPDATE OR DELETE ON contract_promotion_reservations FOR EACH ROW EXECUTE FUNCTION protect_contract_promotion_reservation();
ALTER TABLE sale_promotion_benefits ADD COLUMN contract_terms_id TEXT UNIQUE REFERENCES contract_promotion_terms(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE sale_promotion_benefits ADD CONSTRAINT special_rate_terms_required CHECK ((type = 'SPECIAL_RATE') = (contract_terms_id IS NOT NULL));

CREATE FUNCTION protect_contract_promotion_fingerprint() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.promotion_fingerprint IS NOT NULL AND NEW.promotion_fingerprint IS DISTINCT FROM OLD.promotion_fingerprint THEN
 RAISE EXCEPTION 'Committed promotion fingerprint is immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER contract_promotion_fingerprint_immutable BEFORE UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION protect_contract_promotion_fingerprint();
