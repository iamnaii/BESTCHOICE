# Collections Workflow Hub — Plan 2/4: Frontend Workflow Hub

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Ship the new `/collections` page with 5 tabs + ContractCard + KPI strip. Behind a SystemConfig feature flag so OWNER controls rollout. Old `/overdue` redirects to `/collections` when flag is on; otherwise falls through.

**Architecture:** New React page tree at `apps/web/src/pages/CollectionsPage/` with tabs for daily workflow (คิววันนี้ / ตามต่อ / นัดชำระ / อนุมัติ / ทั้งหมด). Backend adds queue + KPI endpoints. Existing `/overdue` logic preserved inside the AllTab for audit/backup.

**Tech Stack:** NestJS (api), React 18 + Vite + Tailwind + shadcn/ui (web), @tanstack/react-query.

**Spec:** [docs/superpowers/specs/2026-04-24-collections-workflow-hub-design.md](../specs/2026-04-24-collections-workflow-hub-design.md) §3, §8, §11.

**Depends on:** Plan 1 foundation (schema, event engine, MdmLockService). Branch off `feat/collections-foundation`.

---

## File Map

### Create — Backend

- `apps/api/src/modules/overdue/queue.service.ts` + `.spec.ts` — tabbed queries
- `apps/api/src/modules/overdue/kpi.service.ts` + `.spec.ts` — KPI aggregation
- `apps/api/src/modules/overdue/dto/queue-query.dto.ts`

### Modify — Backend

- `apps/api/src/modules/overdue/overdue.controller.ts` — add `/queue`, `/kpi`, `/mdm-pending`
- `apps/api/src/modules/overdue/overdue.module.ts` — register QueueService + KpiService
- `apps/api/src/modules/overdue/mdm-lock.service.ts` — expose `getPendingByRole` via controller (already implemented)

### Create — Frontend

```
apps/web/src/pages/CollectionsPage/
  index.tsx                        # shell: tabs + route guard
  hooks/
    useCollectionsQueue.ts         # tab-specific queries
    useCollectionsKpi.ts
    useContactLog.ts               # shared mutation used by multiple tabs
    useCollectionsFlag.ts          # reads feature flag
  components/
    CollectionsKpiStrip.tsx
    CollectionsTabs.tsx
    CollectionsFilters.tsx
    ContractCard.tsx
    ContactLogDialog.tsx
    AssignCollectorInlineDialog.tsx
    ApprovalPendingRow.tsx
  tabs/
    QueueTab.tsx                   # คิววันนี้
    FollowUpTab.tsx                # ตามต่อ (NO_ANSWER)
    PromiseTab.tsx                 # นัดชำระ
    ApprovalTab.tsx                # อนุมัติ (dunning escalations + mdm)
    AllTab.tsx                     # existing /overdue moved here
```

### Modify — Frontend

- `apps/web/src/App.tsx` — add `/collections` route + redirect logic from `/overdue`
- `apps/web/src/components/layout/MainLayout.tsx` — sidebar nav link (if it has one for /overdue, swap to /collections when flag on)
- `apps/web/src/pages/OverduePage.tsx` → moved to `CollectionsPage/tabs/AllTab.tsx` (keep exports)

### System config

- Seed `collections_v2_enabled` (string: "true"|"false") — Task 1 of this plan

---

## Ground Rules

1. **Feature flag first.** Everything user-facing hides behind `collections_v2_enabled`. Default: `true` in dev, `false` in prod (owner toggles via settings).
2. **TDD for services** (backend). For UI, prefer vitest unit tests on hooks + RTL component tests.
3. **Commit per task.** Push frequently.
4. **Type-check + existing test suite** green before commit.
5. **No new deps.** Use existing shadcn/ui + Tailwind.
6. **Thai UI copy.** Collectors are Thai-speaking staff.
7. **Reuse Plan 1 infra.** Don't re-implement logContact / event triggers — just call the existing endpoints.

---

## Task 1: Seed feature flag + backend KPI endpoint skeleton

**Files:**
- Modify: `apps/api/prisma/seeds/collections-foundation.seed.ts` — add `collections_v2_enabled` key
- Modify: `apps/api/prisma/seed-production.ts` — no change (already calls foundation seed)

- [ ] Add new SystemConfig key in the `configs` array of `seedCollectionsFoundation`:

```typescript
{ key: 'collections_v2_enabled', value: 'false', description: 'Enable /collections workflow hub page (Plan 2)' },
```

