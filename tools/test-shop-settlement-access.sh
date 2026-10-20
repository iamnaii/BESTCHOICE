#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
if [[ ! -x "$PG_BIN/initdb" ]]; then PG_BIN="$(pg_config --bindir)"; fi
SETTLEMENT_TEST_ROOT="$(mktemp -d /tmp/bc-shop-settlement.XXXXXX)"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$SETTLEMENT_TEST_ROOT/data" -m immediate stop > /dev/null 2>&1 || true
  rm -rf "$SETTLEMENT_TEST_ROOT"
}
trap cleanup EXIT
mkdir "$SETTLEMENT_TEST_ROOT/socket"
"$PG_BIN/initdb" -D "$SETTLEMENT_TEST_ROOT/data" -U access_test --auth-local=trust --auth-host=reject > "$SETTLEMENT_TEST_ROOT/init.log"
"$PG_BIN/pg_ctl" -D "$SETTLEMENT_TEST_ROOT/data" -l "$SETTLEMENT_TEST_ROOT/postgres.log" -o "-k $SETTLEMENT_TEST_ROOT/socket -p 55493 -c listen_addresses=''" start > /dev/null
"$PG_BIN/createdb" -U access_test -h "$SETTLEMENT_TEST_ROOT/socket" -p 55493 bc_shop_settlement
export SHOP_SETTLEMENT_TEST_DATABASE_URL="postgresql://access_test@localhost:55493/bc_shop_settlement?host=$SETTLEMENT_TEST_ROOT/socket&schema=public"
export DATABASE_URL="$SHOP_SETTLEMENT_TEST_DATABASE_URL" DATABASE_URL_FINANCE="$SHOP_SETTLEMENT_TEST_DATABASE_URL"
[[ "$DATABASE_URL" == "$SHOP_SETTLEMENT_TEST_DATABASE_URL" && "$DATABASE_URL_FINANCE" == "$SHOP_SETTLEMENT_TEST_DATABASE_URL" ]] || exit 91
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma > "$SETTLEMENT_TEST_ROOT/migrate.log"
cd apps/api
if [[ "${SETTLEMENT_CANONICAL:-0}" == "1" ]]; then
  npx vitest run --no-file-parallelism src/modules/contracts/shop-collect-settlement.integration.spec.ts src/modules/contracts/shop-collect-payoff.integration.spec.ts src/modules/journal/cpa-templates/shop-collect-settlement.template.spec.ts src/modules/journal/cpa-templates/shop-collect-shop-legs.template.spec.ts src/modules/journal/cpa-templates/shop-collect-coa.integration.spec.ts "$@"
else
  node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/modules/contracts/shop-settlement-access.integration.spec.ts --testPathIgnorePatterns '/node_modules/' "$@"
fi
