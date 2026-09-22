#!/usr/bin/env bash
# ถอยชั้นที่ 2 ของการปรับบอท 2026-09-22 — persona (EXTRAS + BASE บรรทัดรับซื้อ/เทิร์น) กลับเป็นฉบับโปรฟรีดาวน์
#   · KB 17 แถวกลับค่าเดิม (priority/คีย์เวิร์ด/ตัวอย่างคำถาม/ข้อความ) + ปิดแถวใหม่ faq:credit-history · ปิดค่าตั้ง 3 ตัว (soft delete)
# ไม่แตะชั้นโปร (ถอยชั้นโปรด้วย rollback-imported-free-down.sh หลังจากนี้ถ้าต้องการ) · ไม่ลบรูปในถัง
# รัน:  bash scripts/ops/rollback-bot-tune-2026-09-22.sh   (แล้วรัน dump-persona-snapshot.sh + sync-kb-to-canned.sh)
#
# BASE: ด่านตรวจเฉพาะบรรทัดรับซื้อ/เทิร์นที่ชั้นนี้แก้ — แก้จุดอื่นของ BASE จากหน้าแอดมินหลัง apply ไม่ขวางการถอย
#   (ถอยแล้วส่วนที่แก้ไว้คงอยู่ · ผลตรวจขึ้น "ℹ BASE มีจุดอื่นที่ถูกแก้…" = ปกติ ไม่ใช่ข้อผิดพลาด)
# ถ้า SQL ถอยไม่ผ่าน ("EXTRAS … ไม่ใช่ฉบับที่คาด" / "BASE บน DB ไม่มีบรรทัดที่ชั้นนี้แก้" / "ไม่ตรงค่าที่ apply ใส่") = มีคนแก้ EXTRAS /
#   บรรทัด BASE / แถว KB ที่ชั้นนี้แตะหลัง apply — ทั้งชุดถูก ROLLBACK ฐานไม่ถูกแตะ · ทางเลือกด้วยมือ (ต่อ proxy + ตั้ง PGURL แบบเดียวกับสคริปต์นี้ก่อน):
#   1) ถอยทุกจุดของชั้นนี้ โดยตัดบล็อกด่านตรวจทิ้ง (persona คืนเฉพาะจุดที่ข้อความยังตรง · KB 17 แถวกลับค่าเดิม
#      ทับการแก้หลัง apply ของแถวเหล่านั้น · ปิด faq:credit-history + ค่าตั้ง 3 ตัว):
#        sed '/^DO \$G\$/,/^END \$G\$;/d' scripts/ops/rollback-bot-tune-2026-09-22.sql | psql "$PGURL" -v ON_ERROR_STOP=1
#      ผลตรวจท้ายไฟล์ขึ้น ✗ ที่ EXTRAS/BASE = ส่วนที่ถูกแก้หลัง apply ยังอยู่ → ถ้าต้องการคืนทั้งก้อนใช้ข้อ 2
#   2) คืน persona ทั้งก้อนจากไฟล์สำรองที่ apply เก็บไว้ (ทับการแก้ persona ทุกอย่างหลัง apply):
#        B=~/bestchoice-ops-backups/bot-tune-2026-09-22-apply-<เวลา>
#        printf '%s\n' "UPDATE system_config SET value = :'v', updated_at = NOW() WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;" \
#          | psql "$PGURL" -v ON_ERROR_STOP=1 -v v="$(cat "$B/extras.txt")"
#      (ทำซ้ำกับ base.txt → key shop_bot_persona_base) · KB ใช้ข้อ 1 (kb-rows.json ของ apply ครบ 18 แถวแล้ว
#      รวม example_questions/intent/deleted_at — แต่คืนค่าเองต้องเขียน UPDATE ต่อแถว ข้อ 1 ทำให้ทั้งชุด)
#   ทั้งสองข้อทดสอบแล้วในฐานชั่วคราว (handoff-bot-freedown/v2/dryrun_v2.sh ฉาก 7ข · ฉาก 7ก = แก้ BASE จุดอื่นแล้วถอยได้ตามปกติ)
# ปิดแค่โหมดไม่มีสต๊อก (ไม่ถอยอย่างอื่น): UPDATE system_config SET deleted_at = now(), updated_at = now() WHERE key = 'shop_bot_stock_mode';
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

