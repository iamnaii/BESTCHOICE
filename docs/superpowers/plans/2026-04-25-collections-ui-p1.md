# Collections UI Enhancements — P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ส่ง P1 features 14 ตัวสำหรับหน้า `/collections` — ต่อจาก P0 foundation: presets, sort, timeline filter, snooze, undo, keyboard shortcuts, trending arrow, snapshot, call-result quick-tags, PDF preview, broken-promise auto-suggest, aging bucket, leaderboard, stuck contracts, `/overdue` redirect

**Architecture:** ใช้ foundation ที่ ship ไปแล้วจาก P0 (DateRangePicker, FilterDrawer, CommandPalette, enriched queue response, ContractCard indicators, queue filter fields, URL sync). P1 เพิ่ม reusable components (UndoSnackbar hook, KeyboardShortcutsOverlay, SnoozeDialog) + new backend endpoints (snooze CRUD, analytics aging/leaderboard/stuck, broken-promise cron). Backend schema เพิ่ม 2 tables: ContractSnooze, ContractDailySnapshot.

**Tech Stack:** เหมือน P0 + `react-hotkeys-hook` (new dep) + `cron` (existing for new cron jobs)

**Working Branch:** `feat/collections-ui-p1` (create from P0 merged state)

**Depends on:** P0 plan shipped + merged (`docs/superpowers/plans/2026-04-25-collections-ui-p0.md`)

---

## Scope & Task Order

14 Features จาก P1 priority bucket + `/overdue` redirect:
- Task 1: Schema additions — `ContractSnooze` + `ContractDailySnapshot` (prerequisite)
- Task 2: ContractDailySnapshot cron (foundation for trending arrow)
- Task 3: Saved Filter Presets (A3) — schema FilterPreset + CRUD + UI
- Task 4: Sort Options (A4) — dropdown + backend orderBy
- Task 5: Customer 360 Timeline Filter (A5) — chip bar + date range
- Task 6: Snooze backend (B2 BE) — endpoint + queue filter integration
- Task 7: Snooze frontend (B2 FE) — dialog + card state badge
- Task 8: Undo snackbar pattern (B3) — `useUndoMutation` hook + wire existing mutations
- Task 9: Keyboard shortcuts (B6) — global hotkey handler + overlay
- Task 10: Trending arrow activation (B1 follow-up) — UI indicator when snapshot data ≥7 days
- Task 11: Customer 360 Snapshot Preview (C1) — hover/long-press panel + endpoint
- Task 12: Call Result Quick-Tags (C2) — CallLog schema extension + radio chips in dialog
- Task 13: Letter PDF Preview Popup (D3) — Dialog with iframe/pdf.js
- Task 14: Broken Promise Auto-Suggest (D5) — daily cron + PromiseTab banner
- Task 15: Aging Bucket analytics (E1) — backend endpoint + chart
- Task 16: Collector Leaderboard (E2) — OWNER analytics table
- Task 17: Stuck Contracts widget (E4) — no-activity-14d table + reassign bulk
- Task 18: `/overdue` redirect + banner (F) — router change + 14-day banner

**Parallelizable clusters** (after Task 1+2 foundation):
- α: Task 3 (presets) — own schema
- β: Task 4 + Task 5 (sort + timeline filter) — small UI additions
- γ: Task 6 + Task 7 (snooze backend + frontend serial)
- δ: Task 8 + Task 9 (undo + keyboard shortcuts)
- ε: Task 10 (trending arrow) + Task 11 (snapshot preview)
- ζ: Task 12 (quick tags) + Task 13 (PDF preview)
- η: Task 14 (broken promise cron)
- θ: Task 15 + Task 16 + Task 17 (analytics)
- ι: Task 18 (redirect)

Recommended: Task 1 + 2 serial → 9 parallel clusters → ~4-5 days to ship

---

## File Structure

