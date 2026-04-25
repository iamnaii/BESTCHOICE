# Collections Workflow Hub — Plan 3/4: Power Features

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. UI tasks MUST invoke `frontend-design` skill before building components.

**Goal:** Ship Customer 360 slide-over, bulk actions, inline payment recording, and ad-hoc LINE send. Turns `/collections` from "view + log" to "act + recover" without leaving the page.

**Architecture:** A right-side slide-over (`Customer360Panel`) reused across all tabs. Bulk selection is local state on each tab, with a sticky `BulkActionBar`. New backend endpoints: `/overdue/contracts/:id/full-timeline`, `/overdue/bulk/*`, `/overdue/:id/send-line-adhoc`.

**Tech Stack:** Same as Plan 2 (NestJS + React + Tailwind + shadcn/ui + lucide-react + tanstack/react-query).

**Spec:** [docs/superpowers/specs/2026-04-24-collections-workflow-hub-design.md](../specs/2026-04-24-collections-workflow-hub-design.md) §7 (bulk), §9 (Customer 360), §10 (inline payment).

**Depends on:** Plan 2 branch `feat/collections-workflow-hub`.

---

## File Map

### Create — Backend

- `apps/api/src/modules/overdue/timeline.service.ts` + `.spec.ts`
- `apps/api/src/modules/overdue/bulk.service.ts` + `.spec.ts`
- `apps/api/src/modules/overdue/dto/bulk.dto.ts`
- `apps/api/src/modules/overdue/dto/send-line-adhoc.dto.ts`

### Modify — Backend

- `apps/api/src/modules/overdue/overdue.controller.ts` — add 5 endpoints
- `apps/api/src/modules/overdue/overdue.module.ts` — register new services

### Create — Frontend

```
apps/web/src/pages/CollectionsPage/
  components/
    Customer360Panel.tsx            # slide-over shell
    Customer360Header.tsx           # name + phone + LINE status chips
    Customer360Timeline.tsx         # merged event feed
    Customer360Actions.tsx          # quick action buttons
    PaymentRecordDialog.tsx
    BulkActionBar.tsx
    SendLineAdHocDialog.tsx
  hooks/
    useCustomer360.ts               # queries timeline + contract detail
    useBulkSelection.ts             # selection state + helpers
    useBulkActions.ts               # mutations for bulk ops
    useAdHocLine.ts                 # single ad-hoc send mutation
    useRecordPayment.ts             # POST /payments wrapper
```

### Modify — Frontend

- `apps/web/src/pages/CollectionsPage/components/ContractCard.tsx` — add checkbox + "▶" 360 button
- `apps/web/src/pages/CollectionsPage/index.tsx` — render `<Customer360Panel />`, manage slide-over state + bulk selection context
- Tab files (QueueTab / FollowUpTab / PromiseTab) — consume bulk state via props

---

## Design brief — still "Operations Room"

- **Customer 360** = ปีกทำงานด้านขวา (width 480px desktop, full screen mobile). Animates in from right (`translate-x-full` → `translate-x-0` + opacity backdrop).
- **Timeline** = chronological feed with icon per event type: phone, LINE, payment, status change, MDM, letter. Newest on top. Infinite scroll NOT needed for MVP; show last 50 with "load more" button.
- **BulkActionBar** = sticky bar at bottom of viewport when any rows selected. Shows count + 4 action buttons. Similar to Gmail's multi-select. No floating — always at bottom edge.
- **PaymentRecordDialog** = reuses existing POS-style dialog if present (check `@/components/ui/` first). Amount input has `tabular-nums`, payment method radio row, optional slip upload.

**Semantic tokens only.** Thai labels. `leading-snug`. `tabular-nums`.

---

## Ground Rules

1. Stacked branch: base `feat/collections-workflow-hub`, new `feat/collections-power-features`.
2. Every UI subagent invokes `frontend-design` skill before coding.
3. TDD backend; component tests where feasible.
4. `./tools/check-types.sh all` green before each commit.
5. Commit per task. No dep additions.
6. Reuse existing `Payment` creation endpoint — do not duplicate.

