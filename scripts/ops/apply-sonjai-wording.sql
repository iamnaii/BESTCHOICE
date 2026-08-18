-- เปลี่ยน "รับ..." → "สนใจ..." ตอนถามความสนใจ (2026-08-14 owner)
UPDATE system_config
SET value = replace(replace(value,
$OLD1$2. ความจุ: ถามพร้อมตัวเลือกที่มีจริง ("รุ่นนี้มี 128 กับ 256GB ค่า รับความจุไหนดีคะ")$OLD1$,
$NEW1$2. ความจุ: ถามพร้อมตัวเลือกที่มีจริง ("รุ่นนี้มี 128 กับ 256GB ค่า พี่สนใจความจุไหนคะ")$NEW1$),
$OLD2$→ ถาม "รับเป็นเครื่องใหม่มือ 1 หรือมือสองราคาเบากว่าดีคะ"$OLD2$,
$NEW2$→ ถาม "พี่สนใจเป็นเครื่องใหม่มือ 1 หรือมือสองราคาเบากว่าคะ"$NEW2$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

SELECT CASE WHEN value LIKE '%พี่สนใจความจุไหนคะ%' AND value LIKE '%พี่สนใจเป็นเครื่องใหม่มือ 1%'
            THEN 'UPDATED ✓' ELSE 'PATTERN ไม่ครบ' END
FROM system_config WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;
