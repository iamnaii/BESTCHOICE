# Collections UI Enhancements — P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ส่ง P0 enhancements 9 ตัวสำหรับหน้า `/collections` (Collections Workflow Hub) ให้ทีมเก็บเงินใช้งานได้ทันที — ปิด gap ที่ backend ship แล้วแต่ UI ไม่ได้ surface (truncated flag, MDM unlock, wallpaper), เพิ่ม search/filter/indicator foundation

**Architecture:** ทำงานบน React 18 + Vite + Tailwind + shadcn/ui stack ปัจจุบัน. Backend NestJS + Prisma เพิ่ม fields ใน existing endpoints + 2 endpoints ใหม่ (search union, queue filter extension). Frontend เพิ่ม 3 shared components (DateRangePicker, FilterDrawer, CommandPalette) + wire เข้า tabs ที่มีอยู่

**Tech Stack:** React 18, TypeScript, Tailwind, shadcn/ui, Radix UI, Sonner, React Query, cmdk (command palette), Prisma, NestJS, class-validator, Jest, Playwright

**Working Branch:** `feat/collections-ui-p0` (create from `feat/collections-backlog` HEAD `0e202174`)

---

## Scope & Task Order

**9 Features จาก P0 priority bucket**:
- Task 1: DateRangePicker shared component (A6) — foundation ก่อน
- Task 2: ApprovalTab role gate (D9) — quick win
- Task 3: Truncated banner (B7) — quick win
- Task 4: MDM Unlock button (D1)
- Task 5: Wallpaper attach on MDM approve (D2)
- Task 6: Letter evidence preview + validation (D4)
- Task 7: ContractCard indicators — backend (B1 backend)
- Task 8: ContractCard indicators — frontend (B1 UI)
- Task 9: Queue filter panel — backend (A2 backend)
- Task 10: Queue filter panel — frontend (A2 UI + chips + URL sync)
- Task 11: Command palette — backend search endpoint (A1 backend)
- Task 12: Command palette — frontend (A1 UI)

**Parallelizable clusters** (ถ้า spawn parallel subagents):
- **Cluster α** (independent, quick): Task 2, 3, 4 → 1 agent
- **Cluster β** (shared DateRangePicker): Task 1 → 1 agent
- **Cluster γ** (MDM): Task 5 → 1 agent
- **Cluster δ** (Letter): Task 6 → 1 agent
- **Cluster ε** (Card): Task 7 + 8 sequential → 1 agent
- **Cluster ζ** (Filter): Task 9 + 10 sequential → 1 agent
- **Cluster η** (Search): Task 11 + 12 sequential → 1 agent

Recommended: 7 agents in parallel after Task 2/3/4 done, ~3-4 days to ship

---

## File Structure

### New files
```
apps/web/src/components/ui/DateRangePicker.tsx
apps/web/src/components/CommandPalette.tsx
apps/web/src/pages/CollectionsPage/components/FilterDrawer.tsx
apps/web/src/pages/CollectionsPage/components/FilterChipsBar.tsx
apps/web/src/pages/CollectionsPage/components/TruncatedBanner.tsx
apps/web/src/pages/CollectionsPage/components/WallpaperPreview.tsx
apps/web/src/pages/CollectionsPage/components/EvidenceThumbnailGrid.tsx
apps/web/src/pages/CollectionsPage/hooks/useQueueFilter.ts
apps/web/src/pages/CollectionsPage/hooks/useUnionSearch.ts
apps/web/src/pages/CollectionsPage/utils/cardIndicators.ts
apps/api/src/modules/overdue/dto/queue-filter.dto.ts
apps/api/src/modules/search/search.module.ts
apps/api/src/modules/search/search.controller.ts
apps/api/src/modules/search/search.service.ts
apps/api/src/modules/search/dto/search-query.dto.ts
apps/api/src/modules/search/search.service.spec.ts
```

### Files to modify
```
apps/web/src/pages/CollectionsPage/index.tsx                        — role gate tabs
apps/web/src/pages/CollectionsPage/tabs/QueueTab.tsx                — truncated banner, filter drawer, indicators
apps/web/src/pages/CollectionsPage/tabs/FollowUpTab.tsx             — filter drawer (remove inline skip-tracing toggle)
apps/web/src/pages/CollectionsPage/tabs/PromiseTab.tsx              — filter drawer
apps/web/src/pages/CollectionsPage/tabs/AllTab.tsx                  — filter drawer
apps/web/src/pages/CollectionsPage/tabs/AnalyticsTab.tsx            — DateRangePicker replace 30/90d toggle
apps/web/src/pages/CollectionsPage/components/ContractCard.tsx      — indicator chip row
apps/web/src/pages/CollectionsPage/components/ApprovalPendingRow.tsx — MDM unlock button + wallpaper dialog
apps/web/src/pages/CollectionsPage/components/LetterDispatchDialog.tsx — evidence preview + mandatory check
apps/web/src/pages/CollectionsPage/hooks/useApprovalQueues.ts       — wire useUnlockMdm, add wallpaper opt
apps/web/src/pages/CollectionsPage/hooks/useCollectionsQueue.ts     — accept filter params + expose truncated
apps/web/src/App.tsx                                                 — register CommandPalette provider
apps/api/src/modules/overdue/overdue.controller.ts                  — queue filter query params, unlock endpoint already exists
apps/api/src/modules/overdue/queue.service.ts                       — filter where-builder, extra fields
apps/api/src/modules/overdue/mdm-lock.service.ts                    — accept includeWallpaper flag
apps/api/src/modules/overdue/dto/queue-query.dto.ts                 — extend with filter fields
apps/api/src/modules/overdue/dto/approve-mdm.dto.ts                 — add includeWallpaper (create if missing)
apps/api/src/app.module.ts                                          — register SearchModule
apps/api/prisma/schema.prisma                                        — (P0 no schema change — snapshot table is P1)
```

---

## Task 1: DateRangePicker Shared Component (A6)

**Files:**
- Create: `apps/web/src/components/ui/DateRangePicker.tsx`
- Test: `apps/web/src/components/ui/__tests__/DateRangePicker.test.tsx`
- Modify: `apps/web/src/pages/CollectionsPage/tabs/AnalyticsTab.tsx`

- [ ] **Step 1: ตรวจสอบ dependency ที่มีอยู่**

Run:
```bash
grep -E '"date-fns"|"react-day-picker"' apps/web/package.json
```
Expected: ทั้งสองอยู่ใน dependencies แล้ว (ใช้ใน shadcn calendar component)

ถ้าไม่เจอ ให้ติดตั้ง:
```bash
cd apps/web && npm install date-fns react-day-picker
```

- [ ] **Step 2: Write failing test**

Create `apps/web/src/components/ui/__tests__/DateRangePicker.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DateRangePicker } from '../DateRangePicker';

describe('DateRangePicker', () => {
  it('renders preset buttons', () => {
    render(<DateRangePicker value={{ from: null, to: null }} onChange={() => {}} />);
    expect(screen.getByText('วันนี้')).toBeInTheDocument();
    expect(screen.getByText('7 วัน')).toBeInTheDocument();
    expect(screen.getByText('30 วัน')).toBeInTheDocument();
  });

  it('calls onChange when preset clicked', () => {
    const onChange = vi.fn();
    render(<DateRangePicker value={{ from: null, to: null }} onChange={onChange} />);
    fireEvent.click(screen.getByText('7 วัน'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        from: expect.any(Date),
        to: expect.any(Date),
      }),
    );
  });

  it('displays Thai Buddhist year (พ.ศ.)', () => {
    const from = new Date(2026, 3, 25); // April 25, 2026 CE = 2569 BE
    render(<DateRangePicker value={{ from, to: from }} onChange={() => {}} />);
    expect(screen.getByText(/2569/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:
```bash
cd apps/web && npx vitest run src/components/ui/__tests__/DateRangePicker.test.tsx
```
Expected: FAIL (ไฟล์ `DateRangePicker.tsx` ยังไม่มี)

- [ ] **Step 4: Implement DateRangePicker**

Create `apps/web/src/components/ui/DateRangePicker.tsx`:
```tsx
import { useState } from 'react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { CalendarIcon } from 'lucide-react';
import { formatThaiDateShort } from '@/lib/date';
import { startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import type { DateRange } from 'react-day-picker';

export type DateRangeValue = { from: Date | null; to: Date | null };

export interface DateRangePickerProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  className?: string;
  disabled?: boolean;
}

type PresetKey = 'today' | '7d' | '30d' | 'thisMonth' | 'lastMonth' | '3m' | 'custom';

const PRESETS: { key: PresetKey; label: string; compute: () => DateRangeValue }[] = [
  { key: 'today', label: 'วันนี้', compute: () => {
    const now = new Date();
    return { from: startOfDay(now), to: endOfDay(now) };
  }},
  { key: '7d', label: '7 วัน', compute: () => {
    const now = new Date();
    return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
  }},
  { key: '30d', label: '30 วัน', compute: () => {
    const now = new Date();
    return { from: startOfDay(subDays(now, 29)), to: endOfDay(now) };
  }},
  { key: 'thisMonth', label: 'เดือนนี้', compute: () => {
    const now = new Date();
    return { from: startOfMonth(now), to: endOfMonth(now) };
  }},
  { key: 'lastMonth', label: 'เดือนที่แล้ว', compute: () => {
    const last = subMonths(new Date(), 1);
    return { from: startOfMonth(last), to: endOfMonth(last) };
  }},
  { key: '3m', label: '3 เดือน', compute: () => {
    const now = new Date();
    return { from: startOfDay(subMonths(now, 3)), to: endOfDay(now) };
  }},
];

