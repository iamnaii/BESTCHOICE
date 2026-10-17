-- 15ข (2026-10-17): ใบลดหนี้เปลี่ยนเครื่องตำหนิ (cn_source = 'DEFECT_EXCHANGE') ออกหนึ่งใบต่อใบรับเงินของสัญญาเดิม
-- ⇒ สัญญาเดียวมีได้หลายใบ. ดัชนีเดิม (migration 20260981) บังคับ "หนึ่งใบต่อสัญญาต่อ cn_source" ทุกค่า จึงทำให้การเปลี่ยนเครื่อง
-- ของสัญญาที่มีใบรับเงิน ≥ 2 ใบล้มด้วย P2002 (ผู้ตรวจอิสระ C1). คงความหมายเดิมไว้เฉพาะใบลดหนี้อัตโนมัติของ JP5/ตัดหนี้สูญ
-- ซึ่ง CreditNoteDocumentService พึ่งอยู่ (REPOSSESSION / WRITE_OFF).
DROP INDEX IF EXISTS "receipts_contract_cn_source_key";
CREATE UNIQUE INDEX "receipts_contract_cn_source_key" ON "receipts"("contract_id", "cn_source")
  WHERE "cn_source" IN ('REPOSSESSION', 'WRITE_OFF') AND "deleted_at" IS NULL;
