# Inbox UX Batch 5 — Customer-360 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the customer panel + room actions complete and safe — link an existing customer to an unlinked room, promote call/pay to a prominent spot, undo resolve/return-to-AI, show loading skeletons + collapsible sections, make contract cards clickable, and toggle AI pause inline.

**Architecture:** Almost entirely frontend reuse of existing endpoints. The only backend addition is a tiny `reopen` endpoint (the clean inverse of `resolve`, for undo). Everything else wires endpoints that already exist: link-customer, customer-search, take-over/release-to-ai (the AI on/off pair), and the `/contracts/:id` route.

**Tech Stack:** Frontend: React 18 + TypeScript + Tailwind v4 + @tanstack/react-query + react-router + shadcn Dialog + sonner + lucide-react (vitest). Backend: NestJS + Prisma (jest).

## Global Constraints

- Design tokens only — no hardcoded hex/gray.
- No new dependencies.
- Thai user-facing copy; `leading-snug` on multi-word Thai.
- `@/lib/api` axios for all calls; `useQuery`/`useMutation` only; sonner toasts.
- Prettier: semi true, singleQuote true, printWidth 100, tabWidth 2.
- Verify: backend `cd apps/api && npx jest <spec> --runInBand` + `./tools/check-types.sh api`; frontend `./tools/check-types.sh web` + `npx vitest run <spec>`.

## Verified backend availability (from the understanding sweep — do not re-derive)

- **Link customer:** `PATCH /staff-chat/rooms/:id/customer` body `{ customerId }` (`staff-chat.controller.ts:202`, roles OWNER/BM/FM/SALES; 409 "ห้องแชทนี้ผูกกับลูกค้ารายอื่นอยู่แล้ว" if already linked elsewhere).
- **Customer search:** `GET /customers/search?q=` (`customers.controller.ts:161`, roles incl SALES; **role-masked + PII-audited per call → debounce ≥400ms, require ≥2 chars**).
- **Resolve:** `PATCH /staff-chat/rooms/:id/resolve` → sets `status=IDLE, handoffMode=false, resolvedAt=now`. **No reopen endpoint exists** (Task 1 adds one).
- **Return-to-AI:** `PATCH /staff-chat/rooms/:id/return-to-ai` → `handoffMode=false, status=ACTIVE` (does NOT touch `aiPaused`). Roles OWNER/BM/FM.
- **AI on/off pair (real, audited, emits `chat:room:update`):** `POST /chat-ai/take-over/:roomId` → `aiPaused=true` + `assignedToId=staff`; `POST /chat-ai/release-to-ai/:roomId` → `aiPaused=false` + audit `AI_RELEASED`. Roles incl SALES. `aiPaused` gates the bot in `ai-auto-reply.service.ts`.
- **Contract detail route:** `/contracts/:id` (`App.tsx:494` → `ContractDetailPage`). `navigate` already imported in Customer360Panel.
- **Room payload** (`GET /staff-chat/rooms/:id` → `findById`, uses `include` not `select`) returns ALL scalars incl `aiPaused`, `resolvedAt`, `status`, `handoffMode` — so the toggle/undo read live initial state correctly.

## Verified frontend facts

- **`Customer360Panel.tsx`**: no-customer state (376–430) shows only a "สร้างลูกค้าจากแชทนี้" button (`navigate('/customers?new=1...')`) — NO link-existing affordance. The QuickAction "ดำเนินการ" popover (782–836) holds call (`handleCall`→`originateCall`), `triggerContractAction('send-link'|'contact-log'|'mdm-lock'|'view-pdf')` (Batch-0 picker), and view-customer-info. Sticky profile header ~474–529. Contract cards 645–704 (static `bg-muted` divs, key `c.id`). Skeleton only for the `customer` profile query (447–464); `customer-chat-summary` (the contracts/payments/etc. query) has NO loading skeleton. `SectionHeader` helper ~1341; `ChevronRight` rotate pattern in `RecentPaymentGroup` ~1273. `navigate`, `useDebounce`, shadcn `Dialog`, `Button` already imported.
- **`index.tsx`**: `resolveMutation` + `returnToAIMutation` (~168–205) POST/PATCH the resolve / return-to-ai endpoints, toast + invalidate `['chat-rooms']`/`['chat-room', activeRoomId]`; no undo today. `sessionQuery` (`/staff-chat/rooms/:id`) drives `session` (carries `aiPaused`, `resolvedAt`). `customerId = sessionQuery.data?.customerId`.
- **`ChatPanel.tsx`**: header right-side action cluster ~516–557 (pin, mute bell from Batch 4, customer-info, SessionActions). `onResolve`/`onReturnToAI` props.

