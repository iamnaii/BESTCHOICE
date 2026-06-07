# /reports P&L — expense migration to journal-sourced (design)

**Date:** 2026-06-07
**Status:** approved (brainstorm) → ready for implementation plan
**Scope:** `apps/api` `AccountingService.getProfitLossReport` + `getMonthlyPLSummary` (the `/reports` P&L family). Backend only — **no frontend changes**.

## Problem

`/reports` shows a **cash-basis** P&L (`getProfitLossReport`) whose expense line is stubbed to `[]`:

```ts
// Legacy `expense` model removed — expense aggregation deferred to ExpenseDocument
// module integration in a follow-up PR. Returns empty list so downstream maps stay zero.
Promise.resolve([] as { category: string; totalAmount: Prisma.Decimal }[]),
```

So `/reports` (and the **monthly-close snapshot**, which calls this method) **overstate profit** — revenue with no expenses. The "follow-up PR" was never done because the report was built for a **removed `expense` model** with ~20 granular categories, and the new world is `ExpenseDocument → journal (account codes)`.

The **correct accrual P&L already exists** (`getProfitLossFromJournal`, `/accounting`). Per owner decision, `/reports` stays a **distinct management view** (option A) but must source real expenses from the journal we already have — not a new aggregation.

## Goal

Populate the `/reports` P&L expense line from the **FINANCE journal expense accounts (51–54)** for the period, **preserving the exact return shape** (frontend untouched), so `/reports` and the monthly-close snapshot stop overstating profit.

## Design

### Expense source (replaces the `[]` stub)

Aggregate `journalLine` for FINANCE expense accounts in the period:

```
journalLine.groupBy({ by: ['accountCode'], where: {
  journalEntry: { entryDate: { gte: start, lte: end }, companyId: <FINANCE>, deletedAt: null },
  accountCode: startsWith 5,           // 51/52/53/54
}, _sum: { debit: true, credit: true } })
```

Per account, **net expense = Σdebit − Σcredit** (VAT → 11-4101, WHT → 21-31xx are *not* 5x accounts, so the journal already gives the net expense — no extra VAT handling needed). This mirrors `getProfitLossFromJournal`'s proven expense logic.

### Totals come from SECTION sums (decision 1-ii)

`totalSelling` / `totalAdmin` / `totalOther` are computed directly from the **2-digit section sums**, NOT from summing the granular sub-lines:

| Report total | Journal section |
|---|---|
| `totalSelling` | Σ all `52-xxxx` |
| `totalAdmin` | Σ all `53-xxxx` |
| `totalOther` | Σ all `51-xxxx` + `54-xxxx` |
| `totalCOGS` | unchanged — keeps `productCosts` (sale `costPrice`); FINANCE has no `50` COGS |

This guarantees `totalExpenses` / `netProfit` are **correct regardless of granular mapping gaps**. The granular sub-lines (below) are **best-effort display** — if they don't sum to the section total, the residual is an implicit "unclassified within section" and totals are still right.

### Curated granular map (display; accountant-reviewable)

`accountCode → report category` for the sub-line breakdown. Initial mapping (accountant should confirm rollups):

| Report category | Accounts |
|---|---|
| `SELL_COMMISSION` | 52-1101 |
| `SELL_ADVERTISING` | 52-1102, 52-1103 (SMS) |
| `SELL_TRANSPORT` | — (none yet; 53-1304 postage is admin) |
| `SELL_PACKAGING` | — |
| `ADMIN_SALARY` | 53-1101, 53-1103 (OT), 53-1104 (bonus), 53-1105 (training), 53-1106 (welfare) |
| `ADMIN_SOCIAL_SECURITY` | 53-1102 |
| `ADMIN_OFFICE_SUPPLIES` | 53-1201, 53-1202, 53-1203 |
| `ADMIN_UTILITIES` | 53-1301 (water), 53-1302 (electricity) |
| `ADMIN_TELEPHONE` | 53-1303 |
| `ADMIN_TRAVEL` | 53-1304 (postage/transport) |
| `ADMIN_MAINTENANCE` | 53-1305, 53-1306 |
| `ADMIN_TAX_FEE` | 53-1501 (bank fee), 53-1502 (govt fee), 53-1401/1402/1403/1404 (professional fees), 53-1701/1702 (debt-collection/lawyer) |
| `ADMIN_DEPRECIATION` | 53-1601, 53-1602, 53-1603, 53-1604 |
| `ADMIN_RENT` | — (no rent account in current chart) |
| `ADMIN_INSURANCE` | — (none) |
| `OTHER_LOSS` | 51-1102, 51-1103, 53-1605 (asset-disposal loss) |
| `OTHER_FINE` | 51-1104, 54-1103, 54-1104 |
| `OTHER_INTEREST` | — (FINANCE earns interest; no interest expense) |
| `OTHER_MISC` | 51-1101, 51-1105, 53-1503 (rounding), 54-1101, 54-1102 |

The map lives as a single `static readonly EXPENSE_ACCOUNT_CATEGORY: Record<string, ReportCategory>` in `AccountingService` (one artifact; accountant reviews once). Accounts not in the map still count toward their **section total** (so totals stay correct) but don't show a granular line.

### Decisions (flagged, approved)

1. **Totals from section sums** (1-ii) — granular sub-lines are display-only; totals authoritative.
2. **Branch filter** — FINANCE expenses are central (no branch split). When `branchId`/`branchIds` is passed, **revenue** still filters by branch (cash-basis sales), but **expenses return the full FINANCE total** (real: FINANCE bookkeeping is centralized). Documented on the report.
3. **Mixed basis** — revenue stays cash-basis, expenses are accrual (journal). `netProfit` is a hybrid management figure — annotate the report response (`basis: 'cash-revenue/accrual-expense'`) and surface a note in the doc. The strict accrual P&L remains on `/accounting`.

### Affected callers (auto-benefit)

- `/reports` P&L endpoints (`reports.controller` → `reports.service` → `getProfitLossReport`).
- `getMonthlyPLSummary` (dashboard MoM/YoY) — same `[]` stub; same journal-sourcing applied.
- `monthly-close.service` snapshot — calls `getProfitLossReport`; the snapshot's P&L profit becomes correct automatically.

## Testing

Golden unit test (mock Prisma `journalLine.groupBy`):
- Seed expense lines across sections (52-1101, 53-1101, 53-1102, 53-1601, 51-1102, 54-1103) → assert: `totalSelling`/`totalAdmin`/`totalOther` = section sums; granular `SELL_COMMISSION`/`ADMIN_SALARY`/`ADMIN_SOCIAL_SECURITY`/`ADMIN_DEPRECIATION`/`OTHER_LOSS`/`OTHER_FINE` rollups; `netProfit = revenue − totalExpenses`.
- Account not in the map → still counted in its section total, no granular line.
- Net expense uses `debit − credit` (a credit/reversal reduces the expense).

## Out of scope (explicit — separate follow-ups)

- `getBalanceSheet` / `getCashFlowStatement` accrued-liability / WHT stubs (different stubs; same pattern, later).
- Unifying cash vs accrual basis / retiring the `/reports` P&L (owner chose to keep it — option A).
- Refund reversal-JE (#5) — separate.
- Frontend changes (none needed).

## Risk

Low–moderate. Backend-only, shape-preserving, totals are section-summed (robust to map gaps). The granular map is the only accountant-judgment artifact and is non-load-bearing for totals. Changes reported profit on `/reports` + snapshots (intended — it was overstated); flag to accountant before merge (do NOT auto-deploy to prod without sign-off on the numbers shift).
