# P4-SP1: งบการเงิน + รายงานบัญชี Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 7 ComingSoonPage placeholders in the FINANCE menu (Balance Sheet, Cash Flow, Equity Statement, General Journal, General Ledger, Aging Report, Bad Debt Report) with real, functional report pages.

**Architecture:** Frontend-heavy work — most backend service methods already exist in `apps/api/src/modules/accounting/accounting.service.ts` (`getTrialBalance`, `getProfitLossFromJournal`, `getBalanceSheetFromJournal`, and `/api/accounting/ledger/cash-flow`, `/api/accounting/ledger/equity-statement`, `/api/accounting/ledger/general-ledger` controller endpoints). Aging uses `bad-debt.service.getAgingBucket()`. Pages follow the existing ProfitLossPage.tsx pattern: useQuery + ThaiDateInput + CompanyFilter + QueryBoundary + Card layout + lazy-loaded recharts + jspdf/exceljs export.

**Tech Stack:** React 18 + TypeScript + Vite + @tanstack/react-query + shadcn/ui + lucide-react + recharts (lazy) + jspdf-html2canvas + exceljs (lazy)

---

## File Structure

**New page files:**
- `apps/web/src/pages/finance/BalanceSheetPage.tsx`
- `apps/web/src/pages/finance/CashFlowPage.tsx`
- `apps/web/src/pages/finance/EquityStatementPage.tsx`
- `apps/web/src/pages/finance/GeneralJournalPage.tsx`
- `apps/web/src/pages/finance/GeneralLedgerPage.tsx`
- `apps/web/src/pages/finance/AgingReportPage.tsx`
- `apps/web/src/pages/finance/BadDebtReportPage.tsx`

**Backend changes (only where missing):**
- `apps/api/src/modules/accounting/accounting.controller.ts` — add `/ledger/general-journal` + `/ledger/aging` + `/ledger/bad-debt` endpoints
- `apps/api/src/modules/accounting/accounting.service.ts` — add `getGeneralJournal()`, `getAgingReport()`, `getBadDebtReport()`

**Menu config:**
- `apps/web/src/config/menu.ts` — remove `placeholder` marker from 7 items

**Routes:**
- `apps/web/src/App.tsx` — swap 7 `<ComingSoonPage>` for real pages with `<lazy>` import

**Tests:**
- `apps/api/src/modules/accounting/accounting.service.spec.ts` — add tests for 3 new methods
- `apps/web/src/pages/finance/__tests__/AgingReportPage.test.tsx` — vitest for aging bucket display

---

## Task 1: Backend — General Journal endpoint

**Files:**
- Modify: `apps/api/src/modules/accounting/accounting.service.ts`
- Modify: `apps/api/src/modules/accounting/accounting.controller.ts`
- Modify: `apps/api/src/modules/accounting/accounting.service.spec.ts`

- [ ] **Step 1.1: Write failing test for `getGeneralJournal`**

Add to `accounting.service.spec.ts`:

```typescript
describe('getGeneralJournal', () => {
  it('returns JournalEntry list with lines, sorted by postedAt desc, paged', async () => {
    const start = new Date('2026-05-01');
    const end = new Date('2026-05-31');
    const result = await service.getGeneralJournal(start, end, { page: 1, limit: 50 });
    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('total');
    expect(result.data[0]).toHaveProperty('lines');
    // sorted desc by postedAt
    for (let i = 1; i < result.data.length; i++) {
      expect(new Date(result.data[i - 1].postedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(result.data[i].postedAt).getTime(),
      );
    }
  });
});
```

- [ ] **Step 1.2: Run test — expect failure**

`cd apps/api && npx jest accounting.service.spec.ts -t getGeneralJournal`
Expected: FAIL — method not defined

- [ ] **Step 1.3: Implement `getGeneralJournal`**

Add to `accounting.service.ts`:

```typescript
async getGeneralJournal(
  periodStart: Date,
  periodEnd: Date,
  opts: { page?: number; limit?: number; companyId?: string } = {},
) {
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 50;
  const where = {
    postedAt: { gte: periodStart, lte: periodEnd },
    deletedAt: null,
    ...(opts.companyId ? { companyId: opts.companyId } : {}),
  };
  const [data, total] = await Promise.all([
    this.prisma.journalEntry.findMany({
      where,
      include: {
        lines: {
          select: { accountCode: true, accountName: true, debitAmount: true, creditAmount: true, description: true },
          orderBy: { lineNumber: 'asc' },
        },
      },
      orderBy: { postedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    this.prisma.journalEntry.count({ where }),
  ]);
  return { data, total, page, limit };
}
```

- [ ] **Step 1.4: Run test — expect pass**

Expected: PASS

- [ ] **Step 1.5: Expose controller endpoint**

Add to `accounting.controller.ts`:

```typescript
@Get('ledger/general-journal')
@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
getGeneralJournal(
  @Query('start') start: string,
  @Query('end') end: string,
  @Query('page') page?: string,
  @Query('limit') limit?: string,
  @Query('companyId') companyId?: string,
) {
  return this.service.getGeneralJournal(new Date(start), new Date(end), {
    page: page ? parseInt(page, 10) : 1,
    limit: limit ? parseInt(limit, 10) : 50,
    companyId,
  });
}
```

