# Inbox Follow-up C — "อ่านทั้งหมด" + per-channel unread badges — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** (1) A "อ่านทั้งหมด" button that clears unread on every room in the current filtered view in one click, and (2) an unread-count badge on each channel chip so staff see at a glance which channels have waiting messages.

**Architecture:** Both features sit on data already loaded. The inbox loads ALL rooms client-side (`/staff-chat/rooms`) and does tab/channel/search filtering in `ConversationList`. So per-channel counts are DERIVED client-side (no new read endpoint — mirrors the existing `deriveTabCounts`). Bulk-read needs one new backend endpoint that mirrors single-room `markAsRead`, marking a passed set of room IDs read. The frontend sends exactly the unread room IDs currently in view, so the action respects the active tab/channel/search filters and stays within the already-branch-scoped list the server returned.

**Tech Stack:** NestJS + Prisma (api) + React 18 + @tanstack/react-query (web).

## Global Constraints
- Design tokens only (the channel brand dots `bg-[#06C755]` etc. in ChannelFilter are a pre-existing accepted exception — do NOT add new hardcoded colors elsewhere); no new deps; Thai copy `leading-snug`; useMutation + `@/lib/api` only; sonner toasts; Prettier (semi, singleQuote, printWidth 100, tabWidth 2).
- Backend: controller → service → Prisma; `@UseGuards` + `@Roles` already at class level; class-validator DTO with Thai messages; soft-delete (`deletedAt: null`).
- Verify: `./tools/check-types.sh api` + `./tools/check-types.sh web`; `cd apps/web && npx vitest run src/pages/UnifiedInboxPage/components/tab-counts.test.ts`.
- Do NOT touch the SENDING/FAILED ghosts, staff-typing, collision banner, or the single-room markAsRead.

## Verified current-state facts
- `room-manager.service.ts` `markAsRead(roomId)` (551–568): `$transaction` → `chatMessage.updateMany({ where:{roomId, role:'CUSTOMER', readAt:null}, data:{readAt:now} })` → recount remaining unread CUSTOMER msgs → `chatRoom.update({ data:{ unreadCount: remaining } })`. No gateway emit. Returns `{ markedCount }`.
- `staff-chat.controller.ts`: single-room `@Post('rooms/:id/read')` (553) → `roomManager.markAsRead(id)`, Roles `OWNER, BRANCH_MANAGER, FINANCE_MANAGER, SALES`. Class already has `@UseGuards(JwtAuthGuard, RolesGuard)`. No route collision: `rooms/read-all` is 2-segment; all existing `@Post('rooms/...')` are 3-segment (`rooms/:id/...`).
- `ConversationList.tsx` already imports `useMutation, useQueryClient` (line 5) + `api` (8) + `ChannelFilter` (10) + `deriveTabCounts` (11). It does NOT import `toast` yet. `filteredAndSorted` (useMemo, ends ~133) is the tab+channel+AI+search-filtered, sorted list. `tabCounts = useMemo(() => deriveTabCounts(sessions, currentUserId), …)` (135). The header row (`<div className="mb-2 flex items-center justify-between gap-2">`, ~167) renders the connection pill (left) + the mute bell (right); it always renders because `onToggleMuteAll` is always passed from index.tsx.
- `ChannelFilter.tsx`: `CHANNELS` keys = `LINE_FINANCE | LINE_SHOP | FACEBOOK | TIKTOK | WEB`; props `{ activeTab, selectedChannels, onTabChange, onChannelToggle, counts }`; the tab badge style is `ml-0.5 inline-flex items-center justify-center min-w-[15px] h-[15px] px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold leading-none`.
- `tab-counts.ts`: `deriveTabCounts(sessions, currentUserId)`. Room shape there: `{ unreadCount?: number; assignedTo?: { id } | null }`. Rooms also carry `channel: string`.

---

### Task 1 (backend): bulk read-all endpoint + service

**Files:** Create `apps/api/src/modules/staff-chat/dto/read-all.dto.ts`; Modify `apps/api/src/modules/chat-engine/services/room-manager.service.ts` (+`markAllAsRead`); Modify `apps/api/src/modules/staff-chat/staff-chat.controller.ts` (+endpoint).

**Interfaces produced:** `POST /staff-chat/rooms/read-all` body `{ roomIds: string[] }` → `{ count: number }`.

- [ ] **Step 1: DTO** — Create `read-all.dto.ts`:

```ts
import { IsArray, IsUUID, ArrayMaxSize } from 'class-validator';

export class ReadAllDto {
  @IsArray({ message: 'roomIds ต้องเป็น array' })
  @ArrayMaxSize(1000, { message: 'มากเกินไป (สูงสุด 1000 ห้อง)' })
  @IsUUID('4', { each: true, message: 'roomId ไม่ถูกต้อง' })
  roomIds: string[];
}
```

