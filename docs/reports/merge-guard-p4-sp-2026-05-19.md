# Pre-Merge Guard Report — 2026-05-19

**Reviewed by**: Pre-Merge Guard Agent  
**Date**: 2026-05-19  
**Branches reviewed**: 3 (most-recently-pushed today)

---

## Branch 1: `feat/p4-sp1-financial-reports`

**Author**: Akenarin Kongdach  
**Pushed**: 2026-05-19  
**Summary**: Adds 3 new reporting endpoints to `AccountingController` (aging, bad debt, general journal) and 4 new frontend pages (`AgingReportPage`, `BadDebtReportPage`, `BalanceSheetPage`, `GeneralJournalPage`) + a test suite.

### File Changes (11 files, +1515 / -51)
| File | Change |
|---|---|
| `apps/api/src/modules/accounting/accounting.controller.ts` | +36 (3 new endpoints) |
| `apps/api/src/modules/accounting/accounting.service.ts` | +179 (getAgingReport, getBadDebtReport, getGeneralJournal) |
| `apps/api/src/modules/accounting/accounting.service.spec.ts` | +254 (tests) |
| `apps/web/src/pages/finance/AgingReportPage.tsx` | +232 (new page) |
| `apps/web/src/pages/finance/BadDebtReportPage.tsx` | +223 (new page) |
| `apps/web/src/pages/finance/BalanceSheetPage.tsx` | +205 (new page) |
| `apps/web/src/pages/finance/GeneralJournalPage.tsx` | +259 (new page) |
| `apps/web/src/App.tsx` | routing changes |
| `apps/web/package.json` | minor |

---

### Issues Found

#### Warning

**W1 — `Number()` used in financial aggregation (service layer)**  
Files: `accounting.service.ts`  
The `getAgingReport` and `getBadDebtReport` service methods aggregate Decimal financial values using JavaScript floating-point arithmetic:

```typescript
// getAgingReport (line ~428 in diff)
const remaining = Number(p.amountDue) - Number(p.amountPaid ?? 0);
summary[bucket] += remaining;  // floating-point accumulation

// getBadDebtReport (line ~496 in diff)
const total = lines.reduce((sum, l) => sum + Number(l.debit ?? 0), 0);
```

This pattern was fixed 53 times in v4 hardening (`Decimal precision` sprint). Re-introducing it on reporting endpoints risks rounding drift on large amounts (e.g., 100 instalments × 15,833.33 THB compounds error). Should use `Prisma.Decimal` addition:
```typescript
import Prisma from '@prisma/client';
let total = new Prisma.Decimal(0);
for (const l of lines) total = total.plus(l.debit ?? 0);
```

**W2 — Missing date range cap on `getBadDebtReport` and `getGeneralJournal`**  
Files: `accounting.controller.ts`  
Both endpoints accept arbitrary `start`/`end` query strings with no cap on the range. The PEAK export endpoint (same pattern) has a 186-day cap (`BadRequestException`). Without a cap, a query for `2020-01-01` to `2026-05-19` could return tens of thousands of JournalLines and cause OOM/timeout. Recommend a max 366-day cap.

**W3 — No input validation for `start`/`end` date query params**  
Files: `accounting.controller.ts`  
`new Date(start)` is called directly without checking if `start` is a valid ISO string. `new Date("")` returns `Invalid Date`; Prisma will throw an opaque error rather than a clean 400. Should use a DTO with `@IsDateString()` or a guard:
```typescript
if (!start || isNaN(new Date(start).getTime())) throw new BadRequestException('start ไม่ใช่วันที่ที่ถูกต้อง');
```

#### Info

**I1 — `Number()` in JSX display is acceptable**  
`BalanceSheetPage.tsx` uses `Number(bs.assets.total)` only for rendering text — not for storage or accumulation. This pattern is intentional (Decimal serializes as string over JSON, `Number()` converts for display). No action needed.

---

### Recommendation: **REVIEW**