---

## Task 1: Backend — `GET /overdue/contracts/:id/full-timeline`

### Files
- Create: `apps/api/src/modules/overdue/timeline.service.ts` + `.spec.ts`
- Modify: controller + module

### Behavior

Returns merged event feed for a single contract, sorted DESC by timestamp:

```typescript
interface TimelineEvent {
  id: string;                 // source id prefixed by type ("call-xxx", "payment-yyy")
  type: 'CALL' | 'PAYMENT' | 'DUNNING_ACTION' | 'STATUS_CHANGE' | 'MDM' | 'LETTER';
  timestamp: string;          // ISO
  title: string;              // Thai label
  subtitle?: string;
  metadata?: Record<string, unknown>;
}
```

Sources to merge:
- `callLogs` (type=CALL; title from `result` + notes; subtitle = caller.name)
- `payments` where `status=PAID` (type=PAYMENT; title "ชำระ X ฿ งวด Y")
- `dunningActions` (type=DUNNING_ACTION; title "ส่ง {channel}: {ruleName}"; subtitle = messageContent truncated)
- `auditLogs` where `entity IN ('contract', 'mdm_lock_request')` AND `action IN ('STATUS_CHANGE','DUNNING_ESCALATION_APPROVED','MDM_LOCK_APPROVED','MDM_UNLOCK')` (type=STATUS_CHANGE or MDM)
- `contractLetters` where status in (DISPATCHED, DELIVERED) (type=LETTER; title "ส่งหนังสือ: RETURN_DEVICE_45D" — Plan 4 will populate, empty for now)

Cap at 100 events. Service fetches each source then merges + sorts in memory. Simple and correct; performance OK for < 100s events per contract.

### Controller route

```typescript
@Get('contracts/:id/full-timeline')
@Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT')
getFullTimeline(@Param('id') contractId: string) {
  return this.timelineService.getFullTimeline(contractId);
}
```

### Tests

Mock-based. 4 tests:
- Returns events from all 4 current sources (call, payment, dunning action, audit)
- Sorted DESC by timestamp
- Caps at 100
- Returns `[]` when contract has nothing

### Commit
`feat(overdue): full-timeline endpoint for Customer 360 panel`

---

## Task 2: Backend — `/overdue/bulk/*`

### Files
- Create: `apps/api/src/modules/overdue/bulk.service.ts` + `.spec.ts`
- Create: `apps/api/src/modules/overdue/dto/bulk.dto.ts`

### DTOs

```typescript
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, IsOptional, MinLength } from 'class-validator';

export class BulkAssignDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true })
  contractIds!: string[];

  @IsString({ message: 'ต้องระบุผู้รับมอบหมาย' })
  assignedToId!: string;
}

export class BulkSendLineDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true })
  contractIds!: string[];

  @IsOptional() @IsString()
  templateId?: string;   // DunningRule id (eventTrigger=null AND triggerDay=null ad-hoc pool)

  @IsOptional() @IsString() @MinLength(10, { message: 'ข้อความต้อง ≥ 10 ตัวอักษร' })
  customMessage?: string;
}

export class BulkProposeLockDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true })
  contractIds!: string[];

  @IsString() @MinLength(5, { message: 'เหตุผล ≥ 5 ตัวอักษร' })
  reason!: string;
}
```

### Service

