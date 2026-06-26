# Inbox Fix H — room pagination (lift the 50-room cap) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix the two verified scaling findings — (1) only the first 50 rooms load so rooms beyond page 1 are unreachable, and (2) the tab/channel unread badges undercount because they're derived from those 50. Add load-more pagination so every room is reachable, and a server-side counts endpoint so the badges are accurate over the whole universe.

**Architecture (deliberately low-risk):** The backend `listRooms` already supports `page`/`limit` + filters and returns `{ data, total, page, limit }`. Keep the existing CLIENT-side tab/channel/AI filtering (don't rewrite ConversationList's core), but: (a) switch the rooms query to `useInfiniteQuery` and add a manual "โหลดเพิ่ม" button so the loaded set grows beyond 50 on demand (manual, not auto-scroll — avoids rendering thousands of un-virtualized rows at once); (b) add `GET /staff-chat/rooms/counts` returning the true unread counts (tabs + per-channel) so the badges no longer depend on what's loaded. Client filters then operate on the accumulated set; the badges always show real totals; server-side `search` already reaches any specific room.

**Known residual (acceptable, documented):** on the "ยังไม่อ่าน"/"ของฉัน" tabs the visible list is still only the LOADED rooms that match — the user loads more (or searches) to surface matches further down; the badge tells them the true total. Full server-side tab filtering is a future enhancement, out of scope here.

**Tech Stack:** NestJS + Prisma (api); React 18 + @tanstack/react-query (web).

## Global Constraints
- No new deps (no virtualizer). Design tokens; Thai `leading-snug`; useInfiniteQuery/useQuery + `@/lib/api`; Prettier (semi, singleQuote, printWidth 100, tabWidth 2).
- Backend: controller → service → Prisma; soft-delete `deletedAt: null`; counts must match the existing badge semantics (badges = count of UNREAD rooms per tab/channel).
- Verify: `./tools/check-types.sh api` + `./tools/check-types.sh web` + `cd apps/web && npx vitest run`.
- Do NOT change listRooms' filter/where/order logic, the message query, or the Batch-G memo/debounce/poll-gate.

