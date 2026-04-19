-- T5-C8 anti-fraud: track any product that ever passed through a terminal
-- damage status (DAMAGED/LOST/WRITTEN_OFF). Once flagged, it stays flagged
-- even if restored via FOUND — sales code uses this to force OWNER approval
-- + explicit disclosure acknowledgement before resale.

ALTER TABLE "products"
  ADD COLUMN "was_previously_damaged" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "restored_from_terminal_at" TIMESTAMP(3);

-- Backfill from existing stock_adjustments: any product that has a DAMAGED/
-- LOST/WRITE_OFF adjustment row gets the flag on.
UPDATE "products" p
SET "was_previously_damaged" = true
FROM "stock_adjustments" sa
WHERE sa."product_id" = p.id
  AND sa.reason IN ('DAMAGED', 'LOST', 'WRITE_OFF')
  AND sa."deleted_at" IS NULL;
