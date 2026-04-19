-- T5-C18: Snapshot the supplier's primary bank details on the PurchaseOrder
-- at create time so that historical POs never lose their original payment
-- target when the supplier record is later edited. Combined with the
-- service-level block (supplier.update() refuses bank edits while an open PO
-- exists), this gives a single source of truth for "where the money went".

ALTER TABLE "purchase_orders"
  ADD COLUMN "bank_account_snapshot" TEXT,
  ADD COLUMN "bank_name_snapshot" TEXT;
