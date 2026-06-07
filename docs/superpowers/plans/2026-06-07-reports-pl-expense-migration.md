# /reports P&L Expense Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the company-wide FINANCE `/reports` P&L so its expense line is sourced from the real journal (accounts 51–54) instead of the `[]` stub, stopping the overstated profit on `/reports` and the monthly-close snapshot.

**Architecture:** Backend-only change in `AccountingService` (`accounting.service.ts`). Add one private helper that aggregates FINANCE journal expense lines for a period into (a) section totals and (b) a curated category breakdown, plus a static account→category map. Wire it into `getProfitLossReport` and `getMonthlyPLSummary`, gated so only **company-wide** views get expenses (per-branch deferred until SHOP accounting exists). Return shape unchanged → no frontend changes.

**Tech Stack:** NestJS 11, Prisma 6 (`journalLine.groupBy`), `Prisma.Decimal`, Jest + ts-jest.

**Spec:** `docs/superpowers/specs/2026-06-07-reports-pl-expense-migration-design.md`
**Branch:** `feat/reports-pl-expense-migration` (already checked out)

**Critical constraint:** This changes a regulated financial figure (reported profit on the company-wide `/reports` P&L + the monthly-close snapshot). The plan ends at **open PR — do NOT merge** (merge to `main` auto-deploys to prod via `deploy-gcp.yml`). Accountant must sign off on the numbers shift before merge.

---

## File Structure

- **Modify:** `apps/api/src/modules/accounting/accounting.service.ts`
  - Add `type ReportExpenseCategory` + `static readonly EXPENSE_ACCOUNT_CATEGORY` map (top of class).
  - Add `private async aggregateFinanceExpenses(start, end, companyWide)` helper.
  - Wire `getProfitLossReport` (replace the `[]` stub at line ~142; switch section totals to journal sums; add `expenseBasis`).
  - Wire `getMonthlyPLSummary` (replace the `[]` stub at line ~382 with per-month journal expenses).
- **Create (test):** `apps/api/src/modules/accounting/accounting.pl-expense.spec.ts`

Single responsibility: the helper owns "FINANCE journal expense → totals + categories"; the two report methods just consume it. The map is the one accountant-reviewable artifact.

---

## Task 1: Expense-aggregation helper + account→category map

**Files:**
- Modify: `apps/api/src/modules/accounting/accounting.service.ts`
- Test: `apps/api/src/modules/accounting/accounting.pl-expense.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/accounting/accounting.pl-expense.spec.ts`:

```ts
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { AccountingService } from './accounting.service';

type GroupRow = { accountCode: string; _sum: { debit: Prisma.Decimal | null; credit: Prisma.Decimal | null } };

const d = (n: string | number) => new Prisma.Decimal(n);

function makeService(groupRows: GroupRow[]) {
  const journalLineGroupBy = jest.fn().mockResolvedValue(groupRows);
  const prisma = {
    journalLine: { groupBy: journalLineGroupBy },
  } as unknown as PrismaService;
  const companyResolver = {
    getFinanceCompanyId: jest.fn().mockResolvedValue('finance-co-1'),
  } as unknown as CompanyResolverService;
  const svc = new AccountingService(prisma, {} as JournalAutoService, companyResolver);
  return { svc, journalLineGroupBy };
}

// Private helper accessor.
const aggregate = (
  svc: AccountingService,
  companyWide: boolean,
) =>
  (svc as unknown as {
    aggregateFinanceExpenses: (
      s: Date,
      e: Date,
      cw: boolean,
    ) => Promise<{
      byCategory: { category: string; totalAmount: Prisma.Decimal }[];
      sectionTotals: { selling: Prisma.Decimal; admin: Prisma.Decimal; other: Prisma.Decimal };
    }>;
  }).aggregateFinanceExpenses(new Date('2026-01-01'), new Date('2026-01-31'), companyWide);

describe('AccountingService.aggregateFinanceExpenses', () => {
  it('company-wide: section totals + curated category rollups, net = debit - credit', async () => {
    const { svc } = makeService([
      { accountCode: '52-1101', _sum: { debit: d('1000'), credit: d('0') } }, // SELL_COMMISSION
      { accountCode: '53-1101', _sum: { debit: d('30000'), credit: d('0') } }, // ADMIN_SALARY
      { accountCode: '53-1102', _sum: { debit: d('1500'), credit: d('0') } }, // ADMIN_SOCIAL_SECURITY
      { accountCode: '53-1601', _sum: { debit: d('2000'), credit: d('500') } }, // ADMIN_DEPRECIATION net 1500
      { accountCode: '51-1102', _sum: { debit: d('800'), credit: d('0') } }, // OTHER_LOSS
      { accountCode: '53-9999', _sum: { debit: d('700'), credit: d('0') } }, // unmapped → admin section only
    ]);

    const r = await aggregate(svc, true);

    // section totals (authoritative)
    expect(r.sectionTotals.selling.toFixed(2)).toBe('1000.00'); // Σ52
    expect(r.sectionTotals.admin.toFixed(2)).toBe('33700.00'); // 30000+1500+1500+700
    expect(r.sectionTotals.other.toFixed(2)).toBe('800.00'); // Σ51

    // curated category rollups (display)
    const byCat = Object.fromEntries(r.byCategory.map((c) => [c.category, c.totalAmount.toFixed(2)]));
    expect(byCat['SELL_COMMISSION']).toBe('1000.00');
    expect(byCat['ADMIN_SALARY']).toBe('30000.00');
    expect(byCat['ADMIN_SOCIAL_SECURITY']).toBe('1500.00');
    expect(byCat['ADMIN_DEPRECIATION']).toBe('1500.00'); // 2000 - 500
    expect(byCat['OTHER_LOSS']).toBe('800.00');
    expect(byCat['53-9999']).toBeUndefined(); // unmapped: no category line
  });

  it('per-branch (not company-wide): returns zeros and does NOT query the journal', async () => {
    const { svc, journalLineGroupBy } = makeService([
      { accountCode: '53-1101', _sum: { debit: d('30000'), credit: d('0') } },
    ]);

    const r = await aggregate(svc, false);

    expect(journalLineGroupBy).not.toHaveBeenCalled();
    expect(r.byCategory).toEqual([]);
    expect(r.sectionTotals.selling.toFixed(2)).toBe('0.00');
    expect(r.sectionTotals.admin.toFixed(2)).toBe('0.00');
    expect(r.sectionTotals.other.toFixed(2)).toBe('0.00');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest src/modules/accounting/accounting.pl-expense.spec.ts --runInBand`
Expected: FAIL — `aggregateFinanceExpenses is not a function`.

- [ ] **Step 3: Add the type + map + helper**

Add the `type ReportExpenseCategory` **above the `@Injectable()` class** (top of file, with the other imports/types):

```ts
type ReportExpenseCategory =
  | 'SELL_COMMISSION' | 'SELL_ADVERTISING'
  | 'ADMIN_SALARY' | 'ADMIN_SOCIAL_SECURITY' | 'ADMIN_OFFICE_SUPPLIES'
  | 'ADMIN_UTILITIES' | 'ADMIN_TELEPHONE' | 'ADMIN_TRAVEL' | 'ADMIN_MAINTENANCE'
  | 'ADMIN_TAX_FEE' | 'ADMIN_DEPRECIATION'
  | 'OTHER_LOSS' | 'OTHER_FINE' | 'OTHER_MISC';
```

Inside the class (next to `SECTION_MAP`), add the curated map:

```ts
  // Account → /reports P&L granular category (display only; totals come from
  // section sums). Accountant-reviewable: rollups chosen from the FINANCE chart
  // names (see 2026-06-07 spec). Accounts not listed still count in their
  // section total but show no granular line.
  private static readonly EXPENSE_ACCOUNT_CATEGORY: Record<string, ReportExpenseCategory> = {
    '52-1101': 'SELL_COMMISSION',
    '52-1102': 'SELL_ADVERTISING', '52-1103': 'SELL_ADVERTISING',
    '53-1101': 'ADMIN_SALARY', '53-1103': 'ADMIN_SALARY', '53-1104': 'ADMIN_SALARY',
    '53-1105': 'ADMIN_SALARY', '53-1106': 'ADMIN_SALARY',
    '53-1102': 'ADMIN_SOCIAL_SECURITY',
    '53-1201': 'ADMIN_OFFICE_SUPPLIES', '53-1202': 'ADMIN_OFFICE_SUPPLIES', '53-1203': 'ADMIN_OFFICE_SUPPLIES',
    '53-1301': 'ADMIN_UTILITIES', '53-1302': 'ADMIN_UTILITIES',
    '53-1303': 'ADMIN_TELEPHONE',
    '53-1304': 'ADMIN_TRAVEL',
    '53-1305': 'ADMIN_MAINTENANCE', '53-1306': 'ADMIN_MAINTENANCE',
    '53-1401': 'ADMIN_TAX_FEE', '53-1402': 'ADMIN_TAX_FEE', '53-1403': 'ADMIN_TAX_FEE',
    '53-1404': 'ADMIN_TAX_FEE', '53-1501': 'ADMIN_TAX_FEE', '53-1502': 'ADMIN_TAX_FEE',
    '53-1701': 'ADMIN_TAX_FEE', '53-1702': 'ADMIN_TAX_FEE',
    '53-1601': 'ADMIN_DEPRECIATION', '53-1602': 'ADMIN_DEPRECIATION',
    '53-1603': 'ADMIN_DEPRECIATION', '53-1604': 'ADMIN_DEPRECIATION',
    '51-1102': 'OTHER_LOSS', '51-1103': 'OTHER_LOSS', '53-1605': 'OTHER_LOSS',
    '51-1104': 'OTHER_FINE', '54-1103': 'OTHER_FINE', '54-1104': 'OTHER_FINE',
    '51-1101': 'OTHER_MISC', '51-1105': 'OTHER_MISC', '53-1503': 'OTHER_MISC',
    '54-1101': 'OTHER_MISC', '54-1102': 'OTHER_MISC',
  };
```

Add the helper as a private method in the class:

```ts
  /**
   * Aggregate POSTED FINANCE journal expense lines (51-54) for a period into
   * section totals (authoritative) + a curated category breakdown (display).
   * Only runs for company-wide views — per-branch expense attribution is
   * deferred until SHOP accounting exists (journal has no branchId).
   */
  private async aggregateFinanceExpenses(
    start: Date,
    end: Date,
    companyWide: boolean,
  ): Promise<{
    byCategory: { category: string; totalAmount: Prisma.Decimal }[];
    sectionTotals: { selling: Prisma.Decimal; admin: Prisma.Decimal; other: Prisma.Decimal };
  }> {
    const zero = () => new Prisma.Decimal(0);
    if (!companyWide) {
      return { byCategory: [], sectionTotals: { selling: zero(), admin: zero(), other: zero() } };
    }

    const financeCompanyId = await this.companyResolver.getFinanceCompanyId();
    const lineSums = await this.prisma.journalLine.groupBy({
      by: ['accountCode'],
      where: {
        journalEntry: {
          status: 'POSTED',
          entryDate: { gte: start, lte: end },
          deletedAt: null,
          companyId: financeCompanyId,
        },
        deletedAt: null,
        OR: [
          { accountCode: { startsWith: '51-' } },
          { accountCode: { startsWith: '52-' } },
          { accountCode: { startsWith: '53-' } },
          { accountCode: { startsWith: '54-' } },
        ],
      },
      _sum: { debit: true, credit: true },
    });

    let selling = zero();
    let admin = zero();
    let other = zero();
    const byCategoryMap = new Map<string, Prisma.Decimal>();

    for (const row of lineSums) {
      const net = new Prisma.Decimal(row._sum.debit ?? 0).sub(new Prisma.Decimal(row._sum.credit ?? 0));
      const prefix = row.accountCode.slice(0, 2);
      if (prefix === '52') selling = selling.add(net);
      else if (prefix === '53') admin = admin.add(net);
      else if (prefix === '51' || prefix === '54') other = other.add(net);

      const category = AccountingService.EXPENSE_ACCOUNT_CATEGORY[row.accountCode];
      if (category) {
        byCategoryMap.set(category, (byCategoryMap.get(category) ?? zero()).add(net));
      }
    }

    return {
      byCategory: [...byCategoryMap.entries()].map(([category, totalAmount]) => ({ category, totalAmount })),
      sectionTotals: { selling, admin, other },
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest src/modules/accounting/accounting.pl-expense.spec.ts --runInBand`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/accounting/accounting.service.ts apps/api/src/modules/accounting/accounting.pl-expense.spec.ts
git commit -m "feat(accounting): FINANCE expense aggregation helper + account→category map" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Wire `getProfitLossReport`

