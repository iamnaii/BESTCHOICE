# PR-6: Daily Summary — Implementation Plan (Final)

**Goal:** Print-ready "ใบสรุปรายจ่ายประจำวัน" page. Backend aggregates documents for selected date+branch into totals (by type/method/category/cash-account). Frontend renders A4 printable layout + Excel export.

**Architecture:** New backend service method `getDailySummary(date, branchId)` returning `{ documents, byType, byPaymentMethod, byCategory, cashMovement }`. Endpoint `GET /expense-documents/daily-summary`. Frontend `/expenses/daily-summary` page with date+branch selector, table+totals sections, `@media print` CSS for A4, exceljs for Excel.

**Branch:** `feat/expense-documents-pr6` (off `feat/expense-documents-pr5`).

**Spec ref:** §7.2 (Daily Summary).

---

## File Structure

### API
- Modify: `expense-documents.service.ts` — add `getDailySummary()` method
- Modify: `expense-documents.controller.ts` — add `GET /daily-summary` endpoint
- Test: extend service spec

### Web
- Create: `pages/ExpenseDailySummaryPage.tsx` — date selector + render + print + Excel buttons
- Modify: `App.tsx` — add `/expenses/daily-summary` route
- Modify: `pages/ExpensesPage.tsx` — wire `สรุปรายวัน` tab → navigate to new page

---

## Task 1: Backend service + endpoint

**1.1** — Add method to `apps/api/src/modules/expense-documents/expense-documents.service.ts`:

```ts
async getDailySummary(filters: { date: string; branchId?: string }, user: UserContext) {
  const branchId = hasCrossBranchAccess(user) ? filters.branchId : (user.branchId ?? filters.branchId);
  if (!branchId) {
    throw new BadRequestException('ต้องระบุสาขา');
  }
  const start = new Date(filters.date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(filters.date);
  end.setHours(23, 59, 59, 999);

  const documents = await this.prisma.expenseDocument.findMany({
    where: {
      branchId,
      documentDate: { gte: start, lte: end },
      status: { not: 'VOIDED' },
      deletedAt: null,
    },
    include: {
      expenseDetail: true,
      creditNote: true,
      payroll: { include: { lines: true } },
      settlement: { include: { settlementLines: true } },
      branch: { select: { id: true, name: true } },
    },
    orderBy: { number: 'asc' },
  });

  // Aggregate
  const byType: Record<string, { count: number; total: string }> = {};
  const byPaymentMethod: Record<string, { count: number; total: string }> = {};
  const byCategory: Record<string, { count: number; total: string }> = {};
  const cashMovement: Record<string, { out: string; count: number }> = {};

  let grandTotal = new Prisma.Decimal(0);

  for (const d of documents) {
    const total = new Prisma.Decimal(d.totalAmount.toString());
    grandTotal = grandTotal.plus(total);

    // By type
    const tKey = d.documentType;
    const tBucket = byType[tKey] ?? { count: 0, total: '0' };
    tBucket.count++;
    tBucket.total = new Prisma.Decimal(tBucket.total).plus(total).toFixed(2);
    byType[tKey] = tBucket;

    // By payment method (only if doc has paymentMethod set)
    if (d.paymentMethod) {
      const mKey = d.paymentMethod;
      const mBucket = byPaymentMethod[mKey] ?? { count: 0, total: '0' };
      mBucket.count++;
      mBucket.total = new Prisma.Decimal(mBucket.total).plus(d.netPayment ?? total).toFixed(2);
      byPaymentMethod[mKey] = mBucket;
    }

    // By category (EXPENSE only — others have no category)
    const cat = d.expenseDetail?.category ?? d.creditNote?.category;
    if (cat) {
      const cBucket = byCategory[cat] ?? { count: 0, total: '0' };
      cBucket.count++;
      cBucket.total = new Prisma.Decimal(cBucket.total).plus(total).toFixed(2);
      byCategory[cat] = cBucket;
    }

    // Cash movement (only docs with depositAccountCode + paidAt today)
    if (d.depositAccountCode && d.paidAt && d.paidAt >= start && d.paidAt <= end) {
      const aKey = d.depositAccountCode;
      const aBucket = cashMovement[aKey] ?? { out: '0', count: 0 };
      aBucket.out = new Prisma.Decimal(aBucket.out).plus(d.netPayment ?? total).toFixed(2);
      aBucket.count++;
      cashMovement[aKey] = aBucket;
    }
  }

  return {
    date: filters.date,
    branchId,
    branchName: documents[0]?.branch.name ?? null,
    documents,
    grandTotal: grandTotal.toFixed(2),
    byType,
    byPaymentMethod,
    byCategory,
    cashMovement,
  };
}
```

