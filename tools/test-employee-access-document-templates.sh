#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
if [[ ! -x "$PG_BIN/initdb" ]]; then PG_BIN="$(pg_config --bindir)"; fi
ACCESS_TEST_PREFIX=bc-access-templates
ACCESS_TEST_ROOT="$(mktemp -d /tmp/$ACCESS_TEST_PREFIX.XXXXXX)"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$ACCESS_TEST_ROOT/data" -m immediate stop > /dev/null 2>&1 || true
  rm -rf "$ACCESS_TEST_ROOT"
}
trap cleanup EXIT
mkdir "$ACCESS_TEST_ROOT/socket"
"$PG_BIN/initdb" -D "$ACCESS_TEST_ROOT/data" -U access_test --auth-local=trust --auth-host=reject > "$ACCESS_TEST_ROOT/init.log"
"$PG_BIN/pg_ctl" -D "$ACCESS_TEST_ROOT/data" -l "$ACCESS_TEST_ROOT/postgres.log" -o "-k $ACCESS_TEST_ROOT/socket -p 55493 -c listen_addresses=''" start > /dev/null
"$PG_BIN/createdb" -U access_test -h "$ACCESS_TEST_ROOT/socket" -p 55493 bc_access_task2
export EMPLOYEE_ACCESS_TEST_DATABASE_URL="postgresql://access_test@localhost:55493/bc_access_task2?host=$ACCESS_TEST_ROOT/socket&schema=public"
export DATABASE_URL="$EMPLOYEE_ACCESS_TEST_DATABASE_URL" DATABASE_URL_FINANCE="$EMPLOYEE_ACCESS_TEST_DATABASE_URL"
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma > "$ACCESS_TEST_ROOT/migrate.log"
printf 'OWNED_TEMPLATE_DATABASE_URL=%s\nDATABASE_URL=%s\nDATABASE_URL_FINANCE=%s\n' "$EMPLOYEE_ACCESS_TEST_DATABASE_URL" "$DATABASE_URL" "$DATABASE_URL_FINANCE"
if [[ "${1:-}" == "--compatibility" ]]; then
  shift
  npm test --workspace=@installment/api -- --config e2e/jest-chat-credit.json --runTestsByPath e2e/sales-documents.e2e-spec.ts "$@"
elif [[ "${1:-}" == "--canonical" ]]; then
  shift
  npm test --workspace=@installment/api -- --runTestsByPath src/modules/contracts/contract-templates.spec.ts src/modules/contracts/documents.service.spec.ts src/modules/ocr/ocr.service.spec.ts src/modules/ocr/services/bank-statement-credit.spec.ts src/modules/ai-usage/ai-provider.service.spec.ts src/modules/audit/audit.interceptor.spec.ts --testPathIgnorePatterns '/node_modules/' "$@"
else
  npm test --workspace=@installment/api -- --runTestsByPath src/modules/employee-access/access-document-templates.integration.spec.ts --testPathIgnorePatterns '/node_modules/' "$@"
fi