DBURL=$(gcloud secrets versions access latest --secret=DATABASE_URL 2>/dev/null) || die "อ่าน secret ไม่ได้"
PGURL=$(python3 -c "
import re
m=re.match(r'postgresql://([^:]+):([^@]+)@[^/]*/([^?]+)', '''$DBURL''')
print('postgresql://%s:%s@127.0.0.1:$PORT/%s' % (m.group(1), m.group(2), m.group(3)))")

cloud-sql-proxy --port $PORT bestchoice-prod:asia-southeast1:bestchoice-db >"$PROXY_LOG" 2>&1 &
PROXY_PID=$!
for i in $(seq 1 15); do grep -q "ready for new connections" "$PROXY_LOG" 2>/dev/null && break; sleep 1; done
grep -q "ready for new connections" "$PROXY_LOG" || die "proxy ไม่ขึ้น"

BK_TAG=rollback
# >>> backup (ข้อความ prompt/FAQ/ค่าตั้งของร้าน — ไม่มีข้อมูลลูกค้า)
BK="${BACKUP_DIR:-$HOME/bestchoice-ops-backups}/bot-tune-2026-09-22-${BK_TAG}-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BK" || die "สร้างโฟลเดอร์สำรองไม่ได้: $BK"
psql "$PGURL" -qAt -c "SELECT value FROM system_config WHERE key='shop_bot_persona_bot_extras' AND deleted_at IS NULL" > "$BK/extras.txt" || die "สำรอง EXTRAS ไม่ได้"
psql "$PGURL" -qAt -c "SELECT value FROM system_config WHERE key='shop_bot_persona_base' AND deleted_at IS NULL" > "$BK/base.txt" || die "สำรอง BASE ไม่ได้"
psql "$PGURL" -qAt -c "SELECT json_agg(json_build_object('id',id,'intent',intent,'priority',priority,'trigger_keywords',trigger_keywords,'example_questions',example_questions,'response_template',response_template,'active',active,'deleted_at',deleted_at) ORDER BY id) FROM chat_knowledge_base WHERE id IN ('faq:age-requirement','faq:device-lock','faq:early-payoff','faq:late-fee','faq:paid-still-locked','faq:payment-channel-reminder','faq:no-payslip-freelance','promo:imported-free-down','faq:imported-device','faq:imported-tradein','extracted:price_installment','extracted:product_availability','extracted:installment_terms','extracted:approval_process','extracted:second_hand_condition','extracted:store_location_hours','faq:no-delivery-pickup-only','faq:credit-history')" > "$BK/kb-rows.json" || die "สำรอง KB ไม่ได้"
psql "$PGURL" -qAt -c "SELECT json_agg(json_build_object('key',key,'value',value,'deleted_at',deleted_at) ORDER BY key) FROM system_config WHERE key IN ('shop_bot_rate_cards','shop_bot_page_autoreply_markers','shop_bot_stock_mode')" > "$BK/config-rows.json" || die "สำรอง system_config ไม่ได้"
[ -s "$BK/extras.txt" ] && [ -s "$BK/base.txt" ] && [ -s "$BK/kb-rows.json" ] || die "ไฟล์สำรองว่าง — ไม่ทำต่อ"
ok "สำรองค่าก่อนรันไว้ที่ $BK"
# <<< backup

psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/ops/rollback-bot-tune-2026-09-22.sql || die "rollback ล้มเหลว (ทั้งชุดถูก ROLLBACK — ฐานไม่เปลี่ยน)"
ok "ถอยเสร็จ — เช็คผลตรวจด้านบนต้อง ✓ ทุกช่อง (มีผลใน 60 วินาที)"