- [ ] **Step 1.6: Commit**

```bash
git add apps/api/src/modules/accounting/accounting.{service,controller,service.spec}.ts
git commit -m "feat(p4-sp1): add general-journal endpoint with paging"
```

---

## Task 2: Backend — Aging Report endpoint

**Files:**
- Modify: `apps/api/src/modules/accounting/accounting.service.ts`
- Modify: `apps/api/src/modules/accounting/accounting.controller.ts`
- Modify: `apps/api/src/modules/accounting/accounting.service.spec.ts`

- [ ] **Step 2.1: Write failing test for `getAgingReport`**

```typescript
describe('getAgingReport', () => {
  it('returns customer-by-customer aging with buckets 0-30/31-60/61-90/90+', async () => {
    const result = await service.getAgingReport(new Date('2026-05-19'));
    expect(result.summary).toHaveProperty('bucket_0_30');
    expect(result.summary).toHaveProperty('bucket_31_60');
    expect(result.summary).toHaveProperty('bucket_61_90');
    expect(result.summary).toHaveProperty('bucket_90_plus');
    expect(result.customers).toBeInstanceOf(Array);
    if (result.customers.length > 0) {
      expect(result.customers[0]).toHaveProperty('customerId');
      expect(result.customers[0]).toHaveProperty('totalOverdue');
      expect(result.customers[0]).toHaveProperty('bucket');
    }
  });
});
```

- [ ] **Step 2.2: Implement `getAgingReport`**

```typescript
async getAgingReport(asOf: Date) {
  const overduePayments = await this.prisma.payment.findMany({
    where: {
      status: { in: ['PENDING', 'OVERDUE'] },
      dueDate: { lt: asOf },
      deletedAt: null,
    },
    include: {
      contract: { include: { customer: { select: { id: true, firstName: true, lastName: true, phone: true } } } },
    },
  });

  const summary = { bucket_0_30: 0, bucket_31_60: 0, bucket_61_90: 0, bucket_90_plus: 0 };
  const customerMap = new Map<string, { customerId: string; customerName: string; phone: string; totalOverdue: number; daysOverdue: number; bucket: string; contracts: number }>();

  for (const p of overduePayments) {
    const daysOverdue = Math.floor((asOf.getTime() - p.dueDate.getTime()) / (1000 * 60 * 60 * 24));
    const remaining = Number(p.amount) - Number(p.paidAmount ?? 0);
    if (remaining <= 0) continue;
    const bucket = daysOverdue <= 30 ? 'bucket_0_30' : daysOverdue <= 60 ? 'bucket_31_60' : daysOverdue <= 90 ? 'bucket_61_90' : 'bucket_90_plus';
    summary[bucket] += remaining;

    const cid = p.contract.customer.id;
    const existing = customerMap.get(cid);
    if (existing) {
      existing.totalOverdue += remaining;
      existing.daysOverdue = Math.max(existing.daysOverdue, daysOverdue);
      existing.bucket = existing.daysOverdue <= 30 ? 'bucket_0_30' : existing.daysOverdue <= 60 ? 'bucket_31_60' : existing.daysOverdue <= 90 ? 'bucket_61_90' : 'bucket_90_plus';
    } else {
      customerMap.set(cid, {
        customerId: cid,
        customerName: `${p.contract.customer.firstName} ${p.contract.customer.lastName}`,
        phone: p.contract.customer.phone ?? '',
        totalOverdue: remaining,
        daysOverdue,
        bucket,
        contracts: 1,
      });
    }
  }

  return {
    asOf,
    summary,
    customers: Array.from(customerMap.values()).sort((a, b) => b.daysOverdue - a.daysOverdue),
  };
}
```

- [ ] **Step 2.3: Expose endpoint + commit**

```typescript
@Get('ledger/aging')
@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
getAgingReport(@Query('asOf') asOf?: string) {
  return this.service.getAgingReport(asOf ? new Date(asOf) : new Date());
}
```

```bash
git add apps/api/src/modules/accounting/accounting.{service,controller,service.spec}.ts
git commit -m "feat(p4-sp1): add aging report endpoint with customer-level buckets"
```

---

## Task 3: Backend — Bad Debt Report endpoint

**Files:**
- Modify: `apps/api/src/modules/accounting/accounting.service.ts`
- Modify: `apps/api/src/modules/accounting/accounting.controller.ts`

- [ ] **Step 3.1: Implement `getBadDebtReport`**

```typescript
async getBadDebtReport(periodStart: Date, periodEnd: Date, companyId?: string) {
  const lines = await this.prisma.journalLine.findMany({
    where: {
      accountCode: '51-1102',
      journalEntry: {
        postedAt: { gte: periodStart, lte: periodEnd },
        deletedAt: null,
        ...(companyId ? { companyId } : {}),
      },
    },
    include: {
      journalEntry: {
        select: { id: true, documentNumber: true, description: true, postedAt: true, sourceType: true, sourceId: true },
      },
    },
    orderBy: { journalEntry: { postedAt: 'desc' } },
  });

  const total = lines.reduce((s, l) => s + Number(l.debitAmount), 0);
  return {
    period: { start: periodStart, end: periodEnd },
    totalBadDebt: total,
    entries: lines.map((l) => ({
      journalEntryId: l.journalEntry.id,
      documentNumber: l.journalEntry.documentNumber,
      postedAt: l.journalEntry.postedAt,
      description: l.description ?? l.journalEntry.description,
      amount: Number(l.debitAmount),
      sourceType: l.journalEntry.sourceType,
      sourceId: l.journalEntry.sourceId,
    })),
  };
}
```

