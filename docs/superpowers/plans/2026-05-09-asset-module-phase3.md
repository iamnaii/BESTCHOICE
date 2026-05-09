# Asset Module Phase 3 — Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 5 read-only report pages (AssetRegister with CSV/XLSX, per-asset Schedule, AssetJournal scoped JE list, SummaryReport with 4 tabs, per-asset Audit page) backed by 4 new endpoints, completing the Asset Module's reporting layer.

**Architecture:** All pages are read-only — no schema changes, no V15 guards, no JE writes. Backend adds 2 service methods on AssetService (`getRegister`, `getAssetSchedule`), 2 new services (`AssetJournalService`, `AssetReportsService`) with their own controllers, and reuses the existing `getAuditTrail` endpoint shipped in Phase 1. Frontend uses existing `exceljs` (already in `apps/web`) for client-side CSV/XLSX export. Reuses Phase 1+2 patterns: zod/v4 schemas (forms-only), DataTable, QueryBoundary, sonner toasts.

**Tech Stack:** NestJS 10, Prisma 5, jest (services), React 18 + Vite 6, react-hook-form + zod/v4, @tanstack/react-query, shadcn/ui (Tabs component), `exceljs@^4.4.0` for export, Playwright.

**Spec:** `docs/superpowers/specs/2026-05-09-asset-module-phase3-design.md`
**Branch:** `feat/asset-module-phase3` (already created)

---

## File Structure

### Backend new/modified

| Path | Action | Responsibility |
|------|--------|---------------|
| `apps/api/src/modules/asset/asset.service.ts` | Modify | Add `getRegister(filters)` + `getAssetSchedule(assetId)` methods |
| `apps/api/src/modules/asset/asset.controller.ts` | Modify | Add `GET /assets/register` + `GET /assets/:id/schedule` endpoints |
| `apps/api/src/modules/asset/asset-journal.service.ts` | Create | List asset-related JEs filtered by `metadata.flow` |
| `apps/api/src/modules/asset/asset-journal.controller.ts` | Create | `GET /assets/journal` endpoint |
| `apps/api/src/modules/asset/asset-reports.service.ts` | Create | Summary aggregations: by category / custodian / location |
| `apps/api/src/modules/asset/asset-reports.controller.ts` | Create | `GET /reports/asset-summary` endpoint |
| `apps/api/src/modules/asset/asset.module.ts` | Modify | Wire 2 new services + 2 new controllers |
| `apps/api/src/modules/asset/__tests__/asset.service.spec.ts` | Modify | Add 10 register/schedule tests |
| `apps/api/src/modules/asset/__tests__/asset-journal.service.spec.ts` | Create | 5 jest tests |
| `apps/api/src/modules/asset/__tests__/asset-reports.service.spec.ts` | Create | 6 jest tests |

### Frontend new/modified

| Path | Action | Responsibility |
|------|--------|---------------|
| `apps/web/src/pages/assets/types.ts` | Modify | Add 4 report types |
| `apps/web/src/pages/assets/api.ts` | Modify | Add 4 API wrappers |
| `apps/web/src/pages/assets/AssetRegisterPage.tsx` | Create | Register list + as-of filter + CSV/XLSX |
| `apps/web/src/pages/assets/AssetSchedulePage.tsx` | Create | Per-asset NBV month-by-month |
| `apps/web/src/pages/assets/AssetJournalPage.tsx` | Create | Filtered JV list |
| `apps/web/src/pages/assets/AssetSummaryReportPage.tsx` | Create | 4-tabs aggregation |
| `apps/web/src/pages/assets/AssetAuditPage.tsx` | Create | Per-asset full audit trail |
| `apps/web/src/pages/assets/utils/exportRegister.ts` | Create | CSV/XLSX serialization helper |
| `apps/web/src/pages/assets/AssetDetailPage.tsx` | Modify | Add menu items "ดูตาราง NBV" + "ดูประวัติทั้งหมด" |
| `apps/web/src/App.tsx` | Modify | Add 5 lazy routes |
| `apps/web/src/config/menu.ts` | Modify | Add 3 nav entries (register, summary, journal) under "สินทรัพย์" |
| `apps/web/e2e/assets-register.spec.ts` | Create | Smoke E2E |
| `apps/web/e2e/assets-summary-report.spec.ts` | Create | Smoke E2E |
| `apps/web/e2e/assets-journal.spec.ts` | Create | Smoke E2E |
| `apps/web/e2e/asset-audit-trail.spec.ts` | Create | Smoke E2E |

---

## Task List Overview

1. AssetService.getRegister + 6 tests
2. AssetService.getAssetSchedule + 4 tests
3. AssetController endpoints (register + schedule)
4. AssetJournalService + Controller + 5 tests
5. AssetReportsService + Controller + 6 tests
6. AssetModule wiring (2 new services + 2 new controllers)
7. Frontend foundation: types, API wrappers, exportRegister util
8. AssetRegisterPage + route + nav
9. AssetSchedulePage + route (drill-down)
10. AssetJournalPage + route + nav
11. AssetSummaryReportPage (4 tabs) + route + nav
12. AssetAuditPage + route (drill-down)
13. AssetDetailPage menu additions
14. E2E specs (4) + final verification

---

## Task 1: AssetService.getRegister + 6 tests

**Files:**
- Modify: `apps/api/src/modules/asset/asset.service.ts` (add `getRegister` method)
- Modify: `apps/api/src/modules/asset/__tests__/asset.service.spec.ts` (add 6 cases)

- [ ] **Step 1.1: Add 6 failing tests**

Append to `asset.service.spec.ts` inside the existing `describe('AssetService', ...)`:

```typescript
describe('AssetService.getRegister', () => {
  it('default asOfDate (today): returns all POSTED assets with current NBV', async () => {
    const a = await createPostedAsset({ name: 'Test 1' });
    const b = await createPostedAsset({ name: 'Test 2' });
    const result = await service.getRegister({});
    expect(result.data.length).toBeGreaterThanOrEqual(2);
    expect(result.summary.count).toBeGreaterThanOrEqual(2);
    const aRow = result.data.find((r) => r.id === a.id)!;
    expect(new Decimal(aRow.netBookValueAt).equals(a.netBookValue.toString())).toBe(true);
  });

  it('past asOfDate: excludes assets created after asOfDate', async () => {
    const a = await createPostedAsset({ purchaseDate: new Date('2026-01-01') });
    const b = await createPostedAsset({ purchaseDate: new Date('2026-04-01') });
    const result = await service.getRegister({ asOfDate: '2026-02-15' });
    const ids = result.data.map((r) => r.id);
    expect(ids).toContain(a.id);
    expect(ids).not.toContain(b.id);
  });

  it('past asOfDate: includes disposed asset if disposalDate > asOfDate', async () => {
    const a = await createPostedAsset({ purchaseDate: new Date('2026-01-01') });
    await prisma.fixedAsset.update({
      where: { id: a.id },
      data: { status: 'DISPOSED', disposalDate: new Date('2026-04-01') },
    });
    const result = await service.getRegister({ asOfDate: '2026-03-01' });
    expect(result.data.find((r) => r.id === a.id)).toBeTruthy();
  });

  it('historical NBV: subtracts depreciation entries up to asOfDate, ignores reversed', async () => {
    const a = await createPostedAsset({
      purchaseDate: new Date('2026-01-01'),
      basePrice: new Decimal(36000),
      purchaseCost: new Decimal(36000),
      monthlyDepr: new Decimal(1000),
    });
    // 3 entries (Jan, Feb, Mar) — Mar reversed
    await prisma.depreciationEntry.create({ data: { assetId: a.id, period: '2026-01', amount: new Decimal(1000) } });
    await prisma.depreciationEntry.create({ data: { assetId: a.id, period: '2026-02', amount: new Decimal(1000) } });
    await prisma.depreciationEntry.create({ data: { assetId: a.id, period: '2026-03', amount: new Decimal(1000), reversedAt: new Date(), reversedById: userId } });

    const result = await service.getRegister({ asOfDate: '2026-04-15' });
    const row = result.data.find((r) => r.id === a.id)!;
    expect(new Decimal(row.accumulatedDeprAt).equals(2000)).toBe(true); // only Jan+Feb count
    expect(new Decimal(row.netBookValueAt).equals(34000)).toBe(true);
  });

  it('summary totals match sum of rows', async () => {
    await createPostedAsset({ purchaseCost: new Decimal(10000), netBookValue: new Decimal(10000) });
    await createPostedAsset({ purchaseCost: new Decimal(20000), netBookValue: new Decimal(20000) });
    const result = await service.getRegister({});
    const sumPC = result.data.reduce((s, r) => s.plus(r.purchaseCost.toString()), new Decimal(0));
    const sumNBV = result.data.reduce((s, r) => s.plus(r.netBookValueAt.toString()), new Decimal(0));
    expect(new Decimal(result.summary.totalPurchaseCost).equals(sumPC)).toBe(true);
    expect(new Decimal(result.summary.totalNbv).equals(sumNBV)).toBe(true);
  });

  it('paginates and filters by category', async () => {
    await createPostedAsset({ category: 'EQUIPMENT' });
    await createPostedAsset({ category: 'VEHICLE' });
    const result = await service.getRegister({ category: 'EQUIPMENT', limit: 1 });
    expect(result.data.length).toBe(1);
    expect(result.data[0].category).toBe('EQUIPMENT');
  });
});
```

- [ ] **Step 1.2: Run failing tests**

```bash
cd apps/api && npx jest src/modules/asset/__tests__/asset.service -t "getRegister" --runInBand
```

Expected: FAIL — `service.getRegister is not a function`.

- [ ] **Step 1.3: Implement `getRegister`**

In `apps/api/src/modules/asset/asset.service.ts`, add:

```typescript
async getRegister(filters: {
  asOfDate?: string;
  category?: AssetCategory;
  status?: AssetStatus;
  branchId?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const asOfDate = filters.asOfDate ? new Date(filters.asOfDate) : new Date();
  const asOfYearMonth = `${asOfDate.getFullYear()}-${String(asOfDate.getMonth() + 1).padStart(2, '0')}`;
  const page = filters.page ?? 1;
  const limit = Math.min(filters.limit ?? 50, 200);

  // Filter assets: purchased on or before asOfDate; if disposed, disposalDate > asOfDate (still active at asOfDate)
  const where: Prisma.FixedAssetWhereInput = {
    deletedAt: null,
    purchaseDate: { lte: asOfDate },
    OR: [
      { status: 'POSTED' },
      { AND: [{ status: { in: ['DISPOSED', 'WRITTEN_OFF'] } }, { disposalDate: { gt: asOfDate } }] },
    ],
  };
  if (filters.category) where.category = filters.category;
  if (filters.status) {
    // status filter narrows further (within the OR above)
    where.AND = [{ status: filters.status }];
  }
  if (filters.branchId) where.branchId = filters.branchId;
  if (filters.search) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      {
        OR: [
          { assetCode: { contains: filters.search, mode: 'insensitive' } },
          { name: { contains: filters.search, mode: 'insensitive' } },
          { serialNo: { contains: filters.search, mode: 'insensitive' } },
        ],
      },
    ];
  }

  const [assets, total] = await Promise.all([
    this.prisma.fixedAsset.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { purchaseDate: 'desc' },
      include: { branch: { select: { id: true, name: true } } },
    }),
    this.prisma.fixedAsset.count({ where }),
  ]);

  // Compute historical NBV per asset
  const assetIds = assets.map((a) => a.id);
  const entries = assetIds.length
    ? await this.prisma.depreciationEntry.findMany({
        where: {
          assetId: { in: assetIds },
          period: { lte: asOfYearMonth },
          reversedAt: null,
        },
      })
    : [];

  const accumByAsset = new Map<string, Decimal>();
  for (const e of entries) {
    const cur = accumByAsset.get(e.assetId) ?? new Decimal(0);
    accumByAsset.set(e.assetId, cur.plus(e.amount.toString()));
  }

  let totalPurchaseCost = new Decimal(0);
  let totalAccumulatedDepr = new Decimal(0);
  let totalNbv = new Decimal(0);

  const data = assets.map((a) => {
    const purchaseCost = new Decimal(a.purchaseCost.toString());
    const residualValue = new Decimal(a.residualValue.toString());
    const monthlyDepr = new Decimal(a.monthlyDepr.toString());
    const accumulatedDeprAt = accumByAsset.get(a.id) ?? new Decimal(0);
    const netBookValueAt = purchaseCost.minus(accumulatedDeprAt);
    const remainingDepreciable = netBookValueAt.minus(residualValue);
    const remainingMonths = monthlyDepr.gt(0) && remainingDepreciable.gt(0)
      ? Math.ceil(remainingDepreciable.div(monthlyDepr).toNumber())
      : 0;

    totalPurchaseCost = totalPurchaseCost.plus(purchaseCost);
    totalAccumulatedDepr = totalAccumulatedDepr.plus(accumulatedDeprAt);
    totalNbv = totalNbv.plus(netBookValueAt);

    return {
      id: a.id,
      assetCode: a.assetCode,
      name: a.name,
      category: a.category,
      branchId: a.branchId,
      branch: a.branch,
      custodian: a.custodian,
      location: a.location,
      purchaseDate: a.purchaseDate.toISOString().slice(0, 10),
      purchaseCost: purchaseCost.toFixed(2),
      accumulatedDeprAt: accumulatedDeprAt.toFixed(2),
      netBookValueAt: netBookValueAt.toFixed(2),
      monthlyDepr: monthlyDepr.toFixed(2),
      remainingMonths,
      status: a.status,
    };
  });

  return {
    data,
    total,
    page,
    limit,
    asOfDate: asOfDate.toISOString().slice(0, 10),
    summary: {
      count: total,
      totalPurchaseCost: totalPurchaseCost.toFixed(2),
      totalAccumulatedDepr: totalAccumulatedDepr.toFixed(2),
      totalNbv: totalNbv.toFixed(2),
    },
  };
}
```

