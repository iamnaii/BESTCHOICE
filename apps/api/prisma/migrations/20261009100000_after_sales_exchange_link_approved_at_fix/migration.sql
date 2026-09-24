-- after-sales hub PR 2 — final fix wave I5
-- ContractExchangeService.reject() เขียน approved_at/approved_by_id ตอน "ปฏิเสธ" ด้วย ⇒ backfill ของ
-- 20261009000000 คัดลอก approved_at ของคำขอที่ถูกปฏิเสธมาไว้บนเคส (เคสดูเหมือน "เคยอนุมัติ").
-- ล้างค่าเหล่านั้นออกจากเคสที่ผูกกับคำขอ REJECTED. idempotent — รันซ้ำได้ (รอบสองไม่มีแถวตรงเงื่อนไข).
-- ไม่แก้ migration 20261009000000 ที่ลง prod ไปแล้ว (additive เท่านั้น)
UPDATE "after_sales_cases" c
SET "approved_at" = NULL,
    "approved_by_id" = NULL
FROM "contract_exchange_requests" r
WHERE c."exchange_request_id" = r."id"
  AND r."status" = 'REJECTED'
  AND c."approved_at" IS NOT NULL;
