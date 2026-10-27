#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
if [[ ! -x "$PG_BIN/initdb" ]]; then PG_BIN="$(pg_config --bindir)"; fi
CANCELLATION_TEST_ROOT="$(mktemp -d /tmp/bc-contract-cancellation.XXXXXX)"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$CANCELLATION_TEST_ROOT/data" -m immediate stop > /dev/null 2>&1 || true
  rm -rf "$CANCELLATION_TEST_ROOT"
}
trap cleanup EXIT
mkdir "$CANCELLATION_TEST_ROOT/socket"
"$PG_BIN/initdb" -D "$CANCELLATION_TEST_ROOT/data" -U access_test --auth-local=trust --auth-host=reject > "$CANCELLATION_TEST_ROOT/init.log"
"$PG_BIN/pg_ctl" -D "$CANCELLATION_TEST_ROOT/data" -l "$CANCELLATION_TEST_ROOT/postgres.log" -o "-k $CANCELLATION_TEST_ROOT/socket -p 55494 -c listen_addresses=''" start > /dev/null
"$PG_BIN/createdb" -U access_test -h "$CANCELLATION_TEST_ROOT/socket" -p 55494 bc_contract_cancellation
export CONTRACT_CANCELLATION_TEST_DATABASE_URL="postgresql://access_test@localhost:55494/bc_contract_cancellation?host=$CANCELLATION_TEST_ROOT/socket&schema=public"
export DATABASE_URL="$CONTRACT_CANCELLATION_TEST_DATABASE_URL" DATABASE_URL_FINANCE="$CONTRACT_CANCELLATION_TEST_DATABASE_URL"
[[ "$DATABASE_URL" == "$CONTRACT_CANCELLATION_TEST_DATABASE_URL" && "$DATABASE_URL_FINANCE" == "$CONTRACT_CANCELLATION_TEST_DATABASE_URL" ]] || exit 91
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma > "$CANCELLATION_TEST_ROOT/migrate.log"
cd apps/api
if [[ "${CANCELLATION_CANONICAL:-0}" == "1" ]]; then
  npx vitest run --no-file-parallelism src/modules/contracts/__tests__/contract-cancellation.integration.spec.ts src/modules/contracts/__tests__/contract-bundles.integration.spec.ts src/modules/contracts/__tests__/shop-tenders.integration.spec.ts "$@"
else
  node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/modules/contracts/cancellation-access.integration.spec.ts --testPathIgnorePatterns '/node_modules/' "$@"
fi