- [ ] **Step 1.4: Run tests**

```bash
cd apps/api && npx jest src/modules/asset/__tests__/asset.service -t "getRegister" --runInBand
./tools/check-types.sh api
```

Expected: 6 PASS, 0 errors.

- [ ] **Step 1.5: Commit**

```bash
git add apps/api/src/modules/asset/asset.service.ts \
        apps/api/src/modules/asset/__tests__/asset.service.spec.ts
git commit -m "feat(asset): getRegister with historical NBV + 6 tests

asOfDate-based filter (purchaseDate ≤ asOfDate; disposed assets included
if disposalDate > asOfDate). Historical NBV = purchaseCost − sum of
DepreciationEntry where period ≤ asOfYearMonth AND reversedAt IS NULL.
Returns paginated rows + summary totals (count + cost + accumulated + NBV)."
```

---

## Task 2: AssetService.getAssetSchedule + 4 tests

**Files:**
- Modify: `apps/api/src/modules/asset/asset.service.ts`
- Modify: `apps/api/src/modules/asset/__tests__/asset.service.spec.ts`

- [ ] **Step 2.1: Add 4 failing tests**

```typescript
describe('AssetService.getAssetSchedule', () => {
  it('produces schedule rows from purchase to fully depreciated, capped at 60 months', async () => {
    const a = await createPostedAsset({
      purchaseDate: new Date('2026-01-15'),
      basePrice: new Decimal(36000),
      purchaseCost: new Decimal(36000),
      monthlyDepr: new Decimal(1000),
      usefulLifeMonths: 36,
      residualValue: new Decimal(0),
      netBookValue: new Decimal(36000),
    });
    const result = await service.getAssetSchedule(a.id);
    expect(result.assetId).toBe(a.id);
    expect(result.rows.length).toBe(36); // 36 months for 36000 / 1000
    expect(result.rows[35].status).toBe('FULLY_DEPRECIATED');
    expect(new Decimal(result.rows[35].netBookValue).equals(0)).toBe(true);
  });

  it('last period adjusts to residualValue floor (no over-depreciation)', async () => {
    const a = await createPostedAsset({
      basePrice: new Decimal(10000),
      purchaseCost: new Decimal(10000),
      monthlyDepr: new Decimal(333.33),
      residualValue: new Decimal(1000),
      usefulLifeMonths: 30,
      netBookValue: new Decimal(10000),
    });
    const result = await service.getAssetSchedule(a.id);
    const last = result.rows[result.rows.length - 1];
    expect(new Decimal(last.netBookValue).equals(1000)).toBe(true);
  });

  it('truncates schedule at disposalDate when set', async () => {
    const a = await createPostedAsset({
      purchaseDate: new Date('2026-01-01'),
      monthlyDepr: new Decimal(1000),
    });
    await prisma.fixedAsset.update({
      where: { id: a.id },
      data: { status: 'DISPOSED', disposalDate: new Date('2026-04-30') },
    });
    const result = await service.getAssetSchedule(a.id);
    expect(result.rows.length).toBeLessThanOrEqual(4); // Jan, Feb, Mar, Apr
    expect(result.rows.some((r) => r.period === '2026-05')).toBe(false);
  });

  it('uses actual DepreciationEntry where it exists, projection otherwise', async () => {
    const a = await createPostedAsset({
      purchaseDate: new Date('2026-01-01'),
      monthlyDepr: new Decimal(1000),
    });
    // Actual entry for 2026-02 = 950 (lower than projected 1000)
    await prisma.depreciationEntry.create({
      data: { assetId: a.id, period: '2026-02', amount: new Decimal(950) },
    });
    const result = await service.getAssetSchedule(a.id);
    const feb = result.rows.find((r) => r.period === '2026-02')!;
    expect(new Decimal(feb.monthlyDepr).equals(950)).toBe(true);
  });
});
```

- [ ] **Step 2.2: Run failing**

```bash
cd apps/api && npx jest src/modules/asset/__tests__/asset.service -t "getAssetSchedule" --runInBand
```

Expected: FAIL.

- [ ] **Step 2.3: Implement**

```typescript
async getAssetSchedule(assetId: string) {
  const asset = await this.prisma.fixedAsset.findFirst({
    where: { id: assetId, deletedAt: null },
  });
  if (!asset) throw new NotFoundException('ไม่พบสินทรัพย์');

  const purchaseCost = new Decimal(asset.purchaseCost.toString());
  const residualValue = new Decimal(asset.residualValue.toString());
  const monthlyDepr = new Decimal(asset.monthlyDepr.toString());

  // Load existing entries indexed by period
  const entries = await this.prisma.depreciationEntry.findMany({
    where: { assetId, reversedAt: null },
    select: { period: true, amount: true },
  });
  const entryByPeriod = new Map(entries.map((e) => [e.period, new Decimal(e.amount.toString())]));

  const rows: Array<{
    period: string;
    monthlyDepr: string;
    accumulatedDepr: string;
    netBookValue: string;
    status: 'ACTIVE' | 'FULLY_DEPRECIATED';
  }> = [];

  let accumulated = new Decimal(0);
  let cursor = new Date(asset.purchaseDate);
  cursor.setDate(1);
  const cutoff = asset.disposalDate ?? null;
  const HARD_CAP = 60;

  for (let i = 0; i < HARD_CAP; i++) {
    const periodEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    if (cutoff && periodEnd > cutoff) break;

    const period = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
    const remaining = purchaseCost.minus(accumulated).minus(residualValue);
    if (remaining.lte(0)) break;

    let thisMonth: Decimal;
    if (entryByPeriod.has(period)) {
      thisMonth = entryByPeriod.get(period)!;
    } else {
      thisMonth = remaining.lt(monthlyDepr) ? remaining : monthlyDepr;
    }

    accumulated = accumulated.plus(thisMonth);
    const nbv = purchaseCost.minus(accumulated);
    const status: 'ACTIVE' | 'FULLY_DEPRECIATED' = nbv.lte(residualValue) ? 'FULLY_DEPRECIATED' : 'ACTIVE';
    rows.push({
      period,
      monthlyDepr: thisMonth.toFixed(2),
      accumulatedDepr: accumulated.toFixed(2),
      netBookValue: nbv.toFixed(2),
      status,
    });

    if (status === 'FULLY_DEPRECIATED') break;
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return {
    assetId: asset.id,
    assetCode: asset.assetCode,
    name: asset.name,
    purchaseDate: asset.purchaseDate.toISOString().slice(0, 10),
    purchaseCost: purchaseCost.toFixed(2),
    residualValue: residualValue.toFixed(2),
    monthlyDepr: monthlyDepr.toFixed(2),
    rows,
  };
}
```

- [ ] **Step 2.4: Run tests**

```bash
cd apps/api && npx jest src/modules/asset/__tests__/asset.service -t "getAssetSchedule" --runInBand
./tools/check-types.sh api
```

Expected: 4 PASS, 0 errors.

- [ ] **Step 2.5: Commit**

```bash
git add apps/api/src/modules/asset/asset.service.ts \
        apps/api/src/modules/asset/__tests__/asset.service.spec.ts
git commit -m "feat(asset): getAssetSchedule + 4 tests

Per-asset NBV month-by-month projection from purchaseDate.
Uses actual DepreciationEntry where exists; formula projection
otherwise. Last period adjusts to residualValue floor.
Truncates at disposalDate. 60-month sanity cap."
```

---

## Task 3: AssetController endpoints (register + schedule)

**Files:**
- Modify: `apps/api/src/modules/asset/asset.controller.ts`

- [ ] **Step 3.1: Add 2 endpoints**

In `apps/api/src/modules/asset/asset.controller.ts`, add endpoints (after `getAuditTrail` at `:id/audit`, before `update`):

```typescript
@Get('register')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
getRegister(
  @Query() pagination: PaginationDto,
  @Query('asOfDate') asOfDate?: string,
  @Query('category') category?: AssetCategory,
  @Query('status') status?: AssetStatus,
  @Query('branchId') branchId?: string,
  @Query('search') search?: string,
) {
  return this.assetService.getRegister({
    asOfDate, category, status, branchId, search,
    page: pagination.page,
    limit: pagination.limit,
  });
}

@Get(':id/schedule')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
getSchedule(@Param('id') id: string) {
  return this.assetService.getAssetSchedule(id);
}
```

**Important:** Place `register` (literal path) BEFORE any `:id` parameter routes — NestJS route matching is order-sensitive. Check the existing controller — `findOne` at `@Get(':id')` is at line ~70; `register` must be declared before it (or at least before `getSchedule` since both share `:id` patterns).

If the existing controller declares `:id` early, move `register` to be just after `summary` and `generate-code` (other literal-path routes).

- [ ] **Step 3.2: Verify typecheck**

```bash
./tools/check-types.sh api
```

Expected: 0 errors.

- [ ] **Step 3.3: Commit**

```bash
git add apps/api/src/modules/asset/asset.controller.ts
git commit -m "feat(asset): wire register + schedule endpoints

GET /assets/register — historical NBV register
GET /assets/:id/schedule — per-asset month-by-month NBV
All 4 roles allowed (read-only)."
```

---

## Task 4: AssetJournalService + Controller + 5 tests

**Files:**
- Create: `apps/api/src/modules/asset/asset-journal.service.ts`
- Create: `apps/api/src/modules/asset/asset-journal.controller.ts`
- Create: `apps/api/src/modules/asset/__tests__/asset-journal.service.spec.ts`

- [ ] **Step 4.1: Write failing test**