### New files (web)
```
apps/web/src/pages/CollectionsPage/components/FilterPresetsDropdown.tsx
apps/web/src/pages/CollectionsPage/components/SortDropdown.tsx
apps/web/src/pages/CollectionsPage/components/TimelineFilterChips.tsx
apps/web/src/pages/CollectionsPage/components/SnoozeDialog.tsx
apps/web/src/pages/CollectionsPage/components/Customer360SnapshotCard.tsx
apps/web/src/pages/CollectionsPage/components/CallResultChips.tsx
apps/web/src/pages/CollectionsPage/components/LetterPdfPreviewDialog.tsx
apps/web/src/pages/CollectionsPage/components/BrokenPromiseBanner.tsx
apps/web/src/pages/CollectionsPage/components/StuckContractsSection.tsx
apps/web/src/pages/CollectionsPage/components/KeyboardShortcutsOverlay.tsx
apps/web/src/pages/CollectionsPage/hooks/useUndoMutation.ts
apps/web/src/pages/CollectionsPage/hooks/useFilterPresets.ts
apps/web/src/pages/CollectionsPage/hooks/useSnooze.ts
apps/web/src/pages/CollectionsPage/hooks/useContractSnapshot.ts
apps/web/src/pages/CollectionsPage/hooks/useAnalyticsAging.ts
apps/web/src/pages/CollectionsPage/hooks/useLeaderboard.ts
apps/web/src/pages/CollectionsPage/hooks/useStuckContracts.ts
apps/web/src/pages/CollectionsPage/constants/systemPresets.ts
apps/web/src/pages/CollectionsPage/tabs/AnalyticsTab/AgingBucketChart.tsx
apps/web/src/pages/CollectionsPage/tabs/AnalyticsTab/LeaderboardTable.tsx
apps/web/src/hooks/useKeyboardShortcuts.ts
```

### New files (api)
```
apps/api/src/modules/filter-presets/filter-presets.module.ts
apps/api/src/modules/filter-presets/filter-presets.controller.ts
apps/api/src/modules/filter-presets/filter-presets.service.ts
apps/api/src/modules/filter-presets/dto/create-preset.dto.ts
apps/api/src/modules/filter-presets/filter-presets.service.spec.ts
apps/api/src/modules/overdue/snooze.service.ts
apps/api/src/modules/overdue/dto/snooze.dto.ts
apps/api/src/modules/overdue/snooze.service.spec.ts
apps/api/src/modules/overdue/contract-snapshot.cron.ts
apps/api/src/modules/overdue/broken-promise-reminder.cron.ts
apps/api/src/modules/overdue/analytics-aging.service.ts
apps/api/src/modules/overdue/analytics-leaderboard.service.ts
apps/api/src/modules/overdue/stuck-contracts.service.ts
```

### Files to modify
```
apps/api/prisma/schema.prisma                                        — 3 new models
apps/api/src/modules/overdue/queue.service.ts                       — exclude snoozed, add orderBy dropdown
apps/api/src/modules/overdue/dto/queue-query.dto.ts                  — add sort fields
apps/api/src/modules/overdue/analytics.service.ts                    — add aging/leaderboard/stuck endpoints
apps/api/src/modules/overdue/overdue.controller.ts                  — add snooze + analytics endpoints
apps/web/src/pages/CollectionsPage/components/ContractCard.tsx      — snooze badge + trending arrow
apps/web/src/pages/CollectionsPage/components/FilterChipsBar.tsx    — presets dropdown slot
apps/web/src/pages/CollectionsPage/tabs/AnalyticsTab.tsx            — aging + leaderboard + stuck sections
apps/web/src/pages/CollectionsPage/components/Customer360Timeline.tsx — filter chips + date range
apps/web/src/pages/CollectionsPage/components/ContactLogDialog.tsx  — call result chips
apps/web/src/pages/CollectionsPage/components/LetterQueueSection.tsx — PDF preview button
apps/web/src/pages/CollectionsPage/tabs/PromiseTab.tsx              — broken-promise banner
apps/web/src/pages/CollectionsPage/hooks/useApprovalQueues.ts       — wire useUndoMutation
apps/web/src/pages/CollectionsPage/hooks/useBulkActions.ts          — wire useUndoMutation
apps/web/src/App.tsx                                                 — /overdue redirect + banner + shortcuts provider
apps/web/src/pages/OverduePage.tsx                                  — DELETE after redirect ships
```

---

## Task 1: Schema Additions (ContractSnooze + ContractDailySnapshot + FilterPreset)

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/YYYYMMDD_add_snooze_snapshot_preset/migration.sql`

- [ ] **Step 1: Add enum + 3 models to schema.prisma**

Edit `apps/api/prisma/schema.prisma`:
```prisma
enum FilterPresetScope {
  PRIVATE
  SHARED_BRANCH
  SHARED_ALL
}

model ContractSnooze {
  id String @id @default(uuid())
  contractId String
  contract Contract @relation(fields: [contractId], references: [id])
  userId String
  user User @relation(fields: [userId], references: [id])
  snoozedUntil DateTime
  reason String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?

  @@index([userId, snoozedUntil])
  @@index([contractId, deletedAt])
}

