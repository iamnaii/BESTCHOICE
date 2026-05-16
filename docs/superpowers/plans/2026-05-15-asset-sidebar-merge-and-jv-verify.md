# Asset Sidebar Merge + JV Verify — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 2 Critical fixes from accountant's ImplementationReview v1.2: (P1) verify JV page works after deploy, (P2) merge 5 flat asset menu items into 1 collapsible parent with DRAFT count badge + new global Audit Log sub-item.

**Architecture:** Frontend-only schema change (`MenuItem.children?`) + Sidebar render update + 3 role-config refactors + new backend endpoint `GET /assets/audit` + AssetAuditPage adapted for global mode. Reuse existing `accordion-menu.tsx` nesting (`nestedStates` already in context). No DB migration.

**Tech Stack:** React 18 + TypeScript + Tailwind + shadcn/ui + lucide-react (frontend) · NestJS + Prisma (backend) · React Query for data fetching · React Router 7 for routes.

**Spec:** [docs/superpowers/specs/2026-05-15-asset-sidebar-merge-and-jv-verify-design.md](../specs/2026-05-15-asset-sidebar-merge-and-jv-verify-design.md)

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `apps/web/src/config/menu.ts` | Modify | Extend `MenuItem` schema (`children?`, `badgeKey?`); refactor 3 role configs (OWNER, FINANCE_MANAGER, ACCOUNTANT) to use nested asset parent |
| `apps/web/src/components/layout/Sidebar.tsx` | Modify | Render nested `MenuItem.children` as collapsible sub-accordion + show optional badge from `useDraftAssetCount` |
| `apps/web/src/App.tsx` | Modify | Add `<Route path="/assets/audit" element={<AssetAuditPage />} />` BEFORE existing `/assets/:id/audit` (more specific first) |
| `apps/web/src/pages/assets/AssetAuditPage.tsx` | Modify | Make `id` from `useParams` optional; route to `getGlobalAudit()` when missing; hide back-link + show Asset column in global mode |
| `apps/web/src/pages/assets/api.ts` | Modify | Add `getGlobalAudit(filters?)` calling `GET /assets/audit` |
| `apps/web/src/pages/assets/types.ts` | Modify | Add `GlobalAuditLogEntry` type (extends `AuditLogEntry` with `assetCode`, `assetName`) |
| `apps/web/src/hooks/useDraftAssetCount.ts` | Create | React Query hook calling `assetsApi.list({ status: 'DRAFT', limit: 1 })`, returns `total`; 30s refetch + on focus |
| `apps/api/src/modules/asset/asset.controller.ts` | Modify | Add `@Get('audit')` handler delegating to new service method |
| `apps/api/src/modules/asset/asset.service.ts` | Modify | Add `listGlobalAudit(filters)` → query `auditLog` where `entity = 'fixed_asset'` (snake_case, matches Prisma `FixedAsset` model), join asset for code+name |
| `apps/api/src/modules/asset/__tests__/asset-global-audit.spec.ts` | Create | Integration test: returns paginated rows, filters by entity, role guards |
| `apps/web/src/pages/assets/__tests__/AssetAuditPage.global.test.tsx` | Create | Component test: route without `:id` calls `getGlobalAudit`, renders Asset column |

---

## Task 1: P1 Verification — Document + Plan Smoke Test (No Code Change)

**Files:**
- Modify: `docs/superpowers/specs/2026-05-15-asset-sidebar-merge-and-jv-verify-design.md` (already documents the 4-step verification; this task just acknowledges)

- [ ] **Step 1: Confirm backend code is correct (re-verify)**

```bash
grep -n "@Controller" apps/api/src/modules/asset/asset-journal.controller.ts
grep -n "AssetJournalController\|AssetModule" apps/api/src/modules/asset/asset.module.ts apps/api/src/app.module.ts
grep -n "/assets/journal" apps/web/src/pages/assets/api.ts
```

Expected output:
- `asset-journal.controller.ts:10:@Controller('assets/journal')`
- `asset.module.ts:17: AssetJournalController,`
- `app.module.ts:239: AssetModule,`
- `api.ts:199: }>('/assets/journal', { params });`

- [ ] **Step 2: Confirm middleware path-mapping works**

```bash
grep -n "AdminPrefixMiddleware\|setGlobalPrefix" apps/api/src/main.ts
grep -n "API_URL\|/api/admin" apps/web/src/lib/env.ts
```

