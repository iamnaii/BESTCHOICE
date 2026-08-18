#!/usr/bin/env bash
# ดัมพ์บทสนทนาบอท 7 วันล่าสุด → /tmp/bot-chats-week.txt สำหรับรีวิวคุณภาพรายสัปดาห์
# ใช้: bash scripts/ops/dump-bot-chats-week.sh แล้วเปิด Claude Code สั่ง "รีวิวแชทสัปดาห์"
# (Claude จะอ่านไฟล์นี้ ให้คะแนนเทียบกฎใน persona-live-snapshot.md แล้วเสนอ patch)
set -u
cd "$(dirname "$0")/../.."
PORT=${PORT:-15432}
PROXY_LOG=$(mktemp "${TMPDIR:-/tmp}/sqlproxy.XXXXXX")
PROXY_PID=""
cleanup() { [ -n "$PROXY_PID" ] && kill "$PROXY_PID" 2>/dev/null; PROXY_PID=""; }
trap cleanup EXIT
die() { echo "✗ $*" >&2; exit 1; }

DBURL=$(gcloud secrets versions access latest --secret=DATABASE_URL 2>/dev/null) || die "อ่าน secret ไม่ได้"
PGURL=$(python3 -c "
import re
m=re.match(r'postgresql://([^:]+):([^@]+)@[^/]*/([^?]+)', '''$DBURL''')
print('postgresql://%s:%s@127.0.0.1:$PORT/%s' % (m.group(1), m.group(2), m.group(3)))")
cloud-sql-proxy --port $PORT bestchoice-prod:asia-southeast1:bestchoice-db >"$PROXY_LOG" 2>&1 &
PROXY_PID=$!
for i in $(seq 1 15); do grep -q "ready for new connections" "$PROXY_LOG" 2>/dev/null && break; sleep 1; done
grep -q "ready for new connections" "$PROXY_LOG" || die "proxy ไม่ขึ้น"

OUT=/tmp/bot-chats-week.txt
psql "$PGURL" -At -F $'\t' <<'SQL' > "$OUT"
SELECT r.display_name || ' | ' || to_char(l.created_at AT TIME ZONE 'Asia/Bangkok', 'MM-DD HH24:MI')
  || E'\nลูกค้า: ' || l.customer_message
  || E'\nบอท (' || CASE WHEN l.auto_sent THEN 'ส่ง' ELSE 'ไม่ส่ง:' || coalesce(l.handoff_reason,'') END
  || ', tools=' || array_to_string(l.tools_used, ',') || '): ' || l.ai_reply
  || E'\n────'
FROM ai_auto_reply_logs l JOIN chat_rooms r ON r.id = l.room_id
WHERE l.created_at > NOW() - interval '7 days'
ORDER BY r.id, l.created_at;
SQL
echo "✓ เขียน $OUT ($(wc -l < "$OUT") บรรทัด) — เปิด Claude Code แล้วสั่ง 'รีวิวแชทสัปดาห์'"
