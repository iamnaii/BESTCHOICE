#!/bin/sh
set -e

# Run migrations with retry (DB may have connection limits on small plans)
MAX_RETRIES=5
RETRY_DELAY=5
for i in $(seq 1 $MAX_RETRIES); do
  echo "Running database migrations (attempt $i/$MAX_RETRIES)..."
  if ./node_modules/.bin/prisma migrate deploy --schema=./apps/api/prisma/schema.prisma; then
    echo "Migrations completed successfully."
    break
  else
    if [ "$i" -eq "$MAX_RETRIES" ]; then
      echo "Migrations failed after $MAX_RETRIES attempts. Exiting."
      exit 1
    fi
    echo "Migration failed. Retrying in ${RETRY_DELAY}s..."
    sleep $RETRY_DELAY
    RETRY_DELAY=$((RETRY_DELAY * 2))
  fi
done

echo "Seeding database..."
node apps/api/dist/prisma/seed.js || echo "Seed skipped (may already exist)"

echo "Starting API server..."
exec node apps/api/dist/src/main
