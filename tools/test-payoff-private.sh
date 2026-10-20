#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
if [[ ! -x "$PG_BIN/initdb" ]]; then PG_BIN="$(pg_config --bindir)"; fi
PAYOFF_TEST_ROOT="$(mktemp -d /tmp/bc-payoff-private.XXXXXX)"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$PAYOFF_TEST_ROOT/data" -m immediate stop > /dev/null 2>&1 || true
  rm -rf "$PAYOFF_TEST_ROOT"
}
trap cleanup EXIT
mkdir "$PAYOFF_TEST_ROOT/socket"
"$PG_BIN/initdb" -D "$PAYOFF_TEST_ROOT/data" -U access_test --auth-local=trust --auth-host=reject > "$PAYOFF_TEST_ROOT/init.log"
"$PG_BIN/pg_ctl" -D "$PAYOFF_TEST_ROOT/data" -l "$PAYOFF_TEST_ROOT/postgres.log" -o "-k $PAYOFF_TEST_ROOT/socket -p 55492 -c listen_addresses=''" start > /dev/null
"$PG_BIN/createdb" -U access_test -h "$PAYOFF_TEST_ROOT/socket" -p 55492 bc_payoff_private
export PAYOFF_PRIVATE_TEST_DATABASE_URL="postgresql://access_test@localhost:55492/bc_payoff_private?host=$PAYOFF_TEST_ROOT/socket&schema=public"
export DATABASE_URL="$PAYOFF_PRIVATE_TEST_DATABASE_URL" DATABASE_URL_FINANCE="$PAYOFF_PRIVATE_TEST_DATABASE_URL"
[[ "$DATABASE_URL" == "$PAYOFF_PRIVATE_TEST_DATABASE_URL" && "$DATABASE_URL_FINANCE" == "$PAYOFF_PRIVATE_TEST_DATABASE_URL" ]] || exit 91
export PAYOFF_PRIVATE_FILES="$PAYOFF_TEST_ROOT/private-files"
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma > "$PAYOFF_TEST_ROOT/migrate.log"
npm test --workspace=@installment/api -- --runTestsByPath src/modules/contracts/payoff-private.integration.spec.ts --testPathIgnorePatterns '/node_modules/' "$@"