- [ ] **Step 2: Service** — In `room-manager.service.ts`, add `markAllAsRead` right after `markAsRead` (after line 568). Mirror markAsRead's read semantics for a SET of rooms in one `$transaction`:

```ts
/** Bulk variant of markAsRead — marks every CUSTOMER message in the given
 *  rooms read and zeroes their unreadCount. Mirrors markAsRead's end-state. */
async markAllAsRead(roomIds: string[]): Promise<{ count: number }> {
  if (!roomIds.length) return { count: 0 };
  const now = new Date();
  return this.prisma.$transaction(async (tx) => {
    await tx.chatMessage.updateMany({
      where: { roomId: { in: roomIds }, role: 'CUSTOMER', readAt: null },
      data: { readAt: now },
    });
    const res = await tx.chatRoom.updateMany({
      where: { id: { in: roomIds }, deletedAt: null },
      data: { unreadCount: 0 },
    });
    return { count: res.count };
  });
}
```

- [ ] **Step 3: Controller** — In `staff-chat.controller.ts`, import `ReadAllDto` (with the other dto imports) and add the endpoint immediately after `markAsRead` (after line 558). Match its Roles:

```ts
@Post('rooms/read-all')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
async markAllAsRead(@Body() dto: ReadAllDto) {
  return this.roomManager.markAllAsRead(dto.roomIds);
}
```

(Confirm `@Body` is already imported in the controller — it is used by other POST handlers; if not, add it to the `@nestjs/common` import.)

- [ ] **Step 4: Typecheck** — `./tools/check-types.sh api` → API OK.
- [ ] **Step 5: Commit** — `git add apps/api/src/modules/staff-chat/dto/read-all.dto.ts apps/api/src/modules/chat-engine/services/room-manager.service.ts apps/api/src/modules/staff-chat/staff-chat.controller.ts && git commit -m "feat(inbox): bulk mark-all-as-read endpoint"`

---

### Task 2 (frontend): "อ่านทั้งหมด" button in ConversationList

**Files:** Modify `apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx`.

- [ ] **Step 1: Imports** — Add `CheckCheck, Loader2` to the existing `lucide-react` import (line 4). Add `import { toast } from 'sonner';` (toast is NOT yet imported here).

- [ ] **Step 2: Mutation + unread-in-view** — In the component body (the existing `useQueryClient()` is already in scope; if not assigned to a var, add `const queryClient = useQueryClient();`), after the `tabCounts` useMemo (~135) add:

```tsx
const unreadInView = useMemo(
  () => filteredAndSorted.filter((r) => (r.unreadCount ?? 0) > 0).map((r) => r.id),
  [filteredAndSorted],
);

const markAllReadMutation = useMutation({
  mutationFn: (roomIds: string[]) =>
    api.post('/staff-chat/rooms/read-all', { roomIds }).then((r) => r.data),
  onSuccess: (data: { count?: number }) => {
    queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
    queryClient.invalidateQueries({ queryKey: ['chat-unread-count'] });
    toast.success(`ทำเครื่องหมายอ่านแล้ว ${data?.count ?? 0} ห้อง`);
  },
  onError: () => toast.error('ทำเครื่องหมายอ่านไม่สำเร็จ'),
});
```

- [ ] **Step 3: Button** — In the header row (the `<div className="mb-2 flex items-center justify-between gap-2">` ~167), the right side currently holds the mute bell. Wrap the bell and the new button in a right-aligned flex group (`<div className="flex items-center gap-1">`), with the "อ่านทั้งหมด" button BEFORE the bell, rendered only when there are unread rooms in view:

```tsx
{unreadInView.length > 0 && (
  <button
    onClick={() => markAllReadMutation.mutate(unreadInView)}
    disabled={markAllReadMutation.isPending}
    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium leading-snug text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
    title="ทำเครื่องหมายอ่านทั้งหมดในมุมมองนี้"
  >
    {markAllReadMutation.isPending ? (
      <Loader2 className="size-3 animate-spin" />
    ) : (
      <CheckCheck className="size-3" />
    )}
    อ่านทั้งหมด
  </button>
)}
```

(Keep the existing bell button exactly as-is, just move it inside the new right-aligned group so the two sit side by side. The left side — connection pill or `<div />` spacer — is unchanged.)

- [ ] **Step 4: Typecheck** — `./tools/check-types.sh web` → Web: OK.
- [ ] **Step 5: Commit** — `git add apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx && git commit -m "feat(inbox): mark-all-read button clears unread in the current view"`

---

### Task 3 (frontend): per-channel unread badges

**Files:** Modify `apps/web/src/pages/UnifiedInboxPage/components/tab-counts.ts` (+`deriveChannelUnreadCounts` + a test) + `tab-counts.test.ts`; Modify `ConversationList.tsx` (derive + pass) + `ChannelFilter.tsx` (prop + render).