Expected: backend `setGlobalPrefix('api')` + `AdminPrefixMiddleware` strips `/admin/*` → URL path `/api/admin/assets/journal` resolves to controller `@Controller('assets/journal')` ✅

- [ ] **Step 3: No commit (no code change for P1)**

Sign-off Criteria #6 closes only after PR 1 deploy + manual smoke test in Task 9. Move on.

---

## Task 2: Extend MenuItem Schema (children + badgeKey)

**Files:**
- Modify: `apps/web/src/config/menu.ts:54-78`

- [ ] **Step 1: Add `MenuBadgeKey` union and extend `MenuItem` + `BottomNavItem`**

Edit `apps/web/src/config/menu.ts`. Replace lines 54-78 with:

```ts
/* ── Types ─────────────────────────────────────────── */

export type MenuBadgeKey = 'chat-unread' | 'asset-draft-count';

export interface MenuItem {
  label: string;
  path: string;
  icon: LucideIcon;
  children?: MenuItem[];   // when present, item renders as collapsible group (path is not navigable)
  badgeKey?: MenuBadgeKey; // optional dynamic count badge
}

export interface MenuSection {
  key: string;
  label: string;
  icon: LucideIcon;
  items: MenuItem[];
}

export interface BottomNavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  badgeKey?: MenuBadgeKey;  // promoted from inline 'chat-unread' literal
  action?: 'sidebar';
}

export interface RoleMenuConfig {
  sidebar: MenuSection[];
  bottomNav: BottomNavItem[];
}
```

- [ ] **Step 2: Run type check to ensure no regressions**

```bash
./tools/check-types.sh web
```

Expected: 0 errors. Existing `badgeKey: 'chat-unread'` at line 267 still type-checks because `'chat-unread'` is in the union.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/config/menu.ts
git commit -m "feat(menu): add children + badgeKey to MenuItem schema"
```

---

## Task 3: Sidebar Render — Nested Collapsible Support

**Files:**
- Modify: `apps/web/src/components/layout/Sidebar.tsx:338-358` (the `sections.map` render block)

- [ ] **Step 1: Read current render to confirm anchor point**

```bash
sed -n '338,358p' apps/web/src/components/layout/Sidebar.tsx
```

Note: items are rendered as `<AccordionMenuItem><Link to={item.path}>`. For items with `children`, swap to a nested `<AccordionMenuSub>` with a `<AccordionMenuSubContent>` that renders the children as `<AccordionMenuItem>` rows.

- [ ] **Step 2: Update the items map to branch on `item.children`**

Replace the inner `section.items.map((item) => ( ... ))` block (lines 345-355) with:

```tsx
{section.items.map((item) =>
  item.children && item.children.length > 0 ? (
    <AccordionMenuSub key={item.path} value={item.path} data-testid={`nav-${item.path}`}>
      <AccordionMenuSubTrigger>
        <item.icon data-slot="accordion-menu-icon" className="size-[15px] shrink-0 opacity-70" />
        <span data-slot="accordion-menu-title">{item.label}</span>
        {item.badgeKey && <NavBadge badgeKey={item.badgeKey} />}
      </AccordionMenuSubTrigger>
      <AccordionMenuSubContent parentValue={item.path} type="single" collapsible>
        {item.children.map((child) => (
          <AccordionMenuItem key={child.path} value={child.path} className="text-[15px]">
            <Link to={child.path} className="flex items-center gap-2.5 w-full">
              <child.icon data-slot="accordion-menu-icon" className="size-[15px] shrink-0 opacity-70" />
              <span data-slot="accordion-menu-title">{child.label}</span>
            </Link>
          </AccordionMenuItem>
        ))}
      </AccordionMenuSubContent>
    </AccordionMenuSub>
  ) : (
    <AccordionMenuItem key={item.path} value={item.path} className="text-[15px]">
      <Link to={item.path} className="flex items-center gap-2.5 w-full">
        <item.icon
          data-slot="accordion-menu-icon"
          className="size-[15px] shrink-0 opacity-70"
        />
        <span data-slot="accordion-menu-title">{item.label}</span>
      </Link>
    </AccordionMenuItem>
  )
)}
```

Note: `NavBadge` is a tiny inline component defined in the same file. Add this before the `Sidebar` component (around the imports):

```tsx
import { useDraftAssetCount } from '@/hooks/useDraftAssetCount';