**1.2** — Add endpoint to `apps/api/src/modules/expense-documents/expense-documents.controller.ts`:

```ts
@Get('daily-summary')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
dailySummary(
  @Query('date') date: string,
  @Query('branchId') branchId: string | undefined,
  @CurrentUser() user: { id: string; branchId?: string; role: string },
) {
  return this.service.getDailySummary({ date, branchId }, user);
}
```

NOTE: Place this BEFORE `@Get(':id')` route to avoid Nest matching `:id = daily-summary` literal.

**1.3** — Tests in `apps/api/src/modules/expense-documents/__tests__/expense-documents.service.spec.ts`:

Add `describe('getDailySummary', () => { ... })` with 4 tests:
1. Filters by date + branchId
2. Excludes VOIDED + deleted
3. Aggregates byType correctly
4. Aggregates cashMovement only for docs with paidAt today

Run + commit:
```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api
npx jest --testPathPattern="expense-documents.service.spec" --runInBand 2>&1 | tail -10
git add apps/api/src/modules/expense-documents/
git commit -m "feat(expense-documents): add getDailySummary endpoint"
```

## Task 2: Frontend Daily Summary page

Create `apps/web/src/pages/ExpenseDailySummaryPage.tsx`:

Layout per spec mockup:
- Header: title + date selector (ThaiDateInput) + branch selector + Print button + Excel button
- Section 1: Documents table (zebra rows, monospace number column)
- Section 2: 2-column grid — Totals by type | Totals by payment method
- Section 3: Cash movement (per depositAccountCode)
- Section 4: Signature lines (3 lines: prepared / reviewed / approved)
- Print CSS: `@media print` hides nav/buttons, A4 page-size, signature section forced visible

