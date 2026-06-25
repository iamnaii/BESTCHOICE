# Inbox UX Batch 1 — Composer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the inbox composer feel like a real chat box — drafts survive room switches, the textarea grows as you type, the field focuses on open (desktop), and send/upload show progress — without losing the existing IME-safe send or introducing optimistic send.

**Architecture:** All changes live in `ChatPanel.tsx` plus a one-prop addition in the inbox page (`index.tsx`) for the upload spinner, and one new pure helper module (`composer-draft.ts`) for the room-draft swap logic (unit-tested). Per-room drafts use an in-memory `useRef<Map<roomId,string>>` (no storage). Draft load/focus/AI-suggestion-reset go in a NEW `useEffect` keyed on `[roomId]` ONLY — kept separate from the existing scroll effect (which fires on every new message) so streaming messages never clobber in-progress typing. Auto-grow is a single `useLayoutEffect` on `[inputText]` covering every text-mutation site.

**Tech Stack:** React 18 + TypeScript + Tailwind (v4) + @tanstack/react-query + lucide-react + sonner + vitest.

## Global Constraints

- Design tokens only — no hardcoded hex/gray; semantic tokens (`text-muted-foreground`, `bg-primary`, …).
- No new dependencies. (Reuse audit confirmed: no `react-textarea-autosize` — pure DOM/CSS; spinner = lucide `Loader2` + `animate-spin`, the existing `CallButton` pattern.)
- Thai user-facing copy; `leading-snug` on Thai text.
- Prettier: semi true, singleQuote true, printWidth 100, tabWidth 2.
- Verify each task: `./tools/check-types.sh web` prints `Web: OK`; run any added vitest spec.
- **Do NOT regress the IME guard** in `handleKeyDown` (lines 277–287) — Thai/CJK composition Enter must never send. It is already correct; leave it as the first statement.
- **No optimistic send** — `onSendMessage` stays fire-and-forget; the `result === false` "keep the typed text" contract is the only failure path and must be preserved.

## File Structure

- `apps/web/src/pages/UnifiedInboxPage/components/composer-draft.ts` — **new**, pure `swapRoomDraft` helper (save outgoing room text, return incoming room text). Framework-free, unit-tested.
- `apps/web/src/pages/UnifiedInboxPage/components/composer-draft.test.ts` — **new**, unit tests.
- `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx` — **modify**, auto-grow effect, draft/lifecycle effect, send-success draft clear, spinners, Enter hint, imports.
- `apps/web/src/pages/UnifiedInboxPage/index.tsx` — **modify**, pass `isUploadingFile={uploadFileMutation.isPending}` to `<ChatPanel>`.

## Verified current-state facts (from the understanding sweep — do not re-derive)

- State: `inputText` (line 117), `isSending` (118), `selectedSuggestion` (119). Refs: `messagesEndRef` (137), `inputRef` (138, the textarea).
- `const roomId = session?.id as string | undefined;` (221) + `scrolledRoomRef` (222) sit just above the scroll effect (223–238, deps `[messages.length, roomId]`). Leave that effect untouched.
- `handleSend` (245–275): async, sets/clears `isSending` in try/finally, returns early on `result === false` (keeps text), clears `selectedSuggestion` + `setInputText('')` + `inputRef.current?.focus()` on success.
- `handleKeyDown` (277–287): IME guard first, then Enter (no Shift) → `handleSend`. **Keep as-is.**
- Composer is wrapped in `{!isResolved && ( <div className="border-t border-border/60 px-3 py-2.5 bg-card"> <div className="flex items-end gap-1.5"> …controls… </div> </div> )}` (starts line 491). Paperclip button at 495–508 (`fileInputRef`, `onSendFile`). Textarea at 715–729 (`rows={1}`, `resize-none`, `max-h-32`). Send button at 730–741 (`disabled={!inputText.trim() || isSending}`, static `<Send />`).
- Imports: line 1 `import { useRef, useEffect, useState, useMemo } from 'react';`; line 3 lucide `import { Send, MoreVertical, ArrowLeft, Paperclip, Smile, Pin, PinOff, MessageSquare, UserCircle2, MessageSquareQuote } from 'lucide-react';`.
- `index.tsx` has `uploadFileMutation` (a `useMutation`, so `.isPending` exists) feeding `handleSendFile` → passed as `onSendFile` to `<ChatPanel>`.

---

