-- Additive, deliberately no historical backfill from mutable Product.costPrice.
CREATE TABLE "sale_cost_snapshots" (
  "sale_id" TEXT NOT NULL,
  "main_product_cost" DECIMAL(12,2) NOT NULL,
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sale_cost_snapshots_pkey" PRIMARY KEY ("sale_id"),
  CONSTRAINT "sale_cost_snapshots_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
