# Inbox Fix I — full server-side tab/channel/AI filtering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close Batch-H's residual — push the tab (mine/unread), channel, and AI filters server-side so the visible list IS the full filtered set (paginated), matching the badge totals. No more "filtered tab shows only loaded matches."

**Architecture:** The backend `listRooms` already filters channel/status/assignedToId/search + paginates. Add the missing filters (`unreadOnly`, multi-`channels`, `aiStatus`) + a pinned-first sort. The frontend sends ALL active filters as query params (so the queryKey changes per filter → infinite query resets to page 1 of the filtered set), and ConversationList stops filtering/sorting client-side (it just renders the server-ordered accumulated pages). Badges already come from the server counts (Batch H).

**Tech Stack:** NestJS + Prisma (api); React 18 + @tanstack/react-query (web).

## Global Constraints
- No new deps. Design tokens; Thai `leading-snug`; useInfiniteQuery + `@/lib/api`; Prettier (semi, singleQuote, printWidth 100, tabWidth 2).
- Backend: controller → service → Prisma; soft-delete `deletedAt: null`; class-validator DTO.
- Verify: `./tools/check-types.sh api` + `./tools/check-types.sh web` + `cd apps/web && npx vitest run`.
- Do NOT change the room-counts endpoint, the message query, or the Batch-G/H memo/debounce/poll/pagination machinery (only the filter params + the removal of client filtering).

## Verified current-state facts
- `listRooms` `where` supports channel(single)/status/priority/assignedToId/customerId/unassignedOnly/search; `orderBy: [{priority:'desc'},{lastMessageAt:'desc'}]` (NO pinnedAt — the client adds pinned-first). Returns `{data,total,page,limit}`. `ChatRoom.pinnedAt DateTime?` exists (schema:4931). Prisma 6.19 supports `{ field: { sort, nulls } }` ordering.
- `SessionQueryDto`: has search/channel/status/priority/assignedToId/customerId/unassignedOnly/page/limit. NO unreadOnly/channels(multi)/aiStatus.
- `ConversationList.tsx`: `filteredAndSorted` (103-151) does tab(mine→`assignedTo?.id===uid`, unread→`unreadCount>0`), channel(multi `filters.channels.includes`), AI(`aiFilter` local state: ai→`!aiPaused&&!handoffMode`, human→`aiPaused`, pending→`handoffMode`), search(client subset of the server search), then sort(pinned-first→lastMessageAt desc). `aiFilter` is LOCAL `useState` in ConversationList; tab/channels/search live in the parent `filters` object via `onFiltersChange`. The AI-filter chips UI writes `setAiFilter`. j/k nav + empty states + load-more operate on `filteredAndSorted`.
- `index.tsx`: the infinite query sends `{ search: filters.search, page, limit }` only; `filters` state = `{ tab, channels, search }`; `currentUserId` available.

---

### Task 1 (backend): listRooms filters + pinned-first sort

**Files:** Modify `apps/api/src/modules/chat-engine/dto/session-query.dto.ts` + `room-manager.service.ts` (listRooms) + `staff-chat.controller.ts` (pass params).

- [ ] **Step 1: DTO** — In `session-query.dto.ts`, add:

```ts
@IsOptional()
@IsBoolean()
@Type(() => Boolean)
unreadOnly?: boolean;

@IsOptional()
@IsString()
channels?: string; // comma-separated list, e.g. "LINE_FINANCE,FACEBOOK"

@IsOptional()
@IsString()
aiStatus?: string; // 'ai' | 'human' | 'pending'
```

- [ ] **Step 2: listRooms where + sort** — In `room-manager.service.ts` `listRooms` params type, add `unreadOnly?: boolean; channels?: ChatChannel[]; aiStatus?: 'ai' | 'human' | 'pending';`. In the `where` builder (after the existing filters), add:

```ts
if (params.unreadOnly) where.unreadCount = { gt: 0 };
if (params.channels && params.channels.length > 0) where.channel = { in: params.channels };
if (params.aiStatus === 'ai') {
  where.aiPaused = false;
  where.handoffMode = false;
} else if (params.aiStatus === 'human') {
  where.aiPaused = true;
} else if (params.aiStatus === 'pending') {
  where.handoffMode = true;
}
```

(The single-`channel` param still works; `channels` is the multi-select. If both are sent, `channels` wins — declare it after the single `channel` assignment.)

Change the `orderBy` (the `findMany` inside the `$transaction`) to pinned-first:

```ts
orderBy: [
  { pinnedAt: { sort: 'desc', nulls: 'last' } },
  { priority: 'desc' },
  { lastMessageAt: 'desc' },
],
```

- [ ] **Step 3: Controller passes the new params** — In `staff-chat.controller.ts` `listRooms`, extend the `roomManager.listRooms({...})` call:

```ts
unreadOnly: query.unreadOnly,
channels: query.channels
  ? (query.channels.split(',').filter(Boolean) as ChatChannel[])
  : undefined,
aiStatus: query.aiStatus as 'ai' | 'human' | 'pending' | undefined,
```

