#!/usr/bin/env bash
# SP7.7 — Cutover orchestrator: bc_orig → bc_finance + bc_shop
#
# Run from apps/api/ directory. Requires:
#   ORIG_DB_URL, FINANCE_DB_URL, SHOP_DB_URL — all 3 DB URLs
#   CONFIRM_CLONE=YES_I_AM_SURE
#   CONFIRM_EXTRACT=YES_I_AM_SURE
#   EXPECTED_ORIG_DB_NAME — bestchoice_prod / bestchoice_staging / etc.
#
# Steps:
#   1. Backup bc_orig (pg_dump)
#   2. Clone bc_orig → bc_finance
#   3. Extract SHOP-side from bc_finance → bc_shop
#   4. Apply opening balance transfer JE (BLOCKED on CPA — placeholder echo)
#   5. Audit edge cases (CSV out)
#   6. Smoke test both DBs

set -euo pipefail

log() { echo "[cutover] $(date +%Y-%m-%dT%H:%M:%S%z) $*"; }

log "Pre-flight env check"
: "${ORIG_DB_URL:?ORIG_DB_URL required}"
: "${FINANCE_DB_URL:?FINANCE_DB_URL required}"
: "${SHOP_DB_URL:?SHOP_DB_URL required}"
: "${CONFIRM_CLONE:?CONFIRM_CLONE=YES_I_AM_SURE required}"
: "${CONFIRM_EXTRACT:?CONFIRM_EXTRACT=YES_I_AM_SURE required}"
: "${EXPECTED_ORIG_DB_NAME:?EXPECTED_ORIG_DB_NAME required}"

log "Step 1: Backup bc_orig"
BACKUP_FILE="/tmp/bc-orig-pre-cutover-$(date +%Y%m%d-%H%M%S).sql"
pg_dump --no-owner --no-privileges "$ORIG_DB_URL" > "$BACKUP_FILE"
log "Backup at $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

log "Step 2: Clone bc_orig → bc_finance"
npx tsx src/cli/clone-orig-to-finance.cli.ts

log "Step 3: Extract SHOP-side → bc_shop"
npx tsx src/cli/extract-shop-from-finance.cli.ts

log "Step 4: Opening balance transfer JE — BLOCKED on CPA approval"
log "Run when ready: CPA_APPROVED_PLAN_PATH=... npx tsx src/cli/post-opening-balance-transfer-sp7.cli.ts"

log "Step 5: Audit edge cases → CSV"
DATABASE_URL="$FINANCE_DB_URL" npx tsx src/cli/audit-edge-cases-sp7.cli.ts

log "Step 6: Smoke test (TODO — implement)"
log "  - Verify row counts: SELECT COUNT(*) FROM users; in both DBs"
log "  - Verify health endpoints: /api/health from both Cloud Run instances"
log "  - Login as OWNER and verify pill switcher shows both"

log "Cutover orchestrator complete. Review CSV audits with accountant."
