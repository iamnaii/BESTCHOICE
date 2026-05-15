-- PR 2a Task 5 (P6) — Link FixedAsset to Supplier master + record partial payment amount.
--
-- All columns are nullable; FK has ON DELETE SET NULL ON UPDATE CASCADE so deleting
-- a supplier (soft-delete in practice) does not orphan asset rows. Existing rows
-- keep supplierName / supplierTaxId text fields untouched.

ALTER TABLE "fixed_assets"
  ADD COLUMN "vendor_id" TEXT,
  ADD COLUMN "vendor_amount_paid" DECIMAL(12, 2);

ALTER TABLE "fixed_assets"
  ADD CONSTRAINT "fixed_assets_vendor_id_fkey"
  FOREIGN KEY ("vendor_id") REFERENCES "suppliers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "fixed_assets_vendor_id_idx" ON "fixed_assets"("vendor_id");
