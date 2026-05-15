-- 11-4102 → 11-4101 transfer ("ใบกำกับมาถึงแล้ว") tracking.
-- Additive: 3 nullable columns + 1 unique index + 1 FK + 1 lookup index.

ALTER TABLE "fixed_assets"
  ADD COLUMN "invoice_received_at"               TIMESTAMP(3),
  ADD COLUMN "invoice_received_by_id"            TEXT,
  ADD COLUMN "invoice_transfer_journal_entry_id" TEXT;

CREATE UNIQUE INDEX "fixed_assets_invoice_transfer_journal_entry_id_key"
  ON "fixed_assets" ("invoice_transfer_journal_entry_id");

CREATE INDEX "fixed_assets_invoice_received_at_idx"
  ON "fixed_assets" ("invoice_received_at");

ALTER TABLE "fixed_assets"
  ADD CONSTRAINT "fixed_assets_invoice_received_by_id_fkey"
  FOREIGN KEY ("invoice_received_by_id") REFERENCES "users" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fixed_assets"
  ADD CONSTRAINT "fixed_assets_invoice_transfer_journal_entry_id_fkey"
  FOREIGN KEY ("invoice_transfer_journal_entry_id") REFERENCES "journal_entries" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
