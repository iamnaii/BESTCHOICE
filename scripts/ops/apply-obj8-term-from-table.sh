#!/usr/bin/env bash
# v3.1 Objection 8 ตอบงวดสูงสุดตามตารางเรทจริง — รัน apply-obj8-term-from-table.sql
# — รัน apply-obj8-term-from-table.sql (เขียนทับทั้งก้อนแบบ md5-guard)
# รัน:  bash scripts/ops/apply-ask-submodel-always.sh
# หมายเหตุ: ถ้าผลตรวจขึ้น "APPLY ✗" = ค่าใน DB เปลี่ยนไปจากตอนรีวิว — ห้ามฝืน
#   ให้ dump ใหม่ (dump-persona-snapshot.sh) แล้วรีวิว/สร้าง SQL ใหม่
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

psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/ops/apply-obj8-term-from-table.sql || die "apply ล้มเหลว"
ok "apply เสร็จ — เช็คผลตรวจด้านบนต้อง ✓ ทุกช่อง (มีผลใน 60 วินาที ไม่ต้อง deploy)"
