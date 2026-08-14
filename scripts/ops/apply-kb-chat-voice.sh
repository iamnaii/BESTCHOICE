#!/usr/bin/env bash
# ใช้คำตอบนโยบาย owner (2026-08-13) กับ 4 แถวสุดท้ายของคลังคำตอบ — รัน apply-kb-chat-voice.sql
# รัน:  bash scripts/ops/apply-kb-chat-voice.sh
set -u
cd "$(dirname "$0")/../.."
PORT=${PORT:-15432}
PROXY_LOG=$(mktemp "${TMPDIR:-/tmp}/sqlproxy.XXXXXX")
PROXY_PID=""
ok()  { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*"; cleanup; exit 1; }
cleanup() { [ -n "$PROXY_PID" ] && kill "$PROXY_PID" 2>/dev/null; PROXY_PID=""; }
trap cleanup EXIT

command -v cloud-sql-proxy >/dev/null || die "ไม่พบ cloud-sql-proxy"
command -v psql            >/dev/null || die "ไม่พบ psql"
DBURL=$(gcloud secrets versions access latest --secret=DATABASE_URL 2>/dev/null) || die "อ่าน secret ไม่ได้"
PGURL=$(python3 -c "
import re
m=re.match(r'postgresql://([^:]+):([^@]+)@[^/]*/([^?]+)', '''$DBURL''')
print('postgresql://%s:%s@127.0.0.1:$PORT/%s' % (m.group(1), m.group(2), m.group(3)))")

cloud-sql-proxy --port $PORT bestchoice-prod:asia-southeast1:bestchoice-db >"$PROXY_LOG" 2>&1 &
PROXY_PID=$!
for i in $(seq 1 15); do grep -q "ready for new connections" "$PROXY_LOG" 2>/dev/null && break; sleep 1; done
grep -q "ready for new connections" "$PROXY_LOG" || die "proxy ไม่ขึ้น"
psql "$PGURL" -qAt -c "SELECT 1" >/dev/null || die "ต่อ DB ไม่ได้"

psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/ops/apply-kb-chat-voice.sql || die "apply พัง"
ok "เขียนใหม่ 32 แถวเป็นภาษาแชทจริงแล้ว"
