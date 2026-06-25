# Inbox UX Batch 7 — Send feedback (safe subset of "optimistic send")

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instant send feedback without the duplicate-message risk of true optimistic caching — show a transient "กำลังส่ง…" ghost while a staff message is in flight, and a unified "ส่งไม่สำเร็จ — ลองใหม่" ghost (with retry) when it fails, both rendered OUTSIDE the message cache.

**Why this shape (NO-GO on full optimistic):** the architecture has no client-correlation-id for chat messages — the HTTP send returns only `{success,error}` (not the created row), the WS echo (`emitNewMessage` → `server.to(room)`, includes the sender) carries no `messageId`, and `onNewMessage` invalidates+refetches (wiping any `setQueryData` optimistic row). Reconciling an injected optimistic bubble could only be done by fuzzy `text+role+time` matching, which breaks on duplicate identical sends, two-staff rooms, and clock skew → duplicate/lost bubbles. So we do NOT inject into `['chat-messages']`; we render ghosts as separate siblings driven by component state. (True optimistic SENDING→SENT would require a backend `clientMessageId` column + return-the-row — explicitly deferred.)

**Architecture:** All frontend. `index.tsx` owns send state (an in-flight `pendingSend` + a `failedSends` list, both `roomId`-scoped) and passes them to `ChatPanel`, which renders the ghost rows below the message list. The authoritative `['chat-messages']` cache + the existing refetch-on-send/WS stay the single source of truth.

**Tech Stack:** React 18 + TypeScript + Tailwind v4 + @tanstack/react-query + lucide-react.

## Global Constraints

- Design tokens only — no hardcoded hex/gray.
- No new dependencies (use `crypto.randomUUID()` for ghost temp-ids).
- No backend changes, no cache injection (`setQueryData` into `['chat-messages']` is forbidden in this batch).
- Thai copy; `leading-snug` on multi-word Thai.
- Prettier: semi true, singleQuote true, printWidth 100, tabWidth 2.
- Verify: `./tools/check-types.sh web` prints `Web: OK` + manual.

## Verified current-state facts (from the understanding sweep — do not re-derive)

- **`index.tsx`** `sendRoomMessage` (261–287): `POST /staff-chat/rooms/:id/messages` `{text}` → returns `Promise<boolean>` (response `{success,error}`, no message id); on failure toasts; ALWAYS `invalidateQueries(['chat-messages', activeRoomId])` + `['chat-rooms']`. `messagesQuery` (155–165): key `['chat-messages', activeRoomId]`, `refetchInterval: 5000`. `onNewMessage` (91–99): invalidates `['chat-messages', roomId]` (refetch). `onSendFailed` (119–122): `toast.error(...)` + invalidate (WS `chat:message:send-failed`; note the inbox sends via HTTP so the HTTP-catch is the live failure path, the WS one is mostly dead here — map both anyway). There is a `useEffect(() => setRoomViewers([]), [activeRoomId])` (~78) to mirror for any room-switch reset.
- **`ChatPanel.tsx`** `handleSend` (362–393): clears `inputText` only on success; `if (result === false) { focus; return }` keeps the text in the composer (the Batch-1 keep-text contract — THIS BATCH MOVES recovery from the composer to the FAILED ghost). The message list renders `messages.map(... <MessageBubble key={msg.id}> ...)` with `messagesEndRef` after it (~616–638) inside the `flex-1 overflow-y-auto` scroll container.
- **`MessageBubble.tsx`** has NO sending/failed state; the ghosts must be SEPARATE elements (not threaded through MessageBubble, which branches on type/text tokens and assumes a real persisted row).
- Backend persists (`saveMessage`) BEFORE external delivery, so a customer-delivery failure still leaves a real bubble in the cache — the FAILED ghost copy should say "ส่งถึงลูกค้าไม่สำเร็จ" to disambiguate from a never-sent message ("ส่งไม่สำเร็จ").

---

### Task 1: Send-status state in index.tsx (pending + failed, roomId-scoped) + unify failure paths

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/index.tsx` (send state; `sendRoomMessage`; `onSendFailed`; retry; pass props to ChatPanel)

**Interfaces:**
- Produces props for ChatPanel: `pendingSendText?: string | null`, `failedSends?: { id: string; text: string }[]`, `onRetrySend?: (id: string, text: string) => void`.

- [ ] **Step 1: Add the send-status state**

In `index.tsx`, near the other inbox state:

```tsx
const [pendingSend, setPendingSend] = useState<{ roomId: string; text: string } | null>(null);
const [failedSends, setFailedSends] = useState<{ id: string; roomId: string; text: string }[]>([]);