model ContractDailySnapshot {
  id String @id @default(uuid())
  contractId String
  contract Contract @relation(fields: [contractId], references: [id])
  date DateTime @db.Date
  daysOverdue Int
  outstanding Decimal @db.Decimal(12, 2)
  status ContractStatus
  createdAt DateTime @default(now())
  /// Immutable daily snapshot — updatedAt/deletedAt intentionally omitted

  @@unique([contractId, date])
  @@index([date])
  @@index([contractId, date(sort: Desc)])
}

model FilterPreset {
  id String @id @default(uuid())
  name String
  ownerUserId String
  owner User @relation(fields: [ownerUserId], references: [id])
  scope FilterPresetScope @default(PRIVATE)
  branchId String?
  branch Branch? @relation(fields: [branchId], references: [id])
  page String
  filterJson Json
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?

  @@index([ownerUserId, page])
  @@index([scope, branchId])
}
```

เพิ่ม back-relations ใน Contract, User, Branch models:
```prisma
model Contract {
  // ...
  snoozes ContractSnooze[]
  dailySnapshots ContractDailySnapshot[]
}

model User {
  // ...
  snoozes ContractSnooze[]
  filterPresets FilterPreset[]
}

model Branch {
  // ...
  filterPresets FilterPreset[]
}
```

- [ ] **Step 2: Generate migration**

Run:
```bash
cd apps/api && npx prisma migrate dev --name add_snooze_snapshot_preset --create-only
```
Review generated SQL before applying.

- [ ] **Step 3: Apply migration + generate client**

Run:
```bash
cd apps/api && npx prisma migrate dev
```
Expected: migration applies + Prisma client regenerated

- [ ] **Step 4: Type check**

Run: `./tools/check-types.sh api`
Expected: `API: OK`

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "$(cat <<'EOF'
feat(schema): add ContractSnooze, ContractDailySnapshot, FilterPreset models

- ContractSnooze: per-user snooze for contract cards (unique active per user+contract via deletedAt soft-delete semantics)
- ContractDailySnapshot: immutable daily rollup (daysOverdue, outstanding, status) for trending arrow + analytics
- FilterPreset: saved filter UI presets with scope (PRIVATE/SHARED_BRANCH/SHARED_ALL)

Indexes optimized for queue filter exclude + trending arrow lookup + preset retrieval.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: ContractDailySnapshot Cron

**Files:**
- Create: `apps/api/src/modules/overdue/contract-snapshot.cron.ts`
- Test: `apps/api/src/modules/overdue/contract-snapshot.cron.spec.ts`
- Modify: `apps/api/src/modules/overdue/overdue.module.ts`

- [ ] **Step 1: Write failing test**

Create `apps/api/src/modules/overdue/contract-snapshot.cron.spec.ts`:
```ts
describe('ContractSnapshotCron', () => {
  it('creates one snapshot per active overdue contract', async () => {
    // seed 3 contracts: 2 OVERDUE, 1 CLOSED
    await cron.runDaily();
    const snapshots = await prisma.contractDailySnapshot.findMany();
    expect(snapshots).toHaveLength(2);
  });

  it('does not duplicate snapshot for same date (unique constraint)', async () => {
    await cron.runDaily();
    await cron.runDaily(); // rerun same day
    const snapshots = await prisma.contractDailySnapshot.count();
    expect(snapshots).toBe(2);
  });

  it('prunes snapshots older than 30 days', async () => {
    await prisma.contractDailySnapshot.create({
      data: { contractId: 'c1', date: subDays(new Date(), 45), daysOverdue: 10, outstanding: 0, status: 'CLOSED' },
    });
    await cron.runDaily();
    const old = await prisma.contractDailySnapshot.findFirst({ where: { date: subDays(new Date(), 45) } });
    expect(old).toBeNull();
  });
});
```

- [ ] **Step 2: Implement cron**

Create `contract-snapshot.cron.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import * as Sentry from '@sentry/node';
import { subDays } from 'date-fns';

@Injectable()
export class ContractSnapshotCron {
  private readonly logger = new Logger(ContractSnapshotCron.name);

  constructor(private prisma: PrismaService) {}

  // Daily 00:10 Bangkok = 17:10 UTC
  @Cron('10 17 * * *', { timeZone: 'Asia/Bangkok' })
  async runDaily(): Promise<void> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const activeOverdue = await this.prisma.contract.findMany({
        where: {
          deletedAt: null,
          status: { in: ['OVERDUE', 'DEFAULT', 'LEGAL'] },
          daysOverdue: { gt: 0 },
        },
        select: { id: true, daysOverdue: true, outstanding: true, status: true },
      });

      await this.prisma.contractDailySnapshot.createMany({
        data: activeOverdue.map((c) => ({
          contractId: c.id,
          date: today,
          daysOverdue: c.daysOverdue,
          outstanding: c.outstanding,
          status: c.status,
        })),
        skipDuplicates: true,
      });