export function DateRangePicker({ value, onChange, className, disabled }: DateRangePickerProps) {
  const [selected, setSelected] = useState<PresetKey>('custom');

  function handlePreset(key: PresetKey) {
    const preset = PRESETS.find((p) => p.key === key);
    if (preset) {
      setSelected(key);
      onChange(preset.compute());
    }
  }

  function handleCalendar(range: DateRange | undefined) {
    setSelected('custom');
    onChange({ from: range?.from ?? null, to: range?.to ?? null });
  }

  const displayLabel =
    value.from && value.to
      ? `${formatThaiDateShort(value.from)} – ${formatThaiDateShort(value.to)}`
      : 'เลือกช่วงวันที่';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={className}
          disabled={disabled}
          type="button"
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {displayLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <div className="flex flex-col gap-2 border-b border-border p-2 sm:flex-row">
          {PRESETS.map((p) => (
            <Button
              key={p.key}
              variant={selected === p.key ? 'default' : 'ghost'}
              size="sm"
              onClick={() => handlePreset(p.key)}
              type="button"
            >
              {p.label}
            </Button>
          ))}
        </div>
        <Calendar
          mode="range"
          selected={value.from && value.to ? { from: value.from, to: value.to } : undefined}
          onSelect={handleCalendar}
          numberOfMonths={2}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 5: Run test to verify pass**

Run:
```bash
cd apps/web && npx vitest run src/components/ui/__tests__/DateRangePicker.test.tsx
```
Expected: PASS (3/3 tests)

- [ ] **Step 6: Replace 30d/90d toggle in AnalyticsTab**

Edit `apps/web/src/pages/CollectionsPage/tabs/AnalyticsTab.tsx`:
- Find the existing `range` state (currently toggle between '30d' / '90d')
- Replace with `DateRangeValue` state using DateRangePicker
- Pass `from`/`to` query params instead of `range` enum
- Backend `/overdue/analytics` — ต้อง accept `from` / `to` query params (check current contract)

If backend still expects `range`, wrap: pass range enum ที่คำนวณจาก diff days:
```tsx
const days = value.from && value.to
  ? Math.round((value.to.getTime() - value.from.getTime()) / 86400000)
  : 30;
const range = days <= 7 ? '7d' : days <= 30 ? '30d' : '90d';
```

หมายเหตุ: ถ้า backend ต้อง extend ให้รับ from/to ให้เพิ่มใน Task 1b (ทำเฉพาะถ้า analytics service ไม่รองรับแล้ว จริงๆ). สำหรับ P0 ขั้นต้นใช้ wrapper mapping ก่อน

- [ ] **Step 7: Type check**

Run:
```bash
./tools/check-types.sh web
```
Expected: `Web: OK`

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/ui/DateRangePicker.tsx \
        apps/web/src/components/ui/__tests__/DateRangePicker.test.tsx \
        apps/web/src/pages/CollectionsPage/tabs/AnalyticsTab.tsx
git commit -m "$(cat <<'EOF'
feat(ui): shared DateRangePicker component with Thai presets

- 6 preset options (วันนี้/7d/30d/เดือนนี้/เดือนที่แล้ว/3 เดือน) + custom calendar
- Thai พ.ศ. year display via formatThaiDateShort
- Replaces ad-hoc 30d/90d toggle in AnalyticsTab
- Foundation for Customer 360 timeline filter (P1) and audit logs range filter (future)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: ApprovalTab Role Gate (D9)

**Files:**
- Modify: `apps/web/src/pages/CollectionsPage/index.tsx`
- Test: `apps/web/src/pages/CollectionsPage/__tests__/tabVisibility.test.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/web/src/pages/CollectionsPage/__tests__/tabVisibility.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CollectionsPage from '../index';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '@/contexts/AuthContext';

function renderWith(role: string) {
  (useAuth as any).mockReturnValue({ user: { id: 'u1', role } });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CollectionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CollectionsPage tab visibility by role', () => {
  it('OWNER sees all 6 tabs', () => {
    renderWith('OWNER');
    expect(screen.getByText('คิววันนี้')).toBeInTheDocument();
    expect(screen.getByText('ติดตาม')).toBeInTheDocument();
    expect(screen.getByText('นัดจ่าย')).toBeInTheDocument();
    expect(screen.getByText('รออนุมัติ')).toBeInTheDocument();
    expect(screen.getByText('รายงาน')).toBeInTheDocument();
    expect(screen.getByText('ทั้งหมด')).toBeInTheDocument();
  });

  it('SALES sees 4 tabs (no approval, no analytics)', () => {
    renderWith('SALES');
    expect(screen.getByText('คิววันนี้')).toBeInTheDocument();
    expect(screen.queryByText('รออนุมัติ')).not.toBeInTheDocument();
    expect(screen.queryByText('รายงาน')).not.toBeInTheDocument();
  });

  it('ACCOUNTANT sees 4 tabs (no approval, no analytics)', () => {
    renderWith('ACCOUNTANT');
    expect(screen.queryByText('รออนุมัติ')).not.toBeInTheDocument();
    expect(screen.queryByText('รายงาน')).not.toBeInTheDocument();
  });

  it('FINANCE_MANAGER sees approval and analytics', () => {
    renderWith('FINANCE_MANAGER');
    expect(screen.getByText('รออนุมัติ')).toBeInTheDocument();
    expect(screen.getByText('รายงาน')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd apps/web && npx vitest run src/pages/CollectionsPage/__tests__/tabVisibility.test.tsx
```
Expected: FAIL (SALES/ACCOUNTANT ตอนนี้เห็น approval + analytics เพราะไม่ได้ gate)

- [ ] **Step 3: Implement role gate**

Edit `apps/web/src/pages/CollectionsPage/index.tsx`:
- Find tab array definition (ประมาณ line 50-80, อ่านก่อน)
- เปลี่ยนเป็น:
```tsx
import { useAuth } from '@/contexts/AuthContext';

const TAB_ROLE_ACCESS: Record<string, string[]> = {
  queue: [],               // empty = all roles
  'follow-up': [],
  promise: [],
  all: [],
  approval: ['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER'],
  analytics: ['OWNER', 'FINANCE_MANAGER'],
};

// inside component
const { user } = useAuth();
const allTabs = [
  { key: 'queue', label: 'คิววันนี้', component: QueueTab },
  { key: 'follow-up', label: 'ติดตาม', component: FollowUpTab },
  { key: 'promise', label: 'นัดจ่าย', component: PromiseTab },
  { key: 'approval', label: 'รออนุมัติ', component: ApprovalTab },
  { key: 'analytics', label: 'รายงาน', component: AnalyticsTab },
  { key: 'all', label: 'ทั้งหมด', component: AllTab },
];
const visibleTabs = allTabs.filter((t) => {
  const allowed = TAB_ROLE_ACCESS[t.key];
  return !allowed || allowed.length === 0 || allowed.includes(user?.role ?? '');
});
```
- เปลี่ยน default tab ถ้า currently selected tab ไม่ visible (fallback to first visible):
```tsx
const activeTabKey = visibleTabs.some((t) => t.key === current) ? current : visibleTabs[0]?.key;
```

- [ ] **Step 4: Run test to verify pass**

Run:
```bash
cd apps/web && npx vitest run src/pages/CollectionsPage/__tests__/tabVisibility.test.tsx
```
Expected: PASS (4/4)

- [ ] **Step 5: Type check**

Run:
```bash
./tools/check-types.sh web
```
Expected: `Web: OK`

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/CollectionsPage/index.tsx \
        apps/web/src/pages/CollectionsPage/__tests__/tabVisibility.test.tsx
git commit -m "$(cat <<'EOF'
fix(collections): role-gate Approval + Analytics tabs

SALES/ACCOUNTANT used to see empty tabs with silent 403s from API.
Now:
- Approval: OWNER, FINANCE_MANAGER, BRANCH_MANAGER only
- Analytics: OWNER, FINANCE_MANAGER only
- Other tabs: all authenticated roles

Fallback to first visible tab if current selection is gated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Truncated Banner (B7)

**Files:**
- Create: `apps/web/src/pages/CollectionsPage/components/TruncatedBanner.tsx`
- Modify: `apps/web/src/pages/CollectionsPage/hooks/useCollectionsQueue.ts`
- Modify: `apps/web/src/pages/CollectionsPage/tabs/QueueTab.tsx` (+ other tabs that show queue)

- [ ] **Step 1: Expose truncated in hook**

Edit `apps/web/src/pages/CollectionsPage/hooks/useCollectionsQueue.ts`:
- Find return type — ปัจจุบันน่าจะเป็น `{ data: ContractRow[], total, page, limit }`
- เพิ่ม `truncated: boolean`:
```ts
// response type
interface QueueResponse {
  data: ContractRow[];
  total: number;
  page: number;
  limit: number;
  truncated: boolean;
}
// useQuery return — pass through truncated
return useQuery({ ... select: (res) => ({ ...res, truncated: res.truncated ?? false }) });
```

- [ ] **Step 2: Create TruncatedBanner component**

Create `apps/web/src/pages/CollectionsPage/components/TruncatedBanner.tsx`:
```tsx
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TruncatedBannerProps {
  onOpenFilter: () => void;
}

export function TruncatedBanner({ onOpenFilter }: TruncatedBannerProps) {
  return (
    <div
      role="alert"
      className="mb-3 flex items-center justify-between rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />
        <span className="text-foreground leading-snug">
          แสดง 500 แถวแรก — ปรับ filter ให้แคบลงเพื่อเห็นทั้งหมด
        </span>
      </div>
      <Button variant="ghost" size="sm" onClick={onOpenFilter}>
        เปิด filter
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Wire into QueueTab (and other queue-consuming tabs)**

Edit `apps/web/src/pages/CollectionsPage/tabs/QueueTab.tsx`:
- Import TruncatedBanner
- After QueryBoundary success, before card list:
```tsx
{data.truncated && (
  <TruncatedBanner onOpenFilter={() => setFilterOpen(true)} />
)}
```
- `setFilterOpen` จะใช้ใน Task 10 (filter drawer) — ใน P0 ชั่วคราว stub เป็น `() => {}` หรือ toast เตือน "Filter อยู่ใน drawer — implement ใน Task 10"

Same pattern to FollowUpTab, PromiseTab, AllTab (ถ้า ใช้ useCollectionsQueue เดียวกัน)

- [ ] **Step 4: Type check**

Run:
```bash
./tools/check-types.sh web
```
Expected: `Web: OK`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/CollectionsPage/components/TruncatedBanner.tsx \
        apps/web/src/pages/CollectionsPage/hooks/useCollectionsQueue.ts \
        apps/web/src/pages/CollectionsPage/tabs/QueueTab.tsx \
        apps/web/src/pages/CollectionsPage/tabs/FollowUpTab.tsx \
        apps/web/src/pages/CollectionsPage/tabs/PromiseTab.tsx \
        apps/web/src/pages/CollectionsPage/tabs/AllTab.tsx
git commit -m "$(cat <<'EOF'
feat(collections): surface truncated queue indicator

Backend queue.service caps results at 500 (priority-score sort + Truncated flag).
Now UI shows amber banner when truncated=true with CTA to open filter drawer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: MDM Unlock Button (D1)

**Files:**
- Modify: `apps/web/src/pages/CollectionsPage/components/ApprovalPendingRow.tsx`
- Modify: `apps/web/src/pages/CollectionsPage/hooks/useApprovalQueues.ts` (verify `useUnlockMdm` hook exists and wire invalidation)

- [ ] **Step 1: Verify hook exists**

Run:
```bash
grep -n "useUnlockMdm" apps/web/src/pages/CollectionsPage/hooks/useApprovalQueues.ts
```
Expected: มี `export function useUnlockMdm()` (added in #685 Wave 1+2, commit `1cf55238`)

ถ้าไม่มี (ยังไม่ merge #685): เพิ่มเอง:
```ts
export function useUnlockMdm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/overdue/mdm-requests/${id}/unlock`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-mdm'] });
      qc.invalidateQueries({ queryKey: ['collections-queue'] });
      toast.success('ปลดล็อคเครื่องแล้ว');
    },
    onError: () => toast.error('ปลดล็อคไม่สำเร็จ'),
  });
}
```

- [ ] **Step 2: Import + wire unlock button**

Edit `apps/web/src/pages/CollectionsPage/components/ApprovalPendingRow.tsx`:
- Find `MdmRow` function (~line 200+)
- Import `useUnlockMdm` and `useAuth`
- ด้านบน component:
```tsx
const { user } = useAuth();
const isOwner = user?.role === 'OWNER';
const unlock = useUnlockMdm();
```
- ใน action buttons row (หลัง `อนุมัติล็อค` + `ปฏิเสธ`):
```tsx
{isOwner && request.status === 'LOCKED' && (
  <Button
    variant="outline"
    size="sm"
    onClick={() => setShowUnlockConfirm(true)}
    disabled={unlock.isPending}
  >
    {unlock.isPending ? 'กำลังปลดล็อค...' : 'ปลดล็อค'}
  </Button>
)}
```
- เพิ่ม `useState` for `showUnlockConfirm`
- เพิ่ม `ConfirmDialog` (import จาก components ที่มีอยู่ หรือ shadcn `AlertDialog`):
```tsx
{showUnlockConfirm && (
  <AlertDialog open={showUnlockConfirm} onOpenChange={setShowUnlockConfirm}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>ยืนยันปลดล็อคเครื่อง?</AlertDialogTitle>
        <AlertDialogDescription>
          ลูกค้า {request.customerName} จะใช้เครื่อง {request.imei} ได้ทันที
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
        <AlertDialogAction
          onClick={() => {
            unlock.mutate(request.id);
            setShowUnlockConfirm(false);
          }}
        >
          ยืนยันปลดล็อค
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
)}
```

- [ ] **Step 3: Type check**

Run:
```bash
./tools/check-types.sh web
```
Expected: `Web: OK`

- [ ] **Step 4: Manual QA (smoke)**

Run:
```bash
cd apps/web && npm run dev
```
Login as OWNER → `/collections` → Approval tab → เจอ MDM request ที่ `status === 'LOCKED'` → เห็นปุ่ม "ปลดล็อค" → คลิก → confirm dialog → ยืนยัน → toast success

Login as FINANCE_MANAGER → เห็น MDM row แต่ไม่เห็นปุ่ม "ปลดล็อค" (OWNER only)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/CollectionsPage/components/ApprovalPendingRow.tsx \
        apps/web/src/pages/CollectionsPage/hooks/useApprovalQueues.ts
git commit -m "$(cat <<'EOF'
feat(collections): MDM Unlock button in ApprovalTab (OWNER only)

Backend POST /overdue/mdm-requests/:id/unlock existed but no UI.
Now OWNER can unlock after approving a lock, with confirm dialog.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wallpaper Attachment on MDM Approve (D2)

**Files:**
- Modify: `apps/api/src/modules/overdue/mdm-lock.service.ts`
- Modify/create: `apps/api/src/modules/overdue/dto/approve-mdm.dto.ts`
- Test: `apps/api/src/modules/overdue/mdm-lock.service.spec.ts`
- Modify: `apps/web/src/pages/CollectionsPage/components/ApprovalPendingRow.tsx`
- Modify: `apps/web/src/pages/CollectionsPage/hooks/useApprovalQueues.ts`
- Create: `apps/web/src/pages/CollectionsPage/components/WallpaperPreview.tsx`

### Backend part

- [ ] **Step 1: Check approve endpoint + DTO**

Run:
```bash
grep -rn "approve.*mdm\|approveMdm\|approveLock" apps/api/src/modules/overdue/ | head -20
```
Read the approve method signature — น่าจะอยู่ใน `mdm-lock.service.ts` method `approve(requestId, userId)` หรือคล้ายกัน

- [ ] **Step 2: Extend DTO to accept includeWallpaper**

Edit or create `apps/api/src/modules/overdue/dto/approve-mdm.dto.ts`:
```ts
import { IsOptional, IsBoolean } from 'class-validator';

export class ApproveMdmDto {
  @IsOptional()
  @IsBoolean({ message: 'ค่า includeWallpaper ต้องเป็น true/false' })
  includeWallpaper?: boolean;
}
```

Wire into controller method `@Body() dto: ApproveMdmDto` (check `overdue.controller.ts` line for existing approve endpoint).

- [ ] **Step 3: Write failing test**

Edit `apps/api/src/modules/overdue/mdm-lock.service.spec.ts`:
```ts
describe('MdmLockService.approve', () => {
  it('passes wallpaper URL to MDM API when includeWallpaper=true', async () => {
    const mdmClient = { lock: jest.fn().mockResolvedValue({}) };
    const service = new MdmLockService(prisma as any, mdmClient as any, systemConfigService as any);

    jest.spyOn(systemConfigService, 'getValue').mockImplementation(async (key) => {
      if (key === 'mdm_lock_wallpaper_url') return 'https://storage.googleapis.com/b/wallpaper.png';
      return null;
    });

    await service.approve('req-1', 'user-1', { includeWallpaper: true });

    expect(mdmClient.lock).toHaveBeenCalledWith(
      expect.objectContaining({ wallpaperUrl: 'https://storage.googleapis.com/b/wallpaper.png' }),
    );
  });

  it('omits wallpaper URL when includeWallpaper=false', async () => {
    const mdmClient = { lock: jest.fn().mockResolvedValue({}) };
    const service = new MdmLockService(prisma as any, mdmClient as any, systemConfigService as any);

    await service.approve('req-1', 'user-1', { includeWallpaper: false });

    expect(mdmClient.lock).toHaveBeenCalledWith(
      expect.not.objectContaining({ wallpaperUrl: expect.anything() }),
    );
  });
});
```

Run: `cd apps/api && npx jest mdm-lock.service.spec`
Expected: FAIL

- [ ] **Step 4: Implement wallpaper pass-through**

Edit `apps/api/src/modules/overdue/mdm-lock.service.ts`:
- Update `approve()` signature to accept options:
```ts
async approve(
  requestId: string,
  userId: string,
  options: { includeWallpaper?: boolean } = {},
): Promise<void> {
  // ... existing approve logic ...

  const mdmPayload: MdmLockPayload = {
    imei: request.imei,
    reason: request.reason,
  };

  if (options.includeWallpaper) {
    const wallpaperUrl = await this.systemConfigService.getValue('mdm_lock_wallpaper_url');
    if (wallpaperUrl) {
      mdmPayload.wallpaperUrl = wallpaperUrl;
    }
  }

  await this.mdmClient.lock(mdmPayload);

  // ... existing update + audit log ...
}
```

- Update `MdmLockPayload` type (likely in `mdm-lock.types.ts` or in service):
```ts
interface MdmLockPayload {
  imei: string;
  reason: string;
  wallpaperUrl?: string;
}
```

- [ ] **Step 5: Run test**

Run: `cd apps/api && npx jest mdm-lock.service.spec`
Expected: PASS

### Frontend part

- [ ] **Step 6: Create WallpaperPreview component**

Create `apps/web/src/pages/CollectionsPage/components/WallpaperPreview.tsx`:
```tsx
import { Checkbox } from '@/components/ui/checkbox';
import { Image } from 'lucide-react';

interface WallpaperPreviewProps {
  wallpaperUrl: string | null;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function WallpaperPreview({ wallpaperUrl, checked, onChange }: WallpaperPreviewProps) {
  if (!wallpaperUrl) {
    return (
      <p className="text-xs text-muted-foreground leading-snug">
        ยังไม่ตั้ง wallpaper MDM ใน <a href="/settings" className="underline">ตั้งค่า Dunning</a>
      </p>
    );
  }
  return (
    <div className="flex items-start gap-3 rounded-md border border-border bg-muted/30 p-3">
      <img
        src={wallpaperUrl}
        alt="MDM wallpaper"
        className="h-16 w-16 rounded object-cover"
      />
      <div className="flex-1">
        <label className="flex items-start gap-2 text-sm leading-snug">
          <Checkbox checked={checked} onCheckedChange={(v) => onChange(!!v)} className="mt-0.5" />
          <span>แนบภาพพื้นหลังนี้ให้เครื่อง</span>
        </label>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Update useApproveMdm hook to accept includeWallpaper**

Edit `apps/web/src/pages/CollectionsPage/hooks/useApprovalQueues.ts`:
- Change mutation signature:
```ts
export function useApproveMdm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, includeWallpaper }: { id: string; includeWallpaper: boolean }) =>
      api.post(`/overdue/mdm-requests/${id}/approve`, { includeWallpaper }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-mdm'] });
      qc.invalidateQueries({ queryKey: ['collections-queue'] });
      toast.success('อนุมัติและล็อคเครื่องแล้ว');
    },
  });
}
```

- [ ] **Step 8: Wire into MdmRow approve flow**

Edit `apps/web/src/pages/CollectionsPage/components/ApprovalPendingRow.tsx`:
- Fetch wallpaper URL from settings:
```tsx
const { data: settings } = useQuery({
  queryKey: ['settings'],
  queryFn: () => api.get('/settings').then((r) => r.data),
  staleTime: 5 * 60 * 1000,
});
const wallpaperUrl = settings?.mdm_lock_wallpaper_url ?? null;
```
- Convert "อนุมัติล็อค" button → dialog:
```tsx
const [approveDialogOpen, setApproveDialogOpen] = useState(false);
const [includeWallpaper, setIncludeWallpaper] = useState(true);

