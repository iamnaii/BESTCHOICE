# Purchasing v2 — Batch 5: Dashboard Strip + Overdue + AP Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Purchase Orders page a glanceable **ภาพรวมจัดซื้อ** summary strip — 7 KPI/alert cards (รออนุมัติ · รอสั่ง · กำลังมา · เลยกำหนด · รอรับ · รอ QC · ค้างจ่าย) built on the exact `DashboardKPIs` card pattern (colored left-border, `size-10` icon box, count pill, hover-lift) and wired to the B0 `GET /purchase-orders/summary` endpoint. Each card is a **filter shortcut** that jumps the list/tab to the matching slice. Surface the **เลยกำหนด (overdue)** count on the strip and as a per-row badge on the list. Polish the `AccountsPayableTab` (clearer remaining/paid, due-date urgency, deep-links into PO detail).

**Architecture:** Pure-frontend batch. Add a `PurchasingSummaryStrip` component + a config/helper module (`summaryStrip.ts`) that maps the 7 summary keys → label/icon/color-token/filter-action; extend `usePurchaseOrdersData` with a `useQuery` for `/purchase-orders/summary` and an `overdueOnly` client filter flag; wire the strip into `PurchaseOrdersPage/index.tsx`; add the `overdueOnly` client filter to `POListTab` (REUSING B1's existing `isOverdue` helper + per-row overdue badge — not re-implementing them); polish `AccountsPayableTab`. No backend changes — `GET /purchase-orders/summary` ships in B0; the `ORDERED` status + overdue badge/helper ship in B1.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind + shadcn/ui (`Card`/`CardContent`) + Radix + lucide-react (`apps/web`); `@tanstack/react-query` + `@/lib/api`; vitest + RTL for logic tests.

**Spec:** `docs/superpowers/specs/2026-06-29-purchasing-receiving-ux-v2-design.md`

## Global Constraints

- **Red line — no accounting/finance:** this batch is frontend-only and touches **no** API code. Introduce **no** import of any accounting/finance/journal/expense/tax module into `purchase-orders`; do not touch `trade-in` or `Product.ownedByCompanyId`; receiving stays JE-free. **Additive only** — no rewrite of existing components, no data-model change.
- **Dependency on B0:** this batch consumes `GET /purchase-orders/summary` → `{ pendingApproval, toOrder, incoming, overdue, receiving, waitingQc, unpaid }` (all `number`), shipped in `docs/superpowers/plans/2026-06-29-purchasing-b0-backend-foundation.md` Task 5. **Do not implement that endpoint here.** If it is missing at runtime, the strip query fails gracefully (see Task 2 — render nothing on error, never crash the page).
- **Dependency on B1 (`docs/superpowers/plans/2026-06-29-purchasing-b1-list-detail.md`):** B1 ships before B5 (one-deploy-per-batch order B0→B1→…→B5) and ALREADY adds, in `POListTab.tsx` and friends, everything the `incoming`/`overdue`/`receiving` filter shortcuts rely on: the `ORDERED` status in `constants.ts` (`statusLabels`/`statusColors`), in `@/lib/status-badges.ts` (`poStatusMap.ORDERED`), in the status `<select>` dropdown, and in the active-filter-chip status-label map; a tested pure helper `isOverdue(po, now?)` at `apps/web/src/pages/PurchaseOrdersPage/po-list.util.ts`; and the per-row red "เลยกำหนด" badge in the status column. **B5 MUST NOT re-implement any of these.** Task 5 below therefore (a) imports `isOverdue` from `../po-list.util` instead of defining a new helper, (b) does NOT touch the status column / `AlertTriangle` import (B1 owns the per-row badge), and (c) adds ONLY the genuinely-new `overdueOnly` client filter + its clear-chip wiring. If B5 is ever picked up before B1 has landed, STOP and ship B1 first — the strip's status-based shortcuts (`ORDERED` filtering, the dropdown reflecting "สั่งซื้อแล้ว", the chip label, the row badge) will be incomplete otherwise.
- **Frontend rules (`.claude/rules/frontend.md`):**
  - Data fetching via `useQuery`/`useMutation` from `@tanstack/react-query` **only**; API calls via `api.get()` from `@/lib/api` **only** — **no** raw `fetch`/`axios`.
  - UI = **shadcn/ui + Radix + lucide-react only** (reuse `Card`/`CardContent` from `@/components/ui/card`, mirror `DashboardKPIs`). No MUI/AntD.
  - **Design tokens only** — no hardcoded gray/hex, no `text-gray-*`/`bg-gray-*`, no `bg-white` (print/receipt context only). Use `bg-primary`, `bg-destructive`, `bg-warning`, `bg-success`, `bg-card`, `bg-muted`, `text-muted-foreground`, `border-border`, etc. The strip card colors come from a fixed token set (`primary`/`warning`/`destructive`/`success`/`info`), NOT inline hex.
  - **Thai UI text uses `leading-snug`** (never `leading-none`).
  - Routes stay lazy-loaded (no route change in this batch — `/purchase-orders` already lazy-loads).
  - `sonner` toasts for notifications (`toast.success`/`toast.error`); `useDebounce` for search (search already exists in `POListTab`; this batch adds no new search input).
- **Money = display formatting only** — AP money already arrives as numbers from the backend; format via `.toLocaleString()` (existing pattern in `AccountsPayableTab`). No client-side money math.
- **Type gate:** `./tools/check-types.sh all` must report **0 errors** before each commit.
- **Web tests:** vitest (`apps/web` runs `vitest run` via `npm test`; test files match `src/**/*.{test,spec}.{ts,tsx}`). Write an RTL/vitest test ONLY where it adds genuine value (the strip config/mapping logic) — UI wiring is verified manually on desktop AND mobile viewports.

---

### Task 1: Summary-strip config + filter-mapping helper (`summaryStrip.ts`) + unit test

**Files:**
- Create: `apps/web/src/pages/PurchaseOrdersPage/summaryStrip.ts`
- Create: `apps/web/src/pages/PurchaseOrdersPage/summaryStrip.test.ts`

**Interfaces:**
- Consumes: nothing (pure config + a `lucide-react` icon component reference per card).
- Produces:
  - `interface PurchasingSummary { pendingApproval: number; toOrder: number; incoming: number; overdue: number; receiving: number; waitingQc: number; unpaid: number; }` — **identical** key set to B0's `getSummary()` return (B0 plan Task 5).
  - `type SummaryFilterAction = { tab: 'list'; status: string; overdueOnly: boolean } | { tab: 'payable' } | { panel: 'qc' };`
  - `interface SummaryCardDef { key: keyof PurchasingSummary; label: string; icon: LucideIcon; tone: 'primary' | 'warning' | 'destructive' | 'success' | 'info'; action: SummaryFilterAction; }`
  - `const SUMMARY_CARDS: SummaryCardDef[]` (7 entries, in display order).
  - `const TONE_STYLES: Record<SummaryCardDef['tone'], { border: string; iconBox: string; icon: string; pill: string }>` — token-only Tailwind classes.

- [ ] **Step 1: Write the failing test first**

Create `apps/web/src/pages/PurchaseOrdersPage/summaryStrip.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SUMMARY_CARDS, TONE_STYLES, type PurchasingSummary } from './summaryStrip';

describe('SUMMARY_CARDS', () => {
  it('defines exactly the 7 B0 summary keys, in order, with no duplicates', () => {
    const keys = SUMMARY_CARDS.map((c) => c.key);
    expect(keys).toEqual([
      'pendingApproval',
      'toOrder',
      'incoming',
      'overdue',
      'receiving',
      'waitingQc',
      'unpaid',
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('covers every key of the PurchasingSummary type (compile-time + runtime parity)', () => {
    const sample: PurchasingSummary = {
      pendingApproval: 1, toOrder: 2, incoming: 3, overdue: 4, receiving: 5, waitingQc: 6, unpaid: 7,
    };
    for (const card of SUMMARY_CARDS) {
      expect(typeof sample[card.key]).toBe('number');
    }
  });

  it('every card has a Thai label and a defined lucide icon', () => {
    for (const card of SUMMARY_CARDS) {
      expect(card.label.length).toBeGreaterThan(0);
      // lucide icons are forwardRef components → function (object in some builds)
      expect(['function', 'object']).toContain(typeof card.icon);
    }
  });

  it('overdue card routes to list+overdueOnly; toOrder→APPROVED; incoming→ORDERED; receiving→PARTIALLY_RECEIVED; pendingApproval→DRAFT', () => {
    const byKey = Object.fromEntries(SUMMARY_CARDS.map((c) => [c.key, c.action]));
    expect(byKey.overdue).toEqual({ tab: 'list', status: 'ORDERED', overdueOnly: true });
    expect(byKey.toOrder).toEqual({ tab: 'list', status: 'APPROVED', overdueOnly: false });
    expect(byKey.incoming).toEqual({ tab: 'list', status: 'ORDERED', overdueOnly: false });
    expect(byKey.receiving).toEqual({ tab: 'list', status: 'PARTIALLY_RECEIVED', overdueOnly: false });
    expect(byKey.pendingApproval).toEqual({ tab: 'list', status: 'DRAFT', overdueOnly: false });
  });

  it('unpaid card routes to the payable tab; waitingQc opens the qc panel', () => {
    const byKey = Object.fromEntries(SUMMARY_CARDS.map((c) => [c.key, c.action]));
    expect(byKey.unpaid).toEqual({ tab: 'payable' });
    expect(byKey.waitingQc).toEqual({ panel: 'qc' });
  });

  it('TONE_STYLES uses only design-token classes (no hardcoded gray/hex/white)', () => {
    const blob = JSON.stringify(TONE_STYLES);
    expect(blob).not.toMatch(/#[0-9a-fA-F]{3,6}/); // no hex
    expect(blob).not.toMatch(/\bbg-white\b/);
    expect(blob).not.toMatch(/-gray-/);
    // every tone present
    expect(Object.keys(TONE_STYLES).sort()).toEqual(
      ['destructive', 'info', 'primary', 'success', 'warning'].sort(),
    );
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd apps/web && npx vitest run src/pages/PurchaseOrdersPage/summaryStrip.test.ts`
Expected: FAIL — `Cannot find module './summaryStrip'`.

- [ ] **Step 3: Implement `summaryStrip.ts`**

Create `apps/web/src/pages/PurchaseOrdersPage/summaryStrip.ts`. The 7 cards mirror the spec's strip order (`รออนุมัติ · รอสั่ง · กำลังมา (⚠️ เลยกำหนด) · รอรับ · รอ QC · ค้างจ่าย`) — split "กำลังมา / เลยกำหนด" into two cards so overdue gets its own loud red card per the spec ("Surface the OVERDUE count/badge on the strip"). Icons are reused from lucide (same family as `DashboardKPIs`: `FileClock`, `ShoppingCart`, `Truck`, `AlertTriangle`, `PackageCheck`, `ClipboardCheck`, `Wallet`).

```typescript
import type { LucideIcon } from 'lucide-react';
import {
  FileClock,
  ShoppingCart,
  Truck,
  AlertTriangle,
  PackageCheck,
  ClipboardCheck,
  Wallet,
} from 'lucide-react';

/**
 * Compute-on-read purchasing counts from GET /purchase-orders/summary (B0).
 * Keys MUST stay identical to po-query.service.ts getSummary() return shape.
 */
export interface PurchasingSummary {
  pendingApproval: number;
  toOrder: number;
  incoming: number;
  overdue: number;
  receiving: number;
  waitingQc: number;
  unpaid: number;
}

/** What clicking a card does to the page. */
export type SummaryFilterAction =
  | { tab: 'list'; status: string; overdueOnly: boolean }
  | { tab: 'payable' }
  | { panel: 'qc' };

export type SummaryTone = 'primary' | 'warning' | 'destructive' | 'success' | 'info';

export interface SummaryCardDef {
  key: keyof PurchasingSummary;
  label: string;
  icon: LucideIcon;
  tone: SummaryTone;
  action: SummaryFilterAction;
}

/** Display order matches the spec's summary-strip zone. */
export const SUMMARY_CARDS: SummaryCardDef[] = [
  {
    key: 'pendingApproval',
    label: 'รออนุมัติ',
    icon: FileClock,
    tone: 'warning',
    action: { tab: 'list', status: 'DRAFT', overdueOnly: false },
  },
  {
    key: 'toOrder',
    label: 'รอสั่งซื้อ',
    icon: ShoppingCart,
    tone: 'primary',
    action: { tab: 'list', status: 'APPROVED', overdueOnly: false },
  },
  {
    key: 'incoming',
    label: 'กำลังมา',
    icon: Truck,
    tone: 'info',
    action: { tab: 'list', status: 'ORDERED', overdueOnly: false },
  },
  {
    key: 'overdue',
    label: 'เลยกำหนดส่ง',
    icon: AlertTriangle,
    tone: 'destructive',
    action: { tab: 'list', status: 'ORDERED', overdueOnly: true },
  },
  {
    key: 'receiving',
    label: 'รับบางส่วน',
    icon: PackageCheck,
    tone: 'warning',
    action: { tab: 'list', status: 'PARTIALLY_RECEIVED', overdueOnly: false },
  },
  {
    key: 'waitingQc',
    label: 'รอตรวจ QC',
    icon: ClipboardCheck,
    tone: 'warning',
    action: { panel: 'qc' },
  },
  {
    key: 'unpaid',
    label: 'ค้างจ่าย',
    icon: Wallet,
    tone: 'destructive',
    action: { tab: 'payable' },
  },
];

/**
 * Token-only Tailwind classes per tone — mirrors the DashboardKPIs card anatomy
 * (left border-strip, size-10 rounded icon box, count pill). No hex, no gray, no bg-white.
 */
export const TONE_STYLES: Record<SummaryTone, { border: string; iconBox: string; icon: string; pill: string }> = {
  primary: {
    border: 'bg-primary',
    iconBox: 'bg-primary/10 group-hover:bg-primary/20',
    icon: 'text-primary',
    pill: 'text-primary bg-primary/10',
  },
  warning: {
    border: 'bg-warning',
    iconBox: 'bg-warning/10 group-hover:bg-warning/20',
    icon: 'text-warning',
    pill: 'text-warning bg-warning/10',
  },
  destructive: {
    border: 'bg-destructive',
    iconBox: 'bg-destructive/10 group-hover:bg-destructive/20',
    icon: 'text-destructive',
    pill: 'text-destructive bg-destructive/10',
  },
  success: {
    border: 'bg-success',
    iconBox: 'bg-success/10 group-hover:bg-success/20',
    icon: 'text-success',
    pill: 'text-success bg-success/10',
  },
  info: {
    border: 'bg-info',
    iconBox: 'bg-info/10 group-hover:bg-info/20',
    icon: 'text-info',
    pill: 'text-info bg-info/10',
  },
};
```

> Note on `success` tone: defined for completeness/token-coverage parity (the test asserts all 5 tones exist) even though no current card uses it — keeps the palette consistent with `DashboardKPIs` (which uses primary/destructive/success/warning) and lets B-follow-ups add a "รับครบ" card without editing `TONE_STYLES`.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd apps/web && npx vitest run src/pages/PurchaseOrdersPage/summaryStrip.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Verify the `info` token exists (token-only constraint)**

The `info` tone uses `bg-info` / `text-info`. Confirm these tokens exist so the build doesn't ship a dead class.

Run: `cd apps/web && grep -rn "\-\-info\|text-info\|bg-info" src/index.css tailwind.config.* 2>/dev/null | head`
Expected: at least one match (the `info` semantic token is defined — `getStatusBadgeProps` already uses `variant: 'info'` across `status-badges.ts`, and `DashboardAlerts`/Badge render it). If `bg-info`/`text-info` are NOT defined as Tailwind utilities (only the Badge `info` variant exists), change the `incoming` card `tone` from `'info'` to `'primary'` in `SUMMARY_CARDS` and drop the `info` entry expectation — but FIRST confirm with the grep; do not guess.

- [ ] **Step 6: Type-check + commit**

```bash
./tools/check-types.sh all
git add apps/web/src/pages/PurchaseOrdersPage/summaryStrip.ts apps/web/src/pages/PurchaseOrdersPage/summaryStrip.test.ts
git commit -m "feat(purchasing): summary-strip card config + filter-action mapping (B5)"
```

---

### Task 2: Summary `useQuery` + `overdueOnly` filter flag in `usePurchaseOrdersData`

**Files:**
- Modify: `apps/web/src/pages/PurchaseOrdersPage/hooks/usePurchaseOrdersData.ts` (add summary query + `overdueOnly` state + expose both; imports/state near the top, return block at the bottom)

> Line numbers in the steps below are for the PRE-B1 source. B1 also edits this hook (adds an `orderMutation` + its `POST /:id/order` mutation), so anchors will drift a few lines after B1 lands — match on the quoted code, not the raw number.

**Interfaces:**
- Consumes: `api.get('/purchase-orders/summary')` → bare `PurchasingSummary` (B0; defensively also tolerates a `{ data: PurchasingSummary }` envelope).
- Produces (added to the hook's return object):
  - `summary: PurchasingSummary | undefined`
  - `overdueOnly: boolean`
  - `setOverdueOnly: (v: boolean) => void`

- [ ] **Step 1: Import the `PurchasingSummary` type**

In `usePurchaseOrdersData.ts`, add to the imports (after line 6 `import { defaultChecklist } from '../constants';`):

```typescript
import { PurchasingSummary } from '../summaryStrip';
```

- [ ] **Step 2: Add the `overdueOnly` state**

In `usePurchaseOrdersData.ts`, next to the existing `statusFilter` state (line 10 `const [statusFilter, setStatusFilter] = useState('');`), add below it:

```typescript
  const [overdueOnly, setOverdueOnly] = useState(false);
```

- [ ] **Step 3: Add the summary query**

In `usePurchaseOrdersData.ts`, add this query right after the `suppliers` query block (after line 32 `const suppliers = suppliersRes?.data || [];`):

```typescript
  const { data: summaryRes } = useQuery<{ data?: PurchasingSummary } | PurchasingSummary>({
    queryKey: ['purchase-orders-summary'],
    queryFn: async () => (await api.get('/purchase-orders/summary')).data,
    // Stale-while-refresh so the strip stays snappy; counts are compute-on-read and cheap.
    staleTime: 30_000,
    retry: 1,
  });
  // Backend returns the bare object; tolerate a { data } envelope defensively.
  const summary: PurchasingSummary | undefined = summaryRes
    ? ('pendingApproval' in summaryRes ? summaryRes : (summaryRes as { data?: PurchasingSummary }).data)
    : undefined;
```

- [ ] **Step 4: Invalidate the summary after the mutations that change counts**

The summary counts shift when a PO is created / approved / rejected / cancelled / ordered / received / QC-confirmed / paid. Add `queryClient.invalidateQueries({ queryKey: ['purchase-orders-summary'] });` to the `onSuccess` of **every** mutation that already invalidates `['purchase-orders']`. Concretely, in `usePurchaseOrdersData.ts` add the line directly beneath each existing `queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });` inside these `onSuccess` blocks (line numbers are for the PRE-B1 source — match on the mutation name, not the number): `qcConfirmMutation` (~line 82), `createMutation` (~line 91), `approveMutation` (~line 102), `rejectPOMutation` (~line 112), `cancelMutation` (~line 121), `goodsReceivingMutation` (~line 153), `paymentMutation` (~line 166). **Also `orderMutation`** — B1 adds this mutation (`POST /:id/order`, APPROVED→ORDERED) to the same hook; it shifts `toOrder`↓ / `incoming`↑ so it MUST get the summary-invalidation line too. (Grep `queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })` and add the summary line under every hit — that catches `orderMutation` automatically regardless of B1's exact placement.)

Example — `approveMutation` becomes:

```typescript
  const approveMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/purchase-orders/${id}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders-summary'] });
      toast.success('อนุมัติ PO สำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
```

Apply the identical one-line addition to every other listed mutation (including B1's `orderMutation`).

- [ ] **Step 5: Reset `overdueOnly` whenever the user manually changes the status filter**

The overdue shortcut sets `statusFilter='ORDERED'` + `overdueOnly=true`. If the user then picks a different status from the dropdown, `overdueOnly` must clear so the list isn't silently double-filtered. Rather than wrap `setStatusFilter`, expose a small wrapper the page passes to `POListTab`. In `usePurchaseOrdersData.ts`, add this memo-free helper near the other action functions (e.g. just above `openDetailModal`, line 181):

```typescript
  const setStatusFilterAndResetOverdue = (value: string) => {
    setStatusFilter(value);
    setOverdueOnly(false);
  };
```

- [ ] **Step 6: Expose the new values from the hook**

In the returned object (lines 356-414), add to the **Queries** group (after `pos,` line):

```typescript
    summary,
```

and add to the **State** group (after the `statusFilter`/`setStatusFilter` lines, ~line 375):

```typescript
    overdueOnly,
    setOverdueOnly,
    setStatusFilterAndResetOverdue,
```

- [ ] **Step 7: Type-check**

Run: `./tools/check-types.sh all`
Expected: 0 errors. (`summary` is `PurchasingSummary | undefined`; `overdueOnly` is `boolean`.)

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/PurchaseOrdersPage/hooks/usePurchaseOrdersData.ts
git commit -m "feat(purchasing): summary query + overdueOnly filter state in usePurchaseOrdersData (B5)"
```

---

### Task 3: `PurchasingSummaryStrip` component (DashboardKPIs card pattern, filter shortcuts)

**Files:**
- Create: `apps/web/src/pages/PurchaseOrdersPage/components/PurchasingSummaryStrip.tsx`

**Interfaces:**
- Consumes: `summary: PurchasingSummary | undefined`, `onCardClick: (action: SummaryFilterAction) => void` (from Task 1 types).
- Produces: a responsive grid of up-to-7 cards mirroring `DashboardKPIs` anatomy. Renders `null` when `summary` is undefined (loading/error) so the page never crashes if B0's endpoint is missing.

- [ ] **Step 1: Implement the component**

Create `apps/web/src/pages/PurchaseOrdersPage/components/PurchasingSummaryStrip.tsx`. This mirrors the `DashboardKPIs` card exactly — `Card`/`CardContent`, `p-5 relative`, `absolute inset-y-0 left-0 w-1` left border (token bg), `pl-2` content, `size-10 rounded-xl` icon box, hover-lift (`hover:shadow-md hover:-translate-y-0.5 transition-all`), count pill — but as a clickable filter shortcut (`role="button"` via native `<button>` wrapping for a11y, like `DashboardAlerts`). Uses `AnimatedCounter` for the count to match the dashboard feel.

```tsx
import { Card, CardContent } from '@/components/ui/card';
import AnimatedCounter from '@/components/ui/animated-counter';
import { cn } from '@/lib/utils';
import { SUMMARY_CARDS, TONE_STYLES, type PurchasingSummary, type SummaryFilterAction } from '../summaryStrip';

interface PurchasingSummaryStripProps {
  summary: PurchasingSummary | undefined;
  onCardClick: (action: SummaryFilterAction) => void;
}

export function PurchasingSummaryStrip({ summary, onCardClick }: PurchasingSummaryStripProps) {
  // No data yet (loading) or the B0 endpoint is unavailable → render nothing rather than crash.
  if (!summary) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3 lg:gap-4 mb-5">
      {SUMMARY_CARDS.map((card) => {
        const Icon = card.icon;
        const styles = TONE_STYLES[card.tone];
        const count = summary[card.key] ?? 0;
        return (
          <button
            key={card.key}
            type="button"
            onClick={() => onCardClick(card.action)}
            aria-label={`${card.label}: ${count} รายการ — คลิกเพื่อกรอง`}
            className="text-left focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-xl"
          >
            <Card className="cursor-pointer group hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden h-full">
              <CardContent className="p-4 relative">
                <div className={cn('absolute inset-y-0 left-0 w-1 rounded-l-xl', styles.border)} />
                <div className="pl-2">
                  <div className="flex items-center justify-between mb-3">
                    <div
                      className={cn(
                        'size-10 rounded-xl flex items-center justify-center transition-colors',
                        styles.iconBox,
                      )}
                    >
                      <Icon className={cn('size-5', styles.icon)} />
                    </div>
                    {count > 0 && (
                      <span className={cn('text-2xs font-semibold px-2 py-0.5 rounded-full', styles.pill)}>
                        {count}
                      </span>
                    )}
                  </div>
                  <AnimatedCounter value={count} className="text-2xl font-bold text-foreground" />
                  <div className="text-xs font-medium text-muted-foreground mt-1 leading-snug">{card.label}</div>
                </div>
              </CardContent>
            </Card>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `./tools/check-types.sh all`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/PurchaseOrdersPage/components/PurchasingSummaryStrip.tsx
git commit -m "feat(purchasing): PurchasingSummaryStrip cards (DashboardKPIs pattern) (B5)"
```

---

### Task 4: Wire the strip into `PurchaseOrdersPage` + implement card-click filter shortcuts

**Files:**
- Modify: `apps/web/src/pages/PurchaseOrdersPage/index.tsx` (imports lines 1-18; render the strip after `PageHeader`, ~line 110; pass `setStatusFilterAndResetOverdue` to `POListTab`, line 142)

**Interfaces:**
- Consumes: `data.summary`, `data.setActiveTab`, `data.setStatusFilter`, `data.setOverdueOnly`, `data.setShowQcPanel`, `SummaryFilterAction`.
- Produces: an `onSummaryCardClick` handler that translates a `SummaryFilterAction` into page state.

- [ ] **Step 1: Import the strip + the action type**

In `index.tsx`, add after line 18 (`import { GoodsReceivingModal } from './components/GoodsReceivingModal';`):

```typescript
import { PurchasingSummaryStrip } from './components/PurchasingSummaryStrip';
import type { SummaryFilterAction } from './summaryStrip';
```

- [ ] **Step 2: Add the card-click handler**

In `index.tsx`, inside `PurchaseOrdersPage` after the `onSupplierSelect` callback (after line 58, before `return (`), add:

```typescript
  const onSummaryCardClick = useCallback(
    (action: SummaryFilterAction) => {
      if ('panel' in action) {
        // รอ QC → switch to list tab + open the QC panel and scroll it into view.
        data.setActiveTab('list');
        data.setShowQcPanel(true);
        requestAnimationFrame(() => {
          document.getElementById('po-qc-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        return;
      }
      if (action.tab === 'payable') {
        data.setActiveTab('payable');
        return;
      }
      // list filter shortcut
      data.setActiveTab('list');
      data.setStatusFilter(action.status);
      data.setOverdueOnly(action.overdueOnly);
    },
    [data],
  );
```

- [ ] **Step 3: Render the strip between `PageHeader` and `QcPendingPanel`**

In `index.tsx`, insert the strip immediately after the `</PageHeader>`-equivalent close (after line 110, before `<QcPendingPanel`):

```tsx
      <PurchasingSummaryStrip summary={data.summary} onCardClick={onSummaryCardClick} />

```

- [ ] **Step 4: Give the QC panel a scroll anchor**

The `waitingQc` card scrolls to `#po-qc-panel`. The `QcPendingPanel` root has no id. Wrap it (in `index.tsx`) so we add the anchor without editing the panel component:

Change (lines 112-119) from:

```tsx
      <QcPendingPanel
        qcPendingItems={data.qcPendingItems}
        showQcPanel={data.showQcPanel}
        setShowQcPanel={data.setShowQcPanel}
        qcNotes={data.qcNotes}
        setQcNotes={data.setQcNotes}
        qcConfirmMutation={data.qcConfirmMutation}
      />
```

to:

```tsx
      <div id="po-qc-panel">
        <QcPendingPanel
          qcPendingItems={data.qcPendingItems}
          showQcPanel={data.showQcPanel}
          setShowQcPanel={data.setShowQcPanel}
          qcNotes={data.qcNotes}
          setQcNotes={data.setQcNotes}
          qcConfirmMutation={data.qcConfirmMutation}
        />
      </div>
```

(`QcPendingPanel` returns `null` when there are no pending items, so the wrapper is an empty div in that case — harmless, and the `waitingQc` card count is 0 then anyway.)

- [ ] **Step 5: Pass the overdue-resetting setter + the new props to `POListTab`**

So a manual status-dropdown change clears `overdueOnly`. In `index.tsx`, in the `<POListTab … />` JSX block, change the `setStatusFilter` prop from:

```tsx
          setStatusFilter={data.setStatusFilter}
```

to:

```tsx
          setStatusFilter={data.setStatusFilterAndResetOverdue}
```

and add the two new props to the same `<POListTab>` block (e.g. after `suppliers={data.suppliers}`). NOTE: B1 already added an `orderMutation={data.orderMutation}` prop to this same block — keep it; just append:

```tsx
          overdueOnly={data.overdueOnly}
          setOverdueOnly={data.setOverdueOnly}
```

- [ ] **Step 6: Type-check**

Run: `./tools/check-types.sh all`
Expected: this will FAIL with `POListTab` prop errors (`overdueOnly`/`setOverdueOnly` not in `POListTabProps`) — that is expected and fixed in Task 5. If any OTHER error appears (e.g. a typo in the handler), fix it now.

- [ ] **Step 7: Commit (after Task 5 makes types green — do NOT commit a red build)**

This task's commit is deferred to the end of Task 5 (they form one type-consistent unit). Proceed to Task 5.

---

### Task 5: `overdueOnly` client filter + clear-chip in `POListTab` (reuses B1's `isOverdue`/badge/ORDERED)

> **B1 already did the heavy lifting** (see Global Constraints → "Dependency on B1"): the `ORDERED` status (constants + `poStatusMap` + the `<select>` option + the chip-label map), the tested `isOverdue(po, now?)` helper at `../po-list.util`, the `AlertTriangle` lucide import, and the per-row red "เลยกำหนด" badge in the status column ALL ship in B1. This task therefore does **NOT** re-create any helper, re-touch the status column, or re-add `AlertTriangle` — it only adds the brand-new `overdueOnly` client filter (the strip's "เลยกำหนดส่ง" shortcut) and its UI wiring. **Line anchors below are relative to the POST-B1 `POListTab.tsx`**, so prefer the quoted code context over raw line numbers.

**Files:**
- Modify: `apps/web/src/pages/PurchaseOrdersPage/components/POListTab.tsx` (props interface; `filteredPos` `useMemo`; `hasFilter`; the active-filter-chip row; `clearAll`)

**Interfaces:**
- Consumes: `overdueOnly: boolean`, `setOverdueOnly: (v: boolean) => void` (new props from the hook via `index.tsx`); `isOverdue` from `../po-list.util` (B1, already imported into `POListTab.tsx` by B1 Task 3 Step 1); `PurchaseOrder.expectedDate`/`.status` (`types.ts:37,39`).
- Produces: list rows filtered to overdue when `overdueOnly` is set; an active-filter chip to clear it; `overdueOnly` reflected in `hasFilter` + `clearAll`. (The per-row overdue badge already exists — B1 — and is NOT re-added here.)

- [ ] **Step 1: Confirm B1 has landed (the helper + badge + ORDERED must already exist)**

Before editing, verify B1's artifacts are present so this task is purely additive:

```bash
cd apps/web
grep -n "isOverdue" src/pages/PurchaseOrdersPage/po-list.util.ts          # B1 Task 2 helper
grep -n "isOverdue\|AlertTriangle\|เลยกำหนด" src/pages/PurchaseOrdersPage/components/POListTab.tsx   # B1 Task 3 import + badge
grep -n "ORDERED" src/pages/PurchaseOrdersPage/components/POListTab.tsx src/lib/status-badges.ts      # B1 Task 1+3 dropdown + map
```
Expected: all three match. If `po-list.util.ts` or the `ORDERED` `<select>` option is missing, **B1 has not shipped — stop and ship B1 first** (see Global Constraints). Do NOT re-create `isOverdue` here; reuse the B1 one.

- [ ] **Step 2: Add the two new props to `POListTabProps`**

In `POListTab.tsx`, add to the `POListTabProps` interface (after the `suppliers: { id: string; name: string }[];` line):

```typescript
  overdueOnly: boolean;
  setOverdueOnly: (value: boolean) => void;
```

and destructure them in the component signature (after `suppliers,`):

```typescript
  overdueOnly,
  setOverdueOnly,
```

- [ ] **Step 3: Apply the overdue filter in the `filteredPos` `useMemo`**

In `POListTab.tsx`, in the `filteredPos` memo, add the overdue guard as the first check in the `.filter` callback and add `overdueOnly` to the dependency array. Reuse B1's `isOverdue` (already imported from `../po-list.util` by B1). The memo's first line that derives the search term may read `const q = debouncedSearch.trim().toLowerCase();` (B1 added `useDebounce`) — keep whatever B1 left; only the highlighted lines change:

```typescript
    return pos.filter((po) => {
      if (overdueOnly && !isOverdue(po)) return false;   // NEW — strip "เลยกำหนดส่ง" shortcut
      if (supplierFilter && po.supplier.id !== supplierFilter) return false;
      // … existing range / search checks unchanged …
      return true;
    });
  }, [pos, /* search-or-debouncedSearch (keep B1's) */, supplierFilter, periodFilter, overdueOnly]);
```

Add `overdueOnly` to the dependency array (append it to whatever B1 left, e.g. `[pos, debouncedSearch, supplierFilter, periodFilter, overdueOnly]`).

- [ ] **Step 4: Reflect the overdue filter in `hasFilter` + add a clear chip**

In `POListTab.tsx`, update `hasFilter` to include `overdueOnly`:

```typescript
  const hasFilter = Boolean(search || statusFilter || supplierFilter || periodFilter || overdueOnly);
```

and add an "เลยกำหนดส่ง" chip inside the active-filter chip row (place it after the `periodFilter` chip block, before the "ล้างทั้งหมด" button):

```tsx
          {overdueOnly && (
            <FilterChip label="เฉพาะที่เลยกำหนดส่ง" onRemove={() => setOverdueOnly(false)} />
          )}
```

- [ ] **Step 5: Make "ล้างทั้งหมด" also clear overdue**

In `POListTab.tsx`, update `clearAll` to reset `overdueOnly`:

```typescript
  const clearAll = () => {
    setSearch('');
    setStatusFilter('');
    setSupplierFilter('');
    setPeriodFilter('');
    setOverdueOnly(false);
  };
```

> No status-column change and no `AlertTriangle` import here — B1 owns the per-row "เลยกำหนด" badge (B1 Task 3 Step 4) which renders automatically for every overdue row, including inside the `overdueOnly`-filtered view.

- [ ] **Step 6: Type-check (now Task 4 + Task 5 are type-consistent)**

Run: `./tools/check-types.sh all`
Expected: 0 errors.

- [ ] **Step 7: Run the PO web test suite (no regressions)**

Run: `cd apps/web && npx vitest run src/pages/PurchaseOrdersPage`
Expected: PASS — runs B5's `summaryStrip.test.ts` plus B1's `po-list.util.test.ts` (B1 shipped first); confirms the new module is green and B1's helper tests still pass.

- [ ] **Step 8: Commit Task 4 + Task 5 together**

```bash
git add apps/web/src/pages/PurchaseOrdersPage/index.tsx apps/web/src/pages/PurchaseOrdersPage/components/POListTab.tsx
git commit -m "feat(purchasing): wire summary strip + overdueOnly filter into PO list (B5)"
```

- [ ] **Step 9: Manual verification — strip + shortcuts + overdue (desktop AND mobile)**

Start the app: `cd apps/web && npm run dev` (API must be running with B0 merged so `/purchase-orders/summary` exists). Log in as `admin@bestchoice.com / admin1234`, go to `/purchase-orders`.

Desktop (≥1280px wide):
- The strip shows up to **7 cards** in a single row (`xl:grid-cols-7`), each with a colored left border, a `size-10` icon box, the count, a count pill (when >0), and the Thai label. Hovering lifts the card (`-translate-y-0.5` + shadow). Confirm NO `bg-white`/gray — borders/icons use primary/warning/destructive/info tokens.
- Click **รออนุมัติ** → list tab active, status dropdown shows "รออนุมัติ", only DRAFT rows; an active-filter chip appears. Click **รอสั่งซื้อ** → APPROVED rows. Click **กำลังมา** → ORDERED rows. Click **รับบางส่วน** → PARTIALLY_RECEIVED rows.
- Click **เลยกำหนดส่ง** → list shows only ORDERED rows whose `expectedDate` is in the past; each such row shows a red "⚠ เลยกำหนด" badge next to its status; the "เฉพาะที่เลยกำหนดส่ง" chip appears. Now change the status dropdown to a different value → the overdue chip disappears (overdueOnly cleared). Click "ล้างทั้งหมด" → all filters cleared including overdue.
- Click **ค้างจ่าย** → switches to the "ยอดค้างชำระ" tab.
- Click **รอตรวจ QC** → list tab, the QC panel expands and scrolls into view (only if there are QC-pending items; otherwise count is 0 and there is nothing to show).

Mobile (DevTools responsive, 390px wide):
- The strip wraps to **2 columns** (`grid-cols-2`) — cards stack neatly, labels use `leading-snug` (no clipped Thai tone marks), touch targets are the full card. Tap each card → same filter behavior; the list/tab updates and the page scrolls so the user sees the result.

Record what you saw (counts shown, filters applied) in the PR description.

---

### Task 6: Polish `AccountsPayableTab` — clearer remaining/paid, due-date urgency, deep-link affordance

**Files:**
- Modify: `apps/web/src/pages/PurchaseOrdersPage/components/AccountsPayableTab.tsx` (supplier header lines 47-50; per-PO row rendering lines 67-92; empty/loading states)

**Interfaces:**
- Consumes: existing `payableData` prop shape (unchanged), `onOpenDetail` (unchanged). No backend change.
- Produces: a clearer per-supplier header (paid-vs-remaining progress), a more legible PO row (explicit "คงค้าง" emphasis + due-soon hint), and a hover/cursor affordance on the whole row that opens PO detail.

- [ ] **Step 1: Add a paid-progress bar to each supplier header**

In `AccountsPayableTab.tsx`, the supplier header (lines 47-50) shows remaining + "จาก X (จ่ายแล้ว Y)". Add a slim progress bar under it so the user sees paid-vs-total at a glance. Replace the `<div className="text-right">…</div>` block (lines 47-50) with:

```tsx
            <div className="text-right min-w-[180px]">
              <div className="text-lg font-bold text-destructive tabular-nums font-mono">{(Number(entry.totalRemaining) || 0).toLocaleString()} บาท</div>
              <div className="text-xs text-muted-foreground tabular-nums">
                จ่ายแล้ว {(Number(entry.totalPaid) || 0).toLocaleString()} / {(Number(entry.totalNet) || 0).toLocaleString()}
              </div>
              {Number(entry.totalNet) > 0 && (
                <div className="mt-1.5 w-full bg-secondary rounded-full h-1.5">
                  <div
                    className="bg-success h-1.5 rounded-full"
                    style={{ width: `${Math.min((Number(entry.totalPaid) / Number(entry.totalNet)) * 100, 100)}%` }}
                  />
                </div>
              )}
            </div>
```

(The progress-bar markup mirrors `POListTab`'s received-progress bar — `bg-secondary` track + `bg-success` fill, both tokens — so styling stays consistent.)

- [ ] **Step 2: Make the whole PO row open detail + add a due-soon hint**

Today only the PO# is a link. Make the entire row clickable (cursor + hover) while keeping the PO# button as the primary affordance. In `AccountsPayableTab.tsx`, change the `<tr>` opening (line 68) to carry the click + cursor:

```tsx
                <tr
                  key={po.id}
                  className="hover:bg-muted/30 cursor-pointer"
                  onClick={async () => { try { const { data } = await api.get(`/purchase-orders/${po.id}`); onOpenDetail(data, data); } catch {} }}
                >
```

Then the PO# cell button must stop propagation so it doesn't double-fire. Change the PO# button (lines 70-72) to:

```tsx
                  <td className="px-4 py-2">
                    <button
                      onClick={async (e) => { e.stopPropagation(); try { const { data } = await api.get(`/purchase-orders/${po.id}`); onOpenDetail(data, data); } catch {} }}
                      className="text-primary hover:underline font-medium"
                    >
                      {po.poNumber}
                    </button>
                  </td>
```

The existing due-date cell already renders a red "เลยกำหนด" pill when `po.dueDate < now` (lines 75-84) — that stays. Add a "ใกล้ครบกำหนด" amber hint for due-within-7-days (not yet overdue). Replace the inner `{po.dueDate ? (…) : (…)}` content (lines 76-83) with:

```tsx
                    {po.dueDate ? (() => {
                      const due = new Date(po.dueDate);
                      const now = new Date();
                      const isLate = due < now;
                      const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
                      const dueSoon = !isLate && due <= inSevenDays;
                      return (
                        <span className={`text-sm ${isLate ? 'text-destructive font-semibold' : dueSoon ? 'text-warning font-medium' : 'text-muted-foreground'}`}>
                          {formatDateShort(po.dueDate)}
                          {isLate && <span className="ml-1 text-2xs bg-destructive/10 text-destructive dark:bg-destructive/15 px-1.5 py-0.5 rounded-full leading-snug">เลยกำหนด</span>}
                          {dueSoon && <span className="ml-1 text-2xs bg-warning/10 text-warning dark:bg-warning/15 px-1.5 py-0.5 rounded-full leading-snug">ใกล้ครบกำหนด</span>}
                        </span>
                      );
                    })() : (
                      <span className="text-muted-foreground text-xs">-</span>
                    )}
```

- [ ] **Step 3: Emphasize the "คงค้าง" column header + a tiny "ดูรายละเอียด" cue**

The "คงค้าง" amount is the action-driving number. Make its header carry the destructive tint so the eye lands there. In `AccountsPayableTab.tsx`, change the "คงค้าง" header cell (line 62) from:

```tsx
                <th className="px-4 py-2.5 text-right font-semibold">คงค้าง</th>
```

to:

```tsx
                <th className="px-4 py-2.5 text-right font-semibold text-destructive">คงค้าง</th>
```

- [ ] **Step 4: Handle the not-yet-loaded state**

Currently the empty state only shows when `payableData && payableData.suppliers.length === 0` (line 99). When `payableData` is still `undefined` (query loading, since it's `enabled: activeTab === 'payable'`), nothing renders — looks blank. Add a loading hint. After the grand-total block (after line 34 `</div>` that closes the grand-total card) — actually before the per-supplier map — add an early loading guard. Insert directly after the grand-total `</div>` (line 34) and before the `{payableData?.suppliers.map(…)}` (line 37):

```tsx
      {!payableData && (
        <div className="text-center py-12 text-muted-foreground">กำลังโหลดยอดค้างจ่าย…</div>
      )}
```

- [ ] **Step 5: Type-check**

Run: `./tools/check-types.sh all`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/PurchaseOrdersPage/components/AccountsPayableTab.tsx
git commit -m "feat(purchasing): AP tab polish — paid progress, due-soon hint, row deep-link (B5)"
```

- [ ] **Step 7: Manual verification — AP tab (desktop AND mobile)**

With the app running (Task 5 Step 9), go to `/purchase-orders` → tab "ยอดค้างชำระ ( ผู้จัดจำหน่าย )" (or click the **ค้างจ่าย** summary card).

Desktop:
- While the query loads you briefly see "กำลังโหลดยอดค้างจ่าย…" (not a blank screen).
- Each supplier header shows "จ่ายแล้ว X / Y" with a green progress bar reflecting paid ratio; the bold red number is the remaining.
- The "คงค้าง" column header is red-tinted; per-row remaining is bold red, paid is green.
- A PO with `dueDate` in the past shows the red "เลยกำหนด" pill; a PO due within 7 days shows the amber "ใกล้ครบกำหนด" pill; far-future due dates are plain.
- Hovering any PO row highlights it with a pointer cursor; clicking anywhere on the row opens the PO detail modal (clicking the PO# link also opens it, exactly once — no double-open).
- When everything is paid: "ไม่มียอดค้างจ่าย - จ่ายครบทุก PO แล้ว".

Mobile (390px): the supplier cards stack; the PO table scrolls horizontally if needed; tapping a row opens detail. Thai pills use `leading-snug` (no clipped tone marks).

---

## Self-Review

**Spec coverage (B5 items, from spec §"Batches" B5 + §"Information architecture" summary-strip row):**
- *Summary strip on `/purchase-orders` using the `DashboardKPIs` card pattern, wired to `GET /purchase-orders/summary`* → Task 1 (config), Task 2 (query), Task 3 (component mirrors `DashboardKPIs` anatomy exactly: left border, `size-10` icon box, count pill, hover-lift, `AnimatedCounter`), Task 4 (wire into page). ✅
- *Each card = a filter shortcut (click → filter the list/tab)* → Task 1 (`SummaryFilterAction` mapping, unit-tested), Task 4 (`onSummaryCardClick` translates action → `setActiveTab`/`setStatusFilter`/`setOverdueOnly`/`setShowQcPanel`). ✅
- *Counts: รออนุมัติ · รอสั่ง · กำลังมา (⚠️ เลยกำหนด) · รอรับ · รอ QC · ค้างจ่าย* → all 7 B0 keys mapped to cards in Task 1 (`pendingApproval/toOrder/incoming/overdue/receiving/waitingQc/unpaid`); overdue split into its own loud red card per spec emphasis. ✅
- *Overdue badge/count (compute-on-read) surfaced on strip + list* → strip: the `overdue` card (Task 1/3); list: the red "เลยกำหนด" per-row badge + the `isOverdue` helper ALREADY SHIP IN B1 (B1 Task 2/3) — B5 reuses them and adds ONLY the `overdueOnly` filter + clear chip (Task 5). Overdue derived client-side as `status==='ORDERED' && expectedDate < now`, matching B0's `getSummary` overdue query (B0 plan Task 5 Step 3) and B1's `isOverdue` exactly. ✅
- *AP tab polish (clearer remaining/paid, links into PO detail)* → Task 6: per-supplier paid-progress bar, "จ่ายแล้ว X / Y", red "คงค้าง" header, due-soon amber hint, whole-row deep-link into PO detail, loading state. ✅
- *Reuse Card/CardContent from card.tsx; mirror DashboardKPIs; design tokens only* → Task 3 imports `Card`/`CardContent` from `@/components/ui/card` and `AnimatedCounter` (same as `DashboardKPIs`); `TONE_STYLES` is token-only and the unit test (Task 1) asserts no hex/gray/white. ✅

**Placeholder scan:** none. Every step shows the exact code/JSX to add or the exact before→after replacement, with real file paths. Tasks 1–3, 4, and 6 use line anchors verified against the CURRENT (pre-batch) source; Task 5 deliberately uses code-context anchors (not raw line numbers) because B1 ships before B5 and shifts `POListTab.tsx` — the quoted symbols (`filteredPos`, `hasFilter`, `clearAll`, the chip row) are stable. No "TBD"/"TODO"/"similar to Task N"/"add error handling".

**Type/prop-name consistency across tasks:**
- `PurchasingSummary` (keys `pendingApproval/toOrder/incoming/overdue/receiving/waitingQc/unpaid`) — defined in Task 1, imported by Task 2 (hook) and Task 3 (component); identical to B0's `getSummary()` return.
- `SummaryFilterAction` — defined Task 1, consumed by Task 3 (`onCardClick` prop) and Task 4 (`onSummaryCardClick`).
- `summary` / `overdueOnly` / `setOverdueOnly` / `setStatusFilterAndResetOverdue` — produced by the hook (Task 2), consumed in `index.tsx` (Task 4) and forwarded to `POListTab` (Task 4 → Task 5 adds `overdueOnly`/`setOverdueOnly` to `POListTabProps`). `index.tsx` passes `data.setStatusFilterAndResetOverdue` as `POListTab`'s `setStatusFilter` (same `(value: string) => void` signature as the existing prop — type-compatible).
- `isOverdue` — NOT redefined by B5. It is the single tested helper from B1 (`apps/web/src/pages/PurchaseOrdersPage/po-list.util.ts`); Task 5 imports it (already in scope via B1's import in `POListTab.tsx`) and uses it for the `overdueOnly` filter. The per-row badge that also uses it is B1's. No duplicate helper.
- `PurchaseOrder.expectedDate` / `.status` — already on the type (`types.ts:37,39`); no type change needed.

**Deviations / notes found vs spec wording:**
1. **Strip has 7 cards, not the spec's 6-label list.** The spec's IA row lists "กำลังมา (⚠️ เลยกำหนด)" as one cell, but the B0 endpoint returns `incoming` and `overdue` as **separate** counts and the B5 task text says "Surface the OVERDUE count/badge on the strip." I split them into two cards (กำลังมา = info, เลยกำหนดส่ง = destructive) so overdue is loud and independently clickable. This consumes all 7 B0 keys — no key is dropped. Documented, intentional.
2. **`waitingQc` shortcut targets the existing collapsible `QcPendingPanel`, not a dedicated QC page.** B4 promotes QC to its own page/route; B5 may ship before/independently of B4. To avoid coupling B5 to B4, the `waitingQc` card expands the existing panel (`setShowQcPanel(true)` + scroll to `#po-qc-panel`). If B4 has already landed and added a QC route, a one-line change to `SUMMARY_CARDS` (`{ panel: 'qc' }` → a `navigate` action) is all that's needed — but that is B4's concern, not B5's. Documented.
3. **`info` tone depends on a `bg-info`/`text-info` Tailwind utility.** The `info` Badge variant exists project-wide, but Task 1 Step 5 explicitly verifies the raw `bg-info`/`text-info` utilities exist before relying on them, with a concrete fallback (use `primary` tone) — not a guess.
4. **No new RTL render test for the strip component itself.** Per the testing-reality rule, the genuinely logic-bearing part (card definitions, key parity with the type, filter-action mapping, token-only styles) is unit-tested in `summaryStrip.test.ts`; the presentational `PurchasingSummaryStrip` + page wiring + AP polish are verified via concrete manual desktop+mobile steps (Task 5 Step 9, Task 6 Step 7). A render test that only re-asserts the same config would be a trivial duplicate — deliberately omitted.
5. **Backend untouched.** B5 adds zero API code; it consumes B0's `GET /purchase-orders/summary`. The red line (no accounting/finance import, JE-free receiving) is trivially satisfied since no `apps/api` file is modified.
6. **Depends on B1, not just B0 (anti-duplication).** B5's `incoming`/`overdue`/`receiving` filter shortcuts and the per-row overdue badge rely on B1 (`ORDERED` in `constants.ts`/`poStatusMap`/the status `<select>`/the chip-label map; the tested `isOverdue` helper; the per-row "เลยกำหนด" badge). B1 ships before B5 in the one-deploy-per-batch order, so B5 REUSES those rather than re-implementing them — Task 5 was tightened to add only the new `overdueOnly` client filter + its clear-chip. This avoids a duplicate `isOverdue`, a duplicate status-column badge, and a conflicting `AlertTriangle` import. Task 5 Step 1 is a guard that aborts if B1 hasn't landed. Documented, intentional.
