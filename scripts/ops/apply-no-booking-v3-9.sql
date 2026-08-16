-- v3.9 (2026-08-16 คำสั่งเจ้าของ): ยังไม่อยากให้บอทพูด "จองไว้ก่อนได้เลยนะคะ" —
-- ตัดคำชวนจองทุกจุด เหลือบอกสถานะ "ของกำลังเข้ามา" + จังหวะปิดเปลี่ยนเป็น
-- "ของเข้าแล้วแจ้งพี่ทันที" (ไม่สัญญาเรื่องกันเครื่อง/จองคิว)
BEGIN;

-- สคริปต์เทิร์นเรท 4B (ปรากฏ 3 จุด: ตัวอย่าง ✅, กฎ, และ 3-bubble script — string เดียวกัน)
UPDATE system_config SET value = replace(value,
$O$ของกำลังเข้ามาค่ะ จองไว้ก่อนได้เลยนะคะ$O$,
$N$ของกำลังเข้ามาค่ะ$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

-- จังหวะชวนต่อหลังบอกยอดผ่อน (อยู่ใน BASE persona ไม่ใช่ EXTRAS)
UPDATE system_config SET value = replace(value,
$O$"สนใจให้จองเครื่องไว้ไหมคะ" / "เข้ามาดูเครื่องจริงที่ร้านได้เลยนะคะ"$O$,
$N$"สนใจตัวนี้เลยไหมคะ" / "เข้ามาดูเครื่องจริงที่ร้านได้เลยนะคะ"$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_base' AND deleted_at IS NULL;

-- ก้าวถัดไปของโหมดรับออเดอร์
UPDATE system_config SET value = replace(value,
$O$"สนใจให้จองเครื่องที่กำลังเข้ามาไว้เลยไหมคะ"$O$,
$N$"สนใจรับตัวนี้ไหมคะ ของเข้าแล้วแจ้งพี่ทันทีค่า"$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

UPDATE system_config SET value = replace(value,
$O$ไม่มีตัวไหนผ่านเกณฑ์ → ไม่ฝืนเสนอ ปิดที่ชวนจองรอของเข้าอย่างเดียว$O$,
$N$ไม่มีตัวไหนผ่านเกณฑ์ → ไม่ฝืนเสนอ ปิดที่แจ้งว่าของกำลังเข้ามา เดี๋ยวของเข้าแจ้งพี่ทันที$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

UPDATE system_config SET value = replace(value,
$O$โหมดรับออเดอร์ไม่มีเครื่องให้กัน → ชวนจองคิวของที่กำลังเข้าแทน$O$,
$N$โหมดรับออเดอร์ไม่มีเครื่องให้กัน → แจ้งว่าของเข้าแล้วจะรีบแจ้งทันทีแทน$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

-- เสริม: ตัวอย่างเทิร์นเต็มของเคส "รุ่นนอกรายการมือ 1" — eval จับได้ว่าโมเดลทำครบทีละกฎ
-- แต่พลาดตอนต้องรวม 2 กฎ (สคริปต์บังคับ + ถามความจุพร้อมปุ่ม) ในเทิร์นเดียว
UPDATE system_config SET value = replace(value,
$O$"รุ่นนี้มือ 1 ไม่มีผลิตแล้วนะคะ จะเป็นเครื่องมือสองคัดสภาพค่า" แล้วถามขั้นที่เหลือต่อ$O$,
$N$"รุ่นนี้มือ 1 ไม่มีผลิตแล้วนะคะ จะเป็นเครื่องมือสองคัดสภาพค่า" แล้วถามขั้นที่เหลือต่อ**ในเทิร์นเดียวกัน ครบทั้งสองส่วนเสมอ** — ถัดไปคือความจุ: เรียก get_installment_rates ตามกฎขั้น 2 แล้วปิดเทิร์นแบบตัวอย่างนี้:
  "รุ่นนี้มือ 1 ไม่มีผลิตแล้วนะคะ จะเป็นเครื่องมือสองคัดสภาพค่า
  ---
  มี 128GB กับ 256GB ให้เลือกค่า พี่สนใจความจุไหนคะ [ตัวเลือก: 128GB | 256GB]"
  (ห้ามตกส่วนใดส่วนหนึ่ง: ขาดสคริปต์บังคับก็ผิด ถามความจุลอย ๆ ไม่มีตัวเลือก/ปุ่มก็ผิด)$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

COMMIT;

SELECT
  CASE WHEN value NOT LIKE '%จองไว้ก่อนได้เลยนะคะ%' THEN '✓ จองไว้ก่อนหมด' ELSE '✗' END AS booking_gone,
  CASE WHEN value NOT LIKE '%สนใจให้จองเครื่อง%' THEN '✓ ชวนจองหมด(extras)' ELSE '✗' END AS invite_gone,
  CASE WHEN value NOT LIKE '%ชวนจองคิว%' AND value NOT LIKE '%ชวนจองรอของ%' THEN '✓ จองคิวหมด' ELSE '✗' END AS queue_gone,
  CASE WHEN value LIKE '%ของเข้าแล้วแจ้งพี่ทันทีค่า%' THEN '✓ แจ้งเมื่อของเข้า' ELSE '✗' END AS notify_new,
  length(value) AS len
FROM system_config WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;
SELECT CASE WHEN value NOT LIKE '%สนใจให้จองเครื่อง%' THEN '✓ ชวนจองหมด(base)' ELSE '✗ base ยังมีชวนจอง' END AS base_booking
FROM system_config WHERE key = 'shop_bot_persona_base' AND deleted_at IS NULL;
