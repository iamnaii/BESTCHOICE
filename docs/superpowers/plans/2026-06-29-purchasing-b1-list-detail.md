# Purchasing v2 — Batch 1: PO List + Detail Redesign + Printable Goods Receipt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the PO list scannable and the PO detail informative on top of the (already-shipped) B0 backend — add an `ORDERED` status everywhere it shows, a partial-receive **progress bar**, a payment **chip**, a computed **overdue badge**, debounced PO#/supplier **search**, clearer **empty states**; wire a **"สั่งซื้อ"** action to `POST /purchase-orders/:id/order`; rebuild the PO detail with a **status timeline**, per-item received/QC progress, and a **GR history** list (grNumber + receiver + time); and add a **printable ใบรับของ (Goods Receipt)** per receiving record reusing the existing `PaymentVoucherPage` print pattern.

**Architecture:** Pure frontend batch over `apps/web/src/pages/PurchaseOrdersPage/**` plus one new lazy-loaded print page + route in `App.tsx`. All data comes from already-existing endpoints (`GET /purchase-orders`, `GET /purchase-orders/:id`, `GET /purchase-orders/:id/goods-receivings/:receivingId`) and the B0 endpoint `POST /purchase-orders/:id/order`. No backend changes, no schema changes — B0 already added `ORDERED`, `orderedAt`, `grNumber`, `DefectReason`.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind + shadcn/ui + Radix + lucide-react (`apps/web`); `@tanstack/react-query` + `@/lib/api`; vitest + React Testing Library for logic-bearing units; Playwright for e2e (not added in this batch — manual mobile pass instead).

**Spec:** `docs/superpowers/specs/2026-06-29-purchasing-receiving-ux-v2-design.md`

## Global Constraints

- **⛔ BLOCKING PREREQUISITE — B0 must be merged + deployed first.** This batch assumes the B0 backend foundation (`docs/superpowers/plans/2026-06-29-purchasing-b0-backend-foundation.md`) is already in `main`. **Verified 2026-06-29: B0 is NOT yet implemented in this repo** — `schema.prisma` has no `ORDERED` enum value / `orderedAt` / `grNumber` / `DefectReason` / `isDirectReceive`; the controller has no `POST /purchase-orders/:id/order` (the legacy `POST /:id/receive` still exists, i.e. the B0 "retire legacy receive" step also hasn't run). **Do NOT start B1 until B0 is shipped.** Before Task 1, confirm all of these resolve non-empty: `grep -n "ORDERED\|orderedAt\|grNumber" apps/api/prisma/schema.prisma` and `grep -n "':id/order'\|/order" apps/api/src/modules/purchase-orders/purchase-orders.controller.ts`. (Heads-up for the B0 executor, not B1: B0's plan says "next migration ≥ `20260977000000`", but `20260977000000_add_payment_drafts` already exists — B0 must bump to `20260978000000+`. This does not affect B1.)
- **RED LINE — no accounting/finance:** introduce **NO** import of any accounting/finance/journal/expense/tax module into purchase-orders; do **not** touch `trade-in` or `Product.ownedByCompanyId`; receiving stays **JE-free**. This batch is frontend-only and reads existing PO endpoints — it cannot post a JE; keep it that way (no new API calls to expense/journal/accounting routes).
- **Additive only:** extend the existing PO page components and types; do not delete the existing `PODetailModal` data flow contract (`selectedPO`/`poDetail` props from `usePurchaseOrdersData`). The new print page is additive.
- **Frontend rules (`.claude/rules/frontend.md`):**
  - Data fetching via `@tanstack/react-query` **only**; API calls via `api.get/api.post` from `@/lib/api` **only** — no raw `fetch`/`axios`.
  - UI: **shadcn/ui + Radix + lucide-react** only. Reuse `Badge` (`@/components/ui/badge`), `Card`/`CardContent` (`@/components/ui/card`), `Button` (`@/components/ui/button`), `DataTable` (`@/components/ui/DataTable`).
  - **DESIGN TOKENS ONLY** — no hardcoded gray/hex, no `text-gray-*`/`bg-gray-*`, **no `bg-white` except print/receipt context**. Use `bg-background`/`bg-card`/`bg-muted`, `text-foreground`/`text-muted-foreground`, `border-border`, `bg-success`/`bg-warning`/`bg-destructive`/`bg-primary` + token tints (`bg-success/10`, etc.). The print page (`GoodsReceiptPrintPage`) MAY use `bg-white` (it mirrors `PaymentVoucherPage`).
  - **Thai UI text uses `leading-snug`** (never `leading-none`).
  - Routes are **lazy-loaded** via `React.lazy()` in `App.tsx`.
  - Notifications via **`sonner`** `toast.success/error` only — never `alert()`/`confirm()`.
  - Search inputs use **`useDebounce`** (`@/hooks/useDebounce`).
- **Money = Decimal:** money fields arrive as decimal strings; render with `Number(x).toLocaleString()` or `formatNumber`/`formatNumberDecimal` from `@/utils/formatters` (existing pattern in these files). Never do float math that could drift a satang in display — progress fractions are unit counts (ints), which is fine.
- **Type gate:** `./tools/check-types.sh all` must report **0 errors** before each commit.
- **Tests:** vitest where it adds genuine value (pure compute helpers: overdue/progress/timeline). For visual components, end with concrete MANUAL verification (desktop + mobile viewport). No fake/trivial tests.

---

### Task 1: Add `ORDERED` to constants + status-badge map + the "สั่งซื้อ" mutation

**Files:**
- Modify: `apps/web/src/pages/PurchaseOrdersPage/constants.ts` (lines 3-19: `statusLabels` + `statusColors`)
- Modify: `apps/web/src/lib/status-badges.ts` (`poStatusMap`, lines 149-156)
- Modify: `apps/web/src/pages/PurchaseOrdersPage/hooks/usePurchaseOrdersData.ts` (add `orderMutation` after `approveMutation` ~line 99-106; export it in the return object ~line 366)

**Interfaces:**
- Consumes: `POST /purchase-orders/:id/order` (B0 endpoint — `APPROVED → ORDERED`, optional body `{ expectedDate?: string }`; returns the updated PO).
- Produces: `statusLabels.ORDERED = 'สั่งซื้อแล้ว'`, `statusColors.ORDERED`, `poStatusMap.ORDERED`, and `orderMutation: UseMutationResult<unknown, unknown, string, unknown>` (mutate(poId)).

- [ ] **Step 1: Add the `ORDERED` label + color to `constants.ts`**

In `apps/web/src/pages/PurchaseOrdersPage/constants.ts`, add `ORDERED` to both maps (place after `APPROVED`). Note: `statusLabels` is the one that matters — it's read by the Excel export (`index.tsx:85`); `statusColors` is currently **dead code** (defined but imported nowhere — the actual badge colours come from `poStatusMap` in Step 2), so its `ORDERED` entry is added only for consistency and has no visual effect.

```typescript
export const statusLabels: Record<string, string> = {
  PENDING: 'รอดำเนินการ',
  DRAFT: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  ORDERED: 'สั่งซื้อแล้ว',
  PARTIALLY_RECEIVED: 'รับบางส่วน',
  FULLY_RECEIVED: 'รับครบแล้ว',
  CANCELLED: 'ยกเลิก',
};

export const statusColors: Record<string, string> = {
  PENDING: 'bg-muted text-foreground',
  DRAFT: 'bg-warning/10 text-warning dark:bg-warning/15',
  APPROVED: 'bg-primary-100 text-primary-700',
  ORDERED: 'bg-info/10 text-info dark:bg-info/15',
  PARTIALLY_RECEIVED: 'bg-warning/10 text-warning dark:bg-warning/15',
  FULLY_RECEIVED: 'bg-success/10 text-success dark:bg-success/15',
  CANCELLED: 'bg-destructive/10 text-destructive dark:bg-destructive/15',
};
```

- [ ] **Step 2: Add `ORDERED` to the central `poStatusMap`**

In `apps/web/src/lib/status-badges.ts`, add an `ORDERED` entry to `poStatusMap` (after `APPROVED`, line 152). Use the `info` variant so it visually reads as "in flight" distinct from `primary` (APPROVED) and `warning` (partial):

