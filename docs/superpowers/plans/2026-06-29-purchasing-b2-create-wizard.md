# Purchasing v2 — Batch 2: สร้าง PO 4-Step Wizard (desktop) with transparent VAT — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the one-long-modal "สร้างใบสั่งซื้อ" into a guided **4-step wizard** — (1) เลือกผู้ขาย (+inline create, show credit terms → due-date preview), (2) เพิ่มรายการ (product picker + running subtotal), (3) ส่วนลด/VAT with a **transparent breakdown that mirrors the backend math exactly**, (4) ทบทวน+บันทึก — plus **auto-save draft to localStorage** (recover on reopen). The existing `POST /purchase-orders` contract (`CreatePODto`) is **unchanged**; this is a pure front-of-glass rebuild.

**Architecture:** Refactor `apps/web/src/pages/PurchaseOrdersPage`. The data/mutation layer (`usePurchaseOrdersData`) and the create payload builder (`usePOForm.handleCreate`) are **kept intact**. New work: a `useCreatePoWizard` hook (step state + can-advance gate + due-date preview + localStorage draft, modeled on `ContractCreatePage`'s `useDraftStorage` + auto-save), a small pure `poTotals.ts` calculator (the single source of truth for the breakdown, mirroring `po-lifecycle.service.ts.create()`), and a rebuilt `CreatePOModal` that renders 4 step panels + a stepper (reusing `ContractCreatePage`'s `StepIndicator` pattern). The VAT/net math already in `usePOForm` (`Math.round(subtotalAfterDiscount * 0.07 * 100) / 100`) is extracted into `poTotals.ts` so the wizard and the payload builder compute from one place.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind + shadcn/ui + Radix + lucide (`apps/web`); `@tanstack/react-query` + `@/lib/api`; vitest + RTL for unit tests; manual desktop verification for UI.

**Spec:** `docs/superpowers/specs/2026-06-29-purchasing-receiving-ux-v2-design.md`

## Global Constraints

- **RED LINE — no accounting/finance:** introduce **NO** import of any accounting/finance/journal/expense/tax module into `purchase-orders` (frontend or backend). This batch is **frontend-only** under `apps/web/src/pages/PurchaseOrdersPage/**` — it touches **zero** backend code, **zero** schema, **zero** money-posting paths. Do not touch `trade-in` or `Product.ownedByCompanyId`; receiving stays JE-free.
- **Additive only:** the `POST /purchase-orders` contract (`CreatePODto` — see `apps/api/src/modules/purchase-orders/dto/create-po.dto.ts:42`) is **unchanged**. The wizard MUST POST the exact same payload `usePOForm.handleCreate` posts today (`usePOForm.ts:94-119`). No new request fields.
- **Frontend rules (`.claude/rules/frontend.md`):**
  - Data: `useQuery`/`useMutation` from `@tanstack/react-query` + `api` from `@/lib/api` only — **no** raw `fetch`/`axios`. (This batch reuses the existing `createMutation`/`suppliers` query; no new network calls.)
  - UI: shadcn/ui + Radix + Tailwind + `lucide-react` only. No other component libs.
  - **Design tokens only** — no hardcoded gray/hex; no `text-gray-*`/`bg-gray-*`; **no `bg-white`** (except print/receipt — not applicable here). Use `bg-background`/`bg-card`/`bg-muted`, `text-foreground`/`text-muted-foreground`, `border-border`, `hover:bg-accent`, `text-primary`/`text-destructive`/`text-success`/`text-warning`.
  - **Thai UI text uses `leading-snug`** (never `leading-none`).
  - Routes lazy-loaded (PurchaseOrdersPage already is — no change needed).
  - `toast.*` from `sonner` for notifications; no `alert()`/`confirm()`.
  - `useDebounce` for any search input (the supplier picker `ContactCombobox` already debounces internally — reuse it, do not add another).
- **Money = Decimal precision parity:** the frontend can only use JS `number`, so the breakdown calculator MUST reproduce the backend's exact rounding: VAT = `subtotalAfterDiscount × vatRate` rounded **HALF_UP to 2 dp**, applied **only if `supplier.hasVat`**; net = `subtotalAfterDiscount + vatAmount − discountAfterVat`. This is what `po-lifecycle.service.ts:53-66` does with `Prisma.Decimal` + `ROUND_HALF_UP`, and what `usePOForm.ts:122-132` already does with `Math.round(x*100)/100` (which equals HALF_UP for the satang place). Keep `0.07` as the client-side rate to match `usePOForm` today (documented deviation — see Self-Review).
- **Reuse, don't reinvent:** `StepIndicator` pattern from `ContractCreatePage/components/StepIndicator.tsx`; the draft pattern from `hooks/useDraftStorage.ts` + the auto-save/recover wiring in `ContractCreatePage/hooks/useContractCreateData.ts:62-94`; `ContactCombobox` for supplier pick + inline create; `ThaiDateInput`; `formatNumberDecimal`/`formatDateShort` from `@/utils/formatters`; product catalog helpers `brands`/`getModels`/`getModelInfo` from `@/data/productCatalog`.
- **Type gate:** `./tools/check-types.sh all` must report **0 errors** before each commit.

---

### Task 1: Extract the breakdown calculator `poTotals.ts` (single source of truth, mirrors backend)

Today the VAT/discount/net math lives inline in `usePOForm.ts:122-132`. Extract it into a pure, unit-tested function so the wizard's transparent breakdown (Step 3 + Step 4 review) and the payload-builder compute from **one** place that provably mirrors `po-lifecycle.service.ts.create()`.

**Files:**
- Create: `apps/web/src/pages/PurchaseOrdersPage/poTotals.ts`
- Create (test): `apps/web/src/pages/PurchaseOrdersPage/poTotals.test.ts`
- Modify: `apps/web/src/pages/PurchaseOrdersPage/hooks/usePOForm.ts` (lines 122-132 → call the new helper)

**Interfaces:**
- Produces:
  ```ts
  export interface PoTotalsInput {
    items: { quantity: string; unitPrice: string }[];
    discount: string;        // ส่วนลดก่อน VAT (raw form string)
    discountAfterVat: string; // ส่วนลดหลัง VAT (raw form string)
    supplierHasVat: boolean;
  }
  export interface PoTotals {
    subtotal: number;
    discountNum: number;            // clamped to subtotal
    subtotalAfterDiscount: number;
    vatAmount: number;              // HALF_UP 2dp, 0 if !hasVat
    totalWithVat: number;
    discountAfterVatNum: number;    // clamped to totalWithVat, 0 if !hasVat
    netAmount: number;
  }
  export const VAT_RATE = 0.07;
  export function computePoTotals(input: PoTotalsInput): PoTotals;
  ```
- Consumed by: `usePOForm` (Task 1), the wizard breakdown (Task 4), the review step (Task 5).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pages/PurchaseOrdersPage/poTotals.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computePoTotals } from './poTotals';

