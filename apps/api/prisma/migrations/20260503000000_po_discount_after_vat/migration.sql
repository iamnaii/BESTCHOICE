ALTER TABLE "purchase_orders"
  ADD COLUMN "discount_after_vat" DECIMAL(12,2) NOT NULL DEFAULT 0;