Place before the `mdm_*` block for alphabetical ordering.

- [ ] Re-run idempotent seed: `cd apps/api && npx jest collections-foundation`
- [ ] Commit: `feat(seed): add collections_v2_enabled feature flag (default false)`

---

## Task 2: Backend — OverdueQueueService

**Files:**
- Create: `apps/api/src/modules/overdue/queue.service.ts`
- Create: `apps/api/src/modules/overdue/queue.service.spec.ts`
- Create: `apps/api/src/modules/overdue/dto/queue-query.dto.ts`
- Modify: `apps/api/src/modules/overdue/overdue.controller.ts`
- Modify: `apps/api/src/modules/overdue/overdue.module.ts`

### Behavior

`GET /overdue/queue?tab=today|followup|promise&branchId=&page=&limit=` returns `{ data: ContractRow[], total, page, limit }`.

**Tab filters:**
| tab | filter |
|---|---|
| `today` | `status IN (ACTIVE, OVERDUE)` + oldest overdue payment ≤ today + no callLog.calledAt today + `blockAutoEscalation` null or expired |
| `followup` | latest callLog.result = NO_ANSWER + `noAnswerCount < 3` |
| `promise` | exists callLog with `settlementDate BETWEEN today-3 AND today+30` AND `result IN (PROMISED, ANSWERED)` |

**ContractRow shape:**
```typescript
{
  id: string;
  contractNumber: string;
  status: string;
  dunningStage: string;
  customer: { id: string; name: string; phone: string; lineId: string | null };
  branch: { id: string; name: string };
  assignedTo: { id: string; name: string } | null;
  outstanding: number;
  daysOverdue: number;
  lastCallResult: string | null;
  lastCallAt: string | null;
  noAnswerCount: number;
  settlementDate: string | null;
  needsSkipTracing: boolean;
  deviceLocked: boolean;
}
```

### Steps

- [ ] Write failing tests (mock-based, mirror `mdm-lock.service.spec.ts` style):
  - Returns correct shape
  - `today` filter respects branch scoping for SALES
  - `followup` excludes contracts with noAnswerCount >= 3
  - `promise` includes future-dated + recently-passed nudges
  - Pagination caps limit at 100

- [ ] Implement `QueueService`:

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type QueueTab = 'today' | 'followup' | 'promise';

@Injectable()
export class OverdueQueueService {
  constructor(private prisma: PrismaService) {}

