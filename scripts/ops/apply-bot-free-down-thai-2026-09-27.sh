#!/usr/bin/env bash
# บอทขาย (ขึ้น): ฟรีดาวน์มีเครื่องไทยด้วย · ทุกเคสมาทำสัญญาที่ร้าน (ไม่มีออนไลน์) · เอกสารฟรีดาวน์ไม่ใช่บัตรใบเดียว ·
#   ค่างวด iPhone 16 / 16 Pro ในตารางโปร = 15 งวด (คำตัดสินเจ้าของ 2026-09-26)
#   แตะ: persona EXTRAS 24 จุด (BASE ไม่แตะ) + KB 2 แถว (promo:imported-free-down · faq:no-delivery-pickup-only — ข้อความเท่านั้น)
#   + รูปตารางโปรที่บอทส่ง (shop_bot_rate_cards: imported-free-down-2026-09-22.jpg ↔ 2026-09-27.jpg — 16/16 Pro = 15 เดือน ·
#     แถบล่างเดิม "ใช้แค่บัตรประชาชนใบเดียว! ไม่มีค่าใช้จ่ายเพิ่มเติม" → "เครื่องนอก ของแท้ Apple ! ไม่เช็คบูโร")
#   ไม่แตะโหมดสต๊อก/ค่าตั้งอื่น · ไม่ต้อง deploy (มีผลใน 60 วินาที) · ถอยไม่ลบรูปในถัง
# ลำดับ: ขึ้นต่อจาก apply-bot-tune-2026-09-22 (ฉบับที่อยู่บน prod) · ถอยไฟล์นี้ก่อนถอยชั้น 2026-09-22 เสมอ
# รัน:  IMAGES_DIR=<โฟลเดอร์ที่มี imported-free-down-2026-09-27.jpg> bash scripts/ops/apply-bot-free-down-thai-2026-09-27.sh
#       (ไม่ต้องใส่ IMAGES_DIR ถ้ารูปขึ้นถังแล้ว · หลังรัน: dump-persona-snapshot.sh ได้)
#   ⚠ ห้ามรัน sync-kb-to-canned.sh หลังลงข้อความสำเร็จรูปชุด cr2609 — มันชุบข้อความสำเร็จรูปเดิม 32 อันกลับมา
# ด่าน: EXTRAS ต้องตรงฉบับที่คาดทุกตัวอักษร (md5) + แถว KB ต้องมีข้อความตามที่คาด — ไม่ตรง = ทั้งชุด ROLLBACK ฐานไม่ถูกแตะ
# ผลตรวจขึ้น "✗" = ค่าใน DB ไม่ตรงฉบับที่รีวิว — ห้ามฝืน · ทดสอบแล้วบนฐานชั่วคราว (handoff-bot-freedown/v3/dryrun_v3.sh ผ่าน 6 ฉาก)
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
BUCKET=${BUCKET:-bestchoice-documents}

# >>> รูปในถัง (บอทส่งเป็นลิงก์ลงนามอายุ 7 วันทุกครั้ง — ถังไม่เปิดสาธารณะ) · ต้องขึ้นก่อนเปลี่ยนค่าตั้ง ไม่งั้นบอทส่งรูปไม่ได้
f=imported-free-down-2026-09-27.jpg
OBJ="gs://$BUCKET/bot-media/rate-cards/$f"
if gcloud storage ls "$OBJ" >/dev/null 2>&1; then
  ok "มีรูปในถังแล้ว: $OBJ"
else
  [ -n "${IMAGES_DIR:-}" ] && [ -s "$IMAGES_DIR/$f" ] || die "ไม่มี $OBJ และไม่พบไฟล์ $f ใน IMAGES_DIR ให้อัปโหลด"
  gcloud storage cp "$IMAGES_DIR/$f" "$OBJ" --content-type=image/jpeg >/dev/null || die "อัปโหลด $f ไม่ได้"
  ok "อัปโหลดรูป: $OBJ"
fi
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

# >>> backup (ข้อความ prompt/FAQ ของร้าน — ไม่มีข้อมูลลูกค้า)
BK="${BACKUP_DIR:-$HOME/bestchoice-ops-backups}/bot-free-down-thai-2026-09-27-apply-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BK" || die "สร้างโฟลเดอร์สำรองไม่ได้: $BK"
psql "$PGURL" -qAt -c "SELECT value FROM system_config WHERE key='shop_bot_persona_bot_extras' AND deleted_at IS NULL" > "$BK/extras.txt" || die "สำรอง EXTRAS ไม่ได้"
psql "$PGURL" -qAt -c "SELECT json_agg(json_build_object('id',id,'response_template',response_template) ORDER BY id) FROM chat_knowledge_base WHERE id IN ('promo:imported-free-down','faq:no-delivery-pickup-only') AND deleted_at IS NULL" > "$BK/kb-rows.json" || die "สำรอง KB ไม่ได้"
psql "$PGURL" -qAt -c "SELECT value FROM system_config WHERE key='shop_bot_rate_cards' AND deleted_at IS NULL" > "$BK/rate-cards.json" || die "สำรองรูปตารางไม่ได้"
[ -s "$BK/extras.txt" ] && [ -s "$BK/kb-rows.json" ] && [ -s "$BK/rate-cards.json" ] || die "ไฟล์สำรองว่าง — ไม่ทำต่อ"
ok "สำรองค่าก่อนรันไว้ที่ $BK"
# <<< backup

psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/ops/apply-bot-free-down-thai-2026-09-27.sql || die "apply ล้มเหลว (ทั้งชุดถูก ROLLBACK — ฐานไม่เปลี่ยน)"
ok "apply เสร็จ — เช็คผลตรวจด้านบนต้อง ✓ ทุกช่อง (มีผลใน 60 วินาที ไม่ต้อง deploy)"
