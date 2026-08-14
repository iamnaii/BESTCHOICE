#!/usr/bin/env bash
# Backfill รูปโปรไฟล์ FB ของห้องแชทเก่าบน prod (หลัง read_page_mailboxes ผ่าน App Review)
# รัน:  bash scripts/ops/backfill-fb-profiles-prod.sh
set -u
cd "$(dirname "$0")/../.."
PORT=15432
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
DB_NAME=$(python3 -c "
import re
print(re.match(r'postgresql://[^:]+:[^@]+@[^/]*/([^?]+)', '''$DBURL''').group(1))")

cloud-sql-proxy --port $PORT bestchoice-prod:asia-southeast1:bestchoice-db >"$PROXY_LOG" 2>&1 &
PROXY_PID=$!
for i in $(seq 1 15); do grep -q "ready for new connections" "$PROXY_LOG" 2>/dev/null && break; sleep 1; done
grep -q "ready for new connections" "$PROXY_LOG" || die "proxy ไม่ขึ้น"
psql "$PGURL" -qAt -c "SELECT 1" >/dev/null || die "ต่อ DB ไม่ได้"
ok "ต่อ prod DB ($DB_NAME) ได้แล้ว"

echo "ก่อนรัน: ห้อง FB ที่ยังไม่มีรูป = $(psql "$PGURL" -qAt -c "SELECT count(*) FROM chat_rooms WHERE channel='FACEBOOK' AND deleted_at IS NULL AND external_user_id IS NOT NULL AND picture_url IS NULL")"

(cd apps/api && \
  export DATABASE_URL="$PGURL" EXPECTED_DB_NAME="$DB_NAME" && \
  npx -y tsx src/cli/backfill-fb-profiles.cli.ts) || die "CLI พัง — อ่าน error ด้านบน"

echo "หลังรัน: ห้อง FB ที่ยังไม่มีรูป = $(psql "$PGURL" -qAt -c "SELECT count(*) FROM chat_rooms WHERE channel='FACEBOOK' AND deleted_at IS NULL AND external_user_id IS NOT NULL AND picture_url IS NULL")"
ok "เสร็จ — เปิด /inbox ดูรูปโปรไฟล์ได้เลย"
