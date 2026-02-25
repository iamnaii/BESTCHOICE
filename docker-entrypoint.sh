#!/bin/sh
set -e

echo "Running database migrations..."
npx prisma migrate deploy --schema=./apps/api/prisma/schema.prisma

echo "Seeding database..."
node apps/api/dist/prisma/seed.js || echo "Seed skipped (may already exist)"

echo "Starting API server..."
exec node apps/api/dist/src/main
