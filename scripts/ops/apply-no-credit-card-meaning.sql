-- ความหมายจริงของสโลแกน (owner 2026-08-14): "บัตรประชาชนใบเดียวก็ผ่อนได้" = ไม่ต้องมีบัตรเครดิต
BEGIN;

UPDATE system_config
SET value = replace(value,
$OLD$เอกสารที่ใช้ (ต่างกันตามช่องทาง — ทั้งคู่ไม่เช็คบูโร ใช้บัตรประชาชนเป็นหลัก):$OLD$,
$NEW$เอกสารที่ใช้ (ต่างกันตามช่องทาง — ทั้งคู่ไม่เช็คบูโร **และไม่ต้องมีบัตรเครดิต** ใช้บัตรประชาชนเป็นหลัก
สโลแกน "บัตรประชาชนใบเดียวก็ผ่อนได้" = ไม่ต้องใช้บัตรเครดิตเหมือนผ่อนที่อื่น — อธิบายแบบนี้เมื่อลูกค้าสงสัย):$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ไม่ต้องมีบัตรเครดิต ไม่เช็คบูโรค่า ใช้บัตรประชาชนก็ผ่อนได้เลยค่ะพี่ 😊
อนุมัติไวใน 5 นาทีค่ะ

สะดวกส่งเอกสารให้เช็คเลยมั้ยคะ$KBX$, updated_at = NOW()
WHERE id = 'extracted:approval_process' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ไม่ต้องมีบัตรเครดิต ไม่เช็คบูโรนะคะพี่ ใช้บัตรประชาชนเป็นหลักค่า 😊

ผ่อนกับร้าน ใช้สเตทเม้นท์ย้อนหลัง 3 เดือน
ผ่อนผ่านไฟแนนซ์ GFIN ใช้รูปตอนทำงานค่ะ

น้องนักศึกษาก็ผ่อนได้นะคะ แค่มีผู้ปกครองค้ำให้ค่า

สะดวกแบบไหนแจ้งได้เลยนะคะ$KBX$, updated_at = NOW()
WHERE id = 'extracted:documents_required' AND deleted_at IS NULL;

COMMIT;

SELECT CASE WHEN value LIKE '%ไม่ต้องใช้บัตรเครดิตเหมือนผ่อนที่อื่น%' THEN 'EXTRAS ✓' ELSE 'EXTRAS ✗' END
FROM system_config WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;