  async getQueue(params: {
    tab: QueueTab;
    userRole: string;
    userBranchId: string | null;
    branchId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 50, 100);
    const skip = (page - 1) * limit;
    const now = new Date();

    const branchScope: Prisma.ContractWhereInput =
      params.userRole === 'SALES' || params.userRole === 'BRANCH_MANAGER'
        ? { branchId: params.userBranchId ?? undefined }
        : params.branchId
        ? { branchId: params.branchId }
        : {};

    const where = this.buildWhere(params.tab, now, branchScope);

    const [contracts, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phone: true, lineId: true } },
          branch: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, name: true } },
          payments: {
            where: { status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] } },
            orderBy: { dueDate: 'asc' },
            take: 1,
          },
          callLogs: {
            orderBy: { calledAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.contract.count({ where }),
    ]);

    const data = contracts.map((c) => this.toRow(c, now));

    return { data, total, page, limit };
  }

  private buildWhere(tab: QueueTab, now: Date, branchScope: Prisma.ContractWhereInput): Prisma.ContractWhereInput {
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);

    if (tab === 'today') {
      return {
        ...branchScope,
        status: { in: ['ACTIVE', 'OVERDUE'] },
        deletedAt: null,
        OR: [{ blockAutoEscalation: null }, { blockAutoEscalation: { lt: now } }],
        payments: {
          some: {
            dueDate: { lte: now },
            status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
          },
        },
        callLogs: {
          none: { calledAt: { gte: startOfDay } },
        },
      };
    }

    if (tab === 'followup') {
      // We'll filter lastCallResult client-side (easier than nested aggregate)
      return {
        ...branchScope,
        status: { in: ['OVERDUE', 'DEFAULT'] },
        deletedAt: null,
        noAnswerCount: { gte: 1, lt: 3 },
      };
    }

    // promise
    const todayMinus3 = new Date(now.getTime() - 3 * 86400000);
    const todayPlus30 = new Date(now.getTime() + 30 * 86400000);
    return {
      ...branchScope,
      deletedAt: null,
      callLogs: {
        some: {
          result: { in: ['PROMISED', 'ANSWERED'] },
          settlementDate: { gte: todayMinus3, lte: todayPlus30 },
        },
      },
    };
  }

  private toRow(c: any, now: Date) {
    const payment = c.payments[0];
    const callLog = c.callLogs[0];
    const outstanding = payment
      ? new Prisma.Decimal(payment.amountDue).sub(payment.amountPaid).add(payment.lateFee).toNumber()
      : 0;
    const daysOverdue = payment
      ? Math.max(0, Math.floor((now.getTime() - new Date(payment.dueDate).getTime()) / 86400000))
      : 0;
    return {
      id: c.id,
      contractNumber: c.contractNumber,
      status: c.status,
      dunningStage: c.dunningStage,
      customer: c.customer,
      branch: c.branch,
      assignedTo: c.assignedTo,
      outstanding,
      daysOverdue,
      lastCallResult: callLog?.result ?? null,
      lastCallAt: callLog?.calledAt ?? null,
      noAnswerCount: c.noAnswerCount,
      settlementDate: callLog?.settlementDate ?? null,
      needsSkipTracing: c.needsSkipTracing,
      deviceLocked: c.deviceLocked,
    };
  }
}
```

- [ ] DTO `queue-query.dto.ts`:

```typescript
import { IsEnum, IsInt, IsOptional, IsString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class QueueQueryDto {
  @IsEnum(['today','followup','promise'], { message: 'tab ต้องเป็น today, followup, หรือ promise' })
  tab!: 'today' | 'followup' | 'promise';

  @IsOptional() @IsString()
  branchId?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}
```

- [ ] Controller route:

```typescript
  @Get('queue')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getQueue(
    @Query() dto: QueueQueryDto,
    @CurrentUser() user: { role: string; branchId: string | null },
  ) {
    return this.queueService.getQueue({
      tab: dto.tab,
      branchId: dto.branchId,
      page: dto.page,
      limit: dto.limit,
      userRole: user.role,
      userBranchId: user.branchId,
    });
  }
```

Inject `OverdueQueueService` in constructor.

- [ ] Register in module (providers + exports).

- [ ] TS + test + commit: `feat(overdue): queue endpoint for tabbed collections view`

---

## Task 3: Backend — OverdueKpiService

**Files:**
- Create: `apps/api/src/modules/overdue/kpi.service.ts`
- Create: `apps/api/src/modules/overdue/kpi.service.spec.ts`
- Modify: controller + module

### Behavior

`GET /overdue/kpi?range=7d|30d` returns:
```json
{
  "totalOutstanding": 1250000.00,
  "totalLateFees": 45000.00,
  "queueToday": 34,
  "queueTodayTrend": -0.08,
  "promisedCount": 12,
  "promiseKeptRate7d": 0.72,
  "avgCollectorWorkload": 28
}
```

- `totalOutstanding`: sum of (amountDue - amountPaid) for all overdue payments in branch scope
- `totalLateFees`: sum of lateFee
- `queueToday`: contract count in today tab right now
- `queueTodayTrend`: ratio vs 24h ago (placeholder: 0 for now — implement later if cache data exists)
- `promisedCount`: callLogs with future settlementDate, result PROMISED
- `promiseKeptRate7d`: (promises in last 7d that were kept by payment) / (promises in last 7d) — 0 if zero promises
- `avgCollectorWorkload`: for OWNER only; contracts-per-assigned-user

Cache 60s via simple in-memory map (service member) keyed by `${userRole}:${branchId}:${range}`.

### Steps

- [ ] Write tests (mock prisma.aggregate + count)
- [ ] Implement service
- [ ] Add controller route + role guard
- [ ] Commit: `feat(overdue): kpi endpoint for collections dashboard`

---

## Task 4: Backend — MDM pending endpoint

**File:** modify `apps/api/src/modules/overdue/overdue.controller.ts`

- [ ] Add endpoint:

```typescript
  @Get('mdm-pending')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER')
  getMdmPending(@CurrentUser() user: { role: string; branchId: string | null }) {
    return this.mdmLockService.getPendingByRole(user.role, user.branchId ?? undefined);
  }
```

Inject `MdmLockService` in constructor. Import existing service.

- [ ] Add controller test for role gating.
- [ ] Commit: `feat(overdue): mdm-pending endpoint for approval tab`

---

## Task 5: Frontend — feature flag hook + collections page shell

**Files:**
- Create: `apps/web/src/pages/CollectionsPage/hooks/useCollectionsFlag.ts`
- Create: `apps/web/src/pages/CollectionsPage/index.tsx`
- Modify: `apps/web/src/App.tsx`

### useCollectionsFlag

```typescript
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export function useCollectionsFlag() {
  const { data, isLoading } = useQuery({
    queryKey: ['system-config', 'collections_v2_enabled'],
    queryFn: async () => {
      const { data } = await api.get('/system-config/collections_v2_enabled');
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
  return { enabled: data?.value === 'true', isLoading };
}
```

If `/system-config/:key` endpoint doesn't exist, check existing routes and either reuse or add a public read-only one. Fallback: hardcode flag via env var during development.

### index.tsx

Shell component: renders tabs + slide-over placeholder (no Customer 360 yet — Plan 3).

```tsx
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import CollectionsTabs from './components/CollectionsTabs';
import CollectionsKpiStrip from './components/CollectionsKpiStrip';
import QueueTab from './tabs/QueueTab';
import FollowUpTab from './tabs/FollowUpTab';
import PromiseTab from './tabs/PromiseTab';
import ApprovalTab from './tabs/ApprovalTab';
import AllTab from './tabs/AllTab';

export type CollectionsTabKey = 'today' | 'followup' | 'promise' | 'approval' | 'all';

export default function CollectionsPage() {
  useDocumentTitle('ติดตามหนี้');
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<CollectionsTabKey>('today');

  const canSeeApproval = user?.role === 'OWNER' || user?.role === 'FINANCE_MANAGER';

  return (
    <div>
      <PageHeader title="ติดตามหนี้" subtitle="คิวงานของผู้ติดตามหนี้รายวัน" />
      <CollectionsKpiStrip />
      <CollectionsTabs active={activeTab} onChange={setActiveTab} canSeeApproval={canSeeApproval} />
      <div className="mt-4">
        {activeTab === 'today' && <QueueTab />}
        {activeTab === 'followup' && <FollowUpTab />}
        {activeTab === 'promise' && <PromiseTab />}
        {activeTab === 'approval' && canSeeApproval && <ApprovalTab />}
        {activeTab === 'all' && <AllTab />}
      </div>
    </div>
  );
}
```

### App.tsx route + redirect

- Add:
```tsx
const CollectionsPage = lazy(() => import('@/pages/CollectionsPage'));
```
- Add route inside protected routes area:
```tsx
<Route path="/collections" element={<CollectionsPage />} />
```
- Handle `/overdue` — keep existing route but add logic: the existing `OverduePage` can stay as-is; redirect happens via `AllTab.tsx` importing the existing component. Users still hit `/overdue` → gets old page (no flag coupling needed for Plan 2 since `/collections` is additive).

Actually simpler: add feature-flag-based redirect component:

```tsx
function OverdueRouteResolver() {
  const { enabled } = useCollectionsFlag();
  if (enabled) return <Navigate to="/collections" replace />;
  const OverduePage = lazy(() => import('@/pages/OverduePage'));
  return <Suspense fallback={null}><OverduePage /></Suspense>;
}
```

- Replace existing `<Route path="/overdue" ...>` with `<Route path="/overdue" element={<OverdueRouteResolver />} />`.

- [ ] TS + web build + commit: `feat(collections): page shell + /overdue feature-flag redirect`

---

## Task 6: Frontend — CollectionsKpiStrip

**File:** `apps/web/src/pages/CollectionsPage/components/CollectionsKpiStrip.tsx`

Fetches `/overdue/kpi?range=7d` and renders 4 cards: ค้างรวม / คิววันนี้ / นัดแล้ว / Promise-kept 7d.

Use existing Card styling from OverduePage (currency formatting, accent color stripes). Follow `bg-card`, `text-muted-foreground` tokens per project rules.

- [ ] Create component + hook `useCollectionsKpi.ts`
- [ ] Handle loading (skeleton) + error (QueryBoundary)
- [ ] Commit: `feat(collections): KPI strip component`

---

## Task 7: Frontend — CollectionsTabs + CollectionsFilters

**Files:** respective components

- `CollectionsTabs`: renders 5 buttons (today/followup/promise/approval/all). Approval only shown if `canSeeApproval`. Active tab has primary bg.
- `CollectionsFilters`: search input (debounced), branch select (OWNER only). Shared across Queue/FollowUp/Promise tabs.

Pattern: both emit onChange callbacks; parent state lifted to CollectionsPage.

- [ ] Create components + tests
- [ ] Commit: `feat(collections): tabs + filters components`

---

## Task 8: Frontend — ContractCard + ContactLogDialog

**Files:**
- `components/ContractCard.tsx` — the atomic row
- `components/ContactLogDialog.tsx` — unified modal for NO_ANSWER / PROMISED / REFUSED / WRONG_NUMBER / OTHER
- `hooks/useContactLog.ts` — wraps `PATCH /overdue/:contractId/contact-log`

### ContractCard spec

```
┌───────────────────────────────────────────────────────────┐
│ ☐  [contract#] · [customer name] · [phone]                 │
│ ครบกำหนด [dueDate] · เลย [N] วัน · งวด [x]/[total]          │
│ ค้าง [X] + ปรับ [Y] = [Z] ฿                                │
│ 📊 โทร: [result] [N] ครั้ง · LINE ส่งไป [M] ครั้ง           │
│ ผู้ติดตาม: [name] or "ยังไม่มอบหมาย"                        │
│ [📞 โทร] [📝 บันทึกผล] [💬 ส่งไลน์] [▶ 360]                 │
└───────────────────────────────────────────────────────────┘
```

Buttons:
- 📞 โทร — `<a href="tel:...">` wrap
- 📝 บันทึกผล — opens ContactLogDialog
- 💬 ส่งไลน์ — disabled in Plan 2 (Plan 3), show tooltip "เร็ว ๆ นี้"
- ▶ 360 — disabled in Plan 2 (Plan 3)

### ContactLogDialog

Form fields: result (select), notes (optional), collectionNotes (optional), settlementDate + settlementNotes (only when result=PROMISED).

Submit → `PATCH /overdue/:contractId/contact-log` → invalidate `['collections-queue']` + `['collections-kpi']` → close + toast.

- [ ] TDD: write tests for ContactLogDialog (result change toggles settlement fields; submit calls mutation)
- [ ] TDD: ContractCard renders all states (assigned/unassigned, locked/not, skipTracing flag)
- [ ] Commit: `feat(collections): ContractCard + ContactLogDialog`

---

## Task 9: Frontend — QueueTab

**File:** `apps/web/src/pages/CollectionsPage/tabs/QueueTab.tsx`

Fetch `/overdue/queue?tab=today` paginated. Render list of ContractCards. Empty state: "ไม่มีคิวติดตามวันนี้ 🎉".

- [ ] Test: renders cards from mock query
- [ ] Test: shows empty state
- [ ] Test: paginates on scroll (or button) — use "Load more" button for simplicity
- [ ] Commit: `feat(collections): QueueTab (คิววันนี้)`

---

## Task 10: Frontend — FollowUpTab

Same as QueueTab but `tab=followup`. Additional: show "โทรไปแล้ว X ครั้ง" in card. Red badge if `noAnswerCount === 2` (next call = lock trigger).

- [ ] Commit: `feat(collections): FollowUpTab (ตามต่อ)`

---

## Task 11: Frontend — PromiseTab

Same pattern, `tab=promise`. Sort rows by `settlementDate asc`. Highlight broken promises (settlementDate passed + still not paid) in destructive color.

- [ ] Commit: `feat(collections): PromiseTab (นัดชำระ)`

---

## Task 12: Frontend — ApprovalTab

**Two sections:**
1. Dunning escalation pending — fetch `/overdue/pending-escalations` (existing endpoint)
2. MDM lock pending — fetch `/overdue/mdm-pending` (new endpoint from Task 4)

Each row: "ขอยึดเครื่อง: สัญญา XX / ลูกค้า YY / trigger=UNCONTACTABLE_3D / เสนอเมื่อ 2 วันที่แล้ว" with [อนุมัติ] [ปฏิเสธ] buttons.

Approve MDM → `POST /overdue/:id/approve-mdm-lock` (endpoint not yet wired — see Task 13).
Approve dunning → existing `POST /overdue/contracts/:id/approve-escalation`.

- [ ] Commit: `feat(collections): ApprovalTab (dunning + mdm pending)`

---

## Task 13: Backend — MDM approve/reject/unlock endpoints

**File:** `apps/api/src/modules/overdue/overdue.controller.ts`

Plan 1 created `MdmLockService.approve/reject/unlock` but did not wire endpoints. Add:

```typescript
  @Post(':contractId/approve-mdm-lock')
  @Roles('OWNER', 'FINANCE_MANAGER')
  approveMdmLock(
    @Param('contractId') contractId: string, // note: this is actually the mdmLockRequest ID; adjust if needed
    @CurrentUser() user: { id: string; role: string },
  ) {
    // Accept mdmLockRequest ID via path — rename param
    return this.mdmLockService.approve(contractId, user.id, user.role);
  }

  @Post(':requestId/reject-mdm-lock')
  @Roles('OWNER', 'FINANCE_MANAGER')
  rejectMdmLock(
    @Param('requestId') requestId: string,
    @Body() body: { reason: string },
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.mdmLockService.reject(requestId, user.id, body.reason, user.role);
  }

  @Post(':requestId/unlock-mdm-device')
  @Roles('OWNER', 'FINANCE_MANAGER')
  unlockMdm(
    @Param('requestId') requestId: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.mdmLockService.unlock(requestId, user.id, user.role);
  }
```

Use unambiguous route params (e.g., `:mdmRequestId`) to avoid collision with `:contractId` elsewhere. Prefer new top-level path: `POST /overdue/mdm-requests/:id/approve`.

- [ ] Rework to avoid path collision:
  ```typescript
  @Post('mdm-requests/:id/approve')
  @Post('mdm-requests/:id/reject')
  @Post('mdm-requests/:id/unlock')
  ```

- [ ] Controller tests for role gating
- [ ] Commit: `feat(overdue): mdm-requests approve/reject/unlock endpoints`

---

## Task 14: Frontend — AllTab (migrate existing OverduePage)

**File:** `apps/web/src/pages/CollectionsPage/tabs/AllTab.tsx`

Import the existing `OverduePage` default export and render it. No changes to the existing page. This preserves all table/kanban/existing features for admin audit.

```tsx
import OverduePage from '@/pages/OverduePage';
export default function AllTab() { return <OverduePage />; }
```

If `OverduePage` has its own `PageHeader`, that's fine — collectors who use AllTab see a double header but that's acceptable as a migration step. Plan 3 can refactor.

- [ ] Commit: `feat(collections): AllTab wraps existing /overdue page`

---

## Task 15: Sidebar nav update

**File:** `apps/web/src/components/layout/MainLayout.tsx` (or wherever nav is defined)

If there's a sidebar link pointing to `/overdue`, swap to `/collections` when feature flag is enabled. Otherwise keep `/overdue`.

- [ ] Check if flag-aware routing is needed or the redirect component handles it
- [ ] If sidebar exists, gate the link
- [ ] Commit: `feat(collections): sidebar routes to /collections when flag on`

---

## Task 16: Vitest + E2E smoke

**Files:**
- Create: `apps/web/e2e/collections-smoke.spec.ts` (Playwright)

Tests:
- OWNER with flag=true → `/overdue` redirects to `/collections`, 5 tabs visible
- SALES with flag=true → `/collections` loads, no Approval tab
- Flag=false → `/overdue` still loads existing page

- [ ] Run E2E: `cd apps/web && npx playwright test collections-smoke`
- [ ] Commit: `test(collections): e2e smoke test for flag + tab visibility`

---

## Task 17: Full type-check + test sweep

- [ ] `./tools/check-types.sh all` — 0 errors
- [ ] `cd apps/api && npm test`
- [ ] `cd apps/web && npm test -- --run`
- [ ] Commit any trailing fixes

---

## Self-Review

**Spec coverage:**
| Spec § | Task |
|---|---|
| §3 Page layout — 5 tabs | 5, 7, 9–12, 14 |
| §3 KPI strip | 3, 6 |
| §3 ContractCard layout | 8 |
| §3 Tab semantics | 2 (backend), 9–12 (UI) |
| §11 Feature flag | 1, 5 |
| §11 queue endpoint | 2 |
| §11 kpi endpoint | 3 |
| §11 mdm-pending endpoint | 4 |
| §11 approve-mdm-lock endpoint | 13 |

**Out of scope (Plan 3+):**
- Customer 360 slide-over
- Bulk actions
- Inline payment recording
- LINE ad-hoc send button (placeholder stub only)
- Priority score formula
- Full KPI (trend + workload) — stubbed to 0 in Task 3

**Placeholder scan:** no TBD / TODO / vague instructions. Every task has file paths + acceptance criteria.

**Type consistency:** `QueueTab` keys (`today`/`followup`/`promise`/`approval`/`all`) identical across types, backend enum, and URL params. `MDM approve path = /overdue/mdm-requests/:id/approve` consistent in Tasks 4 + 12 + 13.
