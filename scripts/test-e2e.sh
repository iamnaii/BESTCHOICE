#!/bin/bash
# E2E Test Runner for BESTCHOICE
# Usage: ./scripts/test-e2e.sh [test-file] [--headed]
#
# Examples:
#   ./scripts/test-e2e.sh                    # Run all tests
#   ./scripts/test-e2e.sh login              # Run login tests only
#   ./scripts/test-e2e.sh navigation         # Run navigation tests only
#   ./scripts/test-e2e.sh --headed           # Run all tests with browser visible
#   ./scripts/test-e2e.sh login --headed     # Run login tests with browser visible

set -e

# Playwright config lives in apps/web/ — always run from there
cd "$(dirname "$0")/../apps/web"

# Check if Playwright browsers are installed
if ! npx playwright install --check 2>/dev/null; then
  echo "Installing Playwright browsers..."
  npx playwright install chromium
fi

ARGS=""
HEADED=""

for arg in "$@"; do
  case $arg in
    --headed)
      HEADED="--headed"
      ;;
    *)
      ARGS="e2e/${arg}.spec.ts"
      ;;
  esac
done

echo "Running E2E tests..."
echo "Base URL: ${BASE_URL:-http://localhost:5173}"
echo ""

npx playwright test $ARGS $HEADED
