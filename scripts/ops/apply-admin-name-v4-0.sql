-- v4.0 ส่วนที่ 1 (2026-08-17 คำสั่งเจ้าของ): เลิกใช้ชื่อ "น้องเบส" → เรียกตัวเองว่า "แอดมิน"
-- (ฝั่งบอทการเงิน LINE + label ในหน้าตั้งค่า แก้ในโค้ดแล้ว — ไฟล์นี้คือฝั่งบอทขาย + คลังคำตอบ)
BEGIN;

UPDATE system_config SET value = replace(value,
$O$คุณคือ "น้องเบส" แอดมินหญิงของร้าน BESTCHOICE$O$,
$N$คุณคือแอดมินหญิงของร้าน BESTCHOICE$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_base' AND deleted_at IS NULL;

-- กันโมเดลไปหยิบชื่อเล่นเก่ามาใช้เอง + บอกวิธีเรียกตัวเองให้ชัด
UPDATE system_config SET value = replace(value,
$O$ตอบลูกค้าทาง Facebook / LINE ให้เหมือนแอดมินคนจริงที่ขายเก่ง ใจดี และรู้จริงเรื่อง iPhone$O$,
$N$ตอบลูกค้าทาง Facebook / LINE ให้เหมือนแอดมินคนจริงที่ขายเก่ง ใจดี และรู้จริงเรื่อง iPhone
เรียกตัวเองว่า "แอดมิน" เท่านั้น (เช่น "เดี๋ยวแอดมินเช็คให้นะคะ") — ไม่มีชื่อเล่น ห้ามตั้งชื่อตัวเอง
ลูกค้าถามว่าคุยกับใคร/ชื่ออะไร → "แอดมินร้าน BESTCHOICE ค่ะ" ห้ามบอกว่าเป็นบอท/AI$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_base' AND deleted_at IS NULL;

-- คลังคำตอบฝั่ง LINE การเงิน
UPDATE chat_knowledge_base SET response_template = replace(response_template, 'น้องเบส', 'แอดมิน'), updated_at = NOW()
WHERE response_template LIKE '%น้องเบส%' AND deleted_at IS NULL;

COMMIT;

SELECT
  CASE WHEN value NOT LIKE '%น้องเบส%' THEN '✓ base ไม่มีน้องเบสแล้ว' ELSE '✗' END AS base_ok,
  CASE WHEN value LIKE '%เรียกตัวเองว่า "แอดมิน" เท่านั้น%' THEN '✓ กฎเรียกตัวเอง' ELSE '✗' END AS rule_ok
FROM system_config WHERE key = 'shop_bot_persona_base' AND deleted_at IS NULL;
SELECT count(*) AS kb_rows_left_with_old_name FROM chat_knowledge_base WHERE response_template LIKE '%น้องเบส%' AND deleted_at IS NULL;
SELECT count(*) AS config_rows_left FROM system_config WHERE value LIKE '%น้องเบส%' AND deleted_at IS NULL;
