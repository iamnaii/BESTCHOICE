# Inbox Fix J — DB-level send idempotency (exactly-once retry) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A retry of a failed send must NEVER double-send to the customer when the first attempt actually delivered, and MUST deliver when the first attempt did not. Today a retry generates a fresh clientMessageId and re-runs the whole flow → if the original adapter delivery succeeded but the HTTP response was lost, the retry double-sends to the customer.

**Architecture:** Add a DB uniqueness key on `(roomId, clientMessageId)` and a delivery flag `outboundSentAt` (null = our adapter has NOT confirmed delivery to the customer). `sendStaffMessage` becomes idempotent on `clientMessageId`: look up the existing row; if it's already delivered (`outboundSentAt != null`) return it without re-saving or re-sending; if it exists but undelivered, re-attempt the adapter delivery on the SAME row; otherwise save + send fresh. A `@@unique` race-guard catches concurrent duplicates (P2002 → treat as the existing-row case). The frontend retry REUSES the failed message's `clientMessageId` so the backend can dedup.

**Why not reuse `deliveryStatus`:** the `ChatMessageDeliveryStatus` enum is engagement state (DELIVERED/READ/RESPONDED/NO_ENGAGEMENT) populated from LINE webhooks — it means "the customer's device/eyes," not "our adapter call succeeded." A dedicated `outboundSentAt` keeps the two concerns separate.

**Builds on Batch D** (clientMessageId correlation token). This UPGRADES it from a frontend-only token to a DB idempotency key.

**Tech Stack:** Prisma + NestJS (api); React 18 (web).

## Global Constraints
- DB: nullable column + a `@@unique([roomId, clientMessageId])` (existing rows have clientMessageId=NULL; Postgres NULLS-DISTINCT allows many nulls per room → safe on populated data). Hand-written migration, manual timestamp `20260976000000` (after `20260975000000`). `prisma migrate deploy` + `prisma generate`.
- No new deps; `crypto.randomUUID()` built-in. Prettier (semi, singleQuote, printWidth 100, tabWidth 2).
- Verify: `./tools/check-types.sh api` + `./tools/check-types.sh web` + `cd apps/api && npx jest message-router --runInBand` (if a spec exists; else skip) + `cd apps/web && npx vitest run`.
- Do NOT change the WS `handleSendMessage` path's behavior beyond what's needed (it sends without a clientMessageId — leave it un-idempotent; the inbox uses the HTTP POST path). Do NOT touch staff-typing / filters / pagination.

## Verified current-state facts
- `ChatMessage` already has `clientMessageId String? @map("client_message_id")` (Batch D, migration 20260975000000) + `deliveredAt`/`readAt`/`deliveryStatus` (engagement). Table `chat_messages`.
- `message-router.service.ts` `sendStaffMessage({roomId, staffId, text, clientMessageId?})` (450): saves via `roomManager.saveMessage({..., clientMessageId})` (capturing `saved`), then `adapter.sendMessage(...)`; on adapter failure returns `{success:false, error}` WITHOUT rollback; success returns `{success:true, message:{id, clientMessageId, createdAt}}`. NO existence/idempotency check.
- `room-manager.service.ts` `saveMessage(params)` → `prisma.chatMessage.create(...)` returns `msg`. `getRecentMessages` returns full rows (clientMessageId + any new column flow to the client via `signMessageMedia` spread).
- `staff-chat.controller.ts` `sendRoomMessage` (138) reads `body.clientMessageId`, passes it, emits the real row id + token, returns `result`.
- `index.tsx` (Batch D): `pendingSends: {clientMessageId, roomId, text}[]`; `sendRoomMessage(text)` generates `crypto.randomUUID()` internally; `failedSends: {id, roomId, text, source}[]`; `pushFailedSend(roomId, text, source)`; `retrySend(failedId, text)` re-calls `sendRoomMessageRef.current(text)` → a FRESH token. ChatPanel FAILED ghost calls `onRetrySend(f.id, f.text)`.

---

### Task 1: schema + migration — unique key + outboundSentAt

**Files:** Modify `apps/api/prisma/schema.prisma`; Create `apps/api/prisma/migrations/20260976000000_chat_message_send_idempotency/migration.sql`.

- [ ] **Step 1: Schema** — In `model ChatMessage`, add the delivery flag near `deliveredAt`:

```prisma
  /// Set when our outbound adapter call (LINE/FB/etc.) confirmed the message was
  /// sent to the customer. NULL = not yet delivered (a saved-but-undelivered row,
  /// e.g. adapter failure) — a retry with the same clientMessageId re-attempts
  /// delivery; a non-NULL value means a retry must NOT re-send (idempotent).
  outboundSentAt DateTime? @map("outbound_sent_at")
```

And add a unique constraint (idempotency key) in the model's attribute block (near other `@@index`/`@@unique`):

