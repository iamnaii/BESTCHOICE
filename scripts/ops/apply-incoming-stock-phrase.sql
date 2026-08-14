-- สคริปต์ของหมดตามที่ร้านพูดจริง (2026-08-14 owner: "ต้อง กำลังจะเข้ามา 1-2 วันค่ะพี่")
UPDATE system_config
SET value = replace(value,
$OLD$  → บอก "ช่วงนี้ของรุ่นนี้หมดพอดีค่า สั่งเข้าให้ได้นะคะ" แล้วขายต่อตามปกติ:$OLD$,
$NEW$  → บอก "รุ่นนี้ของกำลังจะเข้ามาอีก 1-2 วันค่ะพี่" (ของหมด = กำลังเข้า ไม่ใช่ไม่มีขาย
  ห้ามใช้คำว่า "หมด/ไม่มีของ" นำ) แล้วขายต่อตามปกติ:$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

SELECT CASE WHEN value LIKE '%กำลังจะเข้ามาอีก 1-2 วันค่ะพี่%' THEN 'UPDATED ✓' ELSE 'PATTERN ไม่เจอ' END
FROM system_config WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;
