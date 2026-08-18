-- v2.6 (2026-08-14): คำถามแยกรุ่นย่อยต้องลิสต์ตระกูล "เต็มชุดเสมอ" ไม่ใช่เฉพาะตัวในสต๊อก
-- เทสจริง 18:43: บอทถาม "มีตัวธรรมดา กับ Pro Max" (2 ตัวที่ค้นเจอ) — ลอกแพทเทิร์นจาก
-- ตัวอย่างปุ่ม "iPhone 12 → [12 | 12 Pro Max]" ใน prompt เอง + กฎเขียนว่า "ลิสต์เต็มชุดได้"
-- (ได้ = ทางเลือก) → แก้เป็น "ต้อง" ทุกจุด + เปลี่ยนตัวอย่างเป็นเต็มชุด
BEGIN;

-- [1] ✅ ในกฎเหล็กข้อมูลสินค้า: ได้ → ต้อง
UPDATE system_config
SET value = replace(value,
$OLD$    โดยลิสต์/ทำปุ่มตระกูลเต็มชุดได้ (ตัวธรรมดา/Plus/Pro/Pro Max — ทุกตัวรับสั่งได้)
    ส่วนคำพูดถึงสถานะของ (มี/หมด/พร้อมส่ง/สภาพ/สี) ต้องอิงผล tool เท่านั้น$OLD$,
$NEW$    โดย**ต้อง**ลิสต์/ทำปุ่มตระกูลเต็มชุดครบทุกตัว (ตัวธรรมดา/Plus/Pro/Pro Max — ทุกตัวรับสั่งได้)
    ❌ ค้นเจอ 2 ตัวในสต๊อก → ถาม "มีตัวธรรมดากับ Pro Max สนใจตัวไหน" (ลิสต์เฉพาะที่มี = ผิด ตัวอื่นก็สั่งได้)
    ส่วนคำพูดถึงสถานะของ (มี/หมด/พร้อมส่ง/สภาพ/สี) ต้องอิงผล tool เท่านั้น$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

-- [2] ลำดับถามก่อนเสนอราคา ข้อ 1: ได้ → ต้อง
UPDATE system_config
SET value = replace(value,
$OLD$   ลิสต์รุ่นย่อยของตระกูลนั้นให้เลือกได้เต็มชุด — ชื่อรุ่นย่อยของตระกูลเป็นความรู้ทั่วไป$OLD$,
$NEW$   **ต้องลิสต์รุ่นย่อยของตระกูลนั้นเต็มชุดครบทุกตัวเสมอ แม้ในสต๊อกจะมีแค่บางตัว** — ชื่อรุ่นย่อยของตระกูลเป็นความรู้ทั่วไป$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

-- [3] ตัวอย่างปุ่ม: เปลี่ยนจาก "2 ตัวที่ค้นเจอ" เป็นเต็มชุด (ต้นตอที่บอทลอกแพทเทิร์น)
UPDATE system_config
SET value = replace(value,
$OLD$ตัวอย่าง (รายชื่อปุ่มต้องมาจากผล search_products ของบทสนทนานี้เท่านั้น — สมมติ tool คืน 2 รุ่นย่อย):
iPhone 12 มีตัวธรรมดากับ Pro Max ค่า สนใจตัวไหนคะ
[ตัวเลือก: 12 | 12 Pro Max]$OLD$,
$NEW$ตัวอย่าง (คำถามแยกรุ่นย่อย — ปุ่มตระกูลเต็มชุดเสมอ ทุกตัวรับสั่งได้ ห้ามตัดเหลือเฉพาะตัวที่มีในสต๊อก):
iPhone 15 มีตัวธรรมดา / Plus / Pro / Pro Max ค่า พี่สนใจตัวไหนคะ
[ตัวเลือก: 15 | 15 Plus | 15 Pro | 15 Pro Max]$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

COMMIT;

-- ตรวจผล: ต้อง ✓ ทั้ง 3
SELECT
  CASE WHEN value LIKE '%ลิสต์เฉพาะที่มี = ผิด%' THEN '[1] ✓' ELSE '[1] ✗' END,
  CASE WHEN value LIKE '%เต็มชุดครบทุกตัวเสมอ แม้ในสต๊อกจะมีแค่บางตัว%' THEN '[2] ✓' ELSE '[2] ✗' END,
  CASE WHEN value LIKE '%[ตัวเลือก: 15 | 15 Plus | 15 Pro | 15 Pro Max]%' THEN '[3] ✓' ELSE '[3] ✗' END,
  length(value) AS len
FROM system_config WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;
