# Inbox UX Batch 3 — Left-list / Triage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the conversation list scannable for triage — a loud "ต้องตอบ" badge, compact relative timestamps, relative date separators, a search-clear button, a stronger active-room highlight, per-tab unread counts, and j/k keyboard navigation + jump-to-latest.

**Architecture:** All frontend, in `apps/web/src/pages/UnifiedInboxPage/`. Several pieces already exist and are *enhanced* (date separators, active highlight, the `handoffMode`→"ต้องตอบ" badge, the unread pill, `formatDistanceToNow`); this batch upgrades them and adds what's missing. Three new pure helpers (`lib/chat-time.ts`, `deriveTabCounts`, `nextRoomIndex`) carry the testable logic; the rest is component rendering + a keyboard effect, verified by tsc + manual. No backend changes.

**Tech Stack:** React 18 + TypeScript + Tailwind v4 + date-fns + lucide-react + vitest.

## Global Constraints

- Design tokens only — no hardcoded hex/gray. (Note: existing `bg-[#06C755]` channel-dots and `text-amber-*`/`text-emerald-*` AI badges are PRE-EXISTING brand colors — out of scope, do not touch.)
- No new dependencies. Reuse: existing `date-fns` + `th` locale, `Badge`, `isEditableTarget` (export it).
- Thai user-facing copy; `leading-snug` on multi-word Thai.
- Prettier: semi true, singleQuote true, printWidth 100, tabWidth 2.
- Verify: `./tools/check-types.sh web` prints `Web: OK`; run added vitest specs.

## Deferred (NOT in this batch — flagged honestly)

- **"อ่านทั้งหมด" bulk mark-all-read** — there is NO bulk endpoint (only per-room `POST /staff-chat/rooms/:id/read`), and `unreadCount` already resets to 0 the moment staff opens a room. Deferring; it would need a new `POST /rooms/read-all` backend endpoint. Low urgency.
- **Per-CHANNEL chip unread badges** — no per-channel unread API; client-derivable but only over the loaded page (pagination undercount). Ship the 3 top-tab badges only (Task 5).

## Verified current-state facts (from the understanding sweep — do not re-derive)

- **Room/session list payload** (each item) has these real fields: `id, channel, status` (`ChatRoomStatus = ACTIVE | IDLE` — NO `RESOLVED`), `priority, lastMessageAt, unreadCount` (real number column), `totalMessages, handoffMode` (bool — the canonical "needs reply"), `aiPaused, pinnedAt, displayName, pictureUrl, lineUserId, leadScore, leadTemperature`; relations `customer {id,name,phone}`, `assignedTo {id,name,avatarUrl}`, `tags[] {tag}`, `messages[]` (single latest `{text, role, createdAt}`).
- **`ConversationItem.tsx`**: imports `formatDistanceToNow`/`th` (3–4); `AiStatusBadge` (30–70) — the `handoffMode` branch (43–49) renders a small `text-[9px] text-destructive` dot+"ต้องตอบ"; row container active style (168–170) `bg-primary/5 border-l-2 border-l-primary`; timestamp (189–191) `formatDistanceToNow(new Date(session.lastMessageAt), { addSuffix: false, locale: th })`; unread pill (204–208, `99+`).
- **`ConversationList.tsx`**: search `<input>` (133–141, value `searchInput`, `setSearchInput`, no clear button), `<Search>` icon absolute-left (132); `filteredAndSorted` useMemo (76–124, deps `[sessions, filters, currentUserId, aiFilter]`); `<ChannelFilter>` (146–151); empty state (188–195, ONE generic "ไม่พบการสนทนา"); list scroll container `flex-1 overflow-y-auto` (175); map (197–206). Props include `sessions, activeRoomId, onSelectRoom, filters, onFiltersChange, currentUserId`. `searchInput`/`setSearchInput` local state + a debounce effect (61–66) that pushes `debouncedSearch || undefined` to `filters.search`.
- **`ChannelFilter.tsx`**: `TABS = [{key:'mine',label:'ของฉัน',icon:User},{key:'all',label:'ทั้งหมด',icon:Inbox},{key:'unread',label:'ยังไม่อ่าน',icon:Mail}]` (4–8); tab buttons (37–55) render `<Icon/> {tab.label}`; props `activeTab, selectedChannels, onTabChange, onChannelToggle` (20–25).
- **`hooks/useKeyboardShortcuts.ts`**: `isEditableTarget(el)` (9–14, true for INPUT/TEXTAREA/contentEditable) — currently NOT exported; the hook guards Cmd+K / Cmd+Shift+R with `!typing` (16–46).
- **`ChatPanel.tsx`**: thread map (550–572) already inserts a date separator on calendar-day change via `isSameDay`, label `format(new Date(msg.createdAt), 'd MMMM yyyy', { locale: th })`; `messagesEndRef` sentinel after the map (583); scroll-to-latest effect keys on `[messages.length, roomId]`. `isSameDay`/`format`/`th` already imported.

