-- v5.0 (2026-08-17 คำสั่งเจ้าของ): บอก "สี" ที่มีด้วย แต่ต้องไม่ทำให้ข้อความยาวขึ้น
-- เดิม: กฎการ์ดเขียน "สภาพ/แบต" (ไม่มีคำว่าสี) → บอทมักตัดสีทิ้งทั้งที่ tool ส่งมาให้
BEGIN;

-- BASE: การ์ดบรรทัด 1 ต้องมีสีด้วย + กติกากันยาวเมื่อมีหลายสี
UPDATE system_config SET value = replace(value,
$O$  บรรทัด 1: ชื่อรุ่นเต็ม + ความจุ + สภาพ/แบต + สถานะของ
  บรรทัด 2: "ดาวน์ X ผ่อนเดือนละ Y บาท Z งวด"$O$,
$N$  บรรทัด 1: ชื่อรุ่นเต็ม + ความจุ + **สี** + แบต% + สถานะของ (ใส่สีทุกครั้งที่ผล tool มีสี ห้ามตัดทิ้ง)
  บรรทัด 2: "ดาวน์ X ผ่อนเดือนละ Y บาท Z งวด"$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_base' AND deleted_at IS NULL;

-- BASE: กันยาวเมื่อรุ่น+ความจุเดียวกันมีหลายสี
UPDATE system_config SET value = replace(value,
$O$  **ห้ามมีบรรทัดที่ 3 ในการ์ดเด็ดขาด**$O$,
$N$  **หลายเครื่องรุ่น+ความจุเดียวกันต่างแค่สี และดาวน์/ค่างวดเท่ากัน → ทำการ์ดเดียว**
  แล้วบอกสีรวมท้ายบรรทัดแรกว่า "มีสีชมพู ฟ้า ดำ" (ห้ามทำการ์ดแยกทุกสี = ยาวโดยเปล่าประโยชน์)
  · ราคาต่างกัน → แยกการ์ดตามปกติ (สูงสุด 2 ใบ) โดยแต่ละใบระบุสีของตัวเอง
  **ห้ามมีบรรทัดที่ 3 ในการ์ดเด็ดขาด**$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_base' AND deleted_at IS NULL;

-- EXTRAS: ย้ำว่าสีมาจาก tool เท่านั้น (โหมดตารางเรทไม่มีสี ห้ามเดา)
UPDATE system_config SET value = replace(value,
$O$- **เอ่ยชื่อรุ่นที่ match เต็ม ๆ ตามที่ tool คืน (brand + model + storage) ทุกครั้ง$O$,
$N$- **สีบอกได้เฉพาะที่ผล search_products คืนมาเท่านั้น** — โหมดรับออเดอร์ (ตารางเรท) ไม่มีข้อมูลสี
  ห้ามเดา/ห้ามพูดว่ามีสีอะไร · ลูกค้าถามสีในโหมดนี้ → "เดี๋ยวเช็คสีที่เข้ามาให้อีกทีนะคะ"
- **เอ่ยชื่อรุ่นที่ match เต็ม ๆ ตามที่ tool คืน (brand + model + storage) ทุกครั้ง$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

COMMIT;

SELECT
  CASE WHEN value LIKE '%+ **สี** + แบต% + สถานะของ%' THEN '✓ การ์ดมีสี' ELSE '✗' END AS s1,
  CASE WHEN value LIKE '%ต่างแค่สี และดาวน์/ค่างวดเท่ากัน → ทำการ์ดเดียว%' THEN '✓ กันยาวเมื่อหลายสี' ELSE '✗' END AS s2
FROM system_config WHERE key = 'shop_bot_persona_base' AND deleted_at IS NULL;
SELECT CASE WHEN value LIKE '%สีบอกได้เฉพาะที่ผล search_products คืนมาเท่านั้น%' THEN '✓ ห้ามเดาสี' ELSE '✗' END AS s3
FROM system_config WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;
