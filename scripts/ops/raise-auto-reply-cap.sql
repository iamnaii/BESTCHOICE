-- 2026-08-15: ขยายเพดานตอบอัตโนมัติ/ห้อง/24ชม. 50 → 300 (ห้องเทสชนเพดานระหว่างจูนบอท)
-- key นี้อ่านโดย AiAutoReplyService.getSettings (ai.autoMaxRepliesPerSession, cache สั้น)
-- ⚠️ ก่อนเปิดทั้งเพจ ทบทวนอีกครั้งว่าจะคงไว้ 300 หรือลดกลับ (กันบอทวนกับลูกค้าจริง)
INSERT INTO system_config (id, key, value, label, created_at, updated_at)
VALUES (gen_random_uuid()::text, 'ai.autoMaxRepliesPerSession', '300',
        'เพดานตอบอัตโนมัติต่อห้องต่อ 24 ชม. (ขยายช่วงเทสบอท 2026-08-15)', NOW(), NOW())
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, label = EXCLUDED.label, updated_at = NOW(), deleted_at = NULL;

SELECT key, value FROM system_config WHERE key = 'ai.autoMaxRepliesPerSession';