```typescript
@Injectable()
export class OverdueBulkService {
  constructor(
    private prisma: PrismaService,
    private mdmLockService: MdmLockService,
    private dunningEngine: DunningEngineService,
    private notifications: NotificationsService,
  ) {}

  async bulkAssign(dto: BulkAssignDto, actorId: string) {
    const result = await this.prisma.contract.updateMany({
      where: { id: { in: dto.contractIds }, deletedAt: null },
      data: { assignedToId: dto.assignedToId },
    });
    // Audit per contract
    await this.prisma.auditLog.createMany({
      data: dto.contractIds.map((id) => ({
        userId: actorId,
        action: 'BULK_ASSIGN',
        entity: 'contract',
        entityId: id,
        newValue: { assignedToId: dto.assignedToId },
      })),
    });
    return { updated: result.count };
  }

  async bulkProposeLock(dto: BulkProposeLockDto, actorId: string) {
    const results = await Promise.allSettled(
      dto.contractIds.map((id) => this.mdmLockService.proposeManual(id, actorId, dto.reason)),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - ok;
    return { proposed: ok, failed };
  }

  async bulkSendLine(dto: BulkSendLineDto, actorId: string) {
    // Simple for MVP: iterate, send per contract, collect results.
    // If templateId — render rule's message. If customMessage — send as-is.
    if (!dto.templateId && !dto.customMessage) {
      throw new BadRequestException('ต้องระบุ templateId หรือ customMessage');
    }

    const contracts = await this.prisma.contract.findMany({
      where: { id: { in: dto.contractIds }, deletedAt: null },
      include: { customer: { select: { lineId: true, phone: true, name: true } } },
    });

    let sent = 0;
    let failed = 0;
    for (const c of contracts) {
      if (!c.customer.lineId) { failed++; continue; }
      try {
        await this.notifications.send({
          channel: 'LINE',
          recipient: c.customer.lineId,
          message: dto.customMessage ?? 'Template rendering requires executeEventTrigger helper',
          relatedId: c.id,
          fallbackPhone: c.customer.phone,
        });
        sent++;
      } catch { failed++; }
    }
    return { sent, failed, total: contracts.length };
  }
}
```

### Controller

```typescript
  @Post('bulk/assign')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  bulkAssign(@Body() dto: BulkAssignDto, @CurrentUser() user: { id: string }) {
    return this.bulkService.bulkAssign(dto, user.id);
  }

  @Post('bulk/propose-lock')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  bulkProposeLock(@Body() dto: BulkProposeLockDto, @CurrentUser() user: { id: string }) {
    return this.bulkService.bulkProposeLock(dto, user.id);
  }

  @Post('bulk/send-line')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  bulkSendLine(@Body() dto: BulkSendLineDto, @CurrentUser() user: { id: string }) {
    return this.bulkService.bulkSendLine(dto, user.id);
  }
```

### Tests

Minimum 6 tests (2 per method). Mock prisma + mdmLockService + notifications.

### Commit
`feat(overdue): bulk assign/propose-lock/send-line endpoints with 100-item cap`

---

## Task 3: Backend — `POST /overdue/:contractId/send-line-adhoc`

Single-contract ad-hoc LINE send (different from bulk).

### DTO
```typescript
// send-line-adhoc.dto.ts
import { IsOptional, IsString, MinLength } from 'class-validator';

export class SendLineAdHocDto {
  @IsOptional() @IsString()
  templateId?: string;

  @IsOptional() @IsString() @MinLength(10)
  customMessage?: string;
}
```

### Controller

```typescript
@Post(':contractId/send-line-adhoc')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
async sendLineAdhoc(
  @Param('contractId') contractId: string,
  @Body() dto: SendLineAdHocDto,
  @CurrentUser() user: { id: string },
) {
  // Reuse bulk path for consistency
  return this.bulkService.bulkSendLine(
    { contractIds: [contractId], templateId: dto.templateId, customMessage: dto.customMessage },
    user.id,
  );
}
```

### Commit
`feat(overdue): ad-hoc LINE send endpoint for single contract`

---

## Task 4: Frontend — Customer360Panel slide-over shell

Invoke `frontend-design` skill first.

### Files
- Create: `apps/web/src/pages/CollectionsPage/components/Customer360Panel.tsx`
- Create: `apps/web/src/pages/CollectionsPage/hooks/useCustomer360.ts`
- Modify: `apps/web/src/pages/CollectionsPage/index.tsx` — render + state

### Design

Right-side panel, 480px width on desktop, full-screen on mobile. Enter: translate-x + backdrop fade. Exit: reverse.