const pushFailedSend = useCallback((roomId: string, text: string) => {
  setFailedSends((prev) =>
    // avoid a double entry if HTTP-catch and WS send-failed both fire for the same text
    prev.some((f) => f.roomId === roomId && f.text === text)
      ? prev
      : [...prev, { id: crypto.randomUUID(), roomId, text }],
  );
}, []);
```

- [ ] **Step 2: Rework `sendRoomMessage` to drive the ghost + failed list (no toast, no cache injection)**

Replace `sendRoomMessage` (261–287) with:

```tsx
const sendRoomMessage = async (text: string): Promise<boolean> => {
  if (!activeRoomId) {
    toast.error('ไม่มีห้องสนทนาที่เปิดอยู่');
    return false;
  }
  const roomId = activeRoomId; // capture — the room may change before this settles
  setPendingSend({ roomId, text }); // transient "กำลังส่ง…" ghost (NOT in the cache)
  let ok = false;
  try {
    const { data } = await api.post<{ success: boolean; error?: string }>(
      `/staff-chat/rooms/${roomId}/messages`,
      { text },
    );
    if (data && data.success === false) pushFailedSend(roomId, text);
    else ok = true;
  } catch {
    pushFailedSend(roomId, text);
  }
  // drop the ghost only if it's still the one we set (room may have switched + re-sent)
  setPendingSend((p) => (p?.roomId === roomId && p.text === text ? null : p));
  queryClient.invalidateQueries({ queryKey: ['chat-messages', roomId] });
  queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
  return ok;
};
```

(The failure toast is removed — the FAILED ghost is now the affordance.)

- [ ] **Step 3: Map the WS send-failed path to the same FAILED list**

Replace the `onSendFailed` handler (119–122) so it feeds the unified list instead of a toast:

```tsx
onSendFailed: (data) => {
  pushFailedSend(data.roomId, data.text);
  queryClient.invalidateQueries({ queryKey: ['chat-messages', data.roomId] });
},
```

- [ ] **Step 4: Retry handler**

```tsx
const retrySend = useCallback(
  (failedId: string, text: string) => {
    setFailedSends((prev) => prev.filter((f) => f.id !== failedId));
    void sendRoomMessage(text); // re-runs the same flow (new ghost; re-fails → new FAILED entry)
  },
  // sendRoomMessage is a stable closure over activeRoomId; the retry button only renders for the active room
  [],
);
```

(If lint flags `sendRoomMessage` as a missing dep and it's not memoized, leave the dep array empty with a comment — the retry button only appears for the active room, so `activeRoomId` inside `sendRoomMessage` is correct at click time.)

- [ ] **Step 5: Pass the room-scoped ghosts to ChatPanel**

On the `<ChatPanel … />`, add:

```tsx
pendingSendText={pendingSend?.roomId === activeRoomId ? pendingSend.text : null}
failedSends={failedSends.filter((f) => f.roomId === activeRoomId)}
onRetrySend={retrySend}
```

(Scoping by `activeRoomId` means a ghost from room A is hidden — not lost — while viewing room B, and reappears on return. No room-switch reset needed.)

- [ ] **Step 6: Typecheck**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/index.tsx
git commit -m "feat(inbox): send-status state (pending + unified failed list) for ghost rows"
```

---

### Task 2: Render the SENDING + FAILED ghosts + clear-on-submit composer

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx` (props; ghost rows below the list; `handleSend` clear-on-submit)

**Interfaces:** consumes `pendingSendText` / `failedSends` / `onRetrySend` from Task 1.

- [ ] **Step 1: Add the props**

In `ChatPanelProps` + the destructure, add:

```tsx
pendingSendText?: string | null;
failedSends?: { id: string; text: string }[];
onRetrySend?: (id: string, text: string) => void;
```

Add `Loader2` (if not already imported) + `AlertCircle, RotateCw` to the lucide import for the ghost icons.

- [ ] **Step 2: Render the ghost rows below the message list**

Just AFTER the `messages.map(...)` block and the `<div ref={messagesEndRef} />` (inside the same `flex-1 overflow-y-auto` scroll container, so they sit at the bottom of the thread), add:

```tsx
{/* In-flight "sending" ghost — NOT a cached message; drops when the send settles. */}
{pendingSendText && (
  <div className="flex justify-end mb-3">
    <div className="max-w-[75%] rounded-2xl rounded-br-md bg-primary/60 px-3.5 py-2 text-sm text-primary-foreground leading-relaxed [overflow-wrap:anywhere]">
      <span className="whitespace-pre-wrap">{pendingSendText}</span>
      <span className="mt-0.5 flex items-center justify-end gap-1 text-[10px] opacity-80">
        <Loader2 className="size-3 animate-spin" /> กำลังส่ง
      </span>
    </div>
  </div>
)}