```typescript
export const poStatusMap: Record<string, StatusConfig> = {
  PENDING: { variant: 'secondary', label: 'รอดำเนินการ' },
  DRAFT: { variant: 'warning', appearance: 'light', label: 'รออนุมัติ' },
  APPROVED: { variant: 'primary', appearance: 'light', label: 'อนุมัติแล้ว' },
  ORDERED: { variant: 'info', appearance: 'light', label: 'สั่งซื้อแล้ว' },
  PARTIALLY_RECEIVED: { variant: 'warning', appearance: 'light', label: 'รับบางส่วน' },
  FULLY_RECEIVED: { variant: 'success', appearance: 'light', label: 'รับครบแล้ว' },
  CANCELLED: { variant: 'destructive', appearance: 'light', label: 'ยกเลิก' },
};
```

(`info` is a valid `badgeVariants` variant — verified in `apps/web/src/components/ui/badge.tsx` compound-variant list at lines 75-76, `variant: 'info', appearance: 'light'`.)

- [ ] **Step 3: Add `orderMutation` to `usePurchaseOrdersData`**

In `apps/web/src/pages/PurchaseOrdersPage/hooks/usePurchaseOrdersData.ts`, add a new mutation immediately after `approveMutation` (which ends at line 106). It mirrors `approveMutation` exactly but hits the B0 order endpoint:

```typescript
  const orderMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/purchase-orders/${id}/order`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('สั่งซื้อ PO สำเร็จ (สถานะ: สั่งซื้อแล้ว)');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
```

- [ ] **Step 4: Export `orderMutation` from the hook**

In the same file, add `orderMutation,` to the returned `// Mutations` block (next to `approveMutation,` at line 367):

```typescript
    // Mutations
    qcConfirmMutation,
    createMutation,
    approveMutation,
    orderMutation,
    rejectPOMutation,
    cancelMutation,
    goodsReceivingMutation,
    paymentMutation,
```

- [ ] **Step 5: Type-check**

Run: `./tools/check-types.sh all`
Expected: 0 errors. (`api`, `useMutation`, `getErrorMessage`, `queryClient`, `toast` are all already imported in this file — lines 2-4.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/PurchaseOrdersPage/constants.ts apps/web/src/lib/status-badges.ts apps/web/src/pages/PurchaseOrdersPage/hooks/usePurchaseOrdersData.ts
git commit -m "feat(purchasing-web): ORDERED label/badge + สั่งซื้อ mutation (POST :id/order)"
```

---

### Task 2: List compute helpers (progress + overdue) with vitest coverage

**Files:**
- Create: `apps/web/src/pages/PurchaseOrdersPage/po-list.util.ts`
- Create: `apps/web/src/pages/PurchaseOrdersPage/po-list.util.test.ts`

**Interfaces:**
- Produces:
  - `receiveProgress(po: { items: { quantity: number; receivedQty: number }[] }): { received: number; ordered: number; pct: number }` — `pct` is 0-100, `0` when `ordered === 0`.
  - `isOverdue(po: { status: string; expectedDate: string | null }, now?: Date): boolean` — `true` **only** when `status === 'ORDERED' && expectedDate != null && new Date(expectedDate) < now`. (Matches spec decision 4: overdue = `status = ORDERED AND expectedDate < now`.)

These are pure, reused by `POListTab` (Task 3) and the timeline (Task 4), and are exactly the kind of logic worth a real test (the spec calls out the overdue rule precisely).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pages/PurchaseOrdersPage/po-list.util.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { receiveProgress, isOverdue } from './po-list.util';

describe('receiveProgress', () => {
  it('sums received/ordered across items and computes pct', () => {
    const po = { items: [{ quantity: 7, receivedQty: 3 }, { quantity: 3, receivedQty: 0 }] };
    expect(receiveProgress(po)).toEqual({ received: 3, ordered: 10, pct: 30 });
  });

  it('caps pct at 100 when over-received (defensive)', () => {
    const po = { items: [{ quantity: 2, receivedQty: 5 }] };
    expect(receiveProgress(po).pct).toBe(100);
  });

  it('returns pct 0 (not NaN) for an empty PO', () => {
    expect(receiveProgress({ items: [] })).toEqual({ received: 0, ordered: 0, pct: 0 });
  });
});

describe('isOverdue', () => {
  const now = new Date('2026-06-29T00:00:00Z');

  it('is true for an ORDERED PO past its expectedDate', () => {
    expect(isOverdue({ status: 'ORDERED', expectedDate: '2026-06-20' }, now)).toBe(true);
  });

  it('is false for an ORDERED PO not yet due', () => {
    expect(isOverdue({ status: 'ORDERED', expectedDate: '2026-07-10' }, now)).toBe(false);
  });

  it('is false when not ORDERED even if past due (e.g. APPROVED / PARTIALLY_RECEIVED)', () => {
    expect(isOverdue({ status: 'APPROVED', expectedDate: '2026-06-20' }, now)).toBe(false);
    expect(isOverdue({ status: 'PARTIALLY_RECEIVED', expectedDate: '2026-06-20' }, now)).toBe(false);
  });

  it('is false when expectedDate is null', () => {
    expect(isOverdue({ status: 'ORDERED', expectedDate: null }, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/PurchaseOrdersPage/po-list.util.test.ts`
Expected: FAIL — module `./po-list.util` not found.

- [ ] **Step 3: Implement the helpers**

Create `apps/web/src/pages/PurchaseOrdersPage/po-list.util.ts`:

```typescript
/**
 * Pure compute helpers for the PO list/detail. Kept out of the components so
 * the overdue rule (spec decision 4: status=ORDERED AND expectedDate < now)
 * and the partial-receive progress math are unit-tested in one place.
 */

export function receiveProgress(po: {
  items: { quantity: number; receivedQty: number }[];
}): { received: number; ordered: number; pct: number } {
  const ordered = po.items.reduce((s, i) => s + i.quantity, 0);
  const received = po.items.reduce((s, i) => s + i.receivedQty, 0);
  const pct = ordered > 0 ? Math.min(Math.round((received / ordered) * 100), 100) : 0;
  return { received, ordered, pct };
}

export function isOverdue(
  po: { status: string; expectedDate: string | null },
  now: Date = new Date(),
): boolean {
  if (po.status !== 'ORDERED' || !po.expectedDate) return false;
  return new Date(po.expectedDate) < now;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/pages/PurchaseOrdersPage/po-list.util.test.ts`
Expected: PASS (7 assertions across 2 describes).

- [ ] **Step 5: Type-check + commit**

```bash
./tools/check-types.sh all
git add apps/web/src/pages/PurchaseOrdersPage/po-list.util.ts apps/web/src/pages/PurchaseOrdersPage/po-list.util.test.ts
git commit -m "feat(purchasing-web): receiveProgress + isOverdue list helpers (tested)"
```

---

### Task 3: `POListTab` redesign — status pills (incl. ORDERED), progress bar, payment chip, overdue badge, search, สั่งซื้อ action, empty states

**Files:**
- Modify: `apps/web/src/pages/PurchaseOrdersPage/components/POListTab.tsx` (imports lines 1-18; props interface lines 22-35; status `<select>` lines 329-340; filter-chip status map lines 371-384; `received` column lines 222-244; `status` column lines 187-199; `actions` column lines 245-313; search input lines 322-328; `DataTable` empty props lines 405-408)
- Modify: `apps/web/src/pages/PurchaseOrdersPage/index.tsx` (pass `orderMutation` into `<POListTab>` — props block lines 141-154)

**Interfaces:**
- Consumes: `data.orderMutation` (Task 1); `receiveProgress`, `isOverdue` (Task 2); `useDebounce` (`@/hooks/useDebounce`).
- Produces: redesigned list with new `POListTabProps.orderMutation`.

- [ ] **Step 1: Add `orderMutation` to `POListTabProps` + import the helpers + `useDebounce` + icons**

In `POListTab.tsx`, update the imports. The current first lines are:

```typescript
import { useMemo, useState } from 'react';
import { UseMutationResult } from '@tanstack/react-query';
import DataTable, { Column } from '@/components/ui/DataTable';
import { formatDateShort } from '@/utils/formatters';
import { PurchaseOrder } from '../types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { getStatusBadgeProps, poStatusMap, poPaymentStatusMap } from '@/lib/status-badges';
import { PackageCheck, Check, X, Ban, FileText, Search } from 'lucide-react';
```

Change to (add `useDebounce`, the two helpers, and the `ShoppingCart` + `AlertTriangle` icons):

```typescript
import { useMemo, useState } from 'react';
import { UseMutationResult } from '@tanstack/react-query';
import DataTable, { Column } from '@/components/ui/DataTable';
import { formatDateShort } from '@/utils/formatters';
import { useDebounce } from '@/hooks/useDebounce';
import { PurchaseOrder } from '../types';
import { receiveProgress, isOverdue } from '../po-list.util';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { getStatusBadgeProps, poStatusMap, poPaymentStatusMap } from '@/lib/status-badges';
import { PackageCheck, Check, X, Ban, FileText, Search, ShoppingCart, AlertTriangle } from 'lucide-react';
```

Then add `orderMutation` to `POListTabProps` (after `approveMutation` at line 30):

```typescript
  approveMutation: UseMutationResult<unknown, unknown, string, unknown>;
  orderMutation: UseMutationResult<unknown, unknown, string, unknown>;
  rejectPOMutation: UseMutationResult<unknown, unknown, { id: string; reason: string }, unknown>;
```

And add `orderMutation` to the destructured params of `POListTab(...)` (after `approveMutation` at line 74):

```typescript
  approveMutation,
  orderMutation,
  rejectPOMutation,
```

- [ ] **Step 2: Debounce the search so filtering is not per-keystroke**

The current `filteredPos` keys off raw `search` (line 89-107). Add a debounced value and use it in the memo. Right after the `const [search, setSearch] = useState('');` line (line 80), add:

```typescript
  const debouncedSearch = useDebounce(search, 250);
```

Then change the `filteredPos` memo's first line from `const q = search.trim().toLowerCase();` to use the debounced value, and update its dependency array:

```typescript
  const filteredPos = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const range = periodRange(periodFilter);
    return pos.filter((po) => {
      if (supplierFilter && po.supplier.id !== supplierFilter) return false;
      if (range) {
        const d = new Date(po.orderDate);
        if (d < range.start || d >= range.end) return false;
      }
      if (q) {
        const hay = [po.poNumber, po.supplier.name, po.supplier.contactName]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [pos, debouncedSearch, supplierFilter, periodFilter]);
```

(`hasFilter` at line 316 still keys off the immediate `search` so the chip row appears instantly — leave it as `Boolean(search || statusFilter || supplierFilter || periodFilter)`.)

- [ ] **Step 3: Add `ORDERED` to the status `<select>` and the active-chip label map**

In the status filter `<select>` (lines 334-339), add the `ORDERED` option after `APPROVED`:

```tsx
          <option value="">ทุกสถานะ</option>
          <option value="DRAFT">รออนุมัติ</option>
          <option value="APPROVED">อนุมัติแล้ว</option>
          <option value="ORDERED">สั่งซื้อแล้ว</option>
          <option value="PARTIALLY_RECEIVED">รับบางส่วน</option>
          <option value="FULLY_RECEIVED">รับครบแล้ว</option>
          <option value="CANCELLED">ยกเลิก</option>
```

And in the active-filter chip label map (lines 374-380) add the `ORDERED` key:

```tsx
              label={`สถานะ: ${
                {
                  DRAFT: 'รออนุมัติ',
                  APPROVED: 'อนุมัติแล้ว',
                  ORDERED: 'สั่งซื้อแล้ว',
                  PARTIALLY_RECEIVED: 'รับบางส่วน',
                  FULLY_RECEIVED: 'รับครบแล้ว',
                  CANCELLED: 'ยกเลิก',
                }[statusFilter] || statusFilter
              }`}
```

- [ ] **Step 4: Make the status column a pill that also shows the OVERDUE badge**

Replace the existing `status` column render (lines 187-199) with one that appends a red "เลยกำหนด" badge when `isOverdue(po)` is true (the status pill itself stays the centralized `poStatusMap` badge, which now includes `ORDERED` from Task 1):

```tsx
    {
      key: 'status',
      label: 'สถานะ',
      sortable: true,
      render: (po) => {
        const cfg = getStatusBadgeProps(po.status, poStatusMap);
        return (
          <div className="flex flex-col items-start gap-1">
            <Badge variant={cfg.variant} appearance={cfg.appearance}>
              {cfg.label}
            </Badge>
            {isOverdue(po) && (
              <Badge variant="destructive" appearance="light" className="gap-1">
                <AlertTriangle className="size-3" />
                เลยกำหนด
              </Badge>
            )}
          </div>
        );
      },
    },
```

(`Badge` accepts `className` — it's a `cva` component; existing call sites pass only variant/appearance, but className is supported via `cn(...)` inside `badge.tsx`.)

- [ ] **Step 5: Rewrite the `received` (progress) column to use `receiveProgress`**

Replace the existing `received` column (lines 222-244) so the count + bar come from the shared helper and the label reads "รับแล้ว N/M" with token colors:

```tsx
    {
      key: 'received',
      label: 'รับสินค้า',
      render: (po) => {
        const { received, ordered, pct } = receiveProgress(po);
        const done = ordered > 0 && received >= ordered;
        return (
          <div className="flex items-center gap-2 min-w-[120px]">
            <span className="text-sm whitespace-nowrap tabular-nums">
              <span className="text-muted-foreground">รับแล้ว </span>
              <span className={done ? 'text-success font-semibold' : 'font-medium'}>{received}</span>
              <span className="text-muted-foreground">/{ordered}</span>
            </span>
            {ordered > 0 && (
              <div className="flex-1 bg-secondary rounded-full h-1.5 min-w-[40px]">
                <div
                  className={`h-1.5 rounded-full ${done ? 'bg-success' : 'bg-primary'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </div>
        );
      },
    },
