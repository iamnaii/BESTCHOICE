#!/usr/bin/env bash
# =============================================================================
# Post-wave ops runbook — product-answering wave (2026-08-10)
# รัน:  bash scripts/ops/post-wave-runbook.sh
#
# ทำอะไรบ้าง (ตามลำดับ หยุดถามก่อนทุกจุดที่เขียนข้อมูล):
#   [0] เปิด cloud-sql-proxy เข้า prod DB (ปิดให้เองตอนจบ)
#   [1] SQL เปิดสมองสินค้าให้น้องเบส (idempotent — รันซ้ำได้)
#   [2] SQL ตรวจสุขภาพหลัง migrate (อ่านอย่างเดียว 6 ก้อน)
#   [3] Backfill ราคา: dry-run → ถาม → APPLY
#   [4] ตั้งปุ่ม Get Started ของเพจ FB (ถาม email/รหัส OWNER — ไม่เก็บลงไฟล์)
# =============================================================================
set -u
cd "$(dirname "$0")/../.."   # repo root

PORT=15432
PROXY_LOG=$(mktemp "${TMPDIR:-/tmp}/sqlproxy.XXXXXX")   # macOS: X ต้องอยู่ท้ายสุด ห้ามมี suffix
PROXY_PID=""

say()  { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*"; cleanup; exit 1; }

cleanup() {
  if [ -n "$PROXY_PID" ] && kill -0 "$PROXY_PID" 2>/dev/null; then
    kill "$PROXY_PID" 2>/dev/null
    PROXY_PID=""
    ok "ปิด cloud-sql-proxy แล้ว"
  fi
}
trap cleanup EXIT

# ---------- [0] เตรียมท่อ ----------
say "[0/4] เปิดท่อเข้า prod DB"
command -v cloud-sql-proxy >/dev/null || die "ไม่พบ cloud-sql-proxy"
command -v psql            >/dev/null || die "ไม่พบ psql"
command -v gcloud          >/dev/null || die "ไม่พบ gcloud"

DBURL=$(gcloud secrets versions access latest --secret=DATABASE_URL 2>/dev/null) \
  || die "อ่าน secret DATABASE_URL ไม่ได้ — เช็ค gcloud auth login"

PGURL=$(python3 -c "
import re,sys
m=re.match(r'postgresql://([^:]+):([^@]+)@', '''$DBURL''')
print('postgresql://%s:%s@127.0.0.1:$PORT/bestchoice' % (m.group(1), m.group(2)))")

cloud-sql-proxy --port $PORT bestchoice-prod:asia-southeast1:bestchoice-db >"$PROXY_LOG" 2>&1 &
PROXY_PID=$!
for i in $(seq 1 15); do
  grep -q "ready for new connections" "$PROXY_LOG" 2>/dev/null && break
  sleep 1
done
grep -q "ready for new connections" "$PROXY_LOG" || die "proxy ไม่ขึ้น — ดู log: $PROXY_LOG"
psql "$PGURL" -qAt -c "SELECT 1" >/dev/null || die "ต่อ DB ไม่ได้"
ok "ต่อ prod DB ได้แล้ว"

# ---------- [1] prompt น้องเบส ----------
say "[1/4] เปิดสมองสินค้าให้น้องเบส"
ROWS=$(psql "$PGURL" -qAt -c "SELECT count(*) FROM system_config WHERE key='finance_bot_system_prompt'")
if [ "$ROWS" = "0" ]; then
  ok "ไม่มีแถวใน DB — constant ใหม่ในโค้ดทำงานอยู่แล้ว ข้ามขั้นนี้"
else
  BEFORE=$(psql "$PGURL" -qAt -c "SELECT length(value) FROM system_config WHERE key='finance_bot_system_prompt'")
  psql "$PGURL" -v ON_ERROR_STOP=1 -q <<'SQL'
UPDATE system_config
SET value = value || E'\n\n' || $BLK$# ตอบเรื่องสินค้าได้ด้วย
ถ้าลูกค้าถามเรื่องเครื่องใหม่/ราคา/ค่างวด/โปรโมชั่น ให้ใช้ tool เหล่านี้:
- search_products — ค้นสต็อกจริง ส่งคำที่ลูกค้าพิมพ์ไปได้เลย (ไทยก็ได้)
- calculate_installment — คำนวณค่างวดของเครื่องที่เจาะจงแล้ว (ต้องมี productId จาก search_products)
- list_promotions — โปรที่ใช้กับเครื่องนั้นได้จริง
กติกา: ห้ามบอกตัวเลขราคา/ค่างวดที่ไม่ได้มาจากผลลัพธ์ tool เด็ดขาด
ถ้าผลลัพธ์มี priceMissingCount > 0 แปลว่ามีเครื่องแต่ยังไม่ตั้งราคา — ให้บอกลูกค้าว่าจะให้พนักงานเช็คราคาให้
เครื่องที่ reserved = true คือ "มีของแต่ติดจองชั่วคราว" ห้ามบอกว่าไม่มี$BLK$,
    updated_at = now()
WHERE key = 'finance_bot_system_prompt'
  AND value NOT LIKE '%ตอบเรื่องสินค้าได้ด้วย%';
SQL
  CHECK=$(psql "$PGURL" -qAt -c "SELECT value LIKE '%search_products%' FROM system_config WHERE key='finance_bot_system_prompt'")
  AFTER=$(psql "$PGURL" -qAt -c "SELECT length(value) FROM system_config WHERE key='finance_bot_system_prompt'")
  [ "$CHECK" = "t" ] || die "prompt ยังไม่มี search_products — ผิดคาด ห้ามไปต่อ"
  ok "prompt อัปเดตแล้ว (len $BEFORE → $AFTER) — บอทเห็นผลใน ≤5 นาที (cache)"
fi

# ---------- [2] ตรวจสุขภาพ ----------
say "[2/4] SQL ตรวจสุขภาพ (อ่านอย่างเดียว)"
echo "--- enum ต้องมี PAYMENT_RECEIVED_UNFULFILLABLE:"
psql "$PGURL" -c "SELECT unnest(enum_range(NULL::\"OnlineOrderStatus\"))"
echo "--- ต้องเป็น 0 (backfill กันแจ้งย้อนหลัง):"
psql "$PGURL" -c "SELECT count(*) FROM product_reservations WHERE status='PREEMPTED' AND preempt_notified_at IS NULL"
echo "--- ต้องมี 1 แถว (partial unique index):"
psql "$PGURL" -c "SELECT indexname FROM pg_indexes WHERE indexname='product_reservations_active_product_idx'"
echo "--- ต้องว่าง (ไม่มี hold ACTIVE ซ้อน):"
psql "$PGURL" -c "SELECT product_id, count(*) FROM product_reservations WHERE status='ACTIVE' GROUP BY 1 HAVING count(*) > 1"
echo "--- ต้อง YES (FAQ ข้ามช่อง B3):"
psql "$PGURL" -c "SELECT is_nullable FROM information_schema.columns WHERE table_name='chat_knowledge_base' AND column_name='channel'"
echo "--- แนวโน้ม bot defense 24 ชม. (RATE_LIMITED ควรน้อยลงชัดเจน):"
psql "$PGURL" -c "SELECT detected_type, action, count(*) FROM bot_detection_logs WHERE detected_at > now() - interval '1 day' GROUP BY 1,2 ORDER BY 3 DESC"

# ---------- [3] backfill ราคา ----------
say "[3/4] Backfill ราคา — dry-run ก่อน"
(cd apps/api && DATABASE_URL="$PGURL" npx tsx scripts/backfill-product-prices.ts) || die "dry-run พัง — อ่าน error ด้านบน"
echo
read -r -p ">> ตัวเลข dry-run ข้างบนโอเคไหม? เขียนจริงเลย? [y/N] " ANS
if [ "${ANS:-n}" = "y" ] || [ "${ANS:-n}" = "Y" ]; then
  (cd apps/api && APPLY=true DATABASE_URL="$PGURL" npx tsx scripts/backfill-product-prices.ts) || die "APPLY พัง"
  ok "backfill เขียนจริงแล้ว"
else
  warn "ข้าม APPLY — รันสคริปต์นี้ใหม่ได้ทุกเมื่อ"
fi

# ---------- [4] Get Started ----------
say "[4/4] ตั้งปุ่ม Get Started ของเพจ Facebook"
read -r -p ">> ทำขั้นนี้เลยไหม? [y/N] " ANS
if [ "${ANS:-n}" = "y" ] || [ "${ANS:-n}" = "Y" ]; then
  echo "   บัญชี OWNER ที่มีอยู่จริงในระบบ (ใช้อีเมลใดอีเมลหนึ่งด้านล่าง):"
  psql "$PGURL" -c "SELECT email, name FROM users WHERE role='OWNER' AND deleted_at IS NULL"
  read -r -p "   อีเมล OWNER: " OWNER_EMAIL
  read -r -s -p "   รหัสผ่าน (ไม่โชว์บนจอ ไม่เก็บลงไฟล์): " OWNER_PASS; echo
  LOGIN_RESP=$(curl -s -X POST https://api.bestchoicephone.app/api/auth/login \
    -H 'Content-Type: application/json' -H 'X-Requested-With: XMLHttpRequest' \
    -d "{\"email\":\"$OWNER_EMAIL\",\"password\":\"$OWNER_PASS\"}")
  unset OWNER_PASS
  TOKEN=$(printf '%s' "$LOGIN_RESP" | python3 -c "import sys,json
try:
  d=json.load(sys.stdin); print(d.get('accessToken') or d.get('data',{}).get('accessToken') or '')
except Exception: print('')")
  if [ -z "$TOKEN" ]; then
    echo "   เซิร์ฟเวอร์ตอบ: $LOGIN_RESP"
    die "login ไม่ผ่าน (ระวัง: ผิด 5 ครั้งโดนล็อก 15 นาที)"
  fi
  ok "login สำเร็จ"
  RESULT=$(curl -s -X POST https://api.bestchoicephone.app/api/admin/admin/facebook/setup-messenger-profile \
    -H "Authorization: Bearer $TOKEN" -H "X-Requested-With: XMLHttpRequest")
  echo "   ผลลัพธ์: $RESULT"
  echo "$RESULT" | grep -q '"success":true' \
    && ok "Get Started + เมนูตั้งสำเร็จ" \
    || warn "ไม่สำเร็จ — ถ้าเห็น 'Facebook not configured' ให้กรอก Page Access Token + Page ID ที่ Settings → เชื่อมต่อ → Facebook แล้วรันขั้นนี้ใหม่"
else
  warn "ข้ามขั้น 4 — รันสคริปต์ใหม่แล้วตอบ y ได้ทุกเมื่อ"
fi

say "เสร็จแล้ว"
cat <<'DONE'
ที่เหลือเป็นมือถือ/เว็บของคุณล้วนๆ:
  1) รอ 5 นาที (cache) → LINE Finance ทักน้องเบส: "มีไอโฟน 15 ขายไหม" → ต้องตอบสินค้าได้
  2) LINE Shop ทักบอทขาย: "ไอโฟน 15 มีไหม" → ราคาจริง + รูป (2 ข้อความ)
  3) แชร์ https://bestchoicephone-shop.web.app/api/shop/share/<id> ลง LINE → การ์ดต้องขึ้น
  4) Sentry: ตั้ง alert 2 tag — critical:online-order-unfulfillable / payment-captured-on-cancelled-order
  5) ต่อโดเมน www.bestchoicephone.com เข้า Firebase site bestchoicephone-shop (ดู runbook ขั้น 7)
     เสร็จแล้วบอก Claude ให้สลับ INTERIM กลับ .com
DONE
