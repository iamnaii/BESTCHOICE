# Inbox Fix F — a11y quick wins — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the high-value, low-effort accessibility gaps the audit confirmed: keyboard-operable interactive elements, screen-reader announcement of new messages + send failures, proper labels/roles, and design-token consistency.

**Architecture:** Pure additive a11y on existing components — no behavior change for pointer users. Three tasks grouped by file to avoid double passes: ChatPanel (SR + keyboard + popover), Customer360Panel (keyboard + dialog descriptions), token consistency (ConversationItem + SessionActions).

**Tech Stack:** React 18 + Tailwind + shadcn/Radix.

## Global Constraints
- Design tokens only — replace hardcoded `amber-*`/`emerald-*` palette classes with semantic tokens (`warning`/`success`/`destructive`). NO new hardcoded colors.
- Thai copy `leading-snug`; Prettier (semi, singleQuote, printWidth 100, tabWidth 2). `sr-only` is the Tailwind visually-hidden utility (already in the project).
- Verify: `./tools/check-types.sh web` + `cd apps/web && npx vitest run` (existing suite stays green).
- Do NOT change any send/typing/optimistic/transfer LOGIC — these are presentation/ARIA-only edits. Do NOT touch the message-bubble rendering content.

## Verified current-state facts
- `ChatPanel.tsx`: message scroll region `<div className="flex-1 overflow-y-auto px-4 py-3">` (~649) has no role/aria-live; GIF results (~942-958) are bare `<img ... onClick={() => { ... onSendMessage(`[gif:${url}]`) ...}} />` (emoji ~857 + sticker ~892 already use `<button>`); composer `<textarea>` (~979) has only `placeholder`, no aria-label; MoreVertical toggle (~615-621) has `aria-label` only (toggles `showActions`); emoji `<PopoverContent ... className="w-80 ...">` (~789). `messages` prop is `any[]`; `failedSends` prop exists.
- `Customer360Panel.tsx`: active-contract cards (~764) are `<div key={c.id} onClick={() => navigate(`/contracts/${c.id}`)} className="p-2.5 bg-muted rounded-lg text-xs cursor-pointer hover:bg-accent ...">` with span/div/Badge children (no nested interactive). CrossChannel rooms (~626) already use `<button>`. Imports `Dialog/DialogContent/DialogHeader/DialogTitle` (37) + `Sheet/SheetContent/SheetHeader/SheetTitle` (38) — NOT the Description components. Dialog/Sheet sites: picker Sheet (~1040) + picker Dialog (~1049), link-customer Dialog (~1061), customer-info Dialog (~1133), PDF Dialog (~1267) — all have only a Title.
- `ConversationItem.tsx`: AI status trio — handoff badge uses `text-destructive`/`bg-destructive-foreground` (~44), aiPaused badge `text-amber-600` + `bg-amber-500` (~52-53), ai-active badge `text-emerald-600` + (a `bg-emerald-500` dot ~63). `--warning` (amber-ish) + `--success` (emerald-ish) tokens exist in index.css.
- `SessionActions.tsx`: take-over "รับช่วงต่อ" button (~163) uses `bg-amber-500/10 text-amber-700` (its sibling transfer button already uses `bg-warning/10 text-warning`).

---

### Task 1: ChatPanel — SR live region, keyboard GIF, labels, popover width

**Files:** Modify `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx`.

- [ ] **Step 1: SR live-announcement regions** — Add component state + effect (place near the other ChatPanel state/effects):

```tsx
// Screen-reader announcements: new inbound message + send failure.
const [liveMsg, setLiveMsg] = useState('');
const lastAnnouncedRef = useRef<string | null>(null);
useEffect(() => {
  if (!messages.length) return;
  const last = messages[messages.length - 1];
  if (last?.role === 'CUSTOMER' && last?.id && last.id !== lastAnnouncedRef.current) {
    lastAnnouncedRef.current = last.id;
    const text = (last.text ?? '').trim();
    setLiveMsg(text ? `ข้อความใหม่: ${text.slice(0, 60)}` : 'ข้อความใหม่จากลูกค้า');
  }
}, [messages]);
```

(`useState`/`useRef`/`useEffect` are already imported in this file.) Then render two visually-hidden live regions immediately INSIDE the scroll container (right after the opening `<div ...overflow-y-auto...>` at ~649, before `messages.map`):

```tsx
<div className="sr-only" aria-live="polite" aria-atomic="true">{liveMsg}</div>
<div className="sr-only" aria-live="assertive" aria-atomic="true">
  {(failedSends ?? []).length > 0 ? 'ส่งข้อความไม่สำเร็จ' : ''}
</div>
```

- [ ] **Step 2: Label the scroll region + the textarea** — On the scroll container `<div ...overflow-y-auto...>` (~649) add `role="log"` and `aria-label="ประวัติข้อความ"`. On the composer `<textarea>` (~979) add `aria-label="พิมพ์ข้อความ"`.

- [ ] **Step 3: Keyboard-operable GIF results** — Wrap each GIF `<img>` (~942-958) in a `<button type="button">` (mirror the sticker grid ~892), moving the `onClick` to the button + adding `aria-label={gif.title || 'ส่ง GIF'}`:

```tsx
<button
  key={gif.id}
  type="button"
  onClick={() => { /* the existing onSendMessage(`[gif:${url}]`) + setEmojiOpen(false) body */ }}
  aria-label={gif.title || 'ส่ง GIF'}
  className="block rounded-lg overflow-hidden hover:ring-2 hover:ring-primary transition-all"
>
  <img src={...} alt={gif.title || ''} loading="lazy" className="w-full h-auto" />
</button>
```

