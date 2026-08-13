#!/usr/bin/env bash
# อ่านอย่างเดียว: ดัมพ์แถว chat_knowledge_base ที่สกัดจากแชทเก่า (EXTRACTED*)
# ออกเป็น JSON เพื่อเอาไปทำชีทรีวิว — ใช้ท่อ/secret pattern เดียวกับ train-ai-prod.sh
set -u
cd "$(dirname "$0")/../.."

PORT=15432
PROXY_LOG=$(mktemp "${TMPDIR:-/tmp}/sqlproxy.XXXXXX")
PROXY_PID=""
cleanup() { [ -n "$PROXY_PID" ] && kill "$PROXY_PID" 2>/dev/null; PROXY_PID=""; }
trap cleanup EXIT
die() { echo "✗ $*" >&2; cleanup; exit 1; }

command -v cloud-sql-proxy >/dev/null || die "ไม่พบ cloud-sql-proxy"
command -v psql >/dev/null || die "ไม่พบ psql"

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
  SELECT intent, category, channel, response_type AS \"responseType\",
         priority, active, requires_auth AS \"requiresAuth\",
         trigger_keywords AS \"triggerKeywords\",
         example_questions AS \"exampleQuestions\",
         response_template AS \"responseTemplate\"
  FROM chat_knowledge_base
  WHERE category IN ('EXTRACTED','EXTRACTED_OBJECTION') AND deleted_at IS NULL
  ORDER BY category, priority DESC
) t;"
