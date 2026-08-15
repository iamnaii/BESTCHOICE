-- รายงานบอทขายรายสัปดาห์ (7 วันล่าสุด) — รันผ่าน bot-weekly-report.sh
-- 1) ปริมาณ + ผลลัพธ์
SELECT
  count(*) AS bot_attempts,
  count(*) FILTER (WHERE auto_sent) AS replies_sent,
  count(*) FILTER (WHERE NOT auto_sent) AS blocked_or_lowconf,
  round(avg(confidence)::numeric, 2) AS avg_confidence,
  count(DISTINCT room_id) AS rooms
FROM ai_auto_reply_logs
WHERE created_at > NOW() - interval '7 days';

-- 2) lead ที่บอทเก็บได้
SELECT count(*) AS leads_captured
FROM audit_logs
WHERE action = 'AI_LEAD_CAPTURED' AND created_at > NOW() - interval '7 days';

-- 3) ห้องที่ส่งต่อพนักงาน (แยกเหตุผล)
SELECT handoff_reason, count(*)
FROM chat_rooms
WHERE handoff_mode = TRUE AND updated_at > NOW() - interval '7 days'
GROUP BY 1 ORDER BY 2 DESC;

-- 4) token + ประมาณการต้นทุน (Sonnet 5: in $2/M รวม cache-mix ประเมินหยาบ 0.5, out $10/M, FX 33.1)
SELECT
  sum(input_tokens) AS tokens_in,
  sum(output_tokens) AS tokens_out,
  round(((sum(input_tokens) / 1000000.0) * 2 * 0.5 + (sum(output_tokens) / 1000000.0) * 10) * 33.1) AS est_cost_thb_capped
FROM ai_auto_reply_logs
WHERE created_at > NOW() - interval '7 days' AND input_tokens IS NOT NULL;

-- 5) เพดานตอบ/วัน โดนชนไหม (ห้องที่ใกล้เพดาน 300)
SELECT r.display_name, count(*) AS sent_24h
FROM ai_auto_reply_logs l JOIN chat_rooms r ON r.id = l.room_id
WHERE l.auto_sent AND l.created_at > NOW() - interval '24 hours'
GROUP BY 1 HAVING count(*) > 200 ORDER BY 2 DESC;