**Files:**
- Modify: `apps/api/src/modules/accounting/accounting.service.ts` (`getProfitLossReport`, lines ~86–347)
- Test: `apps/api/src/modules/accounting/accounting.pl-expense.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `accounting.pl-expense.spec.ts`. This calls the real `getProfitLossReport` with the heavy revenue queries mocked to empty so we isolate the expense wiring:

```ts
function makeFullService(groupRows: GroupRow[]) {
  const agg0 = { _sum: {} as Record<string, Prisma.Decimal | null> };
  const prisma = {
    sale: { aggregate: jest.fn().mockResolvedValue(agg0), findMany: jest.fn().mockResolvedValue([]) },
    payment: { findMany: jest.fn().mockResolvedValue([]) },
    financeReceivable: { aggregate: jest.fn().mockResolvedValue({ _sum: {} }) },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    journalLine: { groupBy: jest.fn().mockResolvedValue(groupRows) },
  } as unknown as PrismaService;
  const companyResolver = { getFinanceCompanyId: jest.fn().mockResolvedValue('finance-co-1') } as unknown as CompanyResolverService;
  return new AccountingService(prisma, {} as JournalAutoService, companyResolver);
}

describe('AccountingService.getProfitLossReport (expense wiring)', () => {
  it('company-wide: section sums drive totals; granular lines populated; basis flagged', async () => {
    const svc = makeFullService([
      { accountCode: '53-1101', _sum: { debit: d('30000'), credit: d('0') } },
      { accountCode: '52-1101', _sum: { debit: d('1000'), credit: d('0') } },
      { accountCode: '53-9999', _sum: { debit: d('700'), credit: d('0') } }, // unmapped, admin section
    ]);
    const r = await svc.getProfitLossReport('2026-01-01', '2026-01-31');

    expect(r.adminExpenses.totalAdmin).toBe(30700); // Σ53 (incl. unmapped) — from section sum
    expect(r.adminExpenses.salary).toBe(30000); // granular line
    expect(r.sellingExpenses.totalSelling).toBe(1000);
    expect(r.summary.totalExpenses).toBe(31700); // COGS 0 + 1000 + 30700 + 0
    expect((r as unknown as { expenseBasis: string }).expenseBasis).toBe('accrual-journal');
  });

  it('per-branch: expenses stay zero, journal not queried', async () => {
    const svc = makeFullService([{ accountCode: '53-1101', _sum: { debit: d('30000'), credit: d('0') } }]);
    const r = await svc.getProfitLossReport('2026-01-01', '2026-01-31', 'branch-1');

    expect(r.adminExpenses.totalAdmin).toBe(0);
    expect(r.summary.totalExpenses).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest src/modules/accounting/accounting.pl-expense.spec.ts -t "expense wiring" --runInBand`
Expected: FAIL — `totalAdmin` is 0 (stub) and `expenseBasis` undefined.

- [ ] **Step 3: Implement the wiring**

In `getProfitLossReport`:

**(3a)** Remove the stubbed expense element from the `Promise.all` (the `expensesByCategory` entry, currently lines ~104 in the destructure and ~140–142 the element):

- Remove `expensesByCategory,` from the destructuring array (was line 104).
- Remove the array element:
```ts
      // Legacy `expense` model removed — expense aggregation deferred to ExpenseDocument
      // module integration in a follow-up PR. Returns empty list so downstream maps stay zero.
      Promise.resolve([] as { category: string; totalAmount: Prisma.Decimal }[]),
```

**(3b)** Immediately after the `Promise.all([...])` block closes (after the destructuring `const [...] = await Promise.all([...])`), insert:

```ts
    const companyWide = !branchId && (!branchIds || branchIds.length === 0);
    const { byCategory: expensesByCategory, sectionTotals } =
      await this.aggregateFinanceExpenses(start, end, companyWide);
```

(`start` and `end` are the `Date` objects already built at the top of the method.)

**(3c)** Replace the three section-total lines so totals come from `sectionTotals` instead of the granular sums:

- Line ~242:
```ts
    const totalSelling = sectionTotals.selling;
```
- Lines ~263–265:
```ts
    const totalAdmin = sectionTotals.admin;
```
- Line ~289:
```ts
    const totalOther = sectionTotals.other;
```

(Leave the granular `sellCommission = getExp('SELL_COMMISSION')` etc. lines and the `sellingExpenses`/`adminExpenses`/`otherExpenses` display objects unchanged — they remain best-effort display fed by the curated `expensesByCategory`/`expMap`.)

**(3d)** Add `expenseBasis` to the return object (inside the `return { ... }`, e.g. right after `netProfit: netProfitNum,`):

```ts
      expenseBasis: 'accrual-journal' as const,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest src/modules/accounting/accounting.pl-expense.spec.ts --runInBand`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Typecheck the file compiles**

Run: `cd apps/api && npx eslint 'src/modules/accounting/accounting.service.ts'`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/accounting/accounting.service.ts apps/api/src/modules/accounting/accounting.pl-expense.spec.ts
git commit -m "feat(accounting): /reports P&L expenses from journal (company-wide), basis flag" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Wire `getMonthlyPLSummary`

**Files:**
- Modify: `apps/api/src/modules/accounting/accounting.service.ts` (`getMonthlyPLSummary`, lines ~349–439)
- Test: `apps/api/src/modules/accounting/accounting.pl-expense.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to the spec:

```ts
describe('AccountingService.getMonthlyPLSummary (expense wiring)', () => {
  function makeMonthlyService(lines: { entryDate: Date; debit: Prisma.Decimal; credit: Prisma.Decimal }[]) {
    const prisma = {
      sale: { findMany: jest.fn().mockResolvedValue([]) },
      payment: { findMany: jest.fn().mockResolvedValue([]) },
      financeReceivable: { findMany: jest.fn().mockResolvedValue([]) },
      journalLine: {
        findMany: jest.fn().mockResolvedValue(
          lines.map((l) => ({ debit: l.debit, credit: l.credit, journalEntry: { entryDate: l.entryDate } })),
        ),
      },
    } as unknown as PrismaService;
    const companyResolver = { getFinanceCompanyId: jest.fn().mockResolvedValue('finance-co-1') } as unknown as CompanyResolverService;
    return new AccountingService(prisma, {} as JournalAutoService, companyResolver);
  }

  it('company-wide: per-month FINANCE expenses subtracted from revenue', async () => {
    const svc = makeMonthlyService([
      { entryDate: new Date('2026-02-10'), debit: d('5000'), credit: d('0') }, // Feb
      { entryDate: new Date('2026-02-20'), debit: d('1000'), credit: d('200') }, // Feb net 800
    ]);
    const r = await svc.getMonthlyPLSummary(2026);
    const feb = r.months.find((m) => m.month === 2)!;
    expect(feb.expenses).toBe(5800); // 5000 + 800
    expect(feb.netProfit).toBe(-5800); // revenue 0
    const jan = r.months.find((m) => m.month === 1)!;
    expect(jan.expenses).toBe(0);
  });

  it('per-branch: expenses zero, journal not queried', async () => {
    const svc = makeMonthlyService([{ entryDate: new Date('2026-02-10'), debit: d('5000'), credit: d('0') }]);
    const r = await svc.getMonthlyPLSummary(2026, 'branch-1');
    expect(r.months.every((m) => m.expenses === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest src/modules/accounting/accounting.pl-expense.spec.ts -t "getMonthlyPLSummary" --runInBand`
Expected: FAIL — Feb `expenses` is 0 (stub).

- [ ] **Step 3: Implement the wiring**

In `getMonthlyPLSummary`:

**(3a)** Remove the stubbed expense element from its `Promise.all` (the `expenses` entry — currently the destructured `expenses` name and the element at lines ~380–382):

- Remove `expenses,` from the destructuring array.
- Remove the array element:
```ts
      // Legacy `expense` model removed — expense aggregation deferred to ExpenseDocument
      // module integration in a follow-up PR.
      Promise.resolve([] as { totalAmount: Prisma.Decimal; expenseDate: Date }[]),
```

**(3b)** After the `Promise.all([...])` block closes, insert:

```ts
    const companyWide = !branchId && (!branchIds || branchIds.length === 0);
    let expenses: { totalAmount: Prisma.Decimal; expenseDate: Date }[] = [];
    if (companyWide) {
      const financeCompanyId = await this.companyResolver.getFinanceCompanyId();
      const start = new Date(year, 0, 1);
      const end = new Date(year, 11, 31, 23, 59, 59, 999);
      const expLines = await this.prisma.journalLine.findMany({
        where: {
          journalEntry: {
            status: 'POSTED',
            entryDate: { gte: start, lte: end },
            deletedAt: null,
            companyId: financeCompanyId,
          },
          deletedAt: null,
          OR: [
            { accountCode: { startsWith: '51-' } },
            { accountCode: { startsWith: '52-' } },
            { accountCode: { startsWith: '53-' } },
            { accountCode: { startsWith: '54-' } },
          ],
        },
        select: { debit: true, credit: true, journalEntry: { select: { entryDate: true } } },
      });
      expenses = expLines.map((l) => ({
        totalAmount: new Prisma.Decimal(l.debit ?? 0).sub(new Prisma.Decimal(l.credit ?? 0)),
        expenseDate: l.journalEntry.entryDate,
      }));
    }
```

The existing month loop (`for (const e of expenses) { if (getMonth(e.expenseDate) !== i) continue; expenseTotal = expenseTotal.add(new Prisma.Decimal(e.totalAmount)); }`) consumes this unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest src/modules/accounting/accounting.pl-expense.spec.ts --runInBand`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Lint**

Run: `cd apps/api && npx eslint 'src/modules/accounting/accounting.service.ts'`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/accounting/accounting.service.ts apps/api/src/modules/accounting/accounting.pl-expense.spec.ts
git commit -m "feat(accounting): monthly P&L summary expenses from journal (company-wide)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Regression check + PR (no merge)

**Files:** none (verification only)

- [ ] **Step 1: Run the existing accounting suite in isolation (flaky in parallel — see memory)**

Run: `cd apps/api && npx jest src/modules/accounting --runInBand`
Expected: PASS (existing accounting specs + the new one). If a pre-existing DB-backed spec fails, confirm it fails on `main` too (not caused by this change).

- [ ] **Step 2: Confirm `monthly-close` snapshot path**

Read `apps/api/src/modules/accounting/monthly-close.service.ts` around line 611 — it calls `getProfitLossReport(startDate, asOfDate, undefined, branchIds)`. Verify the `branchIds` it passes is `undefined`/empty for the company-wide close so the snapshot gets the corrected (company-wide) profit. If it passes a specific list, note it in the PR as a follow-up (snapshot would still defer). Do NOT change monthly-close in this PR unless `branchIds` is trivially `undefined` there.

- [ ] **Step 3: Push + open PR (do NOT merge)**

```bash
git push -u origin feat/reports-pl-expense-migration
gh pr create --base main --head feat/reports-pl-expense-migration \
  --title "feat(accounting): /reports P&L expenses from journal (company-wide FINANCE)" \
  --body "Implements docs/superpowers/specs/2026-06-07-reports-pl-expense-migration-design.md. Company-wide /reports P&L (+ monthly P&L summary + monthly-close snapshot) now source expenses from FINANCE journal 51-54 instead of the [] stub; per-branch views unchanged (deferred to SHOP accounting). Totals from section sums; curated account→category map for display. **Changes reported profit — needs accountant sign-off on the numbers before merge (merge auto-deploys to prod).** 🤖 Generated with Claude Code"
```

- [ ] **Step 4: STOP — do not merge.** Report to the user that the PR is open and needs accountant sign-off on the profit-figure change before merge/deploy.

---

## Self-Review

- **Spec coverage:** journal-sourced expenses ✓ (Task 1 helper); company-wide branch guard ✓ (Tasks 2/3); section-sum totals ✓ (Task 2 3c); curated map ✓ (Task 1); `expenseBasis` flag ✓ (Task 2 3d); `getMonthlyPLSummary` ✓ (Task 3); monthly-close auto-benefit ✓ (Task 4 verify); per-branch deferred + SHOP/BS/CashFlow/refund out of scope ✓ (not touched). Frontend untouched ✓ (shape preserved).
- **Placeholders:** none — every step has exact code/commands.
- **Type consistency:** helper returns `{ byCategory, sectionTotals }` and Task 2 destructures `{ byCategory: expensesByCategory, sectionTotals }`; `ReportExpenseCategory` union matches the map values and the report's `getExp('...')` keys; `expenseBasis: 'accrual-journal'` consistent between Task 2 impl and its test.
