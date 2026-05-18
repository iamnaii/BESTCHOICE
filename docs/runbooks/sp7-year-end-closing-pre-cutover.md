# SP7.9 — Year-End Closing in Legacy Entity (pre-cutover)

**Date of run:** 31 ธ.ค. 2026 23:00 BKK (before maintenance window starts at 22:00 BKK — see cutover playbook)

**Why:** Close FY2026 books in the LEGACY single-entity DB (`bc_orig`) before the SHOP/FINANCE split.
Required so:
- BC FINANCE (continuing entity) starts FY2027 with clean Retained Earnings
- Audit trail is unambiguous about end-of-FY2026 financial position
- All revenue + expense accounts → 39-9999 → 33-1101 before the migration scripts run

## Context — Legacy DB contains mixed accounts

In the current single-entity setup `bc_orig`, `chart_of_accounts` may contain:

- **FINANCE-prefix accounts**: `11-XXXX`, `21-XXXX`, `41-XXXX`, `42-XXXX`, `51–54-XXXX`, `33-1101`, `39-9999`
- **SHOP-prefix accounts** (added in SP7 for dual-entity foundation): codes prefixed with `S-` (e.g. `S-41-1101`, `S-51-1101`)

The `YearEndClosingTemplate` (P3-SP1) aggregates by 2-digit prefix (`41`, `42`, `51`, `52`, `53`, `54`). SHOP-prefix codes like `S-41-1101` start with `S-` so their 2-digit slice is `S-` — they are **ignored** by the existing closing logic.

**SP7.9 verification result:**

The existing template correctly closes ONLY FINANCE-prefix accounts. SHOP-prefix balances in `bc_orig` will **not** be closed by the year-end template. This is intentional:
- SHOP-side accounts in `bc_orig` will be extracted wholesale to `bc_shop` by the cutover migration scripts
- Their opening balances in `bc_shop` are set by the CPA-approved opening balance transfer JE (per cutover playbook Step 5)
- The accountant must confirm that SHOP-side account net in `bc_orig` matches the opening balance JE before sign-off

If you need to verify this behaviour, run the SP7.9 unit test:

```bash
cd apps/api && npx jest year-end-closing.template.spec --runInBand
```

Look for the `SP7.9 — Legacy single-entity year-end (pre-cutover sanity)` describe block.

## Pre-checks

- [ ] Accountant sign-off on Trial Balance as of 31 ธ.ค. 2026 23:00
- [ ] No open journal batches awaiting approval (filter: status=PENDING_APPROVAL in `/journal-entries`)
- [ ] All daily accrual crons have run for 31 ธ.ค.:
  - [ ] Installment accrual (00:01 BKK) — check cron log
  - [ ] VAT 60-day mandatory (02:00 BKK) — check cron log
- [ ] MAINTENANCE_MODE=true is active (see cutover playbook T-0 22:00 step)
- [ ] Backup snapshot of `bc_orig` saved (pg_dump) and verified before proceeding

## Run

```bash
# Option A — via UI (recommended for audit trail)
# 1. Open /finance/year-end-closing
# 2. Preview FY2026 — review revenue/expense totals with accountant
# 3. Click "ปิดบัญชีปีงบประมาณ 2026"
# 4. Confirm dialog

# Option B — via API (use if UI unavailable)
curl -X POST https://api.bestchoicephone.app/api/accounting/year-end-closing \
  -H "Authorization: Bearer <OWNER_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"year": 2026}'
```

## Verify

```bash
# Run trial balance for Dec 31, 2026 23:59
# GET /api/accounting/trial-balance?asOfDate=2026-12-31T16:59:59.999Z
```

- [ ] All revenue accounts (41-XXXX, 42-XXXX): balance = 0 (or within ±0.01 rounding)
- [ ] All expense accounts (51-XXXX, 52-XXXX, 53-XXXX, 54-XXXX): balance = 0
- [ ] 39-9999 Income Summary: balance = 0 (after Step 3 transfer to 33-1101)
- [ ] 33-1101 Retained Earnings: increased by net FY2026 result
- [ ] SHOP-prefix accounts (S-41-, S-51-): balances unchanged (not touched by closing)
- [ ] Snapshot pre-closing TB PDF + post-closing TB PDF → save to audit file

## After

Proceed to cutover migration per `docs/runbooks/sp7-cutover-playbook.md` — the closing entries are now in place and the books are ready for the split.

## Rollback

The closing is reversible. If cutover is aborted after closing but before migration:

```bash
# Via API
curl -X POST https://api.bestchoicephone.app/api/accounting/year-end-closing/reverse \
  -H "Authorization: Bearer <OWNER_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"year": 2026}'
```

If data drift is suspected after reversal, restore from the pre-closing pg_dump backup:

```bash
pg_restore -d bc_orig pre-cutover-snapshot.sql
```

## SP7.9 Unit Test Location

`apps/api/src/modules/journal/year-end-closing.template.spec.ts`
→ describe `SP7.9 — Legacy single-entity year-end (pre-cutover sanity)`

This test documents the verified behaviour of the existing template against mixed FINANCE + SHOP-prefix accounts in a single legacy chart.
