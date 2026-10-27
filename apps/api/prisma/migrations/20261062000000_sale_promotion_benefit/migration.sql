-- Additive immutable canonical evidence, deliberately no guessed legacy backfill.
CREATE TABLE sale_promotion_benefits (
 id TEXT PRIMARY KEY, sale_id TEXT NOT NULL UNIQUE REFERENCES sales(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 promotion_id TEXT NOT NULL REFERENCES promotions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 type "PromotionType" NOT NULL, baseline_source TEXT NOT NULL,
 baseline_amount DECIMAL(12,2) NOT NULL CHECK (baseline_amount > 0),
 discount_amount DECIMAL(12,2) NOT NULL CHECK (discount_amount >= 0 AND discount_amount <= baseline_amount),
 accessory_product_ids TEXT[] NOT NULL DEFAULT '{}', definition JSONB NOT NULL,
 fingerprint TEXT NOT NULL, recorded_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE promotion_usages ADD COLUMN benefit_id TEXT UNIQUE REFERENCES sale_promotion_benefits(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE FUNCTION prevent_sale_promotion_benefit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Canonical promotion evidence is immutable'; END; $$;
CREATE TRIGGER sale_promotion_benefit_immutable BEFORE UPDATE OR DELETE ON sale_promotion_benefits FOR EACH ROW EXECUTE FUNCTION prevent_sale_promotion_benefit_change();
CREATE FUNCTION prevent_named_promotion_usage_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF OLD.benefit_id IS NOT NULL OR (TG_OP = 'UPDATE' AND NEW.benefit_id IS NOT NULL) THEN RAISE EXCEPTION 'Canonical promotion usage is immutable'; END IF; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $$;
CREATE TRIGGER named_promotion_usage_immutable BEFORE UPDATE OR DELETE ON promotion_usages FOR EACH ROW EXECUTE FUNCTION prevent_named_promotion_usage_change();