(Read the actual GIF block first; preserve the exact URL/onSendMessage logic + the existing img src/sizing — only move onClick to the wrapping button and drop `cursor-pointer` from the img.)

- [ ] **Step 4: MoreVertical menu ARIA + emoji popover width** — On the MoreVertical toggle (~615-621) add `aria-haspopup="menu"` + `aria-expanded={showActions}`. On the emoji `<PopoverContent className="w-80 ...">` (~789) change `w-80` → `w-[min(20rem,calc(100vw-1rem))]` so it never overflows a narrow phone.

- [ ] **Step 5: Typecheck** — `./tools/check-types.sh web` → Web OK.
- [ ] **Step 6: Commit** — `git add apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx && git commit -m "a11y(inbox): SR live regions + log/textarea labels + keyboard GIF + menu aria + responsive picker width"`

---

### Task 2: Customer360Panel — keyboard contract cards + dialog descriptions

**Files:** Modify `apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx`.

- [ ] **Step 1: Contract cards → buttons** — Change each active-contract card (~764) from `<div ... onClick={...}>` to a real button (it has no nested interactive children):

```tsx
<button
  type="button"
  key={c.id}
  onClick={() => navigate(`/contracts/${c.id}`)}
  className="w-full text-left p-2.5 bg-muted rounded-lg text-xs cursor-pointer hover:bg-accent transition-colors"
  title="ดูรายละเอียดสัญญา"
>
  {/* unchanged children */}
</button>
```

(Keep all inner JSX identical; only the wrapper element + `w-full text-left` change. Close with `</button>`.)

- [ ] **Step 2: Add Description imports** — Extend the dialog import (37) to include `DialogDescription` and the sheet import (38) to include `SheetDescription`.

- [ ] **Step 3: sr-only descriptions on each dialog/sheet** — Add a `<DialogDescription className="sr-only">…</DialogDescription>` inside each `DialogHeader` (after the `DialogTitle`) and a `<SheetDescription className="sr-only">…</SheetDescription>` inside the `SheetHeader`, with a short Thai purpose string:
  - picker Sheet (~1040) + picker Dialog (~1049): `เลือกสัญญาเพื่อดำเนินการ`
  - link-customer Dialog (~1061): `ค้นหาและผูกลูกค้าที่มีอยู่กับห้องแชทนี้`
  - customer-info Dialog (~1133): `รายละเอียดข้อมูลลูกค้า`
  - PDF Dialog (~1267): `ตัวอย่างเอกสาร PDF`

(Read each dialog/sheet header to place the Description correctly; if a header wraps the title in extra markup, put the Description as a sibling of the Title inside the Header.)

- [ ] **Step 4: Typecheck** — `./tools/check-types.sh web` → Web OK.
- [ ] **Step 5: Commit** — `git add apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx && git commit -m "a11y(inbox): keyboard-operable contract cards + sr-only dialog/sheet descriptions"`

---

### Task 3: token consistency — ConversationItem AI trio + SessionActions take-over

**Files:** Modify `apps/web/src/pages/UnifiedInboxPage/components/ConversationItem.tsx` + `apps/web/src/pages/UnifiedInboxPage/components/SessionActions.tsx`.

- [ ] **Step 1: ConversationItem AI badge trio → semantic tokens** — Map the traffic-light trio to tokens (handoff already uses `destructive`):
  - aiPaused badge (~52-53): `text-amber-600` → `text-warning`; `bg-amber-500` → `bg-warning`.
  - ai-active badge (~62-63): `text-emerald-600` → `text-success`; any `bg-emerald-500` → `bg-success`.

(Read the exact lines; replace only the amber-*/emerald-* utilities with the token equivalents, leave structure/text unchanged. If the handoff badge uses `bg-destructive-foreground` for its dot, leave it — it's already a token.)

- [ ] **Step 2: SessionActions take-over button → warning token** — The "รับช่วงต่อ" button (~163) `bg-amber-500/10 text-amber-700 ... hover:bg-amber-500/20` → `bg-warning/10 text-warning ... hover:bg-warning/20` (match its sibling transfer button).

- [ ] **Step 3: Typecheck + tests** — `./tools/check-types.sh web` → Web OK; `cd apps/web && npx vitest run` → green.
- [ ] **Step 4: Commit** — `git add apps/web/src/pages/UnifiedInboxPage/components/ConversationItem.tsx apps/web/src/pages/UnifiedInboxPage/components/SessionActions.tsx && git commit -m "a11y(inbox): replace hardcoded amber/emerald with warning/success tokens"`

---

## Self-Review
**Coverage:** keyboard (GIF, contract cards) + SR (live regions, log/textarea labels, dialog descriptions, menu aria) + responsive (picker width) + token consistency (AI trio, take-over). **No behavior change:** all edits are ARIA attributes, element-type swaps (div→button preserving onClick), or token-for-palette class swaps; no send/typing/transfer logic touched. **Live region:** keyed on last message id so it announces each NEW inbound once (text snippet so consecutive messages differ → re-announced); assertive region for send-failure. **Tokens:** amber→warning, emerald→success, destructive already a token → the trio stays a coherent set. **Risk:** div→button on the contract card — verified no nested interactive children, `w-full text-left` preserves layout.

## Rollout
One branch (`fix/inbox-a11y-quickwins`) → 3 commits → review → merge → deploy.