```prisma
  @@unique([roomId, clientMessageId])
```

- [ ] **Step 2: Migration** — Create `apps/api/prisma/migrations/20260976000000_chat_message_send_idempotency/migration.sql`:

```sql
-- Outbound delivery flag (our adapter confirmed send to the customer).
ALTER TABLE "chat_messages" ADD COLUMN "outbound_sent_at" TIMESTAMP(3);

-- Idempotency key: at most one message per (room, clientMessageId). Existing
-- rows have NULL client_message_id; Postgres treats NULLs as distinct, so the
-- many historical NULLs per room do not collide.
CREATE UNIQUE INDEX "chat_messages_room_id_client_message_id_key"
  ON "chat_messages" ("room_id", "client_message_id");
```

- [ ] **Step 3: Apply + generate** — from `apps/api`: `npx prisma migrate deploy` (expect 20260976000000 applied) + `npx prisma generate`. If migrate can't connect → STOP, report BLOCKED.

- [ ] **Step 4: Typecheck** — `./tools/check-types.sh api` → API OK.
- [ ] **Step 5: Commit** — `git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260976000000_chat_message_send_idempotency && git commit -m "feat(inbox): chat message send-idempotency key + outboundSentAt flag"`

---

### Task 2: backend — idempotent sendStaffMessage

**Files:** Modify `room-manager.service.ts` (lookup helper + mark-sent) + `message-router.service.ts` (idempotency flow).

- [ ] **Step 1: room-manager helpers** — Add two methods (after `saveMessage`):

```ts
/** Look up an existing message by its client-generated idempotency token. */
async findByClientMessageId(roomId: string, clientMessageId: string) {
  return this.prisma.chatMessage.findFirst({
    where: { roomId, clientMessageId },
  });
}

/** Mark a message as successfully delivered to the customer (idempotency flag). */
async markOutboundSent(messageId: string): Promise<void> {
  await this.prisma.chatMessage.update({
    where: { id: messageId },
    data: { outboundSentAt: new Date() },
  });
}
```

- [ ] **Step 2: idempotent sendStaffMessage** — In `message-router.service.ts` `sendStaffMessage`, restructure to: (a) on a provided `clientMessageId`, short-circuit an already-delivered row; (b) re-use an existing undelivered row instead of creating a duplicate; (c) catch the `@@unique` race. Replace the save+send body with:

```ts
async sendStaffMessage(params: {
  roomId: string;
  staffId: string;
  text: string;
  clientMessageId?: string;
}): Promise<{ success: boolean; error?: string; message?: { id: string; clientMessageId: string | null; createdAt: Date } }> {
  const room = await this.roomManager.findById(params.roomId);
  if (!room) {
    this.logger.error(`Room not found: ${params.roomId}`);
    return { success: false, error: 'Room not found' };
  }
  const externalUserId = room.externalUserId ?? room.lineUserId ?? '';
  const adapter = this.adapterMap.get(room.channel);
  if (!adapter) {
    const error = `No adapter registered for channel ${room.channel}`;
    this.logger.error(error);
    return { success: false, error };
  }

  // Idempotency: reuse the row for this clientMessageId if it already exists.
  let saved = params.clientMessageId
    ? await this.roomManager.findByClientMessageId(params.roomId, params.clientMessageId)
    : null;

  if (saved?.outboundSentAt) {
    // Already delivered on a prior attempt — do NOT re-send to the customer.
    return {
      success: true,
      message: { id: saved.id, clientMessageId: saved.clientMessageId, createdAt: saved.createdAt },
    };
  }

  if (!saved) {
    try {
      saved = await this.roomManager.saveMessage({
        roomId: params.roomId,
        role: MessageRole.STAFF,
        text: params.text,
        staffId: params.staffId,
        clientMessageId: params.clientMessageId,
      });
    } catch (e: any) {
      // Unique-race: a concurrent identical send won. Re-fetch + fall through.
      if (e?.code === 'P2002' && params.clientMessageId) {
        saved = await this.roomManager.findByClientMessageId(params.roomId, params.clientMessageId);
        if (saved?.outboundSentAt) {
          return {
            success: true,
            message: { id: saved.id, clientMessageId: saved.clientMessageId, createdAt: saved.createdAt },
          };
        }
      } else {
        throw e;
      }
    }
  }

  if (!saved) {
    return { success: false, error: 'save failed' };
  }

  const result = await adapter.sendMessage({
    externalUserId,
    channel: room.channel,
    type: 'TEXT' as any,
    text: params.text,
  });

  if (!result.success) {
    this.logger.error(`Failed to send staff message on ${room.channel}: ${result.error}`);
    return { success: false, error: result.error ?? 'send failed' };
  }

  // Delivered — stamp the idempotency flag so a retry won't re-send.
  await this.roomManager.markOutboundSent(saved.id);
  return {
    success: true,
    message: { id: saved.id, clientMessageId: saved.clientMessageId, createdAt: saved.createdAt },
  };
}
```

