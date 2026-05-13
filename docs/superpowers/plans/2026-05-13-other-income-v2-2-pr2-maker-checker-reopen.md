# Other Income v2.2 PR-2 — Maker-Checker Toggle UI + Reopen Period Workflow

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task with **3-4 review rounds per task** per owner preference (`feedback_review_thoroughness`).

**Goal:** Implement Sprint 2 from PDF v2.2 — Maker-Checker toggle UI + Reopen Period workflow with structured reasons + banner + audit events.

**Architecture:** Backend adds two thin endpoints (toggle + pending-count) + extends `reopenPeriod()` to capture reason metadata + emits `CONFIG_CHANGED`, `PERIOD_REOPENED`, `PERIOD_CLOSED` audit strings. Frontend adds a `MakerCheckerToggle` card with OFF↔ON confirmation dialogs (read pending count when turning OFF), a `ReopenPeriodModal` with required reason taxonomy, and a `ReopenedPeriodBanner` installed on list pages.

**Tech Stack:** NestJS + Prisma + React 18 + Vite + react-router v7 + @tanstack/react-query + shadcn/ui + Tailwind + vitest + jest + Playwright.

**Spec reference:** [`docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md`](../specs/2026-05-13-other-income-v2-2-design.md) §4 (Sprint 2).

