-- WarrantyAuditLog (T5-C6). Every manual shopWarrantyEndDate adjustment
-- goes through WarrantyService.adjustShopWarranty() which writes one row
-- here. Backward adjustments are OWNER-only; a reason is always required.

CREATE TABLE "warranty_audit_logs" (
  "id"           TEXT NOT NULL,
  "contract_id"  TEXT NOT NULL,
  "user_id"      TEXT NOT NULL,
  "old_end_date" TIMESTAMP(3),
  "new_end_date" TIMESTAMP(3) NOT NULL,
  "direction"    TEXT NOT NULL,
  "reason"       TEXT NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "warranty_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "warranty_audit_logs_contract_id_idx"
  ON "warranty_audit_logs"("contract_id");
CREATE INDEX "warranty_audit_logs_user_id_created_at_idx"
  ON "warranty_audit_logs"("user_id", "created_at");
CREATE INDEX "warranty_audit_logs_direction_created_at_idx"
  ON "warranty_audit_logs"("direction", "created_at");

ALTER TABLE "warranty_audit_logs"
  ADD CONSTRAINT "warranty_audit_logs_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "warranty_audit_logs"
  ADD CONSTRAINT "warranty_audit_logs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
