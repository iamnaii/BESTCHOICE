#!/usr/bin/env bash
# รัน vitest *.integration.spec.ts ของ apps/api บน PostgreSQL 16 ชั่วคราว (initdb ใน /tmp · migrate deploy · ไม่แตะ .env)
# ใช้: bash tools/test-db-vitest.sh src/modules/expense-documents/__tests__/recurring-bills.integration.spec.ts [...]
# bootstrap ชุดเดียวกับ tools/test-chat-credit.sh แต่ไม่เปิด Vite/jest — สำหรับ spec ที่ประกอบ service เองและต้องการแค่ฐานข้อมูล
set -euo pipefail
if [ "$#" -eq 0 ]; then echo 'usage: tools/test-db-vitest.sh <spec paths relative to apps/api>' >&2; exit 1; fi
cd "$(dirname "$0")/.."
npm run build --workspace=@installment/shared >/dev/null
if [ -z "${CREDIT_PG_BIN:-}" ]; then
  for candidate in /usr/lib/postgresql/16/bin /opt/homebrew/opt/postgresql@16/bin /usr/local/opt/postgresql@16/bin; do
    if [ -x "$candidate/initdb" ]; then CREDIT_PG_BIN=$candidate; break; fi
  done
  if [ -z "${CREDIT_PG_BIN:-}" ] && command -v pg_config >/dev/null 2>&1; then
    CREDIT_PG_BIN=$(pg_config --bindir)
  fi
fi
for program in initdb pg_ctl createdb; do
  if [ ! -x "${CREDIT_PG_BIN:-}/$program" ]; then
    echo 'Set CREDIT_PG_BIN to a PostgreSQL 16 installation with pgvector.' >&2
    exit 1
  fi
done
PG_STARTED=0
PG_ROOT=$(mktemp -d /tmp/bc-vitest-db.XXXXXX)
PG_PORT=${VITEST_PG_PORT:-55477}
mkdir "$PG_ROOT/socket"
cleanup() {
  if [ "$PG_STARTED" = 1 ] && "$CREDIT_PG_BIN/pg_ctl" -D "$PG_ROOT/data" -m fast -w stop >/dev/null 2>&1; then
    rm -rf "$PG_ROOT/data"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
"$CREDIT_PG_BIN/initdb" -D "$PG_ROOT/data" -U vitest --auth-local=trust --auth-host=reject --encoding=UTF8 --no-locale >"$PG_ROOT/init.log"
"$CREDIT_PG_BIN/pg_ctl" -D "$PG_ROOT/data" -l "$PG_ROOT/postgres.log" -o "-k $PG_ROOT/socket -p $PG_PORT -c listen_addresses=''" -w start
PG_STARTED=1
"$CREDIT_PG_BIN/createdb" -h "$PG_ROOT/socket" -p "$PG_PORT" -U vitest bc_vitest_test
export DATABASE_URL="postgresql://vitest@localhost:$PG_PORT/bc_vitest_test?host=$PG_ROOT/socket&schema=public"
export NODE_ENV=test
export TZ=Asia/Bangkok
export PII_ENCRYPTION_KEY=e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0
export PII_HASH_SALT=e2e-pii-hash-salt-32-chars-minimum-ci
if ! ./node_modules/.bin/prisma migrate deploy --schema apps/api/prisma/schema.prisma >"$PG_ROOT/migrate.log" 2>&1; then
  tail -60 "$PG_ROOT/migrate.log"
  exit 1
fi
printf 'All migrations applied on isolated PostgreSQL: %s\n' "$PG_ROOT"
cd apps/api
# ห้าม exec: exec แทนที่ shell ทำให้ trap cleanup ไม่ทำงาน → Postgres ชั่วคราวค้างทุกครั้งที่รัน (เคยค้าง 31 ตัวจน initdb ล้ม "No space left on device")
../../node_modules/.bin/vitest run --no-file-parallelism "$@"