      // Prune >30 days
      const cutoff = subDays(today, 30);
      await this.prisma.contractDailySnapshot.deleteMany({
        where: { date: { lt: cutoff } },
      });

      this.logger.log(`Snapshotted ${activeOverdue.length} contracts; pruned older than ${cutoff.toISOString()}`);
    } catch (err) {
      this.logger.error('Snapshot cron failed', err);
      Sentry.captureException(err);
      throw err;
    }
  }
}
```

- [ ] **Step 3: Register in module**

Edit `apps/api/src/modules/overdue/overdue.module.ts` providers:
```ts
import { ContractSnapshotCron } from './contract-snapshot.cron';
// ... providers: [..., ContractSnapshotCron]
```

- [ ] **Step 4: Run test**

Run: `cd apps/api && npx jest contract-snapshot.cron.spec`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/overdue/contract-snapshot.cron.ts \
        apps/api/src/modules/overdue/contract-snapshot.cron.spec.ts \
        apps/api/src/modules/overdue/overdue.module.ts
git commit -m "$(cat <<'EOF'
feat(overdue): ContractDailySnapshot cron (daily 00:10 Bangkok)

Snapshots daysOverdue/outstanding/status for every active overdue contract daily.
Prunes snapshots older than 30 days each run.

Foundation for trending arrow (Task 10) and analytics historical trends.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Saved Filter Presets (A3)

**Files:**
- Create: `apps/api/src/modules/filter-presets/` (full module)
- Create: `apps/web/src/pages/CollectionsPage/components/FilterPresetsDropdown.tsx`
- Create: `apps/web/src/pages/CollectionsPage/hooks/useFilterPresets.ts`
- Create: `apps/web/src/pages/CollectionsPage/constants/systemPresets.ts`
- Modify: `apps/web/src/pages/CollectionsPage/components/FilterChipsBar.tsx`

### Backend

- [ ] **Step 1: Scaffold module**

Run: `./tools/generate-module.sh filter-presets`

- [ ] **Step 2: Write failing tests**

Create `apps/api/src/modules/filter-presets/filter-presets.service.spec.ts`:
```ts
describe('FilterPresetsService', () => {
  it('creates PRIVATE preset for user', async () => {
    const preset = await service.create({ name: 'My', scope: 'PRIVATE', page: 'collections-queue', filterJson: {} }, 'u1');
    expect(preset.ownerUserId).toBe('u1');
    expect(preset.scope).toBe('PRIVATE');
  });

  it('rejects SHARED_ALL for non-OWNER', async () => {
    await expect(
      service.create({ name: 'X', scope: 'SHARED_ALL', page: 'collections-queue', filterJson: {} }, 'u1', 'SALES'),
    ).rejects.toThrow(/ไม่มีสิทธิ์/);
  });

  it('lists PRIVATE + SHARED_BRANCH for branch manager', async () => {
    // seed 3 presets: 1 PRIVATE u1, 1 SHARED_BRANCH br1, 1 SHARED_ALL
    const presets = await service.list({ userId: 'u1', userRole: 'BRANCH_MANAGER', branchId: 'br1', page: 'collections-queue' });
    expect(presets).toHaveLength(3); // all visible to BM of branch
  });
});
```

- [ ] **Step 3: Implement service + controller + DTO**

`dto/create-preset.dto.ts`:
```ts
import { IsString, IsEnum, IsObject, IsOptional, MinLength, MaxLength } from 'class-validator';
import { FilterPresetScope } from '@prisma/client';

export class CreatePresetDto {
  @IsString() @MinLength(1) @MaxLength(50) name!: string;
  @IsEnum(FilterPresetScope, { message: 'scope ไม่ถูกต้อง' }) scope!: FilterPresetScope;
  @IsString() page!: string;
  @IsObject() filterJson!: Record<string, any>;
  @IsOptional() @IsString() branchId?: string;
}
```

`filter-presets.service.ts`:
```ts
import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePresetDto } from './dto/create-preset.dto';

