#!/usr/bin/env bash
# Documents integration harness (DOC-00, issue #1559).
#
# From a clean checkout:   bash tools/docs-integration.sh [jest args…]
# One domain only:         bash tools/docs-integration.sh contract-pdpa
# Two workers at once:     run the command twice — every run owns its PostgreSQL
#                          (private unix socket), storage dir and output dir.
#
# The run never touches an application database, a real bucket or any outbound
# provider: DATABASE_URL* point at databases created here, STORAGE_LOCAL_DIR is a
# private directory under the output folder and every provider credential is
# pinned to '' so no .env file can re-enable it inside the process.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=$(pwd -P)
RUN_ID=${DOCS_QA_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}
OUT=${DOCS_QA_OUTPUT:-$REPO/.tmp/docs-integration/$RUN_ID}
mkdir -p "$OUT/storage" "$OUT/manifest"
export DOCS_QA_RUN_ID="$RUN_ID" DOCS_QA_OUTPUT="$OUT"

if [ -z "${DOCS_PG_BIN:-}" ]; then
  DOCS_PG_BIN=${CREDIT_PG_BIN:-}
fi
if [ -z "${DOCS_PG_BIN:-}" ]; then
  for candidate in /usr/lib/postgresql/16/bin /opt/homebrew/opt/postgresql@16/bin /usr/local/opt/postgresql@16/bin; do
    if [ -x "$candidate/initdb" ]; then DOCS_PG_BIN=$candidate; break; fi
  done
  if [ -z "${DOCS_PG_BIN:-}" ] && command -v pg_config >/dev/null 2>&1; then
    DOCS_PG_BIN=$(pg_config --bindir)
  fi
fi
for program in initdb pg_ctl createdb; do
  if [ ! -x "${DOCS_PG_BIN:-}/$program" ]; then
    echo 'Set DOCS_PG_BIN (or CREDIT_PG_BIN) to a PostgreSQL 16 installation with pgvector.' >&2
    exit 1
  fi
done

PG_STARTED=0
PG_ROOT=$(mktemp -d /tmp/bc-docs.XXXXXX)
mkdir "$PG_ROOT/socket"
cleanup() {
  if [ "$PG_STARTED" = 1 ] && "$DOCS_PG_BIN/pg_ctl" -D "$PG_ROOT/data" -m fast -w stop >/dev/null 2>&1; then
    if [ "${DOCS_QA_KEEP_DB:-0}" != 1 ]; then rm -rf "$PG_ROOT/data"; fi
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Runtime that the harness verifies (apps/api/e2e/documents/support/runtime.ts).
export NODE_ENV=test TZ=Asia/Bangkok
export JWT_SECRET=$(openssl rand -hex 32) JWT_REFRESH_SECRET=$(openssl rand -hex 32) JWT_EXPIRATION=15m JWT_REFRESH_EXPIRATION=7d
export PII_ENCRYPTION_KEY=$(openssl rand -hex 32) PII_HASH_SALT=$(openssl rand -hex 32) ENCRYPTION_KEY=$(openssl rand -hex 16)
export STORAGE_LOCAL_DIR="$OUT/storage"
export FRONTEND_URL=${FRONTEND_URL:-http://localhost:5173}
export OFFSITE_BACKUP_ENABLED=false ETAX_SUBMIT_MODE=disabled LINE_SHOP_AI_ENABLED=false SMS_PAYMENT_REMINDER_DISABLED=true MAINTENANCE_MODE=
for variable in LINE_CHANNEL_ACCESS_TOKEN LINE_CHANNEL_SECRET LINE_FINANCE_CHANNEL_ACCESS_TOKEN LINE_FINANCE_CHANNEL_SECRET \
  LINE_STAFF_CHANNEL_ACCESS_TOKEN LINE_STAFF_NOTIFY_TARGETS LINE_LOGIN_CHANNEL_SECRET LIFF_CHANNEL_ID SMS_API_KEY SMS_API_SECRET \
  SMTP_HOST SMTP_USER SMTP_PASS ANTHROPIC_API_KEY SENTRY_DSN FACEBOOK_PAGE_ACCESS_TOKEN FACEBOOK_APP_SECRET \
  PAYSOLUTIONS_MERCHANT_ID PAYSOLUTIONS_SECRET_KEY PAYSOLUTIONS_API_KEY GCS_BUCKET S3_ENDPOINT S3_ACCESS_KEY S3_SECRET_KEY CLOUDFLARE_TURNSTILE_SECRET; do
  export "$variable="
done
export PUPPETEER_EXECUTABLE_PATH=${PUPPETEER_EXECUTABLE_PATH:-$(node tools/docs-integration.mjs chromium)}

if [ "${DOCS_QA_SKIP_PREPARE:-0}" != 1 ]; then
  npm run build --workspace=@installment/shared >"$OUT/prepare.log" 2>&1
  ./node_modules/.bin/prisma generate --schema apps/api/prisma/schema.prisma >>"$OUT/prepare.log" 2>&1
  ./node_modules/.bin/prisma generate --schema apps/api/prisma-finance/schema.prisma >>"$OUT/prepare.log" 2>&1
fi

"$DOCS_PG_BIN/initdb" -D "$PG_ROOT/data" -U docs_test --auth-local=trust --auth-host=reject --encoding=UTF8 --no-locale >"$PG_ROOT/init.log"
# timezone=UTC: production Cloud SQL runs in UTC while this process runs in Asia/Bangkok
# (initdb would otherwise copy TZ into postgresql.conf). SQL that compares a `timestamp`
# column against NOW()/a bound Date is interpreted in the session zone, so a Bangkok
# session would shift every such window by 7 hours relative to production (DOC-10, #1569).
"$DOCS_PG_BIN/pg_ctl" -D "$PG_ROOT/data" -l "$PG_ROOT/postgres.log" \
  -o "-k $PG_ROOT/socket -p 55477 -c listen_addresses='' -c timezone=UTC -c log_timezone=UTC -c fsync=off -c synchronous_commit=off -c full_page_writes=off" -w start >/dev/null
PG_STARTED=1
"$DOCS_PG_BIN/createdb" -h "$PG_ROOT/socket" -p 55477 -U docs_test bc_docs_shop
"$DOCS_PG_BIN/createdb" -h "$PG_ROOT/socket" -p 55477 -U docs_test bc_docs_finance
export DATABASE_URL="postgresql://docs_test@localhost:55477/bc_docs_shop?host=$PG_ROOT/socket&schema=public"
export DATABASE_URL_FINANCE="postgresql://docs_test@localhost:55477/bc_docs_finance?host=$PG_ROOT/socket&schema=public"
if ! ./node_modules/.bin/prisma migrate deploy --schema apps/api/prisma/schema.prisma >"$OUT/migrate-shop.log" 2>&1; then
  tail -60 "$OUT/migrate-shop.log"; exit 1
fi
if ! ./node_modules/.bin/prisma migrate deploy --schema apps/api/prisma-finance/schema.prisma >"$OUT/migrate-finance.log" 2>&1; then
  tail -60 "$OUT/migrate-finance.log"; exit 1
fi
printf 'Disposable PostgreSQL ready (%s); output %s\n' "$PG_ROOT" "$OUT"

node tools/docs-integration.mjs run "$@"
