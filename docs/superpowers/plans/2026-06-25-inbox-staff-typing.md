# Inbox Follow-up B — Staff-typing indicator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** When one staff member is typing a reply in a room, other staff viewing the same room see "<name> กำลังพิมพ์…" — completing the Batch-4 collision UX (you already see WHO is viewing; now you see they're actively replying, so you don't double-reply).

**Architecture:** The gateway already relays `chat:typing:start`/`stop` to other room staff via `client.to(room)` (excludes the sender). Two gaps: (1) the typing payload omits `role`/`userName`, so the client can't tell staff-typing apart from the (unused) customer path, and (2) nothing in the composer ever calls `startTyping`/`stopTyping`. Fix: add `role:'STAFF'` + `userName` to the emit; route `role==='STAFF'` to a new `staffTyping` state in the hook; emit start/stop (debounced) from the composer; render the indicator.

**Tech Stack:** NestJS WS gateway (jest n/a — trivial payload add) + React 18 + socket.io-client.

## Global Constraints
- Design tokens only; no new deps; Thai copy `leading-snug`; Prettier (semi, singleQuote, printWidth 100, tabWidth 2).
- Verify: `./tools/check-types.sh api` + `./tools/check-types.sh web`.
- Do NOT touch the IME guard, draft, auto-grow, the SENDING/FAILED ghosts, the collision banner, or `isCustomerTyping` (keep it — the customer path stays, harmless).

## Verified current-state facts
- `staff-chat.gateway.ts` `handleTypingStart` (220–231) + `handleTypingStop` (233–244): both `client.to(CHAT_ROOMS.room(data.roomId)).emit(CHAT_EVENTS.TYPING, { roomId, userId, isTyping })` — NO role/userName. `(client as any).userName` is set in `handleConnection` (from the JWT `payload.name`).
- `useChatSocket.ts`: `isCustomerTyping` state (89) + `typingTimerRef` (93); the `chat:typing` handler (129–137) sets `isCustomerTyping` when `roomId===active && data.role !== 'STAFF'` with a 5s auto-clear; `startTyping`/`stopTyping` are returned (179) but NEVER called by any consumer. `activeRoomIdRef` mirrors activeRoomId.
- `index.tsx` destructures `{ joinRoom, leaveRoom, viewRoom, isCustomerTyping, status: connectionStatus }` from `useChatSocket` and passes `isCustomerTyping` to `<ChatPanel>`.
- `ChatPanel.tsx`: renders the `isCustomerTyping` "กำลังพิมพ์..." indicator (646–655, animated dots) right before `<div ref={messagesEndRef} />`; the composer textarea `onChange` is at ~936 (`setInputText(v)` + clear-suggestion-on-empty).

---

### Task 1 (backend): typing emit includes role + userName

**Files:** Modify `apps/api/src/modules/staff-chat/staff-chat.gateway.ts` (`handleTypingStart` 226–230, `handleTypingStop` 239–243).

- [ ] **Step 1: Add role + userName to both emits**

In `handleTypingStart`, change the emit to:

```ts
const userId = (client as any).userId as string;
const userName = (client as any).userName as string | undefined;
client.to(CHAT_ROOMS.room(data.roomId)).emit(CHAT_EVENTS.TYPING, {
  roomId: data.roomId,
  userId,
  userName,
  role: 'STAFF',
  isTyping: true,
});
```

In `handleTypingStop`, the same with `isTyping: false`.

- [ ] **Step 2: Typecheck** — `./tools/check-types.sh api` → API OK.
- [ ] **Step 3: Commit** — `git add apps/api/src/modules/staff-chat/staff-chat.gateway.ts && git commit -m "feat(inbox): include role + userName in the staff typing event"`

---

### Task 2 (frontend hook): staffTyping state + expose startTyping/stopTyping

**Files:** Modify `apps/web/src/pages/UnifiedInboxPage/hooks/useChatSocket.ts`.

- [ ] **Step 1: Add `staffTyping` state + timer**

After the `isCustomerTyping` state (89) add:

