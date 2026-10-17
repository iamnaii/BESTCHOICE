-- Existing server-owned sources remain unchanged. Unknown future sources are legal
-- data but are unavailable to the TOOLTIFY reader until explicitly resolved.
ALTER TABLE imported_sales ALTER COLUMN source DROP DEFAULT;
CREATE FUNCTION prevent_imported_sale_source_change() RETURNS trigger AS $$
BEGIN
  IF NEW.source IS DISTINCT FROM OLD.source THEN
    RAISE EXCEPTION 'Imported sale source is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER imported_sale_source_immutable BEFORE UPDATE OF source ON imported_sales
FOR EACH ROW EXECUTE FUNCTION prevent_imported_sale_source_change();
