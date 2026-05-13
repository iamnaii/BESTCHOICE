# Other Income v2.2 PR-1 — Override JV + Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Sprint 1 from PDF v2.2 — extend the existing Override JV skeleton with V2/V5 validation, audit log capture, and UI; plus migrate all list pages to a shared URL-driven PaginationBar.

**Architecture:** Backend extracts V1/V2/V5 validation + diff summary into `JournalOverrideService`, wires it into the existing override branch in `OtherIncomeService.post()`, persists `isOverridden=true`, and writes audit logs through `AuditService`. Frontend adds an override toggle + confirmation dialog + live validation to `OtherIncomeEntryPage`, a ✏ marker to list pages, and a diff renderer for `JV_OVERRIDDEN` audit entries on the view page. A shared `PaginationBar` + `usePaginationParams` hook standardize URL-param-driven pagination across `OtherIncomeListPage`, `ExpensesPage`, `AuditLogsPage`, and `OtherIncomePendingApprovalPage`.

**Tech Stack:** NestJS (backend), Prisma (Decimal-first), React 18 + Vite + react-router v7 + @tanstack/react-query + shadcn/ui + Tailwind, vitest (web tests), jest (api tests), Playwright (e2e).

**Spec reference:** [docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md](../../specs/2026-05-13-other-income-v2-2-design.md) Sprint 1 (sections 3, 6.1, 6.4, 7).