(Imports already present: MessageRole. The `room.externalUserId/lineUserId` + adapter resolution were already in the method — keep them as shown.)

- [ ] **Step 3: Typecheck** — `./tools/check-types.sh api` → API OK.
- [ ] **Step 4: Commit** — `git add apps/api/src/modules/chat-engine/services/room-manager.service.ts apps/api/src/modules/chat-engine/services/message-router.service.ts && git commit -m "feat(inbox): idempotent staff send — dedup by clientMessageId, re-deliver undelivered, skip delivered"`

---

### Task 3: frontend — retry reuses the clientMessageId

**Files:** Modify `apps/web/src/pages/UnifiedInboxPage/index.tsx` + `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx`.

- [ ] **Step 1: Thread clientMessageId through send + failure** — In `index.tsx`:
  - `failedSends` type → add `clientMessageId: string`: `{ id: string; roomId: string; text: string; source: 'http' | 'ws'; clientMessageId: string }[]`.
  - `pushFailedSend` → add a `clientMessageId` param: `pushFailedSend(roomId, text, source, clientMessageId)`; include it in the entry.
  - `sendRoomMessage` → accept an optional reuse token: `const sendRoomMessage = async (text: string, reuseClientMessageId?: string): Promise<boolean> => { ... const clientMessageId = reuseClientMessageId ?? crypto.randomUUID(); ... }` and pass `clientMessageId` to `pushFailedSend(roomId, text, 'http', clientMessageId)` on both failure paths.
  - The WS `onSendFailed` path (`pushFailedSend(data.roomId, data.text, 'ws')`): the WS send has no clientMessageId, so pass `''` (or the data's if present) — a `''` token means retry generates a fresh one (no idempotency for the WS-origin failure, acceptable).

- [ ] **Step 2: retrySend reuses the token** — `retrySend` currently `(failedId, text)`. Change it to look up the failed entry's `clientMessageId` and reuse it:

```tsx
const retrySend = useCallback(
  (failedId: string, text: string) => {
    setFailedSends((prev) => {
      const entry = prev.find((f) => f.id === failedId);
      const reuse = entry?.clientMessageId || undefined;
      void sendRoomMessageRef.current(text, reuse);
      return prev.filter((f) => f.id !== failedId);
    });
  },
  [],
);
```

(Keep the `sendRoomMessageRef` indirection from Batch 7 — the ref already points at the latest `sendRoomMessage`, which now accepts the 2nd arg.)

- [ ] **Step 3: ChatPanel passes it through unchanged** — `onRetrySend(f.id, f.text)` is unchanged (retrySend looks the token up by id internally). No ChatPanel change needed unless the FAILED-ghost type references clientMessageId — it does not.

- [ ] **Step 4: Typecheck + tests** — `./tools/check-types.sh web` → Web OK; `cd apps/web && npx vitest run` → green.

- [ ] **Step 5: Manual verification** — fail a send (kill network) → FAILED ghost → retry: the SAME clientMessageId is sent; if the first attempt had actually delivered to the customer, the customer does NOT get a duplicate (backend returns the existing delivered row); if it hadn't, the customer gets it once. Normal first-time sends still get a fresh token + deliver once.

- [ ] **Step 6: Commit** — `git add apps/web/src/pages/UnifiedInboxPage/index.tsx apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx && git commit -m "feat(inbox): retry reuses clientMessageId so the backend dedups (no double-send)"`

---

## Self-Review
**Coverage:** unique key + outboundSentAt (T1) → idempotent sendStaffMessage (T2) → retry reuses the token (T3). **Exactly-once-ish:** delivered row (outboundSentAt set) → skip re-send; undelivered row → re-attempt on the SAME row (no dup row, no dup customer message); fresh → save+send+stamp. **Race:** `@@unique([roomId,clientMessageId])` + P2002 catch → concurrent identical sends converge on one row. **Residual (documented):** a crash in the narrow window between adapter-success and `markOutboundSent` leaves outboundSentAt null on a delivered message → a retry would re-send once (true exactly-once is impossible over an unreliable adapter; this is far better than today's always-dup-on-retry). **Migration safety:** nullable column + unique index where existing client_message_id is NULL (NULLS DISTINCT → no collision) → instant, safe on populated `chat_messages`. **No regression:** first-time sends unchanged (fresh token, one delivery); the WS send path stays un-idempotent (no clientMessageId — unchanged); the Batch-D optimistic ghost + Batch-7 FAILED/retry UX intact (retry now reuses the token). **Scope:** WS `handleSendMessage` left as-is.

## Rollout
One branch (`feat/inbox-send-idempotency`) → 3 commits → review → merge → deploy (runs the migration). Ship AFTER Batch I.