---

### Task 1 (backend): `reopen` endpoint (inverse of resolve)

**Files:**
- Modify: `apps/api/src/modules/chat-engine/services/assignment.service.ts` (add `reopen`)
- Test: `apps/api/src/modules/chat-engine/services/assignment.service.spec.ts` (add a case)
- Modify: `apps/api/src/modules/staff-chat/staff-chat.controller.ts` (add the route next to `resolve`, ~227)

**Interfaces:**
- Produces: `AssignmentService.reopen(roomId: string): Promise<void>` — sets `status=ACTIVE, resolvedAt=null`; and `PATCH /staff-chat/rooms/:id/reopen`.

- [ ] **Step 1: Write the failing test**

Add to `assignment.service.spec.ts` (read it first to match its mocking style; it already tests `resolve`). A `reopen` test mirroring the `resolve` one:

```ts
describe('reopen', () => {
  it('reactivates a resolved room (status ACTIVE, clears resolvedAt)', async () => {
    await service.reopen('room1');
    expect(prisma.chatRoom.update).toHaveBeenCalledWith({
      where: { id: 'room1' },
      data: { status: ChatRoomStatus.ACTIVE, resolvedAt: null },
    });
  });
});
```

(Match the spec's existing `prisma` mock + `ChatRoomStatus` import exactly as the `resolve` test does.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && npx jest src/modules/chat-engine/services/assignment.service.spec.ts --runInBand`
Expected: FAIL — `service.reopen is not a function`.

- [ ] **Step 3: Add the `reopen` service method**

In `assignment.service.ts`, next to `resolve` (~174–200), add:

```ts
  /** Inverse of resolve — reactivate a resolved room (for undo). */
  async reopen(roomId: string): Promise<void> {
    await this.prisma.chatRoom.update({
      where: { id: roomId },
      data: { status: ChatRoomStatus.ACTIVE, resolvedAt: null },
    });
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && npx jest src/modules/chat-engine/services/assignment.service.spec.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Add the controller route**

In `staff-chat.controller.ts`, directly after the `resolveRoom` handler (~227–232), add (same roles as resolve):

```ts
  @Patch('rooms/:id/reopen')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async reopenRoom(@Param('id') id: string) {
    await this.assignment.reopen(id);
    return { success: true };
  }
```

- [ ] **Step 6: Typecheck the API**

Run: `./tools/check-types.sh api`
Expected: API OK.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/chat-engine/services/assignment.service.ts \
        apps/api/src/modules/chat-engine/services/assignment.service.spec.ts \
        apps/api/src/modules/staff-chat/staff-chat.controller.ts
git commit -m "feat(inbox): reopen endpoint (inverse of resolve) for undo"
```

---

### Task 2 (frontend): Link an existing customer to an unlinked room

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx` (no-customer state 376–430; add a search Dialog + link mutation)

**Interfaces:** consumes `PATCH /staff-chat/rooms/:id/customer` + `GET /customers/search?q=`.

- [ ] **Step 1: Add the link mutation + search state**

In `Customer360Panel.tsx`, add state + a debounced search query + a link mutation (place near the other hooks). `useDebounce`, `useQuery`, `useMutation`, `api`, `toast`, `Dialog`, `Button` are already imported (verify; add any missing from the file's existing import set):

```tsx
const [linkOpen, setLinkOpen] = useState(false);
const [linkSearch, setLinkSearch] = useState('');
const debouncedLinkSearch = useDebounce(linkSearch, 400);

const linkSearchQuery = useQuery({
  queryKey: ['customer-search', debouncedLinkSearch],
  queryFn: () => api.get(`/customers/search?q=${encodeURIComponent(debouncedLinkSearch)}`).then((r) => r.data?.data ?? r.data),
  enabled: linkOpen && debouncedLinkSearch.trim().length >= 2,
});

const linkCustomer = useMutation({
  mutationFn: (customerId: string) =>
    api.patch(`/staff-chat/rooms/${activeRoomId}/customer`, { customerId }),
  onSuccess: () => {
    toast.success('ผูกลูกค้ากับแชทนี้แล้ว');
    setLinkOpen(false);
    setLinkSearch('');
    queryClient.invalidateQueries({ queryKey: ['chat-room', activeRoomId] });
    queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
  },
  onError: (err: { response?: { data?: { message?: string } } }) =>
    toast.error(err?.response?.data?.message ?? 'ผูกลูกค้าไม่สำเร็จ'),
});
```

(`queryClient` — confirm it's available via `useQueryClient()` in this file; if not, add it.)

- [ ] **Step 2: Add a "ผูกลูกค้าที่มีอยู่" button to the no-customer state**

In the no-customer block (376–430), after the "สร้างลูกค้าจากแชทนี้" `<Button>`, add a secondary button (only when `activeRoomId`):

```tsx
{activeRoomId && (
  <Button variant="outline" size="sm" className="w-full" onClick={() => setLinkOpen(true)}>
    <Link2 className="w-3.5 h-3.5 mr-1.5" /> ผูกลูกค้าที่มีอยู่
  </Button>
)}
```

(`Link2` is already imported.)

- [ ] **Step 3: Add the search Dialog**

Render a Dialog (place near the panel's other dialogs, e.g. the contract picker at ~842):

```tsx
<Dialog open={linkOpen} onOpenChange={(o) => { setLinkOpen(o); if (!o) setLinkSearch(''); }}>
  <DialogContent className="max-w-md">
    <DialogHeader>
      <DialogTitle className="flex items-center gap-2">
        <Link2 className="w-4 h-4" /> ผูกลูกค้าที่มีอยู่
      </DialogTitle>
    </DialogHeader>
    <input
      autoFocus
      value={linkSearch}
      onChange={(e) => setLinkSearch(e.target.value)}
      placeholder="ค้นหาชื่อ / เบอร์ / เลขบัตร (อย่างน้อย 2 ตัวอักษร)"
      className="w-full px-3 py-2 text-sm rounded-md bg-muted/40 border-0 focus:outline-none focus:ring-1 focus:ring-primary/20 focus:bg-background placeholder:text-muted-foreground/40"
    />
    <div className="max-h-72 overflow-y-auto space-y-1">
      {linkSearchQuery.isFetching && (
        <p className="text-xs text-muted-foreground text-center py-3 leading-snug">กำลังค้นหา...</p>
      )}
      {!linkSearchQuery.isFetching && debouncedLinkSearch.trim().length >= 2 &&
        (linkSearchQuery.data?.length ?? 0) === 0 && (
        <p className="text-xs text-muted-foreground text-center py-3 leading-snug">ไม่พบลูกค้า</p>
      )}
      {(linkSearchQuery.data ?? []).map((c: { id: string; name: string; phone?: string }) => (
        <button
          key={c.id}
          type="button"
          disabled={linkCustomer.isPending}
          onClick={() => linkCustomer.mutate(c.id)}
          className="w-full text-left p-2.5 rounded-lg border border-border hover:bg-accent text-sm transition-colors disabled:opacity-50"
        >
          <span className="font-medium text-foreground">{c.name}</span>
          {c.phone && <span className="text-xs text-muted-foreground ml-2">{c.phone}</span>}
        </button>
      ))}
    </div>
  </DialogContent>
</Dialog>
```

(Use the actual `DialogContent`/`DialogHeader`/`DialogTitle` import names already used by the panel's contract picker.)

- [ ] **Step 4: Typecheck**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`.

- [ ] **Step 5: Manual verification**

On an unlinked room: a "ผูกลูกค้าที่มีอยู่" button appears below "สร้างลูกค้าจากแชทนี้". Click → dialog; type ≥2 chars → debounced results; pick one → "ผูกลูกค้าแล้ว", the dialog closes, and the 360 panel repopulates with that customer's contracts/payments. Linking a room already linked elsewhere → the 409 Thai error toast.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx
git commit -m "feat(inbox): link an existing customer to an unlinked room (search + link)"
```

---

### Task 3 (frontend): Undo for resolve + return-to-AI

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/index.tsx` (resolve/returnToAI mutations → success toast with an undo action; add reopen + take-over undo mutations)

**Interfaces:** consumes `PATCH /staff-chat/rooms/:id/reopen` (Task 1) + `POST /chat-ai/take-over/:roomId`.

- [ ] **Step 1: Add the undo mutations**

In `index.tsx`, near the existing mutations, add:

```tsx
const reopenMutation = useMutation({
  mutationFn: (roomId: string) => api.patch(`/staff-chat/rooms/${roomId}/reopen`),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
    queryClient.invalidateQueries({ queryKey: ['chat-room', activeRoomId] });
  },
  onError: () => toast.error('เลิกทำไม่สำเร็จ'),
});

const takeOverMutation = useMutation({
  mutationFn: (roomId: string) => api.post(`/chat-ai/take-over/${roomId}`),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
    queryClient.invalidateQueries({ queryKey: ['chat-room', activeRoomId] });
  },
  onError: () => toast.error('เลิกทำไม่สำเร็จ'),
});
```

- [ ] **Step 2: Add the undo action to the resolve success toast**

In `resolveMutation.onSuccess`, replace the plain success toast with an action toast (capture the roomId in the mutation variable so undo targets the right room even after switching):

```tsx
const resolveMutation = useMutation({
  mutationFn: (roomId: string) => api.patch(`/staff-chat/rooms/${roomId}/resolve`),
  onSuccess: (_data, roomId) => {
    queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
    queryClient.invalidateQueries({ queryKey: ['chat-room', activeRoomId] });
    toast.success('ปิดแชทแล้ว', {
      action: { label: 'เลิกทำ', onClick: () => reopenMutation.mutate(roomId) },
    });
  },
  onError: () => toast.error('ปิดแชทไม่สำเร็จ'),
});
```

(Match the existing `resolveMutation` shape — keep its existing `mutationFn`; only the `onSuccess` toast gains the action. If the current call site passes `activeRoomId` implicitly, ensure `roomId` is the mutation variable.)

- [ ] **Step 3: Add the undo action to the return-to-AI success toast**

Similarly for `returnToAIMutation.onSuccess` — undo = `take-over` (re-pause AI + re-grab the room, the honest inverse):

```tsx
    toast.success('ส่งกลับ Bot แล้ว', {
      action: { label: 'เลิกทำ', onClick: () => takeOverMutation.mutate(roomId) },
    });
```

(Ensure `returnToAIMutation`'s variable is the `roomId`.)

- [ ] **Step 4: Typecheck**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`.

- [ ] **Step 5: Manual verification**

Resolve a room → "ปิดแชทแล้ว" toast with a "เลิกทำ" button → clicking it reactivates the room (reappears active in the list). Return-to-AI a room → "ส่งกลับ Bot แล้ว" with "เลิกทำ" → clicking re-pauses AI + re-grabs the room. Undo targets the right room even after switching rooms before clicking.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/index.tsx
git commit -m "feat(inbox): undo for resolve (reopen) + return-to-AI (take-over)"
```

---

### Task 4 (frontend): Inline AI pause toggle

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/index.tsx` (take-over/release mutations + pass to ChatPanel)
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx` (toggle button in the header action cluster)

**Interfaces:** consumes `POST /chat-ai/take-over/:roomId` ↔ `POST /chat-ai/release-to-ai/:roomId`; reads `session.aiPaused`.

- [ ] **Step 1: Add the AI-toggle mutation**

In `index.tsx` (reuse `takeOverMutation` from Task 3 for pause; add a release mutation):

```tsx
const releaseToAiMutation = useMutation({
  mutationFn: (roomId: string) => api.post(`/chat-ai/release-to-ai/${roomId}`),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
    queryClient.invalidateQueries({ queryKey: ['chat-room', activeRoomId] });
  },
  onError: () => toast.error('สลับสถานะ AI ไม่สำเร็จ'),
});

const aiTogglePending = takeOverMutation.isPending || releaseToAiMutation.isPending;
const handleToggleAi = () => {
  if (!activeRoomId) return;
  if (sessionQuery.data?.aiPaused) releaseToAiMutation.mutate(activeRoomId);
  else takeOverMutation.mutate(activeRoomId);
};
```

Pass to ChatPanel: `aiPaused={sessionQuery.data?.aiPaused ?? false}`, `onToggleAi={handleToggleAi}`, `aiTogglePending={aiTogglePending}`.

- [ ] **Step 2: Render the toggle in ChatPanel's header**

Add props `aiPaused?: boolean; onToggleAi?: () => void; aiTogglePending?: boolean;`. In the header action cluster (~516–557, near the mute bell), add a Bot toggle:

```tsx
{onToggleAi && (
  <button
    type="button"
    onClick={onToggleAi}
    disabled={aiTogglePending}
    title={aiPaused ? 'เปิด AI ตอบอัตโนมัติ' : 'หยุด AI (พนักงานตอบเอง)'}
    aria-label="สลับสถานะ AI"
    className={cn(
      'p-1.5 rounded-lg transition-colors disabled:opacity-50',
      aiPaused
        ? 'text-muted-foreground hover:text-foreground hover:bg-accent'
        : 'text-primary bg-primary/10 hover:bg-primary/20',
    )}
  >
    {aiPaused ? <BotOff className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
  </button>
)}
```

Add `Bot, BotOff` to ChatPanel's lucide import.

- [ ] **Step 3: Typecheck**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`.

- [ ] **Step 4: Manual verification**

The header shows a Bot toggle reflecting `aiPaused`: when AI is active it's highlighted (primary); clicking pauses AI (`take-over`) → icon flips to BotOff; clicking again resumes (`release-to-ai`). The "ต้องตอบ"/AI badges in the list update live via the WS `chat:room:update`. Disabled while pending.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/index.tsx \
        apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx
git commit -m "feat(inbox): inline AI pause/resume toggle in the chat header"
```

---

### Task 5 (frontend): Clickable contract cards + skeletons + collapsible sections

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx` (contract cards 645–704; thread `summary` loading; collapsible `SectionHeader`)

**Interfaces:** uses `navigate('/contracts/:id')`; the existing `customer-chat-summary` query's loading flag.

- [ ] **Step 1: Make contract cards clickable**

In the contract cards map (651–699), make the card body navigate to the contract detail; add hover affordance. Wrap the card content's click area:

```tsx
<div
  key={c.id}
  onClick={() => navigate(`/contracts/${c.id}`)}
  className="p-2.5 bg-muted rounded-lg text-xs cursor-pointer hover:bg-accent transition-colors"
  title="ดูรายละเอียดสัญญา"
>
  {/* ...existing card inner content... */}
</div>
```

(If any inner element is itself interactive, add `e.stopPropagation()` to it. Today the cards have no inline buttons, so a plain card-level onClick is safe.)

- [ ] **Step 2: Skeleton while the summary loads**

Find the `customer-chat-summary` `useQuery` and capture its loading flag (e.g. `const summaryLoading = customerSummaryQuery.isLoading` — use the actual query variable name). In the Contracts section (645–704), render a skeleton instead of the "ไม่มีสัญญา…" empty text while loading:

```tsx
{summaryLoading ? (
  <div className="space-y-2">
    {[1, 2].map((i) => (
      <div key={i} className="p-2.5 bg-muted rounded-lg">
        <div className="h-3 w-24 bg-muted-foreground/20 rounded animate-pulse mb-2" />
        <div className="h-2.5 w-36 bg-muted-foreground/20 rounded animate-pulse" />
      </div>
    ))}
  </div>
) : summary?.activeContracts?.length > 0 ? (
  /* ...existing cards... */
) : (
  /* ...existing empty text... */
)}
```

(Apply the same `summaryLoading ? <skeleton> :` guard to the Payments and Chat-history sections — small skeleton blocks reusing the `animate-pulse` divs already proven at 450–461.)

- [ ] **Step 3: Collapsible sections (localStorage-persisted)**

Add a tiny collapse state persisted globally. Near the top of the component:

```tsx
const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
  try {
    return JSON.parse(localStorage.getItem('inbox360.collapsed.v1') || '{}');
  } catch {
    return {};
  }
});
const toggleSection = (key: string) =>
  setCollapsed((prev) => {
    const next = { ...prev, [key]: !prev[key] };
    try {
      localStorage.setItem('inbox360.collapsed.v1', JSON.stringify(next));
    } catch {}
    return next;
  });
