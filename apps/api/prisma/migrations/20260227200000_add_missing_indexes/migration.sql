-- Add missing indexes defined in Prisma schema

-- contracts indexes
CREATE INDEX IF NOT EXISTS "contracts_created_at_idx" ON "contracts"("created_at");
CREATE INDEX IF NOT EXISTS "contracts_deleted_at_idx" ON "contracts"("deleted_at");
CREATE INDEX IF NOT EXISTS "contracts_status_deleted_at_branch_id_idx" ON "contracts"("status", "deleted_at", "branch_id");

-- payments compound index
CREATE INDEX IF NOT EXISTS "payments_status_due_date_idx" ON "payments"("status", "due_date");
CREATE INDEX IF NOT EXISTS "payments_paid_date_idx" ON "payments"("paid_date");

-- products indexes
CREATE INDEX IF NOT EXISTS "products_supplier_id_idx" ON "products"("supplier_id");
CREATE INDEX IF NOT EXISTS "products_deleted_at_idx" ON "products"("deleted_at");
CREATE INDEX IF NOT EXISTS "products_created_at_idx" ON "products"("created_at");
