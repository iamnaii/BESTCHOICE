# P4-SP5: Dashboard FINANCE Widgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Add 3 FINANCE-context widgets to the Dashboard (`/`): Aging summary, "ติดตามหนี้วันนี้" alert, new/expiring contracts. Only visible when `currentZone === 'fin'`.

**Architecture:** Reuses P4-SP1's `getAgingReport` + existing `PromiseSlot` and `Contract` data. Pure FE work — backend already provides data via SP1 + existing endpoints. Widgets render conditionally via `useLayout().currentZone === 'fin'`.

**Tech Stack:** React + @tanstack/react-query + shadcn/ui Card + lucide-react

**Dependency:** Wait for **P4-SP1** to ship the `/accounting/ledger/aging` endpoint. Other 2 widgets use existing data.

---

## File Structure

**Frontend:**
- Create: `apps/web/src/pages/dashboard/widgets/AgingSummaryWidget.tsx`
- Create: `apps/web/src/pages/dashboard/widgets/PromiseDueTodayWidget.tsx`
- Create: `apps/web/src/pages/dashboard/widgets/ContractMilestonesWidget.tsx`
- Modify: `apps/web/src/pages/Dashboard.tsx` (or wherever Dashboard widgets live) — render 3 widgets conditionally

**Backend (1 new endpoint for promise-due-today):**
- Modify: `apps/api/src/modules/overdue/promise.service.ts` — add `getPromisesDueToday()`
- Modify: `apps/api/src/modules/overdue/promise.controller.ts` — expose endpoint

---

## Task 1: Backend — getPromisesDueToday

**Files:**
- Modify: `apps/api/src/modules/overdue/promise.service.ts`
- Modify: `apps/api/src/modules/overdue/promise.controller.ts`

- [ ] **Step 1.1: Add service method**

```typescript
// promise.service.ts
async getPromisesDueToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const slots = await this.prisma.promiseSlot.findMany({
    where: {
      settlementDate: { gte: today, lt: tomorrow },
      keptAt: null,
      brokenAt: null,
      callLog: {
        canceledAt: null,
        supersededAt: null,
        deletedAt: null,
      },
    },
    include: {
      callLog: {
        include: {
          contract: { include: { customer: { select: { id: true, firstName: true, lastName: true, phone: true } } } },
        },
      },
    },
    orderBy: { settlementDate: 'asc' },
  });

  return slots.map((s) => ({
    promiseSlotId: s.id,
    contractId: s.callLog.contractId,
    contractNumber: s.callLog.contract.contractNumber,
    customerId: s.callLog.contract.customer.id,
    customerName: `${s.callLog.contract.customer.firstName} ${s.callLog.contract.customer.lastName}`,
    phone: s.callLog.contract.customer.phone ?? '',
    settlementAmount: Number(s.settlementAmount),
    callLogId: s.callLogId,
  }));
}
```

- [ ] **Step 1.2: Add endpoint**

```typescript
// promise.controller.ts
@Get('promises/due-today')
@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER')
getPromisesDueToday() {
  return this.service.getPromisesDueToday();
}
```

- [ ] **Step 1.3: Commit**

```bash
git add apps/api/src/modules/overdue/promise.{service,controller}.ts
git commit -m "feat(p4-sp5): /overdue/promises/due-today endpoint"
```

---

## Task 2: Frontend — AgingSummaryWidget

**Files:**
- Create: `apps/web/src/pages/dashboard/widgets/AgingSummaryWidget.tsx`

- [ ] **Step 2.1: Create widget**