```ts
const [staffTyping, setStaffTyping] = useState<{ userName: string } | null>(null);
const staffTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

- [ ] **Step 2: Route role==='STAFF' typing in the `chat:typing` handler**

In the `chat:typing` handler (129–137), AFTER the existing `isCustomerTyping` block, add the staff-typing branch (keep the existing customer block unchanged):

```ts
if (data.roomId === activeRoomIdRef.current && data.role === 'STAFF') {
  if (data.isTyping) {
    setStaffTyping({ userName: data.userName ?? 'พนักงาน' });
    if (staffTypingTimerRef.current) clearTimeout(staffTypingTimerRef.current);
    staffTypingTimerRef.current = setTimeout(() => setStaffTyping(null), 5000);
  } else {
    if (staffTypingTimerRef.current) clearTimeout(staffTypingTimerRef.current);
    setStaffTyping(null);
  }
}
```

(Extend the `ChatTypingEvent` type — `useChatSocket.ts` near the other event interfaces — to include `userName?: string` and widen `role` to include `'STAFF'` if it doesn't already. The hook's `data` is typed from `chat:typing`'s handler arg; add `userName?: string` to that type so `data.userName` typechecks.)

- [ ] **Step 3: Clear staffTyping on room switch + expose it**

In the effect that updates `activeRoomIdRef` (`useEffect(() => { activeRoomIdRef.current = activeRoomId; }, [activeRoomId])`), also clear it: add `setStaffTyping(null);` inside that effect body. Add `staffTyping` to the returned object (alongside `isCustomerTyping`, `startTyping`, `stopTyping`, `status`).

- [ ] **Step 4: Typecheck** — `./tools/check-types.sh web` → Web: OK.
- [ ] **Step 5: Commit** — `git add apps/web/src/pages/UnifiedInboxPage/hooks/useChatSocket.ts && git commit -m "feat(inbox): expose staffTyping state from useChatSocket"`

---

### Task 3 (frontend): emit typing from the composer + render the indicator

**Files:** Modify `apps/web/src/pages/UnifiedInboxPage/index.tsx` (destructure + pass props) + `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx` (emit on type/send/blur + render).

- [ ] **Step 1: Thread the hook outputs through index.tsx**

In `index.tsx`, add `startTyping, stopTyping, staffTyping` to the `useChatSocket` destructure. Pass to `<ChatPanel>`:

```tsx
onStartTyping={() => activeRoomId && startTyping(activeRoomId)}
onStopTyping={() => activeRoomId && stopTyping(activeRoomId)}
staffTypingName={staffTyping?.userName ?? null}
```

- [ ] **Step 2: Add the props to ChatPanel + a debounced typing emitter**

In `ChatPanelProps` + destructure, add: `onStartTyping?: () => void; onStopTyping?: () => void; staffTypingName?: string | null;`.

Add a typing-emit helper in the component body (refs so it doesn't re-render):

```tsx
const typingActiveRef = useRef(false);
const stopTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const emitTyping = () => {
  if (!typingActiveRef.current) {
    typingActiveRef.current = true;
    onStartTyping?.();
  }
  if (stopTypingTimerRef.current) clearTimeout(stopTypingTimerRef.current);
  stopTypingTimerRef.current = setTimeout(() => {
    typingActiveRef.current = false;
    onStopTyping?.();
  }, 3000);
};
const endTyping = () => {
  if (stopTypingTimerRef.current) clearTimeout(stopTypingTimerRef.current);
  if (typingActiveRef.current) {
    typingActiveRef.current = false;
    onStopTyping?.();
  }
};
```

(Clean up on unmount: `useEffect(() => () => { if (stopTypingTimerRef.current) clearTimeout(stopTypingTimerRef.current); }, [])`.)

- [ ] **Step 3: Wire emit/end into the composer**

In the textarea `onChange` (~936), after `setInputText(v)`, call `emitTyping()` when `v` is non-empty (and `endTyping()` when it becomes empty):

```tsx
onChange={(e) => {
  const v = e.target.value;
  setInputText(v);
  if (selectedSuggestion && v.trim() === '') setSelectedSuggestion(null);
  if (v.trim()) emitTyping();
  else endTyping();
}}
```

Add `onBlur={endTyping}` to the textarea. In `handleSend`, call `endTyping()` right after the composer clears (`setInputText('')`).

- [ ] **Step 4: Render the staff-typing indicator**

Right after the `isCustomerTyping` block (655), add:

```tsx
{staffTypingName && (
  <div className="px-4 py-1.5 flex items-center gap-2">
    <div className="flex gap-1">
      <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '300ms' }} />
    </div>
    <span className="text-[11px] text-muted-foreground leading-snug">{staffTypingName} กำลังพิมพ์…</span>
  </div>
)}
```

- [ ] **Step 5: Typecheck** — `./tools/check-types.sh web` → Web: OK.
- [ ] **Step 6: Manual verification** — two staff in the same room: staff A types → staff B sees "<A> กำลังพิมพ์…"; it clears ~3s after A stops, or on A's send/blur. Typing in the composer still works normally (IME, draft, auto-grow unaffected); you never see your own typing indicator (gateway uses `client.to`, excludes the sender).
- [ ] **Step 7: Commit** — `git add apps/web/src/pages/UnifiedInboxPage/index.tsx apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx && git commit -m "feat(inbox): emit + show staff-typing indicator in the composer"`

---

## Self-Review
**Coverage:** role+userName emit (T1) → hook staffTyping (T2) → composer emit + indicator (T3). **No regression:** `isCustomerTyping` untouched; IME/draft/auto-grow/ghosts/collision banner untouched; `client.to` already excludes the sender (no self-indicator). **Debounce:** startTyping once per typing burst, stopTyping 3s after idle or on send/blur, 5s receive-side timeout fallback. **Types:** `ChatTypingEvent` gains `userName?` + `role` includes `'STAFF'`; `staffTyping` exposed; props threaded.

## Rollout
One branch (`feat/inbox-staff-typing`) → 3 commits → merge → deploy → user verifies with 2 staff.