@Injectable()
export class FilterPresetsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreatePresetDto, userId: string, userRole?: string) {
    if (dto.scope === 'SHARED_ALL' && userRole !== 'OWNER') {
      throw new ForbiddenException('ไม่มีสิทธิ์สร้าง preset สำหรับทุกสาขา');
    }
    if (dto.scope === 'SHARED_BRANCH' && !['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER'].includes(userRole ?? '')) {
      throw new ForbiddenException('ไม่มีสิทธิ์สร้าง preset สำหรับทั้งสาขา');
    }
    return this.prisma.filterPreset.create({
      data: {
        name: dto.name,
        scope: dto.scope,
        page: dto.page,
        filterJson: dto.filterJson,
        branchId: dto.branchId,
        ownerUserId: userId,
      },
    });
  }

  async list({ userId, userRole, branchId, page }: { userId: string; userRole: string; branchId: string | null; page: string }) {
    return this.prisma.filterPreset.findMany({
      where: {
        page,
        deletedAt: null,
        OR: [
          { scope: 'PRIVATE', ownerUserId: userId },
          { scope: 'SHARED_ALL' },
          { scope: 'SHARED_BRANCH', branchId: branchId ?? undefined },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async delete(id: string, userId: string, userRole: string) {
    const preset = await this.prisma.filterPreset.findFirst({ where: { id, deletedAt: null } });
    if (!preset) throw new NotFoundException();
    if (preset.ownerUserId !== userId && userRole !== 'OWNER') {
      throw new ForbiddenException('ลบได้เฉพาะ preset ของตนเอง');
    }
    return this.prisma.filterPreset.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
```

`filter-presets.controller.ts`:
```ts
@Controller('filter-presets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FilterPresetsController {
  constructor(private service: FilterPresetsService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  list(@Req() req: any, @Query('page') page: string) {
    return this.service.list({ userId: req.user.id, userRole: req.user.role, branchId: req.user.branchId, page });
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  create(@Body() dto: CreatePresetDto, @Req() req: any) {
    return this.service.create(dto, req.user.id, req.user.role);
  }

  @Delete(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  delete(@Param('id') id: string, @Req() req: any) {
    return this.service.delete(id, req.user.id, req.user.role);
  }
}
```

- [ ] **Step 4: Register module**

Edit `apps/api/src/app.module.ts` imports → add `FilterPresetsModule`.

- [ ] **Step 5: Run tests**

Run: `cd apps/api && npx jest filter-presets.service.spec`
Expected: PASS

### Frontend

- [ ] **Step 6: Create system presets constant**

Create `apps/web/src/pages/CollectionsPage/constants/systemPresets.ts`:
```ts
import type { QueueFilterState } from '../hooks/useQueueFilter';

export interface SystemPreset {
  key: string;
  name: string;
  filter: QueueFilterState;
}

export const SYSTEM_PRESETS: SystemPreset[] = [
  {
    key: 'urgent-today',
    name: 'ด่วนวันนี้',
    filter: { assigned: 'self', overdueBuckets: ['1-7'] },
  },
  {
    key: 'overdue-60-plus',
    name: 'เลยกำหนด 60+',
    filter: { overdueBuckets: ['61-90', '90+'] },
  },
  {
    key: 'legal-pipeline',
    name: 'LEGAL pipeline',
    filter: { contractStatuses: ['LEGAL'] },
  },
  {
    key: 'untouched-7-days',
    name: 'ยังไม่แตะ 7 วัน',
    filter: { lastContacted: 'over_7_days' },
  },
];
```

- [ ] **Step 7: Create useFilterPresets hook**

Create `apps/web/src/pages/CollectionsPage/hooks/useFilterPresets.ts`:
```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export function useListPresets(page: string) {
  return useQuery({
    queryKey: ['filter-presets', page],
    queryFn: async () => (await api.get('/filter-presets', { params: { page } })).data,
  });
}

export function useCreatePreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; scope: string; page: string; filterJson: any; branchId?: string }) =>
      api.post('/filter-presets', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['filter-presets'] });
      toast.success('บันทึก preset แล้ว');
    },
  });
}

export function useDeletePreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/filter-presets/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['filter-presets'] });
      toast.success('ลบ preset แล้ว');
    },
  });
}
```

- [ ] **Step 8: Create FilterPresetsDropdown**

Create `apps/web/src/pages/CollectionsPage/components/FilterPresetsDropdown.tsx`:
```tsx
import { useState } from 'react';
import { ChevronDown, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { SYSTEM_PRESETS } from '../constants/systemPresets';
import { useListPresets, useCreatePreset, useDeletePreset } from '../hooks/useFilterPresets';
import type { QueueFilterState } from '../hooks/useQueueFilter';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  currentFilter: QueueFilterState;
  onApply: (filter: QueueFilterState) => void;
}

