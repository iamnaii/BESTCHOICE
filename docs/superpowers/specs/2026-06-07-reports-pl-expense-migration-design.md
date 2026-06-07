# /reports P&L — expense migration (journal-sourced, FINANCE company-wide)

**Date:** 2026-06-07
**Status:** approved (brainstorm + /scrutinize rework) → ready for implementation plan
**Scope:** `apps/api` `AccountingService.getProfitLossReport` + `getMonthlyPLSummary`. Backend only — **no frontend changes**.

## Problem

`/reports` P&L (`/profit-loss` page) has its expense line stubbed to `[]`:

```ts
// Legacy `expense` model removed — expense aggregation deferred to ExpenseDocument
// module integration in a follow-up PR. Returns empty list so downstream maps stay zero.
Promise.resolve([] as { category: string; totalAmount: Prisma.Decimal }[]),
```

So `/reports` (and the **monthly-close snapshot** which calls it — `monthly-close.service.ts:611` stores `snapshot.profitLoss = getProfitLossReport(...)`) **overstate profit**: revenue with no expenses. The "follow-up PR" was never done because the report was built for a **removed `expense` model**.

## /scrutinize findings that shaped this design

The first design (source from journal 51-54 for *all* views) was **reworked** after tracing the real usage:

- **The page is used per-branch + per-company.** `ProfitLossPage.tsx:113-114` sends `branchId` + `companyId`; the page is in the BRANCH_MANAGER menu.
- **The journal is NOT branch-attributable.** `JournalEntry` has `companyId` but **no `branchId`** — so journal-sourced expenses cannot be split per branch.
- **`ExpenseLine.category` is free-text** (`category!: string`, no enum) and does NOT match the report's keys (`ADMIN_SALARY`…, which exist only in `accounting.service.ts`). `ExpenseLine` also has no GL account code. So ExpenseLine cannot drive the report's category breakdown either.
- **Owner constraints:** SHOP-side accounting is **not built yet**; FINANCE is the central entity with **no branches** (all branches are under SHOP).

**Conclusion:** a correct *per-branch* expense breakdown isn't possible today (its source = SHOP, which has no accounting yet). But the **FINANCE company-wide** P&L *can* be fixed now and is meaningful. So:

## Goal

Make the **company-wide** `/reports` P&L show real FINANCE expenses (journal `51-54`) so the whole-business P&L + monthly-close snapshot stop overstating profit. **Per-branch views are explicitly left unchanged** (deferred until SHOP accounting exists).

## REWORK (2026-06-07, after PR-review + /scrutinize)

Independent review of the first implementation found the `companyWide = !branchId` guard wrong: the real controller path sends a single-branch filter as `branchIds=[oneBranch]` (branchId undefined), so an isolated branch got full company-wide FINANCE expenses; and `getProfitLossReport` never receives `companyId`, so a `companyId=SHOP` filter ALSO leaked FINANCE expenses, and a SHOP monthly-close snapshot embedded FINANCE 51-54 expenses. /scrutinize confirmed: inferring "company-wide" *inside* the method is fragile and blind to company. **Fix: the caller (which knows role + branchId + companyId) computes an explicit `includeFinanceExpenses` boolean and passes it in.** Owner steer: make the FINANCE side correct now; SHOP P&L expenses are separate future work (FINANCE and SHOP must stay separated).

## Design

### Include-expenses gate (explicit, caller-computed)

`getProfitLossReport` / `getMonthlyPLSummary` take an explicit `includeFinanceExpenses: boolean` (replacing the internal `companyWide = !branchId`). FINANCE 51-54 central expenses are added only when the flag is true; otherwise expenses stay `[]`.

Each caller computes it from full context via `reports.service.shouldIncludeFinanceExpenses(role, branchId, companyId)`:

```
BRANCH_MANAGER            → false   (restricted to one branch)
branchId present          → false   (a single branch is isolated — per-branch expenses await SHOP/branch accounting)
companyId === SHOP        → false   (SHOP view — FINANCE central expenses don't belong; SHOP P&L is separate future work)
companyId === FINANCE     → true
no branch + no company    → true    (whole-business view)
```

`monthly-close` computes it directly from the closing company: FINANCE close → true, SHOP close → false (fixes the SHOP-snapshot contamination).

Rationale: FINANCE 51-54 are central whole-business expenses; they belong only in a FINANCE or whole-business P&L, never grafted onto an isolated branch or a SHOP-company view.

### Expense source (company-wide only)

`journalLine.groupBy(accountCode)` for FINANCE expense accounts in the period:

```
where: { journalEntry: { entryDate: { gte, lte }, companyId: <FINANCE>, deletedAt: null },
         accountCode: startsWith '5' }   // 51/52/53/54
_sum: { debit, credit }
```