Create `apps/api/src/modules/asset/__tests__/asset-journal.service.spec.ts`. Use the existing pattern from `asset.service.spec.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { PrismaClient, AssetCategory, AssetStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import { AssetJournalService } from '../asset-journal.service';
import { seedFinanceCoa } from '../../../prisma/seed-coa-finance';

const prisma = new PrismaClient();
let service: AssetJournalService;
let userId: string;
let companyId: string;

beforeAll(async () => {
  await seedFinanceCoa(prisma);
  let user = await prisma.user.findFirst({ where: { email: 'asset-journal-test@bestchoice.local' } });
  if (!user) {
    user = await prisma.user.create({
      data: { email: 'asset-journal-test@bestchoice.local', name: 'AJ Tester', password: 'x', role: 'OWNER' },
    });
  }
  userId = user.id;
  const finance = await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE', deletedAt: null } });
  companyId = finance!.id;

  const moduleRef = await Test.createTestingModule({
    providers: [
      AssetJournalService,
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile();
  service = moduleRef.get(AssetJournalService);
});

afterAll(async () => {
  await prisma.$executeRaw`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_delete`;
  try { await prisma.auditLog.deleteMany({ where: { userId } }); }
  finally { await prisma.$executeRaw`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_delete`; }
  await prisma.journalLine.deleteMany({ where: { journalEntry: { createdById: userId } } });
  await prisma.journalEntry.deleteMany({ where: { createdById: userId } });
  await prisma.fixedAsset.deleteMany({ where: { createdById: userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.journalLine.deleteMany({ where: { journalEntry: { createdById: userId } } });
  await prisma.journalEntry.deleteMany({ where: { createdById: userId } });
});

async function createTestAsset() {
  return prisma.fixedAsset.create({
    data: {
      assetCode: `JNL-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      docNo: `ASSET-JNL-${Math.random().toString(36).slice(2, 8)}`,
      name: 'Asset for journal tests',
      category: 'EQUIPMENT' as AssetCategory,
      basePrice: new Decimal(10000), shippingCost: new Decimal(0),
      installationCost: new Decimal(0), otherCapitalized: new Decimal(0),
      vatAmount: new Decimal(0), whtAmount: new Decimal(0),
      purchaseCost: new Decimal(10000), residualValue: new Decimal(0),
      usefulLifeMonths: 12, monthlyDepr: new Decimal(833.33),
      netBookValue: new Decimal(10000),
      purchaseDate: new Date('2026-04-01'),
      paymentAccount: '11-1201',
      status: 'POSTED' as AssetStatus,
      createdById: userId,
    },
  });
}

async function createTestJe(flow: string, assetId: string) {
  return prisma.journalEntry.create({
    data: {
      entryNumber: `JE-202604-${Math.floor(Math.random() * 90000 + 10000)}`,
      companyId,
      entryDate: new Date('2026-04-15'),
      description: `Test ${flow} JE`,
      status: 'POSTED',
      referenceType: 'AUTO',
      referenceId: assetId,
      createdById: userId,
      metadata: { flow, assetId },
      lines: {
        create: [
          { accountCode: '12-2101', debit: new Decimal(10000), credit: new Decimal(0) },
          { accountCode: '11-1201', debit: new Decimal(0), credit: new Decimal(10000) },
        ],
      },
    },
    include: { lines: true },
  });
}

describe('AssetJournalService.list', () => {
  it('returns asset-related JEs only (filtered by metadata.flow)', async () => {
    const a = await createTestAsset();
    await createTestJe('asset-purchase', a.id);
    await createTestJe('depreciation', a.id);
    // Non-asset flow shouldn't appear:
    await prisma.journalEntry.create({
      data: {
        entryNumber: `JE-202604-${Math.floor(Math.random() * 90000 + 10000)}`,
        companyId,
        entryDate: new Date('2026-04-15'),
        description: 'unrelated payment JE',
        status: 'POSTED',
        createdById: userId,
        metadata: { flow: 'payment' },
        lines: {
          create: [
            { accountCode: '11-1201', debit: new Decimal(100), credit: new Decimal(0) },
            { accountCode: '11-2101', debit: new Decimal(0), credit: new Decimal(100) },
          ],
        },
      },
    });
    const result = await service.list({});
    expect(result.data.length).toBe(2);
    expect(result.data.every((r) => ['asset-purchase', 'depreciation'].includes(r.flow))).toBe(true);
  });

  it('flowType filter narrows to specific flow', async () => {
    const a = await createTestAsset();
    await createTestJe('asset-purchase', a.id);
    await createTestJe('depreciation', a.id);
    const result = await service.list({ flowType: 'depreciation' });
    expect(result.data.length).toBe(1);
    expect(result.data[0].flow).toBe('depreciation');
  });

  it('search matches asset.assetCode / name', async () => {
    const a = await createTestAsset();
    const b = await createTestAsset();
    await prisma.fixedAsset.update({ where: { id: a.id }, data: { name: 'SpecialAlpha' } });
    await createTestJe('asset-purchase', a.id);
    await createTestJe('asset-purchase', b.id);
    const result = await service.list({ search: 'SpecialAlpha' });
    expect(result.data.length).toBe(1);
    expect(result.data[0].assetId).toBe(a.id);
  });

  it('date range filter on entryDate', async () => {
    const a = await createTestAsset();
    const je1 = await createTestJe('asset-purchase', a.id);
    await prisma.journalEntry.update({ where: { id: je1.id }, data: { entryDate: new Date('2026-03-01') } });
    await createTestJe('depreciation', a.id);
    const result = await service.list({ fromDate: '2026-04-01', toDate: '2026-04-30' });
    expect(result.data.length).toBe(1);
    expect(result.data[0].flow).toBe('depreciation');
  });

  it('paginates correctly', async () => {
    const a = await createTestAsset();
    for (let i = 0; i < 7; i++) await createTestJe('asset-purchase', a.id);
    const page1 = await service.list({ page: 1, limit: 5 });
    expect(page1.data.length).toBe(5);
    expect(page1.total).toBe(7);
    const page2 = await service.list({ page: 2, limit: 5 });
    expect(page2.data.length).toBe(2);
  });
});
```

- [ ] **Step 4.2: Run failing**

```bash
cd apps/api && npx jest src/modules/asset/__tests__/asset-journal.service --runInBand
```

Expected: FAIL — `Cannot find module '../asset-journal.service'`.

- [ ] **Step 4.3: Implement service**

Create `apps/api/src/modules/asset/asset-journal.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';

const ASSET_FLOWS = [
  'asset-purchase',
  'asset-purchase-reverse',
  'asset-disposal',
  'asset-disposal-reverse',
  'depreciation',
  'depreciation-reverse',
] as const;

type FlowType = typeof ASSET_FLOWS[number] | 'all-reversals' | 'all';

const FLOW_GROUPS: Record<string, string[]> = {
  'asset-purchase': ['asset-purchase'],
  'asset-purchase-reverse': ['asset-purchase-reverse'],
  'asset-disposal': ['asset-disposal'],
  'asset-disposal-reverse': ['asset-disposal-reverse'],
  'depreciation': ['depreciation'],
  'depreciation-reverse': ['depreciation-reverse'],
  'all-reversals': ['asset-purchase-reverse', 'asset-disposal-reverse', 'depreciation-reverse'],
  'all': [...ASSET_FLOWS],
};

@Injectable()
export class AssetJournalService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: {
    page?: number;
    limit?: number;
    search?: string;
    flowType?: FlowType;
    fromDate?: string;
    toDate?: string;
  }) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 50, 200);
    const flows = FLOW_GROUPS[filters.flowType ?? 'all'] ?? [...ASSET_FLOWS];

    // Build OR clauses for each flow value (Prisma doesn't support `IN` on JSON path filters directly)
    const flowOr = flows.map((f) => ({ metadata: { path: ['flow'], equals: f } }));

    const where: Prisma.JournalEntryWhereInput = {
      deletedAt: null,
      OR: flowOr,
    };

    if (filters.fromDate || filters.toDate) {
      where.entryDate = {};
      if (filters.fromDate) where.entryDate.gte = new Date(filters.fromDate);
      if (filters.toDate) {
        const end = new Date(filters.toDate);
        end.setHours(23, 59, 59, 999);
        where.entryDate.lte = end;
      }
    }

    // Search needs a join to fixed_assets — but JE has no direct relation, only metadata.assetId
    // Approach: pre-resolve matching asset IDs, then filter JEs by metadata.assetId IN (matchingIds)
    if (filters.search) {
      const assets = await this.prisma.fixedAsset.findMany({
        where: {
          OR: [
            { assetCode: { contains: filters.search, mode: 'insensitive' } },
            { name: { contains: filters.search, mode: 'insensitive' } },
            { serialNo: { contains: filters.search, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
        take: 500,  // sanity cap for the JE filter
      });
      const matchingIds = assets.map((a) => a.id);
      if (matchingIds.length === 0) {
        return { data: [], total: 0, page, limit };
      }
      where.AND = [
        { OR: matchingIds.map((id) => ({ metadata: { path: ['assetId'], equals: id } })) },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        orderBy: { entryDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { lines: true },
      }),
      this.prisma.journalEntry.count({ where }),
    ]);

    // Resolve assets by metadata.assetId in batch
    const assetIds = Array.from(
      new Set(rows.map((r) => (r.metadata as Record<string, unknown> | null)?.assetId as string | undefined).filter(Boolean) as string[]),
    );
    const assets = assetIds.length
      ? await this.prisma.fixedAsset.findMany({
          where: { id: { in: assetIds } },
          select: { id: true, assetCode: true, name: true },
        })
      : [];
    const assetById = new Map(assets.map((a) => [a.id, a]));

    const data = rows.map((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const flow = (meta.flow as string) ?? 'unknown';
      const assetId = (meta.assetId as string) ?? null;
      const totalDr = r.lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
      const totalCr = r.lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
      return {
        id: r.id,
        entryNumber: r.entryNumber,
        entryDate: r.entryDate.toISOString().slice(0, 10),
        status: r.status,
        description: r.description,
        flow,
        assetId,
        asset: assetId ? assetById.get(assetId) ?? null : null,
        totalDr: totalDr.toFixed(2),
        totalCr: totalCr.toFixed(2),
        reversed: meta.reversed === true,
        reversedByEntryNumber: (meta.reversedByEntryNumber as string) ?? null,
      };
    });

    return { data, total, page, limit };
  }
}
```

- [ ] **Step 4.4: Implement controller**

Create `apps/api/src/modules/asset/asset-journal.controller.ts`:

```typescript
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AssetJournalService } from './asset-journal.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Asset Journal')
@ApiBearerAuth('JWT')
@Controller('assets/journal')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AssetJournalController {
  constructor(private readonly service: AssetJournalService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('flowType') flowType?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const parsedPage = page ? parseInt(page, 10) : NaN;
    const parsedLimit = limit ? parseInt(limit, 10) : NaN;
    return this.service.list({
      page: Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : undefined,
      limit: Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined,
      search,
      flowType: flowType as never,
      fromDate, toDate,
    });
  }
}
```

- [ ] **Step 4.5: Run tests**

```bash
cd apps/api && npx jest src/modules/asset/__tests__/asset-journal.service --runInBand
./tools/check-types.sh api
```

Expected: 5 PASS, 0 errors.

(Module wiring happens in Task 6.)

- [ ] **Step 4.6: Commit**

```bash
git add apps/api/src/modules/asset/asset-journal.service.ts \
        apps/api/src/modules/asset/asset-journal.controller.ts \
        apps/api/src/modules/asset/__tests__/asset-journal.service.spec.ts
git commit -m "feat(asset): AssetJournalService + Controller + 5 tests

