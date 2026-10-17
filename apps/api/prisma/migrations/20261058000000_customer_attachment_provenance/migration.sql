CREATE TABLE customer_attachments (
 id TEXT PRIMARY KEY, origin_customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
 source_kind TEXT NOT NULL CHECK (source_kind IN ('CUSTOMER_ORIGIN','SALE','CONTRACT','TRADE_IN','REPAIR_TICKET','BOOKING','CHAT_ROOM')),
 source_id TEXT NOT NULL, access_company_code TEXT NOT NULL CHECK (access_company_code IN ('SHOP','FINANCE')), access_branch_id TEXT,
 storage_key TEXT NOT NULL UNIQUE, file_name TEXT NOT NULL, mime_type TEXT NOT NULL,
 file_size INTEGER NOT NULL CHECK (file_size BETWEEN 1 AND 10485760), sha256 TEXT NOT NULL,
 created_by_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL, deleted_at TIMESTAMP(3)
);
CREATE INDEX customer_attachments_origin_customer_id_deleted_at_idx ON customer_attachments(origin_customer_id, deleted_at);
CREATE FUNCTION immutable_customer_attachment_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW) - 'deleted_at' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'deleted_at' - 'updated_at') THEN
  RAISE EXCEPTION 'Customer attachment provenance is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER customer_attachment_immutable BEFORE UPDATE ON customer_attachments FOR EACH ROW EXECUTE FUNCTION immutable_customer_attachment_provenance();
