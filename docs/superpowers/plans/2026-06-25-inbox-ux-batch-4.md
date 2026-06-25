# Inbox UX Batch 4 — Realtime — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the inbox's realtime state legible and controllable — a WebSocket connection-status pill, a persistent "another staff is viewing this room" banner (so two staff don't double-reply), and a notification mute toggle (global + per-room) with permission requested only on a user gesture.

**Architecture:** Almost entirely frontend — the staff-chat WS gateway already tracks per-room viewers/presence/collision and broadcasts `chat:viewers`/`chat:collision`/`chat:presence`. The hook (`useChatSocket`) already surfaces those callbacks; the page just doesn't use the persistent ones. Three frontend changes wire/add UI, plus one ~6-line backend fix so the viewer list re-broadcasts on disconnect (otherwise the persistent banner shows a ghost viewer after a staff closes their tab).

**Tech Stack:** Frontend: React 18 + TypeScript + Tailwind v4 + socket.io-client + lucide-react + sonner (vitest). Backend: NestJS WebSocket gateway + an in-memory `CollisionDetectionService` (jest).

## Global Constraints

- Design tokens only — no hardcoded hex/gray (note: existing `text-amber-*`/`text-emerald-*` AI badges are pre-existing, out of scope).
- No new dependencies.
- Thai user-facing copy; `leading-snug` on multi-word Thai.
- Notification preference is a **per-device client preference** (localStorage) — no server persistence in scope.
- Prettier: semi true, singleQuote true, printWidth 100, tabWidth 2.
- Verify: backend `cd apps/api && npx jest <spec> --runInBand` (api specs flaky in parallel — always `--runInBand`) + `./tools/check-types.sh api`; frontend `./tools/check-types.sh web` + `npx vitest run <spec>`.

## Deferred (NOT in this batch — flagged honestly)

- **Staff-typing indicator ("พนักงานอื่นกำลังพิมพ์").** The relay exists in the gateway (`chat:typing:start`/`stop` → broadcast `chat:typing` to other room staff) but: nothing in the composer calls `startTyping`/`stopTyping` today, and the typing payload omits `role`, so the hook can't distinguish staff-typing from the (unused) customer-typing path (`useChatSocket.ts:132` keys on `role !== 'STAFF'`). Wiring it needs a backend payload fix (`role:'STAFF'`) + composer debounced emit + a hook restructure. The collision banner (Task 3) already delivers the core "someone else is in this room" signal, so staff-typing is deferred as a follow-up.

## Verified current-state facts (from the understanding sweep — do not re-derive)

- **`useChatSocket.ts`** (`apps/web/src/pages/UnifiedInboxPage/hooks/`): the socket is created in a `useEffect` keyed `[user?.id]` (98–153). It registers `connect` (119–125, re-joins+re-views the active room), `chat:message:new` (127), `chat:room:update` (128), `chat:typing` (129–137, drives `isCustomerTyping` w/ a 5s timeout), `chat:presence` (138), `chat:viewers` (139 → `onViewers`), `chat:collision` (140 → `onCollision`), `chat:message:send-failed` (141), `connect_error` (144, silent). It returns `{ joinRoom, leaveRoom, sendMessage, startTyping, stopTyping, viewRoom, isCustomerTyping }` (179) — **no connection status**. `reconnectionAttempts: 3`, `reconnectionDelay: 3000` (107–108).
- **`index.tsx`**: requests `Notification.requestPermission()` **on mount** (36–40); `notifyNewMessage` (43–63) plays a sound **unconditionally** (45–49) then shows a `new Notification(...)` gated on `Notification.permission === 'granted' && data.roomId !== activeRoomId`, deduped by `tag: chat-${roomId}` (60). `useChatSocket` is consumed (73–103) with `onNewMessage`/`onRoomUpdate` (fire `notifyNewMessage` for CUSTOMER messages), `onCollision` → **`toast.warning(...)`** (95–98, ephemeral), `onSendFailed` → toast. `onViewers`/`onPresence`/`onTyping` are **not passed**. `user` from `useAuth` (26). Sound URL is an inline data-URI (14).
- **`ConversationList.tsx`**: top header area is `<div className="px-4 pt-3 pb-0">` wrapping the search `<div className="relative mb-2">` (129–143). Props include `currentUserId`.
- **Backend** `apps/api/src/modules/staff-chat/staff-chat.gateway.ts`: `handleDisconnect` (113–131) calls `presenceService.setOffline` + `collisionDetectionService.removeViewerFromAll(userId)` + emits `PRESENCE offline` to INBOX — but does **NOT** re-broadcast `chat:viewers` to the rooms the user was viewing. `handleViewRoom`/`handleLeaveRoom` DO re-broadcast `VIEWERS`. Events/rooms come from `chat-engine/constants/chat-events.ts` (`CHAT_EVENTS.VIEWERS = 'chat:viewers'`, `CHAT_ROOMS.room(roomId)`).
- **`CollisionDetectionService`** (`apps/api/src/modules/staff-chat/services/collision-detection.service.ts`): `viewerMap = Map<sessionId, Map<userId,{userName,since}>>` (14); `removeViewerFromAll(userId)` (39) currently returns `void`; `getViewers(sessionId)` (48) returns `{userId,userName,since}[]`; `isCollision(sessionId, excludeUserId)` (60).

