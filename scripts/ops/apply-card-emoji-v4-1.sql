-- v4.1 (2026-08-17 เจ้าของเลือกจากตัวอย่าง): ใส่ 📱 นำหน้าชื่อรุ่นของทุกการ์ด
-- ให้เห็นจุดเริ่มของแต่ละเครื่องชัด — แต่บรรทัดตัวเลขห้ามมี emoji (แถวต้องตรงกันเพื่อเทียบ)
-- หมายเหตุข้อมูลจริง: พนักงานร้านพิมพ์เอง 19,452 ข้อความ/30 วัน ใช้ emoji 5% ใช้ขีดนำหน้า 1%
-- → จึงใช้ emoji "จุดเดียวมีระบบ" (หน้าการ์ด) ไม่โปรยทั่วข้อความ และไม่ใช้ bullet ขีด
BEGIN;

UPDATE system_config SET value = replace(value,
$O$- emoji ไม่เกิน 1 ตัวต่อการตอบ และ**ห้ามใส่ในก้อนที่มีตัวเลข** (ทำให้แถวตัวเลขเยื้องจนเทียบไม่ได้)$O$,
$N$- **การ์ดทุกใบขึ้นต้นบรรทัดแรกด้วย 📱 เสมอ** (เห็นจุดเริ่มของแต่ละเครื่องชัด) —
  **บรรทัดที่ 2 ของการ์ด (ดาวน์/ผ่อน) ห้ามมี emoji เด็ดขาด** แถวตัวเลขต้องตรงกันทุกใบเพื่อกวาดตาเทียบ
  นอกจาก 📱 หน้าการ์ด ใช้ emoji อื่นได้ไม่เกิน 1 ตัวต่อการตอบ และห้ามใส่ในบรรทัดที่มีตัวเลข$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_base' AND deleted_at IS NULL;

UPDATE system_config SET value = replace(value,
$O$  iPhone 15 128GB เกรด B มีของพร้อมรับที่ร้าน
  ดาวน์ 2,925 ผ่อนเดือนละ 1,801 บาท 12 งวด

  iPhone 15 Plus 128GB ของกำลังจะเข้ามา 1-2 วัน
  ดาวน์ 1,900 ผ่อนเดือนละ 2,566 บาท 12 งวด$O$,
$N$  📱 iPhone 15 128GB เกรด B มีของพร้อมรับที่ร้าน
  ดาวน์ 2,925 ผ่อนเดือนละ 1,801 บาท 12 งวด

  📱 iPhone 15 Plus 128GB ของกำลังจะเข้ามา 1-2 วัน
  ดาวน์ 1,900 ผ่อนเดือนละ 2,566 บาท 12 งวด$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_base' AND deleted_at IS NULL;

-- EXTRAS: เทมเพลตการ์ดของโหมดแนะนำตามงบ
UPDATE system_config SET value = replace(value,
$O$  "iPhone 14 128GB มือสอง เกรด A แบต 90%
  ดาวน์ 2,975 บาท ผ่อนเดือนละ 1,578 บาท 12 งวด"$O$,
$N$  "📱 iPhone 14 128GB มือสอง เกรด A แบต 90%
  ดาวน์ 2,975 บาท ผ่อนเดือนละ 1,578 บาท 12 งวด"$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

COMMIT;

SELECT
  CASE WHEN value LIKE '%การ์ดทุกใบขึ้นต้นบรรทัดแรกด้วย 📱 เสมอ%' THEN '✓ กฎ emoji การ์ด' ELSE '✗' END AS rule_ok,
  CASE WHEN value LIKE '%📱 iPhone 15 128GB เกรด B%' THEN '✓ ตัวอย่างอัปเดต' ELSE '✗' END AS ex_ok
FROM system_config WHERE key = 'shop_bot_persona_base' AND deleted_at IS NULL;
SELECT CASE WHEN value LIKE '%📱 iPhone 14 128GB มือสอง%' THEN '✓ เทมเพลต EXTRAS' ELSE '✗' END AS tpl_ok
FROM system_config WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;