```

- [ ] **Step 6: Add a "สั่งซื้อ" action button for APPROVED POs + show receive for ORDERED too**

In the `actions` column (lines 245-313), two edits:

(a) The receive button currently shows for `['APPROVED', 'PARTIALLY_RECEIVED']` (line 259). Add `'ORDERED'` so an ordered PO can be received directly (back-compat: receive is allowed from ORDERED **or** APPROVED per spec state machine):

```tsx
          {['APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED'].includes(po.status) && (
            <button
              onClick={() => openReceiveModal(po)}
              className="p-1.5 rounded-md text-primary hover:bg-primary/10 transition-colors"
              title="รับสินค้า"
              aria-label={`รับสินค้า ${po.poNumber}`}
            >
              <PackageCheck className="size-4" />
            </button>
          )}
```

(b) Add a new "สั่งซื้อ" button that shows only for `APPROVED` POs, immediately **before** the receive button block:

```tsx
          {po.status === 'APPROVED' && (
            <button
              onClick={() => {
                setConfirmDialog({
                  open: true,
                  message: `ยืนยันสั่งซื้อ PO ${po.poNumber}? (สถานะจะเปลี่ยนเป็น "สั่งซื้อแล้ว")`,
                  action: () => orderMutation.mutate(po.id),
                });
              }}
              disabled={orderMutation.isPending}
              className="p-1.5 rounded-md text-info hover:bg-info/10 transition-colors disabled:opacity-50"
              title="สั่งซื้อ"
              aria-label={`สั่งซื้อ ${po.poNumber}`}
            >
              <ShoppingCart className="size-4" />
            </button>
          )}
```

- [ ] **Step 7: Add the payment chip column made always-clickable + clearer empty states**

The payment column (lines 200-221) is already a clickable chip via `poPaymentStatusMap` — **no change needed**; it already satisfies the spec's "payment CHIP". (Note in Self-Review.)

For empty states, the `DataTable` already takes `emptyMessage`/`emptyIcon`/`emptyDescription` (lines 405-408). Improve the no-filter empty message to be actionable (the filter case is already good). Change lines 406-408 to:

```tsx
            emptyMessage={hasFilter ? 'ไม่พบใบสั่งซื้อที่ตรงกับตัวกรอง' : 'ยังไม่มีใบสั่งซื้อ'}
            emptyIcon={hasFilter ? Search : ShoppingCart}
            emptyDescription={
              hasFilter
                ? 'ลองล้างตัวกรองหรือเปลี่ยนคำค้นหา'
                : 'กด "+ สร้าง PO" ที่มุมขวาบนเพื่อเริ่มสั่งซื้อสินค้าจากผู้จัดจำหน่าย'
            }