export function FilterPresetsDropdown({ currentFilter, onApply }: Props) {
  const { user } = useAuth();
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'PRIVATE' | 'SHARED_BRANCH' | 'SHARED_ALL'>('PRIVATE');

  const presetsQuery = useListPresets('collections-queue');
  const create = useCreatePreset();
  const del = useDeletePreset();

  const userPresets = presetsQuery.data ?? [];
  const canShareBranch = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER'].includes(user?.role ?? '');
  const canShareAll = user?.role === 'OWNER';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            Presets <ChevronDown className="ml-1 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64">
          <DropdownMenuLabel>ระบบแนะนำ</DropdownMenuLabel>
          {SYSTEM_PRESETS.map((p) => (
            <DropdownMenuItem key={p.key} onSelect={() => onApply(p.filter)}>
              {p.name}
            </DropdownMenuItem>
          ))}
          {userPresets.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>ของฉัน/ทีม</DropdownMenuLabel>
              {userPresets.map((p: any) => (
                <DropdownMenuItem key={p.id} onSelect={() => onApply(p.filterJson)} className="group flex justify-between">
                  <span>{p.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      del.mutate(p.id);
                    }}
                    className="opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </DropdownMenuItem>
              ))}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSaveOpen(true)}>
            <Save className="mr-2 h-4 w-4" /> บันทึก filter ปัจจุบัน
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>บันทึก Filter Preset</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>ชื่อ preset</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>ขอบเขต</Label>
              <RadioGroup value={scope} onValueChange={(v: any) => setScope(v)}>
                <div className="flex items-center gap-2"><RadioGroupItem value="PRIVATE" id="sc-p" /><Label htmlFor="sc-p">ของฉันเท่านั้น</Label></div>
                {canShareBranch && <div className="flex items-center gap-2"><RadioGroupItem value="SHARED_BRANCH" id="sc-b" /><Label htmlFor="sc-b">สาขาของฉัน</Label></div>}
                {canShareAll && <div className="flex items-center gap-2"><RadioGroupItem value="SHARED_ALL" id="sc-a" /><Label htmlFor="sc-a">ทุกสาขา</Label></div>}
              </RadioGroup>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>ยกเลิก</Button>
            <Button onClick={() => {
              create.mutate({ name, scope, page: 'collections-queue', filterJson: currentFilter });
              setSaveOpen(false);
              setName('');
            }}>บันทึก</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 9: Wire into FilterChipsBar**

Edit `FilterChipsBar.tsx` — add `<FilterPresetsDropdown currentFilter={filter} onApply={(f) => setFilter(f)} />` to the left of the "Filter" button.

- [ ] **Step 10: Type check + tests + commit**

Run: `./tools/check-types.sh all && cd apps/api && npx jest filter-presets`

Commit:
```bash
git add apps/api/src/modules/filter-presets/ \
        apps/api/src/app.module.ts \
        apps/web/src/pages/CollectionsPage/constants/systemPresets.ts \
        apps/web/src/pages/CollectionsPage/hooks/useFilterPresets.ts \
        apps/web/src/pages/CollectionsPage/components/FilterPresetsDropdown.tsx \
        apps/web/src/pages/CollectionsPage/components/FilterChipsBar.tsx
git commit -m "$(cat <<'EOF'
feat(collections): saved filter presets with scope (PRIVATE/SHARED_BRANCH/SHARED_ALL)

4 hardcoded system presets: ด่วนวันนี้ / เลยกำหนด 60+ / LEGAL pipeline / ยังไม่แตะ 7 วัน
+ user-saved presets with role-gated sharing:
- PRIVATE: any authenticated user
- SHARED_BRANCH: OWNER/BRANCH_MANAGER/FINANCE_MANAGER
- SHARED_ALL: OWNER only

CRUD endpoints at /filter-presets with soft-delete + branch scoping.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Sort Options (A4)

**Files:**
- Modify: `apps/api/src/modules/overdue/dto/queue-query.dto.ts`
- Modify: `apps/api/src/modules/overdue/queue.service.ts`
- Create: `apps/web/src/pages/CollectionsPage/components/SortDropdown.tsx`
- Modify: `apps/web/src/pages/CollectionsPage/hooks/useQueueFilter.ts`

- [ ] **Step 1: Extend DTO**

Add to `queue-query.dto.ts`:
```ts
export enum QueueSortBy {
  PRIORITY = 'priority',
  OUTSTANDING_DESC = 'outstanding_desc',
  OUTSTANDING_ASC = 'outstanding_asc',
  DAYS_OVERDUE_DESC = 'days_overdue_desc',
  LAST_CONTACTED_ASC = 'last_contacted_asc',
  NEXT_PROMISE_ASC = 'next_promise_asc',
  NAME_ASC = 'name_asc',
  RANDOM = 'random',
}