```tsx
// apps/web/src/pages/dashboard/widgets/AgingSummaryWidget.tsx
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Link } from 'react-router';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { formatTHB } from '@/utils/formatters';

interface AgingSummary { summary: { bucket_0_30: number; bucket_31_60: number; bucket_61_90: number; bucket_90_plus: number } }

const BUCKETS: { key: keyof AgingSummary['summary']; label: string; color: string }[] = [
  { key: 'bucket_0_30', label: '0-30 วัน', color: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  { key: 'bucket_31_60', label: '31-60 วัน', color: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400' },
  { key: 'bucket_61_90', label: '61-90 วัน', color: 'bg-orange-500/10 text-orange-700 dark:text-orange-400' },
  { key: 'bucket_90_plus', label: '90+ วัน', color: 'bg-red-500/10 text-red-700 dark:text-red-400' },
];

export function AgingSummaryWidget() {
  const query = useQuery({
    queryKey: ['dashboard-aging-summary'],
    queryFn: () => api.get<AgingSummary>(`/accounting/ledger/aging?asOf=${new Date().toISOString()}`).then((r) => r.data),
    refetchInterval: 5 * 60 * 1000, // 5 min
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <h3 className="font-semibold flex items-center gap-2"><AlertTriangle className="size-4 text-amber-500" />ลูกหนี้ค้างชำระ (Aging)</h3>
        <Link to="/finance/aging-report" className="text-xs text-primary hover:underline flex items-center gap-1">ดูเต็ม <ExternalLink className="size-3" /></Link>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2">
        {query.isLoading ? <div className="col-span-2 text-sm text-muted-foreground">กำลังโหลด...</div>
          : query.isError ? <div className="col-span-2 text-sm text-destructive">โหลดข้อมูลไม่ได้</div>
          : BUCKETS.map((b) => (
            <div key={b.key} className={`rounded-lg p-3 ${b.color}`}>
              <div className="text-xs font-medium opacity-80">{b.label}</div>
              <div className="text-base font-bold font-mono mt-0.5">{formatTHB(query.data!.summary[b.key])}</div>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2.2: Commit**

```bash
git add apps/web/src/pages/dashboard/widgets/AgingSummaryWidget.tsx
git commit -m "feat(p4-sp5): AgingSummaryWidget — 4-bucket card + drill-down link"
```

---

## Task 3: Frontend — PromiseDueTodayWidget

**Files:**
- Create: `apps/web/src/pages/dashboard/widgets/PromiseDueTodayWidget.tsx`

- [ ] **Step 3.1: Create widget**

```tsx
// apps/web/src/pages/dashboard/widgets/PromiseDueTodayWidget.tsx
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Link } from 'react-router';
import { Bell, Phone, ExternalLink } from 'lucide-react';
import { formatTHB } from '@/utils/formatters';

interface PromiseDue { promiseSlotId: string; contractId: string; contractNumber: string; customerId: string; customerName: string; phone: string; settlementAmount: number; }

