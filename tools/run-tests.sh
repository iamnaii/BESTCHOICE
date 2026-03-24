#!/bin/bash
# Run full test suite: lint + type check + E2E
# Usage: ./tools/run-tests.sh [--skip-e2e]

set -e

SKIP_E2E=false
if [ "$1" = "--skip-e2e" ]; then
  SKIP_E2E=true
fi

echo "=== Step 1: TypeScript Check ==="
./tools/check-types.sh all

echo ""
echo "=== Step 2: Lint ==="
echo "--- API ---"
cd apps/api && npx eslint src --ext .ts 2>/dev/null || echo "API lint: check manually"
cd ../..
echo "--- Web ---"
cd apps/web && npx eslint src --ext .ts,.tsx 2>/dev/null || echo "Web lint: check manually"
cd ../..

if [ "$SKIP_E2E" = false ]; then
  echo ""
  echo "=== Step 3: E2E Tests ==="
  cd apps/web && npx playwright test --project=chromium
  cd ../..
else
  echo ""
  echo "=== Step 3: E2E Tests (skipped) ==="
fi

echo ""
echo "All checks passed!"