Key implementation:
```tsx
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router';
import api from '@/lib/api';
import { ArrowLeft, Printer, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { formatNumberDecimal, formatDateShortThai } from '@/utils/formatters';
import { useAuth } from '@/contexts/AuthContext';

interface Summary {
  date: string;
  branchId: string;
  branchName: string | null;
  documents: ExpenseDocument[]; // header + nested detail
  grandTotal: string;
  byType: Record<string, { count: number; total: string }>;
  byPaymentMethod: Record<string, { count: number; total: string }>;
  byCategory: Record<string, { count: number; total: string }>;
  cashMovement: Record<string, { out: string; count: number }>;
}

const TYPE_LABELS: Record<string, string> = {
  EXPENSE: 'รายจ่าย (EX)',
  CREDIT_NOTE: 'ใบลดหนี้ (CN)',
  PAYROLL: 'เงินเดือน (PR)',
  VENDOR_SETTLEMENT: 'จ่ายเจ้าหนี้ (SE)',
};
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนธนาคาร',
  QR_EWALLET: 'QR/E-Wallet',
};

export default function ExpenseDailySummaryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [date, setDate] = useState(searchParams.get('date') ?? new Date().toISOString().slice(0, 10));
  const [branchId, setBranchId] = useState(searchParams.get('branchId') ?? user?.branchId ?? '');

  const { data: branches } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
  });

  const { data: summary, isLoading } = useQuery<Summary>({
    queryKey: ['daily-summary', date, branchId],
    queryFn: async () => (await api.get(`/expense-documents/daily-summary?date=${date}&branchId=${branchId}`)).data,
    enabled: !!branchId && !!date,
  });

  const handlePrint = () => window.print();

  const handleExportExcel = async () => {
    if (!summary) return;
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const sh1 = wb.addWorksheet('รายการเอกสาร');
    sh1.addRow(['เลข', 'ประเภท', 'ผู้ขาย', 'ยอด', 'วิธีจ่าย']);
    summary.documents.forEach((d) => {
      sh1.addRow([d.number, d.documentType, d.vendorName ?? '', d.totalAmount, d.paymentMethod ?? '']);
    });
    const sh2 = wb.addWorksheet('สรุปยอด');
    sh2.addRow(['ตามประเภท', '', '']);
    Object.entries(summary.byType).forEach(([k, v]) => sh2.addRow([TYPE_LABELS[k] ?? k, v.count, v.total]));
    sh2.addRow(['ตามวิธีจ่าย', '', '']);
    Object.entries(summary.byPaymentMethod).forEach(([k, v]) => sh2.addRow([PAYMENT_METHOD_LABELS[k] ?? k, v.count, v.total]));
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daily-summary-${date.replace(/-/g, '')}-${branchId}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* Header — hidden in print */}
      <div className="print:hidden flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/expenses')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> กลับ
          </button>
          <h1 className="text-base font-semibold">ใบสรุปรายจ่ายประจำวัน</h1>
        </div>
        <div className="flex items-center gap-2">
          <ThaiDateInput value={date} onChange={(e) => setDate(e.target.value)} />
          {branches && branches.length > 1 && (
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="px-3 py-2 border rounded text-sm">
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <Button variant="outline" size="sm" onClick={handlePrint} disabled={!summary}>
            <Printer className="size-4" /> พิมพ์
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={!summary}>
            <FileSpreadsheet className="size-4" /> Excel
          </Button>
        </div>
      </div>

      {/* Print-only header */}
      <div className="hidden print:block mb-4">
        <h1 className="text-lg font-bold text-center">ใบสรุปรายจ่ายประจำวัน</h1>
        <div className="text-center text-sm">วันที่ {formatDateShortThai(date)} · สาขา {summary?.branchName ?? '-'}</div>
        <div className="text-center text-xs text-muted-foreground">ผู้จัดทำ: {user?.name ?? '-'}</div>
      </div>

      {isLoading || !summary ? (
        <div className="text-center py-12 text-muted-foreground">กำลังโหลด...</div>
      ) : (
        <div className="space-y-6">
          {/* Documents table */}
          <div className="border rounded-xl overflow-hidden bg-card">
            <div className="px-4 py-3 border-b text-sm font-medium">รายการเอกสาร ({summary.documents.length} รายการ)</div>
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr className="border-b">
                  <th className="text-left p-2">เลข</th>
                  <th className="text-left p-2">ประเภท</th>
                  <th className="text-left p-2">ผู้ขาย</th>
                  <th className="text-left p-2">บัญชี</th>
                  <th className="text-right p-2">ยอด</th>
                  <th className="text-left p-2">จ่ายโดย</th>
                </tr>
              </thead>
              <tbody>
                {summary.documents.map((d) => (
                  <tr key={d.id} className="border-b last:border-0">
                    <td className="p-2 font-mono text-warning">{d.number}</td>
                    <td className="p-2">{TYPE_LABELS[d.documentType]}</td>
                    <td className="p-2">{d.vendorName ?? '–'}</td>
                    <td className="p-2 font-mono text-xs">{d.expenseDetail?.category ?? d.creditNote?.category ?? '-'}</td>
                    <td className="p-2 text-right font-mono">{formatNumberDecimal(d.totalAmount)}</td>
                    <td className="p-2">{d.paymentMethod ? PAYMENT_METHOD_LABELS[d.paymentMethod] : '-'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted font-semibold">
                <tr>
                  <td colSpan={4} className="p-2 text-right">รวมทั้งสิ้น</td>
                  <td className="p-2 text-right font-mono">{formatNumberDecimal(summary.grandTotal)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Totals grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:grid-cols-2">
            <div className="border rounded-xl p-4 bg-card">
              <h3 className="text-sm font-semibold mb-3">รวมตามประเภท</h3>
              <table className="w-full text-sm">
                <tbody>
                  {Object.entries(summary.byType).map(([k, v]) => (
                    <tr key={k} className="border-b last:border-0">
                      <td className="py-1.5">{TYPE_LABELS[k] ?? k}</td>
                      <td className="py-1.5 text-right text-muted-foreground">{v.count} รายการ</td>
                      <td className="py-1.5 text-right font-mono">{formatNumberDecimal(v.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border rounded-xl p-4 bg-card">
              <h3 className="text-sm font-semibold mb-3">รวมตามวิธีจ่าย</h3>
              <table className="w-full text-sm">
                <tbody>
                  {Object.entries(summary.byPaymentMethod).map(([k, v]) => (
                    <tr key={k} className="border-b last:border-0">
                      <td className="py-1.5">{PAYMENT_METHOD_LABELS[k] ?? k}</td>
                      <td className="py-1.5 text-right text-muted-foreground">{v.count} รายการ</td>
                      <td className="py-1.5 text-right font-mono">{formatNumberDecimal(v.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Cash movement */}
          {Object.keys(summary.cashMovement).length > 0 && (
            <div className="border rounded-xl p-4 bg-card">
              <h3 className="text-sm font-semibold mb-3">เงินสด/ธนาคาร เคลื่อนไหววันนี้</h3>
              <table className="w-full text-sm">
                <tbody>
                  {Object.entries(summary.cashMovement).map(([k, v]) => (
                    <tr key={k} className="border-b last:border-0">
                      <td className="py-1.5 font-mono text-xs">{k}</td>
                      <td className="py-1.5 text-right text-muted-foreground">ออก {v.count} ครั้ง</td>
                      <td className="py-1.5 text-right font-mono text-destructive">({formatNumberDecimal(v.out)})</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Signature footer (visible in print) */}
          <div className="grid grid-cols-3 gap-8 mt-12 pt-8 print:mt-12 print:pt-8 text-sm">
            <div className="text-center">
              <div className="border-t border-foreground pt-2">ผู้จัดทำ</div>
              <div className="text-xs text-muted-foreground mt-1">{user?.name ?? ''}</div>
            </div>
            <div className="text-center">
              <div className="border-t border-foreground pt-2">ผู้ตรวจสอบ</div>
            </div>
            <div className="text-center">
              <div className="border-t border-foreground pt-2">ผู้อนุมัติ</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

Add print CSS to global stylesheet (or inline `<style>` in this page):

```css
@media print {
  @page { size: A4; margin: 1cm; }
  body { font-family: 'IBM Plex Sans Thai', sans-serif; font-size: 10pt; }
  /* Tailwind handles print:hidden */
}
```

(Use Tailwind `print:hidden` + `print:block` utilities; @page rules belong in `index.css` if not already present.)

## Task 3: Wire `สรุปรายวัน` tab + add route

In `apps/web/src/App.tsx` add:
```ts
const ExpenseDailySummaryPage = lazy(() => import('@/pages/ExpenseDailySummaryPage'));
```

Route:
```tsx
<Route path="/expenses/daily-summary" element={<ProtectedRoute><MainLayout><ExpenseDailySummaryPage /></MainLayout></ProtectedRoute>} />
```

In `apps/web/src/pages/ExpensesPage.tsx`, find the tabs render and update the onClick:
```tsx
onClick={() => {
  if (tab.id === 'favorites') {
    navigate('/expenses/favorites');
    return;
  }
  if (tab.id === 'daily-summary') {
    navigate('/expenses/daily-summary');
    return;
  }
  if (isAction) return;
  setTab(tab.id);
}}
```

## Task 4: Verify + push + PR

```bash
./tools/check-types.sh all
git push -u origin feat/expense-documents-pr6
gh pr create --base feat/expense-documents-pr5 --title "PR-6: Daily Summary (final PR)"
```

---

## Self-Review

- §7.2 backend aggregation ✅, frontend layout ✅, print + Excel ✅
- Cash movement only counted when paidAt is within day range
- All branches with multiple branches get selector

## Out of scope

- PDF export (CSS print is sufficient — A4 layout)
- Cross-module daily summary (incl. RT/OI income) — Phase A.7
- Multi-branch consolidated view