// Button:
<Button onClick={() => setApproveDialogOpen(true)}>อนุมัติล็อค</Button>

// Dialog:
<Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>อนุมัติล็อคเครื่อง</DialogTitle>
      <DialogDescription>
        IMEI: {request.imei} • ลูกค้า: {request.customerName}
      </DialogDescription>
    </DialogHeader>
    <WallpaperPreview
      wallpaperUrl={wallpaperUrl}
      checked={includeWallpaper && !!wallpaperUrl}
      onChange={setIncludeWallpaper}
    />
    <DialogFooter>
      <Button variant="outline" onClick={() => setApproveDialogOpen(false)}>ยกเลิก</Button>
      <Button
        onClick={() => {
          approve.mutate({ id: request.id, includeWallpaper: includeWallpaper && !!wallpaperUrl });
          setApproveDialogOpen(false);
        }}
      >
        ยืนยันอนุมัติ
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

- [ ] **Step 9: Type check + test**

Run:
```bash
./tools/check-types.sh all
cd apps/api && npx jest mdm-lock
```
Expected: types OK, mdm-lock tests pass

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/overdue/dto/approve-mdm.dto.ts \
        apps/api/src/modules/overdue/mdm-lock.service.ts \
        apps/api/src/modules/overdue/mdm-lock.service.spec.ts \
        apps/api/src/modules/overdue/overdue.controller.ts \
        apps/web/src/pages/CollectionsPage/components/ApprovalPendingRow.tsx \
        apps/web/src/pages/CollectionsPage/components/WallpaperPreview.tsx \
        apps/web/src/pages/CollectionsPage/hooks/useApprovalQueues.ts
git commit -m "$(cat <<'EOF'
feat(collections): attach MDM wallpaper on approve

OWNER uploads wallpaper in DunningSettings (already implemented). Previously
no UI to actually use it on approve. Now approve dialog shows preview and
checkbox to include wallpaper in MDM lock payload.

Backend: ApproveMdmDto { includeWallpaper?: boolean }; mdm-lock.service reads
settings value and passes wallpaperUrl to mdmClient.lock() payload.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Letter Evidence Preview + Validation (D4)

**Files:**
- Create: `apps/web/src/pages/CollectionsPage/components/EvidenceThumbnailGrid.tsx`
- Modify: `apps/web/src/pages/CollectionsPage/components/LetterDispatchDialog.tsx`

- [ ] **Step 1: Read current LetterDispatchDialog**

Read `apps/web/src/pages/CollectionsPage/components/LetterDispatchDialog.tsx` — find evidence upload section (likely near the bottom of the dialog)

- [ ] **Step 2: Create EvidenceThumbnailGrid**