**Important codebase facts verified:**
- `AuditLog.action` is `String` (not enum) at [schema.prisma:2152-2155](../../../apps/api/prisma/schema.prisma#L2152-L2155) → no migration needed for new action values.
- `OtherIncome.isOverridden Boolean @default(false)` exists at [schema.prisma:5841](../../../apps/api/prisma/schema.prisma#L5841).
- `PostOtherIncomeDto.override` + `overrideLines` already exist with field shape `{ accountCode, debit, credit, description? }`.
- `OtherIncomeService.post()` at [other-income.service.ts:433](../../../apps/api/src/modules/other-income/other-income.service.ts#L433) already implements V1 inline + override branch but lacks V2/V5, isOverridden persistence, and audit capture.
- `AuditService.log()` at [audit.service.ts:58](../../../apps/api/src/modules/audit/audit.service.ts#L58) takes `{ userId, action, entity, entityId, oldValue, newValue, ipAddress, userAgent, duration }`. Stash original/modified JV + diff_summary into `oldValue` / `newValue`.

---

## File Structure

### Backend (create)
- `apps/api/src/modules/other-income/services/journal-override.service.ts` — pure logic: `validate(lines)` (V1/V2/V5), `computeDiffSummary(original, modified)`
- `apps/api/src/modules/other-income/services/journal-override.service.spec.ts` — unit tests for both methods

### Backend (modify)
- `apps/api/src/modules/other-income/other-income.module.ts` — register `JournalOverrideService` provider; ensure `AuditModule` imported
- `apps/api/src/modules/other-income/other-income.service.ts` — inject `JournalOverrideService` + `AuditService`; in `post()` replace inline V1 check with `journalOverride.validate(lines)`; in override branch compute `autoJeLines` baseline, mark `isOverridden=true`, write `JV_OVERRIDDEN` audit
- `apps/api/src/modules/other-income/__tests__/maker-checker.spec.ts` — add 4 new test cases (V2/V5 failures, isOverridden flag, audit capture)

### Frontend (create)
- `apps/web/src/components/ui/PaginationBar.tsx` — shared pagination UI (First / Prev / numeric / Next / Last + page-size selector + jump-to-page + total count)
- `apps/web/src/components/ui/__tests__/PaginationBar.test.tsx`
- `apps/web/src/hooks/usePaginationParams.ts` — URL-param-driven `{ page, size, setPage, setSize }`
- `apps/web/src/hooks/__tests__/usePaginationParams.test.tsx`
- `apps/web/src/pages/other-income/components/OverrideConfirmDialog.tsx` — pre-override warning + acknowledgement checkbox
- `apps/web/src/pages/other-income/components/EditableJournalTable.tsx` — editable table with live V1/V2/V5 validation
- `apps/web/src/pages/other-income/components/__tests__/OverrideConfirmDialog.test.tsx`

### Frontend (modify)
- `apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx` — override toggle + dialog + editable JE table + submit `override: true, overrideLines`
- `apps/web/src/pages/other-income/OtherIncomeListPage.tsx` — ✏ marker beside doc number when `isOverridden` + migrate pagination
- `apps/web/src/pages/other-income/OtherIncomeViewPage.tsx` — render `JV_OVERRIDDEN` audit entries with diff
- `apps/web/src/pages/other-income/OtherIncomePendingApprovalPage.tsx` — migrate pagination
- `apps/web/src/pages/ExpensesPage.tsx` — migrate pagination (default size 50)
- `apps/web/src/pages/AuditLogsPage.tsx` — migrate pagination (default size 100)

### Migration
- `apps/api/prisma/migrations/<timestamp>_add_indexes_other_income_audit_status/migration.sql` — add `(status, created_at)` composite indexes on `other_incomes`, `expenses`; verify `audit_logs (event_at DESC)` or equivalent exists.

---

## Task 1: JournalOverrideService — V1/V2/V5 validation

**Files:**
- Create: `apps/api/src/modules/other-income/services/journal-override.service.ts`
- Test: `apps/api/src/modules/other-income/services/journal-override.service.spec.ts`

- [ ] **Step 1: Write failing tests for validate()**

Create `apps/api/src/modules/other-income/services/journal-override.service.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JournalOverrideService, OverrideLine } from './journal-override.service';

const D = Prisma.Decimal;

describe('JournalOverrideService', () => {
  const svc = new JournalOverrideService();

  const line = (accountCode: string, debit: number, credit: number): OverrideLine => ({
    accountCode,
    debit: new D(debit),
    credit: new D(credit),
  });

  describe('validate()', () => {
    it('V1: passes when Dr equals Cr exactly', () => {
      expect(() => svc.validate([line('11-1101', 100, 0), line('42-1102', 0, 100)])).not.toThrow();
    });

    it('V1: passes within 0.01 tolerance', () => {
      expect(() =>
        svc.validate([line('11-1101', 100.005, 0), line('42-1102', 0, 100)]),
      ).not.toThrow();
    });

    it('V1: throws when Dr != Cr beyond 0.01 tolerance', () => {
      expect(() => svc.validate([line('11-1101', 100, 0), line('42-1102', 0, 99)]))
        .toThrow(BadRequestException);
      try {
        svc.validate([line('11-1101', 100, 0), line('42-1102', 0, 99)]);
      } catch (e: any) {
        expect(e.response.errors[0].rule).toBe('V1');
        expect(e.response.errors[0].msg).toContain('ผลต่าง');
      }
    });

    it('V2: throws when fewer than 2 lines', () => {
      expect(() => svc.validate([])).toThrow(BadRequestException);
      try { svc.validate([]); } catch (e: any) {
        expect(e.response.errors[0].rule).toBe('V2');
      }
      expect(() => svc.validate([line('11-1101', 100, 0)])).toThrow(BadRequestException);
    });

    it('V5: throws when a line has both Dr and Cr', () => {
      try {
        svc.validate([line('11-1101', 50, 50), line('42-1102', 0, 100)]);
        fail('should have thrown');
      } catch (e: any) {
        expect(e.response.errors[0].rule).toBe('V5');
        expect(e.response.errors[0].msg).toContain('11-1101');
        expect(e.response.errors[0].msg).toContain('มีทั้ง Dr และ Cr');
      }
    });

    it('V5: throws when a line has neither Dr nor Cr', () => {
      try {
        svc.validate([line('11-1101', 100, 0), line('42-1102', 0, 0), line('21-2101', 0, 100)]);
        fail('should have thrown');
      } catch (e: any) {
        expect(e.response.errors[0].rule).toBe('V5');
        expect(e.response.errors[0].msg).toContain('42-1102');
        expect(e.response.errors[0].msg).toContain('ไม่มีทั้ง Dr และ Cr');
      }
    });

    it('errors are returned in V1 → V2 → V5 order — V2 short-circuits before V5', () => {
      // 1 line that's also missing dr/cr should report V2 first
      try { svc.validate([line('11-1101', 0, 0)]); } catch (e: any) {
        expect(e.response.errors[0].rule).toBe('V2');
      }
    });
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL**

```bash
cd apps/api && npx jest src/modules/other-income/services/journal-override.service.spec.ts
```

Expected: all tests fail with `Cannot find module './journal-override.service'`.

- [ ] **Step 3: Implement validate()**

Create `apps/api/src/modules/other-income/services/journal-override.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export interface OverrideLine {
  accountCode: string;
  debit: Decimal;
  credit: Decimal;
  description?: string;
}

export interface ValidationError {
  rule: 'V1' | 'V2' | 'V5';
  msg: string;
}

const TOLERANCE = new D('0.01');

@Injectable()
export class JournalOverrideService {
  /**
   * Validate override JE lines against V1 (balanced), V2 (>=2 lines), V5 (Dr XOR Cr per line).
   * Short-circuits at first failing rule in order V2 → V5 → V1 so users see the most
   * fundamental problem first.
   */
  validate(lines: OverrideLine[]): void {
    // V2 — must have at least 2 lines
    if (lines.length < 2) {
      this.fail('V2', 'ต้องมีอย่างน้อย 2 บรรทัด');
    }

    // V5 — each line must be Dr XOR Cr
    for (const line of lines) {
      const hasDr = line.debit.gt(0);
      const hasCr = line.credit.gt(0);
      if (hasDr && hasCr) {
        this.fail('V5', `บรรทัด ${line.accountCode} มีทั้ง Dr และ Cr — ต้องระบุอย่างใดอย่างหนึ่ง`);
      }
      if (!hasDr && !hasCr) {
        this.fail('V5', `บรรทัด ${line.accountCode} ไม่มีทั้ง Dr และ Cr`);
      }
    }

    // V1 — balanced within 0.01 THB tolerance
    const drTotal = lines.reduce((s, l) => s.plus(l.debit), new D(0));
    const crTotal = lines.reduce((s, l) => s.plus(l.credit), new D(0));
    const diff = drTotal.minus(crTotal).abs();
    if (diff.gt(TOLERANCE)) {
      this.fail('V1', `Dr (${drTotal.toFixed(2)}) ≠ Cr (${crTotal.toFixed(2)}) — ผลต่าง ${diff.toFixed(2)} บาท`);
    }
  }

  private fail(rule: 'V1' | 'V2' | 'V5', msg: string): never {
    throw new BadRequestException({
      message: 'ไม่ผ่านการตรวจสอบ Override JV',
      errors: [{ rule, msg } satisfies ValidationError],
    });
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd apps/api && npx jest src/modules/other-income/services/journal-override.service.spec.ts
```

Expected: all 7 test cases pass.

- [ ] **Step 5: Write failing tests for computeDiffSummary()**

Append to the same `journal-override.service.spec.ts`:

```ts
  describe('computeDiffSummary()', () => {
    const auto = [line('11-1101', 1000, 0), line('42-1102', 0, 1000)];

    it('returns empty string when arrays are equal', () => {
      expect(svc.computeDiffSummary(auto, [...auto])).toBe('');
    });

    it('detects modified credit amount', () => {
      const modified = [line('11-1101', 1500, 0), line('42-1102', 0, 1500)];
      const summary = svc.computeDiffSummary(auto, modified);
      expect(summary).toContain('แก้');
      expect(summary).toContain('11-1101');
      expect(summary).toContain('1,000.00');
      expect(summary).toContain('1,500.00');
    });

    it('detects added line', () => {
      const modified = [...auto, line('21-2101', 0, 70)];
      const summary = svc.computeDiffSummary(auto, modified);
      expect(summary).toContain('เพิ่มบรรทัด');
      expect(summary).toContain('21-2101');
    });

    it('detects removed line', () => {
      const modified = [auto[0]];
      const summary = svc.computeDiffSummary(auto, modified);
      expect(summary).toContain('ลบบรรทัด');
      expect(summary).toContain('42-1102');
    });

    it('combines multiple changes with separator', () => {
      const modified = [line('11-1101', 1500, 0), line('21-2101', 0, 1500)];
      const summary = svc.computeDiffSummary(auto, modified);
      expect(summary).toContain('แก้');
      expect(summary).toContain('ลบบรรทัด');
      expect(summary).toContain('เพิ่มบรรทัด');
      expect(summary).toContain(';'); // separator
    });
  });
```

- [ ] **Step 6: Run — expect FAIL**

```bash
cd apps/api && npx jest src/modules/other-income/services/journal-override.service.spec.ts -t computeDiffSummary
```

Expected: `svc.computeDiffSummary is not a function`.

- [ ] **Step 7: Implement computeDiffSummary()**

Append the following method inside the `JournalOverrideService` class (before the closing `}`):

```ts
  /**
   * Diff two JE line arrays by accountCode. Returns a Thai-language summary used in
   * audit log "diff_summary" field. Empty string when identical.
   *
   * Limitations: assumes one entry per accountCode per side. If a real-world override
   * needs duplicate accountCode lines, we'd need to use index-based keys.
   */
  computeDiffSummary(original: OverrideLine[], modified: OverrideLine[]): string {
    const origMap = new Map(original.map((l) => [l.accountCode, l]));
    const modMap = new Map(modified.map((l) => [l.accountCode, l]));

    const parts: string[] = [];

    // Modified lines (in both, but with different amounts)
    for (const [code, modLine] of modMap) {
      const origLine = origMap.get(code);
      if (!origLine) continue; // handled in "added" pass below
      const drChanged = !origLine.debit.eq(modLine.debit);
      const crChanged = !origLine.credit.eq(modLine.credit);
      if (drChanged) {
        parts.push(
          `แก้ Dr ${code} จาก ${this.fmt(origLine.debit)} → ${this.fmt(modLine.debit)}`,
        );
      }
      if (crChanged) {
        parts.push(
          `แก้ Cr ${code} จาก ${this.fmt(origLine.credit)} → ${this.fmt(modLine.credit)}`,
        );
      }
    }

    // Added lines (in modified, not in original)
    for (const [code, modLine] of modMap) {
      if (origMap.has(code)) continue;
      const side = modLine.debit.gt(0) ? 'Dr' : 'Cr';
      const amt = modLine.debit.gt(0) ? modLine.debit : modLine.credit;
      parts.push(`เพิ่มบรรทัด ${side} ${code} ${this.fmt(amt)}`);
    }

    // Removed lines (in original, not in modified)
    for (const [code, origLine] of origMap) {
      if (modMap.has(code)) continue;
      const side = origLine.debit.gt(0) ? 'Dr' : 'Cr';
      const amt = origLine.debit.gt(0) ? origLine.debit : origLine.credit;
      parts.push(`ลบบรรทัด ${side} ${code} ${this.fmt(amt)}`);
    }

    return parts.join('; ');
  }

  private fmt(d: Decimal): string {
    // Thai-style number with 2 decimals, comma thousands
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      .format(d.toNumber());
  }
```

- [ ] **Step 8: Run all spec tests — expect PASS**

```bash
cd apps/api && npx jest src/modules/other-income/services/journal-override.service.spec.ts
```

Expected: all tests pass (12 total: 7 validate + 5 diff).

- [ ] **Step 9: Register provider in module**

Modify `apps/api/src/modules/other-income/other-income.module.ts`:

Add to imports:
```ts
import { JournalOverrideService } from './services/journal-override.service';
```

Add to the `providers` array:
```ts
providers: [
  // ...existing providers
  JournalOverrideService,
],
```

If the `exports` array exists and `JournalOverrideService` needs to be used by other modules (it doesn't in this PR), skip exporting.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/other-income/services/journal-override.service.ts \
        apps/api/src/modules/other-income/services/journal-override.service.spec.ts \
        apps/api/src/modules/other-income/other-income.module.ts
git commit -m "$(cat <<'EOF'
feat(other-income): JournalOverrideService — V1/V2/V5 validation + diff summary

Pure service used by post() override branch:
- validate() — V2 (>=2 lines), V5 (Dr XOR Cr per line), V1 (|Dr-Cr| <= 0.01)
- computeDiffSummary() — Thai-language diff between auto and override JE lines

12 unit tests covering edge cases (tolerance, short-circuit order, add/remove/modify).

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §3.1
EOF
)"
```

---

## Task 2: Wire override → V1/V2/V5 + isOverridden + audit

**Files:**
- Modify: `apps/api/src/modules/other-income/other-income.service.ts` (post method, lines 433-580ish)
- Test: `apps/api/src/modules/other-income/__tests__/maker-checker.spec.ts` (add new test cases)

- [ ] **Step 1: Write failing integration tests**

Append to `apps/api/src/modules/other-income/__tests__/maker-checker.spec.ts` (within the existing `describe('OtherIncomeService — Maker-Checker', ...)` or in a new `describe` block):

```ts
describe('Override JV (V1/V2/V5)', () => {
  // Assumes existing test setup creates a DRAFT doc with id=draftId, createdById=makerId
  // and seeds a maker user. Mirror existing test bootstrapping in maker-checker.spec.ts.

  it('rejects override with fewer than 2 lines (V2)', async () => {
    await expect(
      service.post(draftId, {
        override: true,
        overrideLines: [
          { accountCode: '11-1101', debit: 100, credit: 0 },
        ],
      }, makerId),
    ).rejects.toMatchObject({
      response: { errors: [{ rule: 'V2' }] },
    });
  });

  it('rejects override with both Dr and Cr in one line (V5)', async () => {
    await expect(
      service.post(draftId, {
        override: true,
        overrideLines: [
          { accountCode: '11-1101', debit: 50, credit: 50 },
          { accountCode: '42-1102', debit: 0, credit: 100 },
        ],
      }, makerId),
    ).rejects.toMatchObject({
      response: { errors: [{ rule: 'V5' }] },
    });
  });

  it('rejects unbalanced override (V1)', async () => {
    await expect(
      service.post(draftId, {
        override: true,
        overrideLines: [
          { accountCode: '11-1101', debit: 100, credit: 0 },
          { accountCode: '42-1102', debit: 0, credit: 90 },
        ],
      }, makerId),
    ).rejects.toMatchObject({
      response: { errors: [{ rule: 'V1' }] },
    });
  });

  it('sets isOverridden=true and writes JV_OVERRIDDEN audit on successful override post', async () => {
    const posted = await service.post(draftId, {
      override: true,
      overrideLines: [
        { accountCode: '11-1101', debit: 1500, credit: 0 },
        { accountCode: '42-1102', debit: 0, credit: 1500 },
      ],
    }, makerId);

    expect(posted.isOverridden).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'JV_OVERRIDDEN', entityId: draftId },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeTruthy();
    expect(audit!.oldValue).toMatchObject({ jvLines: expect.any(Array) }); // original auto JV
    expect(audit!.newValue).toMatchObject({
      jvLines: expect.any(Array),
      diffSummary: expect.stringContaining('แก้'),
    });
  });

  it('does not write JV_OVERRIDDEN audit on non-override post', async () => {
    await service.post(draftId, {}, makerId);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'JV_OVERRIDDEN', entityId: draftId },
    });
    expect(audit).toBeNull();
  });
});
```

> Note: copy any `beforeEach` doc-bootstrap pattern from existing tests in the same file. If the file uses `setupOtherIncomeFixture()` or similar, reuse it.

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/api && npx jest src/modules/other-income/__tests__/maker-checker.spec.ts -t "Override JV"
```

Expected: V2 + V5 tests fail (current code only enforces V1). `isOverridden` test fails (flag not persisted). Audit test fails (no audit written).

- [ ] **Step 3: Inject JournalOverrideService + AuditService**

Modify `apps/api/src/modules/other-income/other-income.service.ts`:

Add imports near top:
```ts
import { JournalOverrideService, OverrideLine } from './services/journal-override.service';
import { AuditService } from '../audit/audit.service';
```

Update constructor (currently at line 28-35):
```ts
constructor(
  private readonly prisma: PrismaService,
  private readonly docNumber: DocNumberService,
  private readonly validation: ValidationService,
  private readonly autoJournal: AutoJournalService,
  private readonly template: OtherIncomeTemplate,
  private readonly storage: StorageService,
  private readonly journalOverride: JournalOverrideService,  // NEW
  private readonly audit: AuditService,                       // NEW
) {}
```

Ensure `AuditModule` is imported in `other-income.module.ts` (check imports array; if not present, add it).

- [ ] **Step 4: Replace inline V1 with full V1/V2/V5 + always compute auto baseline**

In `OtherIncomeService.post()` ([other-income.service.ts:482-536](../../../apps/api/src/modules/other-income/other-income.service.ts#L482-L536)), replace the entire block from the comment `// C3: validate override lines balance` through the end of the `else { jeLines = this.autoJournal.generate({...}); }` block (i.e. lines ~482-536) with:

```ts
    // Always compute the auto baseline — needed for diff_summary when override is used
    const autoJeLines: OverrideLine[] = this.autoJournal.generate({
      paymentAccountCode: doc.paymentAccountCode,
      amountReceived: new D(doc.amountReceived.toString()),
      netReceived: new D(doc.netReceived.toString()),
      items: doc.items.map((it) => ({
        lineNo: it.lineNo,
        accountCode: it.accountCode,
        accountName: it.accountName,
        description: it.description ?? undefined,
        amountBeforeVat: new D(it.amountBeforeVat.toString()),
        vatAmount: new D(it.vatAmount.toString()),
        whtAmount: new D(it.whtAmount.toString()),
        whtPct: new D(it.whtPct.toString()),
      })),
      adjustments: doc.adjustments.map((a) => ({
        lineNo: a.lineNo,
        accountCode: a.accountCode,
        amount: new D(a.amount.toString()),
        note: a.note ?? undefined,
      })),
    }).map((l) => ({
      accountCode: l.accountCode,
      debit: l.debit,
      credit: l.credit,
      description: l.description,
    }));

    let jeLines: OverrideLine[];
    let overrideLinesForAudit: OverrideLine[] | null = null;

    if (dto.override && dto.overrideLines && dto.overrideLines.length > 0) {
      const overrideLines: OverrideLine[] = dto.overrideLines.map((l) => ({
        accountCode: l.accountCode,
        debit: new D(l.debit),
        credit: new D(l.credit),
        description: l.description,
      }));

      // Throws BadRequestException with V1/V2/V5 errors
      this.journalOverride.validate(overrideLines);

      jeLines = overrideLines;
      overrideLinesForAudit = overrideLines;
    } else {
      jeLines = autoJeLines;
    }
```

> Note: the new code calls `this.autoJournal.generate(...)` once unconditionally (the previous code called it only in the `else` branch). This is required for diff summary. If `autoJournal.generate()` returns a shape with `debit` and `credit` as `Decimal`, the `.map()` is the identity transform — adjust property names if they differ. Verify shape during this step.

- [ ] **Step 5: Set isOverridden + write audit inside the transaction**

In the same `post()` method, find the `tx.otherIncome.update(...)` call that flips status to `POSTED` (it should be inside the `this.prisma.$transaction(async (tx) => { ... })` block at lines ~538+). After the `tx.otherIncome.update(...)` call, add:

```ts
      // Persist isOverridden flag
      if (overrideLinesForAudit) {
        await tx.otherIncome.update({
          where: { id: doc.id },
          data: { isOverridden: true },
        });
      }
```

> If the existing `tx.otherIncome.update({ where:{id}, data:{ status: POSTED, ... } })` call exists, prefer merging `isOverridden: overrideLinesForAudit !== null` into its `data` instead of a second update — review the surrounding code and pick whichever is cleaner.

Then, after the transaction closes (i.e. after the closing `})` of `$transaction`), add the audit write (outside the transaction to avoid blocking on its DB connection):

```ts
    if (overrideLinesForAudit) {
      const diffSummary = this.journalOverride.computeDiffSummary(autoJeLines, overrideLinesForAudit);
      await this.audit.log({
        userId,
        action: 'JV_OVERRIDDEN',
        entity: 'other_income',
        entityId: doc.id,
        oldValue: {
          jvLines: autoJeLines.map((l) => ({
            accountCode: l.accountCode,
            debit: l.debit.toString(),
            credit: l.credit.toString(),
            description: l.description ?? null,
          })),
        },
        newValue: {
          jvLines: overrideLinesForAudit.map((l) => ({
            accountCode: l.accountCode,
            debit: l.debit.toString(),
            credit: l.credit.toString(),
            description: l.description ?? null,
          })),
          diffSummary,
        },
      });
    }
```

The `return` statement of `post()` should be after this audit block. Verify the existing return value shape (likely the posted OI doc with relations) and keep it unchanged.

- [ ] **Step 6: Run tests — expect PASS**

```bash
cd apps/api && npx jest src/modules/other-income/__tests__/maker-checker.spec.ts -t "Override JV"
```

Expected: all 5 new tests pass. Also run the full file to ensure no regression:

```bash
cd apps/api && npx jest src/modules/other-income/__tests__/maker-checker.spec.ts
```

- [ ] **Step 7: Run full type check**

```bash
./tools/check-types.sh api
```

Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/other-income/other-income.service.ts \
        apps/api/src/modules/other-income/other-income.module.ts \
        apps/api/src/modules/other-income/__tests__/maker-checker.spec.ts
git commit -m "$(cat <<'EOF'
feat(other-income): wire V1/V2/V5 + isOverridden + JV_OVERRIDDEN audit into post()

- Replace inline V1 check with JournalOverrideService.validate() (V1/V2/V5)
- Always compute auto JE baseline (needed for diff summary)
- Set OtherIncome.isOverridden=true when override branch taken
- Write JV_OVERRIDDEN audit with { oldValue: original, newValue: { modified, diffSummary } }

5 new integration tests in maker-checker.spec.ts covering V2/V5 rejections,
flag persistence, and audit capture.

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §3.1
EOF
)"
```

---

## Task 3: OverrideConfirmDialog component

**Files:**
- Create: `apps/web/src/pages/other-income/components/OverrideConfirmDialog.tsx`
- Test: `apps/web/src/pages/other-income/components/__tests__/OverrideConfirmDialog.test.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/web/src/pages/other-income/components/__tests__/OverrideConfirmDialog.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { OverrideConfirmDialog } from '../OverrideConfirmDialog';

describe('OverrideConfirmDialog', () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    onConfirm.mockClear();
    onCancel.mockClear();
  });

  it('does not render when open=false', () => {
    render(<OverrideConfirmDialog open={false} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.queryByText(/แก้ไข Auto Journal ด้วยตนเอง/)).not.toBeInTheDocument();
  });

  it('renders warning + impacts + checkbox when open', () => {
    render(<OverrideConfirmDialog open={true} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByText(/แก้ไข Auto Journal ด้วยตนเอง/)).toBeInTheDocument();
    expect(screen.getByText(/ตรวจสอบ V1\/V2\/V5/)).toBeInTheDocument();
    expect(screen.getByText(/บันทึกใน Audit Log/)).toBeInTheDocument();
    expect(screen.getByText(/ฉันเข้าใจและรับผิดชอบ/)).toBeInTheDocument();
  });

  it('confirm button is disabled until acknowledgement checkbox is checked', () => {
    render(<OverrideConfirmDialog open={true} onConfirm={onConfirm} onCancel={onCancel} />);
    const confirmBtn = screen.getByRole('button', { name: /เปิดโหมดแก้ไข/ });
    expect(confirmBtn).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(confirmBtn).toBeEnabled();
  });

  it('calls onConfirm when confirm clicked after acknowledging', () => {
    render(<OverrideConfirmDialog open={true} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /เปิดโหมดแก้ไข/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when cancel clicked', () => {
    render(<OverrideConfirmDialog open={true} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /ยกเลิก/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/web && npx vitest run src/pages/other-income/components/__tests__/OverrideConfirmDialog.test.tsx
```

Expected: `Cannot find module '../OverrideConfirmDialog'`.

- [ ] **Step 3: Implement component**

Create `apps/web/src/pages/other-income/components/OverrideConfirmDialog.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertTriangle } from 'lucide-react';

type Props = {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function OverrideConfirmDialog({ open, onConfirm, onCancel }: Props) {
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!open) setAcknowledged(false); // reset on close
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="w-5 h-5" />
            คุณกำลังจะแก้ไข Auto Journal ด้วยตนเอง
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <ul className="space-y-1 list-disc list-inside text-muted-foreground">
            <li>ระบบจะตรวจสอบ V1/V2/V5 ก่อน POST</li>
            <li>การกระทำนี้จะถูกบันทึกใน Audit Log</li>
            <li>เอกสารจะมีเครื่องหมาย ✏ Modified ในรายการ</li>
          </ul>

          <label className="flex items-start gap-2 pt-2 cursor-pointer">
            <Checkbox checked={acknowledged} onCheckedChange={(v) => setAcknowledged(Boolean(v))} />
            <span className="text-sm">ฉันเข้าใจและรับผิดชอบความถูกต้อง</span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>ยกเลิก</Button>
          <Button onClick={onConfirm} disabled={!acknowledged}>เปิดโหมดแก้ไข</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd apps/web && npx vitest run src/pages/other-income/components/__tests__/OverrideConfirmDialog.test.tsx
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/other-income/components/OverrideConfirmDialog.tsx \
        apps/web/src/pages/other-income/components/__tests__/OverrideConfirmDialog.test.tsx
git commit -m "feat(other-income): OverrideConfirmDialog — pre-override warning + ack checkbox

Confirm button stays disabled until user acknowledges responsibility checkbox.
Resets on close. 5 component tests via vitest.

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §3.1"
```

---

## Task 4: EditableJournalTable component

**Files:**
- Create: `apps/web/src/pages/other-income/components/EditableJournalTable.tsx`

This component renders an editable table of JE lines with live V1/V2/V5 validation echo. Used inside `OtherIncomeEntryPage` when override mode is active.

- [ ] **Step 1: Create component**

Create `apps/web/src/pages/other-income/components/EditableJournalTable.tsx`:

```tsx
import { useMemo } from 'react';
import { Trash2, Plus, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type EditableJournalLine = {
  accountCode: string;
  debit: number;
  credit: number;
  description?: string;
};

type Props = {
  lines: EditableJournalLine[];
  onChange: (next: EditableJournalLine[]) => void;
};

type ValidationIssue = { rule: 'V1' | 'V2' | 'V5'; msg: string };

function validateClientSide(lines: EditableJournalLine[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (lines.length < 2) {
    issues.push({ rule: 'V2', msg: 'ต้องมีอย่างน้อย 2 บรรทัด' });
  }

  for (const line of lines) {
    const hasDr = line.debit > 0;
    const hasCr = line.credit > 0;
    if (hasDr && hasCr) {
      issues.push({ rule: 'V5', msg: `บรรทัด ${line.accountCode || '(ไม่ระบุ)'} มีทั้ง Dr และ Cr` });
    } else if (!hasDr && !hasCr) {
      issues.push({ rule: 'V5', msg: `บรรทัด ${line.accountCode || '(ไม่ระบุ)'} ไม่มีทั้ง Dr และ Cr` });
    }
  }

  const drTotal = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const crTotal = lines.reduce((s, l) => s + (l.credit || 0), 0);
  if (Math.abs(drTotal - crTotal) > 0.01) {
    issues.push({
      rule: 'V1',
      msg: `Dr (${drTotal.toFixed(2)}) ≠ Cr (${crTotal.toFixed(2)}) — ผลต่าง ${(drTotal - crTotal).toFixed(2)} บาท`,
    });
  }

  return issues;
}

export function EditableJournalTable({ lines, onChange }: Props) {
  const issues = useMemo(() => validateClientSide(lines), [lines]);
  const drTotal = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const crTotal = lines.reduce((s, l) => s + (l.credit || 0), 0);

  const updateLine = (idx: number, patch: Partial<EditableJournalLine>) => {
    onChange(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const deleteLine = (idx: number) => onChange(lines.filter((_, i) => i !== idx));
  const addLine = () => onChange([...lines, { accountCode: '', debit: 0, credit: 0 }]);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-2 py-2 text-left">รหัสบัญชี</th>
              <th className="px-2 py-2 text-right">Dr</th>
              <th className="px-2 py-2 text-right">Cr</th>
              <th className="px-2 py-2 text-left">หมายเหตุ</th>
              <th className="px-2 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => (
              <tr key={idx} className="border-t border-border">
                <td className="px-2 py-1">
                  <Input
                    value={line.accountCode}
                    onChange={(e) => updateLine(idx, { accountCode: e.target.value })}
                    placeholder="42-1102"
                    className="font-mono"
                  />
                </td>
                <td className="px-2 py-1">
                  <Input
                    type="number" step="0.01" min="0"
                    value={line.debit || ''}
                    onChange={(e) => updateLine(idx, { debit: Number(e.target.value) || 0, credit: 0 })}
                    className="text-right font-mono"
                  />
                </td>
                <td className="px-2 py-1">
                  <Input
                    type="number" step="0.01" min="0"
                    value={line.credit || ''}
                    onChange={(e) => updateLine(idx, { credit: Number(e.target.value) || 0, debit: 0 })}
                    className="text-right font-mono"
                  />
                </td>
                <td className="px-2 py-1">
                  <Input
                    value={line.description ?? ''}
                    onChange={(e) => updateLine(idx, { description: e.target.value })}
                  />
                </td>
                <td className="px-2 py-1">
                  <Button variant="ghost" size="icon" onClick={() => deleteLine(idx)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </td>
              </tr>
            ))}
            <tr className="border-t border-border bg-muted font-mono text-sm">
              <td className="px-2 py-2 font-semibold">รวม</td>
              <td className="px-2 py-2 text-right">{drTotal.toFixed(2)}</td>
              <td className="px-2 py-2 text-right">{crTotal.toFixed(2)}</td>
              <td colSpan={2}></td>
            </tr>
          </tbody>
        </table>
      </div>

      <Button variant="outline" size="sm" onClick={addLine}>
        <Plus className="w-4 h-4 mr-1" /> เพิ่มบรรทัด
      </Button>

      {issues.length > 0 && (
        <div className="rounded border border-destructive bg-destructive/10 p-3 space-y-1">
          {issues.map((iss, i) => (
            <div key={i} className="text-sm text-destructive flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span><strong>{iss.rule}:</strong> {iss.msg}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function getJournalIssues(lines: EditableJournalLine[]) {
  return validateClientSide(lines);
}
```

- [ ] **Step 2: Type-check passes**

```bash
./tools/check-types.sh web
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/other-income/components/EditableJournalTable.tsx
git commit -m "feat(other-income): EditableJournalTable with live V1/V2/V5 client-side validation

Mirrors server validation rules so users see issues before submitting.
Exports getJournalIssues() helper for parent component to disable POST button.

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §3.1"
```

---

## Task 5: Wire override toggle into OtherIncomeEntryPage

**Files:**
- Modify: `apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx`

The page currently auto-generates the JE preview. We add a toggle that opens `OverrideConfirmDialog`, swaps the preview for `EditableJournalTable`, disables POST when validation fails, and sends `{ override: true, overrideLines }` in the post mutation.

> **Read the existing file first** — locate the section that renders the journal preview and the POST mutation. Names of state variables, react-query hooks, and the post API call differ between codebases. Pattern below shows the SHAPE of changes — adapt to existing names.

- [ ] **Step 1: Add override state + dialog wiring**

Near the top of the component body (after existing `useState` hooks for the doc form), add:

```tsx
import { OverrideConfirmDialog } from './components/OverrideConfirmDialog';
import { EditableJournalTable, getJournalIssues, EditableJournalLine } from './components/EditableJournalTable';

// ...inside component:
const [overrideMode, setOverrideMode] = useState(false);
const [showOverrideDialog, setShowOverrideDialog] = useState(false);
const [overrideLines, setOverrideLines] = useState<EditableJournalLine[]>([]);
const [autoLinesSnapshot, setAutoLinesSnapshot] = useState<EditableJournalLine[]>([]);

const journalIssues = useMemo(
  () => (overrideMode ? getJournalIssues(overrideLines) : []),
  [overrideMode, overrideLines],
);
```

- [ ] **Step 2: Add the toggle UI near the auto journal preview section**

Locate the section that renders the auto-journal preview (search for "Auto Journal", "preview", "JournalPreview", or similar in the file). Just above that section, add:

```tsx
<div className="flex items-center gap-2 mb-2">
  <label className="flex items-center gap-2 text-sm cursor-pointer">
    <input
      type="checkbox"
      checked={overrideMode}
      onChange={(e) => {
        if (e.target.checked) {
          setShowOverrideDialog(true); // open dialog; actual toggle happens on confirm
        } else {
          setOverrideMode(false);
          setOverrideLines([]);
        }
      }}
    />
    <span>ใช้เอง (Override) — แก้ไข Journal Lines ด้วยตนเอง</span>
  </label>
</div>

<OverrideConfirmDialog
  open={showOverrideDialog}
  onConfirm={() => {
    // Snapshot current auto-generated lines as the editable baseline.
    // Replace `autoGeneratedJeLines` with the actual variable that holds
    // the auto JE preview in this file (e.g. `previewJournal` or similar).
    const snapshot: EditableJournalLine[] = autoGeneratedJeLines.map((l) => ({
      accountCode: l.accountCode,
      debit: Number(l.debit),
      credit: Number(l.credit),
      description: l.description ?? '',
    }));
    setAutoLinesSnapshot(snapshot);
    setOverrideLines(snapshot);
    setOverrideMode(true);
    setShowOverrideDialog(false);
  }}
  onCancel={() => setShowOverrideDialog(false)}
/>
```

> Replace `autoGeneratedJeLines` above with the actual variable name in the file that holds the auto preview lines (likely from a `useQuery` for `/other-income/:id/journal-preview` or computed in-component).

- [ ] **Step 3: Render EditableJournalTable when override mode is on**

Find the JSX block that renders the read-only journal preview. Wrap it conditionally:

```tsx
{overrideMode ? (
  <EditableJournalTable lines={overrideLines} onChange={setOverrideLines} />
) : (
  <ReadOnlyJournalPreview lines={autoGeneratedJeLines} /> /* keep existing preview component as-is */
)}
```

- [ ] **Step 4: Disable POST button + include override fields in mutation**

Find the POST button + its mutation (search for `postMutation`, `mutationFn.*post`, or the API call to `/other-income/:id/post`). Update:

```tsx
const postMutation = useMutation({
  mutationFn: (vars: { id: string }) =>
    api.post(`/other-income/${vars.id}/post`, {
      override: overrideMode,
      overrideLines: overrideMode
        ? overrideLines.map((l) => ({
            accountCode: l.accountCode,
            debit: l.debit,
            credit: l.credit,
            description: l.description,
          }))
        : undefined,
    }),
  onSuccess: () => {
    toast.success('บันทึกสำเร็จ');
    // existing onSuccess logic (invalidate queries, navigate, etc.)
  },
  onError: (err: any) => {
    const apiErrors = err?.response?.data?.errors;
    if (Array.isArray(apiErrors)) {
      apiErrors.forEach((e: any) => toast.error(`${e.rule}: ${e.msg}`));
    } else {
      toast.error(err?.response?.data?.message ?? 'เกิดข้อผิดพลาด');
    }
  },
});

// On the button:
<Button
  onClick={() => postMutation.mutate({ id: docId })}
  disabled={postMutation.isPending || (overrideMode && journalIssues.length > 0)}
>
  POST
</Button>
```

- [ ] **Step 5: Type-check**

```bash
./tools/check-types.sh web
```

Expected: 0 errors. If errors mention missing imports or unknown variable names, fix them — the previous steps used placeholder names where the existing code's names need to be substituted in.

- [ ] **Step 6: Manual smoke test**

```bash
cd apps/web && npm run dev
# Log in as a maker
# Create DRAFT OI → Entry page → check "ใช้เอง (Override)"
# Confirm dialog → checkbox + button enables → click
# Edit JV lines, introduce V1/V5 violation → POST disabled, errors shown
# Fix violations → POST enabled
# Click POST → success → reload list, expect ✏ marker (after Task 6)
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx
git commit -m "feat(other-income): override toggle + editable JV table in entry page

- Add 'ใช้เอง (Override)' checkbox that opens OverrideConfirmDialog
- On confirm, snapshot auto JE → editable lines
- Replace preview with EditableJournalTable (live V1/V2/V5 validation)
- POST button disabled when validation fails
- Send { override: true, overrideLines } in post mutation body

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §3.1"
```

---

## Task 6: ✏ marker on OtherIncomeListPage

**Files:**
- Modify: `apps/web/src/pages/other-income/OtherIncomeListPage.tsx`

- [ ] **Step 1: Locate doc-number column rendering**

Read `apps/web/src/pages/other-income/OtherIncomeListPage.tsx` and find where each row renders the `docNumber` (search for `docNumber` or `doc_no`).

- [ ] **Step 2: Add ✏ marker**

Replace the doc-number cell with:

```tsx
<span className="font-mono text-xs flex items-center gap-1">
  {doc.isOverridden && (
    <span
      className="text-amber-500"
      title="POST ด้วย Override JV — ตรวจ audit log"
      aria-label="Override JV"
    >
      ✏
    </span>
  )}
  {doc.docNumber}
</span>
```

Ensure the list API response includes `isOverridden`. If not, the backend `findMany` in `OtherIncomeService.list()` (or equivalent) must include it. Check; if missing, add `select: { isOverridden: true, ... }` to that query.

- [ ] **Step 3: Type-check**

```bash
./tools/check-types.sh web
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/other-income/OtherIncomeListPage.tsx \
        apps/api/src/modules/other-income/other-income.service.ts # if list() select had to be updated
git commit -m "feat(other-income): show ✏ marker in list for documents posted with Override JV

Ensures isOverridden is included in list response and renders an amber pencil
icon next to the doc number with a tooltip.

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §3.1 AC-1.5"
```

---

## Task 7: Render JV_OVERRIDDEN audit diff on view page

**Files:**
- Modify: `apps/web/src/pages/other-income/OtherIncomeViewPage.tsx`

- [ ] **Step 1: Locate audit log section**

Read `OtherIncomeViewPage.tsx`. Find where audit entries are rendered (search for `audit`, `AuditLog`, or `useQuery.*audit`).

- [ ] **Step 2: Add JV_OVERRIDDEN renderer**

In the audit entry rendering loop, when the entry's `action === 'JV_OVERRIDDEN'`, render the diff. Replace the row template with:

```tsx
{audit.action === 'JV_OVERRIDDEN' ? (
  <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-2">
    <div className="flex items-center gap-2">
      <span className="text-amber-600 text-xs font-semibold">JV_OVERRIDDEN</span>
      <span className="text-xs text-muted-foreground">
        {audit.user?.name ?? '—'} · {new Date(audit.createdAt).toLocaleString('th-TH')}
      </span>
    </div>
    <p className="text-sm italic">{(audit.newValue as any)?.diffSummary ?? '(ไม่มีสรุปการเปลี่ยนแปลง)'}</p>

    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        ดูรายละเอียดทั้งหมด
      </summary>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <div>
          <p className="font-semibold mb-1">Original (Auto)</p>
          <table className="w-full font-mono text-[10px]">
            <tbody>
              {(audit.oldValue as any)?.jvLines?.map((l: any, i: number) => (
                <tr key={i}>
                  <td>{l.accountCode}</td>
                  <td className="text-right">{Number(l.debit).toFixed(2)}</td>
                  <td className="text-right">{Number(l.credit).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <p className="font-semibold mb-1">Modified</p>
          <table className="w-full font-mono text-[10px]">
            <tbody>
              {(audit.newValue as any)?.jvLines?.map((l: any, i: number) => (
                <tr key={i}>
                  <td>{l.accountCode}</td>
                  <td className="text-right">{Number(l.debit).toFixed(2)}</td>
                  <td className="text-right">{Number(l.credit).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  </div>
) : (
  /* existing audit entry rendering */
)}
```

If the audit log fetch query doesn't currently include `oldValue` / `newValue` in its response shape, expand the API endpoint accordingly (likely `apps/api/src/modules/data-audit/data-audit.controller.ts`).

- [ ] **Step 3: Type-check + commit**

```bash
./tools/check-types.sh web
git add apps/web/src/pages/other-income/OtherIncomeViewPage.tsx
git commit -m "feat(other-income): render JV_OVERRIDDEN audit diff with collapsible details

Shows the Thai diff summary inline and expands to side-by-side original-vs-modified
JE tables on demand.

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §3.1 AC-1.4"
```

---

## Task 8: usePaginationParams hook

**Files:**
- Create: `apps/web/src/hooks/usePaginationParams.ts`
- Test: `apps/web/src/hooks/__tests__/usePaginationParams.test.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/web/src/hooks/__tests__/usePaginationParams.test.tsx`:

```tsx
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { usePaginationParams } from '../usePaginationParams';

function wrapper({ initial }: { initial: string }) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>;
  };
}

describe('usePaginationParams', () => {
  it('returns defaults when URL has no params', () => {
    const { result } = renderHook(() => usePaginationParams({ defaultSize: 50 }), {
      wrapper: wrapper({ initial: '/list' }),
    });
    expect(result.current.page).toBe(1);
    expect(result.current.size).toBe(50);
  });

  it('reads page + size from URL', () => {
    const { result } = renderHook(() => usePaginationParams({ defaultSize: 50 }), {
      wrapper: wrapper({ initial: '/list?page=3&size=20' }),
    });
    expect(result.current.page).toBe(3);
    expect(result.current.size).toBe(20);
  });

  it('setPage updates URL', () => {
    const { result } = renderHook(() => usePaginationParams({ defaultSize: 50 }), {
      wrapper: wrapper({ initial: '/list' }),
    });
    act(() => result.current.setPage(2));
    expect(result.current.page).toBe(2);
  });

  it('setSize resets page to 1', () => {
    const { result } = renderHook(() => usePaginationParams({ defaultSize: 50 }), {
      wrapper: wrapper({ initial: '/list?page=5&size=20' }),
    });
    act(() => result.current.setSize(100));
    expect(result.current.size).toBe(100);
    expect(result.current.page).toBe(1);
  });

  it('preserves other query params', () => {
    let location: ReturnType<typeof useLocation> | null = null;
    function Capture() { location = useLocation(); return null; }
    const { result } = renderHook(() => usePaginationParams({ defaultSize: 50 }), {
      wrapper: wrapper({ initial: '/list?status=READY&page=2' }),
    });
    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/web && npx vitest run src/hooks/__tests__/usePaginationParams.test.tsx
```

- [ ] **Step 3: Implement hook**

Create `apps/web/src/hooks/usePaginationParams.ts`:

```ts
import { useSearchParams } from 'react-router-dom';
import { useCallback, useMemo } from 'react';

type Options = {
  defaultPage?: number;
  defaultSize?: number;
};

export function usePaginationParams(options: Options = {}) {
  const { defaultPage = 1, defaultSize = 50 } = options;
  const [searchParams, setSearchParams] = useSearchParams();

  const page = useMemo(() => {
    const raw = Number(searchParams.get('page'));
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : defaultPage;
  }, [searchParams, defaultPage]);

  const size = useMemo(() => {
    const raw = Number(searchParams.get('size'));
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : defaultSize;
  }, [searchParams, defaultSize]);

  const setPage = useCallback((nextPage: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', String(nextPage));
      return next;
    });
  }, [setSearchParams]);

  const setSize = useCallback((nextSize: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('size', String(nextSize));
      next.set('page', '1'); // reset to first page on size change
      return next;
    });
  }, [setSearchParams]);

  return { page, size, setPage, setSize };
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd apps/web && npx vitest run src/hooks/__tests__/usePaginationParams.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/usePaginationParams.ts \
        apps/web/src/hooks/__tests__/usePaginationParams.test.tsx
git commit -m "feat(web): usePaginationParams hook — URL-driven page + size

setSize resets page to 1 (PDF AC-5.6). Preserves other URL params. 5 tests.

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §3.2"
```

---

## Task 9: PaginationBar component

**Files:**
- Create: `apps/web/src/components/ui/PaginationBar.tsx`
- Test: `apps/web/src/components/ui/__tests__/PaginationBar.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `apps/web/src/components/ui/__tests__/PaginationBar.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PaginationBar } from '../PaginationBar';

describe('PaginationBar', () => {
  const props = (overrides = {}) => ({
    total: 247,
    page: 3,
    size: 50,
    onPageChange: vi.fn(),
    onSizeChange: vi.fn(),
    ...overrides,
  });

  it('shows "แสดง X-Y จาก Z รายการ"', () => {
    render(<PaginationBar {...props()} />);
    expect(screen.getByText(/แสดง 101-150 จาก 247 รายการ/)).toBeInTheDocument();
  });

  it('shows last partial range correctly', () => {
    render(<PaginationBar {...props({ page: 5, size: 50, total: 247 })} />);
    expect(screen.getByText(/แสดง 201-247 จาก 247 รายการ/)).toBeInTheDocument();
  });

  it('disables Prev/First on page 1', () => {
    render(<PaginationBar {...props({ page: 1 })} />);
    expect(screen.getByRole('button', { name: /First/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Prev/i })).toBeDisabled();
  });

  it('disables Next/Last on final page', () => {
    render(<PaginationBar {...props({ page: 5, size: 50, total: 247 })} />);
    expect(screen.getByRole('button', { name: /Next/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Last/i })).toBeDisabled();
  });

  it('calls onPageChange when numeric page clicked', () => {
    const onPageChange = vi.fn();
    render(<PaginationBar {...props({ onPageChange })} />);
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it('calls onSizeChange when page-size selector changes', () => {
    const onSizeChange = vi.fn();
    render(<PaginationBar {...props({ onSizeChange })} />);
    // shadcn Select uses role=combobox or similar — adapt to actual impl
    const select = screen.getByLabelText(/แสดงต่อหน้า/i);
    fireEvent.change(select, { target: { value: '100' } });
    expect(onSizeChange).toHaveBeenCalledWith(100);
  });

  it('jump-to-page input invokes onPageChange on Enter', () => {
    const onPageChange = vi.fn();
    render(<PaginationBar {...props({ onPageChange })} />);
    const input = screen.getByPlaceholderText(/ไปหน้า/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPageChange).toHaveBeenCalledWith(4);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/web && npx vitest run src/components/ui/__tests__/PaginationBar.test.tsx
```

- [ ] **Step 3: Implement PaginationBar**

Create `apps/web/src/components/ui/PaginationBar.tsx`:

```tsx
import { useState } from 'react';
import { Button } from './button';
import { Input } from './input';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

type Props = {
  total: number;
  page: number;
  size: number;
  sizeOptions?: number[];
  onPageChange: (page: number) => void;
  onSizeChange: (size: number) => void;
};

function pagesAround(current: number, total: number, span = 5): number[] {
  if (total <= span) return Array.from({ length: total }, (_, i) => i + 1);
  let start = Math.max(1, current - Math.floor(span / 2));
  const end = Math.min(total, start + span - 1);
  start = Math.max(1, end - span + 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export function PaginationBar({
  total,
  page,
  size,
  sizeOptions = [20, 50, 100],
  onPageChange,
  onSizeChange,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / size));
  const start = total === 0 ? 0 : (page - 1) * size + 1;
  const end = Math.min(page * size, total);
  const [jumpValue, setJumpValue] = useState('');

  const handleJump = () => {
    const n = Number(jumpValue);
    if (Number.isFinite(n) && n >= 1 && n <= totalPages) {
      onPageChange(Math.floor(n));
      setJumpValue('');
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap py-2 text-sm">
      <span className="text-muted-foreground">
        แสดง {start.toLocaleString()}-{end.toLocaleString()} จาก {total.toLocaleString()} รายการ
      </span>

      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" aria-label="First" onClick={() => onPageChange(1)} disabled={page === 1}>
          <ChevronsLeft className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="sm" aria-label="Prev" onClick={() => onPageChange(page - 1)} disabled={page === 1}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        {pagesAround(page, totalPages).map((p) => (
          <Button
            key={p}
            variant={p === page ? 'default' : 'ghost'}
            size="sm"
            onClick={() => onPageChange(p)}
            aria-current={p === page ? 'page' : undefined}
            aria-label={String(p)}
          >
            {p}
          </Button>
        ))}
        <Button variant="ghost" size="sm" aria-label="Next" onClick={() => onPageChange(page + 1)} disabled={page === totalPages}>
          <ChevronRight className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="sm" aria-label="Last" onClick={() => onPageChange(totalPages)} disabled={page === totalPages}>
          <ChevronsRight className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Input
          className="w-16 h-8 text-sm"
          placeholder="ไปหน้า"
          value={jumpValue}
          onChange={(e) => setJumpValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleJump()}
        />
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          แสดงต่อหน้า:
          <select
            aria-label="แสดงต่อหน้า"
            value={size}
            onChange={(e) => onSizeChange(Number(e.target.value))}
            className="border border-border bg-background rounded px-1 py-0.5 text-sm"
          >
            {sizeOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd apps/web && npx vitest run src/components/ui/__tests__/PaginationBar.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/PaginationBar.tsx \
        apps/web/src/components/ui/__tests__/PaginationBar.test.tsx
git commit -m "feat(web): PaginationBar — shared pagination UI with first/prev/numeric/next/last + jump + size

7 tests covering range display, disabled states, click handlers, size selector,
jump-to-page Enter key.

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §3.2"
```

---

## Task 10: Migrate OtherIncomeListPage to PaginationBar + URL params

**Files:**
- Modify: `apps/web/src/pages/other-income/OtherIncomeListPage.tsx`

- [ ] **Step 1: Read the existing pagination code**

Read [OtherIncomeListPage.tsx](../../../apps/web/src/pages/other-income/OtherIncomeListPage.tsx) — locate the existing `page` state (currently local, not URL-driven) around lines 112-122 per the survey, and the existing Next/Prev buttons.

- [ ] **Step 2: Replace local state with usePaginationParams**

At the top of the component, replace existing pagination state:

```tsx
// REMOVE: const [page, setPage] = useState(1);
// ADD:
import { usePaginationParams } from '@/hooks/usePaginationParams';
import { PaginationBar } from '@/components/ui/PaginationBar';

// inside component:
const sortDir = filter.status === 'READY' ? 'asc' : 'desc'; // PDF AC-5: READY filter sorts oldest first
const { page, size, setPage, setSize } = usePaginationParams({ defaultSize: 50 });
```

- [ ] **Step 3: Pass `size` to the list query**

Find the `useQuery` call that fetches the list. Pass `size` instead of the hardcoded `limit: 50`:

```tsx
useQuery({
  queryKey: ['other-income', { page, size, ...filter }],
  queryFn: () => api.get('/other-income', { params: { page, limit: size, ...filter, sort: `createdAt:${sortDir}` } }),
});
```

> Check the API to confirm the backend expects `limit` or `size` — adapt accordingly. If the API only takes `limit`, keep the param name `limit` in the request but the URL param remains `size`.

- [ ] **Step 4: Reset page on filter change**

In the existing filter handler (search status, date range, etc.), call `setPage(1)` whenever a filter changes — AC-5.6.

- [ ] **Step 5: Replace old Next/Prev buttons with PaginationBar**

Find the existing Next/Prev buttons block and replace with:

```tsx
<PaginationBar
  total={listData?.total ?? 0}
  page={page}
  size={size}
  onPageChange={setPage}
  onSizeChange={setSize}
/>
```

- [ ] **Step 6: Backend — ensure `total` is in the list response**

Verify `OtherIncomeService.list()` returns `{ data, total, page, limit }`. If only `data` is returned, add a `count()` call and wrap the response. Most NestJS list endpoints in this repo already follow this pattern — check by reading the existing `list()` method.

- [ ] **Step 7: Type-check + manual smoke test**

```bash
./tools/check-types.sh web
cd apps/web && npm run dev
# Visit /other-income → see PaginationBar
# Click page 3 → URL shows ?page=3
# Change size → URL shows ?size=100, page resets to 1
# Reload browser → still on the same page
# Apply a filter → page resets to 1
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/other-income/OtherIncomeListPage.tsx \
        apps/api/src/modules/other-income/other-income.service.ts # if list() needed total wrapping
git commit -m "feat(other-income): migrate list page to URL-driven PaginationBar

- Page + size now in URL params (bookmarkable per PDF AC-5.5)
- Filter changes reset page to 1 (AC-5.6)
- READY filter sorts oldest first (PDF spec table)

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §3.2"
```

---

## Task 11: Migrate OtherIncomePendingApprovalPage + ExpensesPage + AuditLogsPage

**Files:**
- Modify: `apps/web/src/pages/other-income/OtherIncomePendingApprovalPage.tsx`
- Modify: `apps/web/src/pages/ExpensesPage.tsx`
- Modify: `apps/web/src/pages/AuditLogsPage.tsx`

The pattern is identical to Task 10. Repeat for each.

- [ ] **Step 1: Migrate OtherIncomePendingApprovalPage**

```tsx
// At top of component:
const { page, size, setPage, setSize } = usePaginationParams({ defaultSize: 50 });

// In the useQuery, pass page + size and sort=createdAt:asc (oldest first per PDF)

// Replace existing pagination with:
<PaginationBar
  total={data?.total ?? 0}
  page={page}
  size={size}
  onPageChange={setPage}
  onSizeChange={setSize}
/>
```

- [ ] **Step 2: Migrate ExpensesPage (default size 20 → 50)**

Same pattern, with `defaultSize: 50`. Remove the old `page` searchParam handling — `usePaginationParams` replaces it.

- [ ] **Step 3: Migrate AuditLogsPage (default size 25 → 100)**

Same pattern, with `defaultSize: 100`.

- [ ] **Step 4: Type-check + smoke test each page**

```bash
./tools/check-types.sh web
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/other-income/OtherIncomePendingApprovalPage.tsx \
        apps/web/src/pages/ExpensesPage.tsx \
        apps/web/src/pages/AuditLogsPage.tsx
git commit -m "feat(web): migrate Pending/Expenses/AuditLogs to shared PaginationBar

- OtherIncomePendingApprovalPage: size 50, sort createdAt ASC (oldest first)
- ExpensesPage: size 20 → 50 (PDF spec)
- AuditLogsPage: size 25 → 100 (PDF spec)

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §3.2"
```

---

## Task 12: DB indexes for pagination performance

**Files:**
- Create: `apps/api/prisma/migrations/<timestamp>_add_pagination_indexes/migration.sql`

- [ ] **Step 1: Check current indexes**

Open `apps/api/prisma/schema.prisma` and grep `model OtherIncome`, `model Expense`, `model AuditLog`. For each:
- Confirm or add `@@index([status, createdAt])` (OtherIncome, Expense)
- Confirm or add `@@index([createdAt(sort: Desc)])` (AuditLog — but its existing single-key index may suffice; verify with EXPLAIN)

- [ ] **Step 2: Generate the migration**

```bash
cd apps/api && npx prisma migrate dev --name add_pagination_indexes --create-only
```

This produces a `migration.sql` skeleton. Edit it to contain only `CREATE INDEX IF NOT EXISTS ...` statements for the new indexes (drop any unrelated DDL that Prisma may have generated).

- [ ] **Step 3: Apply locally and verify**

```bash
cd apps/api && npx prisma migrate dev
```

Run `EXPLAIN ANALYZE SELECT * FROM other_incomes WHERE status='POSTED' ORDER BY created_at DESC LIMIT 50` in a dev DB shell — confirm the new index is used.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/migrations/ apps/api/prisma/schema.prisma
git commit -m "perf(db): add (status, createdAt) compound indexes for pagination

Used by OtherIncome + Expense list queries. AuditLog already has createdAt index.
Verified via EXPLAIN ANALYZE — index scan instead of seq scan.

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §3.2"
```

---

## Task 13: Performance budget test

**Files:**
- Create: `apps/api/src/modules/other-income/__tests__/pagination-perf.spec.ts`

- [ ] **Step 1: Write the test**

Create `apps/api/src/modules/other-income/__tests__/pagination-perf.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { OtherIncomeService } from '../other-income.service';

// This test seeds 10,000 OtherIncome rows and asserts list query < 200ms.
// SKIP it in CI unless PERF=1 env var is set, to keep regular test runs fast.

describe.skip('Pagination performance — gated by PERF=1', () => {
  let prisma: PrismaService;
  let service: OtherIncomeService;

  beforeAll(async () => {
    if (!process.env.PERF) return;
    // bootstrap NestJS test module (mirror existing test setup patterns from other spec files)
    const mod = await Test.createTestingModule({ providers: [/* ... */] }).compile();
    prisma = mod.get(PrismaService);
    service = mod.get(OtherIncomeService);

    // Seed
    const rows = Array.from({ length: 10_000 }, (_, i) => ({
      docNumber: `PERF-${i.toString().padStart(6, '0')}`,
      // ... mandatory fields, copy from existing test fixtures
    }));
    await prisma.otherIncome.createMany({ data: rows, skipDuplicates: true });
  });

  it('lists page 1 (size 50) in < 200ms', async () => {
    if (!process.env.PERF) return;
    const start = Date.now();
    await service.list({ page: 1, limit: 50 });
    const ms = Date.now() - start;
    expect(ms).toBeLessThan(200);
  });

  it('lists page 100 (size 50) in < 200ms', async () => {
    if (!process.env.PERF) return;
    const start = Date.now();
    await service.list({ page: 100, limit: 50 });
    const ms = Date.now() - start;
    expect(ms).toBeLessThan(200);
  });
});
```

> The test is `describe.skip`'d by default — run manually with `PERF=1 npx jest pagination-perf` when investigating performance. Adapt the test module setup to mirror the surrounding spec files in the same folder.

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/modules/other-income/__tests__/pagination-perf.spec.ts
git commit -m "test(other-income): performance budget — list <200ms with 10k rows

Skipped by default; run with PERF=1 to validate index effectiveness.

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §3.2 + §7.5"
```

---

## Task 14: E2E test — override flow

**Files:**
- Create: `apps/web/e2e/other-income-override-jv.spec.ts`

- [ ] **Step 1: Write the spec**

Create `apps/web/e2e/other-income-override-jv.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('Other Income — Override JV', () => {
  test.beforeEach(async ({ page }) => {
    // Reuse repo's existing login helper / auth setup pattern.
    // See apps/web/e2e/login.spec.ts for the established login pattern.
    await page.goto('/login');
    await page.fill('input[name=email]', 'admin@bestchoice.com');
    await page.fill('input[name=password]', 'admin1234');
    await page.click('button[type=submit]');
    await page.waitForURL('/');
  });

  test('creates DRAFT, toggles override, edits JV, POSTs, sees ✏ marker', async ({ page }) => {
    // Step 1: create a DRAFT OtherIncome via UI (or via API if a helper exists)
    await page.goto('/other-income/new');
    // ... fill form (use existing test fixture data — adapt to actual form fields)

    // Step 2: navigate to the entry page (POST/preview view)
    await page.click('button:has-text("บันทึกร่าง")');
    await page.waitForURL(/\/other-income\/[a-f0-9-]+/);

    // Step 3: toggle override
    await page.check('input[type=checkbox]:near(:text("ใช้เอง (Override)"))');
    await expect(page.getByText('คุณกำลังจะแก้ไข Auto Journal')).toBeVisible();
    await page.check('input[type=checkbox]:near(:text("ฉันเข้าใจ"))');
    await page.click('button:has-text("เปิดโหมดแก้ไข")');

    // Step 4: introduce a V1 violation
    const firstDrInput = page.locator('input[type=number]').first();
    await firstDrInput.fill('999999');
    await expect(page.getByText(/V1:.*Dr.*≠.*Cr/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'POST' })).toBeDisabled();

    // Step 5: fix → POST → success
    await firstDrInput.fill('1000'); // restore balance
    await expect(page.getByRole('button', { name: 'POST' })).toBeEnabled();
    await page.getByRole('button', { name: 'POST' }).click();
    await expect(page.getByText(/บันทึกสำเร็จ|POSTED/)).toBeVisible();

    // Step 6: verify ✏ marker on list page
    await page.goto('/other-income');
    await expect(page.locator('text=✏').first()).toBeVisible();
  });
});
```

- [ ] **Step 2: Run**

```bash
cd apps/web && npx playwright test e2e/other-income-override-jv.spec.ts
```

Iterate selectors as needed to match the actual UI. Use `--headed` to debug interactively.

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/other-income-override-jv.spec.ts
git commit -m "test(e2e): override JV flow — toggle, validate, POST, ✏ marker

Covers AC-1.1 through AC-1.7 from the PDF spec.

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §7.4"
```

---

## Task 15: Update accounting rules doc

**Files:**
- Modify: `.claude/rules/accounting.md`

- [ ] **Step 1: Add Override JV audit pattern**

In `.claude/rules/accounting.md`, append a new section under "## Other Income Module" describing the override JV mechanism:

```markdown
### Override JV (manual JE edit before POST)

`POST /other-income/:id/post` accepts optional `{ override: true, overrideLines: [...] }`. When provided:
- Server validates V1 (Dr=Cr ±0.01), V2 (≥2 lines), V5 (Dr XOR Cr per line) via `JournalOverrideService`
- Sets `OtherIncome.isOverridden = true`
- Writes `AuditLog { action: 'JV_OVERRIDDEN', oldValue: { jvLines: <auto> }, newValue: { jvLines: <override>, diffSummary: <Thai> } }`
- UI shows ✏ marker in list pages for these documents

Audit `JV_OVERRIDDEN` action string — no Prisma enum (AuditLog.action is plain String).
```

- [ ] **Step 2: Commit**

```bash
git add .claude/rules/accounting.md
git commit -m "docs(accounting): document Override JV mechanism + audit pattern

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §6.1"
```

---

## Task 16: Final verification

- [ ] **Step 1: Full type check**

```bash
./tools/check-types.sh all
```

Expected: 0 errors.

- [ ] **Step 2: Full API test suite**

```bash
cd apps/api && npx jest
```

Expected: all tests pass. Pay special attention to the existing maker-checker.spec.ts tests — they may need adjustments if other-income.service.ts post() shape changed materially.

- [ ] **Step 3: Full web test suite**

```bash
cd apps/web && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 4: E2E smoke**

```bash
cd apps/web && npx playwright test e2e/other-income-override-jv.spec.ts e2e/login.spec.ts
```

- [ ] **Step 5: Manual UAT (suggested set)**

From PDF AC checklist Sprint 1:
- [ ] AC-1.1 — Override Dr=1000, Cr=999 → POST disabled + V1 error
- [ ] AC-1.2 — delete lines until 1 → POST disabled + V2 error
- [ ] AC-1.3 — line has both Dr+Cr → POST disabled + V5 error
- [ ] AC-1.4 — POST success → audit log has original + modified + diffSummary
- [ ] AC-1.5 — list page shows ✏ marker
- [ ] AC-1.6 — confirm dialog before override mode
- [ ] AC-1.7 — live validation shows errors while editing
- [ ] AC-5.1 — list shows PaginationBar
- [ ] AC-5.2 — Next → ?page=2 in URL
- [ ] AC-5.3 — size change → URL updates + page resets
- [ ] AC-5.4 — jump to page 5 → goes there
- [ ] AC-5.5 — reload browser stays on same page
- [ ] AC-5.6 — filter change resets page to 1
- [ ] AC-5.7 — total count correct
- [ ] AC-5.8 — query < 200ms (run perf test with PERF=1)

- [ ] **Step 6: Open PR**

```bash
git checkout -b feat/other-income-v2-2-pr1-override-jv-pagination
git push -u origin feat/other-income-v2-2-pr1-override-jv-pagination
gh pr create --title "feat(other-income): v2.2 PR-1 — Override JV V1/V2/V5 + Pagination" --body "$(cat <<'EOF'
## Summary
- Override JV — V1/V2/V5 validation + isOverridden flag + JV_OVERRIDDEN audit + ✏ marker
- Shared PaginationBar + usePaginationParams hook — URL-driven, bookmarkable
- Migrated 4 list pages: OtherIncome list, Pending Approval, Expenses, AuditLogs

Implements PDF v2.2 Sprint 1 (Tasks 1 + 5). See [design spec](docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md) §3 + §7.

## Test plan
- [ ] AC-1.1 through AC-1.7 (override JV validation flow)
- [ ] AC-5.1 through AC-5.7 (pagination URL params + UI)
- [ ] AC-5.8 perf budget — `PERF=1 npx jest pagination-perf`
- [ ] E2E `other-income-override-jv.spec.ts` green
- [ ] Existing test suites still pass

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review (post-write check)

**Spec coverage:**
- §3.1 Task 1 Override JV: Tasks 1, 2, 3, 4, 5, 6, 7 ✓
- §3.2 Task 5 Pagination: Tasks 8, 9, 10, 11, 12, 13 ✓
- §6.1 Audit conventions: Task 2 (entity lowercase, real userId), Task 15 docs ✓
- §6.4 Decimal precision: Task 1 uses `Prisma.Decimal` throughout ✓
- §7.1-§7.5 Testing: Tasks 1, 2, 3, 8, 9, 13, 14 ✓
- AC-1.1 through AC-5.8: Task 16 manual UAT ✓

**Placeholder scan:** No "TBD" — but Tasks 5 and 10 contain "Replace `autoGeneratedJeLines` with the actual variable name" instructions. These are explicit "verify against existing code" notes, not placeholders. Acceptable — the engineer must read the file before editing it.

**Type consistency:** `OverrideLine.debit` / `credit` are `Decimal` in API but `number` in UI (`EditableJournalLine`). The post() body explicitly converts via `new D(l.debit)`. ✓

**Out of scope reminder:** This PR is Sprint 1 only. Sprint 2 (Maker-Checker UI + Reopen Period) and Sprint 3 (Settings 5-tab consolidation) are separate plans to be written after PR-1 ships.