No security blocks. Two Warning-level patterns that mirror issues fixed in v4 hardening and one input-validation gap. Safe to merge after addressing W1 (Decimal precision in service) and W3 (date validation). W2 (range cap) is advisable but not blocking.

---

## Branch 2: `feat/p4-sp2-tax-ui`

**Author**: Akenarin Kongdach  
**Pushed**: 2026-05-19  
**Summary**: New `FinanceTaxModule` (controller + service) providing VAT monthly, WHT monthly, and VAT auto-journal history endpoints. Four new frontend pages (`VatPage`, `WhtPage`, `ETaxPage`, `VatAutoJournalPage`).

### File Changes (14 files, +1711 / -52)
| File | Change |
|---|---|
| `apps/api/src/modules/finance-tax/finance-tax.controller.ts` | +65 (new controller) |
| `apps/api/src/modules/finance-tax/finance-tax.service.ts` | +~400 (3 service methods) |
| `apps/api/src/modules/finance-tax/finance-tax.module.ts` | +module scaffold |
| `apps/api/src/modules/finance-tax/dto/finance-tax.dto.ts` | +36 (DTOs with validation) |
| `apps/api/src/app.module.ts` | +2 (FinanceTaxModule imported) |
| `apps/web/src/pages/finance/VatPage.tsx` | +220 |
| `apps/web/src/pages/finance/WhtPage.tsx` | +182 |
| `apps/web/src/pages/finance/ETaxPage.tsx` | +264 |
| `apps/web/src/pages/finance/VatAutoJournalPage.tsx` | +186 |

---

### Issues Found

#### Warning

**W1 — `Number()` in financial aggregation (service layer)**  
File: `finance-tax.service.ts`  
`getVatMonthly` accumulates VAT totals using floating-point arithmetic:
```typescript
let vatOutput = 0;
// for each line:
const debit = Number(l.debit ?? 0);
const credit = Number(l.credit ?? 0);
vatOutput += credit - debit;  // floating-point accumulation
// ...
netVat: Math.round(netVat * 100) / 100,  // masks the precision loss
```
`Math.round(x * 100) / 100` does not reliably recover the correct value — it rounds to 2 decimal places but the intermediate `vatOutput` may already have drifted. Same issue in `getWhtMonthly`. These are reporting-only endpoints (read, no DB write), so the blast radius is display inaccuracy rather than data corruption, but it could cause `ภ.พ.30` filing discrepancies. Should use `Prisma.Decimal`.

#### Info

**I1 — UI stubs (`toast.info('Excel export — coming soon')`) are acceptable**  
`ETaxPage.tsx` has 2 `onClick` handlers that show a "coming soon" toast. This is a valid placeholder UI pattern. No action needed.

**I2 — `parseInt(year, 10)` without range validation is mitigated by DTO**  
The DTOs use `@Min(2020) / @Max(12)` validators with `class-validator`, so invalid years/months are rejected before reaching the service. ✓

---

### Recommendation: **REVIEW**

No security issues. Guards, roles, and DTO validation are all properly in place. One Warning regarding Decimal precision in the aggregation service — `Math.round` masking is not a substitute for `Prisma.Decimal` arithmetic. Recommend converting before merge to avoid ภ.พ.30 filing discrepancies.

---

## Branch 3: `feat/p4-sp5-dashboard-widgets`

**Author**: Akenarin Kongdach  
**Pushed**: 2026-05-19  
**Summary**: Adds 3 dashboard widgets (AgingSummaryWidget, PromiseDueTodayWidget, ContractMilestonesWidget) to the Finance zone dashboard. Backend adds `GET /contracts/milestones-summary` and `GET /overdue/promises/due-today`.