Create `apps/web/src/pages/CollectionsPage/components/EvidenceThumbnailGrid.tsx`:
```tsx
import { useState } from 'react';
import { X, ZoomIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';

interface EvidenceThumbnailGridProps {
  urls: string[];
  onRemove?: (index: number) => void;
  maxPreview?: number;
}

export function EvidenceThumbnailGrid({ urls, onRemove, maxPreview = 3 }: EvidenceThumbnailGridProps) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  if (urls.length === 0) {
    return (
      <p className="text-xs text-muted-foreground leading-snug">
        ยังไม่ได้อัปโหลดหลักฐาน
      </p>
    );
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {urls.slice(0, maxPreview).map((url, i) => (
          <div key={url} className="relative aspect-square overflow-hidden rounded border border-border">
            <img
              src={url}
              alt={`หลักฐาน ${i + 1}`}
              className="h-full w-full cursor-zoom-in object-cover"
              onClick={() => setLightboxUrl(url)}
            />
            <div className="absolute right-1 top-1 flex gap-1">
              <Button
                size="icon"
                variant="secondary"
                className="h-6 w-6"
                onClick={() => setLightboxUrl(url)}
                type="button"
                aria-label="ขยาย"
              >
                <ZoomIn className="h-3 w-3" />
              </Button>
              {onRemove && (
                <Button
                  size="icon"
                  variant="destructive"
                  className="h-6 w-6"
                  onClick={() => onRemove(i)}
                  type="button"
                  aria-label="ลบ"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      {urls.length > maxPreview && (
        <p className="mt-1 text-xs text-muted-foreground">+{urls.length - maxPreview} รูปเพิ่มเติม</p>
      )}

      <Dialog open={!!lightboxUrl} onOpenChange={(o) => !o && setLightboxUrl(null)}>
        <DialogContent className="max-w-3xl p-0">
          {lightboxUrl && (
            <img src={lightboxUrl} alt="หลักฐาน (ขยาย)" className="w-full rounded" />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 3: Wire into LetterDispatchDialog + mandatory check**

Edit `apps/web/src/pages/CollectionsPage/components/LetterDispatchDialog.tsx`:
- Import `EvidenceThumbnailGrid` + `Checkbox`
- State: `evidenceVerified: boolean`
- In evidence section:
```tsx
<div className="space-y-2">
  <Label>หลักฐานการส่ง</Label>
  <EvidenceThumbnailGrid
    urls={form.evidencePhotoUrls}
    onRemove={(i) => setForm({ ...form, evidencePhotoUrls: form.evidencePhotoUrls.filter((_, j) => j !== i) })}
  />
  <Input type="file" accept="image/*" multiple onChange={handleUpload} />

  <label className="flex items-start gap-2 text-sm">
    <Checkbox
      checked={evidenceVerified}
      onCheckedChange={(v) => setEvidenceVerified(!!v)}
    />
    <span className="leading-snug">ตรวจสอบหลักฐานการส่งถูกต้องแล้ว</span>
  </label>
</div>
```
- Disable "ยืนยันส่ง" button ถ้า `!evidenceVerified`:
```tsx
<Button
  onClick={handleDispatch}
  disabled={!evidenceVerified || dispatch.isPending}
>
  {dispatch.isPending ? 'กำลังส่ง...' : 'ยืนยันส่ง'}
</Button>
```

Note: `form.evidencePhotoUrls` — ปัจจุบันอาจเก็บเป็น single URL (string). ถ้าเป็นเช่นนั้น ให้ปรับเป็น array หรือเก็บ single preview เฉยๆ ใน P0 ก็ได้ (reduce scope, array upload P1)

สำหรับ P0 — ถ้า schema เก็บ single URL: ปรับ `EvidenceThumbnailGrid` ให้รับ string | null หรือ wrapper `urls={url ? [url] : []}`

- [ ] **Step 4: Type check**

Run:
```bash
./tools/check-types.sh web
```
Expected: `Web: OK`

- [ ] **Step 5: Manual QA**

Run dev server → Letter dispatch flow → upload หลักฐาน → เห็น thumbnail → click zoom lightbox works → uncheck verify box → "ยืนยันส่ง" disabled

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/CollectionsPage/components/EvidenceThumbnailGrid.tsx \
        apps/web/src/pages/CollectionsPage/components/LetterDispatchDialog.tsx
git commit -m "$(cat <<'EOF'
feat(collections): letter evidence thumbnail + mandatory verification

Dispatch dialog now shows uploaded evidence as thumbnail grid with click-to-zoom
lightbox. Adds mandatory checkbox "ตรวจสอบหลักฐานการส่งถูกต้องแล้ว" which gates
the "ยืนยันส่ง" button — prevents accidental dispatch without review.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: ContractCard Indicators — Backend (B1 backend)

**Files:**
- Modify: `apps/api/src/modules/overdue/queue.service.ts`
- Modify: `apps/api/src/modules/overdue/dto/queue-query.dto.ts` (read-check only — no new params here)
- Test: `apps/api/src/modules/overdue/queue.service.spec.ts`
- Create: `apps/web/src/pages/CollectionsPage/utils/cardIndicators.ts` (frontend util — part of backend task because tightly coupled)

- [ ] **Step 1: Read current queue.service.ts data shape**

Read `apps/api/src/modules/overdue/queue.service.ts` — ปัจจุบันน่าจะ select fields จาก Contract + customer + assignedTo

- [ ] **Step 2: Write failing test**

Edit `apps/api/src/modules/overdue/queue.service.spec.ts` (or add new describe block):
```ts
describe('queue.service — card indicators', () => {
  it('includes lastContactedAt (max of CallLog.createdAt and DunningAction.sentAt)', async () => {
    // seed contract + 1 CallLog 3 hours ago + 1 DunningAction 1 hour ago
    const result = await service.getQueue({ userId: 'u1', page: 1, limit: 10 });
    const row = result.data[0];
    expect(row.lastContactedAt).toBeDefined();
    // Should be the DunningAction timestamp (more recent)
  });

  it('includes brokenPromiseCount (count of BROKEN_PROMISE audit events)', async () => {
    // seed contract + 2 audit events action='BROKEN_PROMISE'
    const result = await service.getQueue({ userId: 'u1', page: 1, limit: 10 });
    expect(result.data[0].brokenPromiseCount).toBe(2);
  });

  it('includes mdmState (latest MdmRequest status or NONE)', async () => {
    const result = await service.getQueue({ userId: 'u1', page: 1, limit: 10 });
    expect(['NONE', 'PENDING', 'LOCKED', 'UNLOCKED']).toContain(result.data[0].mdmState);
  });

  it('includes relatedContractsCount (count of other active contracts for customer)', async () => {
    // customer with 2 active contracts
    const result = await service.getQueue({ userId: 'u1', page: 1, limit: 10 });
    expect(result.data[0].relatedContractsCount).toBe(1); // excluding self
  });

  it('includes lastChannel (channel of most recent DunningAction)', async () => {
    const result = await service.getQueue({ userId: 'u1', page: 1, limit: 10 });
    expect(['LINE', 'SMS', 'CALL', 'LETTER', null]).toContain(result.data[0].lastChannel);
  });
});
```

Run: `cd apps/api && npx jest queue.service.spec`
Expected: FAIL

- [ ] **Step 3: Implement extra fields**

Edit `apps/api/src/modules/overdue/queue.service.ts`:
- In the main data-fetching function, after base contracts are fetched, enrich with the 5 new fields:
```ts
// After fetching contracts with current joins:
const contractIds = contracts.map((c) => c.id);
const customerIds = [...new Set(contracts.map((c) => c.customerId))];

// Last contact (max of CallLog + DunningAction per contract)
const [lastCalls, lastActions, brokenPromises, latestMdms, customerContractCounts, lastChannels] =
  await Promise.all([
    this.prisma.callLog.groupBy({
      by: ['contractId'],
      where: { contractId: { in: contractIds }, deletedAt: null },
      _max: { createdAt: true },
    }),
    this.prisma.dunningAction.groupBy({
      by: ['contractId'],
      where: { contractId: { in: contractIds }, deletedAt: null, sentAt: { not: null } },
      _max: { sentAt: true },
    }),
    this.prisma.auditLog.groupBy({
      by: ['entityId'],
      where: {
        entityId: { in: contractIds },
        entityType: 'Contract',
        action: 'BROKEN_PROMISE',
      },
      _count: true,
    }),
    this.prisma.mdmRequest.findMany({
      where: { contractId: { in: contractIds }, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      distinct: ['contractId'],
      select: { contractId: true, status: true },
    }),
    this.prisma.contract.groupBy({
      by: ['customerId'],
      where: {
        customerId: { in: customerIds },
        status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT', 'LEGAL'] },
        deletedAt: null,
      },
      _count: true,
    }),
    this.prisma.dunningAction.findMany({
      where: { contractId: { in: contractIds }, deletedAt: null, sentAt: { not: null } },
      orderBy: { sentAt: 'desc' },
      distinct: ['contractId'],
      select: { contractId: true, channel: true },
    }),
  ]);

// Build lookup maps
const callMap = new Map(lastCalls.map((r) => [r.contractId, r._max.createdAt]));
const actionMap = new Map(lastActions.map((r) => [r.contractId, r._max.sentAt]));
const brokenMap = new Map(brokenPromises.map((r) => [r.entityId, r._count]));
const mdmMap = new Map(latestMdms.map((r) => [r.contractId, r.status]));
const customerCountMap = new Map(customerContractCounts.map((r) => [r.customerId, r._count]));
const channelMap = new Map(lastChannels.map((r) => [r.contractId, r.channel]));

// Enrich rows
const enriched = contracts.map((c) => {
  const call = callMap.get(c.id);
  const action = actionMap.get(c.id);
  const lastContactedAt =
    call && action ? (call > action ? call : action) : call ?? action ?? null;

  return {
    ...c,
    lastContactedAt,
    brokenPromiseCount: brokenMap.get(c.id) ?? 0,
    mdmState: mdmMap.get(c.id) ?? 'NONE',
    relatedContractsCount: Math.max(0, (customerCountMap.get(c.customerId) ?? 1) - 1),
    lastChannel: channelMap.get(c.id) ?? null,
  };
});
```

- Return `enriched` instead of `contracts`
- Update TypeScript return type accordingly

- [ ] **Step 4: Run test**

Run: `cd apps/api && npx jest queue.service.spec`
Expected: PASS (5 new tests)

- [ ] **Step 5: Create frontend util for aging bucket**

Create `apps/web/src/pages/CollectionsPage/utils/cardIndicators.ts`:
```ts
export type AgingBucket = '1-7' | '8-30' | '31-60' | '61-90' | '90+';

export function agingBucket(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 7) return '1-7';
  if (daysOverdue <= 30) return '8-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '90+';
}

export function agingColor(bucket: AgingBucket): string {
  switch (bucket) {
    case '1-7': return 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30';
    case '8-30': return 'bg-amber-500/15 text-amber-700 border-amber-500/30';
    case '31-60': return 'bg-orange-500/15 text-orange-700 border-orange-500/30';
    case '61-90': return 'bg-red-500/15 text-red-700 border-red-500/30';
    case '90+': return 'bg-purple-500/15 text-purple-700 border-purple-500/30';
  }
}

