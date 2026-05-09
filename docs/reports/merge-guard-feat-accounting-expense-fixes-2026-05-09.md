# Pre-Merge Guard Report

| Field | Value |
|-------|-------|
| **Branch** | `feat/accounting-expense-fixes` |
| **Author** | Akenarin Kongdach |
| **Date** | 2026-05-09 17:11 +0700 |
| **Reviewed** | 2026-05-09 |
| **Recommendation** | 🔶 REVIEW |

## File Changes Summary

165 files changed · 36,439 insertions · 1,416 deletions

This is a large multi-feature branch containing three distinct workstreams:
1. **Asset Module Phase 1–3** — PPE register, acquisition JEs, disposal, transfers
2. **Depreciation Module** — monthly runs, preview, reversal
3. **Expense lifecycle fixes** — WHT, atomicity, VOID reverse, AP clearance (same as `fix/2a-cron-auto-consume-advance`)

Key path groups:
- `apps/api/src/modules/asset/` — new controllers, services, DTOs
- `apps/api/src/modules/depreciation/` — new module
- `apps/api/src/modules/journal/cpa-templates/` — asset-purchase, disposal, depreciation templates + expense templates
- `apps/api/prisma/schema.prisma` — `FixedAsset`, `DepreciationEntry`, `AssetTransferHistory` models (+177 lines)
- `apps/web/src/pages/assets/`, `apps/web/src/pages/depreciation/` — 15 new pages
- `apps/web/e2e/` — 10 new E2E specs

## Issues

### Critical — Must Fix Before Merge

None found.

### Warning — Should Fix

| # | File | Issue |
|---|------|-------|
| W-1 | `apps/api/src/modules/receipts/receipts.service.ts` | `Number(receipt.amount)` inside `auditLog.create` `oldValue` field. Forensic/logging context only — not stored back as a financial value — but violates the no-`Number()`-on-Decimal convention. Replace with `receipt.amount.toString()`. |
| W-2 | `apps/api/src/modules/accounting/bad-debt.service.ts` | Multiple `.toNumber()` calls (provision amounts, report summaries). These appear in report-output objects returned to callers, not in DB writes. Lower risk than financial calculations, but worth using `.toFixed(2)` / string form for consistency. |
| W-3 | Surface area | 36K lines across 165 files is a very large single merge. The 3 workstreams are logically independent — consider splitting into separate PRs (`feat/asset-module`, `feat/depreciation`, `fix/expense-lifecycle`) for safer rollout and easier bisect if a regression appears in production. |

### Info

- **All new controllers guarded**: `AssetJournalController`, `AssetReportsController`, `AssetTransferController`, `DepreciationController` all have `@UseGuards(JwtAuthGuard, RolesGuard)` at class level and `@Roles()` on every method. No unguarded endpoints found. ✓
- **`DepreciationEntry` no `deletedAt`**: Intentional — model is append-only (uses `reversedAt` for reversal tracking, no soft-delete column). Queries without `{ deletedAt: null }` are correct for this model. ✓
- **`fixedAsset.findMany`**: All list queries initialize `where` as `{ deletedAt: null }` before adding filters — soft-delete filter is consistently applied. ✓
- **No raw `fetch()`** in new React pages — all API calls use `api.get()`/`api.post()` from `@/lib/api`. ✓
- **`invalidateQueries` ratio**: 42 calls vs 19 mutations — healthy coverage. ✓
- **No SQL injection**: No unparameterized `$queryRaw` found. ✓
- **No hardcoded secrets** found. ✓
- **Prisma migration**: `20260808100000_asset_phase1` adds NOT NULL columns on new tables only — no risk of migrate-deploy failure on existing populated tables. ✓
- **Depreciation math**: CPA-aligned (straight-line, monthly, `ROUND_HALF_UP`). Test fixtures cover full-life, mid-period, and reversal scenarios. Spot-checking only — recommend human CPA review of the depreciation template before production use.
- **`wipe-assets.cli.ts`**: New wipe script has no 3-env-var guard equivalent to `wipe-accounting.cli.ts`. Low urgency (separate from accounting wipe) but consider adding `CONFIRM_WIPE` + `EXPECTED_DB_NAME` guards for parity.

## Verification Checklist

- [x] No missing `@UseGuards` on new controller endpoints
- [ ] `Number()` on `receipt.amount` in audit log (W-1) — fix before merge
- [ ] `.toNumber()` in bad-debt report (W-2) — fix before merge
- [x] `DepreciationEntry` queries without `deletedAt: null` — intentional (no field on model)
- [x] `fixedAsset.findMany` soft-delete filter applied via `where` object
- [x] No hardcoded secrets
- [x] No unparameterized `$queryRaw`
- [x] No raw `fetch()` in frontend
- [ ] Consider splitting into 3 separate PRs (W-3) — optional but recommended