export function PromiseDueTodayWidget() {
  const query = useQuery({
    queryKey: ['dashboard-promises-due-today'],
    queryFn: () => api.get<PromiseDue[]>('/overdue/promises/due-today').then((r) => r.data),
    refetchInterval: 5 * 60 * 1000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <h3 className="font-semibold flex items-center gap-2"><Bell className="size-4 text-amber-500" />ติดตามหนี้วันนี้</h3>
        <Link to="/overdue" className="text-xs text-primary hover:underline flex items-center gap-1">ดูทั้งหมด <ExternalLink className="size-3" /></Link>
      </CardHeader>
      <CardContent>
        {query.isLoading ? <div className="text-sm text-muted-foreground">กำลังโหลด...</div>
          : query.isError ? <div className="text-sm text-destructive">โหลดข้อมูลไม่ได้</div>
          : query.data!.length === 0 ? <div className="text-sm text-muted-foreground text-center py-4">ไม่มีนัดวันนี้</div>
          : (
            <div className="space-y-2 max-h-[260px] overflow-auto">
              {query.data!.map((p) => (
                <Link key={p.promiseSlotId} to={`/contracts/${p.contractId}`} className="flex items-center justify-between p-2 rounded-md hover:bg-accent/50">
                  <div>
                    <div className="text-sm font-medium">{p.customerName}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2"><Phone className="size-3" />{p.phone} · {p.contractNumber}</div>
                  </div>
                  <div className="text-sm font-mono font-semibold text-amber-600 dark:text-amber-400">{formatTHB(p.settlementAmount)}</div>
                </Link>
              ))}
            </div>
          )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3.2: Commit**

```bash
git add apps/web/src/pages/dashboard/widgets/PromiseDueTodayWidget.tsx
git commit -m "feat(p4-sp5): PromiseDueTodayWidget — list with drill-down"
```

---

## Task 4: Frontend — ContractMilestonesWidget

**Files:**
- Create: `apps/web/src/pages/dashboard/widgets/ContractMilestonesWidget.tsx`

- [ ] **Step 4.1: Create widget**

```tsx
// apps/web/src/pages/dashboard/widgets/ContractMilestonesWidget.tsx
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { FileCheck, Sparkles, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router';
import { formatTHB } from '@/utils/formatters';

interface MilestoneSummary {
  newThisMonth: { count: number; totalGross: number };
  completingThisMonth: { count: number; totalGross: number };
  recentNewContracts: { id: string; contractNumber: string; customerName: string; grossAmount: number; activatedAt: string }[];
  finalInstallmentsThisMonth: { contractId: string; contractNumber: string; customerName: string; remainingAmount: number; dueDate: string }[];
}

export function ContractMilestonesWidget() {
  const query = useQuery({
    queryKey: ['dashboard-contract-milestones'],
    queryFn: () => api.get<MilestoneSummary>('/contracts/milestones-summary').then((r) => r.data),
    refetchInterval: 10 * 60 * 1000,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <h3 className="font-semibold flex items-center gap-2"><FileCheck className="size-4 text-primary" />สัญญาเดือนนี้</h3>
      </CardHeader>
      <CardContent>
        {query.isLoading ? <div className="text-sm text-muted-foreground">กำลังโหลด...</div>
          : query.isError ? <div className="text-sm text-destructive">โหลดข้อมูลไม่ได้</div>
          : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg p-3 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                  <div className="text-xs flex items-center gap-1"><Sparkles className="size-3" />เปิดใหม่</div>
                  <div className="text-lg font-bold">{query.data!.newThisMonth.count} สัญญา</div>
                  <div className="text-xs font-mono">{formatTHB(query.data!.newThisMonth.totalGross)}</div>
                </div>
                <div className="rounded-lg p-3 bg-blue-500/10 text-blue-700 dark:text-blue-400">
                  <div className="text-xs flex items-center gap-1"><CheckCircle2 className="size-3" />ครบกำหนด</div>
                  <div className="text-lg font-bold">{query.data!.completingThisMonth.count} สัญญา</div>
                  <div className="text-xs font-mono">{formatTHB(query.data!.completingThisMonth.totalGross)}</div>
                </div>
              </div>
              {query.data!.finalInstallmentsThisMonth.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">งวดสุดท้ายเดือนนี้</div>
                  <div className="space-y-1 max-h-[120px] overflow-auto">
                    {query.data!.finalInstallmentsThisMonth.slice(0, 5).map((c) => (
                      <Link key={c.contractId} to={`/contracts/${c.contractId}`} className="flex items-center justify-between p-1.5 rounded text-sm hover:bg-accent/50">
                        <span>{c.customerName} · {c.contractNumber}</span>
                        <span className="font-mono text-xs">{formatTHB(c.remainingAmount)}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4.2: Commit**

```bash
git add apps/web/src/pages/dashboard/widgets/ContractMilestonesWidget.tsx
git commit -m "feat(p4-sp5): ContractMilestonesWidget — new/completing contracts this month"
```

---

## Task 5: Backend — `/contracts/milestones-summary` endpoint

**Files:**
- Modify: `apps/api/src/modules/contracts/contracts.service.ts`
- Modify: `apps/api/src/modules/contracts/contracts.controller.ts`

- [ ] **Step 5.1: Add service method**

```typescript
async getMilestonesSummary() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const [newContracts, completingContracts, recentNew, finalInstallments] = await Promise.all([
    this.prisma.contract.aggregate({
      where: { activatedAt: { gte: monthStart, lte: monthEnd }, deletedAt: null },
      _count: true,
      _sum: { grossAmount: true },
    }),
    // Contracts whose last installment falls within this month
    this.prisma.contract.findMany({
      where: {
        payments: { some: { dueDate: { gte: monthStart, lte: monthEnd } } },
        status: 'ACTIVE',
        deletedAt: null,
      },
      include: { payments: { orderBy: { dueDate: 'desc' }, take: 1 } },
    }).then((contracts) => contracts.filter((c) => {
      const last = c.payments[0];
      return last && last.dueDate >= monthStart && last.dueDate <= monthEnd;
    })),
    this.prisma.contract.findMany({
      where: { activatedAt: { gte: monthStart, lte: monthEnd }, deletedAt: null },
      include: { customer: { select: { firstName: true, lastName: true } } },
      orderBy: { activatedAt: 'desc' },
      take: 5,
    }),
    this.prisma.payment.findMany({
      where: { dueDate: { gte: monthStart, lte: monthEnd }, status: { in: ['PENDING', 'OVERDUE'] }, deletedAt: null },
      include: { contract: { include: { customer: { select: { firstName: true, lastName: true } } } } },
      orderBy: { dueDate: 'asc' },
      take: 20,
    }),
  ]);

  // Filter finalInstallments to only the LAST installment per contract
  const lastByContract = new Map<string, typeof finalInstallments[number]>();
  for (const p of finalInstallments) {
    const existing = lastByContract.get(p.contractId);
    if (!existing || p.dueDate > existing.dueDate) lastByContract.set(p.contractId, p);
  }

  return {
    newThisMonth: {
      count: newContracts._count ?? 0,
      totalGross: Number(newContracts._sum.grossAmount ?? 0),
    },
    completingThisMonth: {
      count: completingContracts.length,
      totalGross: completingContracts.reduce((s, c) => s + Number(c.grossAmount ?? 0), 0),
    },
    recentNewContracts: recentNew.map((c) => ({
      id: c.id,
      contractNumber: c.contractNumber,
      customerName: `${c.customer.firstName} ${c.customer.lastName}`,
      grossAmount: Number(c.grossAmount ?? 0),
      activatedAt: c.activatedAt,
    })),
    finalInstallmentsThisMonth: Array.from(lastByContract.values()).map((p) => ({
      contractId: p.contractId,
      contractNumber: p.contract.contractNumber,
      customerName: `${p.contract.customer.firstName} ${p.contract.customer.lastName}`,
      remainingAmount: Number(p.amount) - Number(p.paidAmount ?? 0),
      dueDate: p.dueDate,
    })),
  };
}
```

- [ ] **Step 5.2: Add controller endpoint**

```typescript
@Get('milestones-summary')
@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER')
getMilestonesSummary() {
  return this.service.getMilestonesSummary();
}
```

- [ ] **Step 5.3: Commit**

```bash
git add apps/api/src/modules/contracts/contracts.{service,controller}.ts
git commit -m "feat(p4-sp5): /contracts/milestones-summary — new + completing this month"
```

---

## Task 6: Wire widgets into Dashboard

**Files:**
- Modify: `apps/web/src/pages/Dashboard.tsx` (or whatever file owns the Dashboard layout)

- [ ] **Step 6.1: Render widgets conditionally**

```tsx
// In Dashboard.tsx — assuming useLayout exposes currentZone
import { useLayout } from '@/components/layout/LayoutContext';
import { AgingSummaryWidget } from './dashboard/widgets/AgingSummaryWidget';
import { PromiseDueTodayWidget } from './dashboard/widgets/PromiseDueTodayWidget';
import { ContractMilestonesWidget } from './dashboard/widgets/ContractMilestonesWidget';

// Inside Dashboard component:
const { currentZone } = useLayout();

// Add FIN-zone widget block:
{currentZone === 'fin' && (
  <div className="grid md:grid-cols-3 gap-4 mt-6">
    <AgingSummaryWidget />
    <PromiseDueTodayWidget />
    <ContractMilestonesWidget />
  </div>
)}
```

Position after the existing tile grid but before any SHOP-specific blocks.

- [ ] **Step 6.2: Commit**

```bash
git add apps/web/src/pages/Dashboard.tsx
git commit -m "feat(p4-sp5): wire 3 FIN-zone widgets into Dashboard"
```

---

## Task 7: Final verification + version bump

- [ ] **Step 7.1: Tests**

```bash
cd apps/api && npx jest promise.service contracts.service
cd apps/web && npx tsc --noEmit && npm run lint && npm run build && npx vitest run
```

- [ ] **Step 7.2: Bump web version + PR**

```bash
git commit -am "chore: bump web for P4-SP5 deploy"
gh pr create --base main --title "feat(p4-sp5): Dashboard FINANCE widgets (3 cards)"
```

---

## Acceptance Criteria

- [ ] Dashboard shows 3 widgets ONLY when `currentZone === 'fin'`
- [ ] AgingSummaryWidget: 4 buckets visible, drill-down link to /finance/aging-report
- [ ] PromiseDueTodayWidget: lists today's promises; empty-state when none
- [ ] ContractMilestonesWidget: shows new + completing counts + final-installments list
- [ ] All widgets refetch every 5-10 min (refetchInterval)
- [ ] Clicking customer/contract links drills down to detail page
- [ ] TypeScript: 0 errors · Build: success
- [ ] Web version bumped

---

## Dependencies

**Depends on:**
- P4-SP1's `/accounting/ledger/aging` endpoint (must ship first)
- Existing `PromiseSlot`, `Contract`, `Payment` Prisma models
- Existing `useLayout` hook (provides `currentZone`)

**Provides:**
- Nothing — terminal SP for Phase 4

## Estimated Effort

1-2 days. 7 tasks. Backend is small (2 small endpoints); FE is widget composition.