function NavBadge({ badgeKey }: { badgeKey: MenuBadgeKey }) {
  // chat-unread handled elsewhere by existing bottom-nav badge; sidebar only consumes asset-draft-count
  const draftCount = useDraftAssetCount(badgeKey === 'asset-draft-count');
  if (badgeKey !== 'asset-draft-count') return null;
  if (!draftCount || draftCount === 0) return null;
  return (
    <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-medium bg-primary/15 text-primary">
      {draftCount}
    </span>
  );
}
```

Also add `MenuBadgeKey` to the imports from `@/config/menu`:

```tsx
import type { MenuSection, MenuBadgeKey } from '@/config/menu';
```

- [ ] **Step 3: Run type check**

```bash
./tools/check-types.sh web
```

Expected: 0 errors. (`useDraftAssetCount` will be unresolved — that's Task 8; defer to step 4 of this task by stubbing temporarily.)

If type check fails on `useDraftAssetCount` import, create a temporary stub:

```bash
mkdir -p apps/web/src/hooks
cat > apps/web/src/hooks/useDraftAssetCount.ts <<'EOF'
// Stub — real implementation in Task 8
export function useDraftAssetCount(_enabled: boolean): number | undefined {
  return undefined;
}
EOF
```

Re-run type check — expect 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/layout/Sidebar.tsx apps/web/src/hooks/useDraftAssetCount.ts
git commit -m "feat(sidebar): render nested collapsible menu items + draft badge slot"
```

---

## Task 4: Refactor menu.ts — Nested Asset Menu for 3 Role Configs

**Files:**
- Modify: `apps/web/src/config/menu.ts:244-248` (FINANCE_MANAGER), `:296-300` (ACCOUNTANT), `:386-390` (OWNER)

- [ ] **Step 1: Define a shared `assetMenuItem` constant near the top of role configs**

Add this constant just before the `SALES_CONFIG` declaration (around line 80) so it's shared by all 3 role configs:

```ts
/* ── Shared menu items ─────────────────────────────── */

const assetMenuItem: MenuItem = {
  label: 'สินทรัพย์',
  path: '/assets',
  icon: Landmark,
  badgeKey: 'asset-draft-count',
  children: [
    { label: 'บันทึกซื้อ',                          path: '/assets',                icon: FileText },
    { label: 'ทะเบียน + มูลค่าตามบัญชีสุทธิ (NBV)', path: '/assets/register',       icon: BookOpen },
    { label: 'สมุดรายวัน',                          path: '/assets/journal',        icon: FileText },
    { label: 'สรุปแยกหมวด',                         path: '/assets/summary-report', icon: BarChart3 },
    { label: 'ค่าเสื่อม',                           path: '/depreciation',          icon: TrendingDown },
    { label: 'Audit Log',                            path: '/assets/audit',          icon: History },
  ],
};
```

Add `History` to the lucide-react import block at the top of the file if not already present.

- [ ] **Step 2: Replace 5 flat items with single `assetMenuItem` reference in FINANCE_MANAGER config**

In the `fm-finance` section (around line 236-251), replace lines 244-248 (the 5 flat asset items) with a single line:

```ts
      items: [
        { label: 'ค่าคอมมิชชัน', path: '/commissions', icon: Coins },
        { label: 'รายจ่าย', path: '/expenses', icon: Receipt },
        { label: 'รายได้อื่น', path: '/other-income', icon: TrendingUp },
        { label: 'กำไร-ขาดทุน', path: '/profit-loss', icon: PieChart },
        assetMenuItem,
        { label: 'งวดบัญชี', path: '/accounting/periods', icon: CalendarDays },
      ],
```

- [ ] **Step 3: Same replacement for ACCOUNTANT config (around line 287-302)**

Replace lines 296-300 with `assetMenuItem,`:

```ts
      items: [
        { label: 'รายได้อื่น', path: '/other-income', icon: TrendingUp },
        { label: 'กำไร-ขาดทุน', path: '/profit-loss', icon: PieChart },
        { label: 'ภาษี', path: '/tax-reports', icon: Calculator },
        { label: 'รายงาน', path: '/reports', icon: BarChart3 },
        assetMenuItem,
      ],
```

- [ ] **Step 4: Same replacement for OWNER config (around line 377-392)**

Find lines 386-390 and replace with `assetMenuItem,`. Keep surrounding items intact.

- [ ] **Step 5: Run type check + visual sanity check**

```bash
./tools/check-types.sh web
```

Expected: 0 errors.

