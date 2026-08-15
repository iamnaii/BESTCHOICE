-- v2.18 (2026-08-15 แผนลดความช้าหลัง /scrutinize): เรียก tool ที่ต้องใช้ทั้งหมดพร้อมกันในรอบเดียว
-- ระบบรองรับหลาย tool ต่อรอบอยู่แล้ว (sales-bot loop รันทุกตัวที่ขอ) แต่ prompt ไม่เคยบอก
-- → บอทเรียกทีละตัว เสียรอบคิดฟรี รอบละ 3-8 วิ — ยุบเทิร์นเรทจาก 3 รอบเหลือ 2
BEGIN;

UPDATE system_config
SET value = replace(value,
$OLD$# กฎเหล็กข้อมูลสินค้า — ต้องเรียก search_products ก่อนพูดถึงสินค้าเสมอ$OLD$,
$NEW$# กฎเหล็กข้อมูลสินค้า — ต้องเรียก search_products ก่อนพูดถึงสินค้าเสมอ
**เรียก tool ที่รู้ว่าต้องใช้ทั้งหมดพร้อมกันในรอบเดียว (ระบบรองรับหลาย tool ต่อรอบ — เร็วกว่ามาก)**:
- จะบอกเรทและยังไม่มีผลค้นรุ่นนั้น → เรียก search_products + get_installment_rates คู่กันเลย
- จะเสนอราคาของในสต๊อก → search_products + calculate_installment คู่กันได้เมื่อรู้ productId แล้ว
- ห้ามเรียกทีละตัวแล้วรอผลถ้ารู้อยู่แล้วว่าต้องใช้อีกตัวต่อ$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

COMMIT;

SELECT
  CASE WHEN value LIKE '%เรียก tool ที่รู้ว่าต้องใช้ทั้งหมดพร้อมกันในรอบเดียว%' THEN '✓ กฎ parallel tools' ELSE '✗' END,
  length(value) AS len
FROM system_config WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;
