#!/usr/bin/env bash
# ตั้งค่าครั้งเดียวต่อคน — ใช้ Cloud SQL IAM authentication จึง **ไม่มีรหัสผ่านเลย**
#
# รันด้วย bash เท่านั้น (zsh ไม่ตัดคำในตัวแปร)
#   bash .claude/mcp/setup.sh
#
# สิ่งที่ทำกับ prod: สร้าง IAM DB user + CREATE ROLE + REVOKE/GRANT เท่านั้น
# ไม่แตะข้อมูล ไม่แตะโครงตาราง ไม่รีสตาร์ท
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${MCP_SETUP_PORT:-15432}"
PROJECT=bestchoice-prod
INSTANCE="$PROJECT:asia-southeast1:bestchoice-db"
DBNAME=bestchoice
CONFIG_DIR="$HOME/.config/bestchoice-mcp"
CONFIG="$CONFIG_DIR/env"

die() { echo "❌ $*" >&2; exit 1; }

command -v cloud-sql-proxy >/dev/null || die "ไม่พบ cloud-sql-proxy (มากับ google-cloud-sdk)"
command -v psql            >/dev/null || die "ไม่พบ psql"
command -v gcloud          >/dev/null || die "ไม่พบ gcloud"
[ -f "$HERE/sql/grants.sql" ] || die "ยังไม่มี sql/grants.sql"

ACCOUNT="$(gcloud config get-value account 2>/dev/null)"
[ -n "$ACCOUNT" ] && [ "$ACCOUNT" != "(unset)" ] || die "gcloud ยังไม่ได้ล็อกอิน — รัน gcloud auth login"
echo "→ บัญชีที่จะใช้: $ACCOUNT"

FLAG="$(gcloud sql instances describe bestchoice-db --project=$PROJECT \
        --format='value(settings.databaseFlags)' 2>/dev/null || true)"
case "$FLAG" in
  *iam_authentication*) echo "→ IAM database authentication เปิดอยู่แล้ว" ;;
  *) die "instance ยังไม่เปิด IAM auth — รันก่อน:
  gcloud sql instances patch bestchoice-db --project=$PROJECT --database-flags=cloudsql.iam_authentication=on
  (ไม่ต้องรีสตาร์ท · ย้อนกลับด้วย --clear-database-flags)" ;;
esac

if gcloud sql users list --instance=bestchoice-db --project=$PROJECT \
     --format='value(name)' 2>/dev/null | grep -qx "$ACCOUNT"; then
  echo "→ IAM DB user มีอยู่แล้ว"
else
  echo "→ สร้าง IAM DB user"
  gcloud sql users create "$ACCOUNT" --instance=bestchoice-db --project=$PROJECT --type=cloud_iam_user
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  die "พอร์ต $PORT ไม่ว่าง — ตั้ง MCP_SETUP_PORT เป็นพอร์ตอื่น (ห้ามไล่ฆ่าตามพอร์ต)"
fi

# ── ให้สิทธิ์: ต้องใช้ role เจ้าของตาราง จึงยังต้องพึ่ง DATABASE_URL ตอน setup เท่านั้น
#    (ตอน MCP รันจริงไม่แตะ Secret Manager เลย)
echo "→ ดึง DATABASE_URL (ใช้เฉพาะขั้นให้สิทธิ์)"
DBURL="$(gcloud secrets versions access latest --secret=DATABASE_URL --project=$PROJECT)" \
  || die "อ่าน secret ไม่ได้ — ต้องมีสิทธิ์ secretmanager.secretAccessor"

echo "→ เปิด cloud-sql-proxy (พอร์ต $PORT)"
cloud-sql-proxy --port "$PORT" "$INSTANCE" >/tmp/bcmcp-setup-proxy.log 2>&1 &
PROXY=$!
trap 'kill $PROXY 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do nc -z 127.0.0.1 "$PORT" 2>/dev/null && break; sleep 0.5; done
nc -z 127.0.0.1 "$PORT" 2>/dev/null || die "proxy ไม่พร้อม — ดู /tmp/bcmcp-setup-proxy.log"

OWNER_URL="$(python3 - "$DBURL" "$PORT" <<'PY'
import sys, urllib.parse as u
p = u.urlparse(sys.argv[1].strip())
print(f"postgresql://{p.username}:{u.quote(p.password or '')}@127.0.0.1:{sys.argv[2]}{p.path}?sslmode=disable")
PY
)"

echo "→ สร้าง/ปรับ group role mcp_ro"
psql "$OWNER_URL" -qX -v ON_ERROR_STOP=1 -f "$HERE/sql/create-role.sql"

echo "→ ให้สิทธิ์ตาม grants.sql ($(grep -c '^GRANT SELECT (' "$HERE/sql/grants.sql") ตาราง)"
psql "$OWNER_URL" -qX -v ON_ERROR_STOP=1 -f "$HERE/sql/grants.sql"

