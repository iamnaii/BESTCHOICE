#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build --workspace=@installment/shared
APPT_PG_BIN=${CREDIT_PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}
if [ ! -x "$APPT_PG_BIN/initdb" ]; then APPT_PG_BIN=$(pg_config --bindir); fi
APPT_ROOT=$(mktemp -d /tmp/bc-appointments.XXXXXX)
mkdir "$APPT_ROOT/socket"
APPT_STARTED=0
cleanup() {
  if [ "$APPT_STARTED" = 1 ]; then "$APPT_PG_BIN/pg_ctl" -D "$APPT_ROOT/data" -m fast -w stop >/dev/null; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
"$APPT_PG_BIN/initdb" -D "$APPT_ROOT/data" -U appointment_test --auth-local=trust --auth-host=reject --encoding=UTF8 --no-locale > "$APPT_ROOT/init.log"
"$APPT_PG_BIN/pg_ctl" -D "$APPT_ROOT/data" -l "$APPT_ROOT/postgres.log" -o "-k $APPT_ROOT/socket -p 55478 -c listen_addresses=''" -w start
APPT_STARTED=1
"$APPT_PG_BIN/createdb" -h "$APPT_ROOT/socket" -p 55478 -U appointment_test bc_appointments_test
export DATABASE_URL="postgresql://appointment_test@localhost:55478/bc_appointments_test?host=$APPT_ROOT/socket&schema=public"
export DATABASE_URL_FINANCE="$DATABASE_URL"
export NODE_ENV=test TZ=Asia/Bangkok
export PII_ENCRYPTION_KEY=e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0
export PII_HASH_SALT=e2e-pii-hash-salt-32-chars-minimum-ci
./node_modules/.bin/prisma migrate deploy --schema apps/api/prisma/schema.prisma > "$APPT_ROOT/migrate.log" 2>&1 || { tail -50 "$APPT_ROOT/migrate.log"; exit 1; }
printf 'Isolated appointment DB: %s\n' "$APPT_ROOT"
cd apps/api
../../node_modules/.bin/jest --config e2e/jest-appointments.json --runInBand "$@"
