# Inbox Fix G — perf hygiene — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Cut the inbox's wasted re-renders, redundant polling/refetch storms, and repeated media presigning — the verified perf findings. Behavior is unchanged; only efficiency improves.

**Architecture:** Four independent fixes. (1) Memoize the two list/thread row components so unchanged rows skip re-render. (2) Stop the 5s thread poll while the WS is healthy + resync caches on reconnect + coalesce the inbox-wide rooms-list invalidation. (3) Cache presigned media URLs by key so a 5s poll doesn't re-sign the same objects.

**Tech Stack:** React 18 + @tanstack/react-query + socket.io (web); NestJS + GCS/S3 presign (api).

## Global Constraints
- No behavior change — these are memoization, polling cadence, and caching changes only. Keep all UI/logic identical.
- React Query v5 uses structural sharing, so unchanged message/room objects keep their reference across refetches (memo-friendly).
- Prettier (semi, singleQuote, printWidth 100, tabWidth 2). Verify: `./tools/check-types.sh api` + `./tools/check-types.sh web` + `cd apps/web && npx vitest run`.
- Do NOT touch the optimistic-send / staff-typing / transfer / a11y logic. Do NOT change the message-query `limit: 100` or the rooms query shape.

## Verified current-state facts
- `MessageBubble.tsx:85` `export default function MessageBubble({ message, customerAvatar, customerInitial })` — props are a structural-shared `message` object + 2 primitive strings; NO callbacks. ChatPanel passes `customerAvatar={avatarUrl || undefined}` + `customerInitial={displayName[0]}` (~704). → `React.memo` works with no parent change.
- `ConversationItem.tsx:148` `export default function ConversationItem({ session, isActive, onClick, onPin, aiSettings })`. `ConversationList.tsx:357-366` renders it with INLINE `onClick={() => onSelectRoom(session.id)}` + `onPin={(roomId, isPinned) => pinMutation.mutate({ roomId, isPinned })}` — both new refs every render → memo would never hit. Must pass stable callbacks.
- `index.tsx`: `handleSelectRoom` is a `useCallback` (279) → already stable; passed as `onSelectRoom={handleSelectRoom}` (398). `messagesQuery` (172-182) `refetchInterval: 5000` (no WS gate). `onNewMessage` (108-116) invalidates `['chat-messages', data.roomId]` + `['chat-rooms']` + `['chat-unread-count']`; `onRoomUpdate` (117-128) invalidates `['chat-rooms']` + `['chat-unread-count']`. `connectionStatus` is in scope. `useState/useCallback/useEffect/useRef` already imported.
- `useChatSocket.ts:129-137` `socket.on('connect', ...)` re-joins/re-views the active room but does NOT invalidate any cache (no resync after a drop). `eventsRef` holds the latest event handlers (handlers see current closures). `activeRoomIdRef` mirrors activeRoomId.
- `storage.service.ts` `getSignedDownloadUrl(key, expiresIn = 900)` — GCS `file.getSignedUrl({action:'read', expires: Date.now()+expiresIn*1000})` or S3 `getSignedUrl(...)`. Called with `expiresIn=3600` by chat media signing on every `getRecentMessages` (every 5s poll). No caching.

---

### Task 1: memoize MessageBubble

**Files:** Modify `apps/web/src/pages/UnifiedInboxPage/components/MessageBubble.tsx`.

- [ ] **Step 1: Wrap in React.memo** — Rename the function to a named declaration and export a memoized version. Change line 85 from `export default function MessageBubble({...}: MessageBubbleProps) {` to `function MessageBubble({...}: MessageBubbleProps) {`, and at the END of the file add:

```tsx
export default memo(MessageBubble);
```

Add `memo` to the React import at the top (e.g. `import { memo, ... } from 'react'` — match the existing import style; if the file has no React import for hooks, add `import { memo } from 'react';`).

- [ ] **Step 2: Typecheck** — `./tools/check-types.sh web` → Web OK.
- [ ] **Step 3: Commit** — `git add apps/web/src/pages/UnifiedInboxPage/components/MessageBubble.tsx && git commit -m "perf(inbox): memoize MessageBubble (skip re-render of unchanged bubbles)"`

---

### Task 2: memoize ConversationItem + stabilize its callbacks

**Files:** Modify `apps/web/src/pages/UnifiedInboxPage/components/ConversationItem.tsx` + `apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx`.