---

### Task 1 (backend): Re-broadcast room viewers on disconnect

**Files:**
- Modify: `apps/api/src/modules/staff-chat/services/collision-detection.service.ts` (`removeViewerFromAll`, 39)
- Test: `apps/api/src/modules/staff-chat/services/collision-detection.service.spec.ts` (create if absent, or add a case)
- Modify: `apps/api/src/modules/staff-chat/staff-chat.gateway.ts` (`handleDisconnect`, 113–131)

**Interfaces:**
- Produces: `removeViewerFromAll(userId: string): string[]` — now returns the list of sessionIds (roomIds) the user was removed from.

- [ ] **Step 1: Write the failing test**

Read the existing `collision-detection.service.spec.ts` if present; otherwise create `apps/api/src/modules/staff-chat/services/collision-detection.service.spec.ts`:

```ts
import { CollisionDetectionService } from './collision-detection.service';

describe('CollisionDetectionService.removeViewerFromAll', () => {
  it('removes the user from every room and returns the affected roomIds', () => {
    const svc = new CollisionDetectionService();
    svc.addViewer('roomA', 'u1', 'Alice');
    svc.addViewer('roomB', 'u1', 'Alice');
    svc.addViewer('roomB', 'u2', 'Bob');

    const affected = svc.removeViewerFromAll('u1');

    expect(affected.sort()).toEqual(['roomA', 'roomB']);
    expect(svc.getViewers('roomA')).toHaveLength(0);
    expect(svc.getViewers('roomB').map((v) => v.userId)).toEqual(['u2']); // Bob remains
  });

  it('returns [] when the user was viewing nothing', () => {
    const svc = new CollisionDetectionService();
    svc.addViewer('roomA', 'u2', 'Bob');
    expect(svc.removeViewerFromAll('u1')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && npx jest src/modules/staff-chat/services/collision-detection.service.spec.ts --runInBand`
Expected: FAIL — `removeViewerFromAll` returns `undefined`, `.sort()` throws / assertion fails.

- [ ] **Step 3: Make `removeViewerFromAll` return the affected roomIds**

Read the current `removeViewerFromAll` (39–47) and change it to collect + return the sessionIds where the user was actually present. The new body:

```ts
  /** Remove a user from every room they were viewing; returns the affected roomIds. */
  removeViewerFromAll(userId: string): string[] {
    const affected: string[] = [];
    for (const [sessionId, viewers] of this.viewerMap.entries()) {
      if (viewers.delete(userId)) {
        affected.push(sessionId);
        if (viewers.size === 0) this.viewerMap.delete(sessionId);
      }
    }
    return affected;
  }
```

