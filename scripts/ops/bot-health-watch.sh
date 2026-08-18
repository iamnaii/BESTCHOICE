#!/usr/bin/env bash
# เฝ้าสุขภาพบอทแบบเรียลไทม์ (ใช้ชั่วโมงแรกหลังเปิดเพจ + ตอนเทสหนัก)
# วนสรุปทุก INTERVAL วินาที (default 600 = 10 นาที): ตอบกี่ครั้ง/กี่ห้อง/บล็อกเพราะอะไร/ความมั่นใจเฉลี่ย
# รัน:  bash scripts/ops/bot-health-watch.sh          (Ctrl+C เพื่อหยุด)
#       INTERVAL=300 bash scripts/ops/bot-health-watch.sh
set -u
cd "$(dirname "$0")/../.."
PORT=${PORT:-15490}
INTERVAL=${INTERVAL:-600}
PROXY_LOG=$(mktemp "${TMPDIR:-/tmp}/sqlproxy.XXXXXX")
PROXY_PID=""
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*"; cleanup; exit 1; }
cleanup() { [ -n "$PROXY_PID" ] && kill "$PROXY_PID" 2>/dev/null; PROXY_PID=""; }
trap cleanup EXIT

command -v cloud-sql-proxy >/dev/null || die "ไม่พบ cloud-sql-proxy"
DBURL=$(gcloud secrets versions access latest --secret=DATABASE_URL 2>/dev/null) || die "อ่าน secret ไม่ได้"
PGURL=$(python3 -c "
import re
m=re.match(r'postgresql://([^:]+):([^@]+)@[^/]*/([^?]+)', '''$DBURL''')
print('postgresql://%s:%s@127.0.0.1:$PORT/%s' % (m.group(1), m.group(2), m.group(3)))")

cloud-sql-proxy --port $PORT bestchoice-prod:asia-southeast1:bestchoice-db >"$PROXY_LOG" 2>&1 &
PROXY_PID=$!
for i in $(seq 1 15); do grep -q "ready for new connections" "$PROXY_LOG" 2>/dev/null && break; sleep 1; done
grep -q "ready for new connections" "$PROXY_LOG" || die "proxy ไม่ขึ้น"

while true; do
  echo "════ $(date '+%H:%M:%S') — สรุปชั่วโมงล่าสุด ════"
  psql "$PGURL" -c "
    SELECT count(*) FILTER (WHERE auto_sent)      AS ตอบแล้ว,
           count(*) FILTER (WHERE NOT auto_sent)  AS โดนบล็อก,
           count(DISTINCT room_id)                AS ห้อง,
           round(avg(confidence)::numeric, 2)     AS ความมั่นใจเฉลี่ย,
           COALESCE(sum(input_tokens), 0)         AS in_tokens,
           COALESCE(sum(output_tokens), 0)        AS out_tokens
    FROM ai_auto_reply_logs WHERE created_at > NOW() - INTERVAL '1 hour';" 2>/dev/null
  psql "$PGURL" -c "
    SELECT COALESCE(handoff_reason,'(ตอบปกติ)') AS เหตุผล, count(*)
    FROM ai_auto_reply_logs WHERE created_at > NOW() - INTERVAL '1 hour'
    GROUP BY 1 ORDER BY 2 DESC LIMIT 6;" 2>/dev/null
  psql "$PGURL" -c "
    SELECT count(*) AS ห้องรอพนักงาน_ต้องตอบ FROM chat_rooms
    WHERE handoff_mode = true AND deleted_at IS NULL
      AND handoff_tagged_at > NOW() - INTERVAL '24 hours';" 2>/dev/null
  sleep "$INTERVAL"
done
