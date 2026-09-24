-- After-sales hub PR 2 Task 1 — ผูก AfterSalesCase กับ ContractExchangeRequest + backfill คำขอเดิม
-- (spec 2026-09-24 PR2 Task 1). Additive only — ADD VALUE IF NOT EXISTS ปลอดภัยใน transaction
-- เดียวกันตราบใดที่ไม่มีการอ้างอิงค่าใหม่ในทรานแซกชันนี้ (ค่าใหม่เป็นของ AfterSalesEventKind
-- ซึ่งไม่ถูกใช้ใน backfill ของ after_sales_cases ด้านล่างเลย).
ALTER TYPE "AfterSalesEventKind" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE "AfterSalesEventKind" ADD VALUE IF NOT EXISTS 'REJECTED';

ALTER TABLE "after_sales_cases"
  ADD CONSTRAINT "after_sales_cases_exchange_request_id_fkey"
  FOREIGN KEY ("exchange_request_id") REFERENCES "contract_exchange_requests"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: คำขอเปลี่ยนเครื่องเดิมทุกใบ (prod = ข้อมูลทดสอบ 1 แถว) ได้เคส 1 ใบ เลข AS-<วันยื่น BKK>-<ลำดับต่อจากเลขที่มีอยู่ของวันนั้น>
-- (backfill เฉพาะคำขอที่ยังไม่มีเคสผูกอยู่แล้ว — idempotent ตาม NOT EXISTS ด้านล่าง)
WITH req AS (
  SELECT r.id, r.old_contract_id, r.old_product_id, r.new_contract_id, r.status, r.mode, r.memo_applied_at,
         r.requested_by_id, r.created_at, r.condition_note, r.rejection_reason, r.cancel_reason, r.canceled_at, r.approved_at,
         c.branch_id, c.customer_id, p.brand, p.model, p.imei_serial, p.serial_number,
         nc.status AS new_contract_status,
         to_char((r.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok', 'YYYYMMDD') AS bkk_day
  FROM "contract_exchange_requests" r
  JOIN "contracts" c ON c.id = r.old_contract_id
  JOIN "products" p ON p.id = r.old_product_id
  LEFT JOIN "contracts" nc ON nc.id = r.new_contract_id
  WHERE r.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM "after_sales_cases" a WHERE a.exchange_request_id = r.id)
), numbered AS (
  SELECT req.*,
         ROW_NUMBER() OVER (PARTITION BY bkk_day ORDER BY created_at, id) +
         COALESCE((SELECT MAX(SUBSTRING(a.case_number FROM 13 FOR 4)::int) FROM "after_sales_cases" a WHERE a.case_number LIKE 'AS-' || req.bkk_day || '-%'), 0) AS seq
  FROM req
)
INSERT INTO "after_sales_cases" ("id","case_number","branch_id","customer_id","source","contract_id","product_id","device_brand","device_model","device_imei","device_serial","symptom","warranty_snapshot","outcome","exchange_request_id","replacement_contract_id","stage","received_by_id","received_at","approved_at","closed_at","cancelled_at","cancel_reason","created_at","updated_at")
SELECT gen_random_uuid(), 'AS-' || bkk_day || '-' || LPAD(seq::text, 4, '0'), branch_id, customer_id, 'INSTALLMENT_CONTRACT'::"AfterSalesSource", old_contract_id, old_product_id,
       brand, model, imei_serial, serial_number,
       COALESCE(condition_note, 'คำขอเปลี่ยนเครื่อง (backfill จากคิวเดิม)'),
       jsonb_build_object('status', 'UNKNOWN', 'daysRemainingIn7Day', 0, 'checkedAt', created_at, 'backfilled', true),
       'PRICED_EXCHANGE'::"AfterSalesOutcome",
       id, new_contract_id,
       CASE
         WHEN status = 'PENDING' THEN 'AWAITING_APPROVAL'
         WHEN status = 'APPROVED' AND (memo_applied_at IS NOT NULL OR new_contract_status = 'ACTIVE') THEN 'CLOSED'
         WHEN status = 'APPROVED' THEN 'READY_FOR_PICKUP'
         ELSE 'CANCELLED'
       END::"AfterSalesStage",
       requested_by_id, created_at, approved_at,
       CASE WHEN status = 'APPROVED' AND (memo_applied_at IS NOT NULL OR new_contract_status = 'ACTIVE') THEN COALESCE(memo_applied_at, approved_at) END,
       CASE WHEN status IN ('REJECTED','CANCELED') THEN COALESCE(canceled_at, approved_at, created_at) END,
       CASE WHEN status = 'REJECTED' THEN rejection_reason WHEN status = 'CANCELED' THEN cancel_reason END,
       created_at, now()
FROM numbered;