- [ ] **Step 3.2: Add controller endpoint + commit**

```typescript
@Get('ledger/bad-debt')
@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
getBadDebtReport(@Query('start') start: string, @Query('end') end: string, @Query('companyId') companyId?: string) {
  return this.service.getBadDebtReport(new Date(start), new Date(end), companyId);
}
```

```bash
git add apps/api/src/modules/accounting/accounting.{service,controller}.ts
git commit -m "feat(p4-sp1): add bad-debt report endpoint"
```

---

## Task 4: Frontend — BalanceSheetPage

**Files:**
- Create: `apps/web/src/pages/finance/BalanceSheetPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/config/menu.ts`

- [ ] **Step 4.1: Create page component**

Pattern: copy ProfitLossPage.tsx, swap data source.

```tsx
// apps/web/src/pages/finance/BalanceSheetPage.tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Scale } from 'lucide-react';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { formatTHB } from '@/utils/formatters';

interface BSLine { code: string; name: string; amount: number; }
interface BSData {
  asOf: string;
  assets: { current: BSLine[]; nonCurrent: BSLine[]; totalAssets: number };
  liabilities: { current: BSLine[]; nonCurrent: BSLine[]; totalLiabilities: number };
  equity: { lines: BSLine[]; totalEquity: number };
  totalLiabilitiesEquity: number;
}

export default function BalanceSheetPage() {
  const [asOf, setAsOf] = useState<Date>(new Date());
  const query = useQuery({
    queryKey: ['balance-sheet', asOf.toISOString()],
    queryFn: () => api.get<BSData>(`/accounting/ledger/balance-sheet?asOfDate=${asOf.toISOString()}`).then((r) => r.data),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="งบดุล (Balance Sheet)" icon={Scale} />
      <Card>
        <CardHeader>
          <ThaiDateInput value={asOf} onChange={setAsOf} label="ณ วันที่" />
        </CardHeader>
        <CardContent>
          <QueryBoundary query={query}>
            {(data) => (
              <div className="grid md:grid-cols-2 gap-6">
                <BSColumn title="สินทรัพย์" sections={[
                  { label: 'สินทรัพย์หมุนเวียน', lines: data.assets.current },
                  { label: 'สินทรัพย์ไม่หมุนเวียน', lines: data.assets.nonCurrent },
                ]} total={data.assets.totalAssets} totalLabel="รวมสินทรัพย์" />
                <BSColumn title="หนี้สิน + ส่วนของผู้ถือหุ้น" sections={[
                  { label: 'หนี้สินหมุนเวียน', lines: data.liabilities.current },
                  { label: 'หนี้สินไม่หมุนเวียน', lines: data.liabilities.nonCurrent },
                  { label: 'ส่วนของผู้ถือหุ้น', lines: data.equity.lines },
                ]} total={data.totalLiabilitiesEquity} totalLabel="รวมหนี้สิน + ส่วนของผู้ถือหุ้น" />
              </div>
            )}
          </QueryBoundary>
        </CardContent>
      </Card>
    </div>
  );
}

function BSColumn({ title, sections, total, totalLabel }: {
  title: string;
  sections: { label: string; lines: BSLine[] }[];
  total: number;
  totalLabel: string;
}) {
  return (
    <div>
      <h3 className="font-semibold text-lg mb-3">{title}</h3>
      {sections.map((s) => (
        <div key={s.label} className="mb-4">
          <div className="text-sm font-medium text-muted-foreground mb-2">{s.label}</div>
          {s.lines.map((l) => (
            <div key={l.code} className="flex justify-between text-sm py-1 border-b border-border/40">
              <span><span className="text-muted-foreground mr-2">{l.code}</span>{l.name}</span>
              <span className="font-mono">{formatTHB(l.amount)}</span>
            </div>
          ))}
        </div>
      ))}
      <div className="flex justify-between font-semibold text-base pt-2 border-t-2 border-primary">
        <span>{totalLabel}</span>
        <span className="font-mono">{formatTHB(total)}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4.2: Wire route**

In `apps/web/src/App.tsx`, replace the `/finance/balance-sheet` ComingSoonPage Route with:

```tsx
const BalanceSheetPage = lazy(() => import('@/pages/finance/BalanceSheetPage'));

// ... in the routes block:
<Route
  path="/finance/balance-sheet"
  element={
    <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
      <BalanceSheetPage />
    </ProtectedRoute>
  }
