# Pre-Merge Guard Report — 2026-05-23

**Reviewed by**: Pre-Merge Guard Agent  
**Date**: 2026-05-23  
**Branches reviewed**: 3 (most recently active non-guard/watchdog branches)

---

## Branch 1: `feat/defect-exchange-wizard-flow`

**Author**: Akenarin Kongdach  
**Last commit**: `fix(defect-exchange): products limit 300 → 200 (PaginationDto.@Max(200))`  
**Commits on branch**: 3

### File Changes Summary

| File | +Lines | -Lines | Notes |
|------|--------|--------|-------|
| `apps/web/src/pages/DefectExchangePage.tsx` | +237 | -149 | Major 3-step wizard refactor |
| `apps/api/src/cli/seed-sp1-used-exchange.sql` | +73 | — | New dev seed data |
| `apps/web/package.json` | +1 | -1 | Version bump |

### Issues

#### Critical
_None found._

#### Warning

**W1 — Seed SQL uses hardcoded IDs not guaranteed in all environments**  
File: `apps/api/src/cli/seed-sp1-used-exchange.sql`  
The seed references `sup-001`, `branch-002`, `user-004` as FK values (supplierId, branchId, salespersonId). On a fresh `db-reset` or a CI environment that seeded with different UUIDs, the `INSERT` will fail with FK violations — silently breaking the test setup the file is meant to provide.  
**Fix**: Either (a) use `SELECT id FROM suppliers/branches/users WHERE ... LIMIT 1` to resolve IDs at runtime, or (b) add the FK records in the seed file itself.

#### Info

**I1 — `bypassWindow` role-gate is correctly implemented**  
`const bypassWindow = bypassWindowRaw && canExecute` (line 89) — a SALES user adding `?bypassWindow=true` to the URL is silently downgraded to `false` because `canExecute` is `false` for SALES. URL-param bypass is not exploitable. ✓

**I2 — DefectExchangePage approaching 500-line limit**  
File is 459 lines post-refactor. No action required now; watch for future additions.

**I3 — Products limit reduction (300 → 200)**  
Consistent with `PaginationDto.@Max(200)` constraint. Correct fix.

### Recommendation: **APPROVE** (1 Warning on dev-only seed file; no blocking issues)

---

## Branch 2: `hotfix/insurance-wizard-sp1-followups`

**Author**: Akenarin Kongdach  
**Last commit**: `hotfix(insurance): 5 Critical + 2 Warning from SP1 review`  
**Commits on branch**: 1

### File Changes Summary

| File | +Lines | -Lines | Notes |
|------|--------|--------|-------|
| `apps/web/src/pages/insurance/CreateInsuranceWizardPage.tsx` | +65 | -40 | intent=exchange redirect, W1 CASH-sale fix |
| `apps/api/src/modules/repair-tickets/__tests__/lookup-by-imei.spec.ts` | +122 | -61 | Expanded PDPA + warranty tests |
| `apps/web/src/pages/insurance/CreateInsuranceWizardPage.test.tsx` | — | -165 | **Entire test file deleted** |
| `apps/web/e2e/insurance-imei-wizard.spec.ts` | +18 | -15 | E2E IMEI fetch improved |
| `apps/web/src/pages/insurance/WizardSteps/ImeiLookupStep.tsx` | +7 | -1 | CASH-sale navigation fix |
| `apps/api/src/modules/repair-tickets/repair-tickets.controller.ts` | +2 | -2 | Pass req.user to lookupByImei |
| `apps/api/src/modules/repair-tickets/repair-tickets.service.ts` | +28 | -35 | PDPA branch scoping + BKK timezone fix |

### Issues

#### Critical
_None found._

#### Warning

**W1 — 165-line UI unit test file deleted without equivalent replacement**  
File: `apps/web/src/pages/insurance/CreateInsuranceWizardPage.test.tsx` (deleted)  
The deleted file covered: step-routing (step 1→2→3 navigation), progress indicator changes based on `intent`, `bypassWindow` step-skip for OWNER/BRANCH_MANAGER, and `?customerId` pre-fill skipping step 1. The new `lookup-by-imei.spec.ts` tests are valuable but cover the API service — they do not replace the wizard routing unit tests.  
**Impact**: If the wizard step logic regresses (e.g., wrong initial step, wrong progress count), no unit test will catch it.  
**Fix**: Either restore equivalent wizard navigation tests in a new file, or explicitly document the decision to rely on E2E coverage only.

#### Info

**I1 — PDPA branch scoping on IMEI lookup is correct and well-tested**  
`hasCrossBranchAccess(user) ? {} : { branchId: user.branchId }` pattern mirrors `warrantyLookup`'s existing branch scope. New spec covers the cross-branch SALES case and verifies the `branchId` filter presence in the Prisma call. ✓