Lists JournalEntry rows where metadata.flow matches one of the 6
asset-related flow values (purchase, depreciation, disposal + 3 reverses).
Filters: flowType, search (resolves to asset IDs first, then matches
metadata.assetId), date range. Paginated 50/page, hardcap 200."
```

---

## Task 5: AssetReportsService + Controller + 6 tests

**Files:**
- Create: `apps/api/src/modules/asset/asset-reports.service.ts`
- Create: `apps/api/src/modules/asset/asset-reports.controller.ts`
- Create: `apps/api/src/modules/asset/__tests__/asset-reports.service.spec.ts`

- [ ] **Step 5.1: Write failing test**

Create `apps/api/src/modules/asset/__tests__/asset-reports.service.spec.ts` mirroring the test setup pattern from `asset-journal.service.spec.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { PrismaClient, AssetCategory, AssetStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import { AssetReportsService } from '../asset-reports.service';
import { seedFinanceCoa } from '../../../prisma/seed-coa-finance';

const prisma = new PrismaClient();
let service: AssetReportsService;
let userId: string;

beforeAll(async () => {
  await seedFinanceCoa(prisma);
  let user = await prisma.user.findFirst({ where: { email: 'asset-reports-test@bestchoice.local' } });
  if (!user) {
    user = await prisma.user.create({
      data: { email: 'asset-reports-test@bestchoice.local', name: 'AR Tester', password: 'x', role: 'OWNER' },
    });
  }
  userId = user.id;

  const moduleRef = await Test.createTestingModule({
    providers: [
      AssetReportsService,
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile();
  service = moduleRef.get(AssetReportsService);
});

afterAll(async () => {
  await prisma.depreciationEntry.deleteMany({});
  await prisma.fixedAsset.deleteMany({ where: { createdById: userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.depreciationEntry.deleteMany({});
  await prisma.fixedAsset.deleteMany({ where: { createdById: userId } });
});

async function makeAsset(overrides: Partial<Parameters<typeof prisma.fixedAsset.create>[0]['data']> = {}) {
  return prisma.fixedAsset.create({
    data: {
      assetCode: `RPT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      docNo: `ASSET-RPT-${Math.random().toString(36).slice(2, 8)}`,
      name: 'Report test asset',
      category: 'EQUIPMENT' as AssetCategory,
      basePrice: new Decimal(10000), shippingCost: new Decimal(0),
      installationCost: new Decimal(0), otherCapitalized: new Decimal(0),
      vatAmount: new Decimal(0), whtAmount: new Decimal(0),
      purchaseCost: new Decimal(10000), residualValue: new Decimal(0),
      usefulLifeMonths: 12, monthlyDepr: new Decimal(833.33),
      netBookValue: new Decimal(10000),
      purchaseDate: new Date('2026-01-01'),
      paymentAccount: '11-1201',
      status: 'POSTED' as AssetStatus,
      createdById: userId,
      ...overrides,
    },
  });
}

describe('AssetReportsService.summary', () => {
  it('groupBy=category aggregates count + cost + NBV', async () => {
    await makeAsset({ category: 'EQUIPMENT', purchaseCost: new Decimal(10000), netBookValue: new Decimal(10000) });
    await makeAsset({ category: 'EQUIPMENT', purchaseCost: new Decimal(5000), netBookValue: new Decimal(5000) });
    await makeAsset({ category: 'VEHICLE', purchaseCost: new Decimal(50000), netBookValue: new Decimal(50000) });
    const result = await service.summary({ groupBy: 'category' });
    const eq = result.find((r) => r.key === 'EQUIPMENT')!;
    expect(eq.count).toBe(2);
    expect(new Decimal(eq.totalPurchaseCost).equals(15000)).toBe(true);
    expect(new Decimal(eq.totalNbv).equals(15000)).toBe(true);
  });

  it('groupBy=custodian handles null custodian as ไม่ระบุ', async () => {
    await makeAsset({ custodian: 'Alice' });
    await makeAsset({ custodian: null });
    const result = await service.summary({ groupBy: 'custodian' });
    expect(result.find((r) => r.key === 'Alice')).toBeTruthy();
    expect(result.find((r) => r.key === 'ไม่ระบุ')).toBeTruthy();
  });

  it('groupBy=location handles null', async () => {
    await makeAsset({ location: 'HQ' });
    await makeAsset({ location: null });
    const result = await service.summary({ groupBy: 'location' });
    expect(result.find((r) => r.key === 'HQ')).toBeTruthy();
    expect(result.find((r) => r.key === 'ไม่ระบุ')).toBeTruthy();
  });

  it('asOfDate respected: subtracts depreciation entries through that period', async () => {
    const a = await makeAsset({
      category: 'EQUIPMENT',
      purchaseDate: new Date('2026-01-01'),
      monthlyDepr: new Decimal(1000),
    });
    await prisma.depreciationEntry.create({ data: { assetId: a.id, period: '2026-01', amount: new Decimal(1000) } });
    await prisma.depreciationEntry.create({ data: { assetId: a.id, period: '2026-02', amount: new Decimal(1000) } });
    const result = await service.summary({ groupBy: 'category', asOfDate: '2026-02-15' });
    const eq = result.find((r) => r.key === 'EQUIPMENT')!;
    expect(new Decimal(eq.totalAccumulatedDepr).equals(2000)).toBe(true);
    expect(new Decimal(eq.totalNbv).equals(8000)).toBe(true);
  });

  it('filters by branch + status', async () => {
    const branch = await prisma.branch.findFirst();
    if (!branch) return;
    await makeAsset({ branchId: branch.id });
    await makeAsset({ branchId: null });
    const result = await service.summary({ groupBy: 'category', branchId: branch.id });
    expect(result[0].count).toBe(1);
  });

  it('empty result returns array (not error)', async () => {
    const result = await service.summary({ groupBy: 'category', branchId: '00000000-0000-0000-0000-000000000000' });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});
```

- [ ] **Step 5.2: Run failing**

```bash
cd apps/api && npx jest src/modules/asset/__tests__/asset-reports.service --runInBand
```

Expected: FAIL — `Cannot find module '../asset-reports.service'`.

- [ ] **Step 5.3: Implement service**

Create `apps/api/src/modules/asset/asset-reports.service.ts`:

```typescript
import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma, AssetStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';

export interface SummaryRow {
  key: string;       // category enum / custodian text / location text
  label: string;
  count: number;
  totalPurchaseCost: string;
  totalAccumulatedDepr: string;
  totalNbv: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  EQUIPMENT: 'อุปกรณ์สำนักงาน',
  IMPROVEMENT: 'ส่วนปรับปรุงอาคาร',
  FURNITURE: 'เครื่องตกแต่งสำนักงาน',
  VEHICLE: 'ยานพาหนะ',
};

@Injectable()
export class AssetReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(filters: {
    groupBy: 'category' | 'custodian' | 'location';
    asOfDate?: string;
    status?: AssetStatus;
    branchId?: string;
  }): Promise<SummaryRow[]> {
    if (!['category', 'custodian', 'location'].includes(filters.groupBy)) {
      throw new BadRequestException('groupBy ต้องเป็น category, custodian, หรือ location');
    }

    const asOfDate = filters.asOfDate ? new Date(filters.asOfDate) : new Date();
    const asOfYearMonth = `${asOfDate.getFullYear()}-${String(asOfDate.getMonth() + 1).padStart(2, '0')}`;

    const where: Prisma.FixedAssetWhereInput = {
      deletedAt: null,
      purchaseDate: { lte: asOfDate },
      OR: [
        { status: 'POSTED' },
        { AND: [{ status: { in: ['DISPOSED', 'WRITTEN_OFF'] } }, { disposalDate: { gt: asOfDate } }] },
      ],
    };
    if (filters.status) {
      where.AND = [{ status: filters.status }];
    }
    if (filters.branchId) where.branchId = filters.branchId;

    const assets = await this.prisma.fixedAsset.findMany({
      where,
      select: {
        id: true, category: true, custodian: true, location: true,
        purchaseCost: true, monthlyDepr: true, residualValue: true,
      },
    });

    const assetIds = assets.map((a) => a.id);
    if (assetIds.length === 0) return [];

    const entries = await this.prisma.depreciationEntry.findMany({
      where: {
        assetId: { in: assetIds },
        period: { lte: asOfYearMonth },
        reversedAt: null,
      },
      select: { assetId: true, amount: true },
    });
    const accumByAsset = new Map<string, Decimal>();
    for (const e of entries) {
      const cur = accumByAsset.get(e.assetId) ?? new Decimal(0);
      accumByAsset.set(e.assetId, cur.plus(e.amount.toString()));
    }

    const groups = new Map<string, { count: number; pc: Decimal; ad: Decimal; nbv: Decimal; label: string }>();
    for (const a of assets) {
      const accumulated = accumByAsset.get(a.id) ?? new Decimal(0);
      const purchaseCost = new Decimal(a.purchaseCost.toString());
      const nbv = purchaseCost.minus(accumulated);

      let key: string;
      let label: string;
      if (filters.groupBy === 'category') {
        key = a.category;
        label = CATEGORY_LABELS[a.category] ?? a.category;
      } else if (filters.groupBy === 'custodian') {
        key = a.custodian ?? 'ไม่ระบุ';
        label = key;
      } else {
        key = a.location ?? 'ไม่ระบุ';
        label = key;
      }

      const g = groups.get(key) ?? { count: 0, pc: new Decimal(0), ad: new Decimal(0), nbv: new Decimal(0), label };
      g.count += 1;
      g.pc = g.pc.plus(purchaseCost);
      g.ad = g.ad.plus(accumulated);
      g.nbv = g.nbv.plus(nbv);
      groups.set(key, g);
    }

    return Array.from(groups.entries()).map(([key, g]) => ({
      key,
      label: g.label,
      count: g.count,
      totalPurchaseCost: g.pc.toFixed(2),
      totalAccumulatedDepr: g.ad.toFixed(2),
      totalNbv: g.nbv.toFixed(2),
    })).sort((a, b) => b.count - a.count);
  }
}
```

- [ ] **Step 5.4: Implement controller**

Create `apps/api/src/modules/asset/asset-reports.controller.ts`:

```typescript
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AssetReportsService } from './asset-reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AssetStatus } from '@prisma/client';

@ApiTags('Asset Reports')
@ApiBearerAuth('JWT')
@Controller('reports/asset-summary')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AssetReportsController {
  constructor(private readonly service: AssetReportsService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  summary(
    @Query('groupBy') groupBy: 'category' | 'custodian' | 'location',
    @Query('asOfDate') asOfDate?: string,
    @Query('status') status?: AssetStatus,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.summary({ groupBy, asOfDate, status, branchId });
  }
}
```

- [ ] **Step 5.5: Run tests**

```bash
cd apps/api && npx jest src/modules/asset/__tests__/asset-reports.service --runInBand
./tools/check-types.sh api
```

Expected: 6 PASS, 0 errors.

- [ ] **Step 5.6: Commit**

```bash
git add apps/api/src/modules/asset/asset-reports.service.ts \
        apps/api/src/modules/asset/asset-reports.controller.ts \
        apps/api/src/modules/asset/__tests__/asset-reports.service.spec.ts
git commit -m "feat(asset): AssetReportsService + Controller + 6 tests

GET /reports/asset-summary?groupBy=category|custodian|location with
asOfDate-based historical NBV. Null custodian/location grouped as
'ไม่ระบุ'. Filters: branchId, status."
```

---

## Task 6: AssetModule wiring

**Files:**
- Modify: `apps/api/src/modules/asset/asset.module.ts`

- [ ] **Step 6.1: Wire 2 new services + 2 new controllers**

Open `apps/api/src/modules/asset/asset.module.ts`. Add imports + providers + controllers:

```typescript
import { Module } from '@nestjs/common';
import { AssetController } from './asset.controller';
import { AssetTransferController } from './asset-transfer.controller';
import { AssetJournalController } from './asset-journal.controller';
import { AssetReportsController } from './asset-reports.controller';
import { AssetService } from './asset.service';
import { AssetTransferService } from './asset-transfer.service';
import { AssetJournalService } from './asset-journal.service';
import { AssetReportsService } from './asset-reports.service';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [JournalModule],
  controllers: [
    AssetController,
    AssetTransferController,
    AssetJournalController,
    AssetReportsController,
  ],
  providers: [
    AssetService,
    AssetTransferService,
    AssetJournalService,
    AssetReportsService,
  ],
  exports: [
    AssetService,
    AssetTransferService,
    AssetJournalService,
    AssetReportsService,
  ],
})
export class AssetModule {}
```

- [ ] **Step 6.2: Verify all jest tests still pass**

```bash
cd apps/api && npx jest src/modules/asset --runInBand
./tools/check-types.sh api
```

Expected: all jest tests pass (~98 tests = 77 prior + 21 new), 0 type errors.

- [ ] **Step 6.3: Commit**

```bash
git add apps/api/src/modules/asset/asset.module.ts
git commit -m "feat(asset): wire AssetJournalController + AssetReportsController

AssetModule now exposes 4 controllers (AssetController +
AssetTransferController + AssetJournalController + AssetReportsController)
and 4 services."
```

---

## Task 7: Frontend foundation — types, API wrappers, exportRegister util

**Files:**
- Modify: `apps/web/src/pages/assets/types.ts`
- Modify: `apps/web/src/pages/assets/api.ts`
- Create: `apps/web/src/pages/assets/utils/exportRegister.ts`

- [ ] **Step 7.1: Add types**

Append to `apps/web/src/pages/assets/types.ts`:

```typescript
export interface AssetRegisterRow {
  id: string;
  assetCode: string;
  name: string;
  category: AssetCategory;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  custodian: string | null;
  location: string | null;
  purchaseDate: string;
  purchaseCost: string;
  accumulatedDeprAt: string;
  netBookValueAt: string;
  monthlyDepr: string;
  remainingMonths: number;
  status: AssetStatus;
}

export interface AssetRegisterResponse {
  data: AssetRegisterRow[];
  total: number;
  page: number;
  limit: number;
  asOfDate: string;
  summary: {
    count: number;
    totalPurchaseCost: string;
    totalAccumulatedDepr: string;
    totalNbv: string;
  };
}

export interface AssetScheduleRow {
  period: string;
  monthlyDepr: string;
  accumulatedDepr: string;
  netBookValue: string;
  status: 'ACTIVE' | 'FULLY_DEPRECIATED';
}

export interface AssetScheduleResponse {
  assetId: string;
  assetCode: string;
  name: string;
  purchaseDate: string;
  purchaseCost: string;
  residualValue: string;
  monthlyDepr: string;
  rows: AssetScheduleRow[];
}

export interface AssetJournalRow {
  id: string;
  entryNumber: string;
  entryDate: string;
  status: string;
  description: string;
  flow: string;
  assetId: string | null;
  asset: { id: string; assetCode: string; name: string } | null;
  totalDr: string;
  totalCr: string;
  reversed: boolean;
  reversedByEntryNumber: string | null;
}

export interface SummaryRow {
  key: string;
  label: string;
  count: number;
  totalPurchaseCost: string;
  totalAccumulatedDepr: string;
  totalNbv: string;
}

export interface AuditLogEntry {
  id: string;
  userId: string;
  user: { id: string; name: string };
  action: string;
  entity: string;
  entityId: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}
```

- [ ] **Step 7.2: Add API wrappers**

Append to `apps/web/src/pages/assets/api.ts` `assetsApi` object:

```typescript
getRegister: async (filters: {
  asOfDate?: string;
  category?: AssetCategory;
  status?: AssetStatus;
  branchId?: string;
  search?: string;
  page?: number;
  limit?: number;
}): Promise<AssetRegisterResponse> => {
  const params: Record<string, string | number> = {};
  if (filters.asOfDate) params.asOfDate = filters.asOfDate;
  if (filters.category) params.category = filters.category;
  if (filters.status) params.status = filters.status;
  if (filters.branchId) params.branchId = filters.branchId;
  if (filters.search) params.search = filters.search;
  if (filters.page) params.page = filters.page;
  if (filters.limit) params.limit = filters.limit;
  const { data } = await api.get<AssetRegisterResponse>('/assets/register', { params });
  return data;
},

getSchedule: async (id: string): Promise<AssetScheduleResponse> => {
  const { data } = await api.get<AssetScheduleResponse>(`/assets/${id}/schedule`);
  return data;
},

listJournal: async (filters: {
  page?: number;
  limit?: number;
  search?: string;
  flowType?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<{ data: AssetJournalRow[]; total: number; page: number; limit: number }> => {
  const params: Record<string, string | number> = {};
  if (filters.page) params.page = filters.page;
  if (filters.limit) params.limit = filters.limit;
  if (filters.search) params.search = filters.search;
  if (filters.flowType) params.flowType = filters.flowType;
  if (filters.fromDate) params.fromDate = filters.fromDate;
  if (filters.toDate) params.toDate = filters.toDate;
  const { data } = await api.get<{ data: AssetJournalRow[]; total: number; page: number; limit: number }>(
    '/assets/journal', { params },
  );
  return data;
},

summaryReport: async (filters: {
  groupBy: 'category' | 'custodian' | 'location';
  asOfDate?: string;
  status?: AssetStatus;
  branchId?: string;
}): Promise<SummaryRow[]> => {
  const params: Record<string, string> = { groupBy: filters.groupBy };
  if (filters.asOfDate) params.asOfDate = filters.asOfDate;
  if (filters.status) params.status = filters.status;
  if (filters.branchId) params.branchId = filters.branchId;
  const { data } = await api.get<SummaryRow[]>('/reports/asset-summary', { params });
  return data;
},
```

(Add the new types to imports at top of `api.ts` if missing.)

- [ ] **Step 7.3: Create exportRegister.ts**

Create `apps/web/src/pages/assets/utils/exportRegister.ts`:

```typescript
import type { AssetRegisterResponse, AssetRegisterRow } from '../types';

const HEADERS = [
  'รหัสสินทรัพย์', 'ชื่อ', 'หมวด', 'วันที่ซื้อ', 'ราคาทุน',
  'ค่าเสื่อมสะสม', 'NBV', 'ค่าเสื่อม/เดือน', 'เดือนคงเหลือ',
  'ผู้ดูแล', 'ที่ตั้ง', 'สาขา', 'สถานะ',
];

const CATEGORY_LABEL: Record<string, string> = {
  EQUIPMENT: 'อุปกรณ์สำนักงาน',
  IMPROVEMENT: 'ส่วนปรับปรุงอาคาร',
  FURNITURE: 'เครื่องตกแต่งสำนักงาน',
  VEHICLE: 'ยานพาหนะ',
};

function rowsToValues(row: AssetRegisterRow): (string | number)[] {
  return [
    row.assetCode,
    row.name,
    CATEGORY_LABEL[row.category] ?? row.category,
    row.purchaseDate,
    row.purchaseCost,
    row.accumulatedDeprAt,
    row.netBookValueAt,
    row.monthlyDepr,
    row.remainingMonths,
    row.custodian ?? '',
    row.location ?? '',
    row.branch?.name ?? '',
    row.status,
  ];
}

export function exportRegisterCsv(data: AssetRegisterResponse): void {
  const lines = [HEADERS.join(',')];
  for (const row of data.data) {
    const values = rowsToValues(row).map((v) => {
      const s = String(v);
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    });
    lines.push(values.join(','));
  }
  // BOM for Excel UTF-8 compatibility (Thai chars)
  const csv = '﻿' + lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `asset-register-${data.asOfDate}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportRegisterXlsx(data: AssetRegisterResponse): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Asset Register');
  sheet.addRow(HEADERS);
  sheet.getRow(1).font = { bold: true };
  for (const row of data.data) {
    sheet.addRow(rowsToValues(row));
  }
  // Column widths
  sheet.columns = [
    { width: 14 }, { width: 24 }, { width: 22 }, { width: 12 }, { width: 14 },
    { width: 14 }, { width: 14 }, { width: 14 }, { width: 10 },
    { width: 18 }, { width: 18 }, { width: 18 }, { width: 12 },
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `asset-register-${data.asOfDate}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 7.4: Verify typecheck**

```bash
./tools/check-types.sh web
```

Expected: 0 errors.

- [ ] **Step 7.5: Commit**

```bash
git add apps/web/src/pages/assets/types.ts \
        apps/web/src/pages/assets/api.ts \
        apps/web/src/pages/assets/utils/exportRegister.ts
git commit -m "feat(asset): Phase 3 frontend foundation — types/API/export utils

5 new types (AssetRegisterRow/Response, AssetScheduleRow/Response,
AssetJournalRow, SummaryRow, AuditLogEntry). 4 API wrappers
(getRegister, getSchedule, listJournal, summaryReport).
exportRegisterCsv (BOM-prefixed for Excel UTF-8 Thai support) +
exportRegisterXlsx (lazy-loaded exceljs dynamic import)."
```

---

## Task 8: AssetRegisterPage + route + nav

**Files:**
- Create: `apps/web/src/pages/assets/AssetRegisterPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/config/menu.ts`

- [ ] **Step 8.1: Create page**

Create `apps/web/src/pages/assets/AssetRegisterPage.tsx`:

```typescript
import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileSpreadsheet, FileText, Search, BookOpen } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import AnimatedCounter from '@/components/ui/animated-counter';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDateShortThai, formatNumberDecimal } from '@/utils/formatters';
import { getErrorMessage } from '@/lib/api';
import { assetsApi } from './api';
import { exportRegisterCsv, exportRegisterXlsx } from './utils/exportRegister';
import type { AssetRegisterRow, AssetCategory, AssetStatus } from './types';
import { CATEGORY_LABEL } from './types';

const today = () => new Date().toISOString().slice(0, 10);

export default function AssetRegisterPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const asOfDate = searchParams.get('asOfDate') ?? today();
  const category = (searchParams.get('category') ?? '') as AssetCategory | '';
  const status = (searchParams.get('status') ?? '') as AssetStatus | '';
  const [searchInput, setSearchInput] = useState(searchParams.get('search') ?? '');
  const search = useDebounce(searchInput, 300);
  const page = Number(searchParams.get('page') ?? 1);

  const setParam = (key: string, val: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (val) next.set(key, val); else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  };

  const query = useQuery({
    queryKey: ['asset-register', { asOfDate, category, status, search, page }],
    queryFn: () => assetsApi.getRegister({
      asOfDate,
      category: category || undefined,
      status: status || undefined,
      search: search || undefined,
      page, limit: 50,
    }),
  });

  const handleExportCsv = () => {
    if (!query.data) return;
    try {
      exportRegisterCsv(query.data);
      toast.success('ดาวน์โหลด CSV สำเร็จ');
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };
  const handleExportXlsx = async () => {
    if (!query.data) return;
    try {
      await exportRegisterXlsx(query.data);
      toast.success('ดาวน์โหลด Excel สำเร็จ');
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  const columns = useMemo(() => [
    {
      key: 'assetCode',
      label: 'รหัส',
      render: (row: AssetRegisterRow) => (
        <button onClick={() => navigate(`/assets/${row.id}`)} className="font-mono text-primary hover:underline">
          {row.assetCode}
        </button>
      ),
    },
    { key: 'name', label: 'ชื่อ', render: (row: AssetRegisterRow) => row.name },
    { key: 'category', label: 'หมวด', render: (row: AssetRegisterRow) => CATEGORY_LABEL[row.category] ?? row.category },
    { key: 'purchaseDate', label: 'วันที่ซื้อ', render: (row: AssetRegisterRow) => formatDateShortThai(row.purchaseDate) },
    { key: 'purchaseCost', label: 'ราคาทุน', render: (row: AssetRegisterRow) => <span className="tabular-nums">{formatNumberDecimal(parseFloat(row.purchaseCost))}</span> },
    { key: 'accumulatedDeprAt', label: 'ค่าเสื่อมสะสม', render: (row: AssetRegisterRow) => <span className="tabular-nums">{formatNumberDecimal(parseFloat(row.accumulatedDeprAt))}</span> },
    { key: 'netBookValueAt', label: 'NBV', render: (row: AssetRegisterRow) => <span className="tabular-nums font-semibold">{formatNumberDecimal(parseFloat(row.netBookValueAt))}</span> },
    { key: 'remainingMonths', label: 'เดือนคงเหลือ', render: (row: AssetRegisterRow) => row.remainingMonths },
    { key: 'custodian', label: 'ผู้ดูแล', render: (row: AssetRegisterRow) => row.custodian ?? '-' },
  ], [navigate]);

  const summary = query.data?.summary;

  return (
    <div className="space-y-4">
      <PageHeader
        title="ทะเบียนสินทรัพย์"
        subtitle={`ณ วันที่ ${formatDateShortThai(asOfDate)}`}
        icon={<BookOpen className="h-5 w-5" />}
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleExportCsv} disabled={!query.data}>
              <FileText className="mr-2 h-4 w-4" /> CSV
            </Button>
            <Button variant="outline" onClick={handleExportXlsx} disabled={!query.data}>
              <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel
            </Button>
          </div>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <div className="text-sm text-muted-foreground">จำนวน</div>
          <div className="text-2xl font-semibold tabular-nums">
            <AnimatedCounter value={summary?.count ?? 0} />
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-sm text-muted-foreground">ราคาทุนรวม</div>
          <div className="text-2xl font-semibold tabular-nums">
            <AnimatedCounter value={parseFloat(summary?.totalPurchaseCost ?? '0')} decimals={2} />
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-sm text-muted-foreground">ค่าเสื่อมสะสมรวม</div>
          <div className="text-2xl font-semibold tabular-nums">
            <AnimatedCounter value={parseFloat(summary?.totalAccumulatedDepr ?? '0')} decimals={2} />
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-sm text-muted-foreground">NBV รวม</div>
          <div className="text-2xl font-semibold tabular-nums">
            <AnimatedCounter value={parseFloat(summary?.totalNbv ?? '0')} decimals={2} />
          </div>
        </CardContent></Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-sm font-medium mb-1 block">ณ วันที่</label>
            <ThaiDateInput value={asOfDate} onChange={(e) => setParam('asOfDate', e.target.value || null)} />
          </div>
          <Select value={category || 'ALL'} onValueChange={(v) => setParam('category', v === 'ALL' ? null : v)}>
            <SelectTrigger><SelectValue placeholder="หมวด" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ทุกหมวด</SelectItem>
              <SelectItem value="EQUIPMENT">{CATEGORY_LABEL.EQUIPMENT}</SelectItem>
              <SelectItem value="IMPROVEMENT">{CATEGORY_LABEL.IMPROVEMENT}</SelectItem>
              <SelectItem value="FURNITURE">{CATEGORY_LABEL.FURNITURE}</SelectItem>
              <SelectItem value="VEHICLE">{CATEGORY_LABEL.VEHICLE}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status || 'ALL'} onValueChange={(v) => setParam('status', v === 'ALL' ? null : v)}>
            <SelectTrigger><SelectValue placeholder="สถานะ" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ทุกสถานะ</SelectItem>
              <SelectItem value="POSTED">ลงบัญชีแล้ว</SelectItem>
              <SelectItem value="DISPOSED">จำหน่าย</SelectItem>
              <SelectItem value="WRITTEN_OFF">ตัดบัญชี</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-10"
              placeholder="ค้นหา รหัส/ชื่อ/serial"
              value={searchInput}
              onChange={(e) => { setSearchInput(e.target.value); setParam('search', e.target.value || null); }}
            />
          </div>
        </CardContent>
      </Card>

      <QueryBoundary
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
        errorTitle="โหลดทะเบียนสินทรัพย์ไม่สำเร็จ"
      >
        <DataTable
          columns={columns}
          data={query.data?.data ?? []}
          pagination={{
            page,
            totalPages: query.data ? Math.max(1, Math.ceil(query.data.total / 50)) : 1,
            total: query.data?.total ?? 0,
            onPageChange: (p: number) => setParam('page', String(p)),
          }}
        />
      </QueryBoundary>
    </div>
  );
}
```

- [ ] **Step 8.2: Wire route**

In `apps/web/src/App.tsx`, add lazy import + route:

```typescript
const AssetRegisterPage = lazy(() => import('./pages/assets/AssetRegisterPage'));
// ...
<Route path="/assets/register" element={
  <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
    <AssetRegisterPage />
  </ProtectedRoute>
} />
```

**IMPORTANT:** Place route BEFORE `/assets/:id` to avoid `:id` matching `register`.

- [ ] **Step 8.3: Add nav entry**

In `apps/web/src/config/menu.ts`, find where "ค่าเสื่อม" was added in Phase 2 (under OWNER/FINANCE_MANAGER/ACCOUNTANT configs). Add a sibling "ทะเบียนสินทรัพย์" pointing to `/assets/register` with `BookOpen` icon (import from lucide-react).

Match the existing menu schema — likely the same `MenuItem` shape used for "สินทรัพย์" / "ค่าเสื่อม".

- [ ] **Step 8.4: Verify typecheck**

```bash
./tools/check-types.sh web
```

Expected: 0 errors.

- [ ] **Step 8.5: Commit**

```bash
git add apps/web/src/pages/assets/AssetRegisterPage.tsx \
        apps/web/src/App.tsx \
        apps/web/src/config/menu.ts
git commit -m "feat(asset): AssetRegisterPage + route + nav

Page: as-of-date selector + 4 stat cards + filters
(category/status/search) + DataTable with 9 columns + CSV/Excel export.
Route /assets/register before /assets/:id to avoid id-match collision.
Sidebar nav 'ทะเบียนสินทรัพย์' under existing 'สินทรัพย์' section."
```

---

## Task 9: AssetSchedulePage + route (drill-down)

**Files:**
- Create: `apps/web/src/pages/assets/AssetSchedulePage.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 9.1: Create page**

Create `apps/web/src/pages/assets/AssetSchedulePage.tsx`:

```typescript
import { useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { TrendingDown } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import QueryBoundary from '@/components/QueryBoundary';
import { formatDateShortThai, formatNumberDecimal } from '@/utils/formatters';
import { assetsApi } from './api';
import type { AssetScheduleRow } from './types';

export default function AssetSchedulePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ['asset-schedule', id],
    queryFn: () => assetsApi.getSchedule(id!),
    enabled: !!id,
  });

  if (!id) return null;

  const currentMonth = new Date().toISOString().slice(0, 7);

  return (
    <div className="space-y-4">
      <PageHeader
        title="ตารางค่าเสื่อมราคา"
        subtitle={query.data ? `${query.data.assetCode} — ${query.data.name}` : ''}
        icon={<TrendingDown className="h-5 w-5" />}
        onBack={() => navigate(`/assets/${id}`)}
      />

      <QueryBoundary
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
        errorTitle="โหลดตารางค่าเสื่อมไม่สำเร็จ"
      >
        {query.data && (
          <>
            <Card>
              <CardHeader><CardTitle>ข้อมูลสินทรัพย์</CardTitle></CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground">ราคาทุน</dt>
                    <dd className="tabular-nums">{formatNumberDecimal(parseFloat(query.data.purchaseCost))}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">มูลค่าซาก</dt>
                    <dd className="tabular-nums">{formatNumberDecimal(parseFloat(query.data.residualValue))}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">ค่าเสื่อม/เดือน</dt>
                    <dd className="tabular-nums">{formatNumberDecimal(parseFloat(query.data.monthlyDepr))}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">วันที่ซื้อ</dt>
                    <dd>{formatDateShortThai(query.data.purchaseDate)}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>ตาราง NBV รายเดือน ({query.data.rows.length} เดือน)</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-2">งวด</th>
                      <th className="text-right py-2 px-2">ค่าเสื่อม</th>
                      <th className="text-right py-2 px-2">ค่าเสื่อมสะสม</th>
                      <th className="text-right py-2 px-2">NBV</th>
                      <th className="text-left py-2 px-2">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.rows.map((r: AssetScheduleRow) => {
                      const isCurrent = r.period === currentMonth;
                      return (
                        <tr key={r.period} className={`border-b ${isCurrent ? 'bg-muted/40' : ''}`}>
                          <td className="py-2 px-2 font-mono">{r.period}{isCurrent ? ' ←' : ''}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{formatNumberDecimal(parseFloat(r.monthlyDepr))}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{formatNumberDecimal(parseFloat(r.accumulatedDepr))}</td>
                          <td className="py-2 px-2 text-right tabular-nums font-semibold">{formatNumberDecimal(parseFloat(r.netBookValue))}</td>
                          <td className="py-2 px-2">
                            <Badge variant={r.status === 'ACTIVE' ? 'success' : 'outline'}>
                              {r.status === 'ACTIVE' ? 'ใช้งาน' : 'หักครบ'}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}
      </QueryBoundary>
    </div>
  );
}
```

- [ ] **Step 9.2: Wire route**

In `apps/web/src/App.tsx`:

```typescript
const AssetSchedulePage = lazy(() => import('./pages/assets/AssetSchedulePage'));
// ...
<Route path="/assets/:id/schedule" element={
  <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
    <AssetSchedulePage />
  </ProtectedRoute>
} />
```

- [ ] **Step 9.3: Verify + commit**

```bash
./tools/check-types.sh web
git add apps/web/src/pages/assets/AssetSchedulePage.tsx apps/web/src/App.tsx
git commit -m "feat(asset): AssetSchedulePage + route

Per-asset NBV month-by-month projection table. Asset summary card +
schedule table with status badge. Highlights current month row.
Drill-down from /assets/:id (route added in next task)."
```

---

## Task 10: AssetJournalPage + route + nav

**Files:**
- Create: `apps/web/src/pages/assets/AssetJournalPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/config/menu.ts`

- [ ] **Step 10.1: Create page**

Create `apps/web/src/pages/assets/AssetJournalPage.tsx`:

```typescript
import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Search, FileText } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDateShortThai, formatNumberDecimal } from '@/utils/formatters';
import { assetsApi } from './api';
import type { AssetJournalRow } from './types';

const FLOW_LABEL: Record<string, string> = {
  'asset-purchase': 'ซื้อ',
  'asset-purchase-reverse': 'ยกเลิกซื้อ',
  'asset-disposal': 'จำหน่าย',
  'asset-disposal-reverse': 'ยกเลิกจำหน่าย',
  'depreciation': 'ค่าเสื่อม',
  'depreciation-reverse': 'ยกเลิกค่าเสื่อม',
};

export default function AssetJournalPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const flowType = searchParams.get('flowType') ?? '';
  const fromDate = searchParams.get('fromDate') ?? '';
  const toDate = searchParams.get('toDate') ?? '';
  const [searchInput, setSearchInput] = useState(searchParams.get('search') ?? '');
  const search = useDebounce(searchInput, 300);
  const page = Number(searchParams.get('page') ?? 1);

  const setParam = (key: string, val: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (val) next.set(key, val); else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  };

  const query = useQuery({
    queryKey: ['asset-journal', { flowType, fromDate, toDate, search, page }],
    queryFn: () => assetsApi.listJournal({
      flowType: flowType || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      search: search || undefined,
      page, limit: 50,
    }),
  });

  const columns = useMemo(() => [
    { key: 'entryDate', label: 'วันที่', render: (row: AssetJournalRow) => formatDateShortThai(row.entryDate) },
    {
      key: 'entryNumber', label: 'เลขที่ JE',
      render: (row: AssetJournalRow) => <span className="font-mono text-primary">{row.entryNumber}</span>,
    },
    {
      key: 'flow', label: 'ประเภท',
      render: (row: AssetJournalRow) => (
        <Badge variant={row.flow.includes('reverse') ? 'outline' : 'success'}>
          {FLOW_LABEL[row.flow] ?? row.flow}
        </Badge>
      ),
    },
    {
      key: 'asset', label: 'สินทรัพย์',
      render: (row: AssetJournalRow) =>
        row.asset ? (
          <button onClick={() => navigate(`/assets/${row.asset!.id}`)} className="text-left hover:underline">
            <span className="font-mono">{row.asset.assetCode}</span>
            <div className="text-xs text-muted-foreground">{row.asset.name}</div>
          </button>
        ) : '-',
    },
    { key: 'description', label: 'รายละเอียด', render: (row: AssetJournalRow) => row.description },
    { key: 'totalDr', label: 'Dr', render: (row: AssetJournalRow) => <span className="tabular-nums">{formatNumberDecimal(parseFloat(row.totalDr))}</span> },
    {
      key: 'reversed', label: 'สถานะ',
      render: (row: AssetJournalRow) => row.reversed ? <Badge variant="destructive">กลับรายการแล้ว</Badge> : <Badge variant="success">ลงบัญชี</Badge>,
    },
  ], [navigate]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="JV สินทรัพย์"
        subtitle="รายการบัญชีที่เกี่ยวกับสินทรัพย์ทั้งหมด"
        icon={<FileText className="h-5 w-5" />}
      />

      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <Select value={flowType || 'ALL'} onValueChange={(v) => setParam('flowType', v === 'ALL' ? null : v)}>
            <SelectTrigger><SelectValue placeholder="ประเภท" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ทุกประเภท</SelectItem>
              <SelectItem value="asset-purchase">{FLOW_LABEL['asset-purchase']}</SelectItem>
              <SelectItem value="depreciation">{FLOW_LABEL.depreciation}</SelectItem>
              <SelectItem value="asset-disposal">{FLOW_LABEL['asset-disposal']}</SelectItem>
              <SelectItem value="all-reversals">รายการกลับทั้งหมด</SelectItem>
            </SelectContent>
          </Select>
          <ThaiDateInput value={fromDate} onChange={(e) => setParam('fromDate', e.target.value || null)} />
          <ThaiDateInput value={toDate} onChange={(e) => setParam('toDate', e.target.value || null)} />
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-10" placeholder="ค้นหาสินทรัพย์"
              value={searchInput}
              onChange={(e) => { setSearchInput(e.target.value); setParam('search', e.target.value || null); }}
            />
          </div>
        </CardContent>
      </Card>

      <QueryBoundary
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
        errorTitle="โหลด JV ไม่สำเร็จ"
      >
        <DataTable
          columns={columns}
          data={query.data?.data ?? []}
          pagination={{
            page,
            totalPages: query.data ? Math.max(1, Math.ceil(query.data.total / 50)) : 1,
            total: query.data?.total ?? 0,
            onPageChange: (p: number) => setParam('page', String(p)),
          }}
        />
      </QueryBoundary>
    </div>
  );
}
```

- [ ] **Step 10.2: Wire route + nav**

In `apps/web/src/App.tsx`:
```typescript
const AssetJournalPage = lazy(() => import('./pages/assets/AssetJournalPage'));
<Route path="/assets/journal" element={
  <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
    <AssetJournalPage />
  </ProtectedRoute>
} />
```

(Place BEFORE `/assets/:id`.)

In `apps/web/src/config/menu.ts`, add "JV สินทรัพย์" entry under existing "สินทรัพย์" section with `FileText` icon.

- [ ] **Step 10.3: Verify + commit**

```bash
./tools/check-types.sh web
git add apps/web/src/pages/assets/AssetJournalPage.tsx \
        apps/web/src/App.tsx \
        apps/web/src/config/menu.ts
git commit -m "feat(asset): AssetJournalPage + route + nav

Filtered JV list (asset-purchase/depreciation/disposal + all reverses).
Filters: flowType, date range, asset search. Nav 'JV สินทรัพย์' added."
```

---

## Task 11: AssetSummaryReportPage (4 tabs) + route + nav

**Files:**
- Create: `apps/web/src/pages/assets/AssetSummaryReportPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/config/menu.ts`

- [ ] **Step 11.1: Create page**

Create `apps/web/src/pages/assets/AssetSummaryReportPage.tsx`:

```typescript
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, ArrowRightLeft } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { formatDateShortThai, formatDateTime, formatNumberDecimal } from '@/utils/formatters';
import { assetsApi } from './api';
import type { SummaryRow, AssetTransferRow } from './types';

const today = () => new Date().toISOString().slice(0, 10);

function SummaryTable({ data }: { data: SummaryRow[] }) {
  const columns = [
    { key: 'label', label: 'หมวด', render: (r: SummaryRow) => r.label },
    { key: 'count', label: 'จำนวน', render: (r: SummaryRow) => <span className="tabular-nums">{r.count}</span> },
    { key: 'totalPurchaseCost', label: 'ราคาทุน', render: (r: SummaryRow) => <span className="tabular-nums">{formatNumberDecimal(parseFloat(r.totalPurchaseCost))}</span> },
    { key: 'totalAccumulatedDepr', label: 'ค่าเสื่อมสะสม', render: (r: SummaryRow) => <span className="tabular-nums">{formatNumberDecimal(parseFloat(r.totalAccumulatedDepr))}</span> },
    { key: 'totalNbv', label: 'NBV', render: (r: SummaryRow) => <span className="tabular-nums font-semibold">{formatNumberDecimal(parseFloat(r.totalNbv))}</span> },
  ];
  return <DataTable<SummaryRow & { id: string }> columns={columns} data={data.map((r) => ({ ...r, id: r.key }))} />;
}

export default function AssetSummaryReportPage() {
  const [asOfDate, setAsOfDate] = useState(today());
  const [tab, setTab] = useState<'category' | 'custodian' | 'location' | 'movement'>('category');

  const summaryQuery = useQuery({
    queryKey: ['asset-summary', { groupBy: tab, asOfDate }],
    queryFn: () => assetsApi.summaryReport({ groupBy: tab as never, asOfDate }),
    enabled: tab !== 'movement',
  });

  const movementQuery = useQuery({
    queryKey: ['asset-transfers-recent'],
    queryFn: () => assetsApi.listAllTransfers({ limit: 100 }),
    enabled: tab === 'movement',
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="รายงานสรุปสินทรัพย์"
        subtitle={`ณ วันที่ ${formatDateShortThai(asOfDate)}`}
        icon={<BarChart3 className="h-5 w-5" />}
      />

      <Card>
        <CardContent className="p-4">
          <label className="text-sm font-medium mb-1 block">ณ วันที่</label>
          <div className="max-w-xs">
            <ThaiDateInput value={asOfDate} onChange={(e) => setAsOfDate(e.target.value || today())} />
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as never)}>
        <TabsList>
          <TabsTrigger value="category">หมวดหมู่</TabsTrigger>
          <TabsTrigger value="custodian">ผู้ดูแล</TabsTrigger>
          <TabsTrigger value="location">ที่ตั้ง</TabsTrigger>
          <TabsTrigger value="movement">การเคลื่อนไหว</TabsTrigger>
        </TabsList>

        <TabsContent value="category">
          <QueryBoundary isLoading={summaryQuery.isLoading} isError={summaryQuery.isError} error={summaryQuery.error} onRetry={() => summaryQuery.refetch()}>
            <SummaryTable data={summaryQuery.data ?? []} />
          </QueryBoundary>
        </TabsContent>
        <TabsContent value="custodian">
          <QueryBoundary isLoading={summaryQuery.isLoading} isError={summaryQuery.isError} error={summaryQuery.error} onRetry={() => summaryQuery.refetch()}>
            <SummaryTable data={summaryQuery.data ?? []} />
          </QueryBoundary>
        </TabsContent>
        <TabsContent value="location">
          <QueryBoundary isLoading={summaryQuery.isLoading} isError={summaryQuery.isError} error={summaryQuery.error} onRetry={() => summaryQuery.refetch()}>
            <SummaryTable data={summaryQuery.data ?? []} />
          </QueryBoundary>
        </TabsContent>
        <TabsContent value="movement">
          <QueryBoundary isLoading={movementQuery.isLoading} isError={movementQuery.isError} error={movementQuery.error} onRetry={() => movementQuery.refetch()} errorTitle="โหลดประวัติการเคลื่อนไหวไม่สำเร็จ">
            <Card>
              <CardContent className="p-4">
                <ul className="space-y-3">
                  {(movementQuery.data?.data ?? []).map((t: AssetTransferRow) => (
                    <li key={t.id} className="flex gap-3 items-start border-l-2 border-primary pl-3">
                      <ArrowRightLeft className="h-4 w-4 text-muted-foreground mt-1" />
                      <div className="flex-1">
                        <div className="text-sm font-medium">{formatDateShortThai(t.transferDate)} — <span className="font-mono">{t.asset.assetCode}</span> {t.asset.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {t.fromCustodian !== t.toCustodian && <span>ผู้ดูแล: {t.fromCustodian ?? '-'} → <strong>{t.toCustodian ?? '-'}</strong></span>}
                          {t.fromLocation !== t.toLocation && <span> · ที่ตั้ง: {t.fromLocation ?? '-'} → <strong>{t.toLocation ?? '-'}</strong></span>}
                        </div>
                        <div className="text-xs italic mt-1">{t.reason} — {t.transferredBy.name}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </QueryBoundary>
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 11.2: Wire route + nav**

In `apps/web/src/App.tsx`:
```typescript
const AssetSummaryReportPage = lazy(() => import('./pages/assets/AssetSummaryReportPage'));
<Route path="/assets/summary-report" element={
  <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
    <AssetSummaryReportPage />
  </ProtectedRoute>
} />
```

In `apps/web/src/config/menu.ts`, add "รายงานสรุป" entry with `BarChart3` icon under "สินทรัพย์".

- [ ] **Step 11.3: Verify + commit**

```bash
./tools/check-types.sh web
git add apps/web/src/pages/assets/AssetSummaryReportPage.tsx \
        apps/web/src/App.tsx \
        apps/web/src/config/menu.ts
git commit -m "feat(asset): AssetSummaryReportPage (4 tabs) + route + nav

Tabs: หมวดหมู่ / ผู้ดูแล / ที่ตั้ง (DataTable) + การเคลื่อนไหว
(timeline list of last 100 transfers). asOfDate filter shared across
3 aggregation tabs. Nav 'รายงานสรุป' added."
```

---

## Task 12: AssetAuditPage + route (drill-down)

**Files:**
- Create: `apps/web/src/pages/assets/AssetAuditPage.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 12.1: Create page**

```typescript
// apps/web/src/pages/assets/AssetAuditPage.tsx
import { useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { History, ChevronDown, ChevronRight } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import QueryBoundary from '@/components/QueryBoundary';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { formatDateTime } from '@/utils/formatters';
import { assetsApi } from './api';
import type { AuditLogEntry } from './types';

const ACTION_LABEL: Record<string, string> = {
  ASSET_CREATE: 'สร้าง',
  ASSET_UPDATE: 'แก้ไข',
  ASSET_DELETE: 'ลบ',
  ASSET_POST: 'ลงบัญชี',
  ASSET_REVERSE: 'กลับรายการ',
  ASSET_DISPOSE: 'จำหน่าย',
  ASSET_REVERSE_DISPOSE: 'กลับการจำหน่าย',
  ASSET_TRANSFER: 'โอน',
  ASSET_POST_BLOCKED: 'ลงบัญชี (ปิดบัญชี)',
  ASSET_REVERSE_BLOCKED: 'กลับ (ปิดบัญชี)',
  ASSET_DISPOSE_BLOCKED: 'จำหน่าย (ปิดบัญชี)',
  ASSET_REVERSE_DISPOSE_BLOCKED: 'กลับจำหน่าย (ปิดบัญชี)',
};

export default function AssetAuditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [actionFilter, setActionFilter] = useState<string>('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ['asset-audit', id],
    queryFn: () => assetsApi.getAudit(id!),
    enabled: !!id,
  });

  const filtered = useMemo(() => {
    if (!query.data) return [];
    return query.data.filter((log) => {
      if (actionFilter && log.action !== actionFilter) return false;
      if (fromDate && new Date(log.createdAt) < new Date(fromDate)) return false;
      if (toDate) {
        const end = new Date(toDate); end.setHours(23, 59, 59, 999);
        if (new Date(log.createdAt) > end) return false;
      }
      return true;
    });
  }, [query.data, actionFilter, fromDate, toDate]);

  const toggleExpand = (logId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(logId)) next.delete(logId); else next.add(logId);
      return next;
    });
  };

  if (!id) return null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="ประวัติการเปลี่ยนแปลง (Audit Trail)"
        subtitle="แสดง 100 รายการล่าสุด"
        icon={<History className="h-5 w-5" />}
        onBack={() => navigate(`/assets/${id}`)}
      />

      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <Select value={actionFilter || 'ALL'} onValueChange={(v) => setActionFilter(v === 'ALL' ? '' : v)}>
            <SelectTrigger><SelectValue placeholder="Action" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ทุก Action</SelectItem>
              {Object.entries(ACTION_LABEL).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ThaiDateInput value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <ThaiDateInput value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </CardContent>
      </Card>

      <QueryBoundary isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => query.refetch()} errorTitle="โหลดประวัติไม่สำเร็จ">
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {filtered.map((log: AuditLogEntry) => (
                <li key={log.id} className="p-4">
                  <button onClick={() => toggleExpand(log.id)} className="flex items-start gap-2 w-full text-left">
                    {expanded.has(log.id) ? <ChevronDown className="h-4 w-4 mt-1" /> : <ChevronRight className="h-4 w-4 mt-1" />}
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={log.action.endsWith('_BLOCKED') ? 'destructive' : 'success'}>
                          {ACTION_LABEL[log.action] ?? log.action}
                        </Badge>
                        <span className="text-sm text-muted-foreground">{formatDateTime(log.createdAt)}</span>
                        <span className="text-sm">— {log.user.name}</span>
                      </div>
                    </div>
                  </button>
                  {expanded.has(log.id) && (
                    <div className="mt-2 ml-6 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <div className="font-semibold mb-1">ก่อน</div>
                        <pre className="bg-muted p-2 rounded text-xs whitespace-pre-wrap">
                          {JSON.stringify(log.oldValue, null, 2) || '-'}
                        </pre>
                      </div>
                      <div>
                        <div className="font-semibold mb-1">หลัง</div>
                        <pre className="bg-muted p-2 rounded text-xs whitespace-pre-wrap">
                          {JSON.stringify(log.newValue, null, 2) || '-'}
                        </pre>
                      </div>
                    </div>
                  )}
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="p-4 text-center text-muted-foreground">ไม่พบรายการ</li>
              )}
            </ul>
          </CardContent>
        </Card>
      </QueryBoundary>
    </div>
  );
}
```

- [ ] **Step 12.2: Add `getAudit` API wrapper**

In `apps/web/src/pages/assets/api.ts` `assetsApi`, ensure there's a wrapper for `getAudit`:

```typescript
getAudit: async (id: string): Promise<AuditLogEntry[]> => {
  const { data } = await api.get<AuditLogEntry[]>(`/assets/${id}/audit`);
  return data;
},
```

(If already exists from Phase 1, skip.)

- [ ] **Step 12.3: Wire route**

```typescript
const AssetAuditPage = lazy(() => import('./pages/assets/AssetAuditPage'));
<Route path="/assets/:id/audit" element={
  <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
    <AssetAuditPage />
  </ProtectedRoute>
} />
```

- [ ] **Step 12.4: Verify + commit**

```bash
./tools/check-types.sh web
git add apps/web/src/pages/assets/AssetAuditPage.tsx \
        apps/web/src/App.tsx \
        apps/web/src/pages/assets/api.ts
git commit -m "feat(asset): AssetAuditPage + route

Per-asset full audit trail (last 100 entries). Action multi-select
filter + date range. Expandable rows show oldValue/newValue diff in
formatted JSON. Drill-down from /assets/:id."
```

---

## Task 13: AssetDetailPage menu additions

**Files:**
- Modify: `apps/web/src/pages/assets/AssetDetailPage.tsx`

- [ ] **Step 13.1: Add 2 menu items**

In `apps/web/src/pages/assets/AssetDetailPage.tsx`, find the existing DropdownMenuContent action menu. Add 2 items (always visible regardless of status) — "ดูตาราง NBV" and "ดูประวัติทั้งหมด":

```tsx
<DropdownMenuItem onClick={() => navigate(`/assets/${id}/schedule`)}>
  <TrendingDown className="mr-2 h-4 w-4" /> ดูตาราง NBV
</DropdownMenuItem>
<DropdownMenuItem onClick={() => navigate(`/assets/${id}/audit`)}>
  <History className="mr-2 h-4 w-4" /> ดูประวัติทั้งหมด
</DropdownMenuItem>
```

Add imports for `TrendingDown` and `History` from lucide-react if missing.

In the existing audit trail card, add a "ดูประวัติทั้งหมด →" link below the truncated last-10 list:

```tsx
<a onClick={(e) => { e.preventDefault(); navigate(`/assets/${id}/audit`); }}
   className="text-sm text-muted-foreground hover:text-primary underline cursor-pointer">
  ดูประวัติทั้งหมด →
</a>
```

(Use Phase 2 `<Link>` pattern if already established — check existing file. Recent fix replaced `<a onClick>` with `<Link>` so be consistent with project pattern.)

- [ ] **Step 13.2: Verify + commit**

```bash
./tools/check-types.sh web
git add apps/web/src/pages/assets/AssetDetailPage.tsx
git commit -m "feat(asset): DetailPage menu drill-downs to schedule + audit

Two new action menu items always available:
- ดูตาราง NBV → /assets/:id/schedule
- ดูประวัติทั้งหมด → /assets/:id/audit

Plus 'ดูประวัติทั้งหมด' link below truncated audit trail card."
```

---

## Task 14: E2E specs + final verification

**Files:**
- Create: `apps/web/e2e/assets-register.spec.ts`
- Create: `apps/web/e2e/assets-summary-report.spec.ts`
- Create: `apps/web/e2e/assets-journal.spec.ts`
- Create: `apps/web/e2e/asset-audit-trail.spec.ts`

- [ ] **Step 14.1: Create E2E specs (API-driven smoke pattern from Phase 2)**

```typescript
// apps/web/e2e/assets-register.spec.ts
import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';

const API_URL = process.env.API_DIRECT_URL ?? 'http://localhost:3000';

test('register endpoint returns historical NBV', async ({ page }) => {
  await loginAsRole(page, 'FINANCE_MANAGER');
  const today = new Date().toISOString().slice(0, 10);
  const res = await page.request.get(`${API_URL}/api/assets/register?asOfDate=${today}`);
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body).toHaveProperty('data');
  expect(body).toHaveProperty('summary');
  expect(body.summary).toHaveProperty('totalNbv');
});
```

```typescript
// apps/web/e2e/assets-summary-report.spec.ts
import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';

const API_URL = process.env.API_DIRECT_URL ?? 'http://localhost:3000';

test('summary report returns array for each groupBy', async ({ page }) => {
  await loginAsRole(page, 'FINANCE_MANAGER');
  for (const groupBy of ['category', 'custodian', 'location']) {
    const res = await page.request.get(`${API_URL}/api/reports/asset-summary?groupBy=${groupBy}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  }
});
```

```typescript
// apps/web/e2e/assets-journal.spec.ts
import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';

const API_URL = process.env.API_DIRECT_URL ?? 'http://localhost:3000';

test('asset journal endpoint returns paginated rows', async ({ page }) => {
  await loginAsRole(page, 'FINANCE_MANAGER');
  const res = await page.request.get(`${API_URL}/api/assets/journal?limit=10`);
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body).toHaveProperty('data');
  expect(body).toHaveProperty('total');
  expect(body.limit).toBe(10);
});
```

```typescript
// apps/web/e2e/asset-audit-trail.spec.ts
import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';

const API_URL = process.env.API_DIRECT_URL ?? 'http://localhost:3000';

test('per-asset audit endpoint returns log entries', async ({ page }) => {
  await loginAsRole(page, 'FINANCE_MANAGER');
  // Create + post an asset
  const createRes = await page.request.post(`${API_URL}/api/assets`, {
    data: {
      name: 'E2E Audit Test',
      category: 'EQUIPMENT',
      basePrice: 5000,
      usefulLifeMonths: 12,
      purchaseDate: new Date().toISOString().slice(0, 10),
      paymentAccount: '11-1201',
    },
  });
  const created = await createRes.json();
  await page.request.post(`${API_URL}/api/assets/${created.id}/post`);

  const auditRes = await page.request.get(`${API_URL}/api/assets/${created.id}/audit`);
  expect(auditRes.ok()).toBeTruthy();
  const audit = await auditRes.json();
  expect(Array.isArray(audit)).toBe(true);
  expect(audit.length).toBeGreaterThanOrEqual(1);
});
```

- [ ] **Step 14.2: Final verification**

```bash
./tools/check-types.sh all
cd apps/api && npx jest src/modules/asset --runInBand
```

Expected: 0 type errors. ~98 jest tests pass (77 prior + 21 new).

- [ ] **Step 14.3: Branch summary**

```bash
git log --oneline main..feat/asset-module-phase3 | wc -l
git log --oneline main..feat/asset-module-phase3 | head -20
```

Confirm 13-14 task commits.

- [ ] **Step 14.4: Commit E2E + final**

```bash
git add apps/web/e2e/assets-register.spec.ts \
        apps/web/e2e/assets-summary-report.spec.ts \
        apps/web/e2e/assets-journal.spec.ts \
        apps/web/e2e/asset-audit-trail.spec.ts
git commit -m "test(asset): Phase 3 4 E2E smoke specs

API-driven smoke tests for register, summary-report (3 groupBy),
journal, and per-asset audit endpoints. Pattern matches Phase 2
(API state changes + assertions on response shape)."
```

---

## Self-Review

**1. Spec coverage:**

| Spec section | Task |
|--------------|------|
| Section A — AssetRegisterPage with historical NBV + CSV/XLSX | Tasks 1, 3, 7, 8 |
| Section B — AssetSchedulePage per-asset NBV projection | Tasks 2, 3, 9 |
| Section C — AssetJournalPage filtered JV list | Tasks 4, 6, 10 |
| Section D — AssetSummaryReportPage 4 tabs | Tasks 5, 6, 11 |
| Section E — AssetAuditPage per-asset detail | Task 12 |
| AssetDetailPage drill-down menu | Task 13 |
| 4 E2E smoke specs | Task 14 |
| Permissions matrix (all 4 roles read access) | Tasks 3, 4, 5 (controllers) |

**2. Placeholder scan:** No "TBD" / "implement later" / vague handwave. Every step has explicit code or commands.

**3. Type consistency:**
- `AssetRegisterRow` referenced in Tasks 1, 7, 8 — same shape (id, assetCode, name, ..., netBookValueAt, monthlyDepr, remainingMonths, status).
- `AssetScheduleResponse` referenced in Tasks 2, 7, 9 — consistent.
- `AssetJournalRow` referenced in Tasks 4, 7, 10.
- `SummaryRow` referenced in Tasks 5, 7, 11.
- API method signatures (`getRegister`, `getSchedule`, `listJournal`, `summaryReport`) match controller endpoints.
- Service method names: `getRegister`, `getAssetSchedule`, `list` (journal), `summary` (reports) — consistent across tasks.

**4. Known soft spots flagged inline:**
- Task 3: route ordering critical (`register` before `:id` literal route)
- Task 8/10/11: route ordering same constraint
- Task 7: `exceljs` already in `apps/web` package.json — verified
- Task 8: `parseFloat` on monetary string fields — Phase 2 review pattern accepted this for display formatting (production-acceptable since `formatNumberDecimal` is just a display helper)

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-09-asset-module-phase3.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks. ~14 task cycles.

**2. Inline Execution** — execute in this session via executing-plans.

**Which approach?**
