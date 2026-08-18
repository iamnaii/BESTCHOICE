#!/usr/bin/env bash
# อ่านอย่างเดียว: ดัมพ์ canned_responses ที่ไม่ได้มาจาก sync คลังคำตอบ (id ไม่ใช่ kb:%)
# รวม bubbles ของแต่ละอัน — เอาไว้ตรวจเสียง persona
set -u
cd "$(dirname "$0")/../.."
PORT=${PORT:-15432}
PROXY_LOG=$(mktemp "${TMPDIR:-/tmp}/sqlproxy.XXXXXX")
PROXY_PID=""
cleanup() { [ -n "$PROXY_PID" ] && kill "$PROXY_PID" 2>/dev/null; PROXY_PID=""; }
trap cleanup EXIT
die() { echo "✗ $*" >&2; cleanup; exit 1; }

DBURL=$(gcloud secrets versions access latest --secret=DATABASE_URL 2>/dev/null) || die "อ่าน secret ไม่ได้"
PGURL=$(python3 -c "
import re
m=re.match(r'postgresql://([^:]+):([^@]+)@[^/]*/([^?]+)', '''$DBURL''')
print('postgresql://%s:%s@127.0.0.1:$PORT/%s' % (m.group(1), m.group(2), m.group(3)))")

cloud-sql-proxy --port $PORT bestchoice-prod:asia-southeast1:bestchoice-db >"$PROXY_LOG" 2>&1 &
PROXY_PID=$!
for i in $(seq 1 15); do grep -q "ready for new connections" "$PROXY_LOG" 2>/dev/null && break; sleep 1; done
grep -q "ready for new connections" "$PROXY_LOG" || die "proxy ไม่ขึ้น"

psql "$PGURL" -qAt -c "
SELECT json_agg(row_to_json(t)) FROM (
  SELECT cr.id, cr.shortcut, cr.title, cr.category, cr.content,
         cr.is_active AS \"isActive\", cr.hide_from_chat AS \"hideFromChat\",
         (SELECT json_agg(json_build_object('type', b.type, 'text', b.text) ORDER BY b.sort_order)
          FROM canned_response_bubbles b WHERE b.canned_response_id = cr.id) AS bubbles
  FROM canned_responses cr
  WHERE cr.deleted_at IS NULL AND cr.id NOT LIKE 'kb:%'
  ORDER BY cr.category, cr.sort_order
) t;"