{/* Failed sends — unified HTTP + WS failure path; retry re-sends. */}
{(failedSends ?? []).map((f) => (
  <div key={f.id} className="flex justify-end mb-3">
    <div className="max-w-[75%] rounded-2xl rounded-br-md border border-destructive/40 bg-destructive/10 px-3.5 py-2 text-sm text-foreground leading-relaxed [overflow-wrap:anywhere]">
      <span className="whitespace-pre-wrap">{f.text}</span>
      <div className="mt-1 flex items-center justify-end gap-2 text-[10px] text-destructive leading-snug">
        <AlertCircle className="size-3 shrink-0" /> ส่งไม่สำเร็จ
        <button
          type="button"
          onClick={() => onRetrySend?.(f.id, f.text)}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium hover:bg-destructive/15"
        >
          <RotateCw className="size-3" /> ลองใหม่
        </button>
      </div>
    </div>
  </div>
))}
```

(These render only for the active room — Task 1 already filtered by `activeRoomId`.)

- [ ] **Step 3: Clear the composer on submit (move recovery to the FAILED ghost)**

Rework `handleSend` (362–393) so the composer clears immediately on submit and failure recovery lives in the FAILED ghost (NOT the composer — keeping the text in BOTH would risk a double-send):

```tsx
const handleSend = async () => {
  const text = inputText.trim();
  if (!text || isSending) return;
  // Clear the composer immediately — the in-flight ghost shows the text while
  // sending, and a FAILED ghost (with retry) owns it if the send fails. The
  // Batch-1 keep-text-in-composer path is replaced by that ghost.
  setInputText('');
  if (roomId) draftsRef.current.delete(roomId);
  const suggestion = selectedSuggestion;
  setSelectedSuggestion(null);
  setIsSending(true);
  let result: boolean | void;
  try {
    result = await onSendMessage(text);
  } finally {
    setIsSending(false);
  }
  if (result !== false && suggestion) {
    const type = text === suggestion.aiDraft ? 'ACCEPT' : 'EDIT';
    api
      .post('/staff-chat/ai/training-feedback', {
        roomId: session.id,
        type,
        customerMessage: getLastCustomerMessage(),
        aiDraft: suggestion.aiDraft,
        humanEdit: type === 'EDIT' ? text : undefined,
        intent: suggestion.intent,
      })
      .catch(() => {});
  }
  inputRef.current?.focus();
};
```

(The auto-grow layout effect already resets the textarea height when `inputText` becomes `''`. The keydown IME guard is unchanged.)

- [ ] **Step 4: Typecheck**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`.

- [ ] **Step 5: Manual verification**

- Send a message: the composer clears instantly; a right-aligned "กำลังส่ง" ghost (spinner) shows at the bottom of the thread; within a moment the authoritative bubble appears (via refetch/WS) and the ghost disappears — no duplicate.
- Send rapid identical messages ("ครับ" twice): two real bubbles, no stuck/duplicate ghost.
- Simulate a failure (offline / 500): the composer is cleared, a red "ส่งไม่สำเร็จ — ลองใหม่" ghost holds the text; clicking ลองใหม่ re-sends (ghost → sending → real on success). The text is never silently lost.
- Switch rooms mid-send: the ghost shows in the originating room only; switching away hides it (not duplicated in the other room), returning shows it.
- A delivery-failed-but-persisted case: the real bubble appears AND a FAILED ghost shows (acceptable; the copy distinguishes "ส่งไม่สำเร็จ").

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx
git commit -m "feat(inbox): sending + failed-with-retry ghost rows; clear composer on submit"
```

---

## Self-Review

**1. Spec coverage (Batch 7 = optimistic send, optional):** the spec's full optimistic SENDING→SENT-via-setQueryData is **NO-GO** (documented above — would risk duplicate/lost messages without a backend client-correlation-id). Shipped the **safe subset**: instant SENDING ghost (Task 2) + a unified HTTP+WS FAILED-with-retry ghost (Task 1 state + Task 2 render) — ~90% of the perceived-latency win, zero dedup risk, no backend. True optimistic is deferred (needs `clientMessageId` + return-the-row).

**2. Placeholder scan:** every step has complete code. The ghosts are pure render of component state (no cache injection, no unit-testable pure logic beyond the trivial `pushFailedSend` dedup) → tsc + manual, appropriate. No `setQueryData(['chat-messages'])` anywhere.

**3. Type consistency:** `pendingSend: {roomId,text} | null` + `failedSends: {id,roomId,text}[]` in index; ChatPanel receives `pendingSendText: string | null`, `failedSends: {id,text}[]` (roomId pre-filtered), `onRetrySend(id, text)`. `sendRoomMessage` keeps its `Promise<boolean>` contract (ChatPanel.handleSend still awaits it).

**4. Behavior-change note (intentional):** this batch CHANGES the Batch-1 keep-text-on-failure contract — the composer now clears on submit and failure recovery moves to the FAILED ghost + retry. This is deliberate (the design's "don't keep text in BOTH composer and ghost → double-send risk"). The text is never lost: it's in the SENDING ghost in flight, then the FAILED ghost on failure. No cache injection; the authoritative message list is untouched as the source of truth.

## Rollout

One branch off `main` (e.g. `feat/inbox-batch7-send-feedback`) with the two commits → merge → deploy (frontend only) → user verifies sending/failed/retry. **This closes the inbox UX overhaul (Batches 0–7).**
