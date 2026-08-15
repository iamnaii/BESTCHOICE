-- v2.20 (2026-08-15 — จับได้จาก bot-eval S2): Objection 7 ยังสั่ง "ถามรุ่นก่อน (กฎบนสุด)"
-- ชนกับ v2.17 (ถามราคา/ดาวน์โดยไม่บอกรุ่น = ถามงบดาวน์ก่อน) — บอทเลยเด้ง "รุ่นไหนคะ" อยู่
BEGIN;

UPDATE system_config
SET value = replace(value,
$OLD$   ถ้ายังไม่มีผล tool เลย → ถามรุ่นก่อน (กฎบนสุด) แล้วค่อยเรียก tool มาตอบ$OLD$,
$NEW$   ถ้ายังไม่มีผล tool เลย → ใช้กติกา "ยังไม่บอกรุ่น" ข้างบน: ถามเรื่องราคา/ดาวน์/ค่างวด
   = **ถามงบดาวน์ก่อน** ("พี่มีงบดาวน์ประมาณเท่าไหร่คะ") ไม่ใช่เด้งถามรุ่น$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

COMMIT;

SELECT
  CASE WHEN value NOT LIKE '%ถามรุ่นก่อน (กฎบนสุด)%' THEN '✓ ล้างกฎเก่าหมด' ELSE '✗ ยังเหลือ' END,
  length(value) AS len
FROM system_config WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;
