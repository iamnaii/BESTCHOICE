#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Existing suites use fixed PII fixtures. Each needs its own cluster/process.
if [[ "${1:-}" == "--covering" ]]; then
  shift
  bash tools/test-employee-access-party-documents.sh "$@"
  for runner in parties party-queries party-derived party-enrichment party-merge; do
    bash "tools/test-employee-access-$runner.sh" "$@"
  done
  bash tools/test-employee-access-party-documents.sh --units "$@"
  exit 0
fi
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
if [[ ! -x "$PG_BIN/initdb" ]]; then PG_BIN="$(pg_config --bindir)"; fi
ACCESS_TEST_ROOT="$(mktemp -d /tmp/bc-access-parties.XXXXXX)"
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
export STORAGE_LOCAL_DIR="$ACCESS_TEST_ROOT/private-files"
mkdir -m 700 "$STORAGE_LOCAL_DIR"
TEST_PATHS=(src/modules/employee-access/access-party-documents.integration.spec.ts)
if [[ "${1:-}" == "--units" ]]; then
  shift
  TEST_PATHS=(src/modules/customers/services/customer-document-file.spec.ts src/modules/storage/storage.service.spec.ts src/modules/audit/audit.interceptor.spec.ts src/modules/customers/customers.controller.spec.ts src/modules/customers/customers.service.spec.ts)
fi
npm test --workspace=@installment/api -- --runTestsByPath "${TEST_PATHS[@]}" --testPathIgnorePatterns '/node_modules/' "$@"
