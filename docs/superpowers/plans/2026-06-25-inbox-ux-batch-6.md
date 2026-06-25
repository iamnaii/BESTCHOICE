# Inbox UX Batch 6 — Mobile / a11y (final polish) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The final polish pass — 44px touch targets, hover-only controls reachable on touch, an a11y pass (aria-expanded + missing aria-labels), and the contract picker as a thumb-friendly bottom sheet on mobile. Cheap, mechanical, bounded.

**Architecture:** All frontend, mostly className/attribute edits across four inbox components, plus one localized mobile-Sheet wrapper around the existing contract picker (body extracted to a variable — no markup duplication). No backend, no new logic, no new tests (UI-only → tsc + manual).

**Tech Stack:** React 18 + TypeScript + Tailwind v4 + shadcn Sheet + `useIsMobile`.

## Global Constraints

- Design tokens only — no hardcoded hex/gray.
- No new dependencies (reuse `useIsMobile` + shadcn `Sheet`).
- Thai user-facing copy; `leading-snug` on multi-word Thai.
- Prettier: semi true, singleQuote true, printWidth 100, tabWidth 2.
- Verify: `./tools/check-types.sh web` prints `Web: OK` + manual on a phone/devtools device mode.
- **Bounded scope.** Do ONLY what's listed. Explicitly OUT OF SCOPE (do NOT touch): long-press pin gesture; sheet-ifying other dialogs (link-customer, contact-log, customer-info, PDF preview); the emoji/sticker/GIF popover; 44px on popover-internal grid cells (emoji/sticker buttons, sub-tabs); AI-status redesign; focus traps / roving tabindex / landmark roles; `aria-live` (optional, skipped). Images already all have `alt` (skip).

## Verified current-state facts (from the audit — do not re-derive)

- **`Customer360Panel.tsx`**: a single shared `SectionHeader` `<button>` (~line 1576, inside the helper at 1563–1597) renders all **9** collapsible headers (cross-channel, mdm, warranty, contracts, payments, chat-history, call-logs, notes + the `InternalNotesSection` header at ~1379). It has `collapsed`/`onToggle` but NO `aria-expanded`. The multi-contract picker is a `<Dialog>` driven by `pendingAction` (~998–1037); its body is the `<div className="space-y-2">…contract buttons…</div>` (~1006–1035).
- **`ChatPanel.tsx`** header buttons (~lines 469 back / 524 customer-info / 533 bell / 544 AI / 561 pin / 574 more) and composer buttons (~673 attach / 688 emoji / 883 template / 907 send) use `p-1`/`p-1.5`/`p-2` → ~28–34px tap area. The bell (533) + AI (544) already have `aria-label`; back/customer-info/pin/more/attach/emoji/template/send do NOT (most have `title`).
- **`ConversationItem.tsx`**: the list pin button (~251–266) is `opacity-0 group-hover:opacity-100` when unpinned (invisible on touch) + ~20px; has `title`, no `aria-label`.
- **`MessageBubble.tsx`**: the copy-message button (~321–335) is `opacity-0 group-hover:opacity-100 focus-visible:opacity-100` + `p-1 size-3.5` (~18px); invisible on touch.
- **`ConversationList.tsx`**: search-clear `<X>` button (~226) has NO padding (~14px tap, critical); global mute bell (~199) `p-1.5` (~28px).
- `useIsMobile` (`@/hooks/useIsMobile`, breakpoint 1024) and shadcn `Sheet`/`SheetContent` (`@/components/ui/sheet`) both exist.
- Tailwind v4: `min-h-11`/`min-w-11` = 2.75rem = 44px; the arbitrary variant `[@media(hover:none)]:opacity-100` works in this setup.

---