## Verified current-state facts
- `room-manager.service.ts` `listRooms(params)` returns `{ data, total, page, limit }` (417); orders by `priority desc, lastMessageAt desc`; `where` already supports channel/status/assignedToId/search/page/limit. `getUnreadCount(staffId)` (433) counts `handoffMode` rooms (the header bell's "needs-reply" count — leave it).
- `tab-counts.ts`: `deriveTabCounts(sessions, uid)` returns `{ mine, all, unread }` where `all=unread=count(unreadCount>0)`, `mine=count(unreadCount>0 && assignedTo.id===uid)`. `deriveChannelUnreadCounts(sessions)` = per-channel count(unreadCount>0). Both currently derived from the loaded ≤50 rooms in ConversationList (`136-137`).
- `index.tsx`: `sessionsQuery = useQuery({ queryKey: ['chat-rooms', filters.search], queryFn: () => api.get('/staff-chat/rooms', { params: { search: filters.search } }).then(r => r.data) })` (~143). Passed as `sessions={sessionsQuery.data?.data ?? []}` (416) + `isLoading={sessionsQuery.isLoading}` (419). The Batch-G `invalidateRoomsListSoon` debounces `['chat-rooms']`+`['chat-unread-count']`; `onReconnect` invalidates the same.
- `ConversationList.tsx`: `filteredAndSorted` (86-134, client tab/channel/AI/search filter + pinned/lastMessageAt sort) over `sessions`; `tabCounts = useMemo(deriveTabCounts(sessions, uid))` (136); `channelCounts = useMemo(deriveChannelUnreadCounts(sessions))` (137); the list renders `filteredAndSorted.map(...)` (357-366); `<ChannelFilter counts={tabCounts} channelCounts={channelCounts} ... />` is rendered inside (find it). Empty/loading states already exist.
- `ChannelFilter.tsx`: props `counts?: { mine; all; unread }` + `channelCounts?: Record<string, number>` (from Batch C).
- `staff-chat.controller.ts`: `@Get('rooms')` (90) + class `@UseGuards(JwtAuthGuard, RolesGuard)`. `@Req() req.user.id` is available (used by other handlers).

---

### Task 1 (backend): room badge-counts endpoint

**Files:** Modify `apps/api/src/modules/chat-engine/services/room-manager.service.ts` (+`getRoomBadgeCounts`) + `apps/api/src/modules/staff-chat/staff-chat.controller.ts` (+endpoint).

**Interfaces produced:** `GET /staff-chat/rooms/counts` → `{ mine: number; all: number; unread: number; byChannel: Record<string, number> }` (all = unread = total unread-room count; mine = unread rooms assigned to the caller; byChannel = unread rooms per channel). Matches the existing badge semantics, but over ALL non-deleted rooms.

- [ ] **Step 1: Service** — In `room-manager.service.ts`, add after `getUnreadCount` (after line 444):

```ts
/** Unread-room counts for the inbox tab + channel badges, over the whole
 *  (non-deleted) room universe — so badges aren't truncated by pagination.
 *  "unread" = room.unreadCount > 0 (mirrors deriveTabCounts/deriveChannelUnreadCounts). */
async getRoomBadgeCounts(staffId?: string): Promise<{
  mine: number;
  all: number;
  unread: number;
  byChannel: Record<string, number>;
}> {
  const unreadWhere: Prisma.ChatRoomWhereInput = { deletedAt: null, unreadCount: { gt: 0 } };
  const [all, mine, byChannelRaw] = await Promise.all([
    this.prisma.chatRoom.count({ where: unreadWhere }),
    staffId
      ? this.prisma.chatRoom.count({ where: { ...unreadWhere, assignedToId: staffId } })
      : Promise.resolve(0),
    this.prisma.chatRoom.groupBy({
      by: ['channel'],
      where: unreadWhere,
      _count: { id: true },
    }),
  ]);
  const byChannel: Record<string, number> = {};
  for (const g of byChannelRaw) byChannel[g.channel] = g._count.id;
  return { mine, all, unread: all, byChannel };
}
```

- [ ] **Step 2: Controller** — In `staff-chat.controller.ts`, add right after the `@Get('rooms')` handler (the 2-segment `rooms/counts` path does NOT collide with `rooms/:id` GET — Nest matches static segments before params, but to be safe declare it BEFORE `@Get('rooms/:id')`):

```ts
@Get('rooms/counts')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
async getRoomCounts(@Req() req: { user: { id: string } }) {
  return this.roomManager.getRoomBadgeCounts(req.user.id);
}
```

(Ensure `@Req`/`Req` is imported — it's used by other handlers in this controller.)

- [ ] **Step 3: Typecheck** — `./tools/check-types.sh api` → API OK.
- [ ] **Step 4: Commit** — `git add apps/api/src/modules/chat-engine/services/room-manager.service.ts apps/api/src/modules/staff-chat/staff-chat.controller.ts && git commit -m "feat(inbox): room badge-counts endpoint (true unread totals, not just the loaded page)"`

---

### Task 2 (frontend): infinite rooms query + load-more + server-counts badges

**Files:** Modify `apps/web/src/pages/UnifiedInboxPage/index.tsx` + `apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx`.

- [ ] **Step 1: Switch the rooms query to useInfiniteQuery** — In `index.tsx`, import `useInfiniteQuery` from `@tanstack/react-query` (extend the existing import). Replace the `sessionsQuery = useQuery({...})` (~143) with:

```tsx
const sessionsQuery = useInfiniteQuery({
  queryKey: ['chat-rooms', filters.search],
  queryFn: ({ pageParam }) =>
    api
      .get('/staff-chat/rooms', { params: { search: filters.search, page: pageParam, limit: 50 } })
      .then((r) => r.data),
  initialPageParam: 1,
  getNextPageParam: (lastPage: { page: number; limit: number; total: number }) =>
    lastPage.page * lastPage.limit < lastPage.total ? lastPage.page + 1 : undefined,
});

const sessions = useMemo(
  () => sessionsQuery.data?.pages.flatMap((p: { data: any[] }) => p.data) ?? [],
  [sessionsQuery.data?.pages],
);
```

(`useMemo` is already imported in index.tsx? add it if not. The flat `sessions` is memoized on `pages` so its identity stays stable across unrelated renders — keeps the Batch-G ConversationItem memo effective.)

- [ ] **Step 2: Add the server counts query** — In `index.tsx`, after the sessions query:

```tsx
const roomCountsQuery = useQuery({
  queryKey: ['chat-room-counts'],
  queryFn: () => api.get('/staff-chat/rooms/counts').then((r) => r.data),
});
```

Add `['chat-room-counts']` to the invalidations so badges refresh with the list: inside the Batch-G `invalidateRoomsListSoon` setTimeout body add `queryClient.invalidateQueries({ queryKey: ['chat-room-counts'] });`, and add the same line to the `onReconnect` handler.

- [ ] **Step 3: Pass the new props to ConversationList** — Update the `<ConversationList ... />` render:

```tsx
sessions={sessions}
isLoading={sessionsQuery.isLoading}
serverCounts={roomCountsQuery.data}
hasMore={sessionsQuery.hasNextPage}
isLoadingMore={sessionsQuery.isFetchingNextPage}
onLoadMore={() => sessionsQuery.fetchNextPage()}
```

(Replace the old `sessions={sessionsQuery.data?.data ?? []}` line. Keep the other ConversationList props.)

- [ ] **Step 4: ConversationList — consume server counts + render the load-more button** — In `ConversationList.tsx`:
  - Add to the props interface + destructure: `serverCounts?: { mine: number; all: number; unread: number; byChannel: Record<string, number> }; hasMore?: boolean; isLoadingMore?: boolean; onLoadMore?: () => void;`.
  - Replace the badge SOURCES: pass `counts={serverCounts ?? tabCounts}` and `channelCounts={serverCounts?.byChannel ?? channelCounts}` to `<ChannelFilter>` (prefer the server counts; fall back to the client-derived ones while the counts query is loading). Keep the `tabCounts`/`channelCounts` useMemo as the fallback.
  - At the BOTTOM of the scrollable room list (right after the `filteredAndSorted.map(...)` block, inside the same scroll container), add a load-more control shown only when `hasMore`:

```tsx
{hasMore && (
  <button
    onClick={() => onLoadMore?.()}
    disabled={isLoadingMore}
    className="w-full px-3 py-2.5 text-xs font-medium leading-snug text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
  >
    {isLoadingMore ? (
      <>
        <Loader2 className="size-3.5 animate-spin" /> กำลังโหลด…
      </>
    ) : (
      'โหลดห้องเพิ่ม'
    )}
  </button>
)}
```

(Import `Loader2` from lucide-react if not already imported in this file.)

- [ ] **Step 5: Typecheck + tests** — `./tools/check-types.sh web` → Web OK; `cd apps/web && npx vitest run` → green (the tab-counts unit tests still pass — the functions are unchanged, only their consumption is now a fallback).

- [ ] **Step 6: Manual verification** — the inbox loads the first 50; a "โหลดห้องเพิ่ม" button appears when more exist and appends the next 50 on click (spinner while loading); the tab badges (ของฉัน/ทั้งหมด/ยังไม่อ่าน) + channel chip badges show the TRUE unread totals from the server (not just among loaded rooms); selecting a tab/channel still filters the loaded set; search still reaches any room; sending/receiving a message refreshes both the list and the counts.

- [ ] **Step 7: Commit** — `git add apps/web/src/pages/UnifiedInboxPage/index.tsx apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx && git commit -m "feat(inbox): load-more room pagination + server-side accurate tab/channel badges"`

---

## Self-Review
**Coverage:** server counts (T1) → infinite query + load-more + server-counts badges (T2). **Both findings fixed:** (1) all rooms reachable via "โหลดเพิ่ม" (no hard 50-cap); (2) badges read true server counts (no truncation). **Low risk:** client tab/channel/AI filtering + sort + j/k nav + empty states UNCHANGED (operate on the accumulated `sessions`); only the data SOURCE became paginated. **No runaway render:** load-more is MANUAL (button), so the DOM grows only when the user asks — no auto-loading thousands of un-virtualized rows. **Memo intact:** `sessions` is `useMemo`'d on `pages` (stable identity) so the Batch-G ConversationItem memo still hits; individual room objects are structural-shared per page. **Counts semantics:** mirror deriveTabCounts/deriveChannelUnreadCounts (unread-room counts) but over the full universe; `mine` uses req.user.id. **Invalidation:** counts refresh alongside the list (added to the debounced invalidator + reconnect). **Residual:** filtered tabs still show only loaded matches (documented) — bounded + mitigated by accurate badges + server search + load-more. **Route:** `rooms/counts` declared before `rooms/:id`.

## Rollout
One branch (`feat/inbox-room-pagination`) → 2 commits → review → merge → deploy.