- [ ] **Step 1: ConversationItem takes a stable `onSelect(roomId)` + memo** — In `ConversationItem.tsx`: change the prop `onClick: () => void` to `onSelect: (roomId: string) => void` in the `ConversationItemProps` interface and the destructure (148). Replace the internal click handler that called `onClick()` with `onSelect(session.id)` (find where `onClick` is invoked — likely the root row `onClick={onClick}` → change to `onClick={() => onSelect(session.id)}`). Leave `onPin: (roomId: string, isPinned: boolean) => void` as-is. At the file end, wrap the export: change `export default function ConversationItem(...)` to `function ConversationItem(...)` and add `export default memo(ConversationItem);`. Add `memo` to the react import.

- [ ] **Step 2: ConversationList passes stable callbacks** — In `ConversationList.tsx`: wrap the pin handler in a stable callback near the other hooks: `const handlePin = useCallback((roomId: string, isPinned: boolean) => pinMutation.mutate({ roomId, isPinned }), [pinMutation]);` (add `useCallback` to the react import if missing; `pinMutation` from `useMutation` is stable). Change the render (357-366) to pass stable refs:

```tsx
<ConversationItem
  session={session}
  isActive={session.id === activeRoomId}
  onSelect={onSelectRoom}
  onPin={handlePin}
  aiSettings={aiSettings}
/>
```

(`onSelectRoom` is the stable `handleSelectRoom` from index.tsx. Remove the now-unused inline `onClick`/`onPin` arrows.)

- [ ] **Step 3: Typecheck** — `./tools/check-types.sh web` → Web OK.
- [ ] **Step 4: Commit** — `git add apps/web/src/pages/UnifiedInboxPage/components/ConversationItem.tsx apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx && git commit -m "perf(inbox): memoize ConversationItem with stable onSelect/onPin callbacks"`

---

### Task 3: WS-gate the poll + resync on reconnect + coalesce the rooms invalidation

**Files:** Modify `apps/web/src/pages/UnifiedInboxPage/index.tsx` + `apps/web/src/pages/UnifiedInboxPage/hooks/useChatSocket.ts`.

- [ ] **Step 1: Gate the 5s thread poll on WS health** — In `index.tsx` `messagesQuery` (181), change `refetchInterval: 5000` to:

```tsx
refetchInterval: connectionStatus === 'connected' ? 30000 : 5000,
```

(When the WS is healthy, WS invalidation is the primary path — keep only a slow 30s safety net; when the WS is down, fall back to the 5s poll.)

- [ ] **Step 2: Coalesce the inbox-wide rooms invalidation** — In `index.tsx`, add a debounced invalidator above the `useChatSocket` call:

```tsx
const roomsInvalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
const invalidateRoomsListSoon = useCallback(() => {
  if (roomsInvalidateTimer.current) clearTimeout(roomsInvalidateTimer.current);
  roomsInvalidateTimer.current = setTimeout(() => {
    queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
    queryClient.invalidateQueries({ queryKey: ['chat-unread-count'] });
  }, 600);
}, [queryClient]);
```

In `onNewMessage` (108-116): keep the IMMEDIATE `invalidateQueries({ queryKey: ['chat-messages', data.roomId] })` (the open thread must update instantly), but replace the two `['chat-rooms']`/`['chat-unread-count']` invalidations with a single `invalidateRoomsListSoon();`. Keep the `notifyNewMessage` block. In `onRoomUpdate` (117-128): replace the two invalidations with `invalidateRoomsListSoon();`; keep the notify block.

- [ ] **Step 3: Resync caches on WS reconnect** — In `useChatSocket.ts`, add a reconnect signal. Add a `hasConnectedRef = useRef(false)` near the other refs. In the `socket.on('connect', ...)` handler (129), after the re-join/re-view, fire a reconnect callback only on a RE-connect (not the first connect):

```ts
if (hasConnectedRef.current) {
  eventsRef.current.onReconnect?.();
}
hasConnectedRef.current = true;
```

Add `onReconnect?: () => void;` to the `ChatSocketEvents` interface. In `index.tsx`, wire it in the `useChatSocket({...})` events object:

```tsx
onReconnect: () => {
  // After a transient drop we missed live events — pull fresh state.
  if (activeRoomId) queryClient.invalidateQueries({ queryKey: ['chat-messages', activeRoomId] });
  queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
  queryClient.invalidateQueries({ queryKey: ['chat-unread-count'] });
},
```