/>
```

- [ ] **Step 4.3: Remove placeholder marker from menu.ts**

Find the line in `apps/web/src/config/menu.ts`:

```ts
{ label: 'งบดุล (Balance Sheet)', path: '/finance/balance-sheet', icon: PieChart, placeholder: { trackingSP: 'SP2', eta: 'ภายในไตรมาส 2/2026' } },
```

Replace with:

```ts
{ label: 'งบดุล (Balance Sheet)', path: '/finance/balance-sheet', icon: PieChart },
```

- [ ] **Step 4.4: TS + build verify + commit**

```bash
cd apps/web && npx tsc --noEmit && npm run build
git add apps/web/src/{pages/finance/BalanceSheetPage.tsx,App.tsx,config/menu.ts}
git commit -m "feat(p4-sp1): BalanceSheetPage — replace ComingSoonPage"
```

---

## Task 5: Frontend — CashFlowPage

**Files:**
- Create: `apps/web/src/pages/finance/CashFlowPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/config/menu.ts`

- [ ] **Step 5.1: Create page**

Same pattern as Task 4, but uses `/accounting/ledger/cash-flow?start=...&end=...` endpoint. Sections: Operating / Investing / Financing activities. Display each activity's contributing JE lines.

```tsx
// apps/web/src/pages/finance/CashFlowPage.tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Banknote } from 'lucide-react';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { formatTHB } from '@/utils/formatters';

interface CFLine { code: string; name: string; amount: number }
interface CFData {
  period: { start: string; end: string };
  operating: { lines: CFLine[]; total: number };
  investing: { lines: CFLine[]; total: number };
  financing: { lines: CFLine[]; total: number };
  netCashChange: number;
  beginningCash: number;
  endingCash: number;
}