### Task 1: Auto-grow textarea

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx` (import line 1; add a layout effect near the other effects; textarea className line ~728)

**Interfaces:**
- Produces: a `useLayoutEffect` on `[inputText]` that sizes `inputRef` to its content up to a 128px cap. Later tasks rely on it firing whenever `inputText` changes (including the Task 2 draft load).

- [ ] **Step 1: Add `useLayoutEffect` to the react import**

Line 1 — add `useLayoutEffect`:

```tsx
import { useRef, useEffect, useLayoutEffect, useState, useMemo } from 'react';
```

- [ ] **Step 2: Add the auto-grow constant + layout effect**

Add the module-level constant near the top of the file (just below the imports, before the component):

```tsx
const MAX_COMPOSER_HEIGHT = 128; // px — matches Tailwind max-h-32 (8rem)
```

Inside the component, immediately AFTER the existing scroll effect (after line 238), add:

```tsx
// Auto-grow the textarea to fit its content (capped). Runs on every inputText
// change — typing, send-clear, draft load (Task 2), emoji/template insert —
// so all sizing flows through one place. useLayoutEffect avoids a height flash.
useLayoutEffect(() => {
  const el = inputRef.current;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
}, [inputText]);
```

- [ ] **Step 3: Let the capped textarea scroll internally**

Textarea className (line ~728) — add `overflow-y-auto` (keep `rows={1}`, `resize-none`, `max-h-32`):

```tsx
className="flex-1 resize-none overflow-y-auto px-3 py-2 text-sm bg-muted/40 rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:bg-background max-h-32 transition-all placeholder:text-muted-foreground/40"
```

- [ ] **Step 4: Typecheck**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`.

- [ ] **Step 5: Manual verification**

Open a room → type several lines: the box grows line-by-line up to ~128px then scrolls internally; deleting lines shrinks it back to one row. Paste a long block → caps at 128px with an internal scrollbar.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx
git commit -m "feat(inbox): auto-grow the composer textarea up to a max height"
```

---

### Task 2: Per-room drafts + room-open lifecycle (drafts, AI-suggestion reset, desktop focus)

**Files:**
- Create: `apps/web/src/pages/UnifiedInboxPage/components/composer-draft.ts`
- Test: `apps/web/src/pages/UnifiedInboxPage/components/composer-draft.test.ts`
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx` (refs near 138; new effect after the Task 1 effect; `handleSend` success branch ~273)

