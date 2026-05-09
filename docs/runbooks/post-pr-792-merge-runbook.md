# Post-merge runbook — PR #792 (CPA legal-compliance consolidation)

**Merged commit:** `20b5cc79` (PR #792) + `82d25589` (PR #793 CSV golden fix)
**Date:** 2026-05-09

## Auto-applied via CI/CD (no action needed)

Github Actions workflow `deploy-gcp.yml` runs on push to `main` and:

1. **Migrations apply automatically** via Cloud Run Job:
   ```
   gcloud run jobs execute migrate-prod --args="prisma,migrate,deploy,--schema=./apps/api/prisma/schema.prisma"
   ```
   Migrations included in this merge:
   - `20260808100000_asset_phase1` — Asset Module Phase 1 schema (FixedAsset, AssetTransferHistory, etc.)
   - `20260809000000_depreciation_reverse_tracking` — DepreciationEntry +reversedAt/reversedById
   - `20260909100000_drop_redundant_period_index`
   - `20260909110000_add_wht_form_type_to_expense` — Expense.whtFormType column

2. **API + Web deploy** to Cloud Run via `bestchoice-api` and Firebase

Verify via:
```bash
gh run list --workflow=deploy-gcp.yml --limit 3
gcloud run services describe bestchoice-api --region=asia-southeast1 --project=bestchoice-prod
```

## Manual: backfill historical inclusive-VAT assets (CRITICAL #2 fix)

Pre-existing assets posted with `vatInclusive=true` before this PR have JE missing the `Dr 11-4101` line. The new CLI corrects them.

### Step 1: DRY_RUN to inspect candidates

```bash
gcloud run jobs execute backfill-asset-vat \
  --region=asia-southeast1 \
  --project=bestchoice-prod \
  --update-env-vars=EXPECTED_DB_NAME=bestchoice_prod,DRY_RUN=true \
  --wait
```

Read the output. It will list affected assets but not modify anything.

### Step 2: LIVE run (only if DRY_RUN output looks correct)

```bash
gcloud run jobs execute backfill-asset-vat \
  --region=asia-southeast1 \
  --project=bestchoice-prod \
  --update-env-vars=EXPECTED_DB_NAME=bestchoice_prod,DRY_RUN=false,ALLOW_PROD_BACKFILL=YES_I_AM_SURE \
  --wait
```

For each affected asset, the CLI posts a correction JE:
```
Dr 11-4101 vatAmount
  Cr <coaCostAccount> vatAmount
```
And reduces the asset's `purchaseCost` + `netBookValue` by `vatAmount` (VAT belongs in 11-4101 not 12-2XXX).

### Step 3: Verify

```sql
-- Should return 0 rows after backfill
SELECT a.id, a.asset_code, a.vat_amount, je.entry_number
FROM fixed_assets a
JOIN journal_entries je ON je.metadata->>'assetId' = a.id::text
WHERE a.vat_inclusive = true
  AND a.has_vat = true
  AND a.deleted_at IS NULL
  AND je.metadata->>'flow' = 'asset-purchase'
  AND a.id NOT IN (
    SELECT (metadata->>'assetId')::uuid
    FROM journal_entries
    WHERE metadata->>'flow' = 'asset-vat-backfill'
      AND deleted_at IS NULL
  );
```

### Pre-Cloud-Run-Job setup (one-time)

If `backfill-asset-vat` Cloud Run Job doesn't exist yet, create it:

```bash
gcloud run jobs create backfill-asset-vat \
  --image=asia-southeast1-docker.pkg.dev/bestchoice-prod/bestchoice/api:latest \
  --region=asia-southeast1 \
  --project=bestchoice-prod \
  --command=npm \
  --args=run,backfill:asset-vat \
  --set-env-vars=NODE_ENV=production \
  --set-secrets=DATABASE_URL=database-url:latest
```

## Manual: review historical asset disposals (CRITICAL #3)

Previous asset disposals where the buyer received a tax invoice had VAT booked via Manual JE (or not at all). No automated backfill — reconcile against vendor sales records:

```sql
-- Asset disposals posted before 2026-05-09 — review tax invoice handling
SELECT je.entry_number, je.posted_at,
  je.metadata->>'assetCode' AS asset_code,
  je.metadata->>'disposalProceeds' AS proceeds,
  je.metadata->>'gainOrLoss' AS gain_loss,
  EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.journal_entry_id = je.id AND jl.account_code = '21-2101') AS has_vat_line
FROM journal_entries je
WHERE je.metadata->>'flow' = 'asset-disposal'
  AND je.posted_at < '2026-05-09'
  AND je.deleted_at IS NULL
ORDER BY je.posted_at DESC;
```

Cross-reference each disposal against:
- The buyer's invoice request
- VAT remittance for the period (was VAT remitted manually?)

For each tax-invoice disposal that wasn't booked through the new auto-VAT path, post a Manual JE: `Dr 12-2102 0 / Cr 21-2101 vatAmount + Dr cash vatAmount` to record the VAT collection that wasn't auto-recognized.

## Smoke tests after deploy

1. **Expense WHT path** — Create test expense with `withholdingTax=500`, `vendorTaxId='0...'` (corporate). Mark paid. Verify JE has `Cr 21-3103 500` and `Cr cash = totalAmount - 500`.

2. **Expense atomicity** — Create test expense with bad accountCode (force JE failure). Mark paid. Verify status remains `APPROVED` (rolled back).

3. **Expense VOID auto-reverse** — VOID a PAID expense. Verify mirror JE posted with `[VOID]` prefix and `metadata.reversed=true` on original.

4. **Asset WHT goods rejection** — Try to create asset with `hasWht=true, installationCost=0`. Expect `400` with Thai legal citation.

5. **Asset VAT inclusive** — Create asset with `basePrice=21400, vatInclusive=true, hasVat=true`. Post. Verify JE has `Dr 12-XXXX 20,000`, `Dr 11-4101 1,400`, `Cr cash 21,400`.

6. **Asset disposal with tax invoice** — Dispose POSTED asset with `proceeds=40000, issueTaxInvoice=true`. Verify JE has `Cr 21-2101 2,800` and cash `Dr 42,800`.

7. **2A auto-consume** — Park `Contract.advanceBalance=2000` on an active contract. Run accrual cron for installment due today. Verify both 2A JE + advance-consume JE post atomically, and `Payment.status=PAID` for the covered installment.

## Known carry-over from main (not regression)

- 1 stale jest assertion in `installment-accrual-2a.template.spec.ts` (CSV golden case-1) — fixed in PR #793 (commit `82d25589`)

## Rollback plan

If anything regresses post-deploy:

1. **Revert the merge commit** on main:
   ```bash
   git revert -m 1 20b5cc79 -m 1 82d25589
   git push origin main
   ```
2. CI auto-deploys the reverted version.
3. **DO NOT revert migrations** — they're additive (new fields/tables) and won't break the previous code path. Reverting migrations risks data loss.
4. The backfill correction JEs are also additive — leave them in place.