- [ ] **Step 1: Write the failing test** — In `tab-counts.test.ts`, add a `describe('deriveChannelUnreadCounts')` with:

```ts
it('counts unread rooms per channel', () => {
  const sessions = [
    { unreadCount: 2, channel: 'LINE_FINANCE' },
    { unreadCount: 0, channel: 'LINE_FINANCE' },
    { unreadCount: 1, channel: 'FACEBOOK' },
    { unreadCount: 5, channel: 'FACEBOOK' },
    { unreadCount: 0, channel: 'WEB' },
  ];
  expect(deriveChannelUnreadCounts(sessions)).toEqual({ LINE_FINANCE: 1, FACEBOOK: 2 });
});

it('returns an empty object for no unread', () => {
  expect(deriveChannelUnreadCounts([{ unreadCount: 0, channel: 'WEB' }])).toEqual({});
});
```

(Add `deriveChannelUnreadCounts` to the existing import from `./tab-counts` at the top of the test.)

- [ ] **Step 2: Run it — verify it fails** — `cd apps/web && npx vitest run src/pages/UnifiedInboxPage/components/tab-counts.test.ts` → FAIL (deriveChannelUnreadCounts is not a function).

- [ ] **Step 3: Implement** — In `tab-counts.ts`, add (note: it counts ROOMS with unread, not total messages, to match the tab-badge semantics):

```ts
type ChannelRoom = { unreadCount?: number; channel?: string };

/** Count of unread ROOMS per channel. Client-derived from the loaded list.
 *  Channels with zero unread are omitted. */
export function deriveChannelUnreadCounts(sessions: ChannelRoom[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of sessions) {
    if ((r.unreadCount ?? 0) > 0 && r.channel) {
      out[r.channel] = (out[r.channel] ?? 0) + 1;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run it — verify it passes** — `cd apps/web && npx vitest run src/pages/UnifiedInboxPage/components/tab-counts.test.ts` → PASS (all tab-counts tests green).

- [ ] **Step 5: Wire ConversationList → ChannelFilter** — In `ConversationList.tsx`: import `deriveChannelUnreadCounts` (extend the existing `./tab-counts` import). Add `const channelCounts = useMemo(() => deriveChannelUnreadCounts(sessions), [sessions]);`. Find the `<ChannelFilter ... />` render and pass `channelCounts={channelCounts}`.

- [ ] **Step 6: Render badge in ChannelFilter** — In `ChannelFilter.tsx`: add `channelCounts?: Record<string, number>;` to `ChannelFilterProps`, destructure it, and inside the channel-chip `.map`, after `{ch.label}`, render:

```tsx
{channelCounts && channelCounts[ch.key] > 0 && (
  <span className="ml-0.5 inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold leading-none">
    {channelCounts[ch.key] > 99 ? '99+' : channelCounts[ch.key]}
  </span>
)}
```

- [ ] **Step 7: Typecheck** — `./tools/check-types.sh web` → Web: OK.
- [ ] **Step 8: Manual verification** — channels with unread show a count badge on their chip; "อ่านทั้งหมด" clears the unread in the current view (respects active tab + channel + search), the per-channel badges + tab badges + the global bell count all drop accordingly; with zero unread the button is hidden.
- [ ] **Step 9: Commit** — `git add apps/web/src/pages/UnifiedInboxPage/components/tab-counts.ts apps/web/src/pages/UnifiedInboxPage/components/tab-counts.test.ts apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx apps/web/src/pages/UnifiedInboxPage/components/ChannelFilter.tsx && git commit -m "feat(inbox): per-channel unread badges on channel chips"`

---

## Self-Review
**Coverage:** bulk endpoint+service (T1) → "อ่านทั้งหมด" button respecting the filtered view (T2) → per-channel badges (T3). **Security:** zeroing unreadCount on client-supplied IDs is non-sensitive; IDs originate from the already-branch-scoped `/staff-chat/rooms` list; DTO bounds (`@IsUUID`, `@ArrayMaxSize(1000)`) prevent abuse. **No regression:** single-room markAsRead untouched; deriveTabCounts untouched (additive sibling); ChannelFilter `counts` prop untouched. **Consistency:** badge style copied from the tab badge; button uses tokens + sonner + react-query per the rules. **Route:** `rooms/read-all` (2-seg) doesn't collide with `rooms/:id/read` (3-seg). **Type:** `markAllAsRead` returns `{ count }`; the mutation reads `data.count`; `deriveChannelUnreadCounts` returns a sparse record (zero channels omitted) which the `> 0` guard handles.

## Rollout
One branch (`feat/inbox-mark-all-read`) → 3 commits → final review → merge → deploy → user verifies.