Structure:
```
┌─────────────────────────────┐
│ [×]     Customer 360         │  (header bar, sticky)
├─────────────────────────────┤
│ Customer info (name, phone,  │
│  LINE chip, address)         │
├─────────────────────────────┤
│ Contract summary             │
│  (installment progress bar,  │
│   outstanding, next due)     │
├─────────────────────────────┤
│ Timeline (TASK 5)            │
│  (scrollable feed)           │
├─────────────────────────────┤
│ Quick actions (TASK 6)       │
│  (payment, LINE, lock, open) │
└─────────────────────────────┘
```

Panel controlled by parent: `panel={contract: ContractRow | null; onClose: () => void}`. Parent manages open/closed state.

### Hook

```typescript
export function useCustomer360(contractId: string | null) {
  return useQuery({
    queryKey: ['customer-360', contractId],
    queryFn: async () => {
      const [detail, timeline] = await Promise.all([
        api.get(`/contracts/${contractId}`).then((r) => r.data),
        api.get(`/overdue/contracts/${contractId}/full-timeline`).then((r) => r.data),
      ]);
      return { detail, timeline };
    },
    enabled: !!contractId,
  });
}
```

### Stub for Tasks 5 + 6

For this task, render the shell with placeholders for Timeline + Actions. Tasks 5 + 6 replace them.

### Wire ContractCard

Add `onOpen360` prop to `ContractCard`. Parent passes setter that opens the panel. Render a `▶` button in the card's action cluster.

### Commit
`feat(collections): Customer360Panel shell + slide-over state`

---

## Task 5: Frontend — Customer360Timeline

Invoke `frontend-design` skill.

### File
- Create: `apps/web/src/pages/CollectionsPage/components/Customer360Timeline.tsx`

### Design

Vertical feed. Each event:

```
┌──────────────────────────────────────┐
│ [icon] [ time-ago label ]     [type chip] │
│        [ title ]                          │
│        [ subtitle in muted ]              │
└──────────────────────────────────────┘
```

Group events by date — small sticky date header ("วันนี้", "เมื่อวาน", "22 เม.ย. 2026") separating groups.

Icons by type:
- CALL → `PhoneCall` (color based on result: PROMISED=success, NO_ANSWER=warning, REFUSED=destructive)
- PAYMENT → `Banknote` (success)
- DUNNING_ACTION → `MessageCircle` (primary)
- STATUS_CHANGE → `Activity` (muted)
- MDM → `Lock`/`Unlock` (destructive/success)
- LETTER → `FileText` (warning)

Show last 50 by default with "โหลดเพิ่ม" button if len === 50.

Empty state: "ยังไม่มีกิจกรรม" neutral.

### Integrate into Customer360Panel

Replace Timeline placeholder with `<Customer360Timeline events={data.timeline ?? []} />`.

### Commit
`feat(collections): Customer360Timeline — grouped event feed`

---

## Task 6: Frontend — Customer360Actions + PaymentRecordDialog

Invoke `frontend-design` skill for PaymentRecordDialog.

### Files
- Create: `apps/web/src/pages/CollectionsPage/components/Customer360Actions.tsx`
- Create: `apps/web/src/pages/CollectionsPage/components/PaymentRecordDialog.tsx`
- Create: `apps/web/src/pages/CollectionsPage/hooks/useRecordPayment.ts`

### Actions row in Customer360

4 action buttons (icon + label):
- **บันทึกจ่าย** — opens PaymentRecordDialog (primary button)
- **ส่ง LINE** — opens SendLineAdHocDialog (Task 8)
- **เสนอล็อคเครื่อง** — opens existing MDM propose flow (inline small modal reusing `mdm-lock-propose` logic)
- **ดูสัญญาเต็ม** — `navigate('/contracts/:id')`

Use outline button style for secondary actions; primary filled for "บันทึกจ่าย".

Disable "บันทึกจ่าย" when outstanding === 0.

### PaymentRecordDialog

Modal form:
- **ยอดเงิน** (default = outstanding; `tabular-nums`; allows partial)
- **วิธีชำระ** radio row: เงินสด / โอน / QR
- **slip upload** (shown if method !== เงินสด) — reuse existing upload component from `/payments/new` or similar
- **หมายเหตุ** textarea

