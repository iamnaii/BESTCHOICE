# SP7 Migration Runbook — SHOP/FINANCE Legal Split

**Target date:** 1 มกราคม 2567 (1 Jan 2027)  
**Execution window:** Freeze night before (00:00–06:00 BKK)

---

## Pre-Cutover Checklist

All items must be completed and signed before running `cutover.sh`.

| # | Item | Owner | Status |
|---|------|-------|--------|
| 1 | CPA approves OQ4 (opening balance transfer plan) | CPA | BLOCKED |
| 2 | BC SHOP tax ID registered with Revenue Department | Owner | BLOCKED |
| 3 | bc_finance DB provisioned + credentials in Vault | DevOps | Pending |
| 4 | bc_shop DB provisioned + credentials in Vault | DevOps | Pending |
| 5 | Prisma schema deployed to both new DBs (empty state) | Dev | Pending |
| 6 | Rehearsal #1: staging clone + extract (dry run) | Dev | Pending |
| 7 | Rehearsal #2: full smoke test on staging split | Dev + Accountant | Pending |
| 8 | Accountant signs off on edge-case CSV classifications | Accountant | Pending |
| 9 | Owner approves maintenance window announcement | Owner | Pending |

---

## Cutover Steps

### 1. Enter maintenance mode
Disable write endpoints on bc_orig Cloud Run instance. Keep read-only health check alive.

### 2. Final backup
```bash
pg_dump --no-owner --no-privileges "$ORIG_DB_URL" > /backup/bc-orig-final-$(date +%Y%m%d).sql
```
Upload to GCS: `gs://bestchoice-backups/sp7-migration/`.

### 3. Run cutover orchestrator
```bash
cd apps/api
ORIG_DB_URL=... FINANCE_DB_URL=... SHOP_DB_URL=... \
  CONFIRM_CLONE=YES_I_AM_SURE \
  CONFIRM_EXTRACT=YES_I_AM_SURE \
  EXPECTED_ORIG_DB_NAME=bestchoice_prod \
  bash scripts/migration/cutover.sh
```

### 4. Edge case audit (review CSVs)
CSVs written to `docs/migration/audit-*-<date>.csv`. Accountant must review and confirm classification before step 5.

### 5. Post opening balance JEs (CPA-approved)
After CPA approves the transfer plan JSON:
```bash
CPA_APPROVED_PLAN_PATH=/path/to/approved-plan.json \
  CONFIRM_POST=YES_I_AM_SURE \
  npx tsx src/cli/post-opening-balance-transfer-sp7.cli.ts
```

### 6. Deploy dual-Prisma API builds
- bc_finance Cloud Run: `DATABASE_URL=<finance_url> SHOP_DB_URL=<shop_url>`
- bc_shop Cloud Run (SHOP service): `DATABASE_URL=<shop_url>`

### 7. Smoke tests
```bash
# Both health checks must return 200
curl -f https://api.bestchoicephone.app/api/health
curl -f https://shop.bestchoicephone.app/api/health

# Login as OWNER — verify pill switcher shows both entities
# Login as SALES — verify single SHOP zone only
```

### 8. Re-enable write endpoints

---

## Rollback Playbook

If any step fails after cutover.sh starts:

### Before step 5 (no JEs posted yet)
1. Stop both new Cloud Run instances
2. Point DNS back to bc_orig Cloud Run
3. bc_orig data is untouched (scripts only write to finance + shop DBs)
4. Exit maintenance mode

### After step 5 (JEs posted)
1. Contact CPA immediately — reversing JEs required
2. Post reversal JEs in both bc_finance + bc_shop (manual, CPA-directed)
3. Restore bc_orig from pre-cutover backup
4. Point DNS back to bc_orig
5. File incident report

**RPO:** 0 data loss (bc_orig unchanged until officially decommissioned)  
**RTO:** ~30 min for DNS propagation + smoke tests

---

## Post-Cutover Stabilization (7-Day Watch)

| Day | Action |
|-----|--------|
| D+1 | Verify trial balance in both DBs. Compare to bc_orig snapshot |
| D+2 | Accountant reconciles A/R, A/P, inventory balances |
| D+3 | First FINANCE installment payment received via new instance — verify JE |
| D+5 | SHOP first sale through new instance — verify stock + commission JE |
| D+7 | Sign-off meeting: Owner + Accountant + CPA. Decommission bc_orig if clean |

---

## Known Deferred Items

- `copyTable()` in `extract-shop-from-finance.cli.ts` is a skeleton — needs proper `COPY ... STDOUT/STDIN` streaming for tables > 1 GB
- Shared tables (users, audit_logs, etc.) are copied to both DBs; read-through pattern deferred to SP7.8
- `post-opening-balance-transfer-sp7.cli.ts` blocked on CPA OQ4 approval
- outbox_event cross-linking between FINANCE + SHOP JEs deferred to SP7.9