### Task 1: Mechanical a11y + touch-target + hover-on-touch sweep

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx` (SectionHeader aria-expanded)
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx` (aria-labels + touch targets)
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ConversationItem.tsx` (pin aria-label + hover-on-touch + touch target)
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx` (search-clear + global-mute touch targets)
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/MessageBubble.tsx` (copy hover-on-touch)

**Interfaces:** none — pure className/attribute edits. Reusable snippets:
- **Touch snippet** (add to a button's className, keep existing classes + icon size): `min-h-11 min-w-11 inline-flex items-center justify-center`
- **Hover-on-touch snippet** (add to a `group-hover:opacity-100` element's className): `[@media(hover:none)]:opacity-100`

- [ ] **Step 1: `aria-expanded` on the collapsible SectionHeader (closes Batch-5 deferral)**

In `Customer360Panel.tsx`, the `SectionHeader` `<button>` (the one with `onClick={onToggle}` and the rotating `ChevronRight`, ~1576) — add `aria-expanded`:

```tsx
<button type="button" onClick={onToggle} aria-expanded={!collapsed} className="...existing...">
```

(One edit covers all 9 collapsibles since they share this button.)

- [ ] **Step 2: `aria-label` on icon-only buttons missing one (ChatPanel + ConversationItem)**

Add `aria-label` to each of these buttons (keep their existing `title`/classes). Exact labels:
- `ChatPanel.tsx` back button (~469): `aria-label="กลับ"`
- `ChatPanel.tsx` customer-info button (~524): `aria-label="ข้อมูลลูกค้า"`
- `ChatPanel.tsx` pin button (~561): `aria-label="ปักหมุดห้องแชท"`
- `ChatPanel.tsx` more-actions button (~574, MoreVertical): `aria-label="ตัวเลือกเพิ่มเติม"`
- `ChatPanel.tsx` attach button (~673): `aria-label="แนบไฟล์"`
- `ChatPanel.tsx` emoji button (~688): `aria-label="อิโมจิ / สติกเกอร์"`
- `ChatPanel.tsx` template button (~883): `aria-label="ข้อความสำเร็จรูป"`
- `ChatPanel.tsx` send button (~907): `aria-label="ส่งข้อความ"`
- `ConversationItem.tsx` list pin button (~251): `aria-label="ปักหมุด"`

(The bell ~533 and AI ~544 buttons already have `aria-label` — leave them.)

- [ ] **Step 3: Hover-only controls reachable on touch (T1 + T2)**

- `ConversationItem.tsx` list pin button (~251–266): in the className that has `opacity-0 group-hover:opacity-100` (the unpinned branch), append `[@media(hover:none)]:opacity-100` so it's always visible on touch devices (desktop keeps hover-reveal).
- `MessageBubble.tsx` copy-message button (~321–335): in its `opacity-0 group-hover:opacity-100 focus-visible:opacity-100` className, append `[@media(hover:none)]:opacity-100`.

- [ ] **Step 4: 44px touch targets (add the touch snippet to the real offenders)**

Add `min-h-11 min-w-11 inline-flex items-center justify-center` to each button's className (keep all existing classes + the icon size unchanged):
- `ChatPanel.tsx` header: back (~469), customer-info (~524), bell (~533), AI (~544), pin (~561), more (~574).
- `ChatPanel.tsx` composer: attach (~673), emoji (~688), template (~883), send (~907).
- `ConversationItem.tsx` list pin (~251).
- `ConversationList.tsx` global mute (~199); search-clear (~226) — the search-clear has no padding; the min-size + inline-flex gives it a 44px tap area (keep `absolute right-2 top-1/2 -translate-y-1/2`; the min-size centers the X).

(The header row is `items-center gap-1` and the name has `min-w-0 … truncate flex-1`, so 44px buttons just truncate the name a little more — no overflow. The composer row is `items-end gap-1.5`. No layout risk.)

- [ ] **Step 5: Typecheck**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`.

- [ ] **Step 6: Manual verification**

On a phone / devtools device mode (e.g. iPhone 12, 390px): every header + composer + list icon button is comfortably tappable (≥44px); the search-clear X is easily tappable; the list pin button is VISIBLE without hover (so you can pin on touch); the copy-message button is visible on touch. Collapsible section headers announce expand/collapse to a screen reader (aria-expanded). Desktop is visually unchanged (icons same size; hover-reveal still works). Tab through the header — every icon button has an accessible name.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx \
        apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx \
        apps/web/src/pages/UnifiedInboxPage/components/ConversationItem.tsx \
        apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx \
        apps/web/src/pages/UnifiedInboxPage/components/MessageBubble.tsx
git commit -m "feat(inbox): 44px touch targets, touch-reachable pin/copy, aria-expanded + aria-labels"
```

---

### Task 2: Multi-contract picker → bottom Sheet on mobile

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx` (the `pendingAction` contract picker ~998–1037)

**Interfaces:** uses `useIsMobile` (`@/hooks/useIsMobile`) + `Sheet`/`SheetContent`/`SheetHeader`/`SheetTitle` (`@/components/ui/sheet`).

- [ ] **Step 1: Add imports + the mobile flag**

In `Customer360Panel.tsx`:

```tsx
import { useIsMobile } from '@/hooks/useIsMobile';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
```

(Verify the exact export names against `@/components/ui/sheet.tsx`; adjust if the project names differ.) In the component body:

```tsx
const isMobile = useIsMobile();
```

