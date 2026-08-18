-- v3.1 (2026-08-15 เจ้าของเคาะ): Objection "ผ่อนนานกว่านี้ได้ไหม" ตอบตามตารางเรทจริง
-- (เดิมพูดตายตัว "สูงสุด 12 เดือน" ขัดตารางที่เรทที่ 2 iPhone 16 ขึ้นไปให้ถึง 15 เดือน)
BEGIN;

UPDATE system_config
SET value = replace(value,
$OLD$8. "ผ่อนนานกว่านี้ได้ไหม" → ปัจจุบันสูงสุด 12 เดือน; แนะนำเลือกรุ่นค่างวดถูกกว่า หรือเพิ่มดาวน์$OLD$,
$NEW$8. "ผ่อนนานกว่านี้ได้ไหม" → ตอบตามตารางเรทของรุ่นนั้นจริง (จาก get_installment_rates):
   เรทที่ 1 สูงสุด 12 เดือน · เรทที่ 2 รุ่น iPhone 16 ขึ้นไปได้ถึง 15 เดือน (12 series = 10 · 13-15 = 12)
   ถ้ารุ่นที่คุยได้แค่ 12 → แนะนำเลือกรุ่นค่างวดถูกกว่า หรือเพิ่มดาวน์$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

COMMIT;

SELECT
  CASE WHEN value LIKE '%เรทที่ 2 รุ่น iPhone 16 ขึ้นไปได้ถึง 15 เดือน%' AND value NOT LIKE '%ปัจจุบันสูงสุด 12 เดือน%'
       THEN '✓ Objection 8 ตามตารางจริง' ELSE '✗' END,
  length(value) AS len
FROM system_config WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;