### File Changes (9 files, +515 / -1)
| File | Change |
|---|---|
| `apps/api/src/modules/contracts/contracts.controller.ts` | +7 (milestones-summary endpoint) |
| `apps/api/src/modules/contracts/contracts.service.ts` | +131 (getMilestonesSummary) |
| `apps/api/src/modules/overdue/overdue.controller.ts` | +11 (promises/due-today endpoint) |
| `apps/api/src/modules/overdue/promise.service.ts` | +58 (getPromisesDueToday) |
| `apps/web/src/pages/DashboardPage/index.tsx` | +15 (widget grid) |
| `apps/web/src/pages/DashboardPage/widgets/AgingSummaryWidget.tsx` | +85 (new) |
| `apps/web/src/pages/DashboardPage/widgets/PromiseDueTodayWidget.tsx` | +89 (new) |
| `apps/web/src/pages/DashboardPage/widgets/ContractMilestonesWidget.tsx` | +129 (new) |

---

### Issues Found

#### Warning

**W1 — `Number()` used in financial aggregation (service layer)**  
File: `contracts.service.ts` — `getMilestonesSummary`  
```typescript
// Line ~1078 in diff
const newThisMonthSum = newContracts.reduce(
  (acc, c) => acc + Number(c.financedAmount),
  0,
);
// Line ~1150 in diff
const completingThisMonthSum = finalInstallmentsThisMonth.reduce(
  (acc, p) => acc + p.amountDue,  // p.amountDue already converted from Decimal via Number()
  0,
);
```
Both totals (`newThisMonthSum`, `completingThisMonthSum`) are displayed as dashboard KPI figures. Floating-point accumulation over many contracts can drift. Should use `Prisma.Decimal`.

#### Info

**I1 — BKK timezone offset computed via manual UTC arithmetic**  
File: `promise.service.ts` — `getPromisesDueToday`  
```typescript
const bkkOffsetMs = 7 * 60 * 60 * 1000;
```
Thailand (Asia/Bangkok) does not observe DST, so the fixed +7 offset is stable. However, the project already uses `date-fns-tz` in other services — using `zonedTimeToUtc` / `startOfDay(bkkNow, { timeZone: 'Asia/Bangkok' })` would be more idiomatic and self-documenting. Not a bug.

**I2 — Promise widget shows `phone` field directly (PII)**  
`PromiseDueTodayWidget.tsx` displays `item.phone` in the list. The backend returns `phone: slot.callLog.contract.customer.phone ?? ''`. This is intentional (collections agent needs the number), and only visible to OWNER/FINANCE_MANAGER/ACCOUNTANT/BRANCH_MANAGER roles. Acceptable.

**I3 — `completingThisMonthSum` returned but never displayed in `ContractMilestonesWidget`**  
The widget displays `data.completingThisMonth.count` but not `totalAmount`. Minor unused data — not harmful, just slightly wasteful transport.

---

### Recommendation: **REVIEW**

No security issues. Guards and roles on both new endpoints are correct. One Warning for Decimal precision in the summary aggregation (same pattern as the other two branches today). Safe to merge after W1 fix.

---

## Cross-Branch Pattern: Recurring Decimal Precision Issue

All 3 branches today introduce the same `Number()` aggregation pattern that v4 hardening fixed 53 times. The pattern appears consistently in new service methods adding KPI/reporting aggregations. Recommend adding an ESLint rule or a note to `workflows/create-api-module.md`:

> **Rule**: Never aggregate Decimal financial fields via `Number() + Number()`. Use `Prisma.Decimal`:
> ```typescript
> import { Prisma } from '@prisma/client';
> let total = new Prisma.Decimal(0);
> for (const row of rows) total = total.plus(row.amountDue ?? 0);
> ```

---

## Summary Table

| Branch | Critical | Warning | Info | Recommendation |
|---|---|---|---|---|
| `feat/p4-sp1-financial-reports` | 0 | 3 | 1 | **REVIEW** |
| `feat/p4-sp2-tax-ui` | 0 | 1 | 2 | **REVIEW** |
| `feat/p4-sp5-dashboard-widgets` | 0 | 1 | 3 | **REVIEW** |

**All branches**: No security blocks (guards/roles/CSRF all intact, no hardcoded secrets, no raw fetch(), no SQL injection). Issues are precision/validation quality concerns that should be addressed before merge.