Start dev server and visually confirm 3 roles still render their sidebars (Task 9 covers full UAT):

```bash
cd apps/web && npm run dev
```

Open browser → login as ACCOUNTANT → see "สินทรัพย์" as collapsible parent in `บัญชี & รายงาน` group. Click → expand → 6 children visible. (Audit Log will 404 until Task 7 — that's expected.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/config/menu.ts
git commit -m "feat(menu): refactor asset menu to collapsible parent (3 role configs)"
```

---

## Task 5: Backend — `GET /assets/audit` Endpoint (TDD)

**Files:**
- Create: `apps/api/src/modules/asset/__tests__/asset-global-audit.spec.ts`
- Modify: `apps/api/src/modules/asset/asset.controller.ts` (add `@Get('audit')` method)
- Modify: `apps/api/src/modules/asset/asset.service.ts` (add `listGlobalAudit` method)

- [ ] **Step 1: Write failing integration test**

Create `apps/api/src/modules/asset/__tests__/asset-global-audit.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { AssetController } from '../asset.controller';
import { AssetService } from '../asset.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';

describe('AssetController — GET /assets/audit (global)', () => {
  let controller: AssetController;
  let prisma: { auditLog: { findMany: jest.Mock; count: jest.Mock }; asset: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      auditLog: { findMany: jest.fn(), count: jest.fn() },
      asset: { findMany: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AssetController],
      providers: [
        AssetService,
        { provide: PrismaService, useValue: prisma },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();
    controller = module.get(AssetController);
  });

  it('returns paginated audit rows with entity="asset"', async () => {
    prisma.auditLog.findMany.mockResolvedValue([
      { id: 'a1', action: 'ASSET_POST', entity: 'fixed_asset', entityId: 'asset-1', userId: 'u1', createdAt: new Date(), payload: {} },
    ]);
    prisma.auditLog.count.mockResolvedValue(1);
    prisma.asset.findMany.mockResolvedValue([{ id: 'asset-1', code: 'EQ-001', name: 'MacBook' }]);

    const result = await controller.listGlobalAudit(undefined, undefined, undefined, undefined, undefined);

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ entity: 'fixed_asset' }),
      take: 50,
      skip: 0,
    }));
    expect(result.data).toHaveLength(1);
    expect(result.data[0].assetCode).toBe('EQ-001');
    expect(result.data[0].assetName).toBe('MacBook');
    expect(result.total).toBe(1);
  });

  it('respects page + limit (max 200)', async () => {
    prisma.auditLog.findMany.mockResolvedValue([]);
    prisma.auditLog.count.mockResolvedValue(0);
    prisma.asset.findMany.mockResolvedValue([]);

    await controller.listGlobalAudit('3', '500', undefined, undefined, undefined);

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 200,  // capped from 500
      skip: 400,  // (page 3 - 1) * 200
    }));
  });

  it('filters by action when provided', async () => {
    prisma.auditLog.findMany.mockResolvedValue([]);
    prisma.auditLog.count.mockResolvedValue(0);
    prisma.asset.findMany.mockResolvedValue([]);

    await controller.listGlobalAudit(undefined, undefined, 'ASSET_POST', undefined, undefined);

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ entity: 'fixed_asset', action: 'ASSET_POST' }),
    }));
  });

  it('filters by date range when provided', async () => {
    prisma.auditLog.findMany.mockResolvedValue([]);
    prisma.auditLog.count.mockResolvedValue(0);
    prisma.asset.findMany.mockResolvedValue([]);

    await controller.listGlobalAudit(undefined, undefined, undefined, '2026-05-01', '2026-05-31');

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        entity: 'fixed_asset',
        createdAt: expect.objectContaining({ gte: expect.any(Date), lte: expect.any(Date) }),
      }),
    }));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/api && npx jest src/modules/asset/__tests__/asset-global-audit.spec.ts -t "GET /assets/audit"
