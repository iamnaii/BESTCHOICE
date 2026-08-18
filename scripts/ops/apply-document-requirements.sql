-- เอกสารตามช่องทาง + เงื่อนไขนักศึกษา (owner กำหนด 2026-08-14):
-- BESTCHOICE = สเตทเม้นท์ย้อนหลัง 3 เดือน · GFIN = รูปตอนทำงาน · นักศึกษาผ่อนได้ทั้งคู่แต่ผู้ปกครองค้ำ
BEGIN;

-- 1) เติมเอกสารเข้าบล็อกเรท 2 ช่องทางใน BOT_EXTRAS
UPDATE system_config
SET value = replace(value,
$OLD$เงื่อนไขเอกสาร/รายละเอียด GFIN เชิงลึก → รับเรื่องส่งต่อทีม (handoff) ห้ามเดา$OLD$,
$NEW$เอกสารที่ใช้ (ต่างกันตามช่องทาง — ทั้งคู่ไม่เช็คบูโร ใช้บัตรประชาชนเป็นหลัก):
- ผ่อนกับร้าน BESTCHOICE: สเตทเม้นท์ย้อนหลัง 3 เดือน
- ผ่อนผ่าน GFIN: รูปตอนทำงาน (เช่น ใส่ยูนิฟอร์ม/หน้างาน)
- นักศึกษา: ผ่อนได้ทั้ง 2 ช่องทาง แต่ต้องมีผู้ปกครองค้ำประกัน
รายละเอียดเชิงลึกกว่านี้ → รับเรื่องส่งต่อทีม (handoff) ห้ามเดา$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

-- 2) แก้ไลน์ "เรื่องที่ถามบ่อย: เอกสาร" ใน Prompt B ให้ตรงของจริง
UPDATE system_config
SET value = replace(value,
$OLD$- เอกสาร → บอกให้ครบว่าใช้อะไรบ้าง + ย้ำ "บัตรประชาชนใบเดียว ไม่เช็คบูโร"$OLD$,
$NEW$- เอกสาร → ย้ำ "ไม่เช็คบูโร" + บอกตามช่องทาง: ร้าน=สเตทเม้นท์ย้อนหลัง 3 เดือน /
  GFIN=รูปตอนทำงาน / นักศึกษาผ่อนได้ทั้งคู่ (ผู้ปกครองค้ำ)$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

-- 3) คลังคำตอบ: เอกสารที่ใช้
UPDATE chat_knowledge_base SET response_template = $KBX$ไม่เช็คบูโรนะคะพี่ ใช้บัตรประชาชนเป็นหลักค่า 😊

ผ่อนกับร้าน ใช้สเตทเม้นท์ย้อนหลัง 3 เดือน
ผ่อนผ่านไฟแนนซ์ GFIN ใช้รูปตอนทำงานค่ะ

น้องนักศึกษาก็ผ่อนได้นะคะ แค่มีผู้ปกครองค้ำให้ค่า

สะดวกแบบไหนแจ้งได้เลยนะคะ$KBX$, updated_at = NOW()
WHERE id = 'extracted:documents_required' AND deleted_at IS NULL;

-- 4) คลังคำตอบ: การอนุมัติ (ตัด "บัตรใบเดียวก็ผ่านได้" ที่ชนกับเอกสารจริง)
UPDATE chat_knowledge_base SET response_template = $KBX$ไม่เช็คบูโรค่า อนุมัติไวใน 5 นาทีค่ะพี่ 😊
สะดวกส่งเอกสารให้เช็คเลยมั้ยคะ$KBX$, updated_at = NOW()
WHERE id = 'extracted:approval_process' AND deleted_at IS NULL;

COMMIT;

SELECT CASE WHEN value LIKE '%สเตทเม้นท์ย้อนหลัง 3 เดือน%' AND value LIKE '%ผู้ปกครองค้ำประกัน%'
            THEN 'EXTRAS ✓' ELSE 'EXTRAS ✗' END
FROM system_config WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;
