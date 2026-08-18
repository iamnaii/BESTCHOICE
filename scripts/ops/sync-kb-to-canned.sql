-- Sync คลังคำตอบบอท (chat_knowledge_base ที่ active) → ข้อความสำเร็จรูปพนักงาน (canned_responses)
-- id = 'kb:<intent>' — รันซ้ำได้: เนื้อหา/ชื่อ/ลำดับอัปเดตตามคลังล่าสุด,
-- แถวคลังที่ถูกปิดทีหลังจะปิด template ตาม (เฉพาะ template ที่มาจาก sync นี้เท่านั้น)
BEGIN;

INSERT INTO canned_responses
  (id, shortcut, title, content, response_type, category, sort_order, is_active, created_at, updated_at)
SELECT
  'kb:' || kb.intent,
  '/' || kb.intent,
  CASE kb.intent
    WHEN 'product_availability'         THEN 'เช็คของ/สต็อก'
    WHEN 'price_installment'            THEN 'ถามราคา-ผ่อน'
    WHEN 'store_location_hours'         THEN 'ที่ตั้งร้าน + เวลาเปิด'
    WHEN 'installment_terms'            THEN 'เรทผ่อน 2 แบบ'
    WHEN 'documents_required'           THEN 'เอกสารที่ใช้'
    WHEN 'approval_process'             THEN 'การอนุมัติ (5 นาที)'
    WHEN 'second_hand_condition'        THEN 'สภาพเครื่องมือสอง'
    WHEN 'down_payment_channel'         THEN 'วางดาวน์รับเครื่อง'
    WHEN 'trade_in'                     THEN 'เทิร์นเงินเหลือ'
    WHEN 'payment_channel'              THEN 'ช่องทางชำระค่างวด'
    WHEN 'outstanding_balance'          THEN 'เช็คยอดค้าง'
    WHEN 'warranty_claim'               THEN 'ประกัน/เคลม'
    WHEN 'slip_confirm'                 THEN 'ส่งสลิปยืนยัน'
    WHEN 'due_date'                     THEN 'วันครบกำหนด'
    WHEN 'device_lock'                  THEN 'เครื่องถูกล็อก'
    WHEN 'early_payoff'                 THEN 'ปิดยอดก่อนกำหนด'
    WHEN 'spec_compare'                 THEN 'เทียบรุ่น'
    WHEN 'late_fee'                     THEN 'ค่าปรับล่าช้า'
    WHEN 'accessories'                  THEN 'อุปกรณ์เสริม'
    WHEN 'extend_due_date'              THEN 'ขอเลื่อนนัด'
    WHEN 'receipt_request'              THEN 'ขอใบเสร็จ'
    WHEN 'contract_document'            THEN 'ขอดูสัญญา'
    WHEN 'profile_change'               THEN 'เปลี่ยนข้อมูลส่วนตัว'
    WHEN 'objection_price_too_high'     THEN 'ลูกค้าว่าแพง'
    WHEN 'objection_fake_or_icloud'     THEN 'กลัวของปลอม/iCloud'
    WHEN 'objection_scam_fear'          THEN 'กลัวโดนโกง'
    WHEN 'objection_think_about_it'     THEN 'ขอคิดดูก่อน'
    WHEN 'objection_rate_question'      THEN 'ถามดอกเบี้ย/เรท'
    WHEN 'objection_consult_family'     THEN 'ขอปรึกษาครอบครัว'
    WHEN 'objection_down_payment'       THEN 'ไม่มีเงินดาวน์/ดาวน์น้อย'
    WHEN 'objection_longer_term'        THEN 'ขอผ่อนนานกว่า 12 เดือน'
    WHEN 'objection_competitor_finance' THEN 'เทียบร้านอื่น'
    ELSE kb.intent
  END,
  kb.response_template,
  'text',
  CASE kb.category
    WHEN 'EXTRACTED_OBJECTION' THEN 'ตอบข้อโต้แย้ง (จากแชทเก่า)'
    ELSE 'คำถามพบบ่อย (จากแชทเก่า)'
  END,
  row_number() OVER (PARTITION BY kb.category ORDER BY kb.priority DESC, kb.intent),
  TRUE,
  NOW(),
  NOW()
FROM chat_knowledge_base kb
WHERE kb.category IN ('EXTRACTED', 'EXTRACTED_OBJECTION')
  AND kb.active = TRUE
  AND kb.deleted_at IS NULL
ON CONFLICT (id) DO UPDATE SET
  title      = EXCLUDED.title,
  content    = EXCLUDED.content,
  category   = EXCLUDED.category,
  sort_order = EXCLUDED.sort_order,
  is_active  = TRUE,
  deleted_at = NULL,
  updated_at = NOW();

-- คลังปิดแถวไหนไปแล้ว → ปิด template ที่ sync มาจากแถวนั้นตาม
UPDATE canned_responses SET is_active = FALSE, updated_at = NOW()
WHERE id LIKE 'kb:%'
  AND deleted_at IS NULL
  AND id NOT IN (
    SELECT 'kb:' || intent FROM chat_knowledge_base
    WHERE category IN ('EXTRACTED', 'EXTRACTED_OBJECTION') AND active = TRUE AND deleted_at IS NULL
  );

COMMIT;

SELECT category, count(*) FROM canned_responses
WHERE id LIKE 'kb:%' AND is_active AND deleted_at IS NULL
GROUP BY 1 ORDER BY 1;
