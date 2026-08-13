#!/usr/bin/env bash
# อ่านอย่างเดียว: เช็คแถว shop_bot_persona_bot_extras บน prod (มี/ไม่มี + เนื้อหา)
set -u
cd "$(dirname "$0")/../.."
PORT=15432
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

psql "$PGURL" -qAt -c "SELECT COALESCE((SELECT 'EXISTS len='||length(value) FROM system_config WHERE key='shop_bot_persona_bot_extras' AND deleted_at IS NULL), 'ABSENT');"
psql "$PGURL" -qAt -c "SELECT value FROM system_config WHERE key='shop_bot_persona_bot_extras' AND deleted_at IS NULL;"
