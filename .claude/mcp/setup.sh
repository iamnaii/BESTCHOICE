#!/usr/bin/env bash
# ตั้งค่าครั้งเดียว: สร้าง role mcp_ro บน prod + ให้สิทธิ์ตาม grants.sql + เก็บรหัสไว้ในเครื่อง
#
# รันด้วย bash เท่านั้น (zsh ไม่ตัดคำในตัวแปร)
#   bash .claude/mcp/setup.sh
#
# สิ่งที่สคริปต์นี้ทำกับ prod: CREATE ROLE + REVOKE + GRANT เท่านั้น
# ไม่แตะข้อมูล ไม่แตะโครงตาราง ไม่รีสตาร์ท instance
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${MCP_SETUP_PORT:-15432}"
INSTANCE="bestchoice-prod:asia-southeast1:bestchoice-db"
CONFIG_DIR="$HOME/.config/bestchoice-mcp"
CONFIG="$CONFIG_DIR/env"

die() { echo "❌ $*" >&2; exit 1; }

command -v cloud-sql-proxy >/dev/null || die "ไม่พบ cloud-sql-proxy"
command -v psql            >/dev/null || die "ไม่พบ psql"
command -v gcloud          >/dev/null || die "ไม่พบ gcloud"
[ -f "$HERE/sql/grants.sql" ] || die "ยังไม่มี sql/grants.sql — รัน npm run grants ก่อน"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  die "พอร์ต $PORT ไม่ว่าง — ตั้ง MCP_SETUP_PORT เป็นพอร์ตอื่น (ห้ามไล่ฆ่าตามพอร์ต)"
fi

# รหัสสุ่มในเครื่อง ไม่เคยผ่าน argv และไม่เคยถูก echo
# ใช้ python ไม่ใช่ `tr </dev/urandom | head` — head ปิดท่อทำให้ tr โดน SIGPIPE
# แล้ว `set -o pipefail` จะฆ่าสคริปต์ทิ้งด้วย exit 141 (เจอมาแล้ว)
# ⚠️ ห้ามรันสคริปต์นี้ด้วย `bash -x` — trace จะพ่นรหัสลง log
PASSWORD="$(python3 -c 'import secrets,string; print("".join(secrets.choice(string.ascii_letters+string.digits) for _ in range(40)))')"

echo "→ ดึง DATABASE_URL (ใช้เฉพาะตอน setup — MCP ตอนรันจริงไม่แตะ Secret Manager เลย)"
DBURL="$(gcloud secrets versions access latest --secret=DATABASE_URL --project=bestchoice-prod)" \
  || die "อ่าน secret ไม่ได้"

echo "→ เปิด cloud-sql-proxy บนพอร์ต $PORT"
cloud-sql-proxy --port "$PORT" "$INSTANCE" >/tmp/bcmcp-setup-proxy.log 2>&1 &
PROXY=$!
trap 'kill $PROXY 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do nc -z 127.0.0.1 "$PORT" 2>/dev/null && break; sleep 0.5; done
nc -z 127.0.0.1 "$PORT" 2>/dev/null || die "proxy ไม่พร้อม — ดู /tmp/bcmcp-setup-proxy.log"

PGURL="$(python3 - "$DBURL" "$PORT" <<'PY'
import sys, urllib.parse as u
p = u.urlparse(sys.argv[1].strip())
print(f"postgresql://{p.username}:{u.quote(p.password or '')}@127.0.0.1:{sys.argv[2]}{p.path}?sslmode=disable")
PY
)"

echo "→ สร้าง role (รหัสส่งผ่าน psql variable ไม่ผ่าน argv จึงไม่โผล่ใน ps)"
PGPASSWORD_UNUSED=1 psql "$PGURL" -qX -v ON_ERROR_STOP=1 \
  -v mcp_password="$PASSWORD" -f "$HERE/sql/create-role.sql"

echo "→ ให้สิทธิ์ตาม grants.sql ($(grep -c '^GRANT SELECT (' "$HERE/sql/grants.sql") ตาราง)"
psql "$PGURL" -qX -v ON_ERROR_STOP=1 -f "$HERE/sql/grants.sql"

echo "→ ตรวจว่า role ใช้งานได้จริงและเขียนไม่ได้จริง"
DBNAME="$(python3 -c "import sys,urllib.parse as u; print(u.urlparse('''$DBURL'''.strip()).path.lstrip('/'))")"
ROURL="postgresql://mcp_ro:$(python3 -c "import urllib.parse as u,sys; print(u.quote(sys.argv[1]))" "$PASSWORD")@127.0.0.1:$PORT/$DBNAME?sslmode=disable"

psql "$ROURL" -qAtX -c 'SELECT 1' >/dev/null || die "role ล็อกอินไม่ได้"
echo "   ✓ ล็อกอินได้"

if psql "$ROURL" -qAtX -c 'CREATE TABLE mcp_should_fail(x int)' >/dev/null 2>&1; then
  die "role เขียนได้! หยุดทันที — ตรวจ grants.sql"
fi
echo "   ✓ สร้างตารางไม่ได้"

if psql "$ROURL" -qAtX -c 'SELECT text FROM chat_messages LIMIT 1' >/dev/null 2>&1; then
  die "role อ่านเนื้อความแชทได้! หยุดทันที — ตรวจ policy.mjs"
fi
echo "   ✓ อ่าน chat_messages.text ไม่ได้"

psql "$ROURL" -qAtX -c 'SELECT count(*) FROM chat_messages' >/dev/null || die "นับแถวแชทไม่ได้ (ควรได้)"
echo "   ✓ นับแถว chat_messages ได้"

mkdir -p "$CONFIG_DIR"; chmod 700 "$CONFIG_DIR"
umask 177
cat > "$CONFIG" <<EOF
MCP_RO_PASSWORD=$PASSWORD
MCP_DATABASE=$DBNAME
MCP_USER=mcp_ro
EOF
chmod 600 "$CONFIG"
echo "→ เขียน $CONFIG (chmod 600, อยู่นอกเรโป)"
echo
echo "✅ เสร็จ — เพิ่ม .mcp.json ที่รากเรโปแล้วเปิด session ใหม่"
