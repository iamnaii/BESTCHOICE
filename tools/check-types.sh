#!/bin/bash
# Check TypeScript errors
# Usage: ./tools/check-types.sh [api|web|all]
# Default: all

set -e

TARGET="${1:-all}"

check_api() {
  echo "=== Checking API TypeScript ==="
  cd apps/api && npx tsc --noEmit
  echo "API: OK"
  cd ../..
}

check_web() {
  echo "=== Checking Web TypeScript ==="
  cd apps/web && npx tsc --noEmit
  echo "Web: OK"
  cd ../..
}

case "$TARGET" in
  api)
    check_api
    ;;
  web)
    check_web
    ;;
  all)
    check_api
    echo ""
    check_web
    ;;
  *)
    echo "Usage: ./tools/check-types.sh [api|web|all]"
    exit 1
    ;;
esac

echo ""
echo "TypeScript check passed!"
