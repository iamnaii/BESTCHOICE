# Inbox Follow-up D — Full optimistic send (clientMessageId) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A staff-sent message appears instantly as a proper "กำลังส่ง" bubble that transitions to a confirmed bubble IN PLACE — no flicker, no momentary vanish, and precise per-message even when several are sent in quick succession. This completes the optimistic-send work Batch 7 deferred ("needs backend clientMessageId").

**Architecture:** Add a frontend-generated **correlation token** `clientMessageId` to `ChatMessage`. The send POST carries it, the backend persists it on the row + echoes it back (POST response + WS emit), and `getRecentMessages` already returns it (full-row select, preserved through `signMessageMedia`'s spread). The frontend shows an optimistic SENDING ghost keyed by that token and removes it **the moment the real row carrying the same token lands in the message list** (via the existing invalidate→refetch), instead of Batch 7's timing-based clear-on-POST-settle.

**Deliberate scope decision — correlation token, NOT DB idempotency:** `sendStaffMessage` **saves the row (line 466) BEFORE delivering via the channel adapter (line 481) and does NOT roll back on delivery failure** — so "in the DB" ≠ "delivered to the customer". A DB-unique constraint + dedup-on-clientMessageId would therefore mark a saved-but-undelivered message as SENT, which is wrong. So we add ONLY a nullable column (no `@@unique`, no backend dedup). `clientMessageId` is a fresh UUID per send (and per retry), so natural collisions never occur. The failure path stays exactly as Batch 7 (FAILED + retry ghost, fresh token on retry). The pre-existing saved-but-undelivered edge (adapter fails after save → the row shows AND a FAILED ghost shows) is unchanged by this work and explicitly out of scope.

**Tech Stack:** Prisma + NestJS (api) + React 18 + @tanstack/react-query + socket.io (web).

## Global Constraints
- Design tokens only; no new deps (`crypto.randomUUID()` is built-in, secure-context); Thai copy `leading-snug`; useQuery/useMutation + `@/lib/api`; sonner; Prettier (semi, singleQuote, printWidth 100, tabWidth 2).
- DB: nullable column, `@map` snake_case, hand-written migration with a **manually-sequenced** timestamp `20260975000000` (the repo uses fake-sequential timestamps — a real `migrate dev` timestamp = `20260626…` would sort BEFORE `20260974000000` and break ordering). No unique index (would force a full-table scan + isn't wanted).
- Verify: `./tools/check-types.sh api` + `./tools/check-types.sh web` + `cd apps/web && npx vitest run` (existing suite stays green).
- Do NOT touch: the FAILED-ghost source copy (Follow-up A), staff-typing, mark-all-read, the IME guard, per-room draft, auto-grow, collision banner. Do NOT change the save-before-deliver ordering or add rollback.

## Verified current-state facts
- `schema.prisma` `model ChatMessage` (4995): columns use `@map` snake_case; table is `chat_messages` (per migrations, e.g. `ALTER TABLE "chat_messages" ADD COLUMN "flex_json"`). Has a `deliveryStatus` column already (do not touch). Latest migration dir = `20260974000000_…`.
- `room-manager.service.ts`: `saveMessage(params)` (217) does `prisma.chatMessage.create({ data: {...} })` and `return msg;` (290) — the saved row IS returned (currently the caller discards it). `getRecentMessages` (293) returns full rows (no `select`) through `signMessageMedia` which spreads `{...m}` (media-url.util.ts:19) — so a new scalar column flows to the client automatically.
- `message-router.service.ts` `sendStaffMessage({roomId, staffId, text})` (450): saves (466, return discarded), then `adapter.sendMessage` (481); on adapter failure returns `{success:false, error}` WITHOUT rollback (488–492); success returns `{success:true}` (495). Return type is `{ success: boolean; error?: string }`.
- `staff-chat.controller.ts` `sendRoomMessage` (138): body `{text:string}`; calls `messageRouter.sendStaffMessage({roomId, staffId, text})`; then UNCONDITIONALLY `staffChatGateway.emitNewMessage(id, {roomId, role:'STAFF', staffId, text, createdAt:new Date().toISOString()})` (no message id); returns `result`.
- `gateway.emitNewMessage(roomId, payload)` (296) relays `payload` verbatim to the room (MESSAGE_NEW) + inbox (ROOM_UPDATE).
- `index.tsx`: `pendingSend` single state (78) `{roomId,text}|null`; `sendRoomMessage` (276) sets the ghost (282), POSTs (no clientMessageId), clears the ghost on settle (295) + invalidates messages (296); `onNewMessage`/`onSendFailed` invalidate messages; `retrySend` (348) re-calls `sendRoomMessageRef.current(text)`; ChatPanel gets `pendingSendText={pendingSend?.roomId===activeRoomId ? pendingSend.text : null}` (421).
- `ChatPanel.tsx`: prop `pendingSendText?: string|null` (111); renders ONE SENDING ghost (701–710, `Loader2` + `กำลังส่ง`) after `messages.map`; FAILED ghosts (712+) unchanged by this work; `handleSend` (clears composer on submit).

---

### Task 1: schema + migration — `clientMessageId` column

**Files:** Modify `apps/api/prisma/schema.prisma`; Create `apps/api/prisma/migrations/20260975000000_add_client_message_id_to_chat_message/migration.sql`.

- [ ] **Step 1: Schema field** — In `model ChatMessage`, add near `externalMessageId` (after line 4997):

```prisma
  /// Frontend-generated correlation token for optimistic send — lets the client
  /// match its optimistic "sending" bubble to the saved row. NULL for inbound
  /// messages and for rows created before this column existed. Intentionally NOT
  /// unique: sendStaffMessage saves before delivering (saved != delivered), so a
  /// unique/dedup would mis-mark a saved-but-undelivered message as sent.
  clientMessageId String? @map("client_message_id")
```

- [ ] **Step 2: Hand-write the migration** — Create `apps/api/prisma/migrations/20260975000000_add_client_message_id_to_chat_message/migration.sql`:

```sql
-- Optimistic-send correlation token (frontend-generated). Nullable, no default,
-- no index → metadata-only change (instant on a populated table).
ALTER TABLE "chat_messages" ADD COLUMN "client_message_id" TEXT;
```

- [ ] **Step 3: Apply to dev DB + regenerate client** — from `apps/api`:

Run: `npx prisma migrate deploy` → expect "1 migration applied" (20260975000000).
Run: `npx prisma generate` → Prisma Client regenerated with `clientMessageId`.

(If `migrate deploy` reports drift or fails to connect, STOP and report — do not switch to `migrate dev` which would rewrite the timestamp.)

- [ ] **Step 4: Typecheck** — `./tools/check-types.sh api` → API OK (the generated type now has `clientMessageId`).
- [ ] **Step 5: Commit** — `git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260975000000_add_client_message_id_to_chat_message && git commit -m "feat(inbox): add clientMessageId column to ChatMessage (optimistic-send correlation)"`

---

### Task 2: backend — thread clientMessageId through save → response → emit

**Files:** Modify `room-manager.service.ts` (`saveMessage` params+data), `message-router.service.ts` (`sendStaffMessage` param + capture + return), `staff-chat.controller.ts` (`sendRoomMessage` body + emit + return).

**Interfaces produced:** `POST /staff-chat/rooms/:id/messages` body now accepts optional `clientMessageId: string`; response `{ success, message?: { id, clientMessageId, createdAt }, error? }`; the MESSAGE_NEW/ROOM_UPDATE payload now includes `id` + `clientMessageId`.

- [ ] **Step 1: `saveMessage` accepts + writes the token** — In `room-manager.service.ts` `saveMessage` params (217–233), add `clientMessageId?: string;`. In the `create({ data: {...} })` (234), add `clientMessageId: params.clientMessageId,` alongside the other fields. (It already `return msg;` — no change there.)

- [ ] **Step 2: `sendStaffMessage` passes the token + returns the saved row** — In `message-router.service.ts`:
  - Widen the params type (450–454) with `clientMessageId?: string;`.
  - Widen the return type to `Promise<{ success: boolean; error?: string; message?: { id: string; clientMessageId: string | null; createdAt: Date } }>`.
  - Capture the save (466): `const saved = await this.roomManager.saveMessage({ roomId: params.roomId, role: MessageRole.STAFF, text: params.text, staffId: params.staffId, clientMessageId: params.clientMessageId });`
  - On the success return (495), include the row: `return { success: true, message: { id: saved.id, clientMessageId: saved.clientMessageId, createdAt: saved.createdAt } };`
  - Leave the failure returns (458/478/492) as-is (no `message`).

- [ ] **Step 3: controller accepts + echoes the token** — In `staff-chat.controller.ts` `sendRoomMessage` (138–166):
  - Body type → `@Body() body: { text: string; clientMessageId?: string }`.
  - Pass it: `const result = await this.messageRouter.sendStaffMessage({ roomId: id, staffId: req.user.id, text, clientMessageId: body?.clientMessageId });`
  - Emit the REAL row id + token (keep the emit unconditional as today — failure-emit behavior is pre-existing and out of scope; just enrich the payload):
    ```ts
    this.staffChatGateway.emitNewMessage(id, {
      id: result.message?.id,
      roomId: id,
      role: 'STAFF',
      staffId: req.user.id,
      text,
      clientMessageId: body?.clientMessageId,
      createdAt: result.message?.createdAt?.toISOString?.() ?? new Date().toISOString(),
    });
    ```
  - `return result;` (now carries `message`). Keep the empty-text early return (143) unchanged.

- [ ] **Step 4: Typecheck** — `./tools/check-types.sh api` → API OK.
- [ ] **Step 5: Commit** — `git add apps/api/src/modules/chat-engine/services/room-manager.service.ts apps/api/src/modules/chat-engine/services/message-router.service.ts apps/api/src/modules/staff-chat/staff-chat.controller.ts && git commit -m "feat(inbox): persist + echo clientMessageId on staff send"`

---

### Task 3: frontend — optimistic ghost keyed by clientMessageId

**Files:** Modify `apps/web/src/pages/UnifiedInboxPage/index.tsx` + `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx`.

- [ ] **Step 1: Replace the single pendingSend with a token-keyed array** — In `index.tsx`, change the state (78):

```tsx
const [pendingSends, setPendingSends] = useState<
  { clientMessageId: string; roomId: string; text: string }[]
>([]);
```

- [ ] **Step 2: Generate the token + push/pop in `sendRoomMessage`** — Rewrite `sendRoomMessage` (276–303) to push an optimistic entry, POST with the token, and let reconciliation clear it on success / remove + FAILED on failure:

```tsx
const sendRoomMessage = async (text: string): Promise<boolean> => {
  const roomId = activeRoomId;
  if (!roomId) return false;
  const clientMessageId = crypto.randomUUID();
  // Optimistic "กำลังส่ง" ghost — removed when the saved row (same token) lands
  // in the list, or on failure (replaced by a FAILED ghost).
  setPendingSends((prev) => [...prev, { clientMessageId, roomId, text }]);
  const removePending = () =>
    setPendingSends((prev) => prev.filter((p) => p.clientMessageId !== clientMessageId));
  try {
    const res = await api.post(`/staff-chat/rooms/${roomId}/messages`, { text, clientMessageId });
    const data = res.data;
    if (data && data.success === false) {
      removePending();
      pushFailedSend(roomId, text, 'http');
      return false;
    }
    // Success — keep the ghost until the refetched row carries the token, then
    // the reconciliation effect prunes it. Trigger the refetch now.
    queryClient.invalidateQueries({ queryKey: ['chat-messages', roomId] });
    return true;
  } catch {
    removePending();
    pushFailedSend(roomId, text, 'http');
    return false;
  }
};
```

- [ ] **Step 3: Reconciliation effect** — Add (near the other effects, after `messagesQuery` is defined) an effect that prunes optimistic entries once their saved row is in the active room's list:

```tsx
// Drop optimistic ghosts whose saved row (matched by clientMessageId) has
// arrived in the message list. Belt to ChatPanel's display-time filter.
useEffect(() => {
  const msgs = messagesQuery.data;
  if (!Array.isArray(msgs) || !activeRoomId) return;
  const landed = new Set(
    msgs.map((m: any) => m.clientMessageId).filter((id: unknown): id is string => !!id),
  );
  if (landed.size === 0) return;
  setPendingSends((prev) =>
    prev.filter((p) => !(p.roomId === activeRoomId && landed.has(p.clientMessageId))),
  );
}, [messagesQuery.data, activeRoomId]);
```

- [ ] **Step 4: Pass the array to ChatPanel** — Replace the `pendingSendText={...}` prop (421) with:

```tsx
pendingSends={pendingSends.filter((p) => p.roomId === activeRoomId)}
```

- [ ] **Step 5: ChatPanel — accept the array + render multiple ghosts, hide reconciled** — In `ChatPanel.tsx`:
  - Replace the prop (111) `pendingSendText?: string | null;` with `pendingSends?: { clientMessageId: string; text: string }[];` and update the destructure (141).
  - Replace the single-ghost render (701–710) with a filtered map (hide any whose token is already a real row — defends against the async prune lag):

```tsx
{(pendingSends ?? [])
  .filter((p) => !messages.some((m: any) => m.clientMessageId === p.clientMessageId))
  .map((p) => (
    <div key={p.clientMessageId} className="flex justify-end px-4 py-1">
      <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-primary/70 px-3 py-2 text-sm text-primary-foreground">
        <span className="whitespace-pre-wrap leading-snug">{p.text}</span>
        <span className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-primary-foreground/80 leading-snug">
          <Loader2 className="size-3 animate-spin" /> กำลังส่ง
        </span>
      </div>
    </div>
  ))}
```

(Match the actual existing ghost markup — read lines 701–710 and reuse its exact bubble classes so the optimistic bubble is visually identical to the prior single ghost; only the wrapper becomes a `.map` keyed on `clientMessageId`. The snippet above is the intended structure; prefer the existing class strings if they differ.)

- [ ] **Step 6: Typecheck + tests** — `./tools/check-types.sh web` → Web OK; `cd apps/web && npx vitest run` → existing suite green (no test references `pendingSendText`; if any does, update it to `pendingSends`).
- [ ] **Step 7: Manual verification** — (1) Send a message → it appears instantly as a "กำลังส่ง" bubble, then becomes a normal bubble in the same spot with no flicker/vanish. (2) Send 3 quickly → 3 ghosts, each resolves as its row lands. (3) Kill the network → send → the ghost is replaced by a FAILED ghost with retry (Batch 7 behavior intact); retry re-sends (fresh token). (4) A second staff in the room sees the message via the WS refetch as before.
- [ ] **Step 8: Commit** — `git add apps/web/src/pages/UnifiedInboxPage/index.tsx apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx && git commit -m "feat(inbox): optimistic send ghost keyed by clientMessageId"`

---

## Self-Review
**Coverage:** column+migration (T1) → save/echo (T2) → optimistic ghost reconciliation (T3). **Migration safety:** nullable TEXT, no default, no index = instant; manual timestamp `20260975000000` sorts after `20260974000000`; applied to dev via `migrate deploy`, to prod via the pipeline's migrate-deploy job. **No regression:** failure path = Batch 7 (FAILED + retry, fresh token); IME/draft/auto-grow/collision/staff-typing untouched; emit stays unconditional (pre-existing); `getRecentMessages` already returns the column (no `select`, preserved by `signMessageMedia` spread). **Reconciliation:** ghost shows from send until the saved row (same token) is in `messages` — no timing gap; display-time filter in ChatPanel + state-prune effect both key on `clientMessageId`; multiple in-flight sends each resolve independently (Batch 7's text+roomId match couldn't). **Scope guard:** no `@@unique`, no backend dedup, no save-rollback — justified by save-before-deliver semantics. **Types:** `saveMessage` returns the row; `sendStaffMessage` returns `{success, message?}`; `createdAt` is a `Date` → `.toISOString()` in the emit; `crypto.randomUUID()` is built-in.

## Rollout
One branch (`feat/inbox-optimistic-send`) → 3 commits → final whole-branch review (opus) → merge → deploy (runs the migration) → user verifies the SENDING→SENT transition.