- [ ] **Step 4: Typecheck** — `./tools/check-types.sh api` → API OK.
- [ ] **Step 5: Commit** — `git add apps/api/src/modules/chat-engine/dto/session-query.dto.ts apps/api/src/modules/chat-engine/services/room-manager.service.ts apps/api/src/modules/staff-chat/staff-chat.controller.ts && git commit -m "feat(inbox): server-side unread/channels/aiStatus filters + pinned-first sort"`

---

### Task 2 (frontend): send filters to the server, drop client filtering

**Files:** Modify `apps/web/src/pages/UnifiedInboxPage/index.tsx` + `apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx`.

- [ ] **Step 1: Lift aiFilter into the shared filters object** — In `index.tsx`, extend the `filters` state type to include `aiFilter?: 'all' | 'ai' | 'human' | 'pending'` (default `'all'`). (ConversationList will read/write it via `onFiltersChange` instead of its local `useState`.)

- [ ] **Step 2: The infinite query sends every active filter** — In `index.tsx`, change the `sessionsQuery` queryKey + params to include the filters (so changing any filter resets pagination + refetches the filtered set):

```tsx
const sessionsQuery = useInfiniteQuery({
  queryKey: ['chat-rooms', filters],
  queryFn: ({ pageParam }) =>
    api
      .get('/staff-chat/rooms', {
        params: {
          page: pageParam,
          limit: 50,
          search: filters.search || undefined,
          assignedToId: filters.tab === 'mine' ? currentUserId : undefined,
          unreadOnly: filters.tab === 'unread' ? true : undefined,
          channels: filters.channels?.length ? filters.channels.join(',') : undefined,
          aiStatus: filters.aiFilter && filters.aiFilter !== 'all' ? filters.aiFilter : undefined,
        },
      })
      .then((r) => r.data),
  initialPageParam: 1,
  getNextPageParam: (lastPage: any) =>
    lastPage.page * lastPage.limit < lastPage.total ? lastPage.page + 1 : undefined,
});
```

(`currentUserId` must be in scope in index.tsx — it's `user?.id`; use the existing variable. The `sessions` dedup memo from Batch H stays unchanged.)

- [ ] **Step 3: ConversationList renders the server result directly** — In `ConversationList.tsx`:
  - Replace the `aiFilter` local `useState` with reads/writes through `filters.aiFilter` + `onFiltersChange` (the AI-filter chips' onClick → `onFiltersChange({ ...filters, aiFilter: <value> })`; the active state reads `filters.aiFilter ?? 'all'`).
  - Replace `filteredAndSorted` with a passthrough that does NOT filter or sort (the server already did both): `const visibleRooms = sessions;` — and update every consumer (`filteredAndSorted.map` → `visibleRooms.map`, the j/k nav `filteredAndSorted` → `visibleRooms`, the empty-state checks). Remove the now-dead `deriveTabCounts`/`deriveChannelUnreadCounts` useMemos IF they're only used as the server-counts fallback — keep the fallback wiring from Batch H (`serverCounts ?? tabCounts`) ONLY if tabCounts is still computed; since we're dropping client filtering, compute the fallback over `sessions` is fine to keep (cheap) OR drop the fallback and rely on serverCounts (which is always present after first load). Simplest: keep `tabCounts`/`channelCounts` useMemos as-is for the fallback — they're harmless.
  - Keep: the search input (still writes `filters.search`), `<ChannelFilter>` (tab + channel toggles write `filters` via onFiltersChange; badges from serverCounts), j/k nav (over `visibleRooms`), empty/loading states, the load-more button.
  - The empty-state branches keyed on `filters.search` / filtered-empty still work (now "no results" = the server returned an empty filtered page).

- [ ] **Step 4: Typecheck + tests** — `./tools/check-types.sh web` → Web OK; `cd apps/web && npx vitest run` → green (tab-counts tests unaffected; if a test asserted client filtering behavior, update it).

- [ ] **Step 5: Manual verification** — selecting "ยังไม่อ่าน" shows ALL unread rooms (paginated, badge total matches what you can load through); "ของฉัน" shows all rooms assigned to me; a channel chip shows all rooms of that channel; the AI filter chips filter server-side; pinned rooms float to the top across pages; search reaches any room; load-more appends the next page of the CURRENT filter; switching filters resets to page 1.

- [ ] **Step 6: Commit** — `git add apps/web/src/pages/UnifiedInboxPage/index.tsx apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx && git commit -m "feat(inbox): drive tab/channel/AI filters server-side (filtered list matches badges)"`

---

## Self-Review
**Coverage:** server filters + pinned sort (T1) → query sends filters + client filtering removed (T2). **Residual closed:** the visible list is now the full server-filtered set (paginated), matching the badges. **No regression:** search still server-side (now the only search path — it's a superset of the old client search); j/k nav + empty states + load-more + counts intact (over the server result); the dedup memo + Batch-G memo still apply. **Sort parity:** pinned-first moved to the server orderBy (nulls last) so pinned rooms float across pages. **Filter state:** aiFilter folded into the shared `filters` so all filters drive the one query; queryKey=`['chat-rooms', filters]` resets pagination on any change. **Risk:** ConversationList's filter/sort core removed — verify j/k nav, empty states, and the AI-filter chips all still work against `visibleRooms`/`filters.aiFilter`.

## Rollout
One branch (`feat/inbox-server-filtering`) → 2 commits → review → merge → deploy.
