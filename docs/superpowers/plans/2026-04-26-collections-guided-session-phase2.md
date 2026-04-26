# Collections Guided Session — Phase 2 Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Steps use `- [ ]` for tracking.

**Goal:** Make the Phase 1 system ready for soft launch with real collectors — runtime-tunable constants, mobile-friendly Focus mode, daily summary LINE notification, and pool race-condition fix.

**Architecture:** Add `SystemSettings.collections.*` keys readable via existing settings module + a small admin UI. Keep frontend Focus mode responsive at 375px width (typical collector phone). Wire daily summary cron to LINE Messaging API. Refactor pool claim to atomic conditional updateMany.

**Tech Stack:** Same as Phase 1. New touch points: `apps/api/src/modules/settings/` (existing), LINE OA client (existing).

**Builds on:** PR #703 (`feat/collections-guided-session`)

---

## Task 1: Settings module — collections runtime config

**Files:**
- Modify: `apps/api/src/modules/settings/settings.service.ts` (add typed accessor) — verify the file exists first
- Modify: `apps/api/src/modules/collections-session/auto-assign.service.ts` (read constants from settings)
- Modify: `apps/api/src/modules/collections-session/collections-session.cron.ts` (read schedule hours from settings — only the pool-expiry hours stay literal, since `@Cron` decorator can't accept dynamic values; document this)
- Modify: `apps/api/src/modules/collections-session/pool.service.ts` (read SELF_CLAIM_LOCK_HOURS from settings)

**Steps:**

- [ ] **Step 1:** Read `apps/api/src/modules/settings/settings.service.ts` to understand the existing API. Find the read-key pattern (likely `getKey(key: string)` or `get<T>(key)`). Find where defaults are configured.

- [ ] **Step 2:** Add a typed accessor to settings.service.ts:

```typescript
async getCollectionsConfig(): Promise<{
  dailyCap: number;
  workloadFloor: number;
  etaPerContractMin: number;
  sessionTargetMin: number;
  selfClaimLockHours: number;
}> {
  const [dailyCap, workloadFloor, etaPerContractMin, sessionTargetMin, selfClaimLockHours] =
    await Promise.all([
      this.getNumber('collections.dailyCap', 30),
      this.getNumber('collections.workloadFloor', 10),
      this.getNumber('collections.etaPerContractMin', 5),
      this.getNumber('collections.sessionTargetMin', 150),
      this.getNumber('collections.selfClaimLockHours', 2),
    ]);
  return { dailyCap, workloadFloor, etaPerContractMin, sessionTargetMin, selfClaimLockHours };
}
```

(Adapt the `getNumber` call to whatever helper the existing service uses; if there is no number helper, use the raw key getter and `Number(value) || default`.)

- [ ] **Step 3:** Refactor `AutoAssignService.runForDate` to read constants:
  - Inject `SettingsService` in the constructor
  - At the top of `runForDate`, fetch config: `const cfg = await this.settings.getCollectionsConfig()`
  - Replace `DEFAULT_DAILY_CAP` references with `cfg.dailyCap`
  - Replace `DEFAULT_FLOOR` references with `cfg.workloadFloor`
  - Keep `RECENT_RELATIONSHIP_DAYS`, `ESCALATION_DAYS`, `ESCALATION_BROKEN_PROMISES` as compile-time constants (these are policy decisions, not tuning knobs)
  - Update `collections-session.module.ts` to import the settings module so DI resolves

- [ ] **Step 4:** Update `pool.service.ts`:
  - Inject `SettingsService`
  - Replace `SELF_CLAIM_LOCK_HOURS` constant usage with a config read inside `claim()`

- [ ] **Step 5:** Update `auto-assign.service.spec.ts`:
  - Add a settings mock `{ getCollectionsConfig: jest.fn().mockResolvedValue({ dailyCap: 30, workloadFloor: 10, etaPerContractMin: 5, sessionTargetMin: 150, selfClaimLockHours: 2 }) }`
  - Override `dailyCap` to a smaller number (e.g. 5) for the cap-overflow test to verify the dynamic behavior
  - Add one new test: "cap is configurable via settings — overflow respects new cap"

- [ ] **Step 6:** Update `pool.service.spec.ts`:
  - Add settings mock
  - Add a test asserting `lockExpiresAt - lockedAt ≈ cfg.selfClaimLockHours * 3600 * 1000`

- [ ] **Step 7:** Run all collections backend tests:
  ```
  cd apps/api && npx jest collections --no-coverage
  ```
  All pass (now ~22+ tests).

- [ ] **Step 8:** Type check + commit.

---

## Task 2: Settings page UI — collections section

**Files:**
- Identify the existing `/settings` page and add a "Collections" section. Look in `apps/web/src/pages/SettingsPage*` or `apps/web/src/pages/settings/`.

**Steps:**

- [ ] **Step 1:** Find the existing settings page structure. Read it to understand how sections are organized (each section likely has its own component/hook).

- [ ] **Step 2:** Create `apps/web/src/pages/SettingsPage/sections/CollectionsSection.tsx` (or analogous path matching project conventions):

```tsx
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import api from '@/lib/api';

interface CollectionsConfig {
  dailyCap: number;
  workloadFloor: number;
  etaPerContractMin: number;
  sessionTargetMin: number;
  selfClaimLockHours: number;
}

export default function CollectionsSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<CollectionsConfig>({
    queryKey: ['settings', 'collections'],
    queryFn: async () => {
      const { data } = await api.get('/settings/collections');
      return data;
    },
  });

  const [draft, setDraft] = useState<CollectionsConfig | null>(null);
  useEffect(() => {
    if (data && !draft) setDraft(data);
  }, [data, draft]);

  const save = useMutation({
    mutationFn: (body: CollectionsConfig) => api.put('/settings/collections', body),
    onSuccess: () => {
      toast.success('บันทึกการตั้งค่าแล้ว');
      qc.invalidateQueries({ queryKey: ['settings', 'collections'] });
    },
    onError: () => toast.error('บันทึกไม่สำเร็จ'),
  });

  if (isLoading || !draft) {
    return <div className="text-sm text-muted-foreground leading-snug">กำลังโหลด...</div>;
  }

  const Field = ({
    label,
    description,
    value,
    onChange,
    min,
    max,
  }: {
    label: string;
    description: string;
    value: number;
    onChange: (n: number) => void;
    min: number;
    max: number;
  }) => (
    <div className="space-y-1.5">
      <Label className="leading-snug">{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, parseInt(e.target.value) || min)))}
        className="font-mono tabular-nums"
      />
      <div className="text-2xs text-muted-foreground leading-snug">{description}</div>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>ตั้งค่าระบบเก็บเงิน</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field
          label="คิวสูงสุดต่อพนักงาน/วัน"
          description="ระบบจะดันส่วนเกินเข้า pool กลาง"
          value={draft.dailyCap}
          onChange={(n) => setDraft({ ...draft, dailyCap: n })}
          min={5}
          max={200}
        />
        <Field
          label="คิวขั้นต่ำต่อพนักงาน/วัน"
          description="ดึงจาก pool มาเติมถ้าไม่ถึง"
          value={draft.workloadFloor}
          onChange={(n) => setDraft({ ...draft, workloadFloor: n })}
          min={0}
          max={100}
        />
        <Field
          label="ประมาณการเวลาต่อราย (นาที)"
          description="ใช้คำนวณ ETA ของ session"
          value={draft.etaPerContractMin}
          onChange={(n) => setDraft({ ...draft, etaPerContractMin: n })}
          min={1}
          max={60}
        />
        <Field
          label="เป้าเวลา session (นาที)"
          description="Timer จะเปลี่ยนสีเหลืองที่ 100% และแดงที่ 130%"
          value={draft.sessionTargetMin}
          onChange={(n) => setDraft({ ...draft, sessionTargetMin: n })}
          min={30}
          max={480}
        />
        <Field
          label="Lock self-claim (ชั่วโมง)"
          description="หยิบจาก pool แล้วต้องทำภายในเวลานี้ ไม่งั้นจะกลับ pool"
          value={draft.selfClaimLockHours}
          onChange={(n) => setDraft({ ...draft, selfClaimLockHours: n })}
          min={1}
          max={24}
        />
        <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
          <Button variant="ghost" onClick={() => setDraft(data)}>
            รีเซ็ต
          </Button>
          <Button onClick={() => save.mutate(draft)} disabled={save.isPending}>
            บันทึก
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3:** Wire `CollectionsSection` into the existing settings page (route or tab) — only OWNER role visible.

- [ ] **Step 4:** Backend `GET /settings/collections` + `PUT /settings/collections`:
  - Read existing settings controller pattern
  - Add 2 endpoints with `@Roles('OWNER')` guard
  - GET returns `getCollectionsConfig()` from the typed accessor
  - PUT validates body (use a DTO with `@IsInt() @Min() @Max()`) then calls `setKey` for each field

- [ ] **Step 5:** Type check + commit.

---

## Task 3: Mobile-responsive Focus mode + keyboard shortcuts

**Files:**
- Modify: `apps/web/src/pages/CollectionsPage/session/FocusContractCard.tsx`
- Modify: `apps/web/src/pages/CollectionsPage/session/FocusMode.tsx`

**Steps:**

- [ ] **Step 1:** Audit FocusContractCard at 375px viewport (mobile):
  - Severity header band: stack vertically if needed
  - Customer name `text-xl sm:text-2xl` already responsive ✓
  - Outstanding amount `text-2xl` is fine
  - Action grid `grid-cols-2 sm:grid-cols-4` already responsive ✓
  - Add `min-h-screen sm:min-h-0` to the parent so the card fills viewport on mobile (operator typically has just one card on screen)

- [ ] **Step 2:** Add `text-base sm:text-2xl` ramp where text feels too big on tiny screens. Verify with browser dev tools.

- [ ] **Step 3:** Update FocusMode keyboard shortcuts. Currently has Esc=pause and 3=skip. Add:
  - `1` → triggers Call (call CallButton's underlying onClick if exposed; fall back to a focused() on the call button DOM)
  - `2` → triggers `handleSendLineClick()`
  - `4` → triggers `handleLogContactClick()` (for "บันทึก")
  - `Space` → no-op for now (auto-advance is automatic on action success)

  Implementation approach: bind the keyboard handler to call the same handler functions as the buttons. For Call (which uses CallButton internal mutation), use `document.querySelector('[data-call-button]')?.click()` — and add `data-call-button` attribute to CallButton in FocusContractCard.

- [ ] **Step 4:** Add visible keyboard hint footer in Focus mode (below the card):
  ```tsx
  <div className="hidden sm:flex items-center justify-center gap-3 text-2xs text-muted-foreground/60 leading-snug">
    <kbd className="px-1.5 py-0.5 rounded border border-border/60 font-mono">1</kbd> โทร
    <kbd className="px-1.5 py-0.5 rounded border border-border/60 font-mono">2</kbd> LINE
    <kbd className="px-1.5 py-0.5 rounded border border-border/60 font-mono">3</kbd> ข้าม
    <kbd className="px-1.5 py-0.5 rounded border border-border/60 font-mono">4</kbd> บันทึก
    <kbd className="px-1.5 py-0.5 rounded border border-border/60 font-mono">Esc</kbd> หยุดพัก
  </div>
  ```
  Hidden on mobile (`hidden sm:flex`) since touch devices don't have keyboards.

- [ ] **Step 5:** Type check + commit.

---

## Task 4: Daily summary LINE notify

**Files:**
- Modify: `apps/api/src/modules/collections-session/collections-session.cron.ts` (`runDailySummary` method)
- Possibly create: `apps/api/src/modules/collections-session/collections-summary.service.ts` for the message-building logic

**Steps:**

- [ ] **Step 1:** Find the LINE Messaging API client in this project (likely `apps/api/src/modules/line/` or similar). Read the existing pattern for sending push messages to a userId.

- [ ] **Step 2:** Identify the manager LINE recipient. Two options:
  - Option A: Hard-coded list of OWNER user IDs — read from `User` where `role='OWNER' AND lineId IS NOT NULL`
  - Option B: New `User.dailySummarySubscribed` boolean — opt-in
  
  Choose Option A for now (simpler, OWNER role is already a small group).

- [ ] **Step 3:** Build the summary message in `collections-summary.service.ts`:

```typescript
@Injectable()
export class CollectionsSummaryService {
  constructor(private prisma: PrismaService, private line: LineService) {}

  async sendDailySummary(date: Date): Promise<{ recipients: number; sent: number }> {
    const dateOnly = startOfDay(date);

    // Per-collector breakdown
    const summaries = await this.prisma.dailyAssignment.groupBy({
      by: ['collectorId', 'status'],
      where: { date: dateOnly, collectorId: { not: null } },
      _count: true,
    });

    const collectors = await this.prisma.user.findMany({
      where: { role: 'SALES' as any, deletedAt: null, collectionsActive: true },
      select: { id: true, name: true },
    });

    const collectorMap = new Map(collectors.map((c) => [c.id, c.name]));
    const byCollector = new Map<string, { name: string; pending: number; done: number; skipped: number; total: number }>();
    for (const s of summaries) {
      if (!s.collectorId) continue;
      const name = collectorMap.get(s.collectorId) ?? '???';
      const row = byCollector.get(s.collectorId) ?? { name, pending: 0, done: 0, skipped: 0, total: 0 };
      const c = s._count as unknown as number;
      if (s.status === 'PENDING' || s.status === 'IN_PROGRESS') row.pending += c;
      else if (s.status === 'DONE') row.done += c;
      else if (s.status === 'SKIPPED') row.skipped += c;
      row.total += c;
      byCollector.set(s.collectorId, row);
    }

    // Build the LINE text (Flex would be nicer but text is fine for v1)
    const lines: string[] = [`📊 สรุปงานเก็บเงิน ${dateOnly.toLocaleDateString('th-TH')}`, ''];
    for (const [, r] of byCollector) {
      const pct = r.total === 0 ? 0 : Math.round((r.done / r.total) * 100);
      lines.push(`▸ ${r.name}: ${r.done}/${r.total} (${pct}%)${r.pending > 0 ? ` · ค้าง ${r.pending}` : ''}`);
    }
    if (byCollector.size === 0) lines.push('— ไม่มีงานวันนี้ —');

    const message = lines.join('\n');

    // Send to OWNERs
    const owners = await this.prisma.user.findMany({
      where: { role: 'OWNER' as any, deletedAt: null, lineId: { not: null } },
      select: { id: true, lineId: true },
    });

    let sent = 0;
    for (const owner of owners) {
      try {
        await this.line.pushTextMessage(owner.lineId!, message);
        sent++;
      } catch (e) {
        // ignore per-recipient errors; logger in caller
      }
    }

    return { recipients: owners.length, sent };
  }
}
```

(Replace `LineService.pushTextMessage` with the actual method name in this project — find the existing LINE OA module and use its API.)

- [ ] **Step 4:** Wire into `collections-session.cron.ts`:
  - Inject `CollectionsSummaryService`
  - Replace the current `runDailySummary` body (which only logs counts) with `await this.summary.sendDailySummary(new Date())`

- [ ] **Step 5:** Add the service to `collections-session.module.ts` providers + import the LINE module.

- [ ] **Step 6:** Add a basic spec for `CollectionsSummaryService.sendDailySummary` mocking prisma + line client.

- [ ] **Step 7:** Type check + commit.

---

## Task 5: Pool claim atomic — fix race condition

**Files:**
- Modify: `apps/api/src/modules/collections-session/pool.service.ts`
- Modify: `apps/api/src/modules/collections-session/pool.service.spec.ts`

**Steps:**

- [ ] **Step 1:** Refactor `claim()` to use atomic conditional `updateMany`:

```typescript
async claim(assignmentId: string, userId: string) {
  const cfg = await this.settings.getCollectionsConfig();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + cfg.selfClaimLockHours * 60 * 60 * 1000);

  // Atomic claim: only updates if still unclaimed.
  const result = await this.prisma.dailyAssignment.updateMany({
    where: {
      id: assignmentId,
      collectorId: null,
      status: 'PENDING',
      deletedAt: null,
    },
    data: {
      collectorId: userId,
      source: 'SELF_CLAIMED',
      lockedAt: now,
      lockExpiresAt: expiresAt,
    },
  });

  if (result.count === 0) {
    throw new ConflictException('สัญญานี้ถูกหยิบไปแล้วหรือไม่อยู่ใน pool');
  }

  return this.prisma.dailyAssignment.findUnique({ where: { id: assignmentId } });
}
```

- [ ] **Step 2:** Update test to mock `updateMany` instead of `findFirst + update`. Add a new test "claim is idempotent — second claim of same id returns ConflictException with no DB change".

- [ ] **Step 3:** Type check + commit.

---

## Task 6: Final integration verification

- [ ] **Step 1:** Full type check: `./tools/check-types.sh all`
- [ ] **Step 2:** Run full collections backend tests: `cd apps/api && npx jest collections --no-coverage` — all pass
- [ ] **Step 3:** Manual smoke: ensure SettingsPage CollectionsSection loads + edits persist

---

## Summary

**5 implementation tasks** (Settings backend, Settings UI, Mobile + keyboard, LINE notify, Atomic claim) + 1 verify pass.

**Test plan:**
- [ ] All Phase 1 tests still pass after refactor
- [ ] New tests: cap-via-settings, claim-idempotency, summary-formatter
- [ ] Manual: tune `dailyCap` in UI → next auto-assign respects new value
- [ ] Manual: trigger summary cron once → OWNER receives LINE
- [ ] Manual: Focus mode on iPhone-sized viewport (375px)

## Self-Review

- ✅ All 4 Phase 2 themes covered (runtime config, mobile, summary, atomic)
- ✅ No placeholders
- ✅ Each task has files, code, tests, commit
- ✅ Dependencies correct: Task 1 → Task 5 (claim uses settings); Task 1 → Task 2 (UI reads/writes same keys); Task 4 independent