**Codebase facts verified from PR-1 survey:**
- `AuditLog.action` is `String` — no enum migration for new actions.
- `OTHER_INCOME_MAKER_CHECKER_ENABLED` SystemConfig key exists; controller has `@Get('maker-checker-enabled')` at [other-income.controller.ts:62](../../../apps/api/src/modules/other-income/other-income.controller.ts#L62) + tests pass.
- `AccountingPeriod` has `reopenedAt`, `reopenedById`, `reopenedBy` relation at [schema.prisma:5076-5078](../../../apps/api/prisma/schema.prisma#L5076-L5078).
- `reopenPeriod()` service method exists at [monthly-close.service.ts:308+](../../../apps/api/src/modules/accounting/monthly-close.service.ts#L308); 90-day lock validation present.
- `PeriodClosePage` UI exists at [apps/web/src/pages/accounting/PeriodClosePage.tsx](../../../apps/web/src/pages/accounting/PeriodClosePage.tsx) with reopen mutation.
- `AuditService.log()` API: `{ userId, action, entity, entityId, oldValue, newValue, ipAddress, userAgent }` — store extra context in `newValue`.

---

## File Structure

### Backend (create)
- `apps/api/src/modules/system-config/system-config.controller.ts` — verify exists; if not, create with `Put('/maker-checker')` + `Get('/maker-checker/pending-ready-count')`. If `SystemConfigModule` doesn't exist, create minimally.
- `apps/api/src/modules/system-config/system-config.service.ts` — verify exists; provides `get(key)` and `set(key, value)`. Create if missing.
- `apps/api/src/modules/accounting/dto/reopen-period.dto.ts` — `ReopenPeriodDto` with `reasonType`, `reason`, `taxFiled`.

### Backend (modify)
- `apps/api/prisma/schema.prisma` — add `reopenReason String?` + `taxFiled Boolean?` to `AccountingPeriod`.
- `apps/api/src/modules/accounting/monthly-close.service.ts` — extend `reopenPeriod()` to accept new DTO, persist `reopenReason` + `taxFiled`, write `PERIOD_REOPENED` audit; extend close to emit `PERIOD_CLOSED` audit.
- `apps/api/src/modules/accounting/accounting.controller.ts` — change `reopen` endpoint to accept `ReopenPeriodDto` body; add `GET /accounting/periods/reopened` endpoint.
- `apps/api/src/modules/accounting/accounting.service.ts` (or `monthly-close.service.ts`) — add `listReopenedPeriods()` method.

### Frontend (create)
- `apps/web/src/pages/SettingsPage/components/MakerCheckerToggle.tsx` — Switch card + confirmation dialog wrapper.
- `apps/web/src/pages/SettingsPage/components/MakerCheckerConfirmDialog.tsx` — OFF↔ON confirmation modal.
- `apps/web/src/pages/SettingsPage/components/__tests__/MakerCheckerToggle.test.tsx`
- `apps/web/src/pages/SettingsPage/components/__tests__/MakerCheckerConfirmDialog.test.tsx`
- `apps/web/src/pages/accounting/components/ReopenPeriodModal.tsx`
- `apps/web/src/pages/accounting/components/__tests__/ReopenPeriodModal.test.tsx`
- `apps/web/src/components/accounting/ReopenedPeriodBanner.tsx`
- `apps/web/src/components/accounting/__tests__/ReopenedPeriodBanner.test.tsx`

### Frontend (modify)
- `apps/web/src/pages/SettingsPage/index.tsx` — install `<MakerCheckerToggle />` (Sprint 2 puts it in the current SettingsPage; Sprint 3 will migrate to `#users` tab).
- `apps/web/src/pages/accounting/PeriodClosePage.tsx` — wire `<ReopenPeriodModal>` into the existing reopen mutation flow.
- `apps/web/src/pages/other-income/OtherIncomeListPage.tsx` — install `<ReopenedPeriodBanner />` at top.
- `apps/web/src/pages/ExpensesPage.tsx` — install `<ReopenedPeriodBanner />` at top.

### Migration
- `apps/api/prisma/migrations/<timestamp>_add_reopen_metadata_and_audit_actions/migration.sql` — add `reopen_reason` + `tax_filed` columns to `accounting_periods`.

---

## Task 1: Schema additions for AccountingPeriod

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_add_reopen_metadata/migration.sql`

- [ ] **Step 1: Locate `AccountingPeriod` model in schema**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/oi-v2-2-pr1
awk '/^model AccountingPeriod /,/^}/' apps/api/prisma/schema.prisma
```

Note the existing fields including `reopenedAt`, `reopenedById`, `reopenedBy User?`. The new fields go in the same block.

- [ ] **Step 2: Add `reopenReason` and `taxFiled` columns**

In the `AccountingPeriod` model, after `reopenedBy User? @relation(...)` line, add:

```prisma
  reopenReason String?  @map("reopen_reason")
  taxFiled     Boolean? @map("tax_filed")
```

- [ ] **Step 3: Create idempotent SQL migration**

```bash
TS=$(date -u +%Y%m%d%H%M%S)
mkdir -p apps/api/prisma/migrations/${TS}_add_reopen_metadata
cat > apps/api/prisma/migrations/${TS}_add_reopen_metadata/migration.sql <<'EOF'
-- AlterTable
ALTER TABLE "accounting_periods"
  ADD COLUMN IF NOT EXISTS "reopen_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "tax_filed"     BOOLEAN;
EOF
```

Use the actual `@@map` table name — verify by `grep '@@map' apps/api/prisma/schema.prisma | grep -i accounting_period`.

- [ ] **Step 4: Verify schema validity**

```bash
cd apps/api && npx prisma generate
```

Expected: success.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "$(cat <<'EOF'
feat(accounting): add reopenReason + taxFiled to AccountingPeriod

Required for Reopen Period workflow (PDF v2.2 Sprint 2 Task 3).
Idempotent CREATE … IF NOT EXISTS so re-runs are safe.

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §4.2
EOF
)"
```

---

## Task 2: ReopenPeriodDto

**Files:**
- Create: `apps/api/src/modules/accounting/dto/reopen-period.dto.ts`

- [ ] **Step 1: Create DTO with validation**

```ts
import { IsBoolean, IsEnum, IsString, MinLength } from 'class-validator';

export enum ReopenReasonType {
  WRONG_ENTRY = 'WRONG_ENTRY',
  MISSED_RECORD = 'MISSED_RECORD',
  AUDITOR_REQUEST = 'AUDITOR_REQUEST',
  OTHER = 'OTHER',
}

export class ReopenPeriodDto {
  @IsEnum(ReopenReasonType, { message: 'reasonType ต้องเป็นหนึ่งใน WRONG_ENTRY, MISSED_RECORD, AUDITOR_REQUEST, OTHER' })
  reasonType!: ReopenReasonType;

  @IsString({ message: 'reason ต้องเป็นข้อความ' })
  @MinLength(10, { message: 'reason ต้องระบุอย่างน้อย 10 ตัวอักษร' })
  reason!: string;

  @IsBoolean({ message: 'taxFiled ต้องเป็น boolean (true/false)' })
  taxFiled!: boolean;
}
```

- [ ] **Step 2: Type-check**

```bash
./tools/check-types.sh api
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/accounting/dto/reopen-period.dto.ts
git commit -m "feat(accounting): ReopenPeriodDto — required reason taxonomy + note + taxFiled

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §4.2"
```

---

## Task 3: Extend reopenPeriod() service + audit emit

**Files:**
- Modify: `apps/api/src/modules/accounting/monthly-close.service.ts`
- Modify: `apps/api/src/modules/accounting/accounting.controller.ts`

- [ ] **Step 1: Inspect existing `reopenPeriod()` signature**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/oi-v2-2-pr1
grep -n "reopenPeriod\|closePeriod\|@Post.*reopen" apps/api/src/modules/accounting/monthly-close.service.ts apps/api/src/modules/accounting/accounting.controller.ts | head -10
```

Note the current signature. Likely something like `reopenPeriod(period: string, userId: string)`.

- [ ] **Step 2: Extend service signature + audit**

In `monthly-close.service.ts`:

```ts
import { ReopenPeriodDto } from './dto/reopen-period.dto';
import { AuditService } from '../audit/audit.service';

// Inject AuditService in constructor:
// constructor(private prisma: PrismaService, private audit: AuditService, ...) {}

async reopenPeriod(period: string, dto: ReopenPeriodDto, actorId: string, ipAddress?: string) {
  // ... existing 90-day lock check + status update logic — KEEP ...

  // After existing update, ADD reason + taxFiled fields:
  await this.prisma.accountingPeriod.update({
    where: { period },
    data: {
      reopenReason: `${dto.reasonType}: ${dto.reason}`,
      taxFiled: dto.taxFiled,
    },
  });

  // Audit emit (try/catch + Sentry like other-income post()):
  try {
    await this.audit.log({
      userId: actorId,
      action: 'PERIOD_REOPENED',
      entity: 'accounting_period',
      entityId: period,
      newValue: {
        reasonType: dto.reasonType,
        reason: dto.reason,
        taxFiled: dto.taxFiled,
        reopenedAt: new Date().toISOString(),
      },
      ipAddress,
    });
  } catch (err) {
    // Don't roll back the reopen — audit is best-effort
    // Sentry import: import * as Sentry from '@sentry/nestjs';
    Sentry.captureException(err, {
      tags: { module: 'accounting', action: 'PERIOD_REOPENED' },
      extra: { period, actorId },
    });
  }
}
```

Similarly extend `closePeriod()` to emit `PERIOD_CLOSED` audit (or wherever the close logic lives — check first):

```ts
async closePeriod(period: string, actorId: string, ipAddress?: string) {
  // ... existing close logic ...
  try {
    await this.audit.log({
      userId: actorId,
      action: 'PERIOD_CLOSED',
      entity: 'accounting_period',
      entityId: period,
      newValue: { closedAt: new Date().toISOString() },
      ipAddress,
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { module: 'accounting', action: 'PERIOD_CLOSED' },
      extra: { period, actorId },
    });
  }
}
```

- [ ] **Step 3: Update controller**

In `accounting.controller.ts`, find the reopen endpoint and change to accept body:

```ts
import { ReopenPeriodDto } from './dto/reopen-period.dto';

@Post('periods/:period/reopen')
@Roles('OWNER')
async reopen(
  @Param('period') period: string,
  @Body() dto: ReopenPeriodDto,
  @CurrentUser('id') userId: string,
  @Req() req: Request,
) {
  return this.monthlyCloseService.reopenPeriod(period, dto, userId, req.ip);
}
```

Adjust `@CurrentUser` / `@Req` decorators to match existing patterns in the file.

- [ ] **Step 4: Type-check + commit**

```bash
./tools/check-types.sh api
git add apps/api/src/modules/accounting/monthly-close.service.ts apps/api/src/modules/accounting/accounting.controller.ts
git commit -m "$(cat <<'EOF'
feat(accounting): extend reopenPeriod with reason taxonomy + audit

- reopenPeriod() accepts ReopenPeriodDto, persists reopenReason + taxFiled
- emits PERIOD_REOPENED audit string (oldValue=null, newValue={reasonType, reason, taxFiled, reopenedAt})
- closePeriod() emits PERIOD_CLOSED audit
- Both audit writes wrapped try/catch + Sentry (best-effort, don't roll back the state change)

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §4.2
EOF
)"
```

---

## Task 4: GET /accounting/periods/reopened endpoint

**Files:**
- Modify: `apps/api/src/modules/accounting/monthly-close.service.ts`
- Modify: `apps/api/src/modules/accounting/accounting.controller.ts`

- [ ] **Step 1: Add service method**

In `monthly-close.service.ts`:

```ts
async listReopenedPeriods() {
  return this.prisma.accountingPeriod.findMany({
    where: {
      reopenedAt: { not: null },
      // Currently reopened = reopenedAt exists AND status is OPEN
      status: 'OPEN',
    },
    include: {
      reopenedBy: { select: { id: true, name: true } },
    },
    orderBy: { period: 'desc' },
  });
}
```

If `AccountingPeriod.status` enum doesn't have `OPEN` literal, use whatever the actual literal is (`OPEN`, `ACTIVE`, etc.) — verify via grep.

- [ ] **Step 2: Add controller endpoint**

```ts
@Get('periods/reopened')
@Roles('OWNER', 'ACCOUNTANT', 'FINANCE_MANAGER')
async getReopenedPeriods() {
  return this.monthlyCloseService.listReopenedPeriods();
}
```

- [ ] **Step 3: Type-check + commit**

```bash
./tools/check-types.sh api
git add apps/api/src/modules/accounting/monthly-close.service.ts apps/api/src/modules/accounting/accounting.controller.ts
git commit -m "feat(accounting): GET /periods/reopened — list currently-reopened periods

Used by ReopenedPeriodBanner on list pages.

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §4.2"
```

---

## Task 5: SystemConfigController endpoints (maker-checker toggle + pending count)

**Files:**
- Verify or create: `apps/api/src/modules/system-config/system-config.controller.ts`
- Verify or create: `apps/api/src/modules/system-config/system-config.service.ts`
- Verify or create: `apps/api/src/modules/system-config/system-config.module.ts`

- [ ] **Step 1: Verify existing module structure**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/oi-v2-2-pr1
ls apps/api/src/modules/system-config/ 2>/dev/null
# If not present:
grep -rn "OTHER_INCOME_MAKER_CHECKER_ENABLED\|SystemConfig.*update\|SystemConfig.*upsert" apps/api/src | head -10
```

If `SystemConfigModule` exists, use it. If not, the value is likely managed via a generic config service or directly on Prisma — locate where `OTHER_INCOME_MAKER_CHECKER_ENABLED` is currently READ from (it's used by `OtherIncomeService`).

- [ ] **Step 2: Add PUT toggle endpoint**

Add to the appropriate controller (or create `system-config.controller.ts` if module exists but no controller):

```ts
@Put('/maker-checker')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
async toggleMakerChecker(
  @Body() dto: { enabled: boolean },
  @CurrentUser('id') actorId: string,
  @Req() req: Request,
) {
  const key = 'OTHER_INCOME_MAKER_CHECKER_ENABLED';
  const oldValue = await this.prisma.systemConfig.findUnique({ where: { key } });

  await this.prisma.systemConfig.upsert({
    where: { key },
    update: { value: String(dto.enabled) },
    create: { key, value: String(dto.enabled), description: 'Other Income Maker-Checker toggle' },
  });

  try {
    await this.audit.log({
      userId: actorId,
      action: 'CONFIG_CHANGED',
      entity: 'system_config',
      entityId: key,
      oldValue: { value: oldValue?.value ?? null },
      newValue: { value: String(dto.enabled) },
      ipAddress: req.ip,
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { module: 'system-config', action: 'CONFIG_CHANGED' },
      extra: { key, actorId },
    });
  }

  return { success: true, enabled: dto.enabled };
}
```

- [ ] **Step 3: Add pending-count endpoint**

```ts
@Get('/maker-checker/pending-ready-count')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
async pendingReadyCount() {
  const count = await this.prisma.otherIncome.count({
    where: { status: 'READY', deletedAt: null },
  });
  return { count };
}
```

- [ ] **Step 4: Type-check + commit**

```bash
./tools/check-types.sh api
git add apps/api/src/modules/system-config/
git commit -m "$(cat <<'EOF'
feat(system-config): PUT /maker-checker + GET /maker-checker/pending-ready-count

- PUT toggles OTHER_INCOME_MAKER_CHECKER_ENABLED (OWNER-only) + emits CONFIG_CHANGED audit
- GET returns count of READY other-income docs (used by OFF→ON confirmation dialog)

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §4.1
EOF
)"
```

---

## Task 6: MakerCheckerConfirmDialog component

**Files:**
- Create: `apps/web/src/pages/SettingsPage/components/MakerCheckerConfirmDialog.tsx`
- Create: `apps/web/src/pages/SettingsPage/components/__tests__/MakerCheckerConfirmDialog.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MakerCheckerConfirmDialog } from '../MakerCheckerConfirmDialog';

