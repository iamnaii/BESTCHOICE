#!/usr/bin/env bash
# =============================================================================
# ใช้ผลรีวิวคลังคำตอบบอท (2026-08-13) กับ prod:
#   [1] แก้ response_template 16 แถว + เปิดใช้ 28 แถว (apply-kb-review.sql)
#       — 4 แถวยังปิดรอ owner ยืนยันนโยบาย
#   [2] วาง Prompt B ต่อท้าย BOT_EXTRAS (default จากโค้ด + บล็อกคลังคำตอบ)
#       — system_config.shop_bot_persona_bot_extras (persona cache 60s หายเอง)
# รัน:  bash scripts/ops/apply-kb-review.sh
# =============================================================================
set -u
cd "$(dirname "$0")/../.."

PORT=15432
PROXY_LOG=$(mktemp "${TMPDIR:-/tmp}/sqlproxy.XXXXXX")
PROXY_PID=""
say()  { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*"; cleanup; exit 1; }
cleanup() { [ -n "$PROXY_PID" ] && kill "$PROXY_PID" 2>/dev/null; PROXY_PID=""; }
trap cleanup EXIT

command -v cloud-sql-proxy >/dev/null || die "ไม่พบ cloud-sql-proxy"
command -v psql            >/dev/null || die "ไม่พบ psql"
command -v gcloud          >/dev/null || die "ไม่พบ gcloud"

say "[0/2] เปิดท่อเข้า prod DB"
DBURL=$(gcloud secrets versions access latest --secret=DATABASE_URL 2>/dev/null) || die "อ่าน secret DATABASE_URL ไม่ได้"
PGURL=$(python3 -c "
import re
m=re.match(r'postgresql://([^:]+):([^@]+)@[^/]*/([^?]+)', '''$DBURL''')
print('postgresql://%s:%s@127.0.0.1:$PORT/%s' % (m.group(1), m.group(2), m.group(3)))")

cloud-sql-proxy --port $PORT bestchoice-prod:asia-southeast1:bestchoice-db >"$PROXY_LOG" 2>&1 &
PROXY_PID=$!
for i in $(seq 1 15); do grep -q "ready for new connections" "$PROXY_LOG" 2>/dev/null && break; sleep 1; done
grep -q "ready for new connections" "$PROXY_LOG" || die "proxy ไม่ขึ้น — ดู $PROXY_LOG"
psql "$PGURL" -qAt -c "SELECT 1" >/dev/null || die "ต่อ DB ไม่ได้"
ok "ต่อ prod DB ได้แล้ว"

say "[1/2] แก้ + เปิดใช้คลังคำตอบ (16 แก้ / 28 เปิด / 4 รอยืนยัน)"
psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/ops/apply-kb-review.sql || die "apply SQL พัง"
ok "คลังคำตอบอัปเดตแล้ว"

say "[2/2] วาง Prompt B ต่อท้าย BOT_EXTRAS"
# ค่า effective ปัจจุบัน: แถวใน DB ถ้ามี ไม่มีก็ default จากโค้ด (ตรรกะเดียวกับ PersonaService)
CURRENT=$(psql "$PGURL" -qAt -c "SELECT value FROM system_config WHERE key='shop_bot_persona_bot_extras' AND deleted_at IS NULL;")
if [ -z "$CURRENT" ]; then
  CURRENT=$(cd apps/api && npx -y tsx scripts/print-bot-extras.ts) || die "อ่าน default extras ไม่ได้"
  ok "ไม่มีแถวใน DB — ใช้ default จากโค้ด (${#CURRENT} ตัวอักษร)"
fi
if printf '%s' "$CURRENT" | grep -q "คลังคำตอบจากแชทเก่า (search_knowledge_base)"; then
  ok "BOT_EXTRAS มีบล็อกคลังคำตอบอยู่แล้ว — ข้าม (idempotent)"
else
  PROMPTB=$(cat docs/sales-scripts/AI-CUSTOMER-REPLY-PROMPT.md | sed -n '/^# คลังคำตอบจากแชทเก่า/,/หน้าร้านจริงที่ลพบุรี$/p')
  [ -n "$PROMPTB" ] || die "หา Prompt B ในคู่มือไม่เจอ"
  NEWVAL="${CURRENT}

${PROMPTB}"
  # หมายเหตุ: psql -c ไม่ทำ variable interpolation — ต้องส่งผ่าน stdin (-f -)
  psql "$PGURL" -v ON_ERROR_STOP=1 -v v="$NEWVAL" -f - <<'SQL' || die "upsert BOT_EXTRAS พัง"
INSERT INTO system_config (id, key, value, label, created_at, updated_at)
VALUES (gen_random_uuid()::text, 'shop_bot_persona_bot_extras', :'v',
        'Playbook & กฎ tools (BOT_EXTRAS) — default + บล็อกคลังคำตอบจากแชทเก่า (2026-08-13)',
        NOW(), NOW())
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, label = EXCLUDED.label,
      updated_at = NOW(), deleted_at = NULL;
SQL
  ok "วาง Prompt B แล้ว (รวม ${#NEWVAL} ตัวอักษร — มีผลในไม่เกิน 60 วิ)"
fi

say "สรุป"
psql "$PGURL" -c "SELECT category, active, count(*) FROM chat_knowledge_base WHERE category IN ('EXTRACTED','EXTRACTED_OBJECTION') AND deleted_at IS NULL GROUP BY 1,2 ORDER BY 1,2;"
psql "$PGURL" -qAt -c "SELECT 'BOT_EXTRAS len='||length(value) FROM system_config WHERE key='shop_bot_persona_bot_extras' AND deleted_at IS NULL;"
ok "เสร็จ — เหลือ 4 แถวรอยืนยันนโยบาย: store_location_hours / approval_process / trade_in / warranty_claim"
