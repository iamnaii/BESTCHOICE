# Inbox UX Batch 0 — Safety + Mobile Blockers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the inbox from silently targeting the wrong contract on destructive customer actions (wrong-device MDM lock), and stop the mobile composer from being pushed off-screen by the dynamic viewport.

**Architecture:** Two independent changes in `apps/web/src/pages/UnifiedInboxPage/`. (1) Generalize the existing single-contract→action vs many-contract→picker logic (today only `sendPaymentLink` does it correctly) into one `triggerContractAction(action)` dispatcher backed by a pure, unit-tested `decideContractTarget` helper, reused by all four contract actions (send-link, contact-log, MDM lock, view-PDF). (2) Swap the inbox root height from `h-screen` (`100vh`, ignores mobile browser chrome) to `h-[100dvh]` (dynamic viewport) so the composer stays above the bottom nav on phones.

**Tech Stack:** React 18 + TypeScript + Tailwind (v4) + @tanstack/react-query + shadcn/ui + sonner + vitest/@testing-library.

## Global Constraints

- Design tokens only — no hardcoded hex/gray; use `bg-primary`, `text-muted-foreground`, etc. (`.claude/rules/frontend.md`).
- No new dependencies. Reuse existing components/hooks/patterns.
- Thai user-facing copy; `leading-snug` on Thai text.
- Prettier: semi true, singleQuote true, printWidth 100, tabWidth 2.
- Verify each task: `./tools/check-types.sh web` must pass; run added vitest specs.
- Ship as one branch off `main` → merge → GitHub Actions deploys (Cloud Run + Firebase) → user manual check.

## Scope note

Batch 0 originally listed a third item ("restore the 360 panel on 1024–1279px tablets"). Verified against source and **dropped**: the Customer360 drawer trigger in `ChatPanel.tsx:390-397` is `xl:hidden`, i.e. it IS shown on lg–xl tablets, so the panel is already reachable there via the drawer. The review finding over-claimed. No task.

## File Structure

- `apps/web/src/pages/UnifiedInboxPage/components/contract-action.ts` — **new**, pure helper `decideContractTarget` + `ContractAction` type. One responsibility: decide none/single/pick from a contract list; framework-free, fully unit-testable.
- `apps/web/src/pages/UnifiedInboxPage/components/contract-action.test.ts` — **new**, unit tests for the helper.
- `apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx` — **modify**, wire the dispatcher + generalize the picker dialog.
- `apps/web/src/pages/UnifiedInboxPage/index.tsx` — **modify**, root height `h-screen` → `h-[100dvh]`.

---

### Task 1: Generic contract-action dispatcher + picker (safety)

**Files:**
- Create: `apps/web/src/pages/UnifiedInboxPage/components/contract-action.ts`
- Test: `apps/web/src/pages/UnifiedInboxPage/components/contract-action.test.ts`
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx` (state `~166-167`, handlers `~280-373`, action buttons `~806-826`, picker dialog `~841-872`)

**Interfaces:**
- Produces: `decideContractTarget<T>(contracts: readonly T[]): { kind: 'none' } | { kind: 'single'; contract: T } | { kind: 'pick' }` and `type ContractAction = 'send-link' | 'contact-log' | 'mdm-lock' | 'view-pdf'`.
- Consumes (existing, unchanged): mutations `sendPaymentFlex.mutate(id)`, `fetchAndOpenContactLog.mutate(id)`, `fetchAndOpenMdmLock.mutate(id)`, `openContractPdf.mutate(contract)`; type `ContractSummaryItem` (local to Customer360Panel).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pages/UnifiedInboxPage/components/contract-action.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { decideContractTarget } from './contract-action';

describe('decideContractTarget', () => {
  it('returns none for an empty list', () => {
    expect(decideContractTarget([])).toEqual({ kind: 'none' });
  });

  it('returns the single contract when there is exactly one', () => {
    const c = { id: 'c1' };
    expect(decideContractTarget([c])).toEqual({ kind: 'single', contract: c });
  });

  it('returns pick when there are 2+ contracts (do NOT auto-pick the first)', () => {
    expect(decideContractTarget([{ id: 'c1' }, { id: 'c2' }])).toEqual({ kind: 'pick' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/UnifiedInboxPage/components/contract-action.test.ts`
Expected: FAIL — `Failed to resolve import "./contract-action"`.

- [ ] **Step 3: Write the helper**

Create `apps/web/src/pages/UnifiedInboxPage/components/contract-action.ts`:

```ts
/** Which customer action a contract-targeting button performs. */
export type ContractAction = 'send-link' | 'contact-log' | 'mdm-lock' | 'view-pdf';

export type ContractTarget<T> =
  | { kind: 'none' }
  | { kind: 'single'; contract: T }
  | { kind: 'pick' };

/**
 * Decide how to run a contract-targeting action given the customer's active
 * contracts: nothing to do, run directly on the only contract, or force the
 * staffer to pick. NEVER silently picks the first of several — a 2-contract
 * customer could otherwise get the WRONG device locked.
 */
export function decideContractTarget<T>(contracts: readonly T[]): ContractTarget<T> {
  if (contracts.length === 0) return { kind: 'none' };
  if (contracts.length === 1) return { kind: 'single', contract: contracts[0] };
  return { kind: 'pick' };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/pages/UnifiedInboxPage/components/contract-action.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the dispatcher into Customer360Panel — imports + state**

In `Customer360Panel.tsx`, add the import near the other local imports (the file already imports `ContractRow` at line 12):

```tsx
import { decideContractTarget, type ContractAction } from './contract-action';
```

Replace the `DialogView` state (the type at line 44 `type DialogView = null | 'send-link';` and the state declarations at lines 166-167):

```tsx
// (delete: `type DialogView = null | 'send-link';`)
// (delete: `const [dialogView, setDialogView] = useState<DialogView>(null);`)
// (delete: `const [selectedContractId, setSelectedContractId] = useState<string | null>(null);`  — write-only/dead)

const [pendingAction, setPendingAction] = useState<ContractAction | null>(null);

const ACTION_TITLE: Record<ContractAction, string> = {
  'send-link': 'เลือกสัญญาที่จะส่งลิงก์ชำระ',
  'contact-log': 'เลือกสัญญาที่จะบันทึกติดต่อ + นัดชำระ',
  'mdm-lock': 'เลือกสัญญาที่จะส่งคำสั่งล็อกเครื่อง',
  'view-pdf': 'เลือกสัญญาที่จะดู PDF',
};
```

- [ ] **Step 6: Replace the 4 per-action handlers with one dispatcher**

Delete the four functions `sendPaymentLink` (lines ~285-297), `openContactLog` (~312-324), `openMdmLock` (~339-346), `openContractPage` (~366-373) and the `closeDialog` body's stale `setSelectedContractId`. Keep all four mutations (`sendPaymentFlex`, `fetchAndOpenContactLog`, `fetchAndOpenMdmLock`, `openContractPdf`) untouched. Replace `closeDialog` and add the dispatcher (place right after `openContractPdf`, ~line 364):

```tsx
const closeDialog = () => setPendingAction(null);

const runContractAction = (action: ContractAction, contract: ContractSummaryItem) => {
  setPendingAction(null);
  switch (action) {
    case 'send-link':
      sendPaymentFlex.mutate(contract.id);
      break;
    case 'contact-log':
      fetchAndOpenContactLog.mutate(contract.id);
      break;
    case 'mdm-lock':
      fetchAndOpenMdmLock.mutate(contract.id);
      break;
    case 'view-pdf':
      openContractPdf.mutate(contract);
      break;
  }
};

const triggerContractAction = (action: ContractAction) => {
  const contracts = (summary?.activeContracts ?? []) as ContractSummaryItem[];
  const target = decideContractTarget(contracts);
  if (target.kind === 'none') {
    toast.error('ไม่มีสัญญาที่ใช้งาน');
    return;
  }
  if (target.kind === 'single') {
    runContractAction(action, target.contract);
    return;
  }
  setPendingAction(action); // 2+ contracts → make the staffer choose
};
```

Note: `sendPaymentFlex.onSuccess` already calls `closeDialog()` — still valid (now clears `pendingAction`).

- [ ] **Step 7: Point the four action buttons at the dispatcher**

In the QuickAction popover (lines ~806-826) change the four `onClick`s:

```tsx
// ส่งลิงก์ชำระ (was onClick={sendPaymentLink})
onClick={() => triggerContractAction('send-link')}
// บันทึกติดต่อ + นัดชำระ (was onClick={openContactLog})
onClick={() => triggerContractAction('contact-log')}
// ส่งคำสั่งล็อกเครื่อง (MDM) (was onClick={openMdmLock})
onClick={() => triggerContractAction('mdm-lock')}
// ดูสัญญา PDF (was onClick={openContractPage})
onClick={() => triggerContractAction('view-pdf')}
```

- [ ] **Step 8: Generalize the picker dialog**

Replace the send-link-only dialog (lines ~841-872) with the action-aware version:

```tsx
{/* Contract picker — shown for ANY multi-contract action so staff never hit the wrong device */}
<Dialog open={pendingAction !== null} onOpenChange={(o) => !o && closeDialog()}>
  <DialogContent className="max-w-md">
    <DialogHeader>
      <DialogTitle className="flex items-center gap-2">
        <Link2 className="w-4 h-4" /> {pendingAction ? ACTION_TITLE[pendingAction] : ''}
      </DialogTitle>
    </DialogHeader>
    <div className="space-y-2">
      {((summary?.activeContracts ?? []) as ContractSummaryItem[]).map((c) => {
        const productName =
          c.product?.name ?? `${c.product?.brand ?? ''} ${c.product?.model ?? ''}`.trim() ?? 'สินค้า';
        const busy =
          sendPaymentFlex.isPending ||
          fetchAndOpenContactLog.isPending ||
          fetchAndOpenMdmLock.isPending ||
          openContractPdf.isPending;
        return (
          <button
            key={c.id}
            type="button"
            disabled={busy}
            onClick={() => pendingAction && runContractAction(pendingAction, c)}
            className="w-full text-left p-3 rounded-lg border border-border hover:bg-accent text-sm transition-colors disabled:opacity-50"
          >
            <div className="flex items-center justify-between mb-0.5">
              <span className="font-medium text-foreground">{c.contractNumber}</span>
              <span className="text-xs text-muted-foreground">
                {Number(c.monthlyPayment).toLocaleString()} บ./งวด
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{productName}</p>
          </button>
        );
      })}
    </div>
  </DialogContent>
