-- v4.2 (2026-08-17 คำสั่งเจ้าของ): ห้ามพิมพ์คำว่า "เกรด" ให้ลูกค้า — บอก % แบตเตอรี่พอ
-- แยกเครื่องรุ่นเดียวกันด้วย "สี + แบต%" ซึ่งลูกค้าเข้าใจง่ายกว่า
-- หมายเหตุ: tool ยังคืน grade มาตามเดิม (ใช้ภายใน/ให้ทีมงานดู) แค่ห้ามพิมพ์ออกไป
BEGIN;

-- BASE: กฎการ์ด + ตัวอย่าง
UPDATE system_config SET value = replace(value,
$O$- **การ์ดต่อรุ่น/ต่อเกรด/ต่อเรท = 2 บรรทัดตายตัว เรียงเหมือนกันทุกใบ ห้ามสลับ**$O$,
$N$- **ห้ามพิมพ์คำว่า "เกรด" ให้ลูกค้าเด็ดขาด** (แม้ผล tool จะคืนเกรดมาก็ใช้ภายในเท่านั้น) —
  บอกสภาพเครื่องด้วย **% แบตเตอรี่** พอ · มีหลายเครื่องรุ่นเดียวกัน แยกด้วย "สี + แบต%"
  ✅ "iPhone 15 128GB สีชมพู แบต 87%"   ❌ "iPhone 15 128GB เกรด B"
- **การ์ดต่อรุ่น/ต่อเครื่อง/ต่อเรท = 2 บรรทัดตายตัว เรียงเหมือนกันทุกใบ ห้ามสลับ**$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_base' AND deleted_at IS NULL;

UPDATE system_config SET value = replace(value,
$O$  📱 iPhone 15 128GB เกรด B มีของพร้อมรับที่ร้าน$O$,
$N$  📱 iPhone 15 128GB สีชมพู แบต 87% มีของพร้อมรับที่ร้าน$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_base' AND deleted_at IS NULL;

-- EXTRAS: 4 จุด
UPDATE system_config SET value = replace(value,
$O$- **เจอหลายเครื่อง/หลายเกรดของรุ่นที่ลูกค้าต้องการ →$O$,
$N$- **เจอหลายเครื่อง/หลายสภาพของรุ่นที่ลูกค้าต้องการ →$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

UPDATE system_config SET value = replace(value,
$O$  เช่น "เกรด B สีชมพู แบต 87% ดาวน์ 1,750 ผ่อนเดือนละ 1,578 บาท · เกรด A สีฟ้า แบต 92% ดาวน์ 1,990 ผ่อนเดือนละ 1,790 บาท"$O$,
$N$  เช่น "สีชมพู แบต 87% ดาวน์ 1,750 ผ่อนเดือนละ 1,578 บาท · สีฟ้า แบต 92% ดาวน์ 1,990 ผ่อนเดือนละ 1,790 บาท" (ห้ามเอ่ยเกรด)$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

UPDATE system_config SET value = replace(value,
$O$  "📱 iPhone 14 128GB มือสอง เกรด A แบต 90%$O$,
$N$  "📱 iPhone 14 128GB มือสอง แบต 90%$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

UPDATE system_config SET value = replace(value,
$O$เทียบตัวเลือกทุกแบบ (เกรด/สภาพ/ความจุ/มือ 1-มือสอง) ด้วย "ดาวน์ + ผ่อนเดือนละ" จาก calculate_installment เช่น "เกรด B แบต 87% ดาวน์ 1,750 ผ่อนเดือนละ 1,5xx · เกรด A แบต 92% ดาวน์ 1,990 ผ่อนเดือนละ 1,7xx"$O$,
$N$เทียบตัวเลือกทุกแบบ (สภาพ/ความจุ/มือ 1-มือสอง) ด้วย "ดาวน์ + ผ่อนเดือนละ" จาก calculate_installment เช่น "แบต 87% ดาวน์ 1,750 ผ่อนเดือนละ 1,5xx · แบต 92% ดาวน์ 1,990 ผ่อนเดือนละ 1,7xx"$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

-- ── v4.3 (คำสั่งเจ้าของ): bullet point สำหรับ "รายการของ" ให้อ่านง่าย ──
-- หลักฐาน: พนักงานพิมพ์สด 19,452 ข้อความ/30 วัน ใช้ • = 0 ครั้ง (สไตล์แชทไม่ใช้)
-- แต่คลังคำตอบของร้าน (installment_documents) ใช้ • กับรายการเอกสาร/ขั้นตอน → ใช้เฉพาะจุดนั้น
UPDATE system_config SET value = replace(value,
$O$- **ตัดคำเกริ่นทิ้งทุกครั้ง**$O$,
$N$- **ใช้ bullet จุด (•) ได้เฉพาะเวลาบอก "รายการของ" 3 อย่างขึ้นไป** เช่น เอกสารที่ต้องใช้ /
  ขั้นตอนการทำเรื่อง / ของแถม — บรรทัดละ 1 รายการ สูงสุด 4 รายการ ขึ้นต้นด้วย "• " เท่านั้น
  **ห้ามใช้ bullet กับการ์ดสินค้า** (การ์ดมี 📱 นำหน้าอยู่แล้ว ใส่อีกจะรก) และ**ห้ามใช้ขีด (-) นำหน้าบรรทัดเด็ดขาด**
  ตัวอย่างที่ถูก:
  "เอกสารที่ใช้มีแค่นี้เลยค่ะ
  • บัตรประชาชน
  • สเตทเม้นท์ย้อนหลัง 3 เดือน"
- **การ์ดสินค้าต้องอยู่ก้อนของตัวเองเสมอ** — บรรทัดเปิดอยู่ก้อนแรก การ์ดอยู่ก้อนที่สอง
  (ห้ามรวมบรรทัดเปิดกับการ์ดไว้ก้อนเดียวกัน แม้จะมีการ์ดใบเดียว)
- **ตัดคำเกริ่นทิ้งทุกครั้ง**$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_base' AND deleted_at IS NULL;

COMMIT;

SELECT
  CASE WHEN value LIKE '%ห้ามพิมพ์คำว่า "เกรด" ให้ลูกค้าเด็ดขาด%' THEN '✓ กฎห้ามเกรด' ELSE '✗' END AS rule_ok,
  CASE WHEN value NOT LIKE '%เกรด B มีของพร้อมรับ%' THEN '✓ ตัวอย่างแก้แล้ว' ELSE '✗' END AS ex_ok
FROM system_config WHERE key = 'shop_bot_persona_base' AND deleted_at IS NULL;
SELECT count(*) AS จุดที่ยังมีคำว่าเกรด_extras FROM (
  SELECT regexp_matches(value, 'เกรด', 'g') FROM system_config
  WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL) t;
SELECT
  CASE WHEN value LIKE '%ใช้ bullet จุด (•) ได้เฉพาะเวลาบอก%' THEN '✓ กฎ bullet' ELSE '✗' END AS b1,
  CASE WHEN value LIKE '%การ์ดสินค้าต้องอยู่ก้อนของตัวเองเสมอ%' THEN '✓ การ์ดแยกก้อน' ELSE '✗' END AS b2
FROM system_config WHERE key = 'shop_bot_persona_base' AND deleted_at IS NULL;
