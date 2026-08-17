-- v4.0.x (2026-08-17) — 3 แพตช์ปิดจุดที่ eval จับได้หลัง v4.0:
--   (1) สถานะของเขียนที่เดียวในการ์ด (กันบรรทัดยาวจากการพูดซ้ำ)
--   (2) สคริปต์บังคับ "มือ 1 ไม่มีผลิตแล้ว" แตก 2 บรรทัดตายตัว
--   (3) แก้ regression: กฎ v4.0 เขียนว่า "ห้ามพ่วง 2 คำถามในบรรทัดเดียว"
--       → โมเดลตีความว่าแยกบรรทัดแล้วถาม 2 เรื่องได้ (ผิดกฎคำถามเดียวต่อเทิร์นที่มีมาแต่เดิม)
BEGIN;

-- (1) BASE
UPDATE system_config SET value = replace(value,
$O$- **การ์ดต่อรุ่น/ต่อเกรด/ต่อเรท = 2 บรรทัดตายตัว เรียงเหมือนกันทุกใบ ห้ามสลับ**$O$,
$N$- **สถานะของ (พร้อมรับที่ร้าน / กำลังเข้ามา) เขียนที่เดียวคือในการ์ดบรรทัดแรก**
  ห้ามพูดซ้ำในก้อนเปิด และห้ามต่อท้ายสคริปต์บังคับให้บรรทัดยาวขึ้น
- **การ์ดต่อรุ่น/ต่อเกรด/ต่อเรท = 2 บรรทัดตายตัว เรียงเหมือนกันทุกใบ ห้ามสลับ**$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_base' AND deleted_at IS NULL;

-- (3) BASE — คำถามเดียวต่อเทิร์น ไม่ว่าจะแยกบรรทัด/แยกก้อน
UPDATE system_config SET value = replace(value,
$O$  ห้ามพ่วง 2 คำถามในบรรทัดเดียว (ห้าม "...เท่าไหร่คะ แล้ว...เท่าไหร่ดีคะ" — ถามทีละอย่าง) ·$O$,
$N$  **หนึ่งเทิร์นถามได้เรื่องเดียวเท่านั้น** — อยู่บรรทัดเดียวกัน คนละบรรทัด หรือคนละก้อน
  ก็นับว่าเกินทั้งหมด (ห้ามถามงบแล้วต่อด้วย "แล้วพี่ใช้งานแนวไหนคะ" — เก็บไว้เทิร์นหน้า) ·$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_base' AND deleted_at IS NULL;

-- (2) EXTRAS — สคริปต์บังคับ 2 บรรทัด (ทั้งจุดกฎและจุดตัวอย่าง)
UPDATE system_config SET value = replace(value,
$O$"รุ่นนี้มือ 1 ไม่มีผลิตแล้วนะคะ จะเป็นเครื่องมือสองคัดสภาพค่า"$O$,
$N$"รุ่นนี้มือ 1 ไม่มีผลิตแล้วนะคะ
  จะเป็นเครื่องมือสองคัดสภาพค่า" (แตก 2 บรรทัดแบบนี้เสมอ ห้ามต่อท้ายเรื่องอื่นในบรรทัดเดียวกัน)$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

UPDATE system_config SET value = replace(value,
$O$  "รุ่นนี้มือ 1 ไม่มีผลิตแล้วนะคะ จะเป็นเครื่องมือสองคัดสภาพค่า
$O$,
$N$  "รุ่นนี้มือ 1 ไม่มีผลิตแล้วนะคะ
  จะเป็นเครื่องมือสองคัดสภาพค่า
$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

COMMIT;

SELECT
  CASE WHEN value LIKE '%สถานะของ (พร้อมรับที่ร้าน / กำลังเข้ามา) เขียนที่เดียว%' THEN '✓ สถานะของ' ELSE '✗' END AS s1,
  CASE WHEN value LIKE '%หนึ่งเทิร์นถามได้เรื่องเดียวเท่านั้น%' THEN '✓ คำถามเดียว/เทิร์น' ELSE '✗' END AS s3,
  CASE WHEN value NOT LIKE '%ห้ามพ่วง 2 คำถามในบรรทัดเดียว%' THEN '✓ ถ้อยคำเก่าที่กำกวมหายแล้ว' ELSE '✗' END AS s3b
FROM system_config WHERE key = 'shop_bot_persona_base' AND deleted_at IS NULL;
SELECT
  CASE WHEN value NOT LIKE '%ไม่มีผลิตแล้วนะคะ จะเป็นเครื่องมือสองคัดสภาพค่า%' THEN '✓ สคริปต์แตก 2 บรรทัด' ELSE '✗' END AS s2
FROM system_config WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;