Per account, **net expense = Σdebit − Σcredit** (VAT → 11-4101, WHT → 21-31xx are not 5x accounts, so the journal already nets them out). Mirrors `getProfitLossFromJournal`. We use the **journal (GL codes)**, not ExpenseLine, precisely because the GL code is mappable to the report categories whereas `ExpenseLine.category` is unconstrained free text.

### Totals from SECTION sums (robust to map gaps)

| Report total | Source |
|---|---|
| `totalSelling` | Σ all `52-xxxx` |
| `totalAdmin` | Σ all `53-xxxx` |
| `totalOther` | Σ all `51-xxxx` + `54-xxxx` |
| `totalCOGS` | unchanged (`productCosts`; FINANCE has no `50` COGS) |

`totalExpenses` / `netProfit` are correct regardless of the granular map. Granular sub-lines are **best-effort display**.

### Curated GL→category map (display; accountant-reviewable)

One `static readonly EXPENSE_ACCOUNT_CATEGORY: Record<string, ReportCategory>` in `AccountingService`. Initial mapping (accountant confirms rollups):

| Report category | Accounts |
|---|---|
| `SELL_COMMISSION` | 52-1101 |
| `SELL_ADVERTISING` | 52-1102, 52-1103 |
| `ADMIN_SALARY` | 53-1101, 53-1103, 53-1104, 53-1105, 53-1106 |
| `ADMIN_SOCIAL_SECURITY` | 53-1102 |
| `ADMIN_OFFICE_SUPPLIES` | 53-1201, 53-1202, 53-1203 |
| `ADMIN_UTILITIES` | 53-1301, 53-1302 |
| `ADMIN_TELEPHONE` | 53-1303 |
| `ADMIN_TRAVEL` | 53-1304 |
| `ADMIN_MAINTENANCE` | 53-1305, 53-1306 |
| `ADMIN_TAX_FEE` | 53-1401, 53-1402, 53-1403, 53-1404, 53-1501, 53-1502, 53-1701, 53-1702 |
| `ADMIN_DEPRECIATION` | 53-1601, 53-1602, 53-1603, 53-1604 |
| `OTHER_LOSS` | 51-1102, 51-1103, 53-1605 |
| `OTHER_FINE` | 51-1104, 54-1103, 54-1104 |
| `OTHER_MISC` | 51-1101, 51-1105, 53-1503, 54-1101, 54-1102 |

Unmapped accounts still count in their section total (totals stay correct), just no granular line. `SELL_TRANSPORT`/`SELL_PACKAGING`/`ADMIN_RENT`/`ADMIN_INSURANCE`/`OTHER_INTEREST` = 0 (no matching account in the current chart).

### Decisions

1. **Branch guard** — expenses only on company-wide views; per-branch deferred. *(Resolves the /scrutinize per-branch blocker.)*
2. **FINANCE-only** — SHOP `S5x` expenses out of scope (SHOP accounting not built).
3. **Mixed basis** — revenue cash-basis, expense accrual. Annotate the response (`expenseBasis: 'accrual-journal'`) and surface a note; the strict accrual P&L stays on `/accounting`.

### Affected callers (auto-benefit, company-wide)

- `/reports/profit-loss` company-wide view.
- `getMonthlyPLSummary` (dashboard MoM/YoY) — same stub, same fix + same branch guard.
- `monthly-close.service` snapshot — calls `getProfitLossReport(..., branchIds)`; if the snapshot is company-wide its profit becomes correct.

## Testing

Golden unit test (mock `journalLine.groupBy`):
- **Company-wide (no branch):** seed expense lines across sections → assert `totalSelling`/`totalAdmin`/`totalOther` = section sums; granular rollups for `SELL_COMMISSION`/`ADMIN_SALARY`/`ADMIN_SOCIAL_SECURITY`/`ADMIN_DEPRECIATION`/`OTHER_LOSS`/`OTHER_FINE`; `netProfit = revenue − totalExpenses`.
- **Per-branch (branchId set):** expenses stay `0`/`[]` (deferred); journal is NOT queried for expenses.
- Net uses `debit − credit` (a reversal reduces the expense). Unmapped account → counted in section total only.

## Out of scope (explicit follow-ups)

- **Per-branch expense breakdown** — needs SHOP accounting (branch-attributable `S5x` / ExpenseDocument.branchId source). Deferred.
- `getBalanceSheet` / `getCashFlowStatement` accrued-liability stubs.
- Unifying cash vs accrual basis / retiring `/reports` P&L (owner chose option A).
- Refund reversal-JE (#5).
- Frontend changes (none).

## Risk

Low. Backend-only, shape-preserving, company-wide-gated, totals section-summed (robust). Changes reported profit on the **company-wide** `/reports` P&L + snapshot (intended — was overstated). **Flag to accountant before merge; do NOT auto-deploy without sign-off on the numbers shift.** The granular map is the only accountant-judgment artifact and is non-load-bearing for totals.