describe('MakerCheckerConfirmDialog', () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    onConfirm.mockClear();
    onCancel.mockClear();
  });

  it('does not render when open=false', () => {
    render(
      <MakerCheckerConfirmDialog open={false} nextValue={true} pendingReadyCount={0} onConfirm={onConfirm} onCancel={onCancel} />
    );
    expect(screen.queryByText(/Maker-Checker/)).not.toBeInTheDocument();
  });

  it('OFF→ON: shows enable impacts + requires ack', () => {
    render(
      <MakerCheckerConfirmDialog open={true} nextValue={true} pendingReadyCount={0} onConfirm={onConfirm} onCancel={onCancel} />
    );
    expect(screen.getByText(/เปิดระบบ Maker-Checker/)).toBeInTheDocument();
    expect(screen.getByText(/ต้องผ่านผู้อนุมัติ/)).toBeInTheDocument();
    const confirmBtn = screen.getByRole('button', { name: /ยืนยันเปิด/ });
    expect(confirmBtn).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(confirmBtn).toBeEnabled();
  });

  it('ON→OFF: shows disable impacts + pending count + requires ack', () => {
    render(
      <MakerCheckerConfirmDialog open={true} nextValue={false} pendingReadyCount={3} onConfirm={onConfirm} onCancel={onCancel} />
    );
    expect(screen.getByText(/ปิดระบบ Maker-Checker/)).toBeInTheDocument();
    expect(screen.getByText(/auto-approve/i)).toBeInTheDocument();
    expect(screen.getByText(/3 ฉบับ/)).toBeInTheDocument();
    const confirmBtn = screen.getByRole('button', { name: /ยืนยันปิด/ });
    expect(confirmBtn).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(confirmBtn).toBeEnabled();
  });

  it('calls onConfirm when confirm clicked', () => {
    render(
      <MakerCheckerConfirmDialog open={true} nextValue={true} pendingReadyCount={0} onConfirm={onConfirm} onCancel={onCancel} />
    );
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันเปิด/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when cancel clicked', () => {
    render(
      <MakerCheckerConfirmDialog open={true} nextValue={true} pendingReadyCount={0} onConfirm={onConfirm} onCancel={onCancel} />
    );
    fireEvent.click(screen.getByRole('button', { name: /ยกเลิก/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('resets acknowledgement on close', () => {
    const { rerender } = render(
      <MakerCheckerConfirmDialog open={true} nextValue={true} pendingReadyCount={0} onConfirm={onConfirm} onCancel={onCancel} />
    );
    fireEvent.click(screen.getByRole('checkbox'));
    rerender(<MakerCheckerConfirmDialog open={false} nextValue={true} pendingReadyCount={0} onConfirm={onConfirm} onCancel={onCancel} />);
    rerender(<MakerCheckerConfirmDialog open={true} nextValue={true} pendingReadyCount={0} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByRole('button', { name: /ยืนยัน/ })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/web && npx vitest run src/pages/SettingsPage/components/__tests__/MakerCheckerConfirmDialog.test.tsx
```

- [ ] **Step 3: Implement component**

```tsx
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertTriangle } from 'lucide-react';

type Props = {
  open: boolean;
  nextValue: boolean | null;       // true = OFF→ON, false = ON→OFF
  pendingReadyCount: number;       // shown when ON→OFF
  onConfirm: () => void;
  onCancel: () => void;
};

export function MakerCheckerConfirmDialog({ open, nextValue, pendingReadyCount, onConfirm, onCancel }: Props) {
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!open) setAcknowledged(false);
  }, [open]);

  const isEnabling = nextValue === true;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" />
            {isEnabling ? 'คุณกำลังจะเปิดระบบ Maker-Checker' : 'คุณกำลังจะปิดระบบ Maker-Checker'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p className="font-semibold">ผลกระทบ:</p>
          {isEnabling ? (
            <ul className="space-y-1 list-disc list-inside text-muted-foreground">
              <li>เอกสารทุกฉบับจะต้องผ่านผู้อนุมัติก่อน POST</li>
              <li>เอกสาร DRAFT ปัจจุบันจะต้องส่งอนุมัติ</li>
              <li>ผู้สร้าง ≠ ผู้อนุมัติ (segregation of duties)</li>
            </ul>
          ) : (
            <>
              <ul className="space-y-1 list-disc list-inside text-muted-foreground">
                <li>เอกสารที่อยู่ในสถานะ READY จะถูก auto-approve</li>
                <li>เอกสารใหม่จะ POST ทันที (ไม่ต้องอนุมัติ)</li>
              </ul>
              <p className="text-warning font-medium">
                จำนวนเอกสาร READY ตอนนี้: {pendingReadyCount} ฉบับ
              </p>
            </>
          )}

          <div className="flex items-start gap-2 pt-2">
            <Checkbox
              id="mc-ack"
              checked={acknowledged}
              onCheckedChange={(v) => setAcknowledged(Boolean(v))}
            />
            <label htmlFor="mc-ack" className="text-sm cursor-pointer">
              {isEnabling ? 'ฉันเข้าใจและยืนยันเปิดระบบ' : 'ฉันเข้าใจและยืนยันปิดระบบ'}
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>ยกเลิก</Button>
          <Button onClick={onConfirm} disabled={!acknowledged}>
            {isEnabling ? 'ยืนยันเปิด' : 'ยืนยันปิด'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run src/pages/SettingsPage/components/__tests__/MakerCheckerConfirmDialog.test.tsx
```

- [ ] **Step 5: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/oi-v2-2-pr1
git add apps/web/src/pages/SettingsPage/components/MakerCheckerConfirmDialog.tsx \
        apps/web/src/pages/SettingsPage/components/__tests__/MakerCheckerConfirmDialog.test.tsx
git commit -m "feat(settings): MakerCheckerConfirmDialog — OFF↔ON confirmation with ack checkbox

ON→OFF shows pending READY count (passed from parent) so user knows
how many docs will auto-approve. Resets ack on close.

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §4.1"
```

---

## Task 7: MakerCheckerToggle card

**Files:**
- Create: `apps/web/src/pages/SettingsPage/components/MakerCheckerToggle.tsx`
- Create: `apps/web/src/lib/systemConfig.ts` (or extend `apps/web/src/lib/otherIncome.ts` if existing has `isMakerCheckerEnabled`)

- [ ] **Step 1: Add API helpers**

Locate the existing `isMakerCheckerEnabled` query helper:

```bash
grep -rn "isMakerCheckerEnabled\|maker-checker-enabled" apps/web/src/lib | head -5
```

Add two new helpers — `setMakerCheckerEnabled(enabled: boolean)` and `getPendingReadyCount()`:

```ts
// In existing systemConfig.ts or otherIncome.ts
export const systemConfigApi = {
  isMakerCheckerEnabled: () => api.get<{ enabled: boolean }>('/system-config/maker-checker').then((r) => r.data.enabled),
  setMakerCheckerEnabled: (enabled: boolean) => api.put('/system-config/maker-checker', { enabled }),
  getPendingReadyCount: () => api.get<{ count: number }>('/system-config/maker-checker/pending-ready-count').then((r) => r.data.count),
};
```

(Adapt to existing api client patterns — `api.get/post/put` from `@/lib/api`.)

- [ ] **Step 2: Implement MakerCheckerToggle component**

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Info } from 'lucide-react';
import { MakerCheckerConfirmDialog } from './MakerCheckerConfirmDialog';
import { systemConfigApi } from '@/lib/systemConfig';

export function MakerCheckerToggle() {
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const queryClient = useQueryClient();
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingNext, setPendingNext] = useState<boolean | null>(null);

  const enabledQuery = useQuery({
    queryKey: ['system-config', 'maker-checker'],
    queryFn: () => systemConfigApi.isMakerCheckerEnabled(),
  });

  const pendingCountQuery = useQuery({
    queryKey: ['system-config', 'maker-checker', 'pending-ready-count'],
    queryFn: () => systemConfigApi.getPendingReadyCount(),
    enabled: showConfirm && pendingNext === false, // only fetch when turning OFF
  });

  const mutation = useMutation({
    mutationFn: (enabled: boolean) => systemConfigApi.setMakerCheckerEnabled(enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-config'] });
      queryClient.invalidateQueries({ queryKey: ['other-income-maker-checker-enabled'] });
      toast.success('บันทึกการตั้งค่าสำเร็จ');
    },
    onError: () => toast.error('ไม่สามารถบันทึกการตั้งค่าได้'),
  });

  const currentEnabled = enabledQuery.data ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>ระบบ Maker-Checker (ผู้สร้าง ≠ ผู้อนุมัติ)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch
            checked={currentEnabled}
            onCheckedChange={(next) => {
              if (!isOwner) return;
              setPendingNext(next);
              setShowConfirm(true);
            }}
            disabled={!isOwner || mutation.isPending}
            aria-label="Toggle Maker-Checker"
          />
          <span className="text-sm font-medium">
            {currentEnabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
          </span>
        </div>

        {!isOwner && (
          <p className="text-xs text-muted-foreground">เฉพาะ OWNER เท่านั้นที่เปลี่ยนได้</p>
        )}

        <div className="flex items-start gap-2 rounded-md bg-muted p-3">
          <Info className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
          <p className="text-xs text-muted-foreground">
            เมื่อเปิด — เอกสารทุกฉบับต้องผ่านผู้อนุมัติก่อน POST (segregation of duties)
          </p>
        </div>

        <MakerCheckerConfirmDialog
          open={showConfirm}
          nextValue={pendingNext}
          pendingReadyCount={pendingCountQuery.data ?? 0}
          onConfirm={() => {
            mutation.mutate(pendingNext!);
            setShowConfirm(false);
            setPendingNext(null);
          }}
          onCancel={() => {
            setShowConfirm(false);
            setPendingNext(null);
          }}
        />
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
./tools/check-types.sh web
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/SettingsPage/components/MakerCheckerToggle.tsx apps/web/src/lib/systemConfig.ts
git commit -m "feat(settings): MakerCheckerToggle card — OWNER-only Switch with confirm dialog

Reads pending READY count via separate query (only fetched when turning OFF).
Invalidates both 'system-config' and 'other-income-maker-checker-enabled' caches.

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §4.1"
```

---

## Task 8: Install MakerCheckerToggle into SettingsPage

**Files:**
- Modify: `apps/web/src/pages/SettingsPage/index.tsx`

- [ ] **Step 1: Read existing SettingsPage structure**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/oi-v2-2-pr1
sed -n '1,40p' apps/web/src/pages/SettingsPage/index.tsx
```

Note the current section/tab layout. Sprint 3 will restructure to 5 tabs; for Sprint 2, install the toggle into an appropriate existing tab/section.

- [ ] **Step 2: Add the toggle in a fitting location**

Import and render `<MakerCheckerToggle />` in the SettingsPage. Best location: alongside other "system behavior" cards (e.g., near SystemSettings or near user-related cards if any).

```tsx
import { MakerCheckerToggle } from './components/MakerCheckerToggle';

// ... in the JSX, in an appropriate section:
<MakerCheckerToggle />
```

- [ ] **Step 3: Type-check + smoke test**

```bash
./tools/check-types.sh web
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/SettingsPage/index.tsx
git commit -m "feat(settings): install MakerCheckerToggle in current SettingsPage

Sprint 3 will migrate this to /settings#users tab during Settings consolidation.

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §4.1"
```

---

## Task 9: ReopenPeriodModal component

**Files:**
- Create: `apps/web/src/pages/accounting/components/ReopenPeriodModal.tsx`
- Create: `apps/web/src/pages/accounting/components/__tests__/ReopenPeriodModal.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ReopenPeriodModal } from '../ReopenPeriodModal';

describe('ReopenPeriodModal', () => {
  const props = (overrides = {}) => ({
    open: true,
    period: '2026-04',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  });

  it('does not render when open=false', () => {
    render(<ReopenPeriodModal {...props({ open: false })} />);
    expect(screen.queryByText(/2026-04/)).not.toBeInTheDocument();
  });

  it('shows period in title', () => {
    render(<ReopenPeriodModal {...props()} />);
    expect(screen.getByText(/2026-04/)).toBeInTheDocument();
  });

  it('confirm button disabled until reasonType + reason + taxFiled all set', () => {
    render(<ReopenPeriodModal {...props()} />);
    const confirmBtn = screen.getByRole('button', { name: /ยืนยันเปิดงวด/ });
    expect(confirmBtn).toBeDisabled();

    // pick a reason
    fireEvent.click(screen.getByLabelText(/พบเอกสารผิด/));
    expect(confirmBtn).toBeDisabled(); // still need note + taxFiled

    // type note (>= 10 chars)
    fireEvent.change(screen.getByLabelText(/บันทึกรายละเอียด/), { target: { value: 'รายละเอียดเพิ่มเติม' } });
    expect(confirmBtn).toBeDisabled(); // still need taxFiled

    // pick taxFiled
    fireEvent.click(screen.getByLabelText(/ใช่ — ต้องยื่นแก้ไข/));
    expect(confirmBtn).toBeEnabled();
  });

  it('calls onConfirm with payload when submitted', () => {
    const onConfirm = vi.fn();
    render(<ReopenPeriodModal {...props({ onConfirm })} />);
    fireEvent.click(screen.getByLabelText(/พบเอกสารผิด/));
    fireEvent.change(screen.getByLabelText(/บันทึกรายละเอียด/), { target: { value: 'เอกสาร OI-26040015 ระบุลูกค้าผิด' } });
    fireEvent.click(screen.getByLabelText(/ยังไม่ได้ยื่น/));
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันเปิดงวด/ }));
    expect(onConfirm).toHaveBeenCalledWith({
      reasonType: 'WRONG_ENTRY',
      reason: 'เอกสาร OI-26040015 ระบุลูกค้าผิด',
      taxFiled: false,
    });
  });

  it('cancel resets form', () => {
    const onCancel = vi.fn();
    render(<ReopenPeriodModal {...props({ onCancel })} />);
    fireEvent.click(screen.getByLabelText(/พบเอกสารผิด/));
    fireEvent.click(screen.getByRole('button', { name: /ยกเลิก/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/web && npx vitest run src/pages/accounting/components/__tests__/ReopenPeriodModal.test.tsx
```

- [ ] **Step 3: Implement component**

```tsx
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle } from 'lucide-react';

type ReasonType = 'WRONG_ENTRY' | 'MISSED_RECORD' | 'AUDITOR_REQUEST' | 'OTHER';

type Props = {
  open: boolean;
  period: string;
  onConfirm: (payload: { reasonType: ReasonType; reason: string; taxFiled: boolean }) => void;
  onCancel: () => void;
};

const REASON_OPTIONS: Array<{ value: ReasonType; label: string }> = [
  { value: 'WRONG_ENTRY', label: 'พบเอกสารผิดต้อง reverse' },
  { value: 'MISSED_RECORD', label: 'ลืมบันทึกรายการสำคัญ' },
  { value: 'AUDITOR_REQUEST', label: 'แก้ไขตามคำขอ auditor' },
  { value: 'OTHER', label: 'อื่นๆ (ระบุในบันทึก)' },
];

export function ReopenPeriodModal({ open, period, onConfirm, onCancel }: Props) {
  const [reasonType, setReasonType] = useState<ReasonType | null>(null);
  const [reason, setReason] = useState('');
  const [taxFiled, setTaxFiled] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open) {
      setReasonType(null);
      setReason('');
      setTaxFiled(null);
    }
  }, [open]);

  const canSubmit = reasonType !== null && reason.trim().length >= 10 && taxFiled !== null;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onConfirm({ reasonType: reasonType!, reason: reason.trim(), taxFiled: taxFiled! });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-warning">
            <AlertTriangle className="w-5 h-5" />
            คุณกำลังเปิดงวด {period} ที่ปิดไปแล้ว
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <fieldset className="space-y-2">
            <legend className="font-semibold">เหตุผล (บังคับ):</legend>
            {REASON_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="reasonType"
                  value={opt.value}
                  checked={reasonType === opt.value}
                  onChange={() => setReasonType(opt.value)}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </fieldset>

          <div>
            <label htmlFor="reopen-reason-note" className="block font-semibold mb-1">
              บันทึกรายละเอียด (≥ 10 ตัวอักษร):
            </label>
            <Textarea
              id="reopen-reason-note"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="ระบุเอกสารหรือเหตุการณ์ที่ต้องการแก้ไข"
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="font-semibold">ภ.พ.30 งวดนี้ยื่นแล้วใช่ไหม?</legend>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="taxFiled"
                checked={taxFiled === true}
                onChange={() => setTaxFiled(true)}
              />
              <span>ใช่ — ต้องยื่นแก้ไขด้วย</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="taxFiled"
                checked={taxFiled === false}
                onChange={() => setTaxFiled(false)}
              />
              <span>ยังไม่ได้ยื่น</span>
            </label>
          </fieldset>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>ยกเลิก</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>ยืนยันเปิดงวด</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run src/pages/accounting/components/__tests__/ReopenPeriodModal.test.tsx
```

- [ ] **Step 5: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/oi-v2-2-pr1
git add apps/web/src/pages/accounting/components/ReopenPeriodModal.tsx \
        apps/web/src/pages/accounting/components/__tests__/ReopenPeriodModal.test.tsx
git commit -m "feat(accounting): ReopenPeriodModal — structured reason + note + taxFiled

Required fields gate the submit button. Form resets on close.

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §4.2"
```

---

## Task 10: Wire ReopenPeriodModal into PeriodClosePage

**Files:**
- Modify: `apps/web/src/pages/accounting/PeriodClosePage.tsx`
- Modify: `apps/web/src/lib/accounting.ts` (or wherever the period API helpers live)

- [ ] **Step 1: Read existing reopen mutation**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/oi-v2-2-pr1
grep -n "reopen\|reopenMutation\|reopenPeriod" apps/web/src/pages/accounting/PeriodClosePage.tsx apps/web/src/lib/ 2>/dev/null | head -10
```

The existing mutation calls `POST /accounting/periods/:period/reopen` with no body. Update to send the modal payload.

- [ ] **Step 2: Update API helper signature**

If accounting.ts has `reopenPeriod(period: string)`, change to:

```ts
reopenPeriod: (period: string, dto: { reasonType: string; reason: string; taxFiled: boolean }) =>
  api.post(`/accounting/periods/${period}/reopen`, dto),
```

- [ ] **Step 3: Wire modal into PeriodClosePage**

```tsx
import { ReopenPeriodModal } from './components/ReopenPeriodModal';

// State
const [reopenTarget, setReopenTarget] = useState<string | null>(null); // period to reopen

const reopenMutation = useMutation({
  mutationFn: ({ period, dto }: { period: string; dto: ReopenDto }) => accountingApi.reopenPeriod(period, dto),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['accounting-periods'] });
    queryClient.invalidateQueries({ queryKey: ['accounting-periods', 'reopened'] });
    toast.success('เปิดงวดสำเร็จ');
    setReopenTarget(null);
  },
  onError: (err: any) => toast.error(err?.response?.data?.message ?? 'ไม่สามารถเปิดงวดได้'),
});

// Replace existing reopen button onClick with:
onClick={() => setReopenTarget(period.period)}

// Render modal:
<ReopenPeriodModal
  open={reopenTarget !== null}
  period={reopenTarget ?? ''}
  onConfirm={(payload) => reopenMutation.mutate({ period: reopenTarget!, dto: payload })}
  onCancel={() => setReopenTarget(null)}
/>
```

- [ ] **Step 4: Type-check + commit**

```bash
./tools/check-types.sh web
git add apps/web/src/pages/accounting/PeriodClosePage.tsx apps/web/src/lib/accounting.ts
git commit -m "feat(accounting): wire ReopenPeriodModal into PeriodClosePage

Reopen button now opens modal collecting reasonType + reason + taxFiled.
API helper signature extended to pass DTO body.

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §4.2"
```

---

## Task 11: ReopenedPeriodBanner component

**Files:**
- Create: `apps/web/src/components/accounting/ReopenedPeriodBanner.tsx`
- Create: `apps/web/src/components/accounting/__tests__/ReopenedPeriodBanner.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReopenedPeriodBanner } from '../ReopenedPeriodBanner';

vi.mock('@/lib/accounting', () => ({
  accountingApi: {
    listReopenedPeriods: vi.fn(),
  },
}));

import { accountingApi } from '@/lib/accounting';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('ReopenedPeriodBanner', () => {
  it('renders nothing when no periods are reopened', async () => {
    (accountingApi.listReopenedPeriods as any).mockResolvedValue([]);
    render(<ReopenedPeriodBanner />, { wrapper });
    expect(screen.queryByText(/ถูกเปิดชั่วคราว/)).not.toBeInTheDocument();
  });

  it('renders one banner per reopened period', async () => {
    (accountingApi.listReopenedPeriods as any).mockResolvedValue([
      {
        period: '2026-04',
        reopenedAt: '2026-05-12T14:00:00Z',
        reopenedBy: { id: 'u1', name: 'สุทธินีย์' },
        reopenReason: 'WRONG_ENTRY: เอกสาร OI-26040015 ระบุลูกค้าผิด',
        taxFiled: true,
      },
    ]);
    render(<ReopenedPeriodBanner />, { wrapper });
    expect(await screen.findByText(/2026-04/)).toBeInTheDocument();
    expect(screen.getByText(/สุทธินีย์/)).toBeInTheDocument();
    expect(screen.getByText(/ภ.พ.30 ยื่นแล้ว/)).toBeInTheDocument();
  });

  it('omits tax-filed warning when taxFiled is false', async () => {
    (accountingApi.listReopenedPeriods as any).mockResolvedValue([
      { period: '2026-03', reopenedAt: '2026-05-12T14:00:00Z', reopenedBy: { id: 'u1', name: 'สุทธินีย์' }, reopenReason: 'WRONG_ENTRY: ...', taxFiled: false },
    ]);
    render(<ReopenedPeriodBanner />, { wrapper });
    await screen.findByText(/2026-03/);
    expect(screen.queryByText(/ภ.พ.30 ยื่นแล้ว/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/web && npx vitest run src/components/accounting/__tests__/ReopenedPeriodBanner.test.tsx
```

- [ ] **Step 3: Implement component**

```tsx
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { accountingApi } from '@/lib/accounting';

type ReopenedPeriod = {
  period: string;
  reopenedAt: string;
  reopenedBy: { id: string; name: string };
  reopenReason: string | null;
  taxFiled: boolean | null;
};

export function ReopenedPeriodBanner() {
  const { data } = useQuery<ReopenedPeriod[]>({
    queryKey: ['accounting-periods', 'reopened'],
    queryFn: () => accountingApi.listReopenedPeriods(),
    staleTime: 60_000,
  });

  if (!data || data.length === 0) return null;

  return (
    <div className="space-y-2">
      {data.map((p) => (
        <Alert key={p.period} variant="warning" className="border-warning bg-warning/10">
          <AlertTriangle className="w-4 h-4 text-warning" />
          <AlertTitle>งวด {p.period} ถูกเปิดชั่วคราว</AlertTitle>
          <AlertDescription className="space-y-1">
            <p>
              เปิดเมื่อ: {new Date(p.reopenedAt).toLocaleString('th-TH')}
              {p.reopenedBy?.name ? ` โดย ${p.reopenedBy.name}` : ''}
            </p>
            {p.reopenReason && <p>เหตุผล: {p.reopenReason}</p>}
            {p.taxFiled && <p className="text-destructive font-medium">⚠ ภ.พ.30 ยื่นแล้ว — ต้องยื่นแก้ไขด้วย</p>}
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Add listReopenedPeriods API helper**

In `apps/web/src/lib/accounting.ts`:

```ts
listReopenedPeriods: () => api.get<ReopenedPeriod[]>('/accounting/periods/reopened').then((r) => r.data),
```

- [ ] **Step 5: Run — expect PASS**

```bash
npx vitest run src/components/accounting/__tests__/ReopenedPeriodBanner.test.tsx
```

- [ ] **Step 6: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/oi-v2-2-pr1
git add apps/web/src/components/accounting/ReopenedPeriodBanner.tsx \
        apps/web/src/components/accounting/__tests__/ReopenedPeriodBanner.test.tsx \
        apps/web/src/lib/accounting.ts
git commit -m "feat(accounting): ReopenedPeriodBanner — warns users on list pages when a period is reopened

Renders one alert per currently-reopened period with reason + tax-filed warning.
Stale-while-revalidate 60s cache.

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §4.2"
```

---

## Task 12: Install banner on OtherIncomeListPage + ExpensesPage

**Files:**
- Modify: `apps/web/src/pages/other-income/OtherIncomeListPage.tsx`
- Modify: `apps/web/src/pages/ExpensesPage.tsx`

- [ ] **Step 1: Add banner to OtherIncomeListPage**

Locate where the page content starts (after `<PageHeader />` likely), insert:

```tsx
import { ReopenedPeriodBanner } from '@/components/accounting/ReopenedPeriodBanner';

// In JSX, near top of content:
<ReopenedPeriodBanner />
```

- [ ] **Step 2: Add banner to ExpensesPage**

Same pattern.

- [ ] **Step 3: Type-check + commit**

```bash
./tools/check-types.sh web
git add apps/web/src/pages/other-income/OtherIncomeListPage.tsx apps/web/src/pages/ExpensesPage.tsx
git commit -m "feat(accounting): install ReopenedPeriodBanner on OtherIncomeListPage + ExpensesPage

Per PDF AC-3.4 — users see banner whenever any period is currently reopened.

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §4.2"
```

---

## Task 13: Final verification (PR-2)

- [ ] **Step 1: Full type check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/oi-v2-2-pr1
./tools/check-types.sh all
```

- [ ] **Step 2: API tests**

```bash
cd apps/api && DATABASE_URL="postgresql://iamnaii@localhost:5432/bestchoice_oi_test" npx jest src/modules/accounting/ src/modules/system-config/ 2>&1 | tail -10
```

- [ ] **Step 3: Web tests**

```bash
cd ../web && npx vitest run \
  src/pages/SettingsPage/components/__tests__/ \
  src/pages/accounting/components/__tests__/ \
  src/components/accounting/__tests__/
```

- [ ] **Step 4: Update accounting docs**

Append to `.claude/rules/accounting.md` (after the Override JV section):

```markdown
### Maker-Checker toggle (Other Income)

`PUT /system-config/maker-checker` (OWNER only) toggles `OTHER_INCOME_MAKER_CHECKER_ENABLED`. Emits `CONFIG_CHANGED` audit string. When turning OFF, UI shows count of READY docs from `GET /system-config/maker-checker/pending-ready-count` for awareness — they auto-approve on next post.

### Reopen Period workflow

`POST /accounting/periods/:period/reopen` (OWNER only) accepts `ReopenPeriodDto { reasonType, reason, taxFiled }`:
- `reasonType`: enum (WRONG_ENTRY / MISSED_RECORD / AUDITOR_REQUEST / OTHER)
- `reason`: free text, min 10 chars
- `taxFiled`: true if ภ.พ.30 has been submitted (UI banner adds warning when true)

Persists `reopenReason` + `taxFiled` on `AccountingPeriod`. Emits `PERIOD_REOPENED` audit. `closePeriod()` emits `PERIOD_CLOSED`. `GET /accounting/periods/reopened` lists currently-reopened periods (status=OPEN AND reopenedAt set) for the banner.
```

```bash
git add .claude/rules/accounting.md
git commit -m "docs(accounting): document Maker-Checker toggle + Reopen Period workflow

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §4"
```