describe('computePoTotals — mirrors po-lifecycle.service.create()', () => {
  it('no-VAT supplier: net = subtotal - discount, no VAT line', () => {
    const t = computePoTotals({
      items: [{ quantity: '2', unitPrice: '1000' }, { quantity: '1', unitPrice: '500' }],
      discount: '300',
      discountAfterVat: '999', // must be ignored when !hasVat
      supplierHasVat: false,
    });
    expect(t.subtotal).toBe(2500);
    expect(t.discountNum).toBe(300);
    expect(t.subtotalAfterDiscount).toBe(2200);
    expect(t.vatAmount).toBe(0);
    expect(t.totalWithVat).toBe(2200);
    expect(t.discountAfterVatNum).toBe(0);
    expect(t.netAmount).toBe(2200);
  });

  it('VAT supplier: VAT = subtotalAfterDiscount * 0.07 ROUND_HALF_UP (half-satang rounds up)', () => {
    // 1050 * 0.07 = 73.5 -> HALF_UP -> 73.5 (exact); use a value that lands on a half-satang
    // 107.35 * 0.07 = 7.5145 -> 7.51 ; choose 100.50 -> 7.035 -> 7.04 (HALF_UP at 3rd dp 5)
    const t = computePoTotals({
      items: [{ quantity: '1', unitPrice: '100.50' }],
      discount: '0',
      discountAfterVat: '0',
      supplierHasVat: true,
    });
    expect(t.subtotalAfterDiscount).toBe(100.5);
    expect(t.vatAmount).toBe(7.04); // 7.035 rounds HALF_UP to 7.04
    expect(t.totalWithVat).toBe(107.54);
    expect(t.netAmount).toBe(107.54);
  });

  it('VAT supplier with both discounts: net = (sub-disc) + vat - discAfterVat', () => {
    const t = computePoTotals({
      items: [{ quantity: '10', unitPrice: '1000' }], // 10000
      discount: '1000',                                // -> 9000
      discountAfterVat: '500',
      supplierHasVat: true,
    });
    expect(t.subtotalAfterDiscount).toBe(9000);
    expect(t.vatAmount).toBe(630);        // 9000 * 0.07
    expect(t.totalWithVat).toBe(9630);
    expect(t.discountAfterVatNum).toBe(500);
    expect(t.netAmount).toBe(9130);
  });

  it('clamps discount to subtotal and discountAfterVat to totalWithVat', () => {
    const t = computePoTotals({
      items: [{ quantity: '1', unitPrice: '100' }],
      discount: '999',          // clamps to 100
      discountAfterVat: '999',  // clamps to totalWithVat
      supplierHasVat: true,
    });
    expect(t.discountNum).toBe(100);
    expect(t.subtotalAfterDiscount).toBe(0);
    expect(t.vatAmount).toBe(0);
    expect(t.totalWithVat).toBe(0);
    expect(t.discountAfterVatNum).toBe(0);
    expect(t.netAmount).toBe(0);
  });

  it('treats empty/NaN quantity & price as 0', () => {
    const t = computePoTotals({
      items: [{ quantity: '', unitPrice: '' }, { quantity: '2', unitPrice: '50' }],
      discount: '',
      discountAfterVat: '',
      supplierHasVat: false,
    });
    expect(t.subtotal).toBe(100);
    expect(t.netAmount).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/PurchaseOrdersPage/poTotals.test.ts`
Expected: FAIL — `Failed to resolve import './poTotals'`.

- [ ] **Step 3: Implement `poTotals.ts` (lifted verbatim from `usePOForm.ts:122-132`)**

Create `apps/web/src/pages/PurchaseOrdersPage/poTotals.ts`:

```ts
// Single source of truth for the PO money breakdown shown in the create wizard.
// Mirrors apps/api/src/modules/purchase-orders/services/po-lifecycle.service.ts
// create() EXACTLY: subtotal -> minus discount -> VAT = subtotalAfterDiscount *
// vatRate ROUND_HALF_UP (only when supplier.hasVat) -> minus discountAfterVat = net.
// Backend uses Prisma.Decimal + ROUND_HALF_UP; on the client Math.round(x*100)/100
// is HALF_UP at the satang place, matching usePOForm's prior inline math.

export const VAT_RATE = 0.07;

export interface PoTotalsInput {
  items: { quantity: string; unitPrice: string }[];
  discount: string;
  discountAfterVat: string;
  supplierHasVat: boolean;
}

export interface PoTotals {
  subtotal: number;
  discountNum: number;
  subtotalAfterDiscount: number;
  vatAmount: number;
  totalWithVat: number;
  discountAfterVatNum: number;
  netAmount: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computePoTotals({
  items,
  discount,
  discountAfterVat,
  supplierHasVat,
}: PoTotalsInput): PoTotals {
  const subtotal = items.reduce(
    (sum, i) => sum + Number(i.quantity || 0) * Number(i.unitPrice || 0),
    0,
  );
  const discountNum = Math.min(Number(discount) || 0, subtotal);
  const subtotalAfterDiscount = subtotal - discountNum;
  const vatAmount = supplierHasVat ? round2(subtotalAfterDiscount * VAT_RATE) : 0;
  const totalWithVat = subtotalAfterDiscount + vatAmount;
  const discountAfterVatNum = supplierHasVat
    ? Math.min(Number(discountAfterVat) || 0, totalWithVat)
    : 0;
  const netAmount = totalWithVat - discountAfterVatNum;
  return {
    subtotal,
    discountNum,
    subtotalAfterDiscount,
    vatAmount,
    totalWithVat,
    discountAfterVatNum,
    netAmount,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/pages/PurchaseOrdersPage/poTotals.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Make `usePOForm` consume the helper (no behavior change)**

In `apps/web/src/pages/PurchaseOrdersPage/hooks/usePOForm.ts`, add the import (after line 4 `import { emptyItem } ...`):

```ts
import { computePoTotals } from '../poTotals';
```

Replace the inline math block (current lines 122-132):

```ts
  const subtotal = items.reduce((sum, i) => sum + Number(i.quantity || 0) * Number(i.unitPrice || 0), 0);
  const selectedSupplier = suppliers.find((s) => s.id === form.supplierId);
  const supplierHasVat = selectedSupplier?.hasVat ?? false;
  const discountNum = Math.min(Number(form.discount) || 0, subtotal);
  const subtotalAfterDiscount = subtotal - discountNum;
  const vatAmount = supplierHasVat ? Math.round(subtotalAfterDiscount * 0.07 * 100) / 100 : 0;
  const totalWithVat = subtotalAfterDiscount + vatAmount;
  const discountAfterVatNum = supplierHasVat
    ? Math.min(Number(form.discountAfterVat) || 0, totalWithVat)
    : 0;
  const netAmount = totalWithVat - discountAfterVatNum;
```

with:

```ts
  const selectedSupplier = suppliers.find((s) => s.id === form.supplierId);
  const supplierHasVat = selectedSupplier?.hasVat ?? false;
  const {
    subtotal,
    discountNum,
    subtotalAfterDiscount,
    vatAmount,
    totalWithVat,
    discountAfterVatNum,
    netAmount,
  } = computePoTotals({
    items,
    discount: form.discount,
    discountAfterVat: form.discountAfterVat,
    supplierHasVat,
  });
```

(The returned object at `usePOForm.ts:134-158` already destructures these same names — leave it unchanged. `handleCreate`'s payload at lines 94-119 is also unchanged.)

- [ ] **Step 6: Type-check**

Run: `./tools/check-types.sh all`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/PurchaseOrdersPage/poTotals.ts apps/web/src/pages/PurchaseOrdersPage/poTotals.test.ts apps/web/src/pages/PurchaseOrdersPage/hooks/usePOForm.ts
git commit -m "refactor(purchasing): extract computePoTotals breakdown calculator (mirrors backend VAT/net)"
```

---

### Task 2: Wizard state hook `useCreatePoWizard` — step gate + due-date preview + auto-save draft

Add a focused hook that owns the wizard's step index, the per-step can-advance gate, the credit-term-driven due-date preview, and the localStorage draft (save/load/clear), modeled on `ContractCreatePage/hooks/useContractCreateData.ts:62-94` + `hooks/useDraftStorage.ts`. It is **layered on top of** `usePOForm` (consumes its `form`/`items`/`selectedSupplier`/`netAmount`/`resetForm`) — it does not duplicate the create logic.

**Files:**
- Create: `apps/web/src/pages/PurchaseOrdersPage/hooks/useCreatePoWizard.ts`
- Create (test): `apps/web/src/pages/PurchaseOrdersPage/hooks/useCreatePoWizard.test.ts`

**Interfaces:**
- Consumes (from `usePOForm` return + props):
  ```ts
  interface UseCreatePoWizardOptions {
    isOpen: boolean;
    form: { supplierId: string; orderDate: string; expectedDate: string; discount: string; discountAfterVat: string; notes: string; paymentStatus: string; paymentMethod: string; paidAmount: string; paymentNotes: string };
    setForm: React.Dispatch<React.SetStateAction<UseCreatePoWizardOptions['form']>>;
    items: ItemForm[];
    setItems: React.Dispatch<React.SetStateAction<ItemForm[]>>;
    selectedSupplier: { id: string; name: string; hasVat: boolean; paymentMethods: { paymentMethod: string; creditTermDays?: number; isDefault: boolean }[] } | undefined;
  }
  ```
- Produces:
  ```ts
  interface CreatePoWizardApi {
    step: number;                 // 0..3
    goToStep: (s: number) => void;
    next: () => void;
    back: () => void;
    canNext: boolean;             // gate for current step
    dueDatePreview: Date | null;  // orderDate + selected/default creditTermDays
    creditTermDays: number | null;
    draftRecovered: boolean;
    clearDraft: () => void;
  }
  export const WIZARD_STEPS: string[]; // ['เลือกผู้ขาย','เพิ่มรายการ','ส่วนลด/VAT','ทบทวน+บันทึก']
  export function useCreatePoWizard(opts: UseCreatePoWizardOptions): CreatePoWizardApi;
  ```
- Uses a **new** draft key `bestchoice-po-draft` (do NOT reuse the contract key `bestchoice-contract-draft`).

- [ ] **Step 1: Write the failing test (pure due-date + step-gate logic via a thin wrapper)**

The due-date + step-gate logic is the load-bearing part; test it directly with `@testing-library/react`'s `renderHook`. Create `apps/web/src/pages/PurchaseOrdersPage/hooks/useCreatePoWizard.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCreatePoWizard } from './useCreatePoWizard';
import type { ItemForm } from '../types';

const baseItem: ItemForm = { brand: 'Apple', category: 'PHONE_NEW', model: 'iPhone 16', color: '', storage: '', quantity: '2', unitPrice: '30000', accessoryType: '', accessoryBrand: '' };

function makeOpts(overrides: Partial<Parameters<typeof useCreatePoWizard>[0]> = {}) {
  const form = {
    supplierId: 's1', orderDate: '2026-07-01', expectedDate: '', discount: '', discountAfterVat: '',
    notes: '', paymentStatus: 'UNPAID', paymentMethod: '', paidAmount: '', paymentNotes: '',
  };
  return {
    isOpen: true,
    form,
    setForm: vi.fn(),
    items: [baseItem],
    setItems: vi.fn(),
    selectedSupplier: { id: 's1', name: 'ผู้ขาย ก', hasVat: true, paymentMethods: [{ paymentMethod: 'CREDIT', creditTermDays: 30, isDefault: true }] },
    ...overrides,
  } as Parameters<typeof useCreatePoWizard>[0];
}

describe('useCreatePoWizard', () => {
  beforeEach(() => localStorage.clear());

  it('step 0 (supplier) gate: requires a supplierId', () => {
    const { result, rerender } = renderHook((p) => useCreatePoWizard(p), { initialProps: makeOpts({ selectedSupplier: undefined, form: { ...makeOpts().form, supplierId: '' } }) });
    expect(result.current.step).toBe(0);
    expect(result.current.canNext).toBe(false);
    rerender(makeOpts()); // now supplier selected
    expect(result.current.canNext).toBe(true);
  });

  it('step 1 (items) gate: every item needs category, quantity>0, unitPrice>0', () => {
    const { result, rerender } = renderHook((p) => useCreatePoWizard(p), { initialProps: makeOpts() });
    act(() => result.current.next()); // -> step 1
    expect(result.current.step).toBe(1);
    expect(result.current.canNext).toBe(true);
    rerender(makeOpts({ items: [{ ...baseItem, unitPrice: '' }] }));
    expect(result.current.canNext).toBe(false);
  });

  it('computes dueDatePreview = orderDate + default creditTermDays', () => {
    const { result } = renderHook((p) => useCreatePoWizard(p), { initialProps: makeOpts() });
    expect(result.current.creditTermDays).toBe(30);
    // 2026-07-01 + 30 days = 2026-07-31
    expect(result.current.dueDatePreview?.toISOString().slice(0, 10)).toBe('2026-07-31');
  });

  it('dueDatePreview follows the selected paymentMethod credit term', () => {
    const opts = makeOpts({
      form: { ...makeOpts().form, paymentMethod: 'CASH' },
      selectedSupplier: { id: 's1', name: 'ก', hasVat: true, paymentMethods: [
        { paymentMethod: 'CASH', creditTermDays: 0, isDefault: false },
        { paymentMethod: 'CREDIT', creditTermDays: 45, isDefault: true },
      ] },
    });
    const { result } = renderHook((p) => useCreatePoWizard(p), { initialProps: opts });
    expect(result.current.creditTermDays).toBe(0); // CASH selected -> no credit term
    expect(result.current.dueDatePreview).toBeNull();
  });

  it('saves a draft to localStorage and recovers it on a fresh mount', () => {
    const setForm = vi.fn();
    const setItems = vi.fn();
    const { unmount } = renderHook((p) => useCreatePoWizard(p), { initialProps: makeOpts() });
    // force an immediate save (the hook saves on form/items/step change, debounced via effect)
    expect(localStorage.getItem('bestchoice-po-draft')).not.toBeNull();
    unmount();
    const { result } = renderHook((p) => useCreatePoWizard(p), { initialProps: makeOpts({ setForm, setItems }) });
    expect(result.current.draftRecovered).toBe(true);
    expect(setForm).toHaveBeenCalled();
    expect(setItems).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/PurchaseOrdersPage/hooks/useCreatePoWizard.test.ts`
Expected: FAIL — cannot resolve `./useCreatePoWizard`.

- [ ] **Step 3: Implement the hook**

Create `apps/web/src/pages/PurchaseOrdersPage/hooks/useCreatePoWizard.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { formatDateShort } from '@/utils/formatters';
import type { ItemForm } from '../types';

export const WIZARD_STEPS = ['เลือกผู้ขาย', 'เพิ่มรายการ', 'ส่วนลด/VAT', 'ทบทวน+บันทึก'];
const LAST_STEP = WIZARD_STEPS.length - 1;

const DRAFT_KEY = 'bestchoice-po-draft';
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24h, matches the contract-draft TTL

type WizardForm = {
  supplierId: string; orderDate: string; expectedDate: string; discount: string;
  discountAfterVat: string; notes: string; paymentStatus: string; paymentMethod: string;
  paidAmount: string; paymentNotes: string;
};

interface PoDraft {
  step: number;
  form: WizardForm;
  items: ItemForm[];
  savedAt: string;
}

export interface UseCreatePoWizardOptions {
  isOpen: boolean;
  form: WizardForm;
  setForm: React.Dispatch<React.SetStateAction<WizardForm>>;
  items: ItemForm[];
  setItems: React.Dispatch<React.SetStateAction<ItemForm[]>>;
  selectedSupplier:
    | { id: string; name: string; hasVat: boolean; paymentMethods: { paymentMethod: string; creditTermDays?: number; isDefault: boolean }[] }
    | undefined;
}

export interface CreatePoWizardApi {
  step: number;
  goToStep: (s: number) => void;
  next: () => void;
  back: () => void;
  canNext: boolean;
  dueDatePreview: Date | null;
  creditTermDays: number | null;
  draftRecovered: boolean;
  clearDraft: () => void;
}

export function useCreatePoWizard(opts: UseCreatePoWizardOptions): CreatePoWizardApi {
  const { isOpen, form, setForm, items, setItems, selectedSupplier } = opts;
  const [step, setStep] = useState(0);
  const [draftRecovered, setDraftRecovered] = useState(false);
  const recoveredRef = useRef(false);

  const clearDraft = useCallback(() => {
    localStorage.removeItem(DRAFT_KEY);
  }, []);

  // Restore draft once per open
  useEffect(() => {
    if (!isOpen || recoveredRef.current) return;
    recoveredRef.current = true;
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw) as PoDraft;
      if (new Date().getTime() - new Date(draft.savedAt).getTime() > DRAFT_TTL_MS) {
        localStorage.removeItem(DRAFT_KEY);
        return;
      }
      setForm(draft.form);
      setItems(draft.items);
      setStep(draft.step);
      setDraftRecovered(true);
      toast('พบใบสั่งซื้อร่างที่บันทึกไว้ — กู้คืนแล้ว', {
        description: `บันทึกเมื่อ ${new Date(draft.savedAt).toLocaleString('th-TH')}`,
        duration: 5000,
      });
    } catch {
      localStorage.removeItem(DRAFT_KEY);
    }
  }, [isOpen, setForm, setItems]);

  // Reset recovery latch when the modal closes so reopening recovers again
  useEffect(() => {
    if (!isOpen) {
      recoveredRef.current = false;
      setDraftRecovered(false);
      setStep(0);
    }
  }, [isOpen]);

  // Auto-save: persist on every form/items/step change while open (only if there is content)
  useEffect(() => {
    if (!isOpen) return;
    const hasContent = !!form.supplierId || items.some((i) => i.category || i.unitPrice);
    if (!hasContent) return;
    const draft: PoDraft = { step, form, items, savedAt: new Date().toISOString() };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [isOpen, step, form, items]);

  // Credit-term-driven due-date preview (mirrors po-lifecycle.service.create():69-77)
  const selectedPm = form.paymentMethod
    ? selectedSupplier?.paymentMethods.find((pm) => pm.paymentMethod === form.paymentMethod)
    : selectedSupplier?.paymentMethods.find((pm) => pm.isDefault) ?? selectedSupplier?.paymentMethods[0];
  const creditTermDays = selectedPm?.creditTermDays ?? null;
  let dueDatePreview: Date | null = null;
  if (creditTermDays && form.orderDate) {
    const dd = new Date(form.orderDate);
    if (!Number.isNaN(dd.getTime())) {
      dd.setDate(dd.getDate() + creditTermDays);
      dueDatePreview = dd;
    }
  }

  // Per-step advance gate
  const itemsValid = items.length > 0 && items.every(
    (i) => i.category && Number(i.quantity) > 0 && Number(i.unitPrice) > 0,
  );
  const canNext =
    step === 0 ? !!form.supplierId :
    step === 1 ? itemsValid :
    true; // steps 2 & 3 are always advanceable (3 = submit handled by the form)

  const goToStep = useCallback((s: number) => {
    if (s >= 0 && s <= LAST_STEP) setStep(s);
  }, []);
  const next = useCallback(() => setStep((s) => Math.min(s + 1, LAST_STEP)), []);
  const back = useCallback(() => setStep((s) => Math.max(s - 1, 0)), []);

  // formatDateShort referenced so callers may render the preview consistently;
  // exported preview is a Date so the panel can choose its own formatting.
  void formatDateShort;

  return { step, goToStep, next, back, canNext, dueDatePreview, creditTermDays, draftRecovered, clearDraft };
}
```

> Note: the `void formatDateShort;` line keeps the import available for the panel components without an unused-import error here; remove it if you prefer to import `formatDateShort` only in Task 3's panel. Either is fine — the panels (Task 3/5) will format `dueDatePreview` with `formatDateShort`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/pages/PurchaseOrdersPage/hooks/useCreatePoWizard.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Type-check + commit**

```bash
./tools/check-types.sh all
git add apps/web/src/pages/PurchaseOrdersPage/hooks/useCreatePoWizard.ts apps/web/src/pages/PurchaseOrdersPage/hooks/useCreatePoWizard.test.ts
git commit -m "feat(purchasing): useCreatePoWizard — step gate, due-date preview, localStorage draft"
```

---

### Task 3: Step panels 1 & 2 — Supplier (with due-date preview) + Items (with running subtotal)

Split the modal body into per-step panel components so the wizard renders one panel at a time. This task builds the **Supplier** panel (step 0) and the **Items** panel (step 1). Both lift their JSX from the existing `CreatePOModal.tsx` Section 1 (lines 106-169) and Section 2 (lines 171-451) so visuals/validation stay identical; the only additions are the **due-date preview** (step 0) and the **running subtotal footer** (step 1).

**Files:**
- Create: `apps/web/src/pages/PurchaseOrdersPage/components/wizard/StepSupplier.tsx`
- Create: `apps/web/src/pages/PurchaseOrdersPage/components/wizard/StepItems.tsx`

**Interfaces:**
- `StepSupplier` props:
  ```ts
  interface StepSupplierProps {
    form: CreatePOModalProps['form'];
    setForm: CreatePOModalProps['setForm'];
    suppliersLoading: boolean;
    suppliersError: boolean;
    selectedSupplier: CreatePOModalProps['selectedSupplier'];
    onSupplierSelect: CreatePOModalProps['onSupplierSelect'];
    supplierHasVat: boolean;
    creditTermDays: number | null;
    dueDatePreview: Date | null;
    inputClass: string;
  }
  ```
- `StepItems` props:
  ```ts
  interface StepItemsProps {
    items: ItemForm[];
    setItems: React.Dispatch<React.SetStateAction<ItemForm[]>>;
    addItem: () => void;
    removeItem: (idx: number) => void;
    updateItem: (idx: number, field: string, value: string) => void;
    toggleModel: (idx: number, modelName: string) => void;
    subtotal: number;
    selectClass: string;
    inputClass: string;
  }
  ```
  (`CreatePOModalProps` is the existing exported interface in `CreatePOModal.tsx:9`; reuse its member types via `CreatePOModalProps['form']` etc. — do not redeclare them.)

- [ ] **Step 1: Create `StepSupplier.tsx`**

Lift Section 1 JSX from `CreatePOModal.tsx:106-169` verbatim (the supplier card: `ContactCombobox` + VAT badge + payment-method badge + orderDate/expectedDate `ThaiDateInput`s), then append a due-date preview block. Create the file:

```tsx
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { ContactCombobox } from '@/components/contacts/ContactCombobox';
import { formatDateShort } from '@/utils/formatters';
import type { CreatePOModalProps } from '../CreatePOModal';

interface StepSupplierProps {
  form: CreatePOModalProps['form'];
  setForm: CreatePOModalProps['setForm'];
  suppliersLoading: boolean;
  suppliersError: boolean;
  selectedSupplier: CreatePOModalProps['selectedSupplier'];
  onSupplierSelect: CreatePOModalProps['onSupplierSelect'];
  supplierHasVat: boolean;
  creditTermDays: number | null;
  dueDatePreview: Date | null;
  inputClass: string;
}

export function StepSupplier({
  form, setForm, suppliersLoading, suppliersError, selectedSupplier,
  onSupplierSelect, supplierHasVat, creditTermDays, dueDatePreview, inputClass,
}: StepSupplierProps) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="flex items-center justify-center size-8 rounded-lg bg-success/10 text-success">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground leading-snug">ข้อมูลผู้จัดจำหน่าย</h3>
          <p className="text-xs text-muted-foreground leading-snug">เลือกผู้จัดจำหน่ายและวันที่สั่งซื้อ</p>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ผู้จัดจำหน่าย <span className="text-destructive">*</span></label>
          <ContactCombobox
            roleNeeded="SUPPLIER"
            value={selectedSupplier?.name ?? (suppliersLoading ? 'กำลังโหลด...' : '')}
            onSelect={onSupplierSelect}
            invalid={!form.supplierId && suppliersError}
            placeholder="เลือก/ค้นหาผู้จัดจำหน่าย"
          />
          <input type="hidden" value={form.supplierId} />
          {selectedSupplier && (
            <div className="mt-1 flex gap-2 flex-wrap">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium leading-snug ${supplierHasVat ? 'bg-primary/10 text-primary dark:bg-primary/15' : 'bg-muted text-muted-foreground'}`}>
                {supplierHasVat ? 'ผู้จัดจำหน่ายมี VAT - จะคำนวณ VAT 7% อัตโนมัติ' : 'ผู้จัดจำหน่ายไม่มี VAT'}
              </span>
              {selectedSupplier.paymentMethods?.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium leading-snug bg-primary/10 text-primary">
                  ชำระ: {selectedSupplier.paymentMethods.map((pm) => {
                    const labels: Record<string, string> = { CASH: 'เงินสด', BANK_TRANSFER: 'โอนธนาคาร', CHECK: 'เช็ค', CREDIT: 'เครดิต' };
                    return labels[pm.paymentMethod] || pm.paymentMethod;
                  }).join(', ')}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">วันที่สั่ง <span className="text-destructive">*</span></label>
            <ThaiDateInput value={form.orderDate} onChange={(e) => setForm({ ...form, orderDate: e.target.value })} className={inputClass} required />
          </div>
          <div>
            <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">วันที่คาดรับสินค้า</label>
            <ThaiDateInput value={form.expectedDate} onChange={(e) => setForm({ ...form, expectedDate: e.target.value })} className={inputClass} />
          </div>
        </div>

        {/* Due-date preview (credit-term driven) */}
        {selectedSupplier && (
          <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm leading-snug">
            {creditTermDays && dueDatePreview ? (
              <span className="text-foreground">
                เครดิต <span className="font-semibold">{creditTermDays}</span> วัน → ครบกำหนดชำระ{' '}
                <span className="font-semibold text-primary">{formatDateShort(dueDatePreview)}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">ไม่มีเครดิต (ชำระทันที) — ไม่มีวันครบกำหนด</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `StepItems.tsx`**

Lift Section 2 JSX from `CreatePOModal.tsx:171-451` verbatim (the items card: header with "+ เพิ่มรายการ", the `items.map(...)` block with all the category/brand/model/accessory/color/storage/quantity/unitPrice fields). Add a running-subtotal footer at the bottom. Because the inner per-item JSX is large and already correct, copy it exactly; only the wrapper header text and the appended footer differ. Create the file:

```tsx
import { brands, getModels, getModelInfo } from '@/data/productCatalog';
import { accessoryTypes, chargerConnectorTypes } from '../../constants';
import { formatNumberDecimal } from '@/utils/formatters';
import type { ItemForm } from '../../types';

interface StepItemsProps {
  items: ItemForm[];
  setItems: React.Dispatch<React.SetStateAction<ItemForm[]>>;
  addItem: () => void;
  removeItem: (idx: number) => void;
  updateItem: (idx: number, field: string, value: string) => void;
  toggleModel: (idx: number, modelName: string) => void;
  subtotal: number;
  selectClass: string;
  inputClass: string;
}

export function StepItems({
  items, setItems, addItem, removeItem, updateItem, toggleModel, subtotal, selectClass, inputClass,
}: StepItemsProps) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground leading-snug">รายการสินค้า</h3>
          <p className="text-xs text-muted-foreground leading-snug">เพิ่มสินค้าที่ต้องการสั่งซื้อ</p>
        </div>
        <button type="button" onClick={addItem} className="text-sm text-primary hover:text-primary/90 font-medium">
          + เพิ่มรายการ
        </button>
      </div>

      <div className="space-y-4">
        {/* PASTE the items.map(...) block VERBATIM from CreatePOModal.tsx lines 187-449.
            It already uses brands/getModels/getModelInfo/accessoryTypes/chargerConnectorTypes,
            selectClass/inputClass, updateItem/removeItem/toggleModel/setItems — all now provided
            as props/imports above. Do not change its logic; copy it exactly. */}
      </div>

      {/* Running subtotal footer (new) */}
      <div className="mt-4 flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2.5">
        <span className="text-sm text-muted-foreground leading-snug">
          รวม {items.length} รายการ · {items.reduce((n, i) => n + (Number(i.quantity) || 0), 0)} ชิ้น
        </span>
        <span className="text-base font-semibold text-foreground tabular-nums font-mono">
          {formatNumberDecimal(subtotal, 2)} บาท
        </span>
      </div>
    </div>
  );
}
```

> Implementation note: when you paste the `items.map(...)` block, keep every line from `CreatePOModal.tsx:187` (`{items.map((item, idx) => {`) through `:449` (`})}`) unchanged. The only allowed edit is adding `leading-snug` to any Thai-text `<h3>/<p>/<label>/<span>` that lacks it (per the frontend rule). All referenced identifiers (`item`, `isAccessory`, `isCharger`, `availableModels`, `modelInfo`, `availableColors`, `availableStorage`, `selectedModels`, `accessoryAutoName`) are defined inside that block — copy them as-is.

- [ ] **Step 3: Type-check**

These panels aren't wired yet (Task 6 wires them), but they must compile. Run: `./tools/check-types.sh all`
Expected: 0 errors. (If `CreatePOModalProps` is not yet exported, it already is — `CreatePOModal.tsx:9` declares `export interface CreatePOModalProps`.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/PurchaseOrdersPage/components/wizard/StepSupplier.tsx apps/web/src/pages/PurchaseOrdersPage/components/wizard/StepItems.tsx
git commit -m "feat(purchasing): wizard StepSupplier (due-date preview) + StepItems (running subtotal)"
```

---

### Task 4: Step panel 3 — transparent ส่วนลด/VAT breakdown (`StepDiscountVat`)

Build the discount/VAT step as a **transparent, line-by-line breakdown** that shows exactly how net is derived, computed from `computePoTotals` (Task 1) so the numbers provably match the backend. Lift the summary JSX from `CreatePOModal.tsx` Section 3 (lines 453-533) and make every intermediate line explicit (subtotal → discount → subtotalAfterDiscount → VAT 7% → totalWithVat → discountAfterVat → net), with a one-line "วิธีคำนวณ" explainer.

**Files:**
- Create: `apps/web/src/pages/PurchaseOrdersPage/components/wizard/StepDiscountVat.tsx`

**Interfaces:**
- Props:
  ```ts
  interface StepDiscountVatProps {
    form: CreatePOModalProps['form'];
    setForm: CreatePOModalProps['setForm'];
    supplierHasVat: boolean;
    totals: PoTotals; // from computePoTotals (Task 1)
  }
  ```

- [ ] **Step 1: Create `StepDiscountVat.tsx`**

```tsx
import { formatNumberDecimal } from '@/utils/formatters';
import type { CreatePOModalProps } from '../CreatePOModal';
import type { PoTotals } from '../../poTotals';

interface StepDiscountVatProps {
  form: CreatePOModalProps['form'];
  setForm: CreatePOModalProps['setForm'];
  supplierHasVat: boolean;
  totals: PoTotals;
}

const baht = (n: number) => `${formatNumberDecimal(n, 2)} บาท`;
const discountInput =
  'w-36 px-2 py-1 border border-input rounded text-sm text-right tabular-nums font-mono focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';

export function StepDiscountVat({ form, setForm, supplierHasVat, totals }: StepDiscountVatProps) {
  const { subtotal, discountNum, subtotalAfterDiscount, vatAmount, totalWithVat, discountAfterVatNum, netAmount } = totals;
  return (
    <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground leading-snug">ส่วนลด และ VAT</h3>
          <p className="text-xs text-muted-foreground leading-snug">
            {supplierHasVat ? 'คำนวณ VAT 7% หลังหักส่วนลด แล้วจึงหักส่วนลดหลัง VAT' : 'ผู้จัดจำหน่ายไม่มี VAT'}
          </p>
        </div>
      </div>

      <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
        {/* 1. subtotal */}
        <div className="flex justify-between">
          <span className="text-muted-foreground leading-snug">มูลค่าสินค้า{supplierHasVat ? ' (ก่อน VAT)' : ''}</span>
          <span className="font-medium tabular-nums font-mono">{baht(subtotal)}</span>
        </div>

        {/* 2. discount before VAT (editable) */}
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground leading-snug">หัก ส่วนลด{supplierHasVat ? ' (ก่อน VAT)' : ''}</span>
          <input
            type="number" min="0" placeholder="0" value={form.discount}
            onChange={(e) => setForm({ ...form, discount: e.target.value })}
            className={discountInput}
          />
        </div>

        {/* 3. subtotalAfterDiscount */}
        <div className="flex justify-between border-t border-border/60 pt-2">
          <span className="text-muted-foreground leading-snug">= มูลค่าหลังหักส่วนลด</span>
          <span className="tabular-nums font-mono">{baht(subtotalAfterDiscount)}</span>
        </div>

        {supplierHasVat && (
          <>
            {/* 4. VAT */}
            <div className="flex justify-between">
              <span className="text-muted-foreground leading-snug">+ VAT 7% (ปัดเศษขึ้นครึ่งสตางค์)</span>
              <span className="tabular-nums font-mono">{baht(vatAmount)}</span>
            </div>
            {/* 5. totalWithVat */}
            <div className="flex justify-between border-t border-border/60 pt-2">
              <span className="text-muted-foreground leading-snug">= มูลค่ารวม VAT</span>
              <span className="tabular-nums font-mono">{baht(totalWithVat)}</span>
            </div>
            {/* 6. discount after VAT (editable) */}
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground leading-snug">หัก ส่วนลด (หลัง VAT)</span>
              <input
                type="number" min="0" placeholder="0" value={form.discountAfterVat}
                onChange={(e) => setForm({ ...form, discountAfterVat: e.target.value })}
                className={discountInput}
              />
            </div>
          </>
        )}

        {/* 7. net */}
        <div className="flex justify-between border-t-2 border-border pt-2.5 mt-1 font-semibold text-base">
          <span className="leading-snug">ยอดสุทธิ</span>
          <span className="text-primary tabular-nums font-mono">{baht(netAmount)}</span>
        </div>

        {/* explainer */}
        <p className="text-2xs text-muted-foreground leading-snug pt-1">
          {supplierHasVat
            ? `วิธีคิด: (${formatNumberDecimal(subtotal, 2)} − ${formatNumberDecimal(discountNum, 2)}) × 1.07 − ${formatNumberDecimal(discountAfterVatNum, 2)} = ${formatNumberDecimal(netAmount, 2)} บาท`
            : `วิธีคิด: ${formatNumberDecimal(subtotal, 2)} − ${formatNumberDecimal(discountNum, 2)} = ${formatNumberDecimal(netAmount, 2)} บาท`}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `./tools/check-types.sh all`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/PurchaseOrdersPage/components/wizard/StepDiscountVat.tsx
git commit -m "feat(purchasing): wizard StepDiscountVat — transparent VAT/discount/net breakdown"
```

---

### Task 5: Step panel 4 — review + payment/attachments/notes (`StepReview`)

The final step shows a read-only summary of supplier + items + the breakdown, then keeps the **payment / attachments / notes** controls (lifted from `CreatePOModal.tsx` Section 4 lines 535-627, Section 5 lines 629-707, and the Notes block lines 709-726) so nothing the owner uses today is lost. The "สร้าง PO" submit button lives in the wizard footer (Task 6), not here.

**Files:**
- Create: `apps/web/src/pages/PurchaseOrdersPage/components/wizard/StepReview.tsx`

**Interfaces:**
- Props:
  ```ts
  interface StepReviewProps {
    form: CreatePOModalProps['form'];
    setForm: CreatePOModalProps['setForm'];
    items: ItemForm[];
    selectedSupplier: CreatePOModalProps['selectedSupplier'];
    supplierHasVat: boolean;
    totals: PoTotals;
    dueDatePreview: Date | null;
    attachmentUrl: string;
    setAttachmentUrl: (v: string) => void;
    formAttachments: string[];
    setFormAttachments: React.Dispatch<React.SetStateAction<string[]>>;
    selectClass: string;
    inputClass: string;
  }
  ```

- [ ] **Step 1: Create `StepReview.tsx`**

Build the read-only summary card first, then paste the existing Payment (Section 4), Attachments (Section 5), and Notes blocks verbatim from `CreatePOModal.tsx:535-726` (they reference `form`/`setForm`/`selectedSupplier`/`netAmount`/`attachmentUrl`/`setAttachmentUrl`/`formAttachments`/`setFormAttachments`/`selectClass`/`inputClass` — all provided as props; use `totals.netAmount` wherever the original used `netAmount`). Create the file:

```tsx
import { formatNumberDecimal, formatDateShort } from '@/utils/formatters';
import type { CreatePOModalProps } from '../CreatePOModal';
import type { ItemForm } from '../../types';
import type { PoTotals } from '../../poTotals';

interface StepReviewProps {
  form: CreatePOModalProps['form'];
  setForm: CreatePOModalProps['setForm'];
  items: ItemForm[];
  selectedSupplier: CreatePOModalProps['selectedSupplier'];
  supplierHasVat: boolean;
  totals: PoTotals;
  dueDatePreview: Date | null;
  attachmentUrl: string;
  setAttachmentUrl: (v: string) => void;
  formAttachments: string[];
  setFormAttachments: React.Dispatch<React.SetStateAction<string[]>>;
  selectClass: string;
  inputClass: string;
}

const baht = (n: number) => `${formatNumberDecimal(n, 2)} บาท`;

function itemLabel(i: ItemForm): string {
  if (i.category === 'ACCESSORY') {
    const isCharger = i.accessoryType === 'ชุดชาร์จ';
    return isCharger
      ? [i.accessoryType, i.accessoryBrand, i.model].filter(Boolean).join(' ')
      : [i.accessoryType, i.accessoryBrand, i.model ? `สำหรับ ${i.model}` : ''].filter(Boolean).join(' ');
  }
  return [i.brand, i.model, i.color, i.storage].filter(Boolean).join(' ');
}

export function StepReview({
  form, setForm, items, selectedSupplier, supplierHasVat, totals, dueDatePreview,
  attachmentUrl, setAttachmentUrl, formAttachments, setFormAttachments, selectClass, inputClass,
}: StepReviewProps) {
  const netAmount = totals.netAmount;
  return (
    <div className="space-y-5">
      {/* Read-only summary */}
      <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm space-y-3">
        <h3 className="text-sm font-semibold text-foreground leading-snug">ทบทวนใบสั่งซื้อ</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-2xs text-muted-foreground uppercase tracking-wider leading-snug">ผู้จัดจำหน่าย</div>
            <div className="text-foreground leading-snug">{selectedSupplier?.name ?? '-'}</div>
          </div>
          <div>
            <div className="text-2xs text-muted-foreground uppercase tracking-wider leading-snug">วันที่สั่ง</div>
            <div className="text-foreground leading-snug">{form.orderDate ? formatDateShort(form.orderDate) : '-'}</div>
          </div>
          {dueDatePreview && (
            <div>
              <div className="text-2xs text-muted-foreground uppercase tracking-wider leading-snug">ครบกำหนดชำระ</div>
              <div className="text-foreground leading-snug">{formatDateShort(dueDatePreview)}</div>
            </div>
          )}
        </div>
        <div className="border-t border-border/60 pt-3 space-y-1.5">
          {items.map((i, idx) => (
            <div key={idx} className="flex justify-between text-sm">
              <span className="text-muted-foreground leading-snug">{itemLabel(i)} × {i.quantity || 0}</span>
              <span className="tabular-nums font-mono">{baht((Number(i.quantity) || 0) * (Number(i.unitPrice) || 0))}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-border/60 pt-3 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground leading-snug">มูลค่าสินค้า</span><span className="tabular-nums font-mono">{baht(totals.subtotal)}</span></div>
          {totals.discountNum > 0 && <div className="flex justify-between"><span className="text-muted-foreground leading-snug">ส่วนลด</span><span className="tabular-nums font-mono">−{baht(totals.discountNum)}</span></div>}
          {supplierHasVat && <div className="flex justify-between"><span className="text-muted-foreground leading-snug">VAT 7%</span><span className="tabular-nums font-mono">{baht(totals.vatAmount)}</span></div>}
          {totals.discountAfterVatNum > 0 && <div className="flex justify-between"><span className="text-muted-foreground leading-snug">ส่วนลด (หลัง VAT)</span><span className="tabular-nums font-mono">−{baht(totals.discountAfterVatNum)}</span></div>}
          <div className="flex justify-between border-t border-border pt-1.5 font-semibold text-base"><span className="leading-snug">ยอดสุทธิ</span><span className="text-primary tabular-nums font-mono">{baht(netAmount)}</span></div>
        </div>
      </div>

      {/* PASTE Section 4 (Payment) from CreatePOModal.tsx lines 535-627 VERBATIM here,
          replacing every `netAmount` reference with `netAmount` (already aliased to totals.netAmount above).
          Add leading-snug to any Thai <label>/<h3>/<p> missing it. */}

      {/* PASTE Section 5 (Attachments) from CreatePOModal.tsx lines 629-707 VERBATIM here
          (it is gated by `form.paymentStatus !== 'UNPAID'`). */}

      {/* PASTE the Notes block from CreatePOModal.tsx lines 709-726 VERBATIM here. */}
    </div>
  );
}
```

> Implementation note: the three pasted sections already use `selectClass`/`inputClass` (declared in `CreatePOModal.tsx:85-86`) and the props above. The Payment section's status `onChange` (lines 552-559) computes `Math.round(netAmount * 100) / 100` — that `netAmount` now resolves to the local `const netAmount = totals.netAmount`, so the behavior is identical. Do not alter the file/reader logic.

- [ ] **Step 2: Type-check**

Run: `./tools/check-types.sh all`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/PurchaseOrdersPage/components/wizard/StepReview.tsx
git commit -m "feat(purchasing): wizard StepReview — read-only summary + payment/attachments/notes"
```

---

### Task 6: Rebuild `CreatePOModal` as the 4-step wizard shell + wire the new hook

Replace the modal body (the 5 stacked sections) with: a header, a `StepIndicator`-style stepper, a single active step panel, and a footer whose buttons are step-aware (กลับ / ถัดไป on steps 0-2; ยกเลิก / สร้าง PO on step 3). Keep `CreatePOModalProps` shape **identical** so `index.tsx` (lines 166-196) needs only the two new props for the wizard hook output (added in Step 4 here). The submit still calls the unchanged `handleCreate`.

**Files:**
- Modify: `apps/web/src/pages/PurchaseOrdersPage/components/CreatePOModal.tsx` (replace body lines 88-746; keep the `CreatePOModalProps` interface and the `selectClass`/`inputClass` consts)
- Modify: `apps/web/src/pages/PurchaseOrdersPage/index.tsx` (instantiate `useCreatePoWizard`, pass its output to `CreatePOModal`, clear draft on success)

**Interfaces:**
- `CreatePOModalProps` gains (added to the existing interface at `CreatePOModal.tsx:9-50`):
  ```ts
    wizard: import('../hooks/useCreatePoWizard').CreatePoWizardApi;
    totals: import('../poTotals').PoTotals;
  ```
  (All other members stay exactly as today, so the panels can receive them.)

- [ ] **Step 1: Add `expectedDate` to the form member type + the two new props to `CreatePOModalProps`**

First, **fix a pre-existing type gap**: the `form` member of `CreatePOModalProps` (lines 12-23) is missing `expectedDate`, even though the actual `usePOForm` state has it (`usePOForm.ts:16,30`) and the original JSX reads `form.expectedDate` (`CreatePOModal.tsx:162`). It compiled before only because `setForm`/the spread tolerated the extra field; but `StepSupplier`/`StepReview` access `form.expectedDate` through the indexed type `CreatePOModalProps['form']`, and `useCreatePoWizard`'s `WizardForm` requires it — so without this fix Tasks 3/5/6 emit TS2339 / "missing property expectedDate". In `CreatePOModal.tsx`, add `expectedDate: string;` to the `form` object type (after `orderDate: string;` at line 14):

```ts
    orderDate: string;
    expectedDate: string;
```

Then, inside `export interface CreatePOModalProps { ... }`, add the two wizard props (after `setFormAttachments` at line 49):

```ts
  wizard: import('../hooks/useCreatePoWizard').CreatePoWizardApi;
  totals: import('../poTotals').PoTotals;
```

- [ ] **Step 2: Replace the imports + the component body**

Replace the top imports (lines 1-7) with:

```tsx
import { UseMutationResult } from '@tanstack/react-query';
import { Check, Users, Package, Calculator, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ItemForm } from '../types';
import type { ContactPickResult } from '@/components/contacts/ContactCombobox';
import { WIZARD_STEPS } from '../hooks/useCreatePoWizard';
import { StepSupplier } from './wizard/StepSupplier';
import { StepItems } from './wizard/StepItems';
import { StepDiscountVat } from './wizard/StepDiscountVat';
import { StepReview } from './wizard/StepReview';
```

(`brands/getModels/getModelInfo`, `accessoryTypes/chargerConnectorTypes`, `ThaiDateInput`, `ContactCombobox` are no longer used directly in this file — they moved into the panels. Keep `ContactPickResult` for the prop type. The `ItemForm` import stays.)

Then replace the function body (from `export function CreatePOModal({` at line 52 through the final `}` at line 747) with the wizard shell. Destructure the props (including the two new ones), keep `if (!isOpen) return null;` and the `selectClass`/`inputClass` consts, then render:

```tsx
export function CreatePOModal({
  isOpen, onClose, form, setForm, items, setItems, addItem, removeItem, updateItem, toggleModel,
  suppliersLoading, suppliersError, selectedSupplier, onSupplierSelect, supplierHasVat,
  subtotal, createMutation, handleCreate,
  attachmentUrl, setAttachmentUrl, formAttachments, setFormAttachments,
  wizard, totals,
}: CreatePOModalProps) {
  if (!isOpen) return null;

  const selectClass = 'w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';
  const inputClass = selectClass;

  const stepIcons = [Users, Package, Calculator, FileText];
  const { step, goToStep, next, back, canNext } = wizard;
  const isLast = step === WIZARD_STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8" role="dialog" aria-modal="true" aria-label="สร้างใบสั่งซื้อ">
      <div className="w-full max-w-3xl bg-background rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-4rem)]">

        {/* Header */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between shrink-0">
          <button type="button" onClick={onClose} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            ปิด
          </button>
          <h2 className="text-lg font-semibold text-foreground leading-snug">สร้างใบสั่งซื้อ</h2>
          <div className="w-16" />
        </div>

        {/* Stepper */}
        <div className="px-6 pt-4 shrink-0">
          <div className="flex items-center">
            {WIZARD_STEPS.map((label, i) => {
              const completed = i < step;
              const current = i === step;
              const clickable = i < step; // only go back to completed steps via the indicator
              const Icon = stepIcons[i] || Package;
              return (
                <div key={label} className="flex items-center flex-1 last:flex-none">
                  <button
                    type="button"
                    disabled={!clickable}
                    onClick={() => clickable && goToStep(i)}
                    className={cn('flex items-center gap-2 group', clickable ? 'cursor-pointer' : 'cursor-default')}
                  >
                    <div className={cn(
                      'size-8 rounded-lg flex items-center justify-center shrink-0 transition-all',
                      completed && 'bg-primary text-primary-foreground',
                      current && 'bg-primary text-primary-foreground ring-4 ring-primary/20',
                      !completed && !current && 'bg-muted text-muted-foreground',
                    )}>
                      {completed ? <Check className="size-4" strokeWidth={2.5} /> : <Icon className="size-4" />}
                    </div>
                    <div className={cn('text-sm font-medium leading-snug hidden sm:block', current ? 'text-foreground' : 'text-muted-foreground')}>
                      {label}
                    </div>
                  </button>
                  {i < WIZARD_STEPS.length - 1 && (
                    <div className="flex-1 mx-3 h-0.5 rounded-full bg-muted overflow-hidden">
                      <div className={cn('h-full rounded-full transition-all', i < step ? 'bg-primary w-full' : 'w-0')} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Active step panel */}
        <form onSubmit={handleCreate} className="flex-1 overflow-y-auto">
          <div className="p-6">
            {step === 0 && (
              <StepSupplier
                form={form} setForm={setForm}
                suppliersLoading={suppliersLoading} suppliersError={suppliersError}
                selectedSupplier={selectedSupplier} onSupplierSelect={onSupplierSelect}
                supplierHasVat={supplierHasVat}
                creditTermDays={wizard.creditTermDays} dueDatePreview={wizard.dueDatePreview}
                inputClass={inputClass}
              />
            )}
            {step === 1 && (
              <StepItems
                items={items} setItems={setItems} addItem={addItem} removeItem={removeItem}
                updateItem={updateItem} toggleModel={toggleModel} subtotal={subtotal}
                selectClass={selectClass} inputClass={inputClass}
              />
            )}
            {step === 2 && (
              <StepDiscountVat form={form} setForm={setForm} supplierHasVat={supplierHasVat} totals={totals} />
            )}
            {step === 3 && (
              <StepReview
                form={form} setForm={setForm} items={items} selectedSupplier={selectedSupplier}
                supplierHasVat={supplierHasVat} totals={totals} dueDatePreview={wizard.dueDatePreview}
                attachmentUrl={attachmentUrl} setAttachmentUrl={setAttachmentUrl}
                formAttachments={formAttachments} setFormAttachments={setFormAttachments}
                selectClass={selectClass} inputClass={inputClass}
              />
            )}
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 bg-background/95 backdrop-blur-xs border-t px-6 py-4 flex justify-between gap-3 shrink-0">
            <button
              type="button"
              onClick={() => (step === 0 ? onClose() : back())}
              className="px-6 py-2.5 text-sm border border-input rounded-lg hover:bg-muted transition-colors"
            >
              {step === 0 ? 'ยกเลิก' : 'ย้อนกลับ'}
            </button>
            {isLast ? (
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="px-6 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm"
              >
                {createMutation.isPending ? 'กำลังสร้าง...' : 'สร้าง PO'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => canNext && next()}
                disabled={!canNext}
                className="px-6 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm"
              >
                ถัดไป
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
```

> Important: the `<form onSubmit={handleCreate}>` wraps all panels, but only the step-3 button is `type="submit"`. The step-0..2 "ถัดไป" buttons are `type="button"` so pressing them never submits. This preserves the existing `handleCreate` validation/early-returns (`usePOForm.ts:83-93`) as a final guard even though the wizard gate already blocks empty supplier/items.

- [ ] **Step 3: Remove now-unused destructured props (avoid TS6133 unused-var errors)**

The new body no longer references `discountNum`, `subtotalAfterDiscount`, `vatAmount`, `totalWithVat`, `discountAfterVatNum`, `netAmount` directly (they're inside `totals`/the panels). They remain in `CreatePOModalProps` (passed from `index.tsx`) but are not destructured in the function signature above — that's fine, unused props on the interface don't error. **Do not** destructure them. (If `check-types` flags any genuinely-unused import you left behind, delete it.)

- [ ] **Step 4: Wire the wizard hook + clear-draft-on-success in `index.tsx`**

In `apps/web/src/pages/PurchaseOrdersPage/index.tsx`:

(a) Add the import near the others (after line 10):

```tsx
import { useCreatePoWizard } from './hooks/useCreatePoWizard';
import { computePoTotals } from './poTotals';
```

(b) Instantiate the wizard after `poForm` (after line 36 `resetFormRef.current = poForm.resetForm;`):

```tsx
  const wizard = useCreatePoWizard({
    isOpen: data.isCreateModalOpen,
    form: poForm.form,
    setForm: poForm.setForm,
    items: poForm.items,
    setItems: poForm.setItems,
    selectedSupplier: poForm.selectedSupplier,
  });

  const totals = computePoTotals({
    items: poForm.items,
    discount: poForm.form.discount,
    discountAfterVat: poForm.form.discountAfterVat,
    supplierHasVat: poForm.supplierHasVat,
  });
```

(c) Clear the draft when a PO is successfully created. The success path already resets the form via `onCreateSuccess` → `resetFormRef.current()` (`index.tsx:24-26`). Extend it to also clear the draft. Replace the `onCreateSuccess` callback (lines 24-26):

```tsx
  const wizardClearRef = useRef<() => void>(() => {});
  const onCreateSuccess = useCallback(() => {
    resetFormRef.current();
    wizardClearRef.current();
  }, []);
```

and after the `wizard` is created, sync the ref:

```tsx
  wizardClearRef.current = wizard.clearDraft;
```

(`useRef` is already imported at `index.tsx:1`.)

(d) Pass the two new props to `<CreatePOModal>` (inside the JSX at lines 166-196, add before `/>`):

```tsx
        wizard={wizard}
        totals={totals}
```

- [ ] **Step 5: Type-check**

Run: `./tools/check-types.sh all`
Expected: 0 errors.

- [ ] **Step 6: Run the full PurchaseOrdersPage vitest suite (regression on the calculator + hook)**

Run: `cd apps/web && npx vitest run src/pages/PurchaseOrdersPage`
Expected: PASS (poTotals.test.ts 5 + useCreatePoWizard.test.ts 5).

- [ ] **Step 7: Manual verification — desktop**

Run the app (`cd apps/web && npm run dev`), log in as `admin@bestchoice.com / admin1234`, go to `/purchase-orders` → "+ สร้าง PO". Verify on a **desktop viewport (≥1024px)**:
1. Step 1 "เลือกผู้ขาย": stepper shows 4 steps with step 1 active. "ถัดไป" is **disabled** until a supplier is picked. Pick a VAT supplier with a credit term → the due-date preview line shows "เครดิต N วัน → ครบกำหนดชำระ DD/MM/YYYY". Pick a no-credit/CASH method → shows "ไม่มีเครดิต (ชำระทันที)".
2. Inline-create: type a new supplier name → "+ สร้างผู้ติดต่อใหม่" appears → create → it is selected and "ถัดไป" enables.
3. Step 2 "เพิ่มรายการ": add 2 items; the footer shows "รวม N รายการ · M ชิ้น" and the running subtotal updates live. "ถัดไป" is **disabled** if any item lacks category/quantity/price.
4. Step 3 "ส่วนลด/VAT": the breakdown shows every line (มูลค่าสินค้า → ส่วนลด → หลังหักส่วนลด → VAT 7% → รวม VAT → ส่วนลดหลัง VAT → ยอดสุทธิ) and a "วิธีคิด:" explainer. Type a discount → all downstream lines + net recompute. Confirm the **net here equals** the net you see after saving (see step 7 below). For a **no-VAT** supplier the VAT lines are hidden.
5. Step 4 "ทบทวน+บันทึก": read-only summary lists each item + the totals matching step 3. Payment/attachments/notes controls work as before. Click "สร้าง PO" → toast "สร้างใบสั่งซื้อสำเร็จ (สถานะ: รออนุมัติ)" and the modal closes.
6. Re-open "+ สร้าง PO" after filling a couple of steps and closing **without** saving → toast "พบใบสั่งซื้อร่างที่บันทึกไว้ — กู้คืนแล้ว" and the fields/step are restored. After a successful save, re-opening does **not** recover (draft cleared).
7. Cross-check the math: create a VAT PO, then open it in PODetailModal/list and confirm the saved `netAmount` equals the wizard's step-3 net (proves `computePoTotals` mirrors `po-lifecycle.service.create()`).

- [ ] **Step 8: Manual verification — mobile viewport**

In dev tools, switch to a narrow viewport (e.g. 390px). Re-open the wizard. Verify: the stepper collapses to icons-only (step labels are `hidden sm:block`), the active panel scrolls, and the footer "ย้อนกลับ / ถัดไป" buttons remain reachable at the bottom. (Full mobile-first receive rebuild is B3 — for B2 the create wizard only needs to be usable, not redesigned, on small screens.)

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/pages/PurchaseOrdersPage/components/CreatePOModal.tsx apps/web/src/pages/PurchaseOrdersPage/index.tsx
git commit -m "feat(purchasing): CreatePOModal 4-step wizard shell + wire useCreatePoWizard/computePoTotals"
```

---

## Self-Review

**Spec coverage (B2 items from spec §"Batches" B2 + the IA table "สร้าง PO" row):**
- **4-step wizard** ((1) เลือกผู้ขาย → (2) เพิ่มรายการ → (3) ส่วนลด/VAT → (4) ทบทวน+บันทึก) → Task 2 (step state/gate) + Task 3 (StepSupplier/StepItems) + Task 4 (StepDiscountVat) + Task 5 (StepReview) + Task 6 (shell + stepper + footer). ✅
- **supplier inline-create** → Task 3 StepSupplier reuses `ContactCombobox roleNeeded="SUPPLIER"` (which already has the "+ สร้างผู้ติดต่อใหม่" → `CreateContactModal` path) + the existing `onSupplierSelect` invalidate/refetch wiring in `index.tsx:42-58`. ✅
- **show credit terms → due-date PREVIEW** → Task 2 `dueDatePreview`/`creditTermDays` (mirrors `po-lifecycle.service.create():69-77`) rendered in Task 3 StepSupplier + echoed in Task 5 StepReview. ✅
- **product picker + running subtotal** → Task 3 StepItems (lifted item editor + new subtotal footer). ✅
- **transparent VAT/discount breakdown mirroring backend `ROUND_HALF_UP`/net math** → Task 1 `computePoTotals` (unit-tested against the exact `subtotal → −discount → VAT HALF_UP if hasVat → −discountAfterVat = net` sequence) + Task 4 StepDiscountVat line-by-line display + explainer. ✅
- **AUTO-SAVE DRAFT to localStorage, reusing ContractCreate pattern** → Task 2 `useCreatePoWizard` (save-on-change + 24h-TTL recover + toast, modeled on `useDraftStorage.ts` + `useContractCreateData.ts:62-94`) with a distinct key `bestchoice-po-draft`; cleared on successful create (Task 6 Step 4c). ✅
- **keep `POST /purchase-orders` (CreatePODto) unchanged** → no backend files touched; `usePOForm.handleCreate` (the payload builder at `usePOForm.ts:94-119`) is untouched; Task 1 only refactors the *display* math behind the same return names. ✅

**Placeholder scan:** No "TBD/TODO/implement later". Two steps say "PASTE … VERBATIM" (Task 3 Step 2 items block, Task 5 Step 1 payment/attachments/notes blocks) — these cite the **exact source line ranges** (`CreatePOModal.tsx:187-449`, `535-627`, `629-707`, `709-726`) of real, already-correct JSX to copy unchanged, with the only permitted edit (add `leading-snug`) spelled out. That is a deliberate lift-don't-rewrite instruction, not a placeholder.

**Type/prop-name consistency:** `PoTotals`/`computePoTotals`/`VAT_RATE` (Task 1) are imported by name in Tasks 4, 5, 6. `CreatePoWizardApi`/`WIZARD_STEPS`/`useCreatePoWizard` (Task 2) used in Task 6. Panels reuse the **existing** exported `CreatePOModalProps` member types via indexed access (`CreatePOModalProps['form']` etc.) so they can't drift from the modal. `selectClass`/`inputClass` strings are defined once in `CreatePOModal.tsx` and passed down. `dueDatePreview: Date | null` consistent across hook → StepSupplier → StepReview. Payment status `onChange` keeps its `netAmount` reference, now aliased to `totals.netAmount` in StepReview.

**Deviations found vs spec wording:**
1. **VAT rate source.** The spec says "mirror the backend math EXACTLY". The backend resolves the rate via `loadVatRateDecimal(prisma)` (SystemConfig `VAT_RATE`, default 0.07; `po-lifecycle.service.ts:62`), but the existing frontend (`usePOForm.ts:127`) already hardcodes `0.07`. To stay a pure front-of-glass rebuild with **no new network call** and to match the number the form computes today, `computePoTotals` keeps `VAT_RATE = 0.07` (Task 1). If the owner ever changes `VAT_RATE` in settings, both the old modal and this wizard would be off by the same amount — pre-existing, not introduced here. The authoritative net is still the backend's (saved on the PO); the wizard preview just matches today's client behavior. Documented as `VAT_RATE` constant so a future task can wire it to settings.
2. **"ROUND_HALF_UP" on the client.** The backend uses `Prisma.Decimal.ROUND_HALF_UP`; the client uses `Math.round(x*100)/100`, which is HALF_UP at the satang place for non-negative money (all PO amounts are ≥0, enforced by `@Min(0)` DTOs). Equivalent for this domain; the unit test in Task 1 pins a half-satang case (`100.50 × 0.07 = 7.035 → 7.04`).
3. **Header "กลับ" → "ปิด".** The original modal's top-left button said "กลับ" but always closed the modal; in the wizard, back-navigation is the footer "ย้อนกลับ", so the header button is relabeled "ปิด" to avoid confusion. Cosmetic.
4. **No B1 dependency.** B1 (list/detail redesign) is not yet implemented (only B0 plan exists); this batch is independent of it and of the B0 `ORDERED`/`grNumber` schema work — it touches none of those. New PO still saves as `DRAFT` exactly as today.
