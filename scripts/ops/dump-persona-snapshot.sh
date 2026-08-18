#!/usr/bin/env bash
# ดัมพ์ persona จริงจาก prod → docs/sales-scripts/persona-live-snapshot.md
# รันหลังแก้ persona ทุกครั้งเพื่อให้ docs ตรงกับของจริง:
#   bash scripts/ops/dump-persona-snapshot.sh && git add docs && git commit ...
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

OUT="docs/sales-scripts/persona-live-snapshot.md"
{
  echo "# Persona น้องเบส (บอทขาย) — snapshot จริงจาก prod"
  echo ""
  echo "> ดัมพ์อัตโนมัติ $(date +%Y-%m-%d) — **นี่คือของจริงที่บอทใช้อยู่**"
  echo "> แก้ผ่าน scripts/ops/apply-*.sql หรือหน้า /settings/ai/persona แล้วรันสคริปต์นี้อัปเดตไฟล์"
  echo ""
  echo "## BASE (shop_bot_persona_base) — ใช้ทั้งบอทและ AI Suggest"
  echo ""
  echo '```'
  psql "$PGURL" -qAt -c "SELECT value FROM system_config WHERE key='shop_bot_persona_base' AND deleted_at IS NULL"
  echo '```'
  echo ""
  echo "## BOT_EXTRAS (shop_bot_persona_bot_extras) — playbook + กฎ tools (เฉพาะบอท)"
  echo ""
  echo '```'
  psql "$PGURL" -qAt -c "SELECT value FROM system_config WHERE key='shop_bot_persona_bot_extras' AND deleted_at IS NULL"
  echo '```'
} > "$OUT"
echo "✓ เขียน $OUT ($(grep -c "" "$OUT") บรรทัด)"
