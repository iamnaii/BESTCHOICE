#!/usr/bin/env bash
# ปรับบอทขายจากแชท 3 วันล่าสุด (2026-09-22) — ชั้นที่ 2 ต่อจาก apply-imported-free-down.sql
#   persona (แก้เฉพาะจุด 12 ตำแหน่ง) + KB 16 แถว + ค่าตั้ง 3 ตัว:
#   shop_bot_rate_cards (รูปตารางโปร + แผนที่ร้าน) · shop_bot_page_autoreply_markers · shop_bot_stock_mode = NO_STOCK
# ต้องมาก่อน: deploy โค้ดที่มี send_rate_card / notify_staff / BotRuntimeConfigService + รัน apply-imported-free-down.sh แล้ว
# รัน:  IMAGES_DIR=<โฟลเดอร์รูป> bash scripts/ops/apply-bot-tune-2026-09-22.sh
#       (IMAGES_DIR ต้องมี imported-free-down-2026-09-22.jpg + shop-map-2026-09-22.jpg — ไม่ต้องใส่ถ้ารูปขึ้นถังแล้ว)
#       หลัง apply ให้รัน dump-persona-snapshot.sh + sync-kb-to-canned.sh
# ถอย:  bash scripts/ops/rollback-bot-tune-2026-09-22.sh
# กลับโหมดอ่านสต๊อกเมื่อสต๊อกเข้าระบบแล้ว (ไม่ต้องถอยทั้งชุด):
#       UPDATE system_config SET deleted_at = now(), updated_at = now() WHERE key = 'shop_bot_stock_mode';
# ผลตรวจขึ้น "✗" = ค่าใน DB ไม่ตรงฉบับที่รีวิว — ห้ามฝืน ให้ถอยแล้ว dump ใหม่/สร้าง SQL ใหม่
set -u
cd "$(dirname "$0")/../.."
PORT=${PORT:-15432}
BUCKET=${BUCKET:-bestchoice-documents}
PROXY_LOG=$(mktemp "${TMPDIR:-/tmp}/sqlproxy.XXXXXX")
PROXY_PID=""
ok()  { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*"; cleanup; exit 1; }
cleanup() { [ -n "$PROXY_PID" ] && kill "$PROXY_PID" 2>/dev/null; PROXY_PID=""; }
trap cleanup EXIT

command -v cloud-sql-proxy >/dev/null || die "ไม่พบ cloud-sql-proxy"
command -v psql            >/dev/null || die "ไม่พบ psql"

# >>> รูปในถัง (บอทส่งเป็นลิงก์ลงนามอายุ 7 วันทุกครั้ง — ถังไม่เปิดสาธารณะ)
for f in imported-free-down-2026-09-22.jpg shop-map-2026-09-22.jpg; do
  OBJ="gs://$BUCKET/bot-media/rate-cards/$f"
  if gcloud storage ls "$OBJ" >/dev/null 2>&1; then
    ok "มีรูปในถังแล้ว: $OBJ"
  else
    [ -n "${IMAGES_DIR:-}" ] && [ -s "$IMAGES_DIR/$f" ] || die "ไม่มี $OBJ และไม่พบไฟล์ $f ใน IMAGES_DIR ให้อัปโหลด"
    gcloud storage cp "$IMAGES_DIR/$f" "$OBJ" --content-type=image/jpeg >/dev/null || die "อัปโหลด $f ไม่ได้"
    ok "อัปโหลดรูป: $OBJ"
  fi
done
# <<< รูปในถัง

DBURL=$(gcloud secrets versions access latest --secret=DATABASE_URL 2>/dev/null) || die "อ่าน secret ไม่ได้"
PGURL=$(python3 -c "
import re
m=re.match(r'postgresql://([^:]+):([^@]+)@[^/]*/([^?]+)', '''$DBURL''')
print('postgresql://%s:%s@127.0.0.1:$PORT/%s' % (m.group(1), m.group(2), m.group(3)))")

cloud-sql-proxy --port $PORT bestchoice-prod:asia-southeast1:bestchoice-db >"$PROXY_LOG" 2>&1 &
PROXY_PID=$!
for i in $(seq 1 15); do grep -q "ready for new connections" "$PROXY_LOG" 2>/dev/null && break; sleep 1; done
grep -q "ready for new connections" "$PROXY_LOG" || die "proxy ไม่ขึ้น"

BK_TAG=apply
# >>> backup (ข้อความ prompt/FAQ/ค่าตั้งของร้าน — ไม่มีข้อมูลลูกค้า)
BK="${BACKUP_DIR:-$HOME/bestchoice-ops-backups}/bot-tune-2026-09-22-${BK_TAG}-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BK" || die "สร้างโฟลเดอร์สำรองไม่ได้: $BK"
psql "$PGURL" -qAt -c "SELECT value FROM system_config WHERE key='shop_bot_persona_bot_extras' AND deleted_at IS NULL" > "$BK/extras.txt" || die "สำรอง EXTRAS ไม่ได้"
psql "$PGURL" -qAt -c "SELECT value FROM system_config WHERE key='shop_bot_persona_base' AND deleted_at IS NULL" > "$BK/base.txt" || die "สำรอง BASE ไม่ได้"
psql "$PGURL" -qAt -c "SELECT json_agg(json_build_object('id',id,'priority',priority,'trigger_keywords',trigger_keywords,'response_template',response_template,'active',active) ORDER BY id) FROM chat_knowledge_base WHERE id IN ('faq:age-requirement','faq:device-lock','faq:early-payoff','faq:late-fee','faq:no-payslip-freelance','faq:paid-still-locked','faq:payment-channel-reminder','promo:imported-free-down','faq:imported-device','faq:imported-tradein','extracted:price_installment','extracted:product_availability','extracted:installment_terms','extracted:approval_process','extracted:second_hand_condition','extracted:store_location_hours')" > "$BK/kb-rows.json" || die "สำรอง KB ไม่ได้"
psql "$PGURL" -qAt -c "SELECT json_agg(json_build_object('key',key,'value',value,'deleted_at',deleted_at) ORDER BY key) FROM system_config WHERE key IN ('shop_bot_rate_cards','shop_bot_page_autoreply_markers','shop_bot_stock_mode')" > "$BK/config-rows.json" || die "สำรอง system_config ไม่ได้"
[ -s "$BK/extras.txt" ] && [ -s "$BK/base.txt" ] && [ -s "$BK/kb-rows.json" ] || die "ไฟล์สำรองว่าง — ไม่ทำต่อ"
ok "สำรองค่าก่อนรันไว้ที่ $BK"
# <<< backup

psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/ops/apply-bot-tune-2026-09-22.sql || die "apply ล้มเหลว (ทั้งชุดถูก ROLLBACK — ฐานไม่เปลี่ยน)"
ok "apply เสร็จ — เช็คผลตรวจด้านบนต้อง ✓ ทุกช่อง (มีผลใน 60 วินาที ไม่ต้อง deploy)"