**I2 — BKK calendar-day arithmetic replaces raw millisecond calculation**  
`computeDaysRemainingIn7Day` now uses BKK midnight normalization (consistent with `detect-warranty-status.ts`). Correct and removes the edge case where a device received at 23:00 BKK would lose a day due to UTC midnight rollover. ✓

**I3 — `intent=exchange` redirect guards the auto-lookup `useEffect`**  
`if (intent === 'exchange') return;` prevents the auto-lookup firing before the redirect completes. Dependency array `[presetContractId, presetProductId, intent]` is complete. ✓

**I4 — E2E test improved to use API rather than absent DOM attribute**  
The old test `page.locator('[data-imei]')` would always silently skip (no `data-imei` attribute exists). The fix fetches `/api/contracts?limit=1` via Playwright `request`. ✓

### Recommendation: **REVIEW** — W1 (test coverage regression) requires explicit sign-off before merge

---

## Branch 3: `fix/menu-dedup-and-restructure`

**Author**: Akenarin Kongdach  
**Last commits**: `fix(menu): dedupe & restructure OWNER+ACC sidebars` + `fix(menu): merge OWNER ติดตามหนี้ section into รายรับ`  
**Commits on branch**: 2

### File Changes Summary

| File | +Lines | -Lines | Notes |
|------|--------|--------|-------|
| `apps/web/src/config/menu.ts` | +26 | -84 | Large dedup/restructure |
| `apps/web/src/config/menu.test.ts` | +1 | -1 | Test updated for removed section |
| `apps/web/package.json` | +1 | -1 | Version bump |

### Issues

#### Critical
_None found._

#### Warning

**W1 — Significant ACCOUNTANT menu removals need business confirmation**  
The following items are removed from `ACCOUNTANT_CONFIG`:

| Removed Path | Label | Context |
|---|---|---|
| `/profit-loss` | กำไร-ขาดทุน | Core P&L report |
| `/finance/cash-flow` | งบกระแสเงินสด | P4 SP1 |
| `/finance/equity-statement` | งบ Equity | P4 SP1 |
| `/finance/general-ledger` | สมุดแยกประเภท | P4 SP1 |
| `/finance/vat` | ภ.พ.30 (VAT) | P4 SP2 |
| `/finance/wht` | ภ.ง.ด. 1/3/53 (WHT) | P4 SP2 |
| `/finance/e-tax` | e-Tax Invoice | P4 SP2 |
| `/finance/vat-auto-journal` | VAT Auto Journal | P4 SP2 |
| `/finance/bank-accounts` | บัญชีเงินสด/ธนาคาร | SP6 placeholder |

If these routes have real page implementations (P4 SP1/SP2 features), removing them from the ACCOUNTANT sidebar is a navigation regression — ACCOUNTANTs would need to type URLs directly. If they are unbuilt placeholders, removal is correct.  
**Fix**: Confirm with owner: (a) which of the P4 SP1/SP2 items are currently live pages vs. stubs, and (b) whether ACCOUNTANT intentionally loses access to them via the sidebar.

#### Info

**I1 — OWNER `owner-fin-collection` deduplication is clean**  
The standalone "ติดตามหนี้" section is removed; its 3 items (`/overdue`, `/repossessions`, `/mdm`) are merged into `owner-fin-revenue`. No duplicate links remain. `assetMenuSection` is properly extracted as a named const (line 124) and referenced in 3 places. ✓

**I2 — Insurance menu flattened correctly (3 roles)**  
`รับซ่อม/รับประกัน` and `เช็คประกัน` are now sibling flat items instead of nested children for SALES, BRANCH_MANAGER, and OWNER. Avoids the collapsed sub-menu UX friction. ✓

**I3 — Test correctly updated**  
`menu.test.ts` removes the `owner-fin-collection` assertion and adds a comment explaining the merge. ✓

**I4 — `owner-period-close` section addition is clean**  
New dedicated period-close section (`ปิดบัญชีรายเดือน`, `ปิดบัญชีสิ้นปี`, `งวดบัญชี`) replaces the nested children approach. Year-end closing (`/finance/year-end-closing`) is now discoverable in the OWNER FIN menu. ✓

### Recommendation: **REVIEW** — W1 requires explicit business confirmation on which removed ACC items are live pages

---

## Summary Table

| Branch | Critical | Warning | Info | Recommendation |
|--------|----------|---------|------|----------------|
| `feat/defect-exchange-wizard-flow` | 0 | 1 | 3 | **APPROVE** |
| `hotfix/insurance-wizard-sp1-followups` | 0 | 1 | 4 | **REVIEW** |
| `fix/menu-dedup-and-restructure` | 0 | 1 | 4 | **REVIEW** |

### Global Notes
- No missing `@UseGuards` issues found on any new controller methods
- No `Number()` on money fields in any of the 3 branches
- No hardcoded secrets detected
- No missing `deletedAt: null` in new queries
- No raw `fetch()` in new React components
- No SQL injection risks in new code