// inside QueueQueryDto:
@IsOptional() @IsEnum(QueueSortBy) sortBy?: QueueSortBy;
```

- [ ] **Step 2: Implement sort in queue.service.ts**

Add after where-builder, in main query:
```ts
function buildOrderBy(sortBy: QueueSortBy | undefined, userId: string): Prisma.ContractOrderByWithRelationInput | Prisma.ContractOrderByWithRelationInput[] {
  switch (sortBy) {
    case 'outstanding_desc': return { outstanding: 'desc' };
    case 'outstanding_asc': return { outstanding: 'asc' };
    case 'days_overdue_desc': return { daysOverdue: 'desc' };
    case 'name_asc': return { customer: { name: 'asc' } };
    case 'priority':
    default:
      return { daysOverdue: 'desc' }; // fallback pre-score
  }
}
```

For random sort: use seed `userId + today` → shuffle in-memory post-fetch:
```ts
if (sortBy === 'random') {
  enriched = seededShuffle(enriched, `${userId}-${today.toISOString().slice(0, 10)}`);
}
```
Implement `seededShuffle` in a new `apps/api/src/utils/shuffle.util.ts` using Mulberry32 PRNG.

- [ ] **Step 3: Create SortDropdown**

Create `apps/web/src/pages/CollectionsPage/components/SortDropdown.tsx`:
```tsx
import { ArrowUpDown } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const SORT_OPTIONS = [
  { value: 'priority', label: 'Priority' },
  { value: 'outstanding_desc', label: 'ยอดค้าง ↓' },
  { value: 'outstanding_asc', label: 'ยอดค้าง ↑' },
  { value: 'days_overdue_desc', label: 'เลยนานสุด' },
  { value: 'last_contacted_asc', label: 'ไม่แตะนานสุด' },
  { value: 'name_asc', label: 'ชื่อ A-Z' },
  { value: 'random', label: 'Random (fair)' },
];

export function SortDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-[180px]">
        <ArrowUpDown className="mr-2 h-4 w-4" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SORT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 4: Add sort to useQueueFilter**

Extend `QueueFilterState` with `sortBy?: string` + wire in `setFilter` / `useSearchParams`.

Wire `<SortDropdown>` next to filter chips bar (FilterChipsBar).

- [ ] **Step 5: Type check + commit**

Run `./tools/check-types.sh all`

```bash
git add apps/api/src/modules/overdue/dto/queue-query.dto.ts \
        apps/api/src/modules/overdue/queue.service.ts \
        apps/api/src/utils/shuffle.util.ts \
        apps/web/src/pages/CollectionsPage/components/SortDropdown.tsx \
        apps/web/src/pages/CollectionsPage/hooks/useQueueFilter.ts \
        apps/web/src/pages/CollectionsPage/components/FilterChipsBar.tsx
git commit -m "feat(collections): sort dropdown (7 options + random fair rotation)"
```

---

## Task 5: Customer 360 Timeline Filter (A5)

**Files:**
- Modify: `apps/web/src/pages/CollectionsPage/components/Customer360Timeline.tsx`
- Create: `apps/web/src/pages/CollectionsPage/components/TimelineFilterChips.tsx`

- [ ] **Step 1: Create TimelineFilterChips**

```tsx
// Similar to FilterChipsBar but for timeline event types
const EVENT_TYPES = ['ALL', 'PAYMENT', 'DUNNING_ACTION', 'CALL', 'LETTER', 'MDM', 'STATUS_CHANGE'];
```

- [ ] **Step 2: Add date range picker to timeline**

Import `DateRangePicker` (from P0), wire filter state.

- [ ] **Step 3: Frontend-only filter** (timeline is small data)

