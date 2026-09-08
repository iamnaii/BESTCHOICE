#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Cached node_modules does not include workspace build outputs. Jest below is
# invoked directly, so npm's API pretest hook does not prepare this dependency.
npm run build --workspace=@installment/shared
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
CREDIT_PG_STARTED=0
CREDIT_PG_ROOT=$(mktemp -d /tmp/bc-chat-credit.XXXXXX)
mkdir "$CREDIT_PG_ROOT/socket"
CREDIT_VITE_PID=''
cleanup() {
  if [ -n "$CREDIT_VITE_PID" ]; then kill "$CREDIT_VITE_PID" 2>/dev/null || true; fi
  if [ "$CREDIT_PG_STARTED" = 1 ] && "$CREDIT_PG_BIN/pg_ctl" -D "$CREDIT_PG_ROOT/data" -m fast -w stop >/dev/null 2>&1; then
    rm -rf "$CREDIT_PG_ROOT/data"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
"$CREDIT_PG_BIN/initdb" -D "$CREDIT_PG_ROOT/data" -U credit_test --auth-local=trust --auth-host=reject --encoding=UTF8 --no-locale >"$CREDIT_PG_ROOT/init.log"
"$CREDIT_PG_BIN/pg_ctl" -D "$CREDIT_PG_ROOT/data" -l "$CREDIT_PG_ROOT/postgres.log" -o "-k $CREDIT_PG_ROOT/socket -p 55476 -c listen_addresses=''" -w start
CREDIT_PG_STARTED=1
"$CREDIT_PG_BIN/createdb" -h "$CREDIT_PG_ROOT/socket" -p 55476 -U credit_test bc_chat_credit_test
export DATABASE_URL="postgresql://credit_test@localhost:55476/bc_chat_credit_test?host=$CREDIT_PG_ROOT/socket&schema=public"
export NODE_ENV=test
if ! ./node_modules/.bin/prisma migrate deploy --schema apps/api/prisma/schema.prisma >"$CREDIT_PG_ROOT/migrate.log" 2>&1; then
  tail -60 "$CREDIT_PG_ROOT/migrate.log"
  exit 1
fi
printf 'All migrations applied on isolated PostgreSQL: %s\n' "$CREDIT_PG_ROOT"
# Some legacy Jest specs use real Prisma clients. Keep both databases isolated
# when requesting the broader API regression run; never inherit .env targets.
if [ "${CREDIT_RUN_API_REGRESSION:-0}" = 1 ]; then
  export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=6144}"
  "$CREDIT_PG_BIN/createdb" -h "$CREDIT_PG_ROOT/socket" -p 55476 -U credit_test bc_credit_finance_test
  export DATABASE_URL_FINANCE="postgresql://credit_test@localhost:55476/bc_credit_finance_test?host=$CREDIT_PG_ROOT/socket&schema=public"
  ./node_modules/.bin/prisma migrate deploy --schema apps/api/prisma-finance/schema.prisma >"$CREDIT_PG_ROOT/finance-migrate.log" 2>&1
  node <<'JS'
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  try {
    await db.user.create({ data: { email: 'admin@bestchoice.com', name: 'ISOLATED TEST SYSTEM', password: 'unused', role: 'OWNER' } });
  } finally { await db.$disconnect(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
JS
  npm run test --workspace=apps/api -- --runInBand
fi
export CREDIT_WEB_URL=http://127.0.0.1:5189
(cd apps/web && exec node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5189 --strictPort) >"$CREDIT_PG_ROOT/vite.log" 2>&1 &
CREDIT_VITE_PID=$!
node --input-type=module <<'JS'
const origin = process.env.CREDIT_WEB_URL;
const deadline = Date.now() + 30_000;
while (true) {
  try { if ((await fetch(`${origin}/@vite/client`)).ok) break; } catch {}
  if (Date.now() > deadline) throw new Error('Credit test Vite server did not become ready');
  await new Promise(resolve => setTimeout(resolve, 200));
}
JS
cd apps/api
../../node_modules/.bin/jest --config e2e/jest-chat-credit.json --runInBand