---

### Task 1: `lib/chat-time.ts` — compact timestamp + relative date-separator helpers

**Files:**
- Create: `apps/web/src/lib/chat-time.ts`
- Test: `apps/web/src/lib/chat-time.test.ts`

**Interfaces:**
- Produces: `formatChatTimestamp(value: string | Date | null | undefined, now?: Date): string` (compact list-row timestamp); `formatDateSeparator(value: string | Date, now?: Date): string` (thread day label). Both default `now = new Date()` for testability.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/chat-time.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatChatTimestamp, formatDateSeparator } from './chat-time';

const NOW = new Date('2026-06-25T12:00:00');

describe('formatChatTimestamp', () => {
  it('returns "" for null/invalid', () => {
    expect(formatChatTimestamp(null, NOW)).toBe('');
    expect(formatChatTimestamp('not-a-date', NOW)).toBe('');
  });
  it('clamps just-now and future to เมื่อสักครู่', () => {
    expect(formatChatTimestamp(new Date('2026-06-25T11:59:40'), NOW)).toBe('เมื่อสักครู่');
    expect(formatChatTimestamp(new Date('2026-06-25T12:05:00'), NOW)).toBe('เมื่อสักครู่');
  });
  it('shows minutes under an hour', () => {
    expect(formatChatTimestamp(new Date('2026-06-25T11:45:00'), NOW)).toBe('15 นาที');
  });
  it('shows hours for earlier the same day', () => {
    expect(formatChatTimestamp(new Date('2026-06-25T09:00:00'), NOW)).toBe('3 ชม.');
  });
  it('shows เมื่อวาน for the previous calendar day', () => {
    expect(formatChatTimestamp(new Date('2026-06-24T23:00:00'), NOW)).toBe('เมื่อวาน');
  });
  it('shows d MMM for older this year', () => {
    expect(formatChatTimestamp(new Date('2026-06-10T10:00:00'), NOW)).toMatch(/10/);
  });
  it('shows d MMM yy for a previous year', () => {
    expect(formatChatTimestamp(new Date('2025-12-31T10:00:00'), NOW)).toMatch(/25$/);
  });
});

