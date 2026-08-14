-- อัปเกรดโมเดลบอทขาย Haiku 4.5 → Sonnet 5 (2026-08-14 — Haiku วินัย tool ดีแต่ภาษา/จังหวะขายหยาบ)
-- ต้นทุน (เปิด caching แล้ว): ~5,600-7,300 บาท/เดือน @17k แชท — อยู่ในงบ 10,000
-- ย้อนกลับ Haiku: UPDATE system_config SET value='claude-haiku-4-5-20251001' WHERE key='shop_bot_claude_model';
UPDATE system_config
SET value = 'claude-sonnet-5', updated_at = NOW()
WHERE key = 'shop_bot_claude_model' AND deleted_at IS NULL;

SELECT key, value FROM system_config
WHERE key IN ('shop_bot_llm_provider', 'shop_bot_claude_model') AND deleted_at IS NULL;
