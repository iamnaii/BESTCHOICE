-- ผูก contractId ให้รายการกลับรายการ (ยกเลิกใบเสร็จ / คืนเงิน) ที่ลงก่อน 2026-09-28
-- คำตัดสินฝ่ายบัญชี 2026-09-28 ข้อ 7 — ดู docs/superpowers/specs/2026-09-28-accounting-review-fixes-design.md ข้อ 5.1
--
-- idempotent: แตะเฉพาะแถวที่ยังไม่มี contractId และรายการเดิมมี contractId เป็น string
-- ไม่แตะ flow อื่น (defect-exchange / exchange-cancel stamp contractId เองอยู่แล้ว)
UPDATE journal_entries AS rev
SET metadata = rev.metadata || jsonb_build_object('contractId', orig.metadata->>'contractId'),
    updated_at = NOW()
FROM journal_entries AS orig
WHERE rev.metadata->>'tag' = 'REVERSAL'
  AND rev.metadata->>'flow' IN ('receipt-void', 'refund-reversal')
  AND rev.metadata->>'originalEntryId' = orig.id
  AND NOT (rev.metadata ? 'contractId')
  AND jsonb_typeof(orig.metadata->'contractId') = 'string';