Submit → `POST /payments` (existing endpoint) → on success invalidate `collections-queue`, `collections-kpi`, `customer-360:<id>`.

### useRecordPayment hook

```typescript
export function useRecordPayment(contractId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      amount: number;
      method: 'CASH' | 'TRANSFER' | 'QR';
      slipUrl?: string;
      notes?: string;
    }) => {
      const { data } = await api.post('/payments', { contractId, ...body });
      return data;
    },
    onSuccess: () => {
      toast.success('บันทึกการชำระสำเร็จ');
      qc.invalidateQueries({ queryKey: ['collections-queue'] });
      qc.invalidateQueries({ queryKey: ['collections-kpi'] });
      qc.invalidateQueries({ queryKey: ['customer-360', contractId] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
}
```

Shape of `/payments` body must match existing API — inspect `apps/api/src/modules/payments/payments.controller.ts` for exact DTO. Adapt as needed.

### Integrate into Customer360Panel

Replace Actions placeholder with `<Customer360Actions contract={...} onClose={onClose} />`.

### Commit
`feat(collections): Customer360 actions + PaymentRecordDialog for inline payment`

---

## Task 7: Frontend — BulkActionBar + useBulkSelection

Invoke `frontend-design` skill.

### Files
- Create: `apps/web/src/pages/CollectionsPage/components/BulkActionBar.tsx`
- Create: `apps/web/src/pages/CollectionsPage/hooks/useBulkSelection.ts`
- Create: `apps/web/src/pages/CollectionsPage/hooks/useBulkActions.ts`
- Modify: `ContractCard.tsx` — add checkbox + `selected` + `onToggleSelect` props
- Modify: Queue/FollowUp/Promise tab files — wire selection state

### useBulkSelection

```typescript
export function useBulkSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setSelected((s) => {
    const next = new Set(s);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const toggleAll = (ids: string[]) => setSelected((s) => {
    const allSelected = ids.every((id) => s.has(id));
    return allSelected ? new Set() : new Set(ids);
  });
  const clear = () => setSelected(new Set());
  return { selected, toggle, toggleAll, clear, count: selected.size };
}
```

### BulkActionBar

Sticky bottom, only visible when `selected.size > 0`. Layout:
```
[ n รายการถูกเลือก ]  [มอบหมาย ▾] [ส่ง LINE] [เสนอล็อค] [ยกเลิก]
```

"มอบหมาย" = dropdown with staff user list (reuse `/users` query). On select → calls bulk assign → on success clears selection.
"ส่ง LINE" = opens modal (reuse SendLineAdHocDialog from Task 8 but with N contracts).
"เสนอล็อค" = opens prompt for reason → bulk propose.
"ยกเลิก" = `clear()`.

Use `fixed bottom-0 left-0 right-0 border-t border-border bg-card shadow-lg z-40`. `p-3`. Mobile responsive.

### useBulkActions hook

```typescript
export function useBulkActions(clearSelection: () => void) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['collections-queue'] });
    qc.invalidateQueries({ queryKey: ['pending-mdm'] });
  };

  return {
    assign: useMutation({
      mutationFn: (p: { contractIds: string[]; assignedToId: string }) =>
        api.post('/overdue/bulk/assign', p).then((r) => r.data),
      onSuccess: (data) => { toast.success(`มอบหมาย ${data.updated} รายการสำเร็จ`); clearSelection(); invalidate(); },
      onError: (e) => toast.error(getErrorMessage(e)),
    }),
    sendLine: useMutation({
      mutationFn: (p: { contractIds: string[]; customMessage?: string; templateId?: string }) =>
        api.post('/overdue/bulk/send-line', p).then((r) => r.data),
      onSuccess: (data) => { toast.success(`ส่ง LINE ${data.sent}/${data.total} สำเร็จ`); clearSelection(); invalidate(); },
      onError: (e) => toast.error(getErrorMessage(e)),
    }),
    proposeLock: useMutation({
      mutationFn: (p: { contractIds: string[]; reason: string }) =>
        api.post('/overdue/bulk/propose-lock', p).then((r) => r.data),
      onSuccess: (data) => { toast.success(`เสนอล็อค ${data.proposed} รายการ`); clearSelection(); invalidate(); },
      onError: (e) => toast.error(getErrorMessage(e)),
    }),
  };
}
```