</Dialog>
```

(The send-link-specific footer line "เลือก template อัตโนมัติตามสถานะค้างชำระ" is dropped — it no longer fits a generic picker.)

- [ ] **Step 9: Typecheck**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`. (If it flags an unused import e.g. `selectedContractId` or `DialogView`, remove the dead symbol.)

- [ ] **Step 10: Manual verification**

A customer with **2+ active contracts** is needed (or temporarily stub `summary.activeContracts` to length 2 in dev). For each of **ส่งลิงก์ชำระ / บันทึกติดต่อ / ล็อกเครื่อง / ดูสัญญา PDF**: open the room → ดำเนินการ popover → click the action → confirm the **picker dialog opens listing both contracts** (no action fires yet), then clicking a row runs that action on the chosen contract. With a **1-contract** customer, the action runs immediately (no picker). With **0 contracts**, a "ไม่มีสัญญาที่ใช้งาน" toast.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/contract-action.ts \
        apps/web/src/pages/UnifiedInboxPage/components/contract-action.test.ts \
        apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx
git commit -m "fix(inbox): pick the contract for every multi-contract action (no wrong-device lock)"
```

---

### Task 2: Mobile composer stays above the bottom nav

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/index.tsx:274` (root container class)

**Interfaces:** none (CSS-only).

- [ ] **Step 1: Change the root height to the dynamic viewport**

In `index.tsx`, the inbox root (line 274) is:

```tsx
<div className="h-screen flex bg-card overflow-hidden pb-[calc(56px+env(safe-area-inset-bottom))] lg:pb-0">
```

Change `h-screen` → `h-[100dvh]`:

```tsx
<div className="h-[100dvh] flex bg-card overflow-hidden pb-[calc(56px+env(safe-area-inset-bottom))] lg:pb-0">
```

Rationale: `h-screen` (`100vh`) on mobile browsers measures the *largest* viewport (URL bar retracted), so the bottom of the flex column — where the composer lives — sits behind the browser chrome / the fixed 56px `MobileBottomNav`. `100dvh` tracks the *currently visible* viewport, keeping the composer on-screen and above the nav. The existing `pb-[calc(56px+…)]` already reserves the nav's height; this fixes the viewport unit it's measured against.

- [ ] **Step 2: Typecheck**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`.

- [ ] **Step 3: Manual verification (mobile)**

On a phone or Chrome DevTools device mode (e.g. iPhone 12, 390×844), open `/inbox` → a conversation → confirm the **textarea + Send button are fully visible above the bottom tab bar**, not clipped behind it, both with the on-screen keyboard closed and open. Confirm desktop (`≥lg`) is unchanged (no bottom nav, full height).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/index.tsx
git commit -m "fix(inbox): use h-dvh so the mobile composer isn't hidden behind the bottom nav"
```

---

## Self-Review

**1. Spec coverage:** Batch 0 spec items — multi-contract picker → Task 1; mobile composer-above-nav → Task 2; "restore panel on tablets" → verified non-issue, dropped (scope note). All accounted for.

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; manual-verification steps name exact actions/widths. The two layout/manual steps are intentionally verified by typecheck + manual (CSS/viewport behavior is not unit-testable) — this is appropriate, not a gap.

**3. Type consistency:** `ContractAction` and `decideContractTarget` defined in Task 1 Step 3 and consumed in Steps 5-8 with matching names/shape. `runContractAction(action, contract)` takes the full `ContractSummaryItem` (so `view-pdf`'s `openContractPdf.mutate(contract)` gets the object it needs, while id-based mutations read `contract.id`). `pendingAction` replaces `dialogView` consistently across state, dispatcher, buttons, and dialog.

## Rollout

One branch (e.g. `fix/inbox-batch0-safety-mobile`) with both commits → merge to `main` → deploy → user verifies the picker (2-contract customer) + the mobile composer, then we proceed to Batch 1.
