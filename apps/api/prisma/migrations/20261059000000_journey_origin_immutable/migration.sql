-- Existing lifecycle remains: merge moves customer_id; undo soft-deletes;
-- actor FK may become null; PDPA erases rows. Only original identity is immutable.
CREATE FUNCTION preserve_journey_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.origin_customer_id IS DISTINCT FROM OLD.origin_customer_id THEN
    RAISE EXCEPTION 'Journey original customer is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER journey_origin_immutable BEFORE UPDATE ON customer_journey_entries
FOR EACH ROW EXECUTE FUNCTION preserve_journey_origin();
