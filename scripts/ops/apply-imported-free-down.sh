#!/usr/bin/env bash
# โปรฟรีดาวน์เครื่องนอก — เทรนบอทขาย: รัน apply-imported-free-down.sql (แทนที่เฉพาะจุด + KB 3 แถว)
# รัน:  bash scripts/ops/apply-imported-free-down.sh   (หลัง apply ให้รัน dump-persona-snapshot.sh + sync-kb-to-canned.sh)
# ถอย:  bash scripts/ops/rollback-imported-free-down.sh
# ก่อนรัน SQL สคริปต์นี้เก็บค่าปัจจุบัน (persona 2 ก้อน + แถว KB warranty_claim) ไว้ที่
#   ~/bestchoice-ops-backups/imported-free-down-apply-<เวลา>/   (ข้อความ prompt/FAQ ของร้าน — ไม่มีข้อมูลลูกค้า)
# หมายเหตุ: ถ้าผลตรวจขึ้น "✗" = ค่าใน DB ไม่ตรงกับฉบับที่รีวิว — ห้ามฝืน ให้ถอยแล้ว dump ใหม่/สร้าง SQL ใหม่
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

# >>> backup (บล็อกนี้ถูกทดสอบกับฐานชั่วคราวใน dryrun — แก้แล้วต้องรัน dryrun ซ้ำ)
BK="${BACKUP_DIR:-$HOME/bestchoice-ops-backups}/imported-free-down-${BK_TAG:-apply}-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BK" || die "สร้างโฟลเดอร์สำรองไม่ได้: $BK"
psql "$PGURL" -qAt -c "SELECT value FROM system_config WHERE key='shop_bot_persona_bot_extras' AND deleted_at IS NULL" > "$BK/extras.txt" || die "สำรอง EXTRAS ไม่ได้"
psql "$PGURL" -qAt -c "SELECT value FROM system_config WHERE key='shop_bot_persona_base' AND deleted_at IS NULL" > "$BK/base.txt" || die "สำรอง BASE ไม่ได้"
psql "$PGURL" -qAt -c "SELECT response_template FROM chat_knowledge_base WHERE intent='warranty_claim' AND deleted_at IS NULL" > "$BK/kb-warranty_claim.txt" || die "สำรอง KB warranty_claim ไม่ได้"
[ -s "$BK/extras.txt" ] && [ -s "$BK/base.txt" ] || die "ไฟล์สำรอง persona ว่าง — ไม่ทำต่อ"
ok "สำรองค่าก่อนรันไว้ที่ $BK"
# <<< backup

psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/ops/apply-imported-free-down.sql || die "apply ล้มเหลว (ทั้งชุดถูก ROLLBACK — ฐานไม่เปลี่ยน)"
ok "apply เสร็จ — เช็คผลตรวจด้านบนต้อง ✓ ทุกช่อง (มีผลใน 60 วินาที ไม่ต้อง deploy)"
