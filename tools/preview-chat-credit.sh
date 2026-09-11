#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export CREDIT_REPO_ROOT="$PWD"
export CREDIT_PREVIEW_ROOT="${CREDIT_PREVIEW_DIR:-$(mktemp -d /tmp/bc-chat-credit.XXXXXX)}"
case "$CREDIT_PREVIEW_ROOT" in /tmp/bc-chat-credit.*) ;; *) echo 'Preview requires its own /tmp/bc-chat-credit.* directory'; exit 1 ;; esac
if [ -z "${CREDIT_PG_BIN:-}" ]; then
  for candidate in /usr/lib/postgresql/16/bin /opt/homebrew/opt/postgresql@16/bin /usr/local/opt/postgresql@16/bin; do
    if [ -x "$candidate/initdb" ]; then CREDIT_PG_BIN=$candidate; break; fi
  done
  if [ -z "${CREDIT_PG_BIN:-}" ] && command -v pg_config >/dev/null 2>&1; then
    CREDIT_PG_BIN=$(pg_config --bindir)
  fi
fi
CREDIT_PG_BIN="${CREDIT_PG_BIN:?Set CREDIT_PG_BIN to PostgreSQL 16 with pgvector}"
CREDIT_API_PID=''
CREDIT_PG_STARTED=0
mkdir -p "$CREDIT_PREVIEW_ROOT/socket" "$CREDIT_PREVIEW_ROOT/storage"
cleanup() {
  if [ -n "$CREDIT_API_PID" ]; then kill "$CREDIT_API_PID" 2>/dev/null || true; wait "$CREDIT_API_PID" 2>/dev/null || true; fi
  if [ "$CREDIT_PG_STARTED" = 1 ]; then
    "$CREDIT_PG_BIN/pg_ctl" -D "$CREDIT_PREVIEW_ROOT/data" -m fast -w stop >/dev/null 2>&1 || true
    rm -f "$CREDIT_PREVIEW_ROOT/runtime.json" "$CREDIT_PREVIEW_ROOT/api.pid" "$CREDIT_PREVIEW_ROOT/runner.pid"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [ ! -f "$CREDIT_PREVIEW_ROOT/data/PG_VERSION" ]; then
  "$CREDIT_PG_BIN/initdb" -D "$CREDIT_PREVIEW_ROOT/data" -U credit_test --auth-local=trust --auth-host=reject --encoding=UTF8 --no-locale >"$CREDIT_PREVIEW_ROOT/init.log"
fi
"$CREDIT_PG_BIN/pg_ctl" -D "$CREDIT_PREVIEW_ROOT/data" -l "$CREDIT_PREVIEW_ROOT/postgres.log" -o "-k $CREDIT_PREVIEW_ROOT/socket -p 55476 -c listen_addresses=''" -w start
CREDIT_PG_STARTED=1
rm -f "$CREDIT_PREVIEW_ROOT/runtime.json"
printf '%s\n' "$$" > "$CREDIT_PREVIEW_ROOT/runner.pid"
if ! "$CREDIT_PG_BIN/psql" -h "$CREDIT_PREVIEW_ROOT/socket" -p 55476 -U credit_test -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='bc_chat_credit_test'" | grep -q '^1$'; then
  "$CREDIT_PG_BIN/createdb" -h "$CREDIT_PREVIEW_ROOT/socket" -p 55476 -U credit_test bc_chat_credit_test
fi
export DATABASE_URL="postgresql://credit_test@localhost:55476/bc_chat_credit_test?host=$CREDIT_PREVIEW_ROOT/socket&schema=public"
export NODE_ENV=test VITE_API_URL=/api/admin VITE_SENTRY_DSN=''
./node_modules/.bin/prisma migrate deploy --schema apps/api/prisma/schema.prisma >"$CREDIT_PREVIEW_ROOT/migrate.log" 2>&1
./node_modules/.bin/ts-node --transpile-only --project apps/api/tsconfig.json apps/api/e2e/support/chat-credit-preview.ts &
CREDIT_API_PID=$!
printf '%s\n' "$CREDIT_API_PID" > "$CREDIT_PREVIEW_ROOT/api.pid"
wait "$CREDIT_API_PID"
