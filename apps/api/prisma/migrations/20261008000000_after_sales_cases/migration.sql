-- After-sales hub — เคสกลาง (spec 2026-09-23 ข้อ 5). Additive only.
CREATE TYPE "AfterSalesSource" AS ENUM ('INSTALLMENT_CONTRACT', 'CASH_SALE', 'WALK_IN');
CREATE TYPE "AfterSalesOutcome" AS ENUM ('REPAIR', 'SAME_MODEL_EXCHANGE', 'PRICED_EXCHANGE', 'CASH_SAME_MODEL_EXCHANGE');
CREATE TYPE "AfterSalesStage" AS ENUM ('RECEIVED', 'IN_REPAIR', 'AWAITING_APPROVAL', 'READY_FOR_PICKUP', 'CLOSED', 'CANCELLED');
CREATE TYPE "AfterSalesEventKind" AS ENUM ('RECEIVED', 'OUTCOME_SET', 'REPAIR_SENT', 'REPAIR_DONE', 'REPAIR_SENT_BACK', 'DELIVERED', 'PHOTO_ADDED', 'LINE_SENT', 'LINE_SKIPPED_NO_LINK', 'PRINTED', 'CLOSED', 'CANCELLED', 'NOTE');

CREATE TABLE "after_sales_cases" (
  "id" TEXT NOT NULL, "case_number" TEXT NOT NULL, "branch_id" TEXT NOT NULL, "customer_id" TEXT NOT NULL,
  "source" "AfterSalesSource" NOT NULL, "contract_id" TEXT, "sale_id" TEXT, "product_id" TEXT,
  "device_brand" TEXT, "device_model" TEXT, "device_imei" TEXT, "device_serial" TEXT,
  "symptom" TEXT NOT NULL, "accessories" JSONB NOT NULL DEFAULT '{}', "unlock_confirmed" BOOLEAN NOT NULL DEFAULT false,
  "photo_keys" TEXT[] DEFAULT ARRAY[]::TEXT[], "purchase_photo_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "warranty_snapshot" JSONB NOT NULL, "outcome" "AfterSalesOutcome",
  "repair_ticket_id" TEXT, "exchange_request_id" TEXT, "replacement_contract_id" TEXT, "replacement_sale_id" TEXT, "replacement_product_id" TEXT,
  "stage" "AfterSalesStage" NOT NULL DEFAULT 'RECEIVED',
  "received_by_id" TEXT NOT NULL, "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_by_id" TEXT, "approved_at" TIMESTAMP(3), "closed_at" TIMESTAMP(3), "cancelled_at" TIMESTAMP(3), "cancel_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL, "deleted_at" TIMESTAMP(3),
  CONSTRAINT "after_sales_cases_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "after_sales_cases_case_number_key" ON "after_sales_cases"("case_number");
CREATE UNIQUE INDEX "after_sales_cases_repair_ticket_id_key" ON "after_sales_cases"("repair_ticket_id");
CREATE UNIQUE INDEX "after_sales_cases_exchange_request_id_key" ON "after_sales_cases"("exchange_request_id");
CREATE INDEX "after_sales_cases_branch_id_stage_deleted_at_idx" ON "after_sales_cases"("branch_id", "stage", "deleted_at");
CREATE INDEX "after_sales_cases_customer_id_deleted_at_idx" ON "after_sales_cases"("customer_id", "deleted_at");
CREATE INDEX "after_sales_cases_device_imei_idx" ON "after_sales_cases"("device_imei");
CREATE INDEX "after_sales_cases_received_at_idx" ON "after_sales_cases"("received_at");
ALTER TABLE "after_sales_cases" ADD CONSTRAINT "after_sales_cases_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "after_sales_cases" ADD CONSTRAINT "after_sales_cases_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "after_sales_cases" ADD CONSTRAINT "after_sales_cases_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "after_sales_cases" ADD CONSTRAINT "after_sales_cases_repair_ticket_id_fkey" FOREIGN KEY ("repair_ticket_id") REFERENCES "repair_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "after_sales_events" (
  "id" TEXT NOT NULL, "case_id" TEXT NOT NULL, "kind" "AfterSalesEventKind" NOT NULL, "note" TEXT, "actor_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "after_sales_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "after_sales_events_case_id_created_at_idx" ON "after_sales_events"("case_id", "created_at");
ALTER TABLE "after_sales_events" ADD CONSTRAINT "after_sales_events_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "after_sales_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: ใบซ่อมเดิมทุกใบ (รวมข้อมูลทดสอบ) ได้เคส 1 ใบ เลข AS-<วันสร้างใบซ่อม BKK>-<ลำดับในวัน> stage ตามสถานะใบซ่อม
INSERT INTO "after_sales_cases" ("id","case_number","branch_id","customer_id","source","contract_id","product_id","device_brand","device_model","device_imei","device_serial","symptom","warranty_snapshot","outcome","repair_ticket_id","stage","received_by_id","received_at","created_at","updated_at","closed_at","cancelled_at")
SELECT gen_random_uuid()::text,
  'AS-' || to_char(rt.created_at AT TIME ZONE 'Asia/Bangkok', 'YYYYMMDD') || '-' || lpad((row_number() OVER (PARTITION BY (rt.created_at AT TIME ZONE 'Asia/Bangkok')::date ORDER BY rt.created_at))::text, 4, '0'),
  rt.branch_id, rt.customer_id,
  CASE WHEN rt.contract_id IS NOT NULL THEN 'INSTALLMENT_CONTRACT'::"AfterSalesSource" WHEN rt.warranty_status = 'WALK_IN' THEN 'WALK_IN' ELSE 'CASH_SALE' END,
  rt.contract_id, rt.product_id, rt.device_brand, rt.device_model, rt.device_imei, rt.device_serial, rt.defect_description,
  jsonb_build_object('status', rt.warranty_status, 'checkedAt', rt.created_at, 'backfilled', true),
  'REPAIR', rt.id,
  CASE rt.status WHEN 'OPEN' THEN 'RECEIVED'::"AfterSalesStage" WHEN 'IN_PROGRESS' THEN 'IN_REPAIR' WHEN 'READY_FOR_PICKUP' THEN 'READY_FOR_PICKUP' WHEN 'CLOSED' THEN 'CLOSED' WHEN 'REPLACED' THEN 'CLOSED' ELSE 'CANCELLED' END,
  rt.created_by_id, rt.created_at, rt.created_at, rt.updated_at,
  CASE WHEN rt.status IN ('CLOSED','REPLACED') THEN COALESCE(rt.returned_to_customer_at, rt.replaced_at, rt.updated_at) END,
  rt.cancelled_at
FROM "repair_tickets" rt WHERE rt.deleted_at IS NULL;
