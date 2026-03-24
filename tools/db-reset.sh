#!/bin/bash
# Reset development database: drop + migrate + seed
# Usage: ./tools/db-reset.sh
# WARNING: This will DELETE all data in the dev database!

set -e

echo "WARNING: This will reset the development database and DELETE all data!"
echo "Press Ctrl+C to cancel, or Enter to continue..."
read -r

echo "=== Resetting database ==="

cd apps/api

echo "--- Running migrations from scratch ---"
npx prisma migrate reset --force

echo "--- Generating Prisma client ---"
npx prisma generate

echo ""
echo "Database reset complete!"
echo "Dev account: admin@bestchoice.com / admin1234"