- [ ] **Step 2: Extract the picker body to a variable (no duplication)**

Read the `pendingAction` picker `<Dialog>` (~998–1037). Extract its inner content (the `<DialogHeader>`'s title text + the `<div className="space-y-2">…contract buttons…</div>`) into a single `pickerBody` variable defined just before the return of these dialogs. Keep the title (`ACTION_TITLE[pendingAction]`/icon) and the contract-button list exactly as they are. Example shape:

```tsx
const pickerBody = pendingAction && (
  <div className="space-y-2">
    {/* ...the existing contract buttons map, unchanged... */}
  </div>
);
const pickerTitle = pendingAction ? (
  <span className="flex items-center gap-2">{ACTION_ICON[pendingAction]} {ACTION_TITLE[pendingAction]}</span>
) : null;
```

(Use the actual existing `ACTION_TITLE`/`ACTION_ICON`/button markup from the file — do not invent.)

- [ ] **Step 3: Render Sheet on mobile, Dialog on desktop**

Replace the `pendingAction` `<Dialog>…</Dialog>` block with a conditional that reuses `pickerBody`/`pickerTitle`:

```tsx
{isMobile ? (
  <Sheet open={pendingAction !== null} onOpenChange={(o) => !o && closeDialog()}>
    <SheetContent side="bottom" className="rounded-t-2xl">
      <SheetHeader>
        <SheetTitle>{pickerTitle}</SheetTitle>
      </SheetHeader>
      <div className="mt-2">{pickerBody}</div>
    </SheetContent>
  </Sheet>
) : (
  <Dialog open={pendingAction !== null} onOpenChange={(o) => !o && closeDialog()}>
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>{pickerTitle}</DialogTitle>
      </DialogHeader>
      {pickerBody}
    </DialogContent>
  </Dialog>
)}
```

(Match the existing `closeDialog`/`pendingAction` handlers exactly. Do NOT change the contract-action logic, the picker's button behavior, or the OTHER dialogs in the file — only the `pendingAction` picker wrapper.)

- [ ] **Step 4: Typecheck**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`.

- [ ] **Step 5: Manual verification**

On mobile: triggering a multi-contract action (e.g. "ส่งลิงก์ชำระ" with 2+ contracts) slides up a bottom sheet listing the contracts (thumb-reachable); picking one runs the action + closes; swiping/tapping outside closes. On desktop: the same picker is the centered Dialog as before. The single-contract auto-run and the 0-contract toast (Batch 0) are unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx
git commit -m "feat(inbox): contract picker as a bottom sheet on mobile"
```

---

## Self-Review

**1. Spec coverage (Batch 6 = mobile/a11y):** 44px touch targets → Task 1 Step 4; picker-as-sheet → Task 2; touch pin → Task 1 Step 3 (hover-on-touch makes the pin visible; the header pin is already always-visible, only its tap area is bumped in Step 4) + Step 4; a11y pass (aria-expanded + aria-labels, closes the Batch-5 deferral) → Task 1 Steps 1–2; AI affordances → existing `title`+`aria-label` on the AI toggle are sufficient (no change, per the bounded scope); only-if-cheap polish → everything here is mechanical. Long-press, other sheets, emoji-sheet, aria-live, popover grid cells = explicitly OUT OF SCOPE.

**2. Placeholder scan:** every edit is a concrete className/attribute change with the exact snippet + the exact aria-label strings + the precise line ranges; the one structural change (Task 2 sheet) extracts the existing body to a variable so there's no duplication. No unit-testable logic added (pure UI → tsc + manual, appropriate). The implementer confirms the exact `@/components/ui/sheet` export names + the current button classNames against the file before editing.

**3. Type consistency:** no new types; `useIsMobile(): boolean`; `Sheet`/`SheetContent` from the existing shadcn module. The `pickerBody`/`pickerTitle` variables are shared between the Sheet and Dialog branches (single source).

**4. No-regression guards:** Task 1 only adds attributes/classes (no behavior change; desktop visually unchanged — icons keep their size, hover-reveal still works). Task 2 keeps the contract-action logic, the Batch-0 multi-contract safety (pick on 2+), `closeDialog`, and the desktop Dialog intact — only the mobile wrapper differs.

## Rollout

One branch off `main` (e.g. `feat/inbox-batch6-mobile-a11y`) with the two commits → merge → deploy (frontend only) → user verifies on a phone: tappable buttons, visible-on-touch pin/copy, bottom-sheet picker, screen-reader expand/collapse. **This completes the inbox UX overhaul (Batches 0–6).** Optional Batch 7 (optimistic send) remains a go/no-go.