echo "→ ผูก $ACCOUNT เข้ากับ mcp_ro + ตั้ง guard รายบทบาท"
# ALTER ROLE ... SET ไม่ถ่ายทอดผ่านการเป็นสมาชิก ต้องตั้งให้ผู้ใช้จริงเองด้วย
psql "$OWNER_URL" -qX -v ON_ERROR_STOP=1 -v acct="$ACCOUNT" <<'SQL'
GRANT mcp_ro TO :"acct";
ALTER ROLE :"acct" SET default_transaction_read_only = on;
ALTER ROLE :"acct" SET statement_timeout = '15s';
ALTER ROLE :"acct" SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE :"acct" SET lock_timeout = '3s';
ALTER ROLE :"acct" SET application_name = 'bestchoice-mcp';
SQL

kill $PROXY 2>/dev/null || true
sleep 1

# ── ตรวจด้วยเส้นทางจริง (IAM ไม่มีรหัส) ──
echo "→ ตรวจผ่านเส้นทาง IAM จริง"
SOCK="$(mktemp -d)"
cloud-sql-proxy --auto-iam-authn "$INSTANCE?unix-socket-path=$SOCK/.s.PGSQL.5432" >/tmp/bcmcp-iam-proxy.log 2>&1 &
PROXY=$!
trap 'kill $PROXY 2>/dev/null || true; rm -rf "$SOCK"' EXIT
for _ in $(seq 1 40); do [ -S "$SOCK/.s.PGSQL.5432" ] && break; sleep 0.5; done
[ -S "$SOCK/.s.PGSQL.5432" ] || die "proxy IAM ไม่พร้อม — ดู /tmp/bcmcp-iam-proxy.log"

ENC="$(python3 -c "import urllib.parse as u,sys; print(u.quote(sys.argv[1]))" "$ACCOUNT")"
IAM_URL="postgresql://$ENC@/$DBNAME?host=$SOCK"

psql "$IAM_URL" -qAtX -c 'SELECT 1' >/dev/null || die "ล็อกอินด้วย IAM ไม่ผ่าน"
echo "   ✓ ล็อกอินด้วย IAM ได้ (ไม่มีรหัส)"

# ปิด read-only ก่อนทดสอบเขียน — ไม่งั้นจะเจอ GUC ดักแทนที่จะเป็นสิทธิ์จริง
# ⚠️ ต้องมี -v ON_ERROR_STOP=1 : psql ที่อ่านสคริปต์จาก stdin **คืน exit 0 แม้ SQL จะ error**
#    ถ้าลืม ด่านนี้จะอ่านว่า "เขียนได้" ทุกครั้งทั้งที่ความจริงถูกปฏิเสธ (เจอมาแล้ว)
if printf 'SET default_transaction_read_only = off;\nCREATE TABLE mcp_should_fail(x int);\n' \
   | psql "$IAM_URL" -qAtX -v ON_ERROR_STOP=1 >/dev/null 2>&1; then
  die "เขียนได้! หยุดทันที — ตรวจ grants.sql"
fi
echo "   ✓ เขียนไม่ได้แม้ปิด read-only แล้ว (ติดสิทธิ์จริง)"

# เนื้อความแชทเปิดให้อ่านตั้งแต่ 2026-09-06 ตามคำสั่งเจ้าของ (ดู OWNER_APPROVED_PII)
# ด่านนี้จึงเปลี่ยนไปเฝ้า "เส้นแดงที่ยังไม่เคยเปิด" แทน — ชื่อลูกค้า และเลขบัตรประชาชน
for probe in 'SELECT name FROM customers LIMIT 1' 'SELECT payer_tax_id FROM receipts LIMIT 1'; do
  if psql "$IAM_URL" -qAtX -c "$probe" >/dev/null 2>&1; then
    die "อ่านได้: $probe — หยุดทันที ตรวจ policy.mjs"
  fi
done
echo "   ✓ ชื่อลูกค้า + เลขบัตรประชาชน ยังอ่านไม่ได้"

psql "$IAM_URL" -qAtX -c 'SELECT count(*) FROM chat_messages' >/dev/null || die "นับแถวแชทไม่ได้ (ควรได้)"
echo "   ✓ นับแถว chat_messages ได้"

mkdir -p "$CONFIG_DIR"; chmod 700 "$CONFIG_DIR"
umask 177
cat > "$CONFIG" <<EOF
MCP_USER=$ACCOUNT
MCP_DATABASE=$DBNAME
EOF
chmod 600 "$CONFIG"
echo "→ เขียน $CONFIG (ไม่มีความลับอยู่ในไฟล์นี้แล้ว)"
echo
echo "✅ เสร็จ — ต่อให้ Claude Code เห็นด้วย:"
echo "   claude mcp add --scope user bestchoice-db node $HERE/src/index.mjs"
echo "   แล้วเปิด session ใหม่"
