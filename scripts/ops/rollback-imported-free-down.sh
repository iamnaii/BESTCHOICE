#!/usr/bin/env bash
# โปรฟรีดาวน์เครื่องนอก — ถอยกลับการเทรนบอทขาย: รัน rollback-imported-free-down.sql
#   (คืน persona เฉพาะจุดที่ apply แก้ + ปิดแถว KB 3 แถวของโปร + คืนประโยคประกันมือสอง)
# รัน:  bash scripts/ops/rollback-imported-free-down.sh   (มีผลใน 60 วินาที ไม่ต้อง deploy)
#       แล้วรัน dump-persona-snapshot.sh + sync-kb-to-canned.sh ให้เอกสาร/ข้อความสำเร็จรูปของพนักงานกลับตาม
# ก่อนรัน SQL สคริปต์นี้เก็บค่าปัจจุบันไว้ที่ ~/bestchoice-ops-backups/imported-free-down-rollback-<เวลา>/ เช่นกัน
#
# ถ้า SQL ถอยไม่ผ่าน (ขึ้น "ถูกแก้ต่อหลัง apply") = มีคนแก้จุดเดียวกันหลัง apply — ฐานไม่ถูกแตะ
#   ทางเลือกสุดท้าย: คืนทั้งก้อนจากไฟล์สำรองที่ตัว apply เก็บไว้ (จะทับการแก้ persona ทุกอย่างที่ทำหลัง apply):
#     B=~/bestchoice-ops-backups/imported-free-down-apply-<เวลา>
#     printf '%s\n' "UPDATE system_config SET value = :'v', updated_at = NOW() WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;" \
#       | psql "$PGURL" -v ON_ERROR_STOP=1 -v v="$(cat "$B/extras.txt")"
#     (ทำซ้ำกับ base.txt → key shop_bot_persona_base · kb-warranty_claim.txt → chat_knowledge_base.response_template WHERE intent='warranty_claim')
#     แล้วปิดแถว KB ของโปรด้วยคำสั่ง UPDATE ท่อนเดียวกับใน rollback-imported-free-down.sql
set -u
cd "$(dirname "$0")/../.."
PORT=${PORT:-15432}
PROXY_LOG=$(mktemp "${TMPDIR:-/tmp}/sqlproxy.XXXXXX")
PROXY_PID=""
BK_TAG=rollback
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

# >>> backup (บล็อกนี้ถูกทดสอบกับฐานชั่วคราวใน dryrun — แก้แล้วต้องรัน dryrun ซ้ำ)
BK="${BACKUP_DIR:-$HOME/bestchoice-ops-backups}/imported-free-down-${BK_TAG:-apply}-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BK" || die "สร้างโฟลเดอร์สำรองไม่ได้: $BK"
psql "$PGURL" -qAt -c "SELECT value FROM system_config WHERE key='shop_bot_persona_bot_extras' AND deleted_at IS NULL" > "$BK/extras.txt" || die "สำรอง EXTRAS ไม่ได้"
psql "$PGURL" -qAt -c "SELECT value FROM system_config WHERE key='shop_bot_persona_base' AND deleted_at IS NULL" > "$BK/base.txt" || die "สำรอง BASE ไม่ได้"
psql "$PGURL" -qAt -c "SELECT response_template FROM chat_knowledge_base WHERE intent='warranty_claim' AND deleted_at IS NULL" > "$BK/kb-warranty_claim.txt" || die "สำรอง KB warranty_claim ไม่ได้"
[ -s "$BK/extras.txt" ] && [ -s "$BK/base.txt" ] || die "ไฟล์สำรอง persona ว่าง — ไม่ทำต่อ"
ok "สำรองค่าก่อนรันไว้ที่ $BK"
# <<< backup

psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/ops/rollback-imported-free-down.sql || die "ถอยไม่ผ่าน (ทั้งชุดถูก ROLLBACK — ฐานไม่เปลี่ยน) ดูหัวไฟล์นี้เรื่องคืนจากไฟล์สำรอง"
ok "ถอยเสร็จ — ผลตรวจด้านบน: ✓ = เหมือนก่อน apply ทุกตัวอักษร · △ = ถอยจุดของโปรครบ ส่วนอื่นที่ถูกแก้ทีหลังคงไว้"
