CREATE TABLE "shop_cash_slip_evidence" (
 "id" TEXT PRIMARY KEY, "source_kind" TEXT NOT NULL CHECK (source_kind IN ('CLOSE','DEPOSIT')),
 "source_id" TEXT NOT NULL, "storage_key" TEXT NOT NULL UNIQUE,
 "mime_type" TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
 "file_size" INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 5242880),
 "sha256" TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 "operation_id" TEXT NOT NULL UNIQUE, "created_by_id" TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "shop_cash_slip_evidence_source_kind_source_id_idx" ON "shop_cash_slip_evidence" (source_kind, source_id);
CREATE FUNCTION guard_shop_cash_slip_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Cash slip evidence is immutable'; END IF;
 IF NEW.source_kind = 'CLOSE' AND NOT EXISTS (SELECT 1 FROM shop_cash_closes WHERE id=NEW.source_id AND deposit_slip_key=NEW.storage_key) THEN RAISE EXCEPTION 'Cash close slip source mismatch'; END IF;
 IF NEW.source_kind = 'DEPOSIT' AND NOT EXISTS (SELECT 1 FROM shop_cash_deposits WHERE id=NEW.source_id AND slip_key=NEW.storage_key) THEN RAISE EXCEPTION 'Cash deposit slip source mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER shop_cash_slip_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON shop_cash_slip_evidence FOR EACH ROW EXECUTE FUNCTION guard_shop_cash_slip_evidence();
