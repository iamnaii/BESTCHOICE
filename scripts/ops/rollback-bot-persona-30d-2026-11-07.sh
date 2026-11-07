#!/usr/bin/env bash
# บอทขาย (ถอย): เพิ่มหัวข้อ "สิ่งที่เรียนรู้จากแชทจริง 30 วัน (ต.ค.–พ.ย. 69)" ท้าย persona BASE — เจ้าของเขียน/เคาะ 2026-11-07
#   (ลูกค้า · ข้อมูลร้านเพิ่มเติม · คุณสมบัติผู้ผ่อน · วิธีพิมพ์ · คำต้องห้าม — "ถ้าขัดกับข้อข้างบน ให้ยึดหัวข้อนี้")
#   แตะ: BASE ต่อท้ายหัวข้อใหม่ (10,590 → ~15,200 ตัวอักษร · เพดาน 20,000) · EXTRAS 8 จุดที่ขัดกับหัวข้อใหม่ + บรรทัดลำดับความสำคัญท้ายสุด
#     (ออนไลน์ ≤100 กม. แทน "ไม่มีออนไลน์" · นักศึกษาใช้สำเนาบัตรผู้ปกครอง ไม่ใช่ผู้ค้ำ · ทหาร/ยังไม่มีรายได้/ผ่อนอยู่ที่อื่น ตอบเองแทน handoff)
#     + KB 5 แถว (ข้อความเท่านั้น): faq:no-delivery-pickup-only · faq:age-requirement · extracted:documents_required · faq:no-payslip-freelance · promo:imported-free-down
#   ไม่แตะ: Red Flag ผ่อนแทนเพื่อน/แฟน · ราคาโปร · รูปตาราง · ค่าตั้งอื่น · ไม่ต้อง deploy (PersonaService cache 60 วินาที)
# ลำดับ: ขึ้นต่อจาก apply-bot-free-down-thai-2026-09-27 (ฉบับที่อยู่บน prod) · ถอยไฟล์นี้ก่อนถอยชั้น 2026-09-27 เสมอ
# รัน:  bash scripts/ops/rollback-bot-persona-30d-2026-11-07.sh   (หลังรัน: dump-persona-snapshot.sh ได้)
#   ⚠ ห้ามรัน sync-kb-to-canned.sh หลังลงข้อความสำเร็จรูปชุด cr2609 — มันชุบข้อความสำเร็จรูปเดิม 32 อันกลับมา
# ด่าน: ท้าย BASE/EXTRAS ต้องเป็นข้อความที่ apply ใส่ + ข้อความที่ apply ใส่ทุกจุดเจอ 1 ครั้งพอดี · ถอยแล้ว md5 ต้องกลับเป็น b544dcd2… / b6c81bb9… — ไม่ตรง = ทั้งชุด ROLLBACK ฐานไม่ถูกแตะ
# ผลตรวจขึ้น "✗" = ค่าใน DB ไม่ตรงฉบับที่รีวิว — ห้ามฝืน · ทดสอบแล้ว: ฐานหลอกในเครื่อง (ขึ้น→ขึ้นซ้ำล้ม→ถอยกลับเหมือนเดิม) + ซ้อมคำนวณบน prod แบบอ่านอย่างเดียว
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

BK_TAG=rollback
# >>> backup (ข้อความ prompt/FAQ ของร้าน — ไม่มีข้อมูลลูกค้า)
BK="${BACKUP_DIR:-$HOME/bestchoice-ops-backups}/bot-persona-30d-2026-11-07-${BK_TAG}-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BK" || die "สร้างโฟลเดอร์สำรองไม่ได้: $BK"
psql "$PGURL" -qAt -c "SELECT value FROM system_config WHERE key='shop_bot_persona_base' AND deleted_at IS NULL" > "$BK/base.txt" || die "สำรอง BASE ไม่ได้"
psql "$PGURL" -qAt -c "SELECT value FROM system_config WHERE key='shop_bot_persona_bot_extras' AND deleted_at IS NULL" > "$BK/extras.txt" || die "สำรอง EXTRAS ไม่ได้"
psql "$PGURL" -qAt -c "SELECT json_agg(json_build_object('id',id,'response_template',response_template) ORDER BY id) FROM chat_knowledge_base WHERE id IN ('faq:no-delivery-pickup-only','faq:age-requirement','extracted:documents_required','faq:no-payslip-freelance','promo:imported-free-down') AND deleted_at IS NULL" > "$BK/kb-rows.json" || die "สำรอง KB ไม่ได้"
[ -s "$BK/base.txt" ] && [ -s "$BK/extras.txt" ] && [ -s "$BK/kb-rows.json" ] || die "ไฟล์สำรองว่าง — ไม่ทำต่อ"
ok "สำรองค่าก่อนรันไว้ที่ $BK"
# <<< backup

psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/ops/rollback-bot-persona-30d-2026-11-07.sql || die "rollback ล้มเหลว (ทั้งชุดถูก ROLLBACK — ฐานไม่เปลี่ยน)"
ok "ถอยเสร็จ — เช็คผลตรวจด้านบนต้อง ✓ ทุกช่อง (มีผลใน 60 วินาที)"
