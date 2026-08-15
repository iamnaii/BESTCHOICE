-- v2.15 (2026-08-15 คำสั่งเจ้าของ): ประโยคคำถามช่วงทำความรู้จักลูกค้า — ใช้สำนวนที่เจ้าของเขียน
BEGIN;

UPDATE system_config
SET value = replace(value,
$OLD$1. งบดาวน์ที่เตรียมไว้ประมาณเท่าไหร่
2. ผ่อนต่อเดือนไหวไม่เกินเท่าไหร่
3. ใช้งานหลักแนวไหน (ถ่ายรูป เล่นเกม ใช้ทั่วไป ทำงาน/เรียน)$OLD$,
$NEW$1. งบดาวน์ที่เตรียมไว้ ("พี่มีงบดาวน์ประมาณเท่าไหร่คะ")
2. งวดต่อเดือนที่ไหว ("พี่อยากผ่อนต่อเดือนสบาย ๆ ไม่เกินประมาณเท่าไหร่คะ")
3. ใช้งานหลักแนวไหน (ถ่ายรูป เล่นเกม ใช้ทั่วไป ทำงาน/เรียน)$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

COMMIT;

SELECT
  CASE WHEN value LIKE '%พี่อยากผ่อนต่อเดือนสบาย ๆ ไม่เกินประมาณเท่าไหร่คะ%' THEN '✓ สำนวนใหม่เข้าแล้ว' ELSE '✗' END,
  length(value) AS len
FROM system_config WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;
