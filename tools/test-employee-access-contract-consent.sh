#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
if [[ ! -x "$PG_BIN/initdb" ]]; then PG_BIN="$(pg_config --bindir)"; fi
ACCESS_TEST_ROOT="$(mktemp -d /tmp/bc-access-contract-consent.XXXXXX)"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$ACCESS_TEST_ROOT/data" -m immediate stop > /dev/null 2>&1 || true
  rm -rf "$ACCESS_TEST_ROOT"
}
trap cleanup EXIT
mkdir "$ACCESS_TEST_ROOT/socket"
"$PG_BIN/initdb" -D "$ACCESS_TEST_ROOT/data" -U access_test --auth-local=trust --auth-host=reject > "$ACCESS_TEST_ROOT/init.log"
"$PG_BIN/pg_ctl" -D "$ACCESS_TEST_ROOT/data" -l "$ACCESS_TEST_ROOT/postgres.log" -o "-k $ACCESS_TEST_ROOT/socket -p 55491 -c listen_addresses=''" start > /dev/null
"$PG_BIN/createdb" -U access_test -h "$ACCESS_TEST_ROOT/socket" -p 55491 bc_access_contract_consent
export EMPLOYEE_ACCESS_TEST_DATABASE_URL="postgresql://access_test@localhost:55491/bc_access_contract_consent?host=$ACCESS_TEST_ROOT/socket&schema=public"
export DATABASE_URL="$EMPLOYEE_ACCESS_TEST_DATABASE_URL" DATABASE_URL_FINANCE="$EMPLOYEE_ACCESS_TEST_DATABASE_URL"
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma > "$ACCESS_TEST_ROOT/migrate.log"
if [[ "${1:-}" == "--checks" ]]; then
  shift
  npm test --workspace=@installment/api -- --runTestsByPath src/modules/employee-access/contract-delegation-redaction.spec.ts src/sentry.spec.ts src/filters/sentry-exception.filter.spec.ts src/modules/pdpa/pdpa.service.spec.ts src/modules/employee-access/access-policy.spec.ts src/modules/contracts/contract-workflow.service.spec.ts src/modules/contracts/contract-workflow.journey.spec.ts src/modules/contracts/contract-signing-workflow.spec.ts src/modules/contracts/contract-hash.spec.ts src/modules/contracts/contracts.controller.journey.spec.ts --testPathIgnorePatterns '/node_modules/' "$@"
else
  npm test --workspace=@installment/api -- --runTestsByPath src/modules/employee-access/access-contract-consent.integration.spec.ts --testPathIgnorePatterns '/node_modules/' "$@"
fi