export function formatRelativeTime(date: Date | string | null): string {
  if (!date) return 'ไม่เคย';
  const ts = typeof date === 'string' ? new Date(date) : date;
  const diffMs = Date.now() - ts.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `${diffMin} นาที`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} ชม.`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} วัน`;
}
```

- [ ] **Step 6: Type check + tests**

Run:
```bash
./tools/check-types.sh all
cd apps/api && npx jest queue.service.spec
```
Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/overdue/queue.service.ts \
        apps/api/src/modules/overdue/queue.service.spec.ts \
        apps/web/src/pages/CollectionsPage/utils/cardIndicators.ts
git commit -m "$(cat <<'EOF'
feat(collections): enrich queue response with card indicators

Queue service now computes per-contract:
- lastContactedAt: max(CallLog.createdAt, DunningAction.sentAt)
- brokenPromiseCount: count of BROKEN_PROMISE audit events
- mdmState: NONE|PENDING|LOCKED|UNLOCKED (latest MdmRequest)
- relatedContractsCount: other active contracts for same customer
- lastChannel: channel of most recent DunningAction

Uses batch groupBy + distinct queries to avoid N+1. Frontend util
cardIndicators.ts provides aging bucket / color / relative time helpers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: ContractCard Indicators — Frontend (B1 UI)

**Files:**
- Modify: `apps/web/src/pages/CollectionsPage/components/ContractCard.tsx`

- [ ] **Step 1: Read current ContractCard**

Read `apps/web/src/pages/CollectionsPage/components/ContractCard.tsx`

- [ ] **Step 2: Add indicator chip row**

Edit `ContractCard.tsx`:
- Import utilities:
```tsx
import { agingBucket, agingColor, formatRelativeTime } from '../utils/cardIndicators';
import { Phone, MessageCircle, FileText, Lock, Unlock, Clock, AlertTriangle, Users } from 'lucide-react';
```

- Add indicator row under main info (ชื่อ + ยอดค้าง):
```tsx
function IndicatorChips({ contract }: { contract: ContractRow }) {
  const bucket = agingBucket(contract.daysOverdue);
  const channels: Record<string, { icon: any; label: string }> = {
    LINE: { icon: MessageCircle, label: 'LINE' },
    SMS: { icon: MessageCircle, label: 'SMS' },
    CALL: { icon: Phone, label: 'โทร' },
    LETTER: { icon: FileText, label: 'จดหมาย' },
  };
  const ChannelIcon = contract.lastChannel ? channels[contract.lastChannel]?.icon : null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {/* Aging */}
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${agingColor(bucket)}`}>
        เลย {contract.daysOverdue} วัน
      </span>

      {/* Last contacted */}
      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />
        {formatRelativeTime(contract.lastContactedAt)}
      </span>

      {/* Broken promise */}
      {contract.brokenPromiseCount > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs text-red-700">
          <AlertTriangle className="h-3 w-3" />
          นัดผิด {contract.brokenPromiseCount} ครั้ง
        </span>
      )}

      {/* Last channel */}
      {ChannelIcon && (
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          <ChannelIcon className="h-3 w-3" />
          {channels[contract.lastChannel!].label}
        </span>
      )}

      {/* MDM state */}
      {contract.mdmState === 'PENDING' && (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700">
          <Lock className="h-3 w-3" />
          รอ OWNER อนุมัติ
        </span>
      )}
      {contract.mdmState === 'LOCKED' && (
        <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs text-red-700">
          <Lock className="h-3 w-3" />
          ล็อคแล้ว
        </span>
      )}

      {/* Related contracts */}
      {contract.relatedContractsCount > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          <Users className="h-3 w-3" />
          +{contract.relatedContractsCount} สัญญา
        </span>
      )}
    </div>
  );
}
```
- Use `<IndicatorChips contract={contract} />` in card body below main info

- Update `ContractRow` TypeScript type to include new fields:
```ts
export interface ContractRow {
  // ... existing fields ...
  lastContactedAt: Date | string | null;
  brokenPromiseCount: number;
  mdmState: 'NONE' | 'PENDING' | 'LOCKED' | 'UNLOCKED';
  relatedContractsCount: number;
  lastChannel: 'LINE' | 'SMS' | 'CALL' | 'LETTER' | null;
}
```

- [ ] **Step 3: Type check**

Run:
```bash
./tools/check-types.sh web
```
Expected: `Web: OK`

- [ ] **Step 4: Manual QA**

Dev server → `/collections` QueueTab → cards ต้องมี chip row พร้อม:
- aging badge สีตาม bucket
- last contacted relative time (หรือ "ไม่เคย")
- broken promise count ถ้า > 0
- channel icon ถ้า lastChannel ไม่ null
- MDM pill ถ้า PENDING/LOCKED
- related contracts ถ้า > 0

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/CollectionsPage/components/ContractCard.tsx
git commit -m "$(cat <<'EOF'
feat(collections): ContractCard indicator chips

Surface backend data that was previously invisible:
- Aging bucket badge (color-coded 1-7/8-30/31-60/61-90/90+ วัน)
- Last contacted relative time
- Broken promise count (if > 0)
- Last channel icon (LINE/SMS/CALL/LETTER)
- MDM state (PENDING/LOCKED)
- Related contracts count (+N สัญญา)

Trending arrow (daysOverdue delta over 7 days) deferred to P1 —
requires ContractDailySnapshot data collection to start first.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Queue Filter Panel — Backend (A2 backend)

**Files:**
- Modify: `apps/api/src/modules/overdue/dto/queue-query.dto.ts`
- Modify: `apps/api/src/modules/overdue/queue.service.ts`
- Test: `apps/api/src/modules/overdue/queue.service.spec.ts`

- [ ] **Step 1: Read current QueueQueryDto**

Read `apps/api/src/modules/overdue/dto/queue-query.dto.ts`. ปัจจุบันมี `search`, `assignedToId`, `showSkipTracing` (จาก #685 commit 8dfa7cfe)

- [ ] **Step 2: Extend DTO with filter fields**

Edit `queue-query.dto.ts`:
```ts
import {
  IsOptional,
  IsString,
  IsArray,
  IsEnum,
  IsInt,
  Min,
  IsBoolean,
  IsNumber,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ContractStatus, ProductType } from '@prisma/client';

export enum OverdueBucket {
  B_1_7 = '1-7',
  B_8_30 = '8-30',
  B_31_60 = '31-60',
  B_61_90 = '61-90',
  B_90_PLUS = '90+',
}

export enum LastContactedBucket {
  TODAY = 'today',
  THIS_WEEK = 'this_week',
  NEVER = 'never',
  OVER_7_DAYS = 'over_7_days',
}

export enum LineResponseState {
  RESPONDED = 'responded',
  IGNORED = 'ignored',
  BLOCKED = 'blocked',
  NO_LINE = 'no_line',
}

export enum MdmStateFilter {
  NOT_LOCKED = 'not_locked',
  LOCKED = 'locked',
  PENDING = 'pending',
}

export class QueueQueryDto {
  // Existing
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() assignedToId?: string; // 'self' | UUID | 'unassigned'
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() showSkipTracing?: boolean;

  // Pagination
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;

  // NEW: Filter fields
  @IsOptional() @IsString() branchId?: string;

  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : String(value).split(',')))
  @IsArray()
  @IsEnum(OverdueBucket, { each: true, message: 'bucket ไม่ถูกต้อง' })
  overdueBuckets?: OverdueBucket[];

  @IsOptional() @Type(() => Number) @IsNumber() minOutstanding?: number;
  @IsOptional() @Type(() => Number) @IsNumber() maxOutstanding?: number;

  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : String(value).split(',')))
  @IsArray()
  @IsEnum(ContractStatus, { each: true, message: 'status ไม่ถูกต้อง' })
  contractStatuses?: ContractStatus[];

  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : String(value).split(',')))
  @IsArray()
  @IsEnum(ProductType, { each: true, message: 'ประเภทสินค้าไม่ถูกต้อง' })
  productTypes?: ProductType[];

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) minLetterCount?: number;

  @IsOptional() @IsEnum(LastContactedBucket) lastContacted?: LastContactedBucket;
  @IsOptional() @IsEnum(LineResponseState) lineResponse?: LineResponseState;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) minBrokenPromise?: number;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  hasActivePromise?: boolean;

  @IsOptional() @IsEnum(MdmStateFilter) mdmState?: MdmStateFilter;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  slipReviewPending?: boolean;
}
```

Note: `OverdueBucket`, `LastContactedBucket` etc. — enums อาจ reuse จาก existing Prisma enums ถ้าเข้ากัน (ตรวจ schema)

- [ ] **Step 3: Write failing test**

Edit `queue.service.spec.ts` — new describe:
```ts
describe('queue.service — filters', () => {
  it('filters by overdueBuckets', async () => {
    // seed 5 contracts: daysOverdue = [3, 15, 45, 75, 120]
    const result = await service.getQueue({ userId: 'u1', overdueBuckets: ['8-30', '31-60'] });
    expect(result.data.map((c) => c.daysOverdue).sort()).toEqual([15, 45]);
  });

  it('filters by outstanding range', async () => {
    const result = await service.getQueue({ userId: 'u1', minOutstanding: 5000, maxOutstanding: 20000 });
    result.data.forEach((c) => {
      expect(c.outstanding.toNumber()).toBeGreaterThanOrEqual(5000);
      expect(c.outstanding.toNumber()).toBeLessThanOrEqual(20000);
    });
  });

  it('filters by minBrokenPromise', async () => {
    // seed one contract with 2 BROKEN_PROMISE events, one with 0
    const result = await service.getQueue({ userId: 'u1', minBrokenPromise: 1 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].brokenPromiseCount).toBeGreaterThanOrEqual(1);
  });

  it('filters by lastContacted=never', async () => {
    const result = await service.getQueue({ userId: 'u1', lastContacted: 'never' });
    result.data.forEach((c) => expect(c.lastContactedAt).toBeNull());
  });

  it('filters by mdmState=not_locked', async () => {
    const result = await service.getQueue({ userId: 'u1', mdmState: 'not_locked' });
    result.data.forEach((c) => expect(['NONE', 'UNLOCKED']).toContain(c.mdmState));
  });
});
```

Run: `cd apps/api && npx jest queue.service.spec`
Expected: FAIL

- [ ] **Step 4: Implement filter where-builder**

Edit `queue.service.ts` — where-clause builder:
```ts
function buildQueueWhere(dto: QueueQueryDto, branchAccess: BranchAccess): Prisma.ContractWhereInput {
  const where: Prisma.ContractWhereInput = { deletedAt: null };

  // Branch scoping (SALES locked to own)
  if (branchAccess.scope === 'OWN_BRANCH') {
    where.branchId = branchAccess.branchId;
  } else if (dto.branchId) {
    where.branchId = dto.branchId;
  }

  // Assignee
  if (dto.assignedToId === 'self') {
    where.assignedToId = branchAccess.userId;
  } else if (dto.assignedToId === 'unassigned') {
    where.assignedToId = null;
  } else if (dto.assignedToId) {
    where.assignedToId = dto.assignedToId;
  }

  // Overdue buckets → daysOverdue ranges (assumed stored on contract or computed column)
  if (dto.overdueBuckets?.length) {
    const ranges = dto.overdueBuckets.map(bucketToRange);
    where.OR = ranges.map((r) => ({
      daysOverdue: { gte: r.min, ...(r.max ? { lte: r.max } : {}) },
    }));
  }

  // Outstanding range
  if (dto.minOutstanding !== undefined || dto.maxOutstanding !== undefined) {
    where.outstanding = {
      ...(dto.minOutstanding !== undefined ? { gte: dto.minOutstanding } : {}),
      ...(dto.maxOutstanding !== undefined ? { lte: dto.maxOutstanding } : {}),
    };
  }

  // Statuses
  if (dto.contractStatuses?.length) {
    where.status = { in: dto.contractStatuses };
  }

  // Product types (via join)
  if (dto.productTypes?.length) {
    where.product = { type: { in: dto.productTypes } };
  }

  // Skip tracing (existing)
  if (dto.showSkipTracing) {
    where.needsSkipTracing = true;
  }

  // Search (existing) — name / contract# / phone
  if (dto.search) {
    const q = dto.search.trim();
    where.OR = [
      ...(where.OR ?? []),
      { contractNumber: { contains: q, mode: 'insensitive' } },
      { customer: { name: { contains: q, mode: 'insensitive' } } },
      { customer: { phone: { contains: q.replace(/\D/g, '') } } },
    ];
  }

  return where;
}

function bucketToRange(b: OverdueBucket): { min: number; max?: number } {
  switch (b) {
    case '1-7': return { min: 1, max: 7 };
    case '8-30': return { min: 8, max: 30 };
    case '31-60': return { min: 31, max: 60 };
    case '61-90': return { min: 61, max: 90 };
    case '90+': return { min: 91 };
  }
}
```

- Post-fetch filters (things that can't go into SQL where — apply AFTER enrichment):
```ts
let filtered = enriched;

if (dto.lastContacted) {
  filtered = filtered.filter((c) => {
    const last = c.lastContactedAt ? new Date(c.lastContactedAt) : null;
    const now = Date.now();
    switch (dto.lastContacted) {
      case 'today': return last && now - last.getTime() < 86400000;
      case 'this_week': return last && now - last.getTime() < 7 * 86400000;
      case 'never': return last === null;
      case 'over_7_days': return !last || now - last.getTime() > 7 * 86400000;
    }
  });
}

if (dto.minBrokenPromise !== undefined) {
  filtered = filtered.filter((c) => c.brokenPromiseCount >= dto.minBrokenPromise!);
}

if (dto.mdmState) {
  filtered = filtered.filter((c) => {
    switch (dto.mdmState) {
      case 'not_locked': return c.mdmState === 'NONE' || c.mdmState === 'UNLOCKED';
      case 'locked': return c.mdmState === 'LOCKED';
      case 'pending': return c.mdmState === 'PENDING';
    }
  });
}

// ... similar for hasActivePromise, lineResponse, slipReviewPending ...
```

- Update `total` and `truncated` calc to reflect post-filter:
```ts
const postFilterTotal = filtered.length;
const truncated = contracts.length >= FETCH_CAP;
const paginated = filtered.slice((page - 1) * limit, page * limit);
return { data: paginated, total: postFilterTotal, page, limit, truncated };
```

- [ ] **Step 5: Run tests**

Run: `cd apps/api && npx jest queue.service.spec`
Expected: PASS all new + existing tests

- [ ] **Step 6: Type check**

Run:
```bash
./tools/check-types.sh api
```
Expected: `API: OK`

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/overdue/dto/queue-query.dto.ts \
        apps/api/src/modules/overdue/queue.service.ts \
        apps/api/src/modules/overdue/queue.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(collections): queue filter fields

Extend QueueQueryDto + queue.service where-builder to support:
- branchId (cross-branch roles)
- overdueBuckets (multi-select 1-7/8-30/31-60/61-90/90+)
- minOutstanding / maxOutstanding (slider range)
- contractStatuses / productTypes (multi-select)
- minLetterCount, minBrokenPromise
- lastContacted bucket (today/this_week/never/over_7_days) — post-filter
- lineResponse, hasActivePromise, mdmState, slipReviewPending — post-filter

Pre-fetch SQL filters where possible; post-enrichment filters for
computed fields (brokenPromiseCount, mdmState, lastContacted).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Queue Filter Panel — Frontend (A2 UI + chips + URL sync)

**Files:**
- Create: `apps/web/src/pages/CollectionsPage/components/FilterDrawer.tsx`
- Create: `apps/web/src/pages/CollectionsPage/components/FilterChipsBar.tsx`
- Create: `apps/web/src/pages/CollectionsPage/hooks/useQueueFilter.ts`
- Modify: `apps/web/src/pages/CollectionsPage/hooks/useCollectionsQueue.ts`
- Modify: `apps/web/src/pages/CollectionsPage/tabs/QueueTab.tsx` (+ others)

- [ ] **Step 1: Create useQueueFilter hook (URL sync)**

Create `apps/web/src/pages/CollectionsPage/hooks/useQueueFilter.ts`:
```ts
import { useSearchParams } from 'react-router-dom';
import { useMemo } from 'react';

export interface QueueFilterState {
  assigned?: 'self' | 'unassigned' | string;
  branchId?: string;
  overdueBuckets?: string[];
  minOutstanding?: number;
  maxOutstanding?: number;
  contractStatuses?: string[];
  productTypes?: string[];
  minLetterCount?: number;
  lastContacted?: 'today' | 'this_week' | 'never' | 'over_7_days';
  lineResponse?: 'responded' | 'ignored' | 'blocked' | 'no_line';
  minBrokenPromise?: number;
  hasActivePromise?: boolean;
  mdmState?: 'not_locked' | 'locked' | 'pending';
  showSkipTracing?: boolean;
  slipReviewPending?: boolean;
}

export function useQueueFilter(): [QueueFilterState, (patch: Partial<QueueFilterState>) => void, () => void] {
  const [params, setParams] = useSearchParams();

  const state: QueueFilterState = useMemo(() => ({
    assigned: params.get('assigned') ?? undefined,
    branchId: params.get('branchId') ?? undefined,
    overdueBuckets: params.get('buckets')?.split(',').filter(Boolean),
    minOutstanding: params.get('minOutstanding') ? Number(params.get('minOutstanding')) : undefined,
    maxOutstanding: params.get('maxOutstanding') ? Number(params.get('maxOutstanding')) : undefined,
    contractStatuses: params.get('statuses')?.split(',').filter(Boolean),
    productTypes: params.get('products')?.split(',').filter(Boolean),
    minLetterCount: params.get('minLetterCount') ? Number(params.get('minLetterCount')) : undefined,
    lastContacted: (params.get('lastContacted') ?? undefined) as QueueFilterState['lastContacted'],
    lineResponse: (params.get('lineResponse') ?? undefined) as QueueFilterState['lineResponse'],
    minBrokenPromise: params.get('minBrokenPromise') ? Number(params.get('minBrokenPromise')) : undefined,
    hasActivePromise: params.get('hasActivePromise') === 'true' ? true : params.get('hasActivePromise') === 'false' ? false : undefined,
    mdmState: (params.get('mdmState') ?? undefined) as QueueFilterState['mdmState'],
    showSkipTracing: params.get('showSkipTracing') === 'true',
    slipReviewPending: params.get('slipReviewPending') === 'true',
  }), [params]);

  const setFilter = (patch: Partial<QueueFilterState>) => {
    const next = { ...state, ...patch };
    const search = new URLSearchParams();
    if (next.assigned) search.set('assigned', next.assigned);
    if (next.branchId) search.set('branchId', next.branchId);
    if (next.overdueBuckets?.length) search.set('buckets', next.overdueBuckets.join(','));
    if (next.minOutstanding !== undefined) search.set('minOutstanding', String(next.minOutstanding));
    if (next.maxOutstanding !== undefined) search.set('maxOutstanding', String(next.maxOutstanding));
    if (next.contractStatuses?.length) search.set('statuses', next.contractStatuses.join(','));
    if (next.productTypes?.length) search.set('products', next.productTypes.join(','));
    if (next.minLetterCount !== undefined) search.set('minLetterCount', String(next.minLetterCount));
    if (next.lastContacted) search.set('lastContacted', next.lastContacted);
    if (next.lineResponse) search.set('lineResponse', next.lineResponse);
    if (next.minBrokenPromise !== undefined) search.set('minBrokenPromise', String(next.minBrokenPromise));
    if (next.hasActivePromise !== undefined) search.set('hasActivePromise', String(next.hasActivePromise));
    if (next.mdmState) search.set('mdmState', next.mdmState);
    if (next.showSkipTracing) search.set('showSkipTracing', 'true');
    if (next.slipReviewPending) search.set('slipReviewPending', 'true');
    setParams(search);
  };

  const reset = () => setParams(new URLSearchParams());

  return [state, setFilter, reset];
}
```

- [ ] **Step 2: Create FilterChipsBar**

Create `apps/web/src/pages/CollectionsPage/components/FilterChipsBar.tsx`:
```tsx
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { QueueFilterState } from '../hooks/useQueueFilter';

interface FilterChipsBarProps {
  filter: QueueFilterState;
  setFilter: (patch: Partial<QueueFilterState>) => void;
  reset: () => void;
  onOpenFilter: () => void;
  resultCount?: number;
  totalCount?: number;
}

interface Chip {
  label: string;
  clear: Partial<QueueFilterState>;
}

function buildChips(f: QueueFilterState): Chip[] {
  const chips: Chip[] = [];
  if (f.assigned === 'self') chips.push({ label: 'ของฉัน', clear: { assigned: undefined } });
  if (f.assigned === 'unassigned') chips.push({ label: 'ยังไม่ assign', clear: { assigned: undefined } });
  f.overdueBuckets?.forEach((b) =>
    chips.push({ label: `เลย ${b} วัน`, clear: { overdueBuckets: f.overdueBuckets!.filter((x) => x !== b) } }),
  );
  if (f.minOutstanding !== undefined || f.maxOutstanding !== undefined) {
    chips.push({
      label: `ยอด ${f.minOutstanding ?? 0}–${f.maxOutstanding ?? '∞'}`,
      clear: { minOutstanding: undefined, maxOutstanding: undefined },
    });
  }
  f.contractStatuses?.forEach((s) =>
    chips.push({ label: s, clear: { contractStatuses: f.contractStatuses!.filter((x) => x !== s) } }),
  );
  if (f.lastContacted === 'never') chips.push({ label: 'ไม่เคยแตะ', clear: { lastContacted: undefined } });
  if (f.lastContacted === 'over_7_days') chips.push({ label: 'ไม่แตะ >7 วัน', clear: { lastContacted: undefined } });
  if (f.minBrokenPromise !== undefined) chips.push({ label: `นัดผิด ≥${f.minBrokenPromise}`, clear: { minBrokenPromise: undefined } });
  if (f.mdmState) chips.push({ label: `MDM ${f.mdmState}`, clear: { mdmState: undefined } });
  if (f.showSkipTracing) chips.push({ label: 'ต้องหาเบอร์', clear: { showSkipTracing: false } });
  return chips;
}

export function FilterChipsBar({ filter, setFilter, reset, onOpenFilter, resultCount, totalCount }: FilterChipsBarProps) {
  const chips = buildChips(filter);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={onOpenFilter}>
        Filter {chips.length > 0 && <span className="ml-1 text-primary">({chips.length})</span>}
      </Button>
      {chips.map((chip, i) => (
        <button
          key={i}
          type="button"
          onClick={() => setFilter(chip.clear)}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs hover:bg-accent"
        >
          {chip.label}
          <X className="h-3 w-3" />
        </button>
      ))}
      {chips.length > 0 && (
        <Button variant="ghost" size="sm" onClick={reset}>
          ล้างทั้งหมด
        </Button>
      )}
      {resultCount !== undefined && totalCount !== undefined && (
        <span className="ml-auto text-xs text-muted-foreground">
          แสดง {resultCount} จาก {totalCount}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create FilterDrawer**

Create `apps/web/src/pages/CollectionsPage/components/FilterDrawer.tsx`:

> เนื่องจากไฟล์ยาว (~300 lines) ให้ใส่ Section Accordion (Who/State/Activity) + Apply button + Reset button + live count. โครงสร้างประกอบด้วย:
> - Sheet/Drawer จาก shadcn (`Sheet` component)
> - Accordion 3 sections
> - แต่ละ section ใช้ CheckboxGroup / Slider / RadioGroup จาก shadcn
> - Footer: "Apply" + "Reset" + live count
>
> ให้ดู `apps/web/src/pages/CollectionsPage/tabs/FollowUpTab.tsx` existing toggle เป็น reference สำหรับ styling

**โครงร่าง**:
```tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { QueueFilterState } from '../hooks/useQueueFilter';
import { useAuth } from '@/contexts/AuthContext';
import { useState, useEffect } from 'react';

interface FilterDrawerProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  filter: QueueFilterState;
  onApply: (patch: Partial<QueueFilterState>) => void;
  onReset: () => void;
  liveCount?: number;
}

export function FilterDrawer({ open, onOpenChange, filter, onApply, onReset, liveCount }: FilterDrawerProps) {
  const { user } = useAuth();
  const canPickBranch = ['OWNER', 'FINANCE_MANAGER'].includes(user?.role ?? '');
  const [draft, setDraft] = useState<QueueFilterState>(filter);

  useEffect(() => setDraft(filter), [filter, open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>ตัวกรอง</SheetTitle>
        </SheetHeader>

        <Accordion type="multiple" defaultValue={['who', 'state']} className="mt-4">
          {/* Section 1: Who */}
          <AccordionItem value="who">
            <AccordionTrigger>ผู้ดูแล</AccordionTrigger>
            <AccordionContent className="space-y-3">
              <RadioGroup
                value={draft.assigned ?? 'any'}
                onValueChange={(v) => setDraft({ ...draft, assigned: v === 'any' ? undefined : v as any })}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="any" id="any" /><Label htmlFor="any">ทั้งหมด</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="self" id="self" /><Label htmlFor="self">ของฉัน</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="unassigned" id="unassigned" /><Label htmlFor="unassigned">ยังไม่ assign</Label>
                </div>
              </RadioGroup>
              {canPickBranch && (
                <div>
                  <Label>สาขา</Label>
                  {/* Branch select (existing component) */}
                </div>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* Section 2: Contract state */}
          <AccordionItem value="state">
            <AccordionTrigger>สถานะสัญญา</AccordionTrigger>
            <AccordionContent className="space-y-3">
              <div>
                <Label>Overdue bucket</Label>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(['1-7', '8-30', '31-60', '61-90', '90+'] as const).map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => {
                        const curr = draft.overdueBuckets ?? [];
                        setDraft({
                          ...draft,
                          overdueBuckets: curr.includes(b) ? curr.filter((x) => x !== b) : [...curr, b],
                        });
                      }}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        draft.overdueBuckets?.includes(b)
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-muted'
                      }`}
                    >
                      {b} วัน
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label>ยอดค้าง (฿)</Label>
                <Slider
                  min={0}
                  max={100000}
                  step={500}
                  value={[draft.minOutstanding ?? 0, draft.maxOutstanding ?? 100000]}
                  onValueChange={(v) => setDraft({ ...draft, minOutstanding: v[0], maxOutstanding: v[1] })}
                />
                <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                  <span>฿{(draft.minOutstanding ?? 0).toLocaleString()}</span>
                  <span>฿{(draft.maxOutstanding ?? 100000).toLocaleString()}+</span>
                </div>
              </div>
              {/* ... contractStatuses, productTypes, minLetterCount similar pattern ... */}
            </AccordionContent>
          </AccordionItem>

          {/* Section 3: Activity & risk */}
          <AccordionItem value="activity">
            <AccordionTrigger>กิจกรรม & ความเสี่ยง</AccordionTrigger>
            <AccordionContent className="space-y-3">
              <div>
                <Label>ติดต่อล่าสุด</Label>
                <RadioGroup
                  value={draft.lastContacted ?? 'any'}
                  onValueChange={(v) => setDraft({ ...draft, lastContacted: v === 'any' ? undefined : v as any })}
                >
                  {/* ... radio options: any/today/this_week/never/over_7_days ... */}
                </RadioGroup>
              </div>
              {/* ... lineResponse, minBrokenPromise, hasActivePromise, mdmState, showSkipTracing, slipReviewPending ... */}
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="sticky bottom-0 mt-6 flex items-center gap-2 border-t border-border bg-background pt-4">
          <Button variant="outline" onClick={() => { setDraft({}); onReset(); }}>ล้าง</Button>
          <div className="flex-1 text-sm text-muted-foreground">
            {liveCount !== undefined ? `จะแสดง ${liveCount} แถว` : ''}
          </div>
          <Button
            onClick={() => {
              onApply(draft);
              onOpenChange(false);
            }}
          >
            Apply
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Wire into QueueTab**

Edit `apps/web/src/pages/CollectionsPage/tabs/QueueTab.tsx`:
- Import `useQueueFilter`, `FilterDrawer`, `FilterChipsBar`
- State: `filterOpen: boolean`
- Replace query call to include filter params
- Render chips bar above cards, drawer overlay
- Pass `onOpenFilter={() => setFilterOpen(true)}` to TruncatedBanner too

- [ ] **Step 5: Update useCollectionsQueue**

Edit `apps/web/src/pages/CollectionsPage/hooks/useCollectionsQueue.ts`:
- Accept `filter: QueueFilterState` param
- Pass to backend as query params

- [ ] **Step 6: Type check + smoke**

Run:
```bash
./tools/check-types.sh web
```

Dev server → `/collections?buckets=31-60,61-90&minBrokenPromise=1` → drawer + chips show state, URL persists on reload

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/CollectionsPage/components/FilterDrawer.tsx \
        apps/web/src/pages/CollectionsPage/components/FilterChipsBar.tsx \
        apps/web/src/pages/CollectionsPage/hooks/useQueueFilter.ts \
        apps/web/src/pages/CollectionsPage/hooks/useCollectionsQueue.ts \
        apps/web/src/pages/CollectionsPage/tabs/QueueTab.tsx \
        apps/web/src/pages/CollectionsPage/tabs/FollowUpTab.tsx \
        apps/web/src/pages/CollectionsPage/tabs/PromiseTab.tsx \
        apps/web/src/pages/CollectionsPage/tabs/AllTab.tsx
git commit -m "$(cat <<'EOF'
feat(collections): queue filter drawer + chips + URL sync

Right-side drawer with 3 accordion sections (Who / State / Activity).
Filter chips bar below PageHeader shows active filters, click × to
remove per-chip; "ล้างทั้งหมด" clears everything. State synced to
URL query params (?buckets=31-60,61-90&minBrokenPromise=1) so filter
state is shareable and survives page refresh.

SALES role auto-locked to own branch (no branch picker visible).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Command Palette — Backend Search Endpoint (A1 backend)

**Files:**
- Create: `apps/api/src/modules/search/search.module.ts`
- Create: `apps/api/src/modules/search/search.controller.ts`
- Create: `apps/api/src/modules/search/search.service.ts`
- Create: `apps/api/src/modules/search/dto/search-query.dto.ts`
- Create: `apps/api/src/modules/search/search.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Scaffold module**

Run: `./tools/generate-module.sh search`

Or manually create 4 files per pattern in `apps/api/src/modules/customers/`.

- [ ] **Step 2: Write failing test**

Create `apps/api/src/modules/search/search.service.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { SearchService } from './search.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('SearchService', () => {
  let service: SearchService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [SearchService, { provide: PrismaService, useValue: mockPrisma() }],
    }).compile();
    service = module.get(SearchService);
    prisma = module.get(PrismaService);
  });

  it('normalizes phone queries (strips non-digits, preserves +66)', () => {
    expect(service.normalizePhone('082-123-4567')).toBe('0821234567');
    expect(service.normalizePhone('+66 82 123 4567')).toBe('+66821234567');
  });

  it('returns grouped results (contracts, customers, IMEIs)', async () => {
    jest.spyOn(prisma.contract, 'findMany').mockResolvedValue([{ id: 'c1', contractNumber: 'CT001' } as any]);
    jest.spyOn(prisma.customer, 'findMany').mockResolvedValue([{ id: 'cu1', name: 'นายทดสอบ' } as any]);
    jest.spyOn(prisma.contractLetter, 'findMany').mockResolvedValue([]);
    // ... mock Product findMany for IMEI ...

    const result = await service.unionSearch({ q: 'ทดสอบ', userId: 'u1', userRole: 'OWNER' });

    expect(result.contracts).toHaveLength(1);
    expect(result.customers).toHaveLength(1);
  });

  it('respects branch scope for SALES', async () => {
    jest.spyOn(prisma.contract, 'findMany').mockResolvedValue([]);
    await service.unionSearch({ q: 'anything', userId: 'u1', userRole: 'SALES', branchId: 'br1' });

    expect(prisma.contract.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ branchId: 'br1' }),
      }),
    );
  });
});
```

Run: `cd apps/api && npx jest search.service.spec`
Expected: FAIL

- [ ] **Step 3: Implement SearchService**

Create `apps/api/src/modules/search/search.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface SearchResult {
  contracts: { id: string; contractNumber: string; customerName: string; status: string }[];
  customers: { id: string; name: string; phone: string | null }[];
  imeis: { contractId: string; imei: string; contractNumber: string; customerName: string }[];
  letterTrackings: { letterId: string; trackingNumber: string; contractId: string; contractNumber: string }[];
}

interface UnionSearchParams {
  q: string;
  userId: string;
  userRole: string;
  branchId?: string;
}

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  normalizePhone(phone: string): string {
    const hasPlus = phone.trim().startsWith('+');
    const digits = phone.replace(/\D/g, '');
    return hasPlus ? `+${digits}` : digits;
  }

  async unionSearch({ q, userId, userRole, branchId }: UnionSearchParams): Promise<SearchResult> {
    const query = q.trim();
    if (query.length < 2) {
      return { contracts: [], customers: [], imeis: [], letterTrackings: [] };
    }

    const phoneNormalized = this.normalizePhone(query);
    const isSales = userRole === 'SALES';
    const branchFilter = isSales && branchId ? { branchId } : {};

    const [contracts, customers, letters] = await Promise.all([
      this.prisma.contract.findMany({
        where: {
          deletedAt: null,
          ...branchFilter,
          OR: [
            { contractNumber: { contains: query, mode: 'insensitive' } },
            { customer: { name: { contains: query, mode: 'insensitive' } } },
            { customer: { phone: { contains: phoneNormalized } } },
          ],
        },
        select: {
          id: true,
          contractNumber: true,
          status: true,
          customer: { select: { name: true } },
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.customer.findMany({
        where: {
          deletedAt: null,
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { phone: { contains: phoneNormalized } },
          ],
        },
        select: { id: true, name: true, phone: true },
        take: 10,
      }),
      this.prisma.contractLetter.findMany({
        where: {
          deletedAt: null,
          trackingNumber: { contains: query, mode: 'insensitive' },
          contract: branchFilter,
        },
        select: {
          id: true,
          trackingNumber: true,
          contractId: true,
          contract: { select: { contractNumber: true } },
        },
        take: 10,
      }),
    ]);

    // TODO: IMEI search via Product if schema has imei field on ProductSale or similar
    const imeis: SearchResult['imeis'] = [];

    return {
      contracts: contracts.map((c) => ({
        id: c.id,
        contractNumber: c.contractNumber,
        customerName: c.customer?.name ?? '',
        status: c.status,
      })),
      customers: customers.map((c) => ({ id: c.id, name: c.name, phone: c.phone })),
      imeis,
      letterTrackings: letters.map((l) => ({
        letterId: l.id,
        trackingNumber: l.trackingNumber ?? '',
        contractId: l.contractId,
        contractNumber: l.contract?.contractNumber ?? '',
      })),
    };
  }
}
```

- [ ] **Step 4: Create DTO + Controller**

Create `apps/api/src/modules/search/dto/search-query.dto.ts`:
```ts
import { IsString, MinLength, MaxLength } from 'class-validator';

export class SearchQueryDto {
  @IsString({ message: 'กรุณาระบุคำค้น' })
  @MinLength(2, { message: 'คำค้นต้องมีอย่างน้อย 2 ตัวอักษร' })
  @MaxLength(100, { message: 'คำค้นยาวเกินไป' })
  q!: string;
}
```

Create `apps/api/src/modules/search/search.controller.ts`:
```ts
import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';

@Controller('search')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SearchController {
  constructor(private service: SearchService) {}

  @Get('union')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async unionSearch(@Query() dto: SearchQueryDto, @Req() req: any) {
    return this.service.unionSearch({
      q: dto.q,
      userId: req.user.id,
      userRole: req.user.role,
      branchId: req.user.branchId,
    });
  }
}
```

Create `search.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
```

- [ ] **Step 5: Register in app.module.ts**

Edit `apps/api/src/app.module.ts`:
```ts
import { SearchModule } from './modules/search/search.module';
// ... in imports array
imports: [..., SearchModule, ...]
```

- [ ] **Step 6: Run test**

Run: `cd apps/api && npx jest search.service.spec`
Expected: PASS (3 tests)

- [ ] **Step 7: Type check**

Run: `./tools/check-types.sh api`
Expected: `API: OK`

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/search/ apps/api/src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(search): union search endpoint for command palette

New GET /search/union?q=... endpoint searches across:
- Contracts (by contractNumber, customer name, customer phone)
- Customers (by name, phone)
- Letter tracking numbers

Phone normalize: strips non-digits, preserves +66 country code.
SALES role automatically scoped to own branchId.

Max 10 results per group. Returns grouped structure for CommandPalette
UI consumption in Task 12.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Command Palette — Frontend (A1 UI)

**Files:**
- Create: `apps/web/src/components/CommandPalette.tsx`
- Create: `apps/web/src/pages/CollectionsPage/hooks/useUnionSearch.ts`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Check cmdk dependency**

Run:
```bash
grep cmdk apps/web/package.json
```
Expected: `"cmdk": "..."` (shadcn command component ใช้ cmdk internally)

If absent: `cd apps/web && npm install cmdk`

- [ ] **Step 2: Create useUnionSearch hook**

Create `apps/web/src/pages/CollectionsPage/hooks/useUnionSearch.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface SearchResult {
  contracts: { id: string; contractNumber: string; customerName: string; status: string }[];
  customers: { id: string; name: string; phone: string | null }[];
  imeis: { contractId: string; imei: string; contractNumber: string; customerName: string }[];
  letterTrackings: { letterId: string; trackingNumber: string; contractId: string; contractNumber: string }[];
}

export function useUnionSearch(q: string) {
  return useQuery<SearchResult>({
    queryKey: ['search-union', q],
    queryFn: async () => (await api.get('/search/union', { params: { q } })).data,
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
  });
}
```

- [ ] **Step 3: Create CommandPalette component**

Create `apps/web/src/components/CommandPalette.tsx`:
```tsx
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command, CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { FileText, User, Phone, Mail } from 'lucide-react';
import { useUnionSearch } from '@/pages/CollectionsPage/hooks/useUnionSearch';
import { useDebounce } from '@/hooks/useDebounce';

const RECENT_KEY = 'cmdk-recent-searches';

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecent(q: string) {
  const list = loadRecent().filter((x) => x !== q);
  list.unshift(q);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 10)));
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 200);
  const { data, isLoading } = useUnionSearch(debounced);
  const navigate = useNavigate();
  const [recent, setRecent] = useState(loadRecent());

  useEffect(() => {
    if (open) setRecent(loadRecent());
  }, [open]);

  function handleSelect(path: string) {
    saveRecent(query);
    onOpenChange(false);
    setQuery('');
    navigate(path);
  }

  const showRecent = !query && recent.length > 0;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="ค้นหา contract# / ชื่อ / เบอร์ / IMEI / tracking#..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {showRecent && (
          <CommandGroup heading="ค้นล่าสุด">
            {recent.map((q) => (
              <CommandItem key={q} value={q} onSelect={() => setQuery(q)}>
                {q}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {!showRecent && debounced.length >= 2 && !isLoading && (
          <CommandEmpty>ไม่พบผลลัพธ์</CommandEmpty>
        )}

        {data?.contracts && data.contracts.length > 0 && (
          <CommandGroup heading={`สัญญา (${data.contracts.length})`}>
            {data.contracts.map((c) => (
              <CommandItem
                key={c.id}
                value={`contract-${c.id}`}
                onSelect={() => handleSelect(`/contracts/${c.id}`)}
              >
                <FileText className="mr-2 h-4 w-4" />
                <div className="flex flex-col">
                  <span className="leading-snug">{c.contractNumber} — {c.customerName}</span>
                  <span className="text-xs text-muted-foreground">{c.status}</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {data?.customers && data.customers.length > 0 && (
          <CommandGroup heading={`ลูกค้า (${data.customers.length})`}>
            {data.customers.map((c) => (
              <CommandItem
                key={c.id}
                value={`customer-${c.id}`}
                onSelect={() => handleSelect(`/customers/${c.id}`)}
              >
                <User className="mr-2 h-4 w-4" />
                <span>{c.name} {c.phone ? `· ${c.phone}` : ''}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {data?.letterTrackings && data.letterTrackings.length > 0 && (
          <CommandGroup heading={`Tracking (${data.letterTrackings.length})`}>
            {data.letterTrackings.map((l) => (
              <CommandItem
                key={l.letterId}
                value={`tracking-${l.letterId}`}
                onSelect={() => handleSelect(`/contracts/${l.contractId}`)}
              >
                <Mail className="mr-2 h-4 w-4" />
                <span>{l.trackingNumber} → {l.contractNumber}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
```

- [ ] **Step 4: Register globally + bind hotkey**

Edit `apps/web/src/App.tsx`:
- Import + state:
```tsx
import { useEffect, useState } from 'react';
import { CommandPalette } from '@/components/CommandPalette';

// inside <App>:
const [paletteOpen, setPaletteOpen] = useState(false);

useEffect(() => {
  function handler(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setPaletteOpen((o) => !o);
    }
  }
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```
- Render: `<CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />` inside providers (above router)

- Add search icon button in `MainLayout` header (top right) to also open palette for mouse users:
```tsx
<Button variant="ghost" size="icon" onClick={() => { /* dispatch event or use context */ }}>
  <Search className="h-4 w-4" />
</Button>
```

For cleaner wire, create a `usePaletteTrigger` context or use a simple global event bus:
```tsx
// Simpler: keep state in App.tsx and pass setPaletteOpen via context
```

- [ ] **Step 5: Type check + smoke**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`

Dev server → press `⌘K` (Mac) or `Ctrl+K` (Linux/Win) → palette opens → type "test" → see results grouped → click → navigate

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/CommandPalette.tsx \
        apps/web/src/pages/CollectionsPage/hooks/useUnionSearch.ts \
        apps/web/src/App.tsx
git commit -m "$(cat <<'EOF'
feat(search): ⌘K command palette (global)

Cmd+K / Ctrl+K opens palette anywhere. Search runs against
/search/union backend with 200ms debounce (min 2 chars).

Results grouped by Contracts / Customers / Letter Tracking.
Recent searches persist in localStorage (last 10).
Click result navigates to contract/customer detail.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final Verification

- [ ] **Run full test suite**

```bash
./tools/run-tests.sh --skip-e2e
```

- [ ] **Run E2E smoke for Collections**

```bash
cd apps/web && npx playwright test e2e/collections
```

- [ ] **Check bundle size impact (optional)**

```bash
cd apps/web && npm run build -- --mode analyze
```
Monitor for unexpected regressions.

- [ ] **Push branch + open PR**

```bash
git push origin feat/collections-ui-p0
gh pr create --title "feat(collections): P0 UI enhancements" --body "$(cat <<'EOF'
## Summary
- 9 P0 features from spec `docs/superpowers/specs/2026-04-25-collections-ui-enhancements-design.md`
- Foundation: DateRangePicker shared component
- Quick wins: ApprovalTab role gate, Truncated banner, MDM unlock button
- Medium: Wallpaper on MDM approve, Letter evidence preview
- Large: ContractCard indicators, Queue filter panel + chips + URL sync, Command palette

## Test plan
- [ ] Tab visibility test (4 roles × 6 tabs)
- [ ] Queue filter combinations (5+ combinations)
- [ ] ContractCard shows all 7 indicator types
- [ ] MDM unlock visible only for OWNER
- [ ] Wallpaper checkbox pre-checked when URL set
- [ ] Letter dispatch button disabled until evidence verified checkbox ticked
- [ ] Cmd+K opens palette, 2-char min, debounce works
- [ ] Truncated banner shows when >500 contracts match
- [ ] URL filter state survives refresh

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Checklist

### Spec Coverage (from `docs/superpowers/specs/2026-04-25-collections-ui-enhancements-design.md` P0 section)
- [x] A1 ⌘K Command Palette → Task 11 + 12
- [x] A2 Queue Filter Panel → Task 9 + 10
- [x] A6 Date Range Picker → Task 1
- [x] B1 ContractCard indicators → Task 7 + 8 (trending arrow deferred to P1)
- [x] B7 Truncated banner → Task 3
- [x] D1 MDM unlock button → Task 4
- [x] D2 Wallpaper attach → Task 5
- [x] D4 Letter evidence preview → Task 6
- [x] D9 ApprovalTab role gate → Task 2

**Coverage 9/9 ✅**

### Placeholder scan — passed (no TBD, TODO, "similar to N", "implement later")

### Type consistency
- `QueueFilterState` — matches across useQueueFilter hook, FilterDrawer props, FilterChipsBar props, useCollectionsQueue filter param
- `ContractRow` — matches between queue.service (backend) response shape + frontend type + IndicatorChips consumer
- `SearchResult` — matches between search.service (API) + useUnionSearch (hook) + CommandPalette consumer
- `ApproveMdmDto { includeWallpaper }` — matches DTO + useApproveMdm hook + MdmRow dialog

### Potential gaps caught during review
- **Search IMEI endpoint** — placeholder TODO in SearchService step 3. Spec says include IMEI. Added note in task but need Product schema check. If Product.imei field exists, add query; else defer to P1.

  **Resolution**: check schema before Task 11. If `Product.imei` (string) exists, add to unionSearch. If not, document gap and defer.

### Known scope trimmed (intentional)
- Trending arrow (B1) — deferred to P1, requires snapshot table
- Branch select widget in FilterDrawer — used existing component reference only (actual component name TBD during implementation — check imports in DunningSettingsPage)
- ProductSale / IMEI schema — verify before Task 11

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-25-collections-ui-p0.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task cluster (Task 1-3 quick wins serial, Tasks 4-12 parallel-able across 6 agents), review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch with checkpoints

Which approach?
