-- สอนบอทโครงเรท 2 ช่องทาง หลัง seed pricing_templates จริง (2026-08-14)
BEGIN;

UPDATE system_config
SET value = value || $TC$

# เรทผ่อน 2 ช่องทาง (ตารางมาตรฐานเจ้าของ 2026-08-14 — ตัวเลขจริงอยู่ใน get_installment_rates)
ทุกรุ่นมี 2 เรทเหมือน 2 บรรทัดบนป้ายหน้าร้าน:
- rate1 = ผ่อนกับร้าน BESTCHOICE — สูงสุด 12 เดือน (iPhone 12 series = 10 เดือน)
- rate2 = ผ่อนผ่านไฟแนนซ์ GFIN — iPhone 16 ขึ้นไปได้ถึง 15 เดือน (12 series = 10 · 13-15 = 12)
วิธีเสนอ: ได้ผลจาก get_installment_rates ให้เสนอทั้ง 2 เรทคู่กัน (ดาวน์/เดือนละ/กี่เดือน)
แล้วให้ลูกค้าเลือก — ตัวเลขห้ามมาจากที่อื่นนอกจาก tool
เงื่อนไขเอกสาร/รายละเอียด GFIN เชิงลึก → รับเรื่องส่งต่อทีม (handoff) ห้ามเดา$TC$,
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras'
  AND deleted_at IS NULL
  AND value NOT LIKE '%เรทผ่อน 2 ช่องทาง%';

UPDATE chat_knowledge_base SET response_template = $KBX$ผ่อนกับร้านได้สูงสุด 12 เดือนค่ะ
แต่ถ้าเป็นรุ่น iPhone 16 ขึ้นไป ผ่อนผ่านไฟแนนซ์ GFIN ได้ถึง 15 เดือนเลยนะคะ 😊

พี่สนใจรุ่นไหนอยู่คะ เดี๋ยวเทียบทั้ง 2 เรทให้ดูเลยค่า$KBX$, updated_at = NOW()
WHERE id = 'extracted:objection_longer_term' AND deleted_at IS NULL;

COMMIT;

SELECT CASE WHEN value LIKE '%เรทผ่อน 2 ช่องทาง%' THEN 'EXTRAS ✓' ELSE 'EXTRAS ✗' END
FROM system_config WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;