describe('formatDateSeparator', () => {
  it('วันนี้ / เมื่อวาน / dated', () => {
    expect(formatDateSeparator(new Date('2026-06-25T08:00:00'), NOW)).toBe('วันนี้');
    expect(formatDateSeparator(new Date('2026-06-24T08:00:00'), NOW)).toBe('เมื่อวาน');
    expect(formatDateSeparator(new Date('2026-06-01T08:00:00'), NOW)).toMatch(/1/);
    expect(formatDateSeparator(new Date('2025-06-01T08:00:00'), NOW)).toMatch(/2025/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/lib/chat-time.test.ts`
Expected: FAIL — cannot resolve `./chat-time`.

- [ ] **Step 3: Write the helpers**

Create `apps/web/src/lib/chat-time.ts`:

```ts
import { differenceInCalendarDays, isSameDay, format } from 'date-fns';
import { th } from 'date-fns/locale';

function toDate(value: string | Date): Date {
  return typeof value === 'string' ? new Date(value) : value;
}

/** Compact relative timestamp for conversation-list rows (Thai). */
export function formatChatTimestamp(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  if (!value) return '';
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '';
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return 'เมื่อสักครู่'; // covers small future clock skew (diffMin < 0)
  if (diffMin < 60) return `${diffMin} นาที`;
  if (isSameDay(d, now)) return `${Math.floor(diffMin / 60)} ชม.`;
  if (differenceInCalendarDays(now, d) === 1) return 'เมื่อวาน';
  if (d.getFullYear() === now.getFullYear()) return format(d, 'd MMM', { locale: th });
  return format(d, 'd MMM yy', { locale: th });
}

/** Day-divider label for the message thread (Thai). */
export function formatDateSeparator(value: string | Date, now: Date = new Date()): string {
  const d = toDate(value);
  const days = differenceInCalendarDays(now, d);
  if (days === 0) return 'วันนี้';
  if (days === 1) return 'เมื่อวาน';
  if (d.getFullYear() === now.getFullYear()) return format(d, 'd MMMM', { locale: th });
  return format(d, 'd MMMM yyyy', { locale: th });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/lib/chat-time.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/chat-time.ts apps/web/src/lib/chat-time.test.ts
git commit -m "feat(inbox): compact chat timestamp + relative date-separator helpers"
```

---

### Task 2: Apply the time helpers (list timestamp + thread separator)

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ConversationItem.tsx` (imports 3–4; timestamp 189–191)
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx` (thread separator label, 559–563)

**Interfaces:** consumes Task 1's `formatChatTimestamp` / `formatDateSeparator`.

- [ ] **Step 1: List-row timestamp**

In `ConversationItem.tsx`, replace the date-fns relative import (lines 3–4):

```tsx
import { formatChatTimestamp } from '@/lib/chat-time';
```

(Remove `import { formatDistanceToNow } from 'date-fns';` and `import { th } from 'date-fns/locale';` ONLY if neither is used elsewhere in the file — grep first; if `th`/`format` are used elsewhere keep them.)

Replace the timestamp span body (189–191):

```tsx
<span className="text-[10px] text-muted-foreground/70 flex-shrink-0 tabular-nums">
  {formatChatTimestamp(session.lastMessageAt)}
</span>
```

- [ ] **Step 2: Thread date separator**

In `ChatPanel.tsx`, add the import near the other lib imports:

```tsx
import { formatDateSeparator } from '@/lib/chat-time';
```

Replace the separator label (the `<span>` inside the `showDateSeparator` block, ~559–563):

```tsx
<span className="text-[11px] text-muted-foreground font-medium">
  {formatDateSeparator(msg.createdAt)}
</span>
```

(Leave the `showDateSeparator` logic, the `<div key={msg.id}>` wrapper, and `isSameDay` boundary check unchanged — only the label text changes. `isSameDay`/`format`/`th` may now be unused in ChatPanel; remove only if grep confirms no other use.)

- [ ] **Step 3: Typecheck**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`. (Fix any now-unused-import errors by removing the dead import.)

- [ ] **Step 4: Manual verification**

List rows show compact times ("15 นาที", "3 ชม.", "เมื่อวาน", "10 มิ.ย."). The thread shows day dividers labeled "วันนี้"/"เมื่อวาน"/date. Scroll-to-latest on room open still works (separator change doesn't affect it).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/ConversationItem.tsx \
        apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx
git commit -m "feat(inbox): use compact timestamps in list + relative day dividers in thread"
```

---

### Task 3: Loud "ต้องตอบ" badge + stronger active-room highlight

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ConversationItem.tsx` (`AiStatusBadge` handoff branch 43–49; active style 168–170)

**Interfaces:** none new (uses existing `handoffMode`/`isActive`).

- [ ] **Step 1: Make the handoff badge loud**

In `AiStatusBadge`, replace the `handoffMode` branch (43–49) — a filled destructive pill instead of a faint dot+text, so it pops in a scan (keep the `aiPaused`/AI branches unchanged):

```tsx
if (handoffMode) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-destructive px-1.5 py-0.5 text-[9px] font-semibold leading-none text-destructive-foreground">
      <span className="size-1.5 rounded-full bg-destructive-foreground" />
      ต้องตอบ
    </span>
  );
}
```

- [ ] **Step 2: Strengthen the active highlight**

In the row container `cn(...)` (168–170), deepen the active fill one step (keep the left accent bar):

```tsx
isActive
  ? 'bg-primary/10 border-l-2 border-l-primary'
  : 'hover:bg-muted/40',
```

- [ ] **Step 3: Typecheck**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`.

- [ ] **Step 4: Manual verification**

A room with `handoffMode` shows a solid red "ต้องตอบ" pill that stands out against other rows. The selected room is clearly filled (`bg-primary/10`) + left emerald bar, distinct from hover. Pinned-but-not-active rooms still show their warning tint; active wins over pinned.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/ConversationItem.tsx
git commit -m "feat(inbox): loud ต้องตอบ badge + stronger active-room highlight"
```

---

### Task 4: Search clear button + cause-specific empty states

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx` (search wrapper 131–142; empty state 188–195; imports)

**Interfaces:** uses local `searchInput`/`setSearchInput`, `filters`, `onFiltersChange`, `sessions`, `aiFilter`.

- [ ] **Step 1: Import the X icon**

Ensure `X` is imported from lucide-react in `ConversationList.tsx` (add to the existing lucide import that already has `Search`, `MessageCircle`):

```tsx
import { Search, MessageCircle, X } from 'lucide-react';
```

(Match the file's actual existing lucide import — add `X` to it; don't duplicate.)

- [ ] **Step 2: Add the clear button**

In the search wrapper (131–142), after the `<input>`, add a conditional clear button (right side); the input stays as-is except add `pr-7` so text doesn't run under the X:

```tsx
<div className="relative mb-2">
  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
  <input
    type="text"
    placeholder="ค้นหาชื่อ, เบอร์..."
    value={searchInput}
    onChange={(e) => setSearchInput(e.target.value)}
    onFocus={() => setSearchFocused(true)}
    onBlur={() => setSearchFocused(false)}
    className="w-full pl-8 pr-7 py-1.5 text-xs rounded-md bg-muted/40 border-0 focus:outline-none focus:ring-1 focus:ring-primary/20 focus:bg-background transition-all placeholder:text-muted-foreground/40"
  />
  {searchInput.length > 0 && (
    <button
      type="button"
      onClick={() => {
        setSearchInput('');
        onFiltersChange({ ...filters, search: undefined }); // clear immediately, don't wait for debounce
      }}
      aria-label="ล้างการค้นหา"
      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground"
    >
      <X className="w-3.5 h-3.5" />
    </button>
  )}
</div>
```

- [ ] **Step 3: Split the empty state by cause**

Replace the single empty state (188–195) with cause-specific copy (all derivable from existing state):

```tsx
) : filteredAndSorted.length === 0 ? (
  <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
    <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
      <MessageCircle className="w-5 h-5 text-muted-foreground/40" />
    </div>
    {sessions.length === 0 ? (
      <>
        <p className="text-xs font-medium text-muted-foreground leading-snug">ยังไม่มีการสนทนา</p>
        <p className="text-[10px] text-muted-foreground/60 mt-0.5 leading-snug">
          เมื่อมีลูกค้าทักเข้ามา แชทจะแสดงที่นี่
        </p>
      </>
    ) : filters.search ? (
      <>
        <p className="text-xs font-medium text-muted-foreground leading-snug">
          ไม่พบผลการค้นหา “{filters.search}”
        </p>
        <button
          type="button"
          onClick={() => {
            setSearchInput('');
            onFiltersChange({ ...filters, search: undefined });
          }}
          className="text-[10px] text-primary hover:underline mt-1"
        >
          ล้างการค้นหา
        </button>
      </>
    ) : (
      <>
        <p className="text-xs font-medium text-muted-foreground leading-snug">ไม่มีแชทในตัวกรองนี้</p>
        <button
          type="button"
          onClick={() => {
            onFiltersChange({ ...filters, channels: [], tab: 'all' });
            setAiFilter('all');
          }}
          className="text-[10px] text-primary hover:underline mt-1"
        >
          ดูทั้งหมด
        </button>
      </>
    )}
  </div>
) : (
```

(`setAiFilter` is the existing local AI-filter state setter, 153–169. Verify its name in the file.)

- [ ] **Step 4: Typecheck**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`.

- [ ] **Step 5: Manual verification**

Typing shows an X; clicking it clears the box AND the list instantly (no 300ms wait). Empty inbox → "ยังไม่มีการสนทนา". A search with no hits → "ไม่พบผลการค้นหา …" + ล้างการค้นหา link. A channel/tab/AI filter with no matches (but rooms exist) → "ไม่มีแชทในตัวกรองนี้" + ดูทั้งหมด link.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx
git commit -m "feat(inbox): search clear button + cause-specific empty states"
```

---

### Task 5: Per-tab unread count badges

**Files:**
- Create: `apps/web/src/pages/UnifiedInboxPage/components/tab-counts.ts`
- Test: `apps/web/src/pages/UnifiedInboxPage/components/tab-counts.test.ts`
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx` (derive + pass counts)
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ChannelFilter.tsx` (render badge)

**Interfaces:**
- Produces: `deriveTabCounts(sessions, currentUserId?): { mine: number; all: number; unread: number }` (unread-room counts per tab). `ChannelFilter` gains an optional `counts?: { mine: number; all: number; unread: number }` prop.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pages/UnifiedInboxPage/components/tab-counts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deriveTabCounts } from './tab-counts';

const S = (over: Partial<{ unreadCount: number; assignedTo: { id: string } | null }>) => ({
  unreadCount: 0,
  assignedTo: null,
  ...over,
});

describe('deriveTabCounts', () => {
  it('counts unread rooms for all/unread, and my unread for mine', () => {
    const sessions = [
      S({ unreadCount: 2, assignedTo: { id: 'me' } }),
      S({ unreadCount: 1, assignedTo: { id: 'other' } }),
      S({ unreadCount: 0, assignedTo: { id: 'me' } }),
      S({ unreadCount: 5, assignedTo: null }),
    ];
    expect(deriveTabCounts(sessions, 'me')).toEqual({ mine: 1, all: 3, unread: 3 });
  });
  it('handles missing currentUserId + empty list', () => {
    expect(deriveTabCounts([], undefined)).toEqual({ mine: 0, all: 0, unread: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/UnifiedInboxPage/components/tab-counts.test.ts`
Expected: FAIL — cannot resolve `./tab-counts`.

- [ ] **Step 3: Write the helper**

Create `apps/web/src/pages/UnifiedInboxPage/components/tab-counts.ts`:

```ts
type Room = { unreadCount?: number; assignedTo?: { id: string } | null };

/** Unread-room counts per inbox tab. Client-derived from the loaded list. */
export function deriveTabCounts(
  sessions: Room[],
  currentUserId?: string,
): { mine: number; all: number; unread: number } {
  const isUnread = (r: Room) => (r.unreadCount ?? 0) > 0;
  const all = sessions.filter(isUnread).length;
  const mine = sessions.filter((r) => isUnread(r) && r.assignedTo?.id === currentUserId).length;
  return { mine, all, unread: all };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/pages/UnifiedInboxPage/components/tab-counts.test.ts`
Expected: PASS.

- [ ] **Step 5: Derive + pass counts in ConversationList**

In `ConversationList.tsx`, add the import:

```tsx
import { deriveTabCounts } from './tab-counts';
```

Add a memo (near `filteredAndSorted`, but depending only on `sessions`/`currentUserId`):

```tsx
const tabCounts = useMemo(() => deriveTabCounts(sessions, currentUserId), [sessions, currentUserId]);
```

Pass it to `<ChannelFilter>` (146–151):

```tsx
<ChannelFilter
  activeTab={filters.tab}
  selectedChannels={filters.channels ?? []}
  onTabChange={(tab) => onFiltersChange({ ...filters, tab })}
  onChannelToggle={handleChannelToggle}
  counts={tabCounts}
/>
```

- [ ] **Step 6: Render the badge in ChannelFilter**

In `ChannelFilter.tsx`, add `counts` to the props interface + destructure:

```tsx
interface ChannelFilterProps {
  activeTab: InboxTab;
  selectedChannels: string[];
  onTabChange: (tab: InboxTab) => void;
  onChannelToggle: (channel: string) => void;
  counts?: { mine: number; all: number; unread: number };
}
```

```tsx
export default function ChannelFilter({
  activeTab,
  selectedChannels,
  onTabChange,
  onChannelToggle,
  counts,
}: ChannelFilterProps) {
```

In the tab map (37–55), after `{tab.label}`, render a count pill when > 0:

```tsx
<Icon className="w-3 h-3" />
{tab.label}
{counts && counts[tab.key] > 0 && (
  <span className="ml-0.5 inline-flex items-center justify-center min-w-[15px] h-[15px] px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold leading-none">
    {counts[tab.key] > 99 ? '99+' : counts[tab.key]}
  </span>
)}
```

- [ ] **Step 7: Typecheck**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`.

- [ ] **Step 8: Manual verification**

Each top tab (ของฉัน / ทั้งหมด / ยังไม่อ่าน) shows a small emerald count pill of unread rooms when > 0; the pill disappears at 0; counts update as rooms are read/arrive. (Counts reflect the loaded page — acceptable for now.)

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/tab-counts.ts \
        apps/web/src/pages/UnifiedInboxPage/components/tab-counts.test.ts \
        apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx \
        apps/web/src/pages/UnifiedInboxPage/components/ChannelFilter.tsx
git commit -m "feat(inbox): per-tab unread count badges (client-derived)"
```

---

### Task 6: j/k room navigation + jump-to-latest

**Files:**
- Create: `apps/web/src/pages/UnifiedInboxPage/components/list-nav.ts`
- Test: `apps/web/src/pages/UnifiedInboxPage/components/list-nav.test.ts`
- Modify: `apps/web/src/pages/UnifiedInboxPage/hooks/useKeyboardShortcuts.ts` (export `isEditableTarget`)
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx` (j/k keydown effect + row `data-room-id`)
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx` (jump-to-latest keydown)

**Interfaces:**
- Produces: `nextRoomIndex(currentIndex: number, direction: 1 | -1, length: number): number` (clamped next/prev index; `-1` when empty; first/last when nothing selected).
- Consumes: `isEditableTarget` (now exported).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pages/UnifiedInboxPage/components/list-nav.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nextRoomIndex } from './list-nav';

describe('nextRoomIndex', () => {
  it('returns -1 for an empty list', () => {
    expect(nextRoomIndex(0, 1, 0)).toBe(-1);
  });
  it('selects first on down / last on up when nothing is selected', () => {
    expect(nextRoomIndex(-1, 1, 5)).toBe(0);
    expect(nextRoomIndex(-1, -1, 5)).toBe(4);
  });
  it('moves and clamps at the ends (no wrap)', () => {
    expect(nextRoomIndex(0, 1, 5)).toBe(1);
    expect(nextRoomIndex(4, 1, 5)).toBe(4);
    expect(nextRoomIndex(0, -1, 5)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/UnifiedInboxPage/components/list-nav.test.ts`
Expected: FAIL — cannot resolve `./list-nav`.

- [ ] **Step 3: Write the helper**

Create `apps/web/src/pages/UnifiedInboxPage/components/list-nav.ts`:

```ts
/** Clamped next/prev index for keyboard room nav (no wrap-around). */
export function nextRoomIndex(currentIndex: number, direction: 1 | -1, length: number): number {
  if (length === 0) return -1;
  if (currentIndex < 0) return direction === 1 ? 0 : length - 1;
  return Math.max(0, Math.min(length - 1, currentIndex + direction));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/pages/UnifiedInboxPage/components/list-nav.test.ts`
Expected: PASS.

- [ ] **Step 5: Export `isEditableTarget`**

In `useKeyboardShortcuts.ts`, change line 9 from `const isEditableTarget` to:

```ts
export const isEditableTarget = (el: EventTarget | null): boolean => {
```

- [ ] **Step 6: j/k nav effect in ConversationList**

In `ConversationList.tsx`, add imports:

```tsx
import { useEffect } from 'react'; // add to the existing react import if needed
import { nextRoomIndex } from './list-nav';
import { isEditableTarget } from '../hooks/useKeyboardShortcuts';
```

Add a keydown effect (after `filteredAndSorted`/`tabCounts`):

```tsx
// j/k navigate the visible (filtered+sorted) room list; guarded so it never
// fires while typing in the composer or search.
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (isEditableTarget(e.target)) return;
    if (e.key !== 'j' && e.key !== 'k') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    const idx = filteredAndSorted.findIndex((r) => r.id === activeRoomId);
    const next = nextRoomIndex(idx, e.key === 'j' ? 1 : -1, filteredAndSorted.length);
    if (next < 0) return;
    const room = filteredAndSorted[next];
    onSelectRoom(room.id);
    document
      .querySelector(`[data-room-id="${room.id}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [filteredAndSorted, activeRoomId, onSelectRoom]);
```

Add `data-room-id` to each row so `scrollIntoView` can find it — pass it to `ConversationItem` and put it on the row container, OR wrap the item. Simplest: wrap the mapped item:

```tsx
filteredAndSorted.map((session) => (
  <div key={session.id} data-room-id={session.id}>
    <ConversationItem
      session={session}
      isActive={session.id === activeRoomId}
      onClick={() => onSelectRoom(session.id)}
      onPin={(roomId, isPinned) => pinMutation.mutate({ roomId, isPinned })}
      aiSettings={aiSettings}
    />
  </div>
))
```

(Move the `key` to the wrapper `<div>`; remove it from `<ConversationItem>`.)

- [ ] **Step 7: Jump-to-latest in ChatPanel**

In `ChatPanel.tsx`, add the import (reuse the same guard):

```tsx
import { isEditableTarget } from '../hooks/useKeyboardShortcuts';
```

Add a keydown effect (near the other effects) that scrolls the open thread to the newest message on `g` (when not typing and a room is open):

```tsx
// "g" → jump the open thread to the latest message (vim-style). Guarded so it
// never fires while typing in the composer.
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (isEditableTarget(e.target)) return;
    if (e.key !== 'g' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!roomId) return;
    e.preventDefault();
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [roomId]);
```

- [ ] **Step 8: Typecheck**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`.

- [ ] **Step 9: Manual verification**

With focus NOT in the composer/search: `j` selects the next room down, `k` the previous, clamping at the ends; the selected row scrolls into view; nav follows the current filter/search scope. Typing `j`/`k`/`g` inside the composer or search box types the letter (no nav). With a room open, `g` smooth-scrolls the thread to the newest message.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/list-nav.ts \
        apps/web/src/pages/UnifiedInboxPage/components/list-nav.test.ts \
        apps/web/src/pages/UnifiedInboxPage/hooks/useKeyboardShortcuts.ts \
        apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx \
        apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx
git commit -m "feat(inbox): j/k room navigation + g jump-to-latest (typing-guarded)"
```

---

## Self-Review

**1. Spec coverage (Batch 3 = left-list/triage):** loud "ต้องตอบ" badge → Task 3; compact timestamps → Task 1+2; relative date separators → Task 1+2 (existing separators relabeled); search clear → Task 4; active-room highlight → Task 3; unread count badge (tabs) → Task 5; j/k nav + jump-to-latest → Task 6; empty states → Task 4. **"อ่านทั้งหมด"** → DEFERRED (no bulk endpoint; documented). Per-channel chip badges → DEFERRED (no API).

**2. Placeholder scan:** every code step is complete. Pure logic (`formatChatTimestamp`, `formatDateSeparator`, `deriveTabCounts`, `nextRoomIndex`) is TDD'd; component/effect/markup changes are tsc + manual (not unit-testable), which is appropriate. The empty-state cause-detection and the j/k effect read only fields confirmed to exist (`sessions`, `filters.search`, `unreadCount`, `assignedTo`, `activeRoomId`).

**3. Type consistency:** `formatChatTimestamp`/`formatDateSeparator` (Task 1) consumed in Task 2; `deriveTabCounts → {mine,all,unread}` (Task 5) flows into `ChannelFilter.counts` keyed by the same `InboxTab` keys (`counts[tab.key]`); `nextRoomIndex` + `isEditableTarget` (Task 6). The `data-room-id` wrapper moves the React `key` to the wrapper (no double-key). No backend types touched.

**4. No-regression guards:** the thread separator change is label-only (scroll-to-latest untouched, key stays `msg.id` on the wrapper); j/k and g are guarded by `isEditableTarget`; active-highlight stays token-based; existing `handoffMode` semantics (badge/filter/counter) unchanged — only the badge's visual weight changes.

## Rollout

One branch off `main` (e.g. `feat/inbox-batch3-triage`) with the six commits → merge → deploy (frontend only) → user verifies the loud badge, compact times, day dividers, search-clear, active highlight, tab counts, and j/k+g nav. Then Batch 4. Offer the deferred "อ่านทั้งหมด" endpoint + per-channel badges as a follow-up if wanted.
