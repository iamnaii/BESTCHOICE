-- Forward-only typed proof; historical reasons are never parsed/backfilled.
ALTER TABLE loyalty_redemptions ADD COLUMN sale_id TEXT UNIQUE REFERENCES sales(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD COLUMN evidence JSONB, ADD COLUMN fingerprint TEXT,
 ADD CONSTRAINT loyalty_sale_proof_complete CHECK (
   (sale_id IS NULL AND evidence IS NULL AND fingerprint IS NULL) OR
   (sale_id IS NOT NULL AND evidence IS NOT NULL AND fingerprint IS NOT NULL AND points > 0 AND discount_amount = points AND deleted_at IS NULL)
 );
CREATE FUNCTION prevent_loyalty_sale_proof_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.sale_id IS NOT NULL OR (TG_OP = 'UPDATE' AND NEW.sale_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Canonical loyalty evidence is immutable';
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER loyalty_sale_proof_immutable BEFORE UPDATE OR DELETE ON loyalty_redemptions FOR EACH ROW EXECUTE FUNCTION prevent_loyalty_sale_proof_change();