```

Make the `SectionHeader` helper (~1341) accept an optional `collapsed`/`onToggle` and render a `ChevronRight` that rotates 90° when expanded (reuse the rotate pattern from `RecentPaymentGroup` ~1273). Wrap the body of each collapsible section (Contracts, Payments, Chat History, Call Logs, Internal Notes, Cross-channel, Warranty) so it renders only when `!collapsed[key]`. Keep the sticky profile header + the overdue alert always visible (NOT collapsible).

- [ ] **Step 4: Typecheck**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`.

- [ ] **Step 5: Manual verification**

Opening a customer for the first time shows section skeletons (not "ไม่มีข้อมูล") while the summary loads, then real data. Clicking a section header collapses/expands it with a rotating chevron; the collapsed set persists across customers and refreshes (localStorage). The profile header + overdue alert never collapse. Clicking a contract card navigates to `/contracts/:id` (hover shows it's clickable).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx
git commit -m "feat(inbox): clickable contract cards + summary skeletons + collapsible 360 sections"
```

---

### Task 6 (frontend): Promote call + ส่งลิงก์ชำระ to the 360 profile header

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx` (sticky profile header ~474–529)

**Interfaces:** reuses `handleCall` (`originateCall`) + `triggerContractAction('send-link')` (Batch-0 picker) — already in this component.

- [ ] **Step 1: Add a call + pay button row in the sticky profile header**

In the sticky profile header block (~474–529, the `shrink-0` area with avatar + risk badge), add a prominent two-button row (so staff don't have to open the "ดำเนินการ" popover for the two most-common actions). Gate on having contracts / a customer:

```tsx
{summary?.activeContracts?.length > 0 && (
  <div className="flex gap-2 mt-3">
    <button
      type="button"
      onClick={handleCall}
      disabled={originateCall.isPending || callStatus === 'calling'}
      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-muted hover:bg-accent text-xs font-medium transition-colors disabled:opacity-50"
    >
      <Phone className="w-3.5 h-3.5" />
      {originateCall.isPending || callStatus === 'calling' ? 'กำลังโทร...' : 'โทร'}
    </button>
    <button
      type="button"
      onClick={() => triggerContractAction('send-link')}
      disabled={sendPaymentFlex.isPending}
      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition-colors disabled:opacity-50"
    >
      <Link2 className="w-3.5 h-3.5" />
      {sendPaymentFlex.isPending ? 'กำลังส่ง...' : 'ส่งลิงก์ชำระ'}
    </button>
  </div>
)}
```

(All handlers/icons — `handleCall`, `originateCall`, `callStatus`, `triggerContractAction`, `sendPaymentFlex`, `Phone`, `Link2` — already exist in this file. The "ดำเนินการ" popover stays for the lower-frequency actions.)

- [ ] **Step 2: Typecheck**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`.

- [ ] **Step 3: Manual verification**

The profile header shows prominent "โทร" + "ส่งลิงก์ชำระ" buttons (when the customer has active contracts). "ส่งลิงก์ชำระ" still routes through the Batch-0 multi-contract picker (2+ contracts → pick; never silent). The popover still has the full action list. Buttons hide when there are no contracts.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx
git commit -m "feat(inbox): promote call + ส่งลิงก์ชำระ to the customer-360 header"
```

---

## Self-Review

**1. Spec coverage (Batch 5 = customer-360):** link existing customer → Task 2; promote call/pay → Task 6; undo resolve/return-AI → Task 3 (+ Task 1 reopen endpoint); skeletons + collapsible → Task 5; clickable contract cards → Task 5; inline AI pause → Task 4. All in.

**2. Placeholder scan:** backend `reopen` is TDD'd; the frontend tasks reuse verified endpoints with complete code. The Customer360Panel insertion points (profile header, sections, no-customer state) are precise line ranges; the implementer reads the file to match the exact `SectionHeader`/query variable names (noted where to confirm). No unit-testable pure logic is added beyond Task 1's service method (component/mutation/render work is tsc + manual, appropriate).

**3. Type consistency:** `reopen(roomId): Promise<void>` (Task 1) consumed by `reopenMutation` (Task 3). `take-over`/`release-to-ai` mutations shared between undo (Task 3) and the AI toggle (Task 4) — `takeOverMutation` defined once (Task 3), reused in Task 4; `releaseToAiMutation` added in Task 4. `aiPaused` read from `sessionQuery.data` (the room payload includes it). The Batch-0 `triggerContractAction('send-link')` picker is reused for the promoted pay button (no wrong-contract risk).

**4. Safety/edge:** pay stays routed through the multi-contract picker; link surfaces the 409 already-linked error; customer-search is debounced ≥400ms + ≥2 chars (PII-audited); undo targets the captured `roomId` not `activeRoomId`; collapse persists globally; the AI toggle reconciles via WS room-update.

## Rollout

One branch off `main` (e.g. `feat/inbox-batch5-customer360`) with the six commits → merge → deploy (backend reopen + frontend) → user verifies: link existing customer, header call/pay, undo resolve + return-to-AI, skeletons/collapsible, clickable cards, AI pause toggle. Then Batch 6 (mobile/a11y).
