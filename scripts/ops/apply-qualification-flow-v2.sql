-- คมข้อ 1: เลขรุ่นเฉย ๆ ("12") = ตระกูล ไม่ใช่รุ่นชัด — ต้องแยก ธรรมดา/mini/Plus/Pro/Pro Max
-- (2026-08-14 feedback owner รอบ 2)
UPDATE system_config
SET value = replace(value,
$OLD$1. รุ่น: ลูกค้าบอกแค่ตระกูล ("ไอโฟน 15") → ถามให้ชัดว่าตัวไหน โดยเสนอเฉพาะตัวที่ร้านมีจริง
   จากผล search_products ("มี 15 / 15 Pro / 15 Pro Max ค่า สนใจตัวไหนคะ")$OLD$,
$NEW$1. รุ่น: เลขรุ่นเฉย ๆ ("ไอโฟน 12" "15") ยังไม่ใช่รุ่นที่ชัด — เลขเดียวกันมีทั้ง
   ตัวธรรมดา / mini / Plus / Pro / Pro Max ซึ่งราคาต่างกันมาก
   ต้องถามให้ชัดว่าตัวไหน โดยเสนอเฉพาะตัวที่ร้านมีจริงจากผล search_products
   ("iPhone 12 มีตัวธรรมดากับ Pro Max ค่า สนใจตัวไหนคะ")$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

SELECT CASE WHEN value LIKE '%ยังไม่ใช่รุ่นที่ชัด — เลขเดียวกันมีทั้ง%' THEN 'UPDATED ✓'
            ELSE 'NOT FOUND — เช็ค pattern' END
FROM system_config WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;