```

- [ ] **Step 8: Pass `orderMutation` from `index.tsx`**

In `apps/web/src/pages/PurchaseOrdersPage/index.tsx`, the `<POListTab ... />` props block is at lines 141-154. Add `orderMutation` after `approveMutation`:

```tsx
        <POListTab
          statusFilter={data.statusFilter}
          setStatusFilter={data.setStatusFilter}
          pos={data.pos}
          isLoading={data.isLoading}
          openDetailModal={data.openDetailModal}
          openReceiveModal={data.openReceiveModal}
          openPaymentModal={data.openPaymentModal}
          approveMutation={data.approveMutation}
          orderMutation={data.orderMutation}
          rejectPOMutation={data.rejectPOMutation}
          cancelMutation={data.cancelMutation}
          setConfirmDialog={data.setConfirmDialog}
          suppliers={data.suppliers}
        />
```

- [ ] **Step 9: Type-check**

Run: `./tools/check-types.sh all`
Expected: 0 errors.

- [ ] **Step 10: Run the existing web unit tests to confirm no regression**

Run: `cd apps/web && npx vitest run src/pages/PurchaseOrdersPage`
Expected: PASS (the Task 2 util test; this task added no new test file).

- [ ] **Step 11: MANUAL verification (desktop + mobile)**

Start dev: `cd apps/web && npm run dev` (login as `admin@bestchoice.com` / `admin1234`), go to `/purchase-orders`.
- **Desktop:** confirm the list shows: status pill with the new "สั่งซื้อแล้ว" (info/blue) for any ORDERED PO; a red "เลยกำหนด" badge under status when an ORDERED PO's expectedDate is in the past; a "รับแล้ว N/M" + progress bar in the รับสินค้า column; the payment chip is still clickable (opens payment modal). On an **APPROVED** PO confirm a cart (สั่งซื้อ) icon appears → click it → confirm dialog → on confirm the row flips to "สั่งซื้อแล้ว" and a green toast shows. Type a PO# in search → list filters after ~250ms.
- **Mobile (DevTools responsive, ~390px width):** the filter row wraps (`flex-wrap` already present); the progress bar shrinks but the count stays readable; action icons remain tappable. Verify the empty state (filter to a status with 0 rows) shows the Search icon + "ลองล้างตัวกรอง…" copy.

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/pages/PurchaseOrdersPage/components/POListTab.tsx apps/web/src/pages/PurchaseOrdersPage/index.tsx
git commit -m "feat(purchasing-web): PO list — ORDERED pill, overdue badge, progress bar, สั่งซื้อ action, debounced search, empty states"
```

---

### Task 4: PO detail redesign — status timeline + per-item received/QC progress + GR history (grNumber + receiver + time + print link)

**Files:**
- Modify: `apps/web/src/pages/PurchaseOrdersPage/types.ts` (add `grNumber` to `GoodsReceivingRecord`, lines 25-31; add `orderedAt` to `PurchaseOrder` after `expectedDate`; add an optional `receivingItems?` array to `POItem` for the QC tally — Step 7. Do NOT add `poItemId` to `GoodsReceivingItem`.)
- Modify: `apps/web/src/pages/PurchaseOrdersPage/components/PODetailModal.tsx` (add a timeline block after the general-info card ~line 96; enrich the รายการสินค้า table received/คงเหลือ cells which already exist lines 255-264 — add a per-item QC mini-summary computed from `selectedPO.items[].receivingItems[].product.status`; enrich the GR-history block lines 290-350 to show `grNumber` + a print link; widen the sticky-footer receive gate to include `ORDERED` — Step 9)
- Create: `apps/web/src/pages/PurchaseOrdersPage/po-detail.util.ts`
- Create: `apps/web/src/pages/PurchaseOrdersPage/po-detail.util.test.ts`

**Interfaces:**
- Consumes: `selectedPO: PurchaseOrder`, `poDetail: PODetail | null` (existing props); `receiveProgress`/`isOverdue` (Task 2); `useNavigate` from `react-router` (for the print link).
- Produces:
  - `GoodsReceivingRecord.grNumber: string` (type addition — backend already returns it after B0).
  - `timelineSteps(po: { status: string; orderedAt?: string | null; ... }): { key: string; label: string; state: 'done' | 'current' | 'upcoming' | 'cancelled' }[]` in `po-detail.util.ts`.

- [ ] **Step 1: Add `grNumber` to the `GoodsReceivingRecord` type + `orderedAt`/`expectedDate` already present**

In `apps/web/src/pages/PurchaseOrdersPage/types.ts`, the `GoodsReceivingRecord` interface (lines 25-31) lacks `grNumber`. Add it (backend `findOne` includes it post-B0 via the `goodsReceivings` include):

```typescript
export interface GoodsReceivingRecord {
  id: string;
  grNumber: string;
  createdAt: string;
  notes: string | null;
  receivedBy: { id: string; name: string };
  items: GoodsReceivingItem[];
}
```

Also add `orderedAt` to `PurchaseOrder` (additive — the backend returns it post-B0; the `isOverdue` helper keys off `expectedDate`+`status`, and `timelineSteps` keys off `status`, so `orderedAt` is not strictly consumed by B1 logic, but typing it keeps the shape honest and lets the detail surface "สั่งเมื่อ" later). Insert it between the existing `expectedDate` (line 37) and `dueDate` (line 38) — do NOT re-declare `dueDate`, it already exists:

```typescript
  expectedDate: string | null;
  orderedAt: string | null;
  dueDate: string | null;
```

- [ ] **Step 2: Write the failing test for `timelineSteps`**

Create `apps/web/src/pages/PurchaseOrdersPage/po-detail.util.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { timelineSteps } from './po-detail.util';

const stateOf = (steps: ReturnType<typeof timelineSteps>, key: string) =>
  steps.find((s) => s.key === key)?.state;

describe('timelineSteps', () => {
  it('has 5 steps in order: draft → approved → ordered → received → completed', () => {
    const steps = timelineSteps({ status: 'DRAFT' });
    expect(steps.map((s) => s.key)).toEqual(['draft', 'approved', 'ordered', 'received', 'completed']);
  });

  it('DRAFT: draft is current, rest upcoming', () => {
    const s = timelineSteps({ status: 'DRAFT' });
    expect(stateOf(s, 'draft')).toBe('current');
    expect(stateOf(s, 'approved')).toBe('upcoming');
  });

  it('ORDERED: draft+approved+ordered done, ordered is current, received upcoming', () => {
    const s = timelineSteps({ status: 'ORDERED' });
    expect(stateOf(s, 'draft')).toBe('done');
    expect(stateOf(s, 'approved')).toBe('done');
    expect(stateOf(s, 'ordered')).toBe('current');
    expect(stateOf(s, 'received')).toBe('upcoming');
  });

  it('PARTIALLY_RECEIVED: received is current, prior all done', () => {
    const s = timelineSteps({ status: 'PARTIALLY_RECEIVED' });
    expect(stateOf(s, 'ordered')).toBe('done');
    expect(stateOf(s, 'received')).toBe('current');
    expect(stateOf(s, 'completed')).toBe('upcoming');
  });

  it('FULLY_RECEIVED: every step done, completed current', () => {
    const s = timelineSteps({ status: 'FULLY_RECEIVED' });
    expect(stateOf(s, 'received')).toBe('done');
    expect(stateOf(s, 'completed')).toBe('current');
  });

  it('CANCELLED: all steps marked cancelled', () => {
    const s = timelineSteps({ status: 'CANCELLED' });
    expect(s.every((st) => st.state === 'cancelled')).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/PurchaseOrdersPage/po-detail.util.test.ts`
Expected: FAIL — module `./po-detail.util` not found.

- [ ] **Step 4: Implement `timelineSteps`**

Create `apps/web/src/pages/PurchaseOrdersPage/po-detail.util.ts`:

```typescript
/**
 * PO status timeline (spec: Draft → อนุมัติ → สั่งแล้ว → รับ → ครบ).
 * Maps the PO status to a per-step state so the detail view can render a
 * progress timeline. PARTIALLY_RECEIVED and APPROVED back-compat both handled.
 */

export type TimelineState = 'done' | 'current' | 'upcoming' | 'cancelled';

export interface TimelineStep {
  key: 'draft' | 'approved' | 'ordered' | 'received' | 'completed';
  label: string;
  state: TimelineState;
}

const ORDER: TimelineStep['key'][] = ['draft', 'approved', 'ordered', 'received', 'completed'];
const LABELS: Record<TimelineStep['key'], string> = {
  draft: 'รออนุมัติ',
  approved: 'อนุมัติ',
  ordered: 'สั่งแล้ว',
  received: 'รับเข้า',
  completed: 'รับครบ',
};

// Which step index is "current" for each status.
const CURRENT_INDEX: Record<string, number> = {
  DRAFT: 0,
  APPROVED: 1,
  ORDERED: 2,
  PARTIALLY_RECEIVED: 3,
  FULLY_RECEIVED: 4,
};

export function timelineSteps(po: { status: string }): TimelineStep[] {
  if (po.status === 'CANCELLED') {
    return ORDER.map((key) => ({ key, label: LABELS[key], state: 'cancelled' as TimelineState }));
  }
  const current = CURRENT_INDEX[po.status] ?? 0;
  return ORDER.map((key, idx) => {
    let state: TimelineState;
    if (idx < current) state = 'done';
    else if (idx === current) state = 'current';
    else state = 'upcoming';
    return { key, label: LABELS[key], state };
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/pages/PurchaseOrdersPage/po-detail.util.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Render the timeline in `PODetailModal` (after the general-info card)**

In `PODetailModal.tsx`, add the imports at the top. Current first lines:

```typescript
import { formatDateShort, formatDateMedium, formatDateTime } from '@/utils/formatters';
import { PurchaseOrder, PODetail, POItem } from '../types';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, poStatusMap, poPaymentStatusMap } from '@/lib/status-badges';
```

Change to:

```typescript
import { useNavigate } from 'react-router';
import { formatDateShort, formatDateMedium, formatDateTime } from '@/utils/formatters';
import { PurchaseOrder, PODetail, POItem } from '../types';
import { timelineSteps } from '../po-detail.util';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, poStatusMap, poPaymentStatusMap } from '@/lib/status-badges';
import { Check, Circle, Printer } from 'lucide-react';
```

Inside the component body, add `const navigate = useNavigate();` right after the `getItemDesc` definition (before `if (!isOpen) return null;` at line 36).

Then insert a **timeline card** immediately after the closing `</div>` of the "ข้อมูลทั่วไป" card (line 96, just before the "การจ่ายเงิน" card at line 98):

```tsx
              {/* สถานะการดำเนินการ (timeline) */}
              {selectedPO.status !== 'CANCELLED' && (
                <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
                  <h3 className="text-sm font-semibold text-foreground mb-4 leading-snug">สถานะการดำเนินการ</h3>
                  <ol className="flex items-center justify-between gap-1">
                    {timelineSteps(selectedPO).map((step, idx, arr) => {
                      const done = step.state === 'done';
                      const current = step.state === 'current';
                      return (
                        <li key={step.key} className="flex-1 flex flex-col items-center text-center relative">
                          {idx < arr.length - 1 && (
                            <span
                              className={`absolute top-3 left-1/2 w-full h-0.5 ${done ? 'bg-success' : 'bg-border'}`}
                              aria-hidden
                            />
                          )}
                          <span
                            className={`relative z-10 flex items-center justify-center size-6 rounded-full border-2 ${
                              done
                                ? 'bg-success border-success text-success-foreground'
                                : current
                                  ? 'bg-primary border-primary text-primary-foreground'
                                  : 'bg-background border-border text-muted-foreground'
                            }`}
                          >
                            {done ? <Check className="size-3.5" /> : <Circle className="size-2 fill-current" />}
                          </span>
                          <span
                            className={`mt-1.5 text-[11px] leading-snug ${
                              current ? 'text-primary font-semibold' : done ? 'text-foreground' : 'text-muted-foreground'
                            }`}
                          >
                            {step.label}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}
```

(`success-foreground`/`primary-foreground` are existing tokens used elsewhere; `Circle className="fill-current"` gives a filled dot.)

- [ ] **Step 7: Add a per-item QC mini-summary to the รายการสินค้า table**

The product table already renders `รับแล้ว`/`คงเหลือ` per item (lines 255-264). Add a per-item QC indicator column derived from each PO item's received products' status.

> **DATA-SOURCE CORRECTION (verified against `po-query.service.ts:47-78`):** `findOne` returns `goodsReceivings.items` with a plain `items: true` — those raw rows carry **no `product` relation**, so reading `gr.items[].product.status` from `poDetail.goodsReceivings` would be `undefined` at runtime and the QC column would always render "-". The QC product status **is** available, but on a different include: `findOne` selects PO `items` with `items.include.receivingItems.include.product` (`{ id, name, imeiSerial, serialNumber, status, branchId }`). So compute the QC tally **per PO item** from `selectedPO.items[].receivingItems[].product.status` — data that is actually present. This keeps B1 frontend-only (no backend include change needed).

First, expose `receivingItems` on the frontend `POItem` type so the compute is typed. In `apps/web/src/pages/PurchaseOrdersPage/types.ts`, add a `receivingItems?` field to `POItem` (optional because the list endpoint `findAll` returns `items: true` WITHOUT `receivingItems` — only the detail `findOne` populates it):

```typescript
export interface POItem {
  id: string;
  brand: string;
  model: string;
  color: string | null;
  storage: string | null;
  category: string | null;
  quantity: number;
  unitPrice: string;
  receivedQty: number;
  accessoryType: string | null;
  accessoryBrand: string | null;
  receivingItems?: {
    id: string;
    status: 'PASS' | 'REJECT';
    product: { id: string; status: string } | null;
  }[];
}
```

(Do **not** add `poItemId` to `GoodsReceivingItem` — the QC compute no longer needs it. The existing `GoodsReceivingItem.product` field stays as-is for the GR-history block, which today never reads `product` anyway because `findOne`'s `goodsReceivings.items: true` omits it.)

Then add this helper inside the component (after `navigate`), keyed by PO item id:

```tsx
  // Per-PO-item QC tally from each item's receiving products (findOne includes
  // items.receivingItems.product.status — see po-query.service.ts:55-62).
  const qcByItem = new Map<string, { qcPending: number; inStock: number }>();
  for (const item of selectedPO.items) {
    const acc = { qcPending: 0, inStock: 0 };
    for (const ri of item.receivingItems ?? []) {
      if (ri.status !== 'PASS' || !ri.product) continue;
      if (ri.product.status === 'QC_PENDING' || ri.product.status === 'PHOTO_PENDING') acc.qcPending += 1;
      else if (ri.product.status === 'IN_STOCK') acc.inStock += 1;
    }
    if (acc.qcPending > 0 || acc.inStock > 0) qcByItem.set(item.id, acc);
  }
```

Add a "QC" header to the table `<thead>` (after the `คงเหลือ` header at line 238):

```tsx
                      <th className="px-3 py-2.5 text-right font-semibold">คงเหลือ</th>
                      <th className="px-3 py-2.5 text-right font-semibold">QC</th>
                      <th className="px-3 py-2.5 text-right font-semibold">รวม</th>
```

And add the matching cell in each row, after the `คงเหลือ` `<td>` (which ends at line 264):

```tsx
                        <td className="px-3 py-2.5 text-right">
                          {(() => {
                            const qc = qcByItem.get(item.id);
                            if (!qc || (qc.qcPending === 0 && qc.inStock === 0)) return <span className="text-muted-foreground">-</span>;
                            return (
                              <div className="flex flex-col items-end gap-0.5">
                                {qc.qcPending > 0 && (
                                  <Badge variant="warning" appearance="light" className="text-[10px]">รอ QC {qc.qcPending}</Badge>
                                )}
                                {qc.inStock > 0 && (
                                  <Badge variant="success" appearance="light" className="text-[10px]">เข้าสต็อก {qc.inStock}</Badge>
                                )}
                              </div>
                            );
                          })()}
                        </td>
```

- [ ] **Step 8: Enrich the GR-history block with grNumber + print link**

The GR-history block (lines 290-350) currently shows `gr.receivedBy.name` + `formatDateTime(gr.createdAt)` + PASS/REJECT counts. Update the header row of each GR card (lines 308-325) to show the `grNumber` prominently and a print button that routes to the print page (Task 5). Replace the `<div className="flex items-center justify-between mb-2">...</div>` block (lines 308-325) with:

```tsx
                          <div className="flex items-center justify-between mb-2 gap-2">
                            <div className="text-sm min-w-0">
                              <span className="font-mono font-semibold text-primary">{gr.grNumber}</span>
                              <div className="text-xs text-muted-foreground leading-snug">
                                โดย {gr.receivedBy.name} · {formatDateTime(gr.createdAt)}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-success/10 text-success dark:bg-success/15">
                                ผ่าน {passCount}
                              </span>
                              {rejectCount > 0 && (
                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-destructive/10 text-destructive dark:bg-destructive/15">
                                  ไม่ผ่าน {rejectCount}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => navigate(`/purchase-orders/${selectedPO.id}/goods-receivings/${gr.id}/print`)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-primary hover:bg-primary/10 transition-colors"
                                title="พิมพ์ใบรับของ"
                                aria-label={`พิมพ์ใบรับของ ${gr.grNumber}`}
                              >
                                <Printer className="size-3.5" />
                                พิมพ์
                              </button>
                            </div>
                          </div>
```

- [ ] **Step 9: Allow receive from an ORDERED PO in the detail modal footer (parity with the list)**

The sticky-footer "รับสินค้า" button currently gates on `['APPROVED', 'PARTIALLY_RECEIVED'].includes(selectedPO.status)` (PODetailModal line 354). Task 3 Step 6(a) already added `'ORDERED'` to the **list's** receive gate; mirror that here so an ORDERED PO can also be received from the detail. Change the footer condition:

```tsx
            {/* Sticky Footer */}
            {['APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED'].includes(selectedPO.status) && (
```

(Both gates must match the B0 receive state machine — receive allowed from `ORDERED` or `APPROVED`, back-compat.)

- [ ] **Step 10: Type-check**

Run: `./tools/check-types.sh all`
Expected: 0 errors. (`useNavigate` is from `react-router` — same import path used across the repo, e.g. `PaymentVoucherPage.tsx:14`.)

- [ ] **Step 11: Run the PO unit tests**

Run: `cd apps/web && npx vitest run src/pages/PurchaseOrdersPage`
Expected: PASS (Task 2 + Task 4 util tests).

- [ ] **Step 12: MANUAL verification (desktop + mobile)**

On `/purchase-orders`, open a PO that has at least one goods-receiving (or receive one first):
- **Desktop:** the detail modal shows a 5-node timeline (รออนุมัติ → อนุมัติ → สั่งแล้ว → รับเข้า → รับครบ) with done steps green-checked, the current step blue-bold, future steps muted; a cancelled PO hides the timeline. The product table shows a QC column with "รอ QC N"/"เข้าสต็อก N" badges. The GR-history shows `GR-YYYY-MM-NNN` in mono primary, "โดย <name> · <time>", PASS/REJECT chips, and a "พิมพ์" button.
- **Mobile (~390px):** the timeline labels stay on one line (`text-[11px]`); the product table scrolls horizontally inside the card; the GR card header wraps without overflow (chips + print button on the right). Click "พิมพ์" → routes to the print page (Task 5 verifies the page itself).

- [ ] **Step 13: Commit**

```bash
git add apps/web/src/pages/PurchaseOrdersPage/types.ts apps/web/src/pages/PurchaseOrdersPage/components/PODetailModal.tsx apps/web/src/pages/PurchaseOrdersPage/po-detail.util.ts apps/web/src/pages/PurchaseOrdersPage/po-detail.util.test.ts
git commit -m "feat(purchasing-web): PO detail — status timeline, per-item QC progress, GR history with grNumber + print link"
```

---

### Task 5: Printable ใบรับของ (Goods Receipt) page + lazy route

**Files:**
- Create: `apps/web/src/pages/PurchaseOrdersPage/GoodsReceiptPrintPage.tsx`
- Modify: `apps/web/src/App.tsx` (lazy import alongside the other PO/print pages — `PurchaseOrdersPage` is declared at line 94, `PaymentVoucherPage` at line 128; new `<Route>` next to the `/purchase-orders` route block at lines 337-344)

**Interfaces:**
- Consumes: `GET /purchase-orders/:id/goods-receivings/:receivingId` → `getGoodsReceivingById` (verified backend shape in `po-query.service.ts:224-240`): returns `{ id, grNumber, createdAt, notes, po: { id, poNumber, supplierId, supplier: { id, name } }, receivedBy: { id, name }, items: [{ id, status, imeiSerial, serialNumber, rejectReason, defectReason, poItem: { brand, model, color, storage, category, accessoryType, accessoryBrand, quantity, receivedQty }, product: {...} }] }`. (`grNumber` + `defectReason` exist post-B0.)
- Consumes: `useCompanyDisplayName`, `useCompanyAddress`, `useCompanyTaxId`, `useCompanyLogoUrl` (`@/hooks/useCompanyInfo`); `QueryBoundary` (default export of `@/components/QueryBoundary`); `formatDateTime` (`@/utils/formatters`); `api` (default export of `@/lib/api`). (Note: the page uses `formatDateTime` for timestamps — it does NOT import `formatThaiDateLong`; only list what the Step-1 code actually imports to avoid an unused-import error.)
- Produces: route `/purchase-orders/:id/goods-receivings/:receivingId/print`.

> Reuse note: this page mirrors `apps/web/src/pages/PaymentVoucherPage.tsx` exactly — the same screen-only `.no-print` toolbar (กลับ + พิมพ์), the same co-located `<style>` `@page A4 / @media print` block, the same `voucher-sheet` article with `bg-white ... print:border-0 print:p-0 print:shadow-none`, and the same `useCompanyInfo` header. `bg-white` is allowed here (print/receipt context). It is the lightest doc (no JE, no WHT, no signatures grid required by spec — spec asks only for grNumber, supplier, items, receiver, time).

- [ ] **Step 1: Create the print page**

Create `apps/web/src/pages/PurchaseOrdersPage/GoodsReceiptPrintPage.tsx`:

```tsx
// Purchasing v2 B1 — Printable ใบรับของ (Goods Receipt) per GoodsReceiving record.
//
// Route: /purchase-orders/:id/goods-receivings/:receivingId/print
//
// Mirrors PaymentVoucherPage's print pattern: screen-only toolbar (.no-print),
// an A4 voucher-sheet, co-located @media print CSS, window.print() for PDF.
// Receiving posts NO journal entry — this is an operational receipt, not an
// accounting document (spec red line: purchasing stays JE-free).

import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import { formatDateTime } from '@/utils/formatters';
import {
  useCompanyDisplayName,
  useCompanyAddress,
  useCompanyTaxId,
  useCompanyLogoUrl,
} from '@/hooks/useCompanyInfo';

interface GRItem {
  id: string;
  status: 'PASS' | 'REJECT';
  imeiSerial: string | null;
  serialNumber: string | null;
  rejectReason: string | null;
  defectReason: string | null;
  poItem: {
    brand: string;
    model: string;
    color: string | null;
    storage: string | null;
    category: string | null;
    accessoryType: string | null;
    accessoryBrand: string | null;
  } | null;
}

interface GRDoc {
  id: string;
  grNumber: string;
  createdAt: string;
  notes: string | null;
  po: { id: string; poNumber: string; supplier: { id: string; name: string } };
  receivedBy: { id: string; name: string };
  items: GRItem[];
}

const DEFECT_LABELS: Record<string, string> = {
  SCREEN: 'จอภาพ',
  BATTERY: 'แบตเตอรี่',
  IMEI_BLOCKED: 'IMEI ถูกบล็อก',
  BOX_MISSING: 'กล่อง/อุปกรณ์ไม่ครบ',
  WRONG_MODEL: 'ผิดรุ่น',
  DOA: 'เสียตั้งแต่แกะ (DOA)',
  COSMETIC: 'ตำหนิภายนอก',
  OTHER: 'อื่นๆ',
};

function itemDesc(it: GRItem): string {
  const p = it.poItem;
  if (!p) return '-';
  if (p.category === 'ACCESSORY') {
    const isCharger = p.accessoryType === 'ชุดชาร์จ';
    const parts = [p.accessoryType, p.accessoryBrand, p.model ? (isCharger ? p.model : `สำหรับ ${p.model}`) : '']
      .filter(Boolean);
    return parts.join(' / ') || '-';
  }
  return [p.brand, p.model, p.color, p.storage].filter(Boolean).join(' ') || '-';
}

export default function GoodsReceiptPrintPage() {
  const { id, receivingId } = useParams<{ id: string; receivingId: string }>();
  const navigate = useNavigate();

  const grQuery = useQuery<GRDoc>({
    queryKey: ['gr-print', id, receivingId],
    queryFn: async () => {
      const { data } = await api.get(`/purchase-orders/${id}/goods-receivings/${receivingId}`);
      return data;
    },
    enabled: !!id && !!receivingId,
  });

  useEffect(() => {
    document.title = grQuery.data ? `ใบรับของ ${grQuery.data.grNumber}` : 'ใบรับของ';
  }, [grQuery.data]);

  return (
    <div className="bg-muted/30 min-h-screen">
      <div className="no-print bg-card border-b border-border sticky top-0 z-10">
        <div className="max-w-[210mm] mx-auto px-6 py-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={14} />
            กลับ
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Printer size={14} />
            พิมพ์ / Save PDF
          </button>
        </div>
      </div>

      <QueryBoundary
        isLoading={grQuery.isLoading}
        isError={grQuery.isError}
        error={grQuery.error}
        onRetry={grQuery.refetch}
      >
        {grQuery.data && <GoodsReceiptSheet doc={grQuery.data} />}
      </QueryBoundary>

      <style>{`
        @page { size: A4; margin: 14mm 12mm; }
        @media print {
          .no-print { display: none !important; }
          .voucher-sheet { box-shadow: none !important; }
          body { background: white !important; }
        }
      `}</style>
    </div>
  );
}

function GoodsReceiptSheet({ doc }: { doc: GRDoc }) {
  const companyName = useCompanyDisplayName();
  const companyAddress = useCompanyAddress();
  const companyTaxId = useCompanyTaxId();
  const companyLogoUrl = useCompanyLogoUrl();
  const passCount = doc.items.filter((i) => i.status === 'PASS').length;
  const rejectCount = doc.items.filter((i) => i.status === 'REJECT').length;

  return (
    <div className="max-w-[210mm] mx-auto py-6 px-6 print:px-0 print:py-0">
      <article
        className="voucher-sheet bg-white border border-border rounded-md p-8 shadow-sm print:border-0 print:p-0 print:shadow-none"
        style={{ minHeight: '270mm' }}
      >
        <header className="text-center border-b-2 border-foreground pb-3">
          {companyLogoUrl && (
            <img src={companyLogoUrl} alt={companyName} className="mx-auto mb-2 h-12 w-auto object-contain" />
          )}
          <h1 className="text-xl font-bold leading-snug">{companyName}</h1>
          <p className="text-sm text-muted-foreground mt-1 leading-snug">
            {companyAddress}{companyTaxId && ` · เลขผู้เสียภาษี ${companyTaxId}`}
          </p>
          <h2 className="text-2xl font-bold tracking-wider mt-4 leading-snug">ใบรับของ</h2>
          <p className="text-xs text-muted-foreground">Goods Receipt</p>
        </header>

        <section className="grid grid-cols-2 gap-x-8 gap-y-2 mt-5 text-sm">
          <Meta label="เลขที่ใบรับของ" value={doc.grNumber} mono />
          <Meta label="วันที่รับ" value={formatDateTime(doc.createdAt)} />
          <Meta label="อ้างอิงใบสั่งซื้อ" value={doc.po.poNumber} mono />
          <Meta label="ผู้จัดจำหน่าย" value={doc.po.supplier.name} />
          <Meta label="ผู้รับของ" value={doc.receivedBy.name} />
          <Meta label="สรุป" value={`รับเข้า ${doc.items.length} · ผ่าน ${passCount} · ไม่ผ่าน ${rejectCount}`} />
        </section>

        <table className="w-full mt-6 text-xs border border-border">
          <thead className="bg-muted/40">
            <tr>
              <th className="border border-border p-2 text-left w-10">#</th>
              <th className="border border-border p-2 text-left">รายการ</th>
              <th className="border border-border p-2 text-left">IMEI / Serial</th>
              <th className="border border-border p-2 text-center w-20">ผล</th>
              <th className="border border-border p-2 text-left">หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>
            {doc.items.length === 0 ? (
              <tr>
                <td colSpan={5} className="border border-border p-3 text-center text-muted-foreground">
                  ไม่มีรายการ
                </td>
              </tr>
            ) : (
              doc.items.map((it, idx) => (
                <tr key={it.id}>
                  <td className="border border-border p-2 tabular-nums">{idx + 1}</td>
                  <td className="border border-border p-2 leading-snug">{itemDesc(it)}</td>
                  <td className="border border-border p-2 font-mono">
                    {it.imeiSerial || it.serialNumber || '—'}
                  </td>
                  <td className="border border-border p-2 text-center">
                    {it.status === 'PASS' ? 'ผ่าน' : 'ไม่ผ่าน'}
                  </td>
                  <td className="border border-border p-2 leading-snug">
                    {it.status === 'REJECT'
                      ? [it.defectReason ? DEFECT_LABELS[it.defectReason] ?? it.defectReason : null, it.rejectReason]
                          .filter(Boolean)
                          .join(' · ') || '—'
                      : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {doc.notes && (
          <section className="mt-6">
            <p className="text-xs text-muted-foreground mb-1">หมายเหตุ</p>
            <p className="text-sm leading-snug">{doc.notes}</p>
          </section>
        )}

        <section className="grid grid-cols-2 gap-6 mt-12">
          <Sig label="ผู้รับของ" />
          <Sig label="ผู้ตรวจสอบ" />
        </section>

        <footer className="mt-8 pt-3 border-t border-border text-[10px] text-muted-foreground flex justify-between">
          <span>ออกเอกสารจากระบบ BESTCHOICE — เอกสารรับของภายใน ไม่ใช่ใบกำกับภาษี</span>
          <span>ใบรับของ v1.0</span>
        </footer>
      </article>
    </div>
  );
}

function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground leading-snug">{label}</p>
      <p className={(mono ? 'font-mono ' : '') + 'text-sm leading-snug'}>{value}</p>
    </div>
  );
}

function Sig({ label }: { label: string }) {
  return (
    <div className="text-center">
      <div className="h-16 mb-2 border-b border-foreground" />
      <p className="text-xs text-muted-foreground leading-snug">({label})</p>
      <p className="text-[10px] text-muted-foreground mt-1">วันที่ ___ / ___ / ______</p>
    </div>
  );
}
```

- [ ] **Step 2: Register the lazy import in `App.tsx`**

In `apps/web/src/App.tsx`, add a lazy import next to the other PO/print page imports (the `PurchaseOrdersPage` import is the one referenced by the `/purchase-orders` route; `PaymentVoucherPage` is at line 128). Add:

```typescript
const GoodsReceiptPrintPage = lazy(() => import('@/pages/PurchaseOrdersPage/GoodsReceiptPrintPage'));
```

(Place it adjacent to wherever `PurchaseOrdersPage` is declared — grep `const PurchaseOrdersPage = lazy(` to find the line, then add the new line directly under it.)

- [ ] **Step 3: Register the route in `App.tsx`**

Add a `<Route>` directly after the `/purchase-orders` route block (the comment `{/* จัดซื้อ (Purchasing) */}` is at line 337, the route element spans lines 338-344), inside the same `MainLayout`/`ProtectedRoute` tree. Use the same roles as the `/purchase-orders` route (`OWNER`, `BRANCH_MANAGER`) — note the backend `getGoodsReceivingById` allows OWNER/BM/FM/ACCOUNTANT, but the page lives under the purchasing zone so we mirror the list route's roles:

```tsx
          {/* จัดซื้อ (Purchasing) */}
          <Route
            path="/purchase-orders"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER']}>
                <PurchaseOrdersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/purchase-orders/:id/goods-receivings/:receivingId/print"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER']}>
                <GoodsReceiptPrintPage />
              </ProtectedRoute>
            }
          />
```

- [ ] **Step 4: Type-check**

Run: `./tools/check-types.sh all`
Expected: 0 errors.

- [ ] **Step 5: MANUAL verification (desktop print + mobile)**

From a PO detail with a goods-receiving, click "พิมพ์" on a GR card (Task 4) → lands on `/purchase-orders/<id>/goods-receivings/<grId>/print`.
- **Desktop:** the page shows the company header (name/address/tax id), title "ใบรับของ / Goods Receipt", a meta grid (เลขที่ใบรับของ = `GR-YYYY-MM-NNN`, วันที่รับ, อ้างอิงใบสั่งซื้อ = PO#, ผู้จัดจำหน่าย, ผู้รับของ, สรุป), an items table (#, รายการ, IMEI/Serial, ผล, หมายเหตุ with Thai defect labels on rejects), notes if present, 2 signature slots, footer. Click "พิมพ์ / Save PDF" → browser print dialog opens at A4; the screen toolbar is hidden in the preview (`.no-print`), the sheet has no border/shadow on paper.
- **Mobile (~390px):** the toolbar + sheet scale down; the items table scrolls horizontally; the print button still works.
- **Tab title:** browser tab shows `ใบรับของ GR-YYYY-MM-NNN`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/PurchaseOrdersPage/GoodsReceiptPrintPage.tsx apps/web/src/App.tsx
git commit -m "feat(purchasing-web): printable ใบรับของ (Goods Receipt) page + lazy route"
```

---

### Task 6: Batch verification (full type + web test run) and ship gate

**Files:** none (verification only)

- [ ] **Step 1: Full web unit-test run (no regressions)**

Run: `cd apps/web && npx vitest run`
Expected: all existing web tests + the 2 new util test files (`po-list.util.test.ts`, `po-detail.util.test.ts`) PASS.

- [ ] **Step 2: Full type gate**

Run: `./tools/check-types.sh all`
Expected: 0 errors across api + web.

- [ ] **Step 3: Confirm no accounting/finance import crept in (red-line check)**

Run: `grep -rnE "from '@/.*(accounting|journal|expense|finance|tax)" apps/web/src/pages/PurchaseOrdersPage`
Expected: **no matches** (the only `@/hooks/useCompanyInfo` import in `GoodsReceiptPrintPage` is company display data, not an accounting module). If any match appears, remove it.

- [ ] **Step 4: Commit (if any cleanup) / otherwise proceed to code-review + /pre-deploy**

Per the spec's per-batch cadence: run the `code-reviewer` agent → fix Critical/Warning → `/pre-deploy` → branch → main → deploy → owner review. No code change in this step unless review surfaces one.

---

## Self-Review

**Spec coverage (B1 items — from spec §"B1 — PO list + detail redesign"):**

| Spec bullet (B1) | Task |
|---|---|
| Status **pills** incl. new **ORDERED** state | Task 1 (label + `poStatusMap.ORDERED`) + Task 3 Step 4 (pill render) |
| Partial-receive **progress bar** ("รับแล้ว 3/10" from items receivedQty/quantity) | Task 2 (`receiveProgress`) + Task 3 Step 5 |
| Payment **chip** | Task 3 Step 7 — **already present** in current code (clickable `poPaymentStatusMap` chip, POListTab lines 200-221); verified, no change needed |
| **OVERDUE badge** (computed: status ORDERED && expectedDate < now) | Task 2 (`isOverdue`) + Task 3 Step 4 |
| PO#/supplier **SEARCH** (useDebounce) | Task 3 Step 1-2 (added `useDebounce` over existing search) |
| Clearer **empty states** | Task 3 Step 7 (no-data actionable message + icon) |
| **"สั่งซื้อ" action** wired to `POST /:id/order` (APPROVED → ORDERED) via new mutation in `usePurchaseOrdersData` | Task 1 Step 3-4 (`orderMutation`) + Task 3 Step 6 (button) |
| Add the **ORDERED label to constants** | Task 1 Step 1 (`statusLabels`/`statusColors`) |
| PO detail **status TIMELINE** (Draft → อนุมัติ → สั่งแล้ว → รับ → ครบ) | Task 4 (`timelineSteps`) + Task 4 Step 6 (render) |
| Per-item **received/QC progress** | Task 4 Step 7 (QC column; received/คงเหลือ already in table) |
| **GR HISTORY** list (each GR shows grNumber + receiver + time) | Task 4 Step 1 (type `grNumber`) + Step 8 (render grNumber + receiver + time) |
| **Printable ใบรับของ** per GR (grNumber, supplier, items, receiver, time) — reuse repo print pattern | Task 5 (mirrors `PaymentVoucherPage`) |

**Placeholder scan:** none. Every code/JSX/test step shows full content; every run command has an expected result; every MANUAL step lists what to click + what to see on desktop AND mobile.

**Type/prop-name consistency across tasks:**
- `orderMutation` typed identically as `UseMutationResult<unknown, unknown, string, unknown>` in `POListTabProps` (Task 3) and produced as such by `usePurchaseOrdersData` (Task 1), matching the sibling `approveMutation`/`cancelMutation` shape already in the file.
- `receiveProgress`/`isOverdue` signatures (Task 2) match every call site (Task 3 list, Task 4 detail). `receiveProgress` accepts a structural `{ items: {quantity; receivedQty}[] }` so both `PurchaseOrder` and `PODetail` satisfy it.
- `timelineSteps(po: { status: string })` (Task 4) is called with `selectedPO` (has `status: string`) — structurally compatible.
- `GoodsReceivingRecord.grNumber` (Task 4 Step 1) is added to `types.ts` to match the backend `findOne` include shape (`po-query.service.ts:66-72`: `goodsReceivings` includes `receivedBy` + `items: true`; the GR row scalar `grNumber` exists post-B0). The per-item QC tally (Task 4 Step 7) does **not** read `goodsReceivings.items[].product` (that include is absent in `findOne` — `items: true` carries no `product`); instead it reads `selectedPO.items[].receivingItems[].product.status`, which `findOne` **does** include (`po-query.service.ts:55-62`), via the new optional `POItem.receivingItems?` type field.
- The print page's `GRDoc`/`GRItem` interfaces (Task 5) match the **distinct** `getGoodsReceivingById` shape (`po-query.service.ts:224-240`: `po.poNumber` + `po.supplier`, `poItem.{brand,model,color,storage,category,accessoryType,accessoryBrand}`, `defectReason`) — these are local to the print page, not the shared `PODetail` type, so no cross-file conflict.

**Deviations found vs spec wording:**
1. **Payment chip already exists** — the spec lists it as a B1 deliverable, but `POListTab` already renders a clickable payment chip via `poPaymentStatusMap` (lines 200-221). No new work; documented above. This mirrors B0's "IMEI guard already implemented" deviation style.
2. **Received/คงเหลือ columns already exist** in both the list (`received` column) and the detail product table — B1 adds the **progress-bar styling refactor** (shared helper) on the list and a **new QC** column on the detail, rather than building received-tracking from scratch.
3. **GR history block already exists** in `PODetailModal` (lines 290-350) showing receiver + time + PASS/REJECT counts — B1 adds `grNumber` (the one missing field) + the print link, rather than building the block from zero.
4. **Print page roles:** backend `getGoodsReceivingById` permits OWNER/BM/FM/ACCOUNTANT, but the new print route uses `['OWNER','BRANCH_MANAGER']` to mirror the `/purchase-orders` list route (purchasing zone). FM/ACCOUNTANT do not have a list entry to reach it from, so this is consistent; widen later if a finance entry point is added.
5. **No new backend work** — B0 already shipped `ORDERED`/`orderedAt`/`grNumber`/`DefectReason` and the `POST /:id/order` + GR endpoints, so B1 is purely frontend (spec's B1 is a frontend batch). The plan adds **zero** API/schema changes, honoring the red line by construction.