export default function CashFlowPage() {
  const [start, setStart] = useState<Date>(new Date(new Date().getFullYear(), 0, 1));
  const [end, setEnd] = useState<Date>(new Date());
  const query = useQuery({
    queryKey: ['cash-flow', start.toISOString(), end.toISOString()],
    queryFn: () => api.get<CFData>(`/accounting/ledger/cash-flow?start=${start.toISOString()}&end=${end.toISOString()}`).then((r) => r.data),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="งบกระแสเงินสด (Cash Flow Statement)" icon={Banknote} />
      <Card>
        <CardHeader className="flex flex-row gap-4 items-end">
          <ThaiDateInput value={start} onChange={setStart} label="ตั้งแต่" />
          <ThaiDateInput value={end} onChange={setEnd} label="ถึง" />
        </CardHeader>
        <CardContent>
          <QueryBoundary query={query}>
            {(data) => (
              <div className="space-y-6">
                <CFSection title="กระแสเงินสดจากกิจกรรมดำเนินงาน" data={data.operating} />
                <CFSection title="กระแสเงินสดจากกิจกรรมลงทุน" data={data.investing} />
                <CFSection title="กระแสเงินสดจากกิจกรรมจัดหาเงิน" data={data.financing} />
                <div className="border-t-2 border-primary pt-4 space-y-2">
                  <Row label="เงินสดเปลี่ยนแปลงสุทธิ" value={data.netCashChange} bold />
                  <Row label="เงินสดต้นงวด" value={data.beginningCash} />
                  <Row label="เงินสดปลายงวด" value={data.endingCash} bold />
                </div>
              </div>
            )}
          </QueryBoundary>
        </CardContent>
      </Card>
    </div>
  );
}

function CFSection({ title, data }: { title: string; data: { lines: CFLine[]; total: number } }) {
  return (
    <div>
      <h3 className="font-semibold mb-2">{title}</h3>
      {data.lines.map((l) => <Row key={l.code} label={`${l.code} ${l.name}`} value={l.amount} />)}
      <Row label="รวม" value={data.total} bold />
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex justify-between text-sm py-1 ${bold ? 'font-semibold border-t border-border/40 pt-2 mt-2' : ''}`}>
      <span>{label}</span>
      <span className="font-mono">{formatTHB(value)}</span>
    </div>
  );
}
```

- [ ] **Step 5.2: Wire route + remove placeholder + commit**

Same pattern as Task 4 — replace `/finance/cash-flow` Route, remove `placeholder` marker.

```bash
git add apps/web/src/{pages/finance/CashFlowPage.tsx,App.tsx,config/menu.ts}
git commit -m "feat(p4-sp1): CashFlowPage — replace ComingSoonPage"
```

---

## Task 6: Frontend — EquityStatementPage

**Files:**
- Create: `apps/web/src/pages/finance/EquityStatementPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/config/menu.ts`

- [ ] **Step 6.1: Create page (movement-table style)**

```tsx
// apps/web/src/pages/finance/EquityStatementPage.tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Landmark } from 'lucide-react';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { formatTHB } from '@/utils/formatters';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

interface EquityData {
  period: { start: string; end: string };
  rows: { component: string; opening: number; netIncome: number; dividends: number; otherMovement: number; closing: number }[];
  totalOpening: number;
  totalClosing: number;
}

export default function EquityStatementPage() {
  const [start, setStart] = useState<Date>(new Date(new Date().getFullYear(), 0, 1));
  const [end, setEnd] = useState<Date>(new Date());
  const query = useQuery({
    queryKey: ['equity-statement', start.toISOString(), end.toISOString()],
    queryFn: () => api.get<EquityData>(`/accounting/ledger/equity-statement?start=${start.toISOString()}&end=${end.toISOString()}`).then((r) => r.data),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="งบแสดงการเปลี่ยนแปลงส่วนของผู้ถือหุ้น" icon={Landmark} />
      <Card>
        <CardHeader className="flex flex-row gap-4 items-end">
          <ThaiDateInput value={start} onChange={setStart} label="ตั้งแต่" />
          <ThaiDateInput value={end} onChange={setEnd} label="ถึง" />
        </CardHeader>
        <CardContent>
          <QueryBoundary query={query}>
            {(data) => (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>องค์ประกอบ</TableHead>
                    <TableHead className="text-right">ยอดต้นงวด</TableHead>
                    <TableHead className="text-right">กำไรสุทธิ</TableHead>
                    <TableHead className="text-right">เงินปันผล</TableHead>
                    <TableHead className="text-right">เปลี่ยนแปลงอื่น</TableHead>
                    <TableHead className="text-right">ยอดสิ้นงวด</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((r) => (
                    <TableRow key={r.component}>
                      <TableCell>{r.component}</TableCell>
                      <TableCell className="text-right font-mono">{formatTHB(r.opening)}</TableCell>
                      <TableCell className="text-right font-mono">{formatTHB(r.netIncome)}</TableCell>
                      <TableCell className="text-right font-mono">{formatTHB(r.dividends)}</TableCell>
                      <TableCell className="text-right font-mono">{formatTHB(r.otherMovement)}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">{formatTHB(r.closing)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 border-primary font-semibold">
                    <TableCell>รวม</TableCell>
                    <TableCell className="text-right font-mono">{formatTHB(data.totalOpening)}</TableCell>
                    <TableCell colSpan={3}></TableCell>
                    <TableCell className="text-right font-mono">{formatTHB(data.totalClosing)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </QueryBoundary>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 6.2: Wire route + remove placeholder + commit**

```bash
git add apps/web/src/{pages/finance/EquityStatementPage.tsx,App.tsx,config/menu.ts}
git commit -m "feat(p4-sp1): EquityStatementPage — replace ComingSoonPage"
```

---

## Task 7: Frontend — GeneralJournalPage (chronological JE list)

**Files:**
- Create: `apps/web/src/pages/finance/GeneralJournalPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/config/menu.ts`

- [ ] **Step 7.1: Create page (paged JE list with expandable lines)**

```tsx
// apps/web/src/pages/finance/GeneralJournalPage.tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { BookOpen, ChevronDown, ChevronRight } from 'lucide-react';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { Button } from '@/components/ui/button';
import { formatTHB, formatDateMedium } from '@/utils/formatters';

interface JELine { accountCode: string; accountName: string; debitAmount: string; creditAmount: string; description?: string; }
interface JE { id: string; documentNumber: string; postedAt: string; description: string; lines: JELine[]; }
interface GJData { data: JE[]; total: number; page: number; limit: number; }

export default function GeneralJournalPage() {
  const [start, setStart] = useState<Date>(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [end, setEnd] = useState<Date>(new Date());
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ['general-journal', start.toISOString(), end.toISOString(), page],
    queryFn: () => api.get<GJData>(`/accounting/ledger/general-journal?start=${start.toISOString()}&end=${end.toISOString()}&page=${page}&limit=50`).then((r) => r.data),
  });

  const toggle = (id: string) => setExpanded((s) => {
    const next = new Set(s);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  return (
    <div className="space-y-6">
      <PageHeader title="สมุดรายวันทั่วไป" icon={BookOpen} />
      <Card>
        <CardHeader className="flex flex-row gap-4 items-end">
          <ThaiDateInput value={start} onChange={(d) => { setStart(d); setPage(1); }} label="ตั้งแต่" />
          <ThaiDateInput value={end} onChange={(d) => { setEnd(d); setPage(1); }} label="ถึง" />
        </CardHeader>
        <CardContent>
          <QueryBoundary query={query}>
            {(data) => (
              <>
                <div className="space-y-2">
                  {data.data.map((je) => (
                    <div key={je.id} className="border border-border/60 rounded-lg overflow-hidden">
                      <button onClick={() => toggle(je.id)} className="w-full p-3 flex items-center gap-3 hover:bg-accent/40 text-left">
                        {expanded.has(je.id) ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        <span className="font-mono text-xs text-muted-foreground">{je.documentNumber}</span>
                        <span className="text-sm">{formatDateMedium(je.postedAt)}</span>
                        <span className="text-sm flex-1 truncate">{je.description}</span>
                      </button>
                      {expanded.has(je.id) && (
                        <div className="border-t border-border/40 p-3 bg-muted/20">
                          <table className="w-full text-xs">
                            <thead><tr className="text-muted-foreground"><th className="text-left py-1">บัญชี</th><th className="text-right py-1">เดบิต</th><th className="text-right py-1">เครดิต</th></tr></thead>
                            <tbody>
                              {je.lines.map((l, i) => (
                                <tr key={i}><td className="py-1"><span className="font-mono mr-2">{l.accountCode}</span>{l.accountName}</td><td className="text-right font-mono">{Number(l.debitAmount) ? formatTHB(Number(l.debitAmount)) : '—'}</td><td className="text-right font-mono">{Number(l.creditAmount) ? formatTHB(Number(l.creditAmount)) : '—'}</td></tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex justify-between items-center mt-4">
                  <span className="text-sm text-muted-foreground">รวม {data.total} รายการ · หน้า {page} / {Math.ceil(data.total / data.limit)}</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>ก่อนหน้า</Button>
                    <Button variant="outline" size="sm" disabled={page >= Math.ceil(data.total / data.limit)} onClick={() => setPage(page + 1)}>ถัดไป</Button>
                  </div>
                </div>
              </>
            )}
          </QueryBoundary>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 7.2: Wire route + remove placeholder + commit**

```bash
git add apps/web/src/{pages/finance/GeneralJournalPage.tsx,App.tsx,config/menu.ts}
git commit -m "feat(p4-sp1): GeneralJournalPage — paged JE list with expandable lines"
```

---

## Task 8: Frontend — GeneralLedgerPage (per-account view)

**Files:**
- Create: `apps/web/src/pages/finance/GeneralLedgerPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/config/menu.ts`

- [ ] **Step 8.1: Create page**

```tsx
// apps/web/src/pages/finance/GeneralLedgerPage.tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { BookOpen } from 'lucide-react';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { formatTHB, formatDateMedium } from '@/utils/formatters';
import { useCoaByCodes } from '@/hooks/useCoaByCodes';

interface GLEntry { id: string; postedAt: string; documentNumber: string; description: string; debit: number; credit: number; runningBalance: number; }
interface GLData { account: { code: string; name: string }; openingBalance: number; entries: GLEntry[]; closingBalance: number; }

export default function GeneralLedgerPage() {
  const [accountCode, setAccountCode] = useState('11-2101');
  const [start, setStart] = useState<Date>(new Date(new Date().getFullYear(), 0, 1));
  const [end, setEnd] = useState<Date>(new Date());

  const coa = useCoaByCodes([]);
  const accounts = Object.entries(coa.data ?? {});

  const query = useQuery({
    queryKey: ['general-ledger', accountCode, start.toISOString(), end.toISOString()],
    queryFn: () => api.get<GLData>(`/accounting/ledger/general-ledger?accountCode=${accountCode}&start=${start.toISOString()}&end=${end.toISOString()}`).then((r) => r.data),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="สมุดแยกประเภท" icon={BookOpen} />
      <Card>
        <CardHeader className="flex flex-row gap-4 items-end flex-wrap">
          <Select value={accountCode} onValueChange={setAccountCode}>
            <SelectTrigger className="w-[320px]"><SelectValue /></SelectTrigger>
            <SelectContent>{accounts.map(([code, name]) => <SelectItem key={code} value={code}>{code} — {name}</SelectItem>)}</SelectContent>
          </Select>
          <ThaiDateInput value={start} onChange={setStart} label="ตั้งแต่" />
          <ThaiDateInput value={end} onChange={setEnd} label="ถึง" />
        </CardHeader>
        <CardContent>
          <QueryBoundary query={query}>
            {(data) => (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>วันที่</TableHead>
                    <TableHead>เลขเอกสาร</TableHead>
                    <TableHead>คำอธิบาย</TableHead>
                    <TableHead className="text-right">เดบิต</TableHead>
                    <TableHead className="text-right">เครดิต</TableHead>
                    <TableHead className="text-right">ยอดคงเหลือ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow><TableCell colSpan={5} className="font-medium text-muted-foreground">ยอดยกมา</TableCell><TableCell className="text-right font-mono">{formatTHB(data.openingBalance)}</TableCell></TableRow>
                  {data.entries.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>{formatDateMedium(e.postedAt)}</TableCell>
                      <TableCell className="font-mono text-xs">{e.documentNumber}</TableCell>
                      <TableCell className="text-sm">{e.description}</TableCell>
                      <TableCell className="text-right font-mono">{e.debit ? formatTHB(e.debit) : '—'}</TableCell>
                      <TableCell className="text-right font-mono">{e.credit ? formatTHB(e.credit) : '—'}</TableCell>
                      <TableCell className="text-right font-mono">{formatTHB(e.runningBalance)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 border-primary"><TableCell colSpan={5} className="font-semibold">ยอดยกไป</TableCell><TableCell className="text-right font-mono font-semibold">{formatTHB(data.closingBalance)}</TableCell></TableRow>
                </TableBody>
              </Table>
            )}
          </QueryBoundary>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 8.2: Wire route + remove placeholder + commit**

```bash
git add apps/web/src/{pages/finance/GeneralLedgerPage.tsx,App.tsx,config/menu.ts}
git commit -m "feat(p4-sp1): GeneralLedgerPage — per-account ledger with running balance"
```

---

## Task 9: Frontend — AgingReportPage

**Files:**
- Create: `apps/web/src/pages/finance/AgingReportPage.tsx`
- Create: `apps/web/src/pages/finance/__tests__/AgingReportPage.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/config/menu.ts`

- [ ] **Step 9.1: Create page with 4 bucket cards + customer table**

```tsx
// apps/web/src/pages/finance/AgingReportPage.tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Link } from 'react-router';
import { formatTHB } from '@/utils/formatters';

interface AgingCustomer { customerId: string; customerName: string; phone: string; totalOverdue: number; daysOverdue: number; bucket: string; contracts: number; }
interface AgingData { asOf: string; summary: { bucket_0_30: number; bucket_31_60: number; bucket_61_90: number; bucket_90_plus: number }; customers: AgingCustomer[]; }

const BUCKET_COLORS: Record<string, string> = {
  bucket_0_30: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  bucket_31_60: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  bucket_61_90: 'bg-orange-500/15 text-orange-700 dark:text-orange-400',
  bucket_90_plus: 'bg-red-500/15 text-red-700 dark:text-red-400',
};
const BUCKET_LABELS: Record<string, string> = {
  bucket_0_30: '0-30 วัน',
  bucket_31_60: '31-60 วัน',
  bucket_61_90: '61-90 วัน',
  bucket_90_plus: '90+ วัน',
};

export default function AgingReportPage() {
  const [asOf, setAsOf] = useState<Date>(new Date());
  const query = useQuery({
    queryKey: ['aging', asOf.toISOString()],
    queryFn: () => api.get<AgingData>(`/accounting/ledger/aging?asOf=${asOf.toISOString()}`).then((r) => r.data),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="รายงานลูกหนี้ + วิเคราะห์อายุหนี้ (Aging)" icon={AlertTriangle} />
      <Card>
        <CardHeader><ThaiDateInput value={asOf} onChange={setAsOf} label="ณ วันที่" /></CardHeader>
        <CardContent>
          <QueryBoundary query={query}>
            {(data) => (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                  {(['bucket_0_30', 'bucket_31_60', 'bucket_61_90', 'bucket_90_plus'] as const).map((b) => (
                    <Card key={b} className={BUCKET_COLORS[b]}>
                      <CardContent className="p-4">
                        <div className="text-xs font-medium opacity-80">{BUCKET_LABELS[b]}</div>
                        <div className="text-xl font-bold mt-1 font-mono">{formatTHB(data.summary[b])}</div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ลูกค้า</TableHead>
                      <TableHead>โทรศัพท์</TableHead>
                      <TableHead className="text-right">วันค้าง</TableHead>
                      <TableHead className="text-right">ยอดค้างชำระ</TableHead>
                      <TableHead>กลุ่ม</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.customers.map((c) => (
                      <TableRow key={c.customerId}>
                        <TableCell><Link to={`/customers/${c.customerId}`} className="text-primary hover:underline">{c.customerName}</Link></TableCell>
                        <TableCell className="font-mono text-sm">{c.phone}</TableCell>
                        <TableCell className="text-right">{c.daysOverdue}</TableCell>
                        <TableCell className="text-right font-mono">{formatTHB(c.totalOverdue)}</TableCell>
                        <TableCell><span className={`px-2 py-0.5 rounded text-xs ${BUCKET_COLORS[c.bucket]}`}>{BUCKET_LABELS[c.bucket]}</span></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </QueryBoundary>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 9.2: Write smoke test**

```tsx
// apps/web/src/pages/finance/__tests__/AgingReportPage.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import AgingReportPage from '../AgingReportPage';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: {
    asOf: '2026-05-19',
    summary: { bucket_0_30: 1000, bucket_31_60: 2000, bucket_61_90: 3000, bucket_90_plus: 4000 },
    customers: [{ customerId: 'c1', customerName: 'นาย ก', phone: '0812345678', totalOverdue: 5000, daysOverdue: 45, bucket: 'bucket_31_60', contracts: 1 }],
  } }) },
}));

describe('AgingReportPage', () => {
  it('renders 4 bucket cards + customer row', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter><AgingReportPage /></MemoryRouter></QueryClientProvider>);
    await waitFor(() => expect(screen.getByText('นาย ก')).toBeInTheDocument());
    expect(screen.getByText('0-30 วัน')).toBeInTheDocument();
    expect(screen.getByText('31-60 วัน')).toBeInTheDocument();
    expect(screen.getByText('61-90 วัน')).toBeInTheDocument();
    expect(screen.getByText('90+ วัน')).toBeInTheDocument();
  });
});
```

- [ ] **Step 9.3: Run test + verify pass**

`cd apps/web && npx vitest run src/pages/finance/__tests__/AgingReportPage.test.tsx`
Expected: PASS

- [ ] **Step 9.4: Wire route + remove placeholder + commit**

```bash
git add apps/web/src/{pages/finance/AgingReportPage.tsx,pages/finance/__tests__/AgingReportPage.test.tsx,App.tsx,config/menu.ts}
git commit -m "feat(p4-sp1): AgingReportPage — 4-bucket summary + customer drill-down"
```

---

## Task 10: Frontend — BadDebtReportPage

**Files:**
- Create: `apps/web/src/pages/finance/BadDebtReportPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/config/menu.ts`

- [ ] **Step 10.1: Create page**

```tsx
// apps/web/src/pages/finance/BadDebtReportPage.tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { TrendingDown } from 'lucide-react';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { formatTHB, formatDateMedium } from '@/utils/formatters';

interface BadDebtEntry { journalEntryId: string; documentNumber: string; postedAt: string; description: string; amount: number; sourceType: string; sourceId: string; }
interface BadDebtData { period: { start: string; end: string }; totalBadDebt: number; entries: BadDebtEntry[]; }

export default function BadDebtReportPage() {
  const [start, setStart] = useState<Date>(new Date(new Date().getFullYear(), 0, 1));
  const [end, setEnd] = useState<Date>(new Date());

  const query = useQuery({
    queryKey: ['bad-debt-report', start.toISOString(), end.toISOString()],
    queryFn: () => api.get<BadDebtData>(`/accounting/ledger/bad-debt?start=${start.toISOString()}&end=${end.toISOString()}`).then((r) => r.data),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="รายงานหนี้สูญ" icon={TrendingDown} />
      <Card>
        <CardHeader className="flex flex-row gap-4 items-end">
          <ThaiDateInput value={start} onChange={setStart} label="ตั้งแต่" />
          <ThaiDateInput value={end} onChange={setEnd} label="ถึง" />
        </CardHeader>
        <CardContent>
          <QueryBoundary query={query}>
            {(data) => (
              <>
                <Card className="bg-red-500/10 mb-4">
                  <CardContent className="p-4">
                    <div className="text-sm font-medium text-red-700 dark:text-red-400">หนี้สูญ/ขาดทุนจากยึดเครื่อง รวมงวด</div>
                    <div className="text-2xl font-bold mt-1 font-mono text-red-700 dark:text-red-400">{formatTHB(data.totalBadDebt)}</div>
                  </CardContent>
                </Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>วันที่</TableHead>
                      <TableHead>เลขเอกสาร</TableHead>
                      <TableHead>คำอธิบาย</TableHead>
                      <TableHead>ที่มา</TableHead>
                      <TableHead className="text-right">จำนวน</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.entries.map((e) => (
                      <TableRow key={e.journalEntryId}>
                        <TableCell>{formatDateMedium(e.postedAt)}</TableCell>
                        <TableCell className="font-mono text-xs">{e.documentNumber}</TableCell>
                        <TableCell className="text-sm">{e.description}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{e.sourceType}</TableCell>
                        <TableCell className="text-right font-mono">{formatTHB(e.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </QueryBoundary>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 10.2: Wire route + remove placeholder + commit**

```bash
git add apps/web/src/{pages/finance/BadDebtReportPage.tsx,App.tsx,config/menu.ts}
git commit -m "feat(p4-sp1): BadDebtReportPage — JournalLine 51-1102 viewer"
```

---

## Task 11: Final verification + version bump

- [ ] **Step 11.1: Run all tests**

```bash
cd apps/api && npx jest accounting.service.spec
cd apps/web && npx vitest run src/pages/finance src/config
```

- [ ] **Step 11.2: TypeScript + lint + build**

```bash
cd apps/web && npx tsc --noEmit && npm run lint && npm run build
cd apps/api && npx tsc --noEmit && npm run lint
```

- [ ] **Step 11.3: Bump web version**

Edit `apps/web/package.json`: `"version": "26.5.8"` → `"26.5.9"`

- [ ] **Step 11.4: Commit + PR**

```bash
git add apps/web/package.json
git commit -m "chore: bump web 26.5.8 → 26.5.9 for P4-SP1 deploy"
git push -u origin feat/p4-sp1-financial-reports
gh pr create --base main --title "feat(p4-sp1): งบการเงิน + รายงานบัญชี (7 pages)" --body "..."
```

---

## Acceptance Criteria

- [ ] All 7 menu items no longer show "Coming Soon" — open real pages
- [ ] Each page supports date range (or as-of date) filtering
- [ ] BalanceSheet `totalAssets === totalLiabilitiesEquity` (within 1 baht rounding)
- [ ] CashFlow `beginningCash + netCashChange === endingCash`
- [ ] EquityStatement `totalOpening + netIncome - dividends + other === totalClosing`
- [ ] GeneralJournal pagination works (50/page default)
- [ ] GeneralLedger account dropdown shows all 99 FINANCE accounts; running balance correct
- [ ] AgingReport 4 buckets sum equals total overdue
- [ ] BadDebtReport total matches sum of entries
- [ ] TypeScript: 0 errors
- [ ] Vitest: all new + existing tests pass
- [ ] Jest API: new accounting.service tests pass
- [ ] ESLint: 0 errors
- [ ] Vite build: success
- [ ] Web version bumped (26.5.8 → 26.5.9)
- [ ] Role gating: all 7 routes protected via `OWNER / FINANCE_MANAGER / ACCOUNTANT`

---

## Dependencies

**Provides for SP4 + SP5:**
- `getAgingReport` service → Dashboard widget (SP5) + Inter-co report (SP4) deep-link
- `getGeneralJournal` + `getGeneralLedger` views → Inter-co report drill-down (SP4)

**Depends on:**
- Existing CPA chart of accounts (Phase A.4 — frozen)
- Existing `JournalEntry` / `JournalLine` / `Payment` / `Contract` Prisma models
- Existing `getBalanceSheetFromJournal`, `getProfitLossFromJournal`, controller endpoints for cash-flow / equity-statement / general-ledger

## Estimated Effort

4-5 days of focused work (1 task ≈ 0.5 day average). 11 tasks total, all can be done sequentially or 2-3 parallel for the FE pages.
