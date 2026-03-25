#!/bin/bash
set -euo pipefail

# Only run full setup in remote (Claude Code on the web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-/home/user/BESTCHOICE}"

echo "[SessionStart] Installing npm dependencies..."
cd "$PROJECT_DIR"
npm install --prefer-offline 2>&1 | tail -5

echo "[SessionStart] Generating Prisma client..."
cd "$PROJECT_DIR/apps/api"
npx prisma generate 2>&1 | tail -3

echo "[SessionStart] Installing Playwright chromium..."
cd "$PROJECT_DIR/apps/web"
npx playwright install chromium --with-deps 2>&1 | tail -3

echo "[SessionStart] Setup complete."
