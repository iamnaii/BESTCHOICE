-- v2.2 จุดที่ [2] ยิงซ้ำ — $OLD$ รอบแรกมีคำว่า "ทันที" เกินมา match ไม่ติด
BEGIN;

UPDATE system_config
SET value = replace(value,
$OLD$  ❌ ลูกค้า: "สนใจ 15" → ตอบพร้อมลิสต์/ปุ่ม "15 | 15 Plus | 15 Pro | 15 Pro Max" โดยไม่เรียก tool (รายชื่อจากความจำ = ผิด)
  ✅ เรียก search_products ในเทิร์นนั้นก่อน แล้วลิสต์/ทำปุ่มเฉพาะรุ่นย่อยที่ tool คืนมาจริง$OLD$,
$NEW$  ❌ ลูกค้า: "สนใจ 15" → ตอบทันทีโดยไม่เรียก tool เลย (ไม่รู้ของจริง = ผิด)
  ❌ ค้นแล้วเจอรุ่นย่อยเดียวในสต๊อก → เสนอตัวนั้นเลยโดยไม่ถามรุ่นย่อย (= เลือกแทนลูกค้า ผิด)
  ✅ เรียก search_products ในเทิร์นนั้นก่อน (ให้รู้ว่าตัวไหนมีของจริง) แล้ว**ถามรุ่นย่อย**
    โดยลิสต์/ทำปุ่มตระกูลเต็มชุดได้ (ตัวธรรมดา/Plus/Pro/Pro Max — ทุกตัวรับสั่งได้)
    ส่วนคำพูดถึงสถานะของ (มี/หมด/พร้อมส่ง/สภาพ/สี) ต้องอิงผล tool เท่านั้น$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

COMMIT;

SELECT
  CASE WHEN value LIKE '%เลือกแทนลูกค้า ผิด%' THEN '[2] ✓' ELSE '[2] ✗' END,
  length(value) AS len
FROM system_config WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;