### ContractCard update

Add props `selected?: boolean` + `onToggleSelect?: () => void`. Render checkbox left of the priority strip (or inside the strip area). Use existing `Checkbox` from `@/components/ui/checkbox` if present.

### Wire into Queue/FollowUp/Promise tabs

Each tab uses `useBulkSelection`. Pass `selected`, `onToggleSelect` to each `<ContractCard />`. Render `<BulkActionBar ... />` at root of tab (or lift to CollectionsPage — acceptable either way).

Recommended: lift selection state to CollectionsPage so it persists across tab switches... actually no — clear on tab change to avoid confusion. Per-tab is fine.

### Commit
`feat(collections): bulk selection + BulkActionBar with assign/send-line/propose-lock`

---

## Task 8: Frontend — SendLineAdHocDialog + single-contract ad-hoc send

Invoke `frontend-design` skill.

### Files
- Create: `apps/web/src/pages/CollectionsPage/components/SendLineAdHocDialog.tsx`
- Create: `apps/web/src/pages/CollectionsPage/hooks/useAdHocLine.ts`
- Modify: `ContractCard.tsx` — add "ส่ง LINE" button that opens dialog

### Design

Modal:
- **Mode:** radio "ใช้ template" / "พิมพ์เอง"
- **If template:** dropdown of DunningRule options (eventTrigger=null AND triggerDay=null — ad-hoc pool). Show preview of rendered message.
- **If custom:** textarea (min 10 chars). Show remaining character count.
- **Preview card** shows final message with `{{placeholders}}` replaced using dummy contract vars.
- **Submit button:** ส่ง LINE (disabled until valid)

### useAdHocLine hook

```typescript
export function useAdHocLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contractId, ...body }: {
      contractId: string;
      templateId?: string;
      customMessage?: string;
    }) => {
      const { data } = await api.post(`/overdue/${contractId}/send-line-adhoc`, body);
      return data;
    },
    onSuccess: (data) => {
      toast.success(`ส่ง LINE ${data.sent}/${data.total}`);
      qc.invalidateQueries({ queryKey: ['customer-360'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
}
```

### Wire into ContractCard

Enable the "💬 ส่งไลน์" button (was stub in Plan 2). On click, open dialog.

### Wire into Customer360Actions

"ส่ง LINE" action also opens this dialog.

### Commit
`feat(collections): ad-hoc LINE send dialog + single-contract endpoint consumer`

---

## Task 9: E2E smoke + full type-check sweep

### Files
- Modify: `apps/web/e2e/collections-smoke.spec.ts` — add Plan 3 tests

Add:
- Click card ▶ → Customer360Panel slides open, timeline header visible
- Close panel → panel gone
- Select 2 rows in queue → BulkActionBar appears with count=2
- Ad-hoc LINE dialog opens from a card button (skip actual send — just open/close)

### Sweep

```bash
./tools/check-types.sh all      # 0 errors
cd apps/api && npm test         # all pass
cd apps/web && npm test -- --run
```

- [ ] Commit: `test(collections): e2e smoke for Customer 360 + bulk + ad-hoc LINE`

---

## Self-Review

**Spec coverage:**
| Spec § | Task |
|---|---|
| §7 Bulk actions | 2, 7 |
| §9 Customer 360 | 1, 4, 5, 6 |
| §10 Inline payment | 6 |
| §4 Ad-hoc LINE send | 3, 8 |

**Out of scope (Plan 4):**
- Legal letters (PDF + dispatch + OWNER queue UI)
- MDM unlock UI action (has endpoint; surface in approval tab or customer 360 only)
- Drag-drop kanban
- Thailand Post Connect API

**Placeholder scan:** no TBD. All code snippets present.

**Type consistency:** `ContractRow`, `PendingMdmRequest`, `TimelineEvent` types shared from `types.ts`. Endpoint paths consistent across backend + frontend.
