#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
if [[ ! -x "$PG_BIN/initdb" ]]; then PG_BIN="$(pg_config --bindir)"; fi
ACCESS_TEST_PREFIX=bc-access-generated-documents
ACCESS_TEST_ROOT="$(mktemp -d /tmp/$ACCESS_TEST_PREFIX.XXXXXX)"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$ACCESS_TEST_ROOT/data" -m immediate stop > /dev/null 2>&1 || true
  rm -rf "$ACCESS_TEST_ROOT"
}
trap cleanup EXIT
mkdir "$ACCESS_TEST_ROOT/socket"
"$PG_BIN/initdb" -D "$ACCESS_TEST_ROOT/data" -U access_test --auth-local=trust --auth-host=reject > "$ACCESS_TEST_ROOT/init.log"
"$PG_BIN/pg_ctl" -D "$ACCESS_TEST_ROOT/data" -l "$ACCESS_TEST_ROOT/postgres.log" -o "-k $ACCESS_TEST_ROOT/socket -p 55495 -c listen_addresses=''" start > /dev/null
"$PG_BIN/createdb" -U access_test -h "$ACCESS_TEST_ROOT/socket" -p 55495 bc_access_generated_documents
export EMPLOYEE_ACCESS_TEST_DATABASE_URL="postgresql://access_test@localhost:55495/bc_access_generated_documents?host=$ACCESS_TEST_ROOT/socket&schema=public"
if [[ -z "${PUPPETEER_EXECUTABLE_PATH:-}" ]]; then
  PUPPETEER_EXECUTABLE_PATH="$(node -e 'process.stdout.write(require("@playwright/test").chromium.executablePath())')"
fi
export PUPPETEER_EXECUTABLE_PATH
printf 'OWNED_GENERATED_CHROMIUM_EXECUTABLE=%s\n' "$PUPPETEER_EXECUTABLE_PATH"
"$PUPPETEER_EXECUTABLE_PATH" --version
export DATABASE_URL="$EMPLOYEE_ACCESS_TEST_DATABASE_URL" DATABASE_URL_FINANCE="$EMPLOYEE_ACCESS_TEST_DATABASE_URL"
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma > "$ACCESS_TEST_ROOT/migrate.log"
printf 'OWNED_GENERATED_DOCUMENTS_DATABASE_URL=%s\nDATABASE_URL=%s\nDATABASE_URL_FINANCE=%s\n' "$EMPLOYEE_ACCESS_TEST_DATABASE_URL" "$DATABASE_URL" "$DATABASE_URL_FINANCE"
if [[ "${1:-}" == "--canonical" ]]; then
  shift
  npm test --workspace=@installment/api -- --runTestsByPath src/modules/contracts/documents.service.spec.ts src/modules/contracts/services/document-rendering.service.spec.ts src/modules/storage/storage.service.spec.ts src/modules/contracts/contract-templates.spec.ts src/modules/audit/audit.interceptor.spec.ts src/modules/employee-access/access-policy.spec.ts --testPathIgnorePatterns '/node_modules/' "$@"
else
  npm test --workspace=@installment/api -- --runTestsByPath src/modules/employee-access/access-generated-documents.integration.spec.ts src/modules/contracts/services/generated-document-effects.spec.ts --testPathIgnorePatterns '/node_modules/' "$@"
fi
