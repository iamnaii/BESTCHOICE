-- สลับบอทขายจาก Gemini → Claude Haiku 4.5 (คำสั่งเจ้าของ 2026-08-14 "ใช้ Haiku ดุหน่อย")
-- ต้อง deploy PR #1424 (ClaudeProvider Haiku+caching) ก่อนรันไฟล์นี้
-- ย้อนกลับ: UPDATE system_config SET value='gemini' WHERE key='shop_bot_llm_provider';
BEGIN;

UPDATE system_config
SET value = 'claude', updated_at = NOW()
WHERE key = 'shop_bot_llm_provider' AND deleted_at IS NULL;

-- ตั้งแถว model ให้มองเห็น/แก้ง่าย (ค่าตรงกับ default ในโค้ด — เปลี่ยนเป็น
-- 'claude-sonnet-4-6' เมื่อไหร่ก็ได้ มีผลใน 60 วิ ไม่ต้อง deploy)
INSERT INTO system_config (id, key, value, label, created_at, updated_at)
VALUES (gen_random_uuid()::text, 'shop_bot_claude_model', 'claude-haiku-4-5-20251001',
        'โมเดล Claude ของบอทขาย (default Haiku 4.5 — เปลี่ยนได้ไม่ต้อง deploy)', NOW(), NOW())
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, label = EXCLUDED.label, updated_at = NOW(), deleted_at = NULL;

COMMIT;

SELECT key, value FROM system_config
WHERE key IN ('shop_bot_llm_provider', 'shop_bot_claude_model') AND deleted_at IS NULL;