- [ ] **Step 4: Typecheck** — `./tools/check-types.sh web` → Web OK.
- [ ] **Step 5: Commit** — `git add apps/web/src/pages/UnifiedInboxPage/index.tsx apps/web/src/pages/UnifiedInboxPage/hooks/useChatSocket.ts && git commit -m "perf(inbox): WS-gate the thread poll, coalesce rooms invalidation, resync on reconnect"`

---

### Task 4: cache presigned media URLs by key

**Files:** Modify `apps/api/src/modules/storage/storage.service.ts`.

- [ ] **Step 1: Add a small TTL cache around getSignedDownloadUrl** — Cache the signed URL per `key:expiresIn` and reuse it until shortly before the signature expires, so repeated polls reuse the URL instead of re-signing. Add a private field + wrap the existing logic:

```ts
// In the class body (near other private fields):
private signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
private static readonly SIGNED_URL_CACHE_MAX = 1000;
```

Refactor `getSignedDownloadUrl` so the existing GCS/S3 signing becomes an inner step, fronted by the cache:

```ts
async getSignedDownloadUrl(key: string, expiresIn = 900): Promise<string> {
  const cacheKey = `${key}:${expiresIn}`;
  const now = Date.now();
  const hit = this.signedUrlCache.get(cacheKey);
  if (hit && hit.expiresAt > now) return hit.url;

  const url = await this.signDownloadUrl(key, expiresIn); // the original signing body

  // Reuse for 80% of the signature lifetime (leaves a safety margin before expiry).
  if (this.signedUrlCache.size >= StorageService.SIGNED_URL_CACHE_MAX) {
    const oldest = this.signedUrlCache.keys().next().value;
    if (oldest !== undefined) this.signedUrlCache.delete(oldest);
  }
  this.signedUrlCache.set(cacheKey, { url, expiresAt: now + expiresIn * 1000 * 0.8 });
  return url;
}

private async signDownloadUrl(key: string, expiresIn: number): Promise<string> {
  if (this.backend === 'gcs' && this.gcs) {
    const file = this.gcs.bucket(this.bucket).file(key);
    const [url] = await file.getSignedUrl({ action: 'read', expires: Date.now() + expiresIn * 1000 });
    return url;
  }
  if (this.backend === 's3' && this.s3) {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.s3, command, { expiresIn });
  }
  throw new BadRequestException('Storage not configured');
}
```

(Move the EXACT existing GCS/S3/throw body into `signDownloadUrl` unchanged — only the caching wrapper is new. The `BadRequestException` for not-configured still throws and is NOT cached.)

- [ ] **Step 2: Typecheck** — `./tools/check-types.sh api` → API OK.
- [ ] **Step 3: Run storage spec** — `cd apps/api && npx jest storage.service --runInBand` → green (the existing not-configured + signed-url tests still pass; caching is transparent).
- [ ] **Step 4: Commit** — `git add apps/api/src/modules/storage/storage.service.ts && git commit -m "perf(inbox): cache presigned download URLs by key to avoid re-signing every poll"`

---

## Self-Review
**Coverage:** memo MessageBubble (T1) + memo ConversationItem w/ stable callbacks (T2) + WS-gate poll + coalesce invalidation + reconnect resync (T3) + presign cache (T4). **No behavior change:** memo is transparent (structural sharing keeps refs stable); the poll still runs (30s) when WS healthy + 5s when down so nothing is missed; the rooms list still updates (debounced 600ms); reconnect now resyncs (was a real staleness gap); the presign cache returns the SAME valid URL within 80% of its TTL. **Memo correctness:** MessageBubble props are primitives + structural-shared object (no parent change needed); ConversationItem now gets stable `onSelect`(=handleSelectRoom useCallback) + `onPin`(=handlePin useCallback) + structural-shared session/aiSettings. **Cache safety:** keyed by `key:expiresIn`; 80% TTL leaves margin before the URL actually expires; size-capped at 1000 with oldest-eviction; not-configured still throws (uncached). **Risk:** the reconnect resync fires only on RE-connect (hasConnectedRef guard), not the initial connect (which already loads via the queries).

## Rollout
One branch (`perf/inbox-hygiene`) → 4 commits → review → merge → deploy.