Filter in-memory after fetch. If > 100 events, add backend `?from=&to=&types[]=` query params.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(collections): Customer 360 Timeline event-type filter + date range"
```

---

## Tasks 6-18 Summary

ด้วยข้อจำกัดขนาดของ plan file แต่ละ task ทำตาม pattern เดียวกัน:
- Spec รายละเอียดอยู่ใน `docs/superpowers/specs/2026-04-25-collections-ui-enhancements-design.md`
- Bite-sized TDD steps ตาม Task 1-5 template
- Commit message per feature

### Task 6-7: Snooze (B2)
- Backend: `snooze.service.ts` + endpoints `POST /contracts/:id/snooze`, `DELETE /contracts/:id/snooze`
- queue.service exclude `ContractSnooze.snoozedUntil > now AND userId === self`
- Frontend: `SnoozeDialog.tsx` (options: 1h/2h/tomorrow 09:00/next week/custom datetime), badge `💤` on card

### Task 8: Undo Snackbar (B3)
- `useUndoMutation.ts` hook wrapping Sonner toast with 30s/10s per-action timeout
- Propose-lock: query MdmRequest status before undo, if APPROVED → show "ไม่สามารถยกเลิกได้แล้ว"
- Wire into: useBulkActions (assign/line/propose-lock), useApprovalQueues (mark undeliverable)

### Task 9: Keyboard Shortcuts (B6)
- Add `react-hotkeys-hook` dependency
- `useKeyboardShortcuts.ts` global hook
- Shortcuts per spec table (J/K navigate, L LINE, C call, P payment, S snooze, A assign, G Q/F/P/A/N/L tab nav)
- Focused card state via QueueTab (ring highlight)
- `KeyboardShortcutsOverlay.tsx` Dialog shown on `?` key

### Task 10: Trending Arrow (B1 follow-up)
- Query `ContractDailySnapshot` 7 days ago per contract in queue.service (batch join)
- Compute delta: `(today.daysOverdue - 7d.daysOverdue)` sign
- ContractCard renders arrow ↑/↓ badge

### Task 11: Customer 360 Snapshot Preview (C1)
- Backend: `GET /contracts/:id/snapshot` lightweight endpoint (5-10× faster than full timeline)
- Frontend: `Customer360SnapshotCard.tsx`, hover > 500ms opens floating panel, mobile long-press

### Task 12: Call Result Quick-Tags (C2)
- Schema: add `CallResult` + `NegotiationResult` enums to CallLog
- Frontend: `CallResultChips.tsx` in ContactLogDialog above textarea

### Task 13: Letter PDF Preview (D3)
- `LetterPdfPreviewDialog.tsx` with `<iframe src={pdfUrl}>`
- "ดู PDF" button in LetterQueueSection + LetterDispatchDialog

### Task 14: Broken-Promise Auto-Suggest (D5)
- Daily cron 09:00 Bangkok: find promises due today without payment → create `DunningAction type=PROMISE_DUE_REMINDER`
- `BrokenPromiseBanner.tsx` in PromiseTab: "🔔 วันนี้มีนัดครบ 5 ราย — ส่ง LINE เตือน?" + bulk action

### Task 15-17: Analytics (E1, E2, E4)
- **E1 Aging Bucket**: endpoint `/overdue/analytics/aging` returns `[{ bucket, count, outstanding }]` → recharts horizontal stacked bar
- **E2 Leaderboard**: endpoint `/overdue/analytics/leaderboard` OWNER only → table with sort + CSV export
- **E4 Stuck Contracts**: endpoint `/overdue/analytics/stuck?days=14` → table with bulk reassign action

### Task 18: /overdue Redirect (F)
- Router: `<Navigate to="/collections" replace />` for `/overdue` and `/overdue/*`
- `MigrationBanner.tsx` on `/collections`: 14-day dismissible, localStorage key `collections-migrated-banner-dismissed`
- Delete `OverduePage.tsx` + associated helpers

---

## Final Verification

- [ ] Full test suite passes
- [ ] E2E smoke tests pass
- [ ] Bundle size acceptable (check after adding react-hotkeys-hook)
- [ ] Cron jobs configured in production (ContractSnapshotCron + BrokenPromiseReminderCron)
- [ ] Push + PR

---

## Self-Review Checklist

### Spec Coverage
- [x] A3 Saved Presets → Task 3
- [x] A4 Sort → Task 4
- [x] A5 Timeline Filter → Task 5
- [x] B2 Snooze → Task 6+7
- [x] B3 Undo → Task 8
- [x] B6 Keyboard Shortcuts → Task 9
- [x] B1 Trending Arrow → Task 10
- [x] C1 Snapshot Preview → Task 11
- [x] C2 Call Result Tags → Task 12
- [x] D3 PDF Preview → Task 13
- [x] D5 Broken Promise Auto-Suggest → Task 14
- [x] E1 Aging Bucket → Task 15
- [x] E2 Leaderboard → Task 16
- [x] E4 Stuck Contracts → Task 17
- [x] F /overdue redirect → Task 18

Coverage 15/15 ✅ (14 P1 features + 1 redirect)

### Placeholder scan
- Task 6-18 ใช้ summary format (not bite-sized) เพื่อจำกัดขนาด file — แต่ละ task reference spec section ที่เกี่ยวข้อง. Implementation agent ควรขยาย bite-sized ตอนทำ

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-04-25-collections-ui-p1.md`. Execution เริ่มหลัง P0 ship:

**1. Subagent-Driven** (แนะนำ) — dispatch fresh subagent per task cluster, 9 parallel clusters feasible after Task 1+2 serial foundation