(Preserve the existing logging if any; only the return + the per-room collection change.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && npx jest src/modules/staff-chat/services/collision-detection.service.spec.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Re-broadcast viewers from `handleDisconnect`**

In `staff-chat.gateway.ts` `handleDisconnect`, replace the bare `removeViewerFromAll` call with one that captures the affected rooms and re-broadcasts the updated viewer list to each:

```ts
    // Clean up collision detection viewers for this user, and tell each affected
    // room its viewer list changed (so other staff's "viewing" banner clears
    // when this staff's tab closes/crashes instead of clicking away).
    const affectedRooms = this.collisionDetectionService.removeViewerFromAll(userId);
    for (const roomId of affectedRooms) {
      this.server.to(CHAT_ROOMS.room(roomId)).emit(CHAT_EVENTS.VIEWERS, {
        roomId,
        viewers: this.collisionDetectionService.getViewers(roomId),
      });
    }
```

(Use the same `CHAT_ROOMS.room(...)` + `CHAT_EVENTS.VIEWERS` symbols already imported in the gateway — confirm the import names match `handleViewRoom`'s existing broadcast.)

- [ ] **Step 6: Typecheck the API**

Run: `./tools/check-types.sh api`
Expected: API OK.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/staff-chat/services/collision-detection.service.ts \
        apps/api/src/modules/staff-chat/services/collision-detection.service.spec.ts \
        apps/api/src/modules/staff-chat/staff-chat.gateway.ts
git commit -m "fix(inbox): re-broadcast room viewers on disconnect so the collision banner clears"
```

---

### Task 2 (frontend): WebSocket connection-status pill

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/hooks/useChatSocket.ts` (add `status` state + lifecycle listeners + return it)
- Modify: `apps/web/src/pages/UnifiedInboxPage/index.tsx` (read `status`, pass to ConversationList)
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx` (render the pill in the header)

**Interfaces:**
- Produces: `useChatSocket(...)` returns an added `status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected'`. `ConversationList` gains an optional prop `connectionStatus?: typeof status`.

- [ ] **Step 1: Track connection status in the hook**

In `useChatSocket.ts`, add the state near the other state (after `isCustomerTyping`, ~89):

```tsx
const [status, setStatus] = useState<'connecting' | 'connected' | 'reconnecting' | 'disconnected'>(
  'connecting',
);
```

Inside the socket effect, set status on lifecycle events. In the existing `connect` handler (119) add `setStatus('connected');` as the first line, and add these listeners alongside the others (after the `connect_error` handler, ~146):

```tsx
socket.on('disconnect', () => setStatus('disconnected'));
socket.io.on('reconnect_attempt', () => setStatus('reconnecting'));
socket.io.on('reconnect_failed', () => setStatus('disconnected'));
```

Keep the existing silent `connect_error` (the manager's `reconnect_attempt` already covers the reconnecting state). Add `status` to the return object (179):

```tsx
return { joinRoom, leaveRoom, sendMessage, startTyping, stopTyping, viewRoom, isCustomerTyping, status };
```

- [ ] **Step 2: Thread the status to ConversationList**

In `index.tsx`, destructure `status` from `useChatSocket` (rename to `connectionStatus` for clarity):

```tsx
const { joinRoom, leaveRoom, viewRoom, isCustomerTyping, status: connectionStatus } = useChatSocket({
```

Pass it to `<ConversationList ... connectionStatus={connectionStatus} />` (find the existing `<ConversationList>` element and add the prop).

- [ ] **Step 3: Render the pill**

In `ConversationList.tsx`, add the prop to the component's props (interface + destructure): `connectionStatus?: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';`.

Add a status config + the pill at the top of the header `<div className="px-4 pt-3 pb-0">` (above the search `<div className="relative mb-2">`, 129–131). Only render the pill prominently for non-connected states (a subtle dot when connected):

```tsx
{connectionStatus && connectionStatus !== 'connected' && (
  <div
    className={cn(
      'mb-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium leading-snug',
      connectionStatus === 'disconnected'
        ? 'bg-destructive/10 text-destructive'
        : 'bg-warning/10 text-warning',
    )}
  >
    <span
      className={cn(
        'size-1.5 rounded-full',
        connectionStatus === 'disconnected' ? 'bg-destructive' : 'bg-warning animate-pulse',
      )}
    />
    {connectionStatus === 'disconnected'
      ? 'ออฟไลน์ — ไม่ได้เชื่อมต่อเรียลไทม์'
      : connectionStatus === 'reconnecting'
        ? 'กำลังเชื่อมต่อใหม่...'
        : 'กำลังเชื่อมต่อ...'}
  </div>
)}
```

(`cn` is already imported in ConversationList. The list still auto-refreshes via the existing 5s poll even when disconnected, so this is informational.)

- [ ] **Step 4: Typecheck**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`.

- [ ] **Step 5: Manual verification**

Normal use: no pill (connected). Stop the API / kill network: within a few seconds the pill shows "กำลังเชื่อมต่อใหม่..." (amber pulse) and then "ออฟไลน์ — ไม่ได้เชื่อมต่อเรียลไทม์" (red) after retries exhaust; restoring the API flips it back to no-pill (connected) and the open room re-joins.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/hooks/useChatSocket.ts \
        apps/web/src/pages/UnifiedInboxPage/index.tsx \
        apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx
git commit -m "feat(inbox): WebSocket connection-status pill in the conversation list"
```

---

### Task 3 (frontend): Persistent "another staff is viewing" banner

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/index.tsx` (wire `onViewers`; derive other-viewers for the active room; drop the `onCollision` toast; pass to ChatPanel)
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx` (render a persistent banner strip below the header)

**Interfaces:**
- `ChatPanel` gains an optional prop `otherViewers?: { userId: string; userName: string }[]`.
- Consumes `onViewers` (already exposed by the hook) + `user.id` (to filter self).

- [ ] **Step 1: Track viewers for the active room**

In `index.tsx`, add state:

```tsx
const [roomViewers, setRoomViewers] = useState<{ userId: string; userName: string }[]>([]);
```

In the `useChatSocket({...})` config, ADD an `onViewers` handler and REPLACE the `onCollision` toast with a no-op comment (the banner replaces it). `onViewers` fires for the room whose viewer set changed; only track it for the active room:

```tsx
onViewers: (data) => {
  if (data.roomId === activeRoomId) {
    setRoomViewers(data.viewers ?? []);
  }
},
// onCollision intentionally dropped — the persistent banner (from onViewers)
// replaces the one-shot toast.
```

(Remove the old `onCollision` handler block at 95–98.)

Clear the viewers when switching rooms so a stale banner doesn't flash (add to the existing room-open effect, or a small effect on `activeRoomId`):

```tsx
useEffect(() => {
  setRoomViewers([]);
}, [activeRoomId]);
```

Derive the other-viewers (exclude yourself) and pass to ChatPanel:

```tsx
const otherViewers = roomViewers.filter((v) => v.userId !== user?.id);
```

```tsx
<ChatPanel ... otherViewers={otherViewers} />
```

- [ ] **Step 2: Render the banner in ChatPanel**

In `ChatPanel.tsx`, add the prop to the props interface + destructure: `otherViewers?: { userId: string; userName: string }[];`.

Render a persistent warning strip directly BELOW the chat header and ABOVE the messages list (find the header row — the one with the back button + name + customer-info button — and the messages scroll container `<div className="flex-1 overflow-y-auto ...">`; insert the strip between them):

```tsx
{otherViewers && otherViewers.length > 0 && (
  <div className="flex items-center gap-2 bg-warning/10 px-4 py-1.5 text-[11px] text-warning leading-snug border-b border-warning/20">
    <Eye className="size-3.5 shrink-0" />
    <span className="truncate">
      {otherViewers.map((v) => v.userName).join(', ')} กำลังดูห้องนี้อยู่ — ระวังตอบซ้ำ
    </span>
  </div>
)}
```

Add `Eye` to the existing lucide-react import in ChatPanel.

- [ ] **Step 3: Typecheck**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`.

- [ ] **Step 4: Manual verification**

Open the same room as another staff (two browsers / two accounts): a persistent amber strip "<name> กำลังดูห้องนี้อยู่ — ระวังตอบซ้ำ" shows under the header and STAYS while they're viewing. When the other staff switches away OR closes their tab (Task 1's disconnect re-broadcast), the strip disappears within a moment. Your own second tab does not warn about yourself. Switching rooms clears the strip immediately.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/index.tsx \
        apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx
git commit -m "feat(inbox): persistent 'another staff is viewing' banner (replaces transient toast)"
```

---

### Task 4 (frontend): Notification mute toggle + deferred permission

**Files:**
- Create: `apps/web/src/pages/UnifiedInboxPage/hooks/useNotificationPrefs.ts`
- Test: `apps/web/src/pages/UnifiedInboxPage/hooks/useNotificationPrefs.test.ts`
- Modify: `apps/web/src/pages/UnifiedInboxPage/index.tsx` (remove on-mount permission; gate `notifyNewMessage`; global bell in list header path)
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx` (global bell toggle in header)
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx` (per-room bell in header)

**Interfaces:**
- Produces: `useNotificationPrefs()` → `{ muteAll, mutedRooms, toggleMuteAll, toggleRoomMute, isMuted }` where `isMuted(roomId): boolean = muteAll || mutedRooms.has(roomId)`; persists to localStorage keys `inbox.muteAll` + `inbox.mutedRooms`.
- The pure storage logic is unit-tested; the React hook wraps it.

- [ ] **Step 1: Write the failing test (pure storage helpers)**

Create `apps/web/src/pages/UnifiedInboxPage/hooks/useNotificationPrefs.test.ts` — test the pure read/compute helpers the hook will use:

```ts
import { describe, it, expect } from 'vitest';
import { computeIsMuted } from './useNotificationPrefs';

describe('computeIsMuted', () => {
  it('mutes everything when muteAll is on', () => {
    expect(computeIsMuted(true, new Set(), 'roomA')).toBe(true);
  });
  it('mutes only the listed room when muteAll is off', () => {
    expect(computeIsMuted(false, new Set(['roomA']), 'roomA')).toBe(true);
    expect(computeIsMuted(false, new Set(['roomA']), 'roomB')).toBe(false);
  });
  it('is not muted with no prefs', () => {
    expect(computeIsMuted(false, new Set(), 'roomA')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/UnifiedInboxPage/hooks/useNotificationPrefs.test.ts`
Expected: FAIL — cannot resolve `./useNotificationPrefs`.

- [ ] **Step 3: Write the hook + pure helper**

Create `apps/web/src/pages/UnifiedInboxPage/hooks/useNotificationPrefs.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';

const MUTE_ALL_KEY = 'inbox.muteAll';
const MUTED_ROOMS_KEY = 'inbox.mutedRooms';

export function computeIsMuted(muteAll: boolean, mutedRooms: Set<string>, roomId?: string): boolean {
  if (muteAll) return true;
  return !!roomId && mutedRooms.has(roomId);
}

function readMuteAll(): boolean {
  try {
    return localStorage.getItem(MUTE_ALL_KEY) === 'true';
  } catch {
    return false;
  }
}
function readMutedRooms(): Set<string> {
  try {
    const raw = localStorage.getItem(MUTED_ROOMS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function useNotificationPrefs() {
  const [muteAll, setMuteAll] = useState(readMuteAll);
  const [mutedRooms, setMutedRooms] = useState<Set<string>>(readMutedRooms);

  useEffect(() => {
    try {
      localStorage.setItem(MUTE_ALL_KEY, String(muteAll));
    } catch {}
  }, [muteAll]);
  useEffect(() => {
    try {
      localStorage.setItem(MUTED_ROOMS_KEY, JSON.stringify([...mutedRooms]));
    } catch {}
  }, [mutedRooms]);

  const toggleMuteAll = useCallback(() => setMuteAll((m) => !m), []);
  const toggleRoomMute = useCallback((roomId: string) => {
    setMutedRooms((prev) => {
      const next = new Set(prev);
      next.has(roomId) ? next.delete(roomId) : next.add(roomId);
      return next;
    });
  }, []);
  const isMuted = useCallback(
    (roomId?: string) => computeIsMuted(muteAll, mutedRooms, roomId),
    [muteAll, mutedRooms],
  );

  return { muteAll, mutedRooms, toggleMuteAll, toggleRoomMute, isMuted };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/pages/UnifiedInboxPage/hooks/useNotificationPrefs.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate notifications + defer permission in index.tsx**

In `index.tsx`: use the hook, REMOVE the on-mount permission effect (36–40), and gate `notifyNewMessage` on mute (before BOTH the sound and the Notification):

```tsx
const { muteAll, toggleMuteAll, toggleRoomMute, isMuted } = useNotificationPrefs();
```

Replace `notifyNewMessage` (43–63) so the FIRST thing it does is bail when muted:

```tsx
const notifyNewMessage = useCallback(
  (data: ChatMessageEvent) => {
    if (isMuted(data.roomId)) return; // global or per-room mute → silence sound + notification
    // Sound
    try {
      const audio = new Audio(NOTIFICATION_SOUND_URL);
      audio.volume = 0.3;
      audio.play().catch(() => {});
    } catch {}
    // Browser notification (only if granted + not the room you're viewing)
    if (
      'Notification' in window &&
      Notification.permission === 'granted' &&
      data.roomId !== activeRoomId
    ) {
      new Notification('ข้อความใหม่ — BESTCHOICE', {
        body: data.text?.substring(0, 100) || 'มีข้อความใหม่',
        icon: '/favicon.ico',
        tag: `chat-${data.roomId}`,
      });
    }
  },
  [activeRoomId, isMuted],
);
```

Add a permission-request handler invoked when the user turns notifications ON (un-mutes globally), and pass the toggles down:

```tsx
const handleToggleMuteAll = useCallback(() => {
  const wasMuted = muteAll;
  toggleMuteAll();
  // Turning notifications ON → request permission on this user gesture (deferred
  // from mount). If blocked, the desktop notification stays off but in-app sound works.
  if (wasMuted && 'Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}, [muteAll, toggleMuteAll]);
```

Pass `muteAll` + `handleToggleMuteAll` to `<ConversationList>` and `isMuted(activeRoomId)` + `() => activeRoomId && toggleRoomMute(activeRoomId)` to `<ChatPanel>`.

- [ ] **Step 6: Global bell in ConversationList header**

Add props: `muteAll?: boolean; onToggleMuteAll?: () => void;`. Render a bell toggle in the header (next to where the connection pill from Task 2 sits — put both in a small flex row at the top of `px-4 pt-3`):

```tsx
{onToggleMuteAll && (
  <button
    type="button"
    onClick={onToggleMuteAll}
    title={muteAll ? 'เปิดการแจ้งเตือน' : 'ปิดการแจ้งเตือนทั้งหมด'}
    aria-label={muteAll ? 'เปิดการแจ้งเตือน' : 'ปิดการแจ้งเตือน'}
    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
  >
    {muteAll ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
  </button>
)}
```

Add `Bell, BellOff` to the lucide import.

- [ ] **Step 7: Per-room bell in ChatPanel header**

Add props: `roomMuted?: boolean; onToggleRoomMute?: () => void;`. In the chat header (near the `onShowCustomerInfo` customer-info button), add a per-room bell:

```tsx
{onToggleRoomMute && (
  <button
    type="button"
    onClick={onToggleRoomMute}
    title={roomMuted ? 'เปิดแจ้งเตือนห้องนี้' : 'ปิดแจ้งเตือนห้องนี้'}
    aria-label="สลับการแจ้งเตือนห้องนี้"
    className="p-1.5 text-muted-foreground hover:text-foreground/70 hover:bg-accent rounded-lg"
  >
    {roomMuted ? <BellOff className="w-5 h-5" /> : <Bell className="w-5 h-5" />}
  </button>
)}
```

Add `Bell, BellOff` to ChatPanel's lucide import.

- [ ] **Step 8: Typecheck**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`.

- [ ] **Step 9: Manual verification**

On first load there is NO permission prompt (deferred). Clicking the global bell to turn notifications ON triggers the browser permission prompt once; with permission granted, a message in a background room plays a sound + desktop notification. Toggling the global bell to OFF (BellOff) silences both sound + desktop notification for all rooms. The per-room bell in the chat header mutes only that room (sound/notification skipped for it, others still notify). Mute state survives a refresh (localStorage). The room you're actively viewing never notifies.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/hooks/useNotificationPrefs.ts \
        apps/web/src/pages/UnifiedInboxPage/hooks/useNotificationPrefs.test.ts \
        apps/web/src/pages/UnifiedInboxPage/index.tsx \
        apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx \
        apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx
git commit -m "feat(inbox): notification mute toggle (global + per-room) + deferred permission"
```

---

## Self-Review

**1. Spec coverage (Batch 4 = realtime):** WS connection pill → Task 2; persistent collision → Task 3 (+ Task 1 backend correctness); mute toggle global+per-room + deferred permission → Task 4. **Staff-typing → DEFERRED** (documented — needs backend role field + composer wiring; collision banner covers the core signal).

**2. Placeholder scan:** every code step is complete. Pure logic (`removeViewerFromAll` return, `computeIsMuted`) is TDD'd; the socket lifecycle, banner, pill, and bell UI are tsc + manual (event/DOM behavior not unit-testable). The ChatPanel header insertion points (banner below header; per-room bell near the customer-info button) are described by their role for the implementer to locate.

**3. Type consistency:** `status` union added to `useChatSocket`'s return + flows as `connectionStatus` to ConversationList. `otherViewers: {userId,userName}[]` from `onViewers` (filtered by `user.id`) → ChatPanel banner. `useNotificationPrefs` → `{muteAll, isMuted, toggleMuteAll, toggleRoomMute}`; `isMuted(roomId)` gates `notifyNewMessage`. `removeViewerFromAll(userId): string[]` consumed by `handleDisconnect`.

**4. No-regression guards:** the hook's `connect` re-join logic, the 5s poll, the `tag`-dedup, and the active-room-never-notifies rule are preserved; the only `onCollision` removal is replaced by the equivalent-or-better persistent banner; mute short-circuits BEFORE the sound (fixing the current "muted room still beeps" gap).

## Rollout

One branch off `main` (e.g. `feat/inbox-batch4-realtime`) with the four commits → merge → deploy (backend gateway + frontend) → user verifies: connection pill on network loss; the "another staff viewing" banner with a second account; global + per-room mute + no permission prompt on load. Then Batch 5. Offer the deferred staff-typing as a follow-up.