**Interfaces:**
- Produces: `swapRoomDraft(drafts: Map<string,string>, prevRoom: string | undefined, currentRoom: string | undefined, outgoingText: string): string` — mutates `drafts` (saves/deletes the outgoing room's text) and returns the incoming room's draft (`''` if none/undefined room).
- Consumes (existing, unchanged): `inputText`/`setInputText` (117), `selectedSuggestion`/`setSelectedSuggestion` (119), `inputRef` (138), `roomId` (221), `handleSend` (245).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pages/UnifiedInboxPage/components/composer-draft.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { swapRoomDraft } from './composer-draft';

describe('swapRoomDraft', () => {
  it('saves the outgoing room text and returns "" for a room with no draft', () => {
    const drafts = new Map<string, string>();
    const incoming = swapRoomDraft(drafts, 'A', 'B', 'half-typed');
    expect(incoming).toBe('');
    expect(drafts.get('A')).toBe('half-typed');
  });

  it('returns the saved draft when reopening a room', () => {
    const drafts = new Map<string, string>([['B', 'wip reply']]);
    const incoming = swapRoomDraft(drafts, 'A', 'B', '');
    expect(incoming).toBe('wip reply');
  });

  it('deletes the outgoing entry when its text is empty (keeps the map small)', () => {
    const drafts = new Map<string, string>([['A', 'old']]);
    swapRoomDraft(drafts, 'A', 'B', '');
    expect(drafts.has('A')).toBe(false);
  });

  it('does not save when prevRoom is undefined (first open) and returns the current draft', () => {
    const drafts = new Map<string, string>([['A', 'restored']]);
    const incoming = swapRoomDraft(drafts, undefined, 'A', 'ignored-because-no-prev');
    expect(incoming).toBe('restored');
    expect(drafts.size).toBe(1);
  });

  it('returns "" when the incoming room is undefined', () => {
    const drafts = new Map<string, string>();
    expect(swapRoomDraft(drafts, 'A', undefined, 'text')).toBe('');
    expect(drafts.get('A')).toBe('text');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/UnifiedInboxPage/components/composer-draft.test.ts`
Expected: FAIL — `Failed to resolve import "./composer-draft"`.

- [ ] **Step 3: Write the helper**

Create `apps/web/src/pages/UnifiedInboxPage/components/composer-draft.ts`:

```ts
/**
 * Save the room you're leaving and load the room you're entering, for the
 * in-memory per-room composer drafts. Mutates `drafts`; returns the incoming
 * room's draft text ('' when none). Only saves on a real room change
 * (prevRoom set and different) so the first open never overwrites a draft.
 */
export function swapRoomDraft(
  drafts: Map<string, string>,
  prevRoom: string | undefined,
  currentRoom: string | undefined,
  outgoingText: string,
): string {
  if (prevRoom && prevRoom !== currentRoom) {
    if (outgoingText) drafts.set(prevRoom, outgoingText);
    else drafts.delete(prevRoom);
  }
  return currentRoom ? (drafts.get(currentRoom) ?? '') : '';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/pages/UnifiedInboxPage/components/composer-draft.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the import + draft refs in ChatPanel**

Add the import next to the other local imports (near `import MessageBubble from './MessageBubble';`):

```tsx
import { swapRoomDraft } from './composer-draft';
```

Just after the existing `inputRef` declaration (line 138), add the draft refs + a live mirror of `inputText` (the mirror avoids a stale-closure read inside the room-change effect):

```tsx
const draftsRef = useRef<Map<string, string>>(new Map());
const prevRoomRef = useRef<string | undefined>(undefined);
const inputTextRef = useRef(inputText);
inputTextRef.current = inputText; // keep the live value for the [roomId]-only effect
```

- [ ] **Step 6: Add the room-open lifecycle effect**

Immediately AFTER the Task 1 auto-grow effect, add a NEW effect keyed on `[roomId]` ONLY (not `messages.length` — it must NOT re-run when a message streams in):

```tsx
// On room change: persist the room you left, restore the room you entered,
// drop the AI-suggestion association (it's room-scoped — see below), and focus
// the box on desktop. Keyed on roomId ONLY so streaming messages never reload
// the draft or steal focus mid-typing.
useEffect(() => {
  const incoming = swapRoomDraft(draftsRef.current, prevRoomRef.current, roomId, inputTextRef.current);
  prevRoomRef.current = roomId;
  setInputText(incoming);
  // selectedSuggestion is metadata for THIS room's AI draft; carrying it into
  // another room would mislabel that room's send as an edit of this draft.
  setSelectedSuggestion(null);
  // Desktop only — on mobile, focus() pops the keyboard over the history.
  if (roomId && typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1024px)').matches) {
    inputRef.current?.focus({ preventScroll: true });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- room-change only; inputText read via inputTextRef
}, [roomId]);
```

- [ ] **Step 7: Clear the room's draft on a successful send**

In `handleSend`, on the SUCCESS path only — right after `setInputText('');` (line ~273, AFTER the `if (result === false) { … return; }` guard so a rejected send keeps both text and draft) — add:

```tsx
  setInputText('');
  draftsRef.current.delete(roomId); // sent successfully → drop this room's saved draft
  inputRef.current?.focus();
```

- [ ] **Step 8: Typecheck**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`.

- [ ] **Step 9: Manual verification**

- Type in room A (don't send) → open room B: A's text is gone from the box, B is empty (or shows B's own draft). Go back to A → A's text is restored. The auto-grow height matches the restored draft.
- Type in A, send successfully → A is cleared; reopen A → empty (draft was dropped).
- Force a send failure (e.g. offline) so `onSendMessage` returns `false` → the text stays AND switching away/back still has it.
- AI suggestion: in room A click an AI suggestion (fills the box) → switch to B → `selectedSuggestion` is dropped (sending in B logs no training feedback tied to A's draft).
- Desktop: opening a room focuses the textarea (cursor ready) without scrolling the message list away from the latest message. Mobile: opening a room does NOT pop the keyboard.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/composer-draft.ts \
        apps/web/src/pages/UnifiedInboxPage/components/composer-draft.test.ts \
        apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx
git commit -m "feat(inbox): per-room composer drafts + desktop focus-on-open; reset AI suggestion on room switch"
```

---

### Task 3: Send + upload progress spinners

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx` (lucide import line 3; props interface ~82–99; destructure; paperclip button ~495–508; send button ~730–741)
- Modify: `apps/web/src/pages/UnifiedInboxPage/index.tsx` (the `<ChatPanel … />` props)

**Interfaces:**
- Consumes: `isSending` (existing, 118), `uploadFileMutation.isPending` (existing in index.tsx).
- Produces: a new optional prop `isUploadingFile?: boolean` on `ChatPanel`.

- [ ] **Step 1: Import `Loader2`**

Line 3 — add `Loader2`:

```tsx
import { Send, MoreVertical, ArrowLeft, Paperclip, Smile, Pin, PinOff, MessageSquare, UserCircle2, MessageSquareQuote, Loader2 } from 'lucide-react';
```

- [ ] **Step 2: Add the `isUploadingFile` prop**

In `interface ChatPanelProps` (82–99) add:

```tsx
  isUploadingFile?: boolean;
```

In the component's destructured props, add `isUploadingFile` alongside the others (e.g. next to `onSendFile`).

- [ ] **Step 3: Spinner on the Send button**

Send button (730–741) — swap the static icon for a conditional spinner (keep `disabled={!inputText.trim() || isSending}` and the existing className unchanged):

```tsx
  {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
```

- [ ] **Step 4: Spinner + disable on the Paperclip (upload) button**

Paperclip button (495–508) — disable while uploading and swap its icon:

```tsx
<button
  onClick={() => fileInputRef.current?.click()}
  disabled={isUploadingFile}
  className="p-2 text-muted-foreground/60 hover:text-foreground hover:bg-muted rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
  title="แนบไฟล์/รูปภาพ"
>
  {isUploadingFile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
</button>
```

- [ ] **Step 5: Pass the upload-pending flag from the page**

In `index.tsx`, on the `<ChatPanel … />` element (the one already receiving `onSendFile={handleSendFile}`), add:

```tsx
          isUploadingFile={uploadFileMutation.isPending}
```

- [ ] **Step 6: Typecheck**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`.

- [ ] **Step 7: Manual verification**

Send a text message → the Send icon briefly becomes a spinner while in flight, then returns; Enter can't double-send (already guarded by `isSending`). Attach a file → the paperclip shows a spinner and is disabled until the upload resolves, then returns to the clip.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx \
        apps/web/src/pages/UnifiedInboxPage/index.tsx
git commit -m "feat(inbox): show send + upload progress spinners in the composer"
```

---

### Task 4: Enter / Shift+Enter hint

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx` (inside the `{!isResolved && (…)}` composer container, after the `flex items-end` controls row)

**Interfaces:** none (static markup).

- [ ] **Step 1: Add the hint**

Inside the composer container (the `<div className="border-t border-border/60 px-3 py-2.5 bg-card">` at line 491), AFTER the inner `<div className="flex items-end gap-1.5"> … </div>` controls row closes and BEFORE the container closes, add a subtle desktop-only hint:

```tsx
<p className="hidden lg:block mt-1 px-1 text-[10px] leading-snug text-muted-foreground/40">
  Enter ส่ง · Shift+Enter ขึ้นบรรทัด
</p>
```

- [ ] **Step 2: Typecheck**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`.

- [ ] **Step 3: Manual verification**

Desktop: a faint "Enter ส่ง · Shift+Enter ขึ้นบรรทัด" line sits under the composer. Mobile (`< lg`): the hint is hidden. Composer height/layout otherwise unchanged.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx
git commit -m "feat(inbox): add a subtle Enter/Shift+Enter hint under the composer (desktop)"
```

---

## Self-Review

**1. Spec coverage (Batch 1 = composer):** per-room drafts → Task 2; auto-grow textarea → Task 1; focus-on-open → Task 2 (desktop-gated); send/upload spinner → Task 3; Enter hint → Task 4; NO optimistic send → nothing added, `result === false` keep-text contract preserved (Task 2 Step 7). The sweep-surfaced latent bug (`selectedSuggestion` not reset on room switch) → fixed in Task 2 Step 6.

**2. Placeholder scan:** every code step shows complete code with exact values; the two layout/markup tasks (1, 4) are verified by tsc + manual because CSS/DOM sizing and static copy are not unit-testable — appropriate, not a gap. The one behavioral logic unit (`swapRoomDraft`) is TDD'd in Task 2.

**3. Type consistency:** `swapRoomDraft(drafts, prevRoom, currentRoom, outgoingText): string` defined in Task 2 Step 3 and called in Step 6 with `(draftsRef.current, prevRoomRef.current, roomId, inputTextRef.current)` — matching arity/types. `isUploadingFile?: boolean` declared on `ChatPanelProps` (Task 3 Step 2), consumed on the paperclip (Step 4), supplied from `index.tsx` (Step 5). `MAX_COMPOSER_HEIGHT` (Task 1) is the only new module constant. The Task 1 `[inputText]` layout effect is depended on by Task 2's draft load (loading a draft sets `inputText` → height recomputes) — sequencing is Task 1 before Task 2, as ordered.

**4. Regression guards:** the scroll effect (223–238) and the IME guard (277–287) are explicitly left untouched; the new room effect is `[roomId]`-only and uses two distinct refs (`scrolledRoomRef` vs `prevRoomRef`); focus uses `preventScroll: true` so it never fights the jump-to-latest scroll.

## Rollout

One branch off `main` (e.g. `feat/inbox-batch1-composer`) with the four commits → merge → deploy → user verifies drafts (switch rooms mid-typing), auto-grow, desktop focus, spinners, hint → then Batch 2.