```

Expected: FAIL with `controller.listGlobalAudit is not a function` or compile error.

- [ ] **Step 3: Add service method `listGlobalAudit`**

Open `apps/api/src/modules/asset/asset.service.ts`. Add this method to the class:

```ts
async listGlobalAudit(params: {
  page?: number;
  limit?: number;
  action?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<{ data: Array<{ id: string; action: string; entityId: string; userId: string; createdAt: Date; payload: unknown; assetCode: string | null; assetName: string | null }>; total: number; page: number; limit: number }> {
  const page = params.page && params.page > 0 ? params.page : 1;
  const limit = params.limit && params.limit > 0 ? Math.min(params.limit, 200) : 50;

  const where: Record<string, unknown> = { entity: 'fixed_asset' };
  if (params.action) where.action = params.action;
  if (params.fromDate || params.toDate) {
    const range: Record<string, Date> = {};
    if (params.fromDate) range.gte = new Date(params.fromDate);
    if (params.toDate) {
      const end = new Date(params.toDate);
      end.setHours(23, 59, 59, 999);
      range.lte = end;
    }
    where.createdAt = range;
  }

  const [logs, total] = await Promise.all([
    this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    this.prisma.auditLog.count({ where }),
  ]);

  // Batch lookup assets to avoid N+1
  const assetIds = Array.from(new Set(logs.map((l) => l.entityId).filter((id): id is string => Boolean(id))));
  const assets = assetIds.length
    ? await this.prisma.asset.findMany({
        where: { id: { in: assetIds } },
        select: { id: true, code: true, name: true },
      })
    : [];
  const assetById = new Map(assets.map((a) => [a.id, a]));

  return {
    data: logs.map((log) => ({
      id: log.id,
      action: log.action,
      entityId: log.entityId ?? '',
      userId: log.userId ?? '',
      createdAt: log.createdAt,
      payload: log.payload,
      assetCode: log.entityId ? assetById.get(log.entityId)?.code ?? null : null,
      assetName: log.entityId ? assetById.get(log.entityId)?.name ?? null : null,
    })),
    total,
    page,
    limit,
  };
}
```

- [ ] **Step 4: Add controller method `listGlobalAudit`**

Open `apps/api/src/modules/asset/asset.controller.ts`. Add this method to the class (before the closing brace):

```ts
@Get('audit')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
listGlobalAudit(
  @Query('page') page?: string,
  @Query('limit') limit?: string,
  @Query('action') action?: string,
  @Query('fromDate') fromDate?: string,
  @Query('toDate') toDate?: string,
) {
  const parsedPage = page ? parseInt(page, 10) : undefined;
  const parsedLimit = limit ? parseInt(limit, 10) : undefined;
  return this.service.listGlobalAudit({
    page: Number.isInteger(parsedPage) && parsedPage! > 0 ? parsedPage : undefined,
    limit: Number.isInteger(parsedLimit) && parsedLimit! > 0 ? parsedLimit : undefined,
    action,
    fromDate,
    toDate,
  });
}
```

Note: place the `@Get('audit')` BEFORE any `@Get(':id')` handler in the same controller so the literal `audit` is matched first (NestJS route order matters with dynamic segments).

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd apps/api && npx jest src/modules/asset/__tests__/asset-global-audit.spec.ts -t "GET /assets/audit"
```

Expected: 4 tests PASS.

- [ ] **Step 6: Run API-wide type check**

```bash
./tools/check-types.sh api
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/asset/asset.controller.ts apps/api/src/modules/asset/asset.service.ts apps/api/src/modules/asset/__tests__/asset-global-audit.spec.ts
git commit -m "feat(asset): GET /assets/audit global audit feed endpoint"
```

---

## Task 6: Frontend — `getGlobalAudit` API Call + Type

**Files:**
- Modify: `apps/web/src/pages/assets/api.ts:57-58` (after existing `getAudit`)
- Modify: `apps/web/src/pages/assets/types.ts` (add `GlobalAuditLogEntry`)

- [ ] **Step 1: Add `GlobalAuditLogEntry` type**

Open `apps/web/src/pages/assets/types.ts`. Find the existing `AuditLogEntry` type (it already exists since `AssetAuditPage` imports it). Add:

```ts
export interface GlobalAuditLogEntry extends AuditLogEntry {
  assetCode: string | null;
  assetName: string | null;
}

export interface GlobalAuditListResponse {
  data: GlobalAuditLogEntry[];
  total: number;
  page: number;
  limit: number;
}
```

- [ ] **Step 2: Add `getGlobalAudit` to assetsApi**

Open `apps/web/src/pages/assets/api.ts`. After the existing `getAudit` method (around line 60), add:

```ts
  getGlobalAudit: async (filters?: {
    page?: number;
    limit?: number;
    action?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<GlobalAuditListResponse> => {
    const params: Record<string, string | number> = {};
    if (filters?.page) params.page = filters.page;
    if (filters?.limit) params.limit = filters.limit;
    if (filters?.action) params.action = filters.action;
    if (filters?.fromDate) params.fromDate = filters.fromDate;
    if (filters?.toDate) params.toDate = filters.toDate;
    const { data } = await api.get<GlobalAuditListResponse>('/assets/audit', { params });
    return data;
  },
```

Update the import line at the top of `api.ts` if needed:

```ts
import type { AuditLogEntry, GlobalAuditListResponse } from './types';
```

- [ ] **Step 3: Run type check**

```bash
./tools/check-types.sh web
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/assets/api.ts apps/web/src/pages/assets/types.ts
git commit -m "feat(asset): getGlobalAudit API + GlobalAuditLogEntry type"
```

---

## Task 7: Frontend — `/assets/audit` Route + AssetAuditPage Global Mode

**Files:**
- Create: `apps/web/src/pages/assets/__tests__/AssetAuditPage.global.test.tsx`
- Modify: `apps/web/src/App.tsx` (add route before `/assets/:id/audit`)
- Modify: `apps/web/src/pages/assets/AssetAuditPage.tsx` (support global mode)

- [ ] **Step 1: Write failing component test**

Create `apps/web/src/pages/assets/__tests__/AssetAuditPage.global.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import AssetAuditPage from '../AssetAuditPage';

vi.mock('../api', () => ({
  assetsApi: {
    getAudit: vi.fn().mockResolvedValue([]),
    getGlobalAudit: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 }),
  },
}));

const renderAt = (path: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/assets/audit" element={<AssetAuditPage />} />
          <Route path="/assets/:id/audit" element={<AssetAuditPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('AssetAuditPage — global vs per-asset mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('global mode: calls getGlobalAudit when route has no :id', async () => {
    const { assetsApi } = await import('../api');
    renderAt('/assets/audit');
    await waitFor(() => expect(assetsApi.getGlobalAudit).toHaveBeenCalled());
    expect(assetsApi.getAudit).not.toHaveBeenCalled();
  });

  it('per-asset mode: calls getAudit when route has :id', async () => {
    const { assetsApi } = await import('../api');
    renderAt('/assets/asset-123/audit');
    await waitFor(() => expect(assetsApi.getAudit).toHaveBeenCalledWith('asset-123'));
    expect(assetsApi.getGlobalAudit).not.toHaveBeenCalled();
  });

  it('global mode: header text shows "ทั้งหมด"', async () => {
    renderAt('/assets/audit');
    await waitFor(() => expect(screen.getByText(/Audit Log.*สินทรัพย์.*ทั้งหมด/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/web && npx vitest run src/pages/assets/__tests__/AssetAuditPage.global.test.tsx
```

Expected: FAIL — page returns null when no id (current line 65).

- [ ] **Step 3: Update AssetAuditPage to support global mode**

Open `apps/web/src/pages/assets/AssetAuditPage.tsx`. Modify the top of the component:

```tsx
export default function AssetAuditPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const isGlobal = !id;
  const [actionFilter, setActionFilter] = useState<string>('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const perAssetQuery = useQuery({
    queryKey: ['asset-audit', id],
    queryFn: () => assetsApi.getAudit(id!),
    enabled: !!id,
  });

  const globalQuery = useQuery({
    queryKey: ['asset-audit-global', actionFilter, fromDate, toDate],
    queryFn: () => assetsApi.getGlobalAudit({
      action: actionFilter || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
    }),
    enabled: isGlobal,
  });

  // Unified data shape for rendering
  const logs: Array<AuditLogEntry & { assetCode?: string | null; assetName?: string | null }> = isGlobal
    ? (globalQuery.data?.data ?? [])
    : (perAssetQuery.data ?? []);
  const isLoading = isGlobal ? globalQuery.isLoading : perAssetQuery.isLoading;

  const filtered = useMemo(() => {
    return logs.filter((log) => {
      if (actionFilter && log.action !== actionFilter) return false;
      if (fromDate && new Date(log.createdAt) < new Date(fromDate)) return false;
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        if (new Date(log.createdAt) > end) return false;
      }
      return true;
    });
  }, [logs, actionFilter, fromDate, toDate]);

  // remove "if (!id) return null;"

  // ... existing render with adjustments below ...
```

Update the header section (around line 70-75) to show different title and back-link in global mode:

```tsx
<PageHeader
  title={isGlobal ? 'Audit Log สินทรัพย์ทั้งหมด' : 'Audit Log สินทรัพย์'}
  onBack={isGlobal ? () => navigate('/assets') : () => navigate(`/assets/${id}`)}
/>
```

Update the table rendering: when global mode, prepend an Asset column. Locate the `<li>` rendering for each log entry (around line 104) and insert before the action chip:

```tsx
{isGlobal && (
  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
    <span className="font-mono">{(log as { assetCode?: string | null }).assetCode ?? '—'}</span>
    <span>·</span>
    <span>{(log as { assetName?: string | null }).assetName ?? '—'}</span>
  </span>
)}
```

Adjust the `enabled` and `isError` props passed to QueryBoundary similarly (use `isGlobal ? globalQuery : perAssetQuery` properties).

- [ ] **Step 4: Add `/assets/audit` route in App.tsx BEFORE `/assets/:id/audit`**

Open `apps/web/src/App.tsx`. Locate the existing `/assets/:id/audit` route (around line 854). Add a new Route just before it:

```tsx
<Route
  path="/assets/audit"
  element={
    <ProtectedRoute>
      <MainLayout>
        <AssetAuditPage />
      </MainLayout>
    </ProtectedRoute>
  }
/>
```

Order matters: React Router matches in order; `/assets/audit` must come before `/assets/:id/audit` so the literal `audit` isn't captured as `:id`.

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd apps/web && npx vitest run src/pages/assets/__tests__/AssetAuditPage.global.test.tsx
```

Expected: 3 tests PASS.

- [ ] **Step 6: Run type check**

```bash
./tools/check-types.sh web
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/pages/assets/AssetAuditPage.tsx apps/web/src/pages/assets/__tests__/AssetAuditPage.global.test.tsx
git commit -m "feat(asset): add /assets/audit global route + AssetAuditPage global mode"
```

---

## Task 8: `useDraftAssetCount` Hook + Sidebar Badge Wire-up

**Files:**
- Modify: `apps/web/src/hooks/useDraftAssetCount.ts` (replace the stub from Task 3)

- [ ] **Step 1: Implement the hook**

Open `apps/web/src/hooks/useDraftAssetCount.ts`. Replace the stub with:

```ts
import { useQuery } from '@tanstack/react-query';
import { assetsApi } from '@/pages/assets/api';

export function useDraftAssetCount(enabled: boolean): number | undefined {
  const query = useQuery({
    queryKey: ['asset-draft-count'],
    queryFn: () => assetsApi.list({ status: 'DRAFT', limit: 1, page: 1 }),
    enabled,
    refetchInterval: 30_000,        // 30s
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
  return query.data?.total;
}
```

Verify that `assetsApi.list` exists and accepts `{ status, limit, page }` — if its signature differs in [api.ts](apps/web/src/pages/assets/api.ts), align by reading the file. If status is not yet a supported filter, add it to the existing `list` method:

```bash
grep -n "list: async" apps/web/src/pages/assets/api.ts | head -3
```

If `list` doesn't support `status` filter, extend it:
- Add `status?: string` to its filters param
- Forward to backend via query string: `if (filters.status) params.status = filters.status;`
- Confirm backend `/assets` controller accepts a `status` query (it should — check `apps/api/src/modules/asset/asset.controller.ts`)

- [ ] **Step 2: Run type check**

```bash
./tools/check-types.sh web
```

Expected: 0 errors.

- [ ] **Step 3: Manual smoke test of badge in browser**

```bash
cd apps/web && npm run dev
```

- Login as ACCOUNTANT
- Navigate to `/assets` → create 1 DRAFT (or use an existing DRAFT)
- Open sidebar → expand "บัญชี & รายงาน" → see "🏛 สินทรัพย์" with badge "1" on the right
- Delete the DRAFT (or change to POSTED) → wait 30s → badge disappears

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/hooks/useDraftAssetCount.ts apps/web/src/pages/assets/api.ts
git commit -m "feat(sidebar): wire DRAFT count badge via useDraftAssetCount"
```

---

## Task 9: Final Integration — Type Check + Test Suite + Smoke Test Plan

**Files:** none (verification only)

- [ ] **Step 1: Run full type check**

```bash
./tools/check-types.sh all
```

Expected: 0 errors across web and api.

- [ ] **Step 2: Run new tests**

```bash
cd apps/api && npx jest src/modules/asset/__tests__/asset-global-audit.spec.ts
cd apps/web && npx vitest run src/pages/assets/__tests__/AssetAuditPage.global.test.tsx
```

Expected: ALL PASS (4 backend + 3 frontend = 7 new tests).

- [ ] **Step 3: Confirm full asset module tests still pass**

```bash
cd apps/api && npx jest src/modules/asset
cd apps/web && npx vitest run src/pages/assets
```

Expected: 0 regressions in existing asset module tests. (Note: per Acknowledgment §3.2, broader test infra has 104 failing tests deferred to a separate PR — this is OK as long as the asset-module subset passes.)

- [ ] **Step 4: Manual UAT script (run after deploy to staging)**

For each role in **[OWNER, FINANCE_MANAGER, ACCOUNTANT]**:

1. Login as the role
2. Open sidebar → group `บัญชี & รายงาน` → confirm "🏛 สินทรัพย์" appears as collapsible parent
3. Click "🏛 สินทรัพย์" → expand → confirm exactly 6 children:
   - 📝 บันทึกซื้อ → click → /assets renders (AssetsListPage)
   - 📒 ทะเบียน + มูลค่าตามบัญชีสุทธิ (NBV) → click → /assets/register renders
   - 📓 สมุดรายวัน → click → /assets/journal renders (200 OK + table) **← P1 verify**
   - 📊 สรุปแยกหมวด → click → /assets/summary-report renders
   - 📅 ค่าเสื่อม → click → /depreciation renders
   - 📋 Audit Log → click → /assets/audit renders global feed
4. Create 1 DRAFT asset doc → wait 30s → confirm badge "1" appears on "🏛 สินทรัพย์"
5. POST the DRAFT → wait 30s → confirm badge disappears
6. Visit `/assets/register` directly via URL → confirm "🏛 สินทรัพย์" auto-expands
7. Open per-asset audit `/assets/{id}/audit` → confirm existing behavior unchanged (no Asset column, back-link to asset detail)

- [ ] **Step 5: Capture screenshots for accountant sign-off**

Take 5 screenshots:
1. New sidebar collapsed (showing "🏛 สินทรัพย์" with badge)
2. New sidebar expanded (showing all 6 children)
3. `/assets/journal` page rendered with 200 OK (closes Sign-off Criteria #6 / P1)
4. `/assets/audit` global feed rendered (closes new P2 sub-item)
5. `/assets/{id}/audit` per-asset view (regression check)

- [ ] **Step 6: No additional commit needed — final state is on `feat/asset-sidebar-merge` branch**

Open PR with title:
```
fix(assets): sidebar merge to collapsible + global Audit Log (P1+P2 from accountant review)
```

PR body should reference:
- Spec: `docs/superpowers/specs/2026-05-15-asset-sidebar-merge-and-jv-verify-design.md`
- Plan: `docs/superpowers/plans/2026-05-15-asset-sidebar-merge-and-jv-verify.md`
- Closes Sign-off Criteria #6 (JV API) and #7 (Sidebar merge) from `Acknowledgment_v1.pdf` §5
- Attach 5 screenshots from Step 5

- [ ] **Step 7: Dispatch `code-reviewer` agent**

```
@code-reviewer review feat/asset-sidebar-merge branch
```

Address any Critical findings before merging. Warnings/Info can be deferred to PR 2 as long as they're tracked.

---

## Out of Scope (Explicitly Deferred per Spec §5)

- P3-P17 (15 important + minor items) → PR 2 (separate brainstorm)
- 11-4102 transfer flow → Phase 2 backlog
- Test infra fix (104 failing tests) → separate PR
- Production DB orphan verification (`verify-asset-orphans.ts`) → Owner manual action
- UAT 8 cases (UAT_Checklist_v1.pdf) → accounting team post-PR-1

---

## Final Self-Review Notes

- **Spec coverage:** P1 ✓ (Task 1), P2 schema ✓ (Task 2), P2 render ✓ (Task 3), P2 menu refactor ✓ (Task 4), P2 backend audit ✓ (Task 5), P2 frontend audit API ✓ (Task 6), P2 route + page mode ✓ (Task 7), P2 DRAFT badge ✓ (Task 8), verification ✓ (Task 9).
- **Tests:** 4 backend + 3 frontend = 7 new tests covering the new endpoint and global page mode. Type check across all 9 tasks. Manual UAT script for 3 roles.
- **Frequent commits:** 8 commits (one per task, except Task 1 = no code and Task 9 = verification only).
- **TDD applied where it pays off:** backend endpoint and AssetAuditPage global mode. Type check + manual visual is sufficient for the menu refactor and Sidebar render.
