#!/usr/bin/env bash
# =============================================================================
# เทรน AI ตอบลูกค้าจากประวัติแชทเก่า — รันกับ PROD DB
# รัน:  bash scripts/ops/train-ai-prod.sh
#       DRY_RUN=1 bash scripts/ops/train-ai-prod.sh     # นับอย่างเดียว ไม่เขียน
#       MONTHS=6 bash scripts/ops/train-ai-prod.sh      # เปลี่ยนช่วงเวลา
#       SKIP_EXTRACT=1 bash scripts/ops/train-ai-prod.sh # สกัดใหม่จากคู่ข้อความเดิม
#
# ทำอะไร:
#   [0] เปิด cloud-sql-proxy เข้า prod DB + ดึง DATABASE_URL / ANTHROPIC_API_KEY
#       จาก GCP Secret Manager (ปิด proxy ให้เองตอนจบ)
#   [1] รัน apps/api/src/cli/train-ai-knowledge.cli.ts (ขั้น 1 ดูดแชท LINE+FB →
#       ai_training_pairs, ขั้น 2 Claude สกัด FAQ → chat_knowledge_base active=false)
#
# หมายเหตุ: INTEGRATION_ENCRYPTION_KEY ไม่ได้ตั้งบน prod (ดู deploy-gcp.yml) —
# creds ใน Integration Hub เป็น plaintext, CLI อ่านได้โดยไม่ต้องส่ง key
# =============================================================================
set -u
cd "$(dirname "$0")/../.."   # repo root

PORT=15432
PROXY_LOG=$(mktemp "${TMPDIR:-/tmp}/sqlproxy.XXXXXX")   # macOS: X ต้องอยู่ท้ายสุด ห้ามมี suffix
PROXY_PID=""

say()  { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*"; cleanup; exit 1; }

cleanup() {
  if [ -n "$PROXY_PID" ] && kill -0 "$PROXY_PID" 2>/dev/null; then
    kill "$PROXY_PID" 2>/dev/null
    PROXY_PID=""
    ok "ปิด cloud-sql-proxy แล้ว"
  fi
}
trap cleanup EXIT

# ---------- [0] เตรียมท่อ + secrets ----------
say "[0/1] เปิดท่อเข้า prod DB + ดึง secrets"
command -v cloud-sql-proxy >/dev/null || die "ไม่พบ cloud-sql-proxy"
command -v psql            >/dev/null || die "ไม่พบ psql"
command -v gcloud          >/dev/null || die "ไม่พบ gcloud"
command -v npx             >/dev/null || die "ไม่พบ npx (ติดตั้ง Node.js ก่อน)"

if lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  die "พอร์ต $PORT มีคนใช้อยู่ — ปิด proxy เก่าก่อน (lsof -iTCP:$PORT)"
fi

DBURL=$(gcloud secrets versions access latest --secret=DATABASE_URL 2>/dev/null) \
  || die "อ่าน secret DATABASE_URL ไม่ได้ — เช็ค gcloud auth login"

PGURL=$(python3 -c "
import re
m=re.match(r'postgresql://([^:]+):([^@]+)@[^/]*/([^?]+)', '''$DBURL''')
print('postgresql://%s:%s@127.0.0.1:$PORT/%s' % (m.group(1), m.group(2), m.group(3)))")
DB_NAME=$(python3 -c "
import re
print(re.match(r'postgresql://[^:]+:[^@]+@[^/]*/([^?]+)', '''$DBURL''').group(1))")

if [ "${DRY_RUN:-}" != "1" ]; then
  ANTHROPIC_API_KEY=$(gcloud secrets versions access latest --secret=ANTHROPIC_API_KEY 2>/dev/null)
  if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    printf 'อ่าน secret ANTHROPIC_API_KEY ไม่ได้ — วาง key เอง (หรือ Ctrl+C แล้วรัน DRY_RUN=1): '
    read -rs ANTHROPIC_API_KEY; echo
    [ -n "$ANTHROPIC_API_KEY" ] || die "ไม่มี ANTHROPIC_API_KEY — ขั้น 2 ต้องใช้"
  fi
  export ANTHROPIC_API_KEY
fi

cloud-sql-proxy --port $PORT bestchoice-prod:asia-southeast1:bestchoice-db >"$PROXY_LOG" 2>&1 &
PROXY_PID=$!
for i in $(seq 1 15); do
  grep -q "ready for new connections" "$PROXY_LOG" 2>/dev/null && break
  sleep 1
done
grep -q "ready for new connections" "$PROXY_LOG" || die "proxy ไม่ขึ้น — ดู log: $PROXY_LOG"
psql "$PGURL" -qAt -c "SELECT 1" >/dev/null || die "ต่อ DB ไม่ได้"
ok "ต่อ prod DB ($DB_NAME) ได้แล้ว"

# ---------- [1] รัน CLI ----------
say "[1/1] รัน train-ai-knowledge (MONTHS=${MONTHS:-12}${DRY_RUN:+ DRY_RUN=$DRY_RUN}${SKIP_EXTRACT:+ SKIP_EXTRACT=$SKIP_EXTRACT})"
(cd apps/api && \
  DATABASE_URL="$PGURL" \
  EXPECTED_DB_NAME="$DB_NAME" \
  MONTHS="${MONTHS:-12}" \
  DRY_RUN="${DRY_RUN:-}" \
  SKIP_EXTRACT="${SKIP_EXTRACT:-}" \
  npx -y tsx src/cli/train-ai-knowledge.cli.ts) || die "CLI พัง — อ่าน error ด้านบน"

ok "เสร็จแล้ว — ไปรีวิว/เปิดใช้ที่หน้า /chatbot-finance/knowledge"
