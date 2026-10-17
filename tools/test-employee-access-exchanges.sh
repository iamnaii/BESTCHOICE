#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
if [[ ! -x "$PG_BIN/initdb" ]]; then PG_BIN="$(pg_config --bindir)"; fi
ACCESS_TEST_ROOT="$(mktemp -d /tmp/bc-access-exchanges.XXXXXX)"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$ACCESS_TEST_ROOT/data" -m immediate stop > /dev/null 2>&1 || true
  rm -rf "$ACCESS_TEST_ROOT"
}
trap cleanup EXIT
mkdir "$ACCESS_TEST_ROOT/socket"
"$PG_BIN/initdb" -D "$ACCESS_TEST_ROOT/data" -U access_test --auth-local=trust --auth-host=reject > "$ACCESS_TEST_ROOT/init.log"
"$PG_BIN/pg_ctl" -D "$ACCESS_TEST_ROOT/data" -l "$ACCESS_TEST_ROOT/postgres.log" -o "-k $ACCESS_TEST_ROOT/socket -p 55491 -c listen_addresses=''" start > /dev/null
"$PG_BIN/createdb" -U access_test -h "$ACCESS_TEST_ROOT/socket" -p 55491 bc_access_task2
export EMPLOYEE_ACCESS_TEST_DATABASE_URL="postgresql://access_test@localhost:55491/bc_access_task2?host=$ACCESS_TEST_ROOT/socket&schema=public"
export DATABASE_URL="$EMPLOYEE_ACCESS_TEST_DATABASE_URL" DATABASE_URL_FINANCE="$EMPLOYEE_ACCESS_TEST_DATABASE_URL"
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma > "$ACCESS_TEST_ROOT/migrate.log"
if [[ "${1:-}" == "--legacy" ]]; then
  shift
  # This legacy suite imports only lifecycle/assertion globals from Vitest.
  # Bridge those globals to Jest in this owned temporary harness, without
  # replacing any service, financial writer, or database dependency.
  cat > "$ACCESS_TEST_ROOT/vitest-jest.cjs" <<'JS'
// Vitest's optional second expect argument is a diagnostic label only.
const expectWithoutLabel = new Proxy(expect, { apply(target, receiver, args) {
  return Reflect.apply(target, receiver, [args[0]]);
} });
module.exports = { describe, it, expect: expectWithoutLabel, beforeAll, afterAll };
JS
  npm test --workspace=@installment/api -- --runTestsByPath src/modules/contract-exchange/__tests__/exchange-priced-flow.integration.spec.ts --testPathIgnorePatterns '/node_modules/' --moduleNameMapper="{\"^vitest$\":\"$ACCESS_TEST_ROOT/vitest-jest.cjs\"}" "$@"
else
  npm test --workspace=@installment/api -- --runTestsByPath src/modules/employee-access/access-exchanges.integration.spec.ts --testPathIgnorePatterns '/node_modules/' "$@"
fi
