# Employee Master — PR-C (Payroll Link) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the last free-text "person" hole — wire `PayrollLine` to a real `User` FK, server-derive the name/taxId snapshot from the chosen employee, and replace the free-text "ชื่อ" input in the payroll form with an `EmployeeCombobox` that pre-fills base salary + SSO. Historical free-text rows keep working; the payroll JE must not change.

**Architecture:** One PR, backend-first then frontend. Backend adds a nullable `PayrollLine.userId` FK + migration, and makes `ExpenseDocumentsService.createPayroll` derive the snapshot (`employeeName`, `employeeTaxId`) from the linked active employee instead of trusting the client. A tiny read endpoint `GET /sso-config/effective` exposes the period-effective SSO cap so the form can pre-fill SSO correctly. Frontend adds `employeesApi.pickable` + a no-inline-create `EmployeeCombobox` (mirrors `ContactCombobox`), wires it into `PayrollLinesSection`, and forwards `userId` in the POST body. The JE template (`payroll.template.ts`) is untouched — an anti-regression test proves the JE is byte-identical with vs without `userId`.

**Tech Stack:** Backend — NestJS + Prisma + PostgreSQL; tests jest (`npm --prefix apps/api test -- --runInBand <path>`). Frontend — React + TS + Vite + Tailwind + shadcn/ui + @tanstack/react-query; tests vitest (`npm --prefix apps/web run test -- <path>`). Typecheck `./tools/check-types.sh api|web`.

**Spec (source of truth):** `docs/superpowers/specs/2026-06-04-employee-master-design.md` §2.3 (PayrollLine FK), §3.2 (payroll picker/pre-fill), §4.2 (server-derive snapshot), §4.3 (JE unchanged), §6 (tests), §7 (edge cases).

---

## ⚠️ Branch point & dependencies (READ FIRST)

- **Branch:** `feat/payroll-employee-link` off **`main`**.
- **DO NOT START until BOTH are merged to main:**
  - **#1151 (PR-A backend)** — provides `EmployeeProfile` schema/migration + `employees` module (`/employees/pickable`). Backend tasks (1–5) need this to compile.
  - **#1152 (PR-B frontend)** — provides `apps/web/src/lib/api/employees.ts` (the `employeesApi`/`employeeKeys` this PR *extends* with `pickable`). Frontend tasks (6–9) need this file to exist.
- Verify before branching: `gh pr view 1151 --json state,mergedAt` and `gh pr view 1152 --json state,mergedAt` both `MERGED`; then `git fetch origin && git switch -c feat/payroll-employee-link origin/main`.
- After merge, the migration is applied in prod via `npx prisma migrate deploy` (additive, nullable — safe).

## Spec deviations & decisions (confirm in scrutinize before merge)

- **D1 — SSO pre-fill cap (deviates from spec §3.2 literal `750`). ✅ Owner-confirmed 2026-06-05 — KEEP the SSO pre-fill + the `GET /sso-config/effective` endpoint (Tasks 5/6/8).** The codebase moved the SSO cap out of a hardcoded `750` into the period-effective `sso_config` table (`maxContribution` = **875** in 2569/2026+, 1000 in 2572+, 1150 in 2575+; `SsoConfigService.validateContribution` rejects over-cap on submit). Pre-filling the stale `750` would under-fill mid earners AND a stale literal drifts. This plan pre-fills `SSO = round2(min(base, salaryCeiling) × 5%)` using the live period cap, fetched via a new read-only `GET /sso-config/effective` endpoint. This keeps the default correct over time and never trips the server cap-validation. _Rejected alternative:_ pre-fill uncapped `round2(base×5%)` — fails server validation for `base > salaryCeiling` (≥17,500 in 2569), making "pre-fill" actively harmful for higher earners.
- **D2 — `employeeName` becomes optional in the DTO.** Spec §4.2: "ถ้าไม่มี userId → ต้องมี employeeName". So `employeeName` is required only when `userId` is absent; this rule moves to the service. When `userId` IS present, the server **overrides** any client-sent `employeeName`/`employeeTaxId` from the registry (integrity — don't trust client snapshot). The existing `create-payroll.dto.spec.ts` does not assert employeeName-required, so this does not break current DTO tests.
- **D3 — One PR, FE+BE.** Tasks 1–5 (backend) depend on #1151; tasks 6–9 (frontend) depend on #1152. Because both prerequisites merge close together (deploy order #1151 → migrate → #1152), bundling is fine. If for some reason #1152 is NOT yet merged when starting, create `employees.ts` first (copy PR-B's Task 1) — but normal path assumes it exists.
- **D4 — PII: mask `employeeTaxId` (= nationalId) for non-cleared roles on BOTH the create response AND the read path (F1, from scrutinize; owner: "เก็บกวาดให้สุด" 2026-06-05).** _AMENDED during implementation (owner decision 2026-06-05): the un-mask set is **OWNER / ACCOUNTANT / FINANCE_MANAGER** — FM is PII-cleared because they file PND1 (which already exposes the full national IDs). The authoritative behavior is in the code; the illustrative code blocks below that show `OWNER || ACCOUNTANT` predate this amendment._ The snapshot taxId === the employee's `nationalId`; OWNER/ACCOUNTANT/FINANCE_MANAGER see it full, BRANCH_MANAGER (and other roles) get it masked via the shared `maskPayrollTaxIds` helper — applied in `createPayroll`'s response (Step 3b) and in `findOne` / `GET /expense-documents/:id` (Step 3c–3e). Otherwise a draft payroll OR a payroll-detail GET becomes a way to enumerate national IDs around PR-A's PII gate. `list` exposes no payroll lines (safe). The STORED value stays full (for ภงด.1).

**Scrutinize fixes applied (2026-06-05):** F1 (PII mask — Task 3 Step 3b), F3 (taxId column always read-only — `ExpenseFormV4` verified create-only — Task 8 4f), F4 (migration timestamp derived from latest-on-main, not a hardcoded literal — Task 1 Step 3), F5 (SSO pre-fill fires only when the period cap has loaded; never auto-fills an uncapped value — Task 8 4b). F6 (duplicate `userId` across lines in one doc is not constrained) — **accepted** (JE sums correctly); optional future UI guard.

---

## File Structure

**Backend (apps/api):**
- Modify `prisma/schema.prisma` — `PayrollLine.userId` (nullable FK, `onDelete: SetNull`) + `@@index([userId])`; add back-relation `payrollLines PayrollLine[]` on `User`.
- Create `prisma/migrations/20260970000000_add_payroll_line_user_fk/migration.sql` — additive nullable column + index + FK.
- Modify `src/modules/expense-documents/dto/create-payroll.dto.ts` — add `userId?` to `PayrollLineInput`; make `employeeName` optional.
- Modify `src/modules/expense-documents/expense-documents.service.ts` — `createPayroll`: resolve linked active employees, derive snapshot, persist `userId`, guard "neither userId nor employeeName"; `findOne`: accept viewer role + mask taxId; add private `maskPayrollTaxIds` helper (PII, shared by create + read).
- Modify `src/modules/expense-documents/expense-documents.controller.ts` — `findOne` forwards the viewer role to the service (PII read-mask).
- Create `src/modules/sso-config/sso-config.controller.ts` — `GET /sso-config/effective`.
- Modify `src/modules/sso-config/sso-config.module.ts` — register the controller.
- Create `src/modules/expense-documents/__tests__/payroll-user-link.service.spec.ts` — derive/validate/legacy tests.
- Modify `src/modules/expense-documents/__tests__/create-payroll.dto.spec.ts` — `userId` shape cases.
- Modify `src/modules/expense-documents/__tests__/payroll.template.spec.ts` — JE anti-regression (userId-agnostic).
- Create `src/modules/sso-config/__tests__/sso-config.controller.spec.ts` — endpoint test.

**Frontend (apps/web):**
- Modify `src/lib/api/employees.ts` — add `PickableEmployee` type, `employeeKeys.pickable`, `employeesApi.pickable`.
- Create `src/lib/api/ssoConfig.ts` — `ssoConfigApi.effective` + `ssoConfigKeys` + type.
- Create `src/components/employees/EmployeeCombobox.tsx` — no-inline-create picker (mirrors `ContactCombobox`).
- Modify `src/components/expense-form-v4/types.ts` — add `userId` to `PayrollLineForm`; default in `newPayrollLine`.
- Modify `src/components/expense-form-v4/PayrollLinesSection.tsx` — replace name input with `EmployeeCombobox`; pre-fill base/SSO; taxId becomes read-only placeholder when linked.
- Modify `src/components/expense-form-v4/ExpenseFormV4.tsx` — forward `userId` in the payroll POST body.
- Create `src/components/employees/__tests__/EmployeeCombobox.test.tsx`.
- Create `src/components/expense-form-v4/__tests__/PayrollLinesSection.test.tsx`.

---

## Task 1: Schema + migration — `PayrollLine.userId`

**Files:** Modify `apps/api/prisma/schema.prisma`; Create `apps/api/prisma/migrations/20260970000000_add_payroll_line_user_fk/migration.sql`

- [ ] **Step 1: Add the FK fields to `PayrollLine`.** In `apps/api/prisma/schema.prisma`, inside `model PayrollLine { ... }`, add the `userId`/`user` fields after `employeeTaxId` and the index in the `@@` block. The model becomes:

```prisma
model PayrollLine {
  id              String                   @id @default(uuid())
  payrollId       String                   @map("payroll_id")
  payroll         PayrollDetail            @relation(fields: [payrollId], references: [documentId], onDelete: Cascade)
  userId          String?                  @map("user_id")
  user            User?                    @relation(fields: [userId], references: [id], onDelete: SetNull)
  employeeName    String                   @map("employee_name")
  employeeTaxId   String?                  @map("employee_tax_id")
  baseSalary      Decimal                  @map("base_salary") @db.Decimal(12, 2)
  ssoEmployee     Decimal                  @default(0) @map("sso_employee") @db.Decimal(12, 2)
  whtAmount       Decimal                  @default(0) @map("wht_amount") @db.Decimal(12, 2)
  netPaid         Decimal                  @map("net_paid") @db.Decimal(12, 2)
  customIncome    PayrollCustomIncome[]
  customDeduction PayrollCustomDeduction[]
  createdAt       DateTime                 @default(now()) @map("created_at")
  updatedAt       DateTime                 @updatedAt @map("updated_at")

  @@index([payrollId])
  @@index([userId])
  @@map("payroll_lines")
}
```

> `employeeName`/`employeeTaxId` stay — they are historical snapshots (spec §2.3). `userId` is nullable so legacy rows and the SET NULL on user delete are both valid.

- [ ] **Step 2: Add the back-relation on `User`.** In `model User { ... }`, next to the existing `employeeProfile EmployeeProfile?` line (added by PR-A), add:

```prisma
  payrollLines    PayrollLine[]
```

- [ ] **Step 3: Author the migration.** Try the generator first in a clean env:

Run: `npm --prefix apps/api run prisma:migrate -- --name add_payroll_line_user_fk`
Expected: a new folder `prisma/migrations/20260970000000_add_payroll_line_user_fk/` with the SQL below.

If the dev DB is drifted / the command is non-interactive (same situation as PR-A's hand-authored migration — see handoff), create the folder + file by hand at `apps/api/prisma/migrations/20260970000000_add_payroll_line_user_fk/migration.sql` with EXACTLY:

```sql
-- AlterTable
ALTER TABLE "payroll_lines" ADD COLUMN "user_id" TEXT;

-- CreateIndex
CREATE INDEX "payroll_lines_user_id_idx" ON "payroll_lines"("user_id");

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

> **Timestamp (F4):** prefer the generator's auto-stamp. If hand-authoring, the folder timestamp MUST sort AFTER the latest migration already on `main` at branch time — not merely after PR-A's. Compute it: `ls -1 apps/api/prisma/migrations | sort | tail -1`, then use a strictly-greater 14-digit stamp (that value + 1, or `date -u +%Y%m%d%H%M%S`). The `20260970000000` in the paths above is a PLACEHOLDER — replace it everywhere (folder name + Step 5 commit) with your computed stamp.

- [ ] **Step 4: Regenerate the Prisma client + typecheck.**

Run: `npm --prefix apps/api run prisma:generate && ./tools/check-types.sh api`
Expected: OK (the new `userId` field is now on the `PayrollLine` type).

- [ ] **Step 5: Commit.**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260970000000_add_payroll_line_user_fk
git commit -m "feat(payroll): add PayrollLine.userId nullable FK + migration (PR-C)"
```

---

## Task 2: DTO — `userId` on `PayrollLineInput`, `employeeName` optional

**Files:** Modify `apps/api/src/modules/expense-documents/dto/create-payroll.dto.ts`; Test `apps/api/src/modules/expense-documents/__tests__/create-payroll.dto.spec.ts`

- [ ] **Step 1: Write the failing tests.** Append to `create-payroll.dto.spec.ts` inside the existing `describe('CreatePayrollDto — shape validation', ...)` block (the `baseDto` helper already injects a `lines[0]` with `employeeName` + `baseSalary`; we override per-case):

```typescript
  it('accepts a line with userId and no employeeName (server will derive)', async () => {
    const errors = await validateDto(
      baseDto({ employeeName: undefined, userId: '11111111-1111-1111-1111-111111111111' }),
    );
    expect(errors).toEqual([]);
  });

  it('accepts a legacy line with employeeName and no userId', async () => {
    const errors = await validateDto(baseDto({})); // baseDto already has employeeName, no userId
    expect(errors).toEqual([]);
  });

  it('rejects a non-string userId', async () => {
    const errors = await validateDto(baseDto({ userId: 12345 }));
    expect(JSON.stringify(errors)).toMatch(/string/i);
  });
```

- [ ] **Step 2: Run them — expect failure.**

Run: `npm --prefix apps/api test -- --runInBand create-payroll.dto.spec`
Expected: FAIL — the first test fails because `employeeName` is currently required (`@IsString() @MinLength(2)` with no `@IsOptional()`), and `userId` is unknown.

- [ ] **Step 3: Edit the DTO.** In `create-payroll.dto.ts`, change `class PayrollLineInput` so `employeeName` is optional and add `userId`:

```typescript
class PayrollLineInput {
  // Optional: required only when userId is absent (enforced in
  // ExpenseDocumentsService.createPayroll). When userId is present the server
  // derives employeeName from the User record (spec §4.2 — don't trust client).
  @IsString()
  @IsOptional()
  @MinLength(2, { message: 'ชื่อพนักงานต้องมีอย่างน้อย 2 ตัวอักษร' })
  employeeName?: string;

  // FK → User. Presence flips the line to "linked" mode: server derives the
  // employeeName/employeeTaxId snapshot and validates the user is an active
  // payroll employee. Optional (legacy free-text lines omit it).
  @IsString()
  @IsOptional()
  userId?: string;

  @IsString()
  @IsOptional()
  employeeTaxId?: string;
```

(Leave the rest of the class — `baseSalary`, `ssoEmployee`, `whtAmount`, `customIncome`, `customDeduction` — unchanged.)

- [ ] **Step 4: Run the tests — expect pass.**

Run: `npm --prefix apps/api test -- --runInBand create-payroll.dto.spec`
Expected: PASS (all cases, including the pre-existing SSO ones).

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/modules/expense-documents/dto/create-payroll.dto.ts apps/api/src/modules/expense-documents/__tests__/create-payroll.dto.spec.ts
git commit -m "feat(payroll): PayrollLineInput.userId + optional employeeName (PR-C)"
```

---

## Task 3: `createPayroll` — derive snapshot from `userId`, validate active employee

**Files:** Modify `apps/api/src/modules/expense-documents/expense-documents.service.ts`; Test `apps/api/src/modules/expense-documents/__tests__/payroll-user-link.service.spec.ts` (new)

The current `createPayroll` (around line 828) builds each row's snapshot from `l.employeeName` / `l.employeeTaxId`. We add a resolve step BEFORE the per-line `Promise.all` map, then thread the derived snapshot + `userId` into each prepared row and into the nested `lines.create`.

- [ ] **Step 1: Write the failing tests.** Create `apps/api/src/modules/expense-documents/__tests__/payroll-user-link.service.spec.ts`. The harness mirrors the existing `payroll.service.spec.ts` constructor wiring, plus an `employeeProfile.findMany` mock and a capture of what gets persisted:

```typescript
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ExpenseDocumentsService } from '../expense-documents.service';
import { LineAggregatorService } from '../services/line-aggregator.service';

describe('ExpenseDocumentsService.createPayroll — userId link & snapshot derive', () => {
  let service: ExpenseDocumentsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // captured payload passed to expenseDocument.create
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let created: any;

  const activeEmployee = {
    userId: 'user-emp-1',
    taxIdOverride: null,
    user: { id: 'user-emp-1', name: 'สมชาย ใจดี', nationalId: '1234567890123' },
  };

  beforeEach(() => {
    created = undefined;
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      employeeProfile: {
        findMany: jest.fn().mockResolvedValue([activeEmployee]),
      },
      expenseDocument: {
        create: jest.fn(async (args: any) => {
          created = args;
          return { id: 'pr-1', number: 'PR-20260601-0001' };
        }),
      },
    };
    const docNumber = { next: jest.fn().mockResolvedValue('PR-20260601-0001') };
    service = new ExpenseDocumentsService(
      prisma,
      docNumber as never,
      {} as never, // transition
      {} as never, // sameDay
      {} as never, // accrual
      {} as never, // cn
      { execute: jest.fn() } as never, // payroll template
      { execute: jest.fn() } as never, // settlement
      { createAndPost: jest.fn() } as never, // journalAuto
      new LineAggregatorService(),
      { preview: jest.fn() } as never, // jePreview
      { validateContribution: jest.fn().mockResolvedValue(undefined) } as never, // ssoConfig
      { execute: jest.fn() } as never, // pettyCash template
      { getConfig: jest.fn(), validate: jest.fn() } as never,
      {
        loadWhitelist: jest.fn().mockResolvedValue(new Set(['53-1104', '53-1105'])),
        validateLine: jest.fn().mockResolvedValue({ taxableBase: undefined }),
      } as never, // payrollCustom
      { send: jest.fn().mockResolvedValue({ id: 'n-1', status: 'SENT' }) } as never,
    );
  });

  const linesCreated = () =>
    created.data.payroll.create.lines.create as Array<{
      userId: string | null;
      employeeName: string;
      employeeTaxId: string | null;
    }>;

  it('derives employeeName + employeeTaxId from the linked User (ignores client-sent name)', async () => {
    await service.createPayroll(
      {
        branchId: 'b1',
        documentDate: '2026-06-01',
        payrollPeriod: '2026-06',
        depositAccountCode: '11-1101',
        lines: [
          {
            userId: 'user-emp-1',
            employeeName: 'ชื่อปลอมจาก client', // must be overridden
            employeeTaxId: '9999999999999', // must be overridden
            baseSalary: 15000,
            ssoEmployee: 750,
          },
        ],
      } as never,
      { id: 'actor-1', branchId: 'b1', role: 'OWNER' },
    );
    const row = linesCreated()[0];
    expect(row.userId).toBe('user-emp-1');
    expect(row.employeeName).toBe('สมชาย ใจดี');
    expect(row.employeeTaxId).toBe('1234567890123'); // from User.nationalId
  });

  it('uses taxIdOverride when the employee has one', async () => {
    prisma.employeeProfile.findMany.mockResolvedValue([
      { ...activeEmployee, taxIdOverride: '0010000000001' },
    ]);
    await service.createPayroll(
      {
        branchId: 'b1',
        documentDate: '2026-06-01',
        payrollPeriod: '2026-06',
        depositAccountCode: '11-1101',
        lines: [{ userId: 'user-emp-1', baseSalary: 15000 }],
      } as never,
      { id: 'actor-1', branchId: 'b1', role: 'OWNER' },
    );
    expect(linesCreated()[0].employeeTaxId).toBe('0010000000001');
  });

  it('rejects a userId that is not an active payroll employee', async () => {
    prisma.employeeProfile.findMany.mockResolvedValue([]); // resigned/deleted/not-an-employee
    await expect(
      service.createPayroll(
        {
          branchId: 'b1',
          documentDate: '2026-06-01',
          payrollPeriod: '2026-06',
          depositAccountCode: '11-1101',
          lines: [{ userId: 'ghost', baseSalary: 15000 }],
        } as never,
        { id: 'actor-1', branchId: 'b1', role: 'OWNER' },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('legacy path: no userId, keeps client employeeName + taxId, never queries employees', async () => {
    await service.createPayroll(
      {
        branchId: 'b1',
        documentDate: '2026-06-01',
        payrollPeriod: '2026-06',
        depositAccountCode: '11-1101',
        lines: [{ employeeName: 'พนักงานเก่า', employeeTaxId: '1111111111111', baseSalary: 12000 }],
      } as never,
      { id: 'actor-1', branchId: 'b1', role: 'OWNER' },
    );
    const row = linesCreated()[0];
    expect(row.userId).toBeNull();
    expect(row.employeeName).toBe('พนักงานเก่า');
    expect(row.employeeTaxId).toBe('1111111111111');
    expect(prisma.employeeProfile.findMany).not.toHaveBeenCalled();
  });

  it('rejects a line with neither userId nor employeeName', async () => {
    await expect(
      service.createPayroll(
        {
          branchId: 'b1',
          documentDate: '2026-06-01',
          payrollPeriod: '2026-06',
          depositAccountCode: '11-1101',
          lines: [{ baseSalary: 12000 }],
        } as never,
        { id: 'actor-1', branchId: 'b1', role: 'OWNER' },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('masks employeeTaxId in the response for FINANCE_MANAGER (PII — F1)', async () => {
    prisma.expenseDocument.create = jest.fn(async () => ({
      id: 'pr-1',
      number: 'PR-20260601-0001',
      payroll: {
        lines: [{ userId: 'user-emp-1', employeeName: 'สมชาย ใจดี', employeeTaxId: '1234567890123' }],
      },
    }));
    const res: any = await service.createPayroll(
      {
        branchId: 'b1',
        documentDate: '2026-06-01',
        payrollPeriod: '2026-06',
        depositAccountCode: '11-1101',
        lines: [{ userId: 'user-emp-1', baseSalary: 15000 }],
      } as never,
      { id: 'actor-1', branchId: 'b1', role: 'FINANCE_MANAGER' },
    );
    expect(res.payroll.lines[0].employeeTaxId).toBe('•••••••••0123');
  });

  it('returns full employeeTaxId for ACCOUNTANT/OWNER', async () => {
    prisma.expenseDocument.create = jest.fn(async () => ({
      id: 'pr-1',
      number: 'PR-20260601-0001',
      payroll: {
        lines: [{ userId: 'user-emp-1', employeeName: 'สมชาย ใจดี', employeeTaxId: '1234567890123' }],
      },
    }));
    const res: any = await service.createPayroll(
      {
        branchId: 'b1',
        documentDate: '2026-06-01',
        payrollPeriod: '2026-06',
        depositAccountCode: '11-1101',
        lines: [{ userId: 'user-emp-1', baseSalary: 15000 }],
      } as never,
      { id: 'actor-1', branchId: 'b1', role: 'ACCOUNTANT' },
    );
    expect(res.payroll.lines[0].employeeTaxId).toBe('1234567890123');
  });
});
```

- [ ] **Step 2: Run them — expect failure.**

Run: `npm --prefix apps/api test -- --runInBand payroll-user-link.service`
Expected: FAIL — `userId` not persisted (undefined), no derive logic, no guards.

- [ ] **Step 3: Implement the resolve + derive in `createPayroll`.** In `expense-documents.service.ts`, inside `createPayroll`, AFTER the SSO validation loop and `const whitelist = await this.payrollCustom.loadWhitelist();`, and BEFORE `const preparedRows = await Promise.all(`, insert the employee-resolution block:

```typescript
    // PR-C — resolve linked employees once. Lines with a userId get their
    // name/taxId snapshot derived from the registry (spec §4.2 — never trust
    // the client-sent snapshot). A userId that isn't an ACTIVE payroll
    // employee (no profile / soft-deleted / resigned) is rejected.
    const linkedUserIds = [
      ...new Set(dto.lines.filter((l) => l.userId).map((l) => l.userId as string)),
    ];
    const employeeByUserId = new Map<string, { name: string; taxId: string | null }>();
    if (linkedUserIds.length > 0) {
      const profiles = await this.prisma.employeeProfile.findMany({
        where: {
          userId: { in: linkedUserIds },
          deletedAt: null,
          OR: [{ resignedDate: null }, { resignedDate: { gt: new Date() } }],
          user: { is: { isActive: true, deletedAt: null } },
        },
        include: { user: { select: { id: true, name: true, nationalId: true } } },
      });
      for (const p of profiles) {
        employeeByUserId.set(p.userId, {
          name: p.user.name,
          taxId: p.taxIdOverride ?? p.user.nationalId,
        });
      }
      const missing = linkedUserIds.filter((id) => !employeeByUserId.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(
          'พนักงานที่เลือกบางรายไม่อยู่ในทะเบียนพนักงาน หรือลาออก/ถูกลบแล้ว — ' +
            'กรุณาเลือกใหม่หรือเพิ่มที่หน้าทะเบียนพนักงาน',
        );
      }
    }
```

Then inside the `dto.lines.map(async (l) => { ... })` callback, at the very top (before `const base = ...`), derive the snapshot and guard:

```typescript
        // PR-C — derive snapshot from the linked employee when present.
        const linked = l.userId ? employeeByUserId.get(l.userId) ?? null : null;
        const employeeName = linked ? linked.name : (l.employeeName ?? '').trim();
        const employeeTaxId = linked ? linked.taxId : (l.employeeTaxId ?? null);
        if (!l.userId && employeeName.length < 2) {
          throw new BadRequestException(
            'แต่ละแถวต้องเลือกพนักงานจากทะเบียน หรือระบุชื่อพนักงาน (อย่างน้อย 2 ตัวอักษร)',
          );
        }
```

Update the `validateLine` call to use the derived name (so error messages are correct):

```typescript
        await this.payrollCustom.validateLine(
          {
            employeeName,
            baseSalary: base,
            customIncome: l.customIncome,
            customDeduction: l.customDeduction,
          },
          whitelist,
        );
```

In the same callback's returned object, replace the `employeeName` / `employeeTaxId` fields and add `userId`:

```typescript
        return {
          userId: l.userId ?? null,
          employeeName,
          employeeTaxId,
          baseSalary: base,
          ssoEmployee: sso,
          whtAmount: wht,
          netPaid,
          customIncome: (l.customIncome ?? []).map((r) => ({
            accountCode: r.accountCode,
            name: r.name,
            amount: new Prisma.Decimal(r.amount),
            isTaxable: r.isTaxable !== false,
          })),
          customDeduction: (l.customDeduction ?? []).map((r) => ({
            accountCode: r.accountCode,
            name: r.name,
            amount: new Prisma.Decimal(r.amount),
          })),
        };
```

Finally, in the `payroll.create.lines.create` mapping (the nested Prisma create), add `userId`:

```typescript
                create: linesPrepared.map((l) => ({
                  userId: l.userId,
                  employeeName: l.employeeName,
                  employeeTaxId: l.employeeTaxId,
                  baseSalary: l.baseSalary,
                  ssoEmployee: l.ssoEmployee,
                  whtAmount: l.whtAmount,
                  netPaid: l.netPaid,
                  customIncome:
                    l.customIncome.length > 0 ? { create: l.customIncome } : undefined,
                  customDeduction:
                    l.customDeduction.length > 0 ? { create: l.customDeduction } : undefined,
                })),
```

> `BadRequestException` is already imported in this file (used by the negative-net guard). No new imports needed.

- [ ] **Step 3b: Mask the snapshot taxId in the RESPONSE for non-OWNER/ACCOUNTANT (F1 / D4 — PII).** The derived `employeeTaxId` equals the employee's `nationalId`; only OWNER/ACCOUNTANT may see full IDs (spec §4.1, PR-A PII gate), but the payroll-create endpoint also admits BRANCH_MANAGER/FINANCE_MANAGER. Capture the transaction result and mask before returning. Change the method tail from `return this.prisma.$transaction(async (tx) => { ... });` to:

```typescript
    const doc = await this.prisma.$transaction(async (tx) => {
      const number = await this.docNumber.next(tx, 'PAYROLL', documentDate);
      return tx.expenseDocument.create({
        // ...unchanged `data` + `include` from above...
      });
    });

    // PR-C PII (F1/D4) — the snapshot employeeTaxId === the employee's
    // nationalId (or override). Mask it in the response for roles that PR-A
    // blocks from national IDs, so a draft payroll can't enumerate them.
    this.maskPayrollTaxIds(doc, user.role);
    return doc;
```

Add this private helper to `ExpenseDocumentsService` (shared by `createPayroll` AND `findOne`):

```typescript
  /**
   * PR-C PII — mask each payroll line's employeeTaxId (= nationalId/override)
   * unless the viewer is OWNER/ACCOUNTANT. Mutates `doc` in place; the STORED
   * value is never changed (response-only). No-op for non-payroll docs.
   */
  private maskPayrollTaxIds(
    doc: { payroll?: { lines: Array<{ employeeTaxId: string | null }> } | null },
    role?: string | null,
  ): void {
    if (role === 'OWNER' || role === 'ACCOUNTANT') return;
    if (!doc.payroll) return;
    for (const l of doc.payroll.lines) {
      l.employeeTaxId = l.employeeTaxId ? '•••••••••' + l.employeeTaxId.slice(-4) : l.employeeTaxId;
    }
  }
```

> Only the RESPONSE is masked — the STORED value stays full (OWNER/ACCOUNTANT-gated reports / ภงด.1 read it later).

- [ ] **Step 3c: Mask the READ path too — `findOne` (F1; owner decision 2026-06-05 "เก็บกวาดให้สุด").** `GET /expense-documents/:id` → `service.findOne(id)` returns `payroll.lines[].employeeTaxId` to BRANCH_MANAGER/FINANCE_MANAGER (`findOne` includes `payroll: { include: { lines: ... } }`; controller `@Roles('OWNER','BRANCH_MANAGER','FINANCE_MANAGER','ACCOUNTANT')`). Thread the viewer role in and reuse the helper. Change `async findOne(id: string)` → `async findOne(id: string, viewerRole?: string | null)`, and replace its final `return doc;` with:

```typescript
    this.maskPayrollTaxIds(doc, viewerRole);
    return doc;
```

> `GET /expense-documents` (`list`) includes only `expenseDetail` (NO payroll lines) — no taxId leak, no change. **Verify at execution:** `GET /:id/voucher.pdf` (the voucher data method includes `payroll: true` WITHOUT nested lines, so it shouldn't render per-employee taxId) — confirm the rendered PDF doesn't print per-line taxId to BM/FM; if it does, mask there too.

- [ ] **Step 3d: Forward the role from the controller.** In `expense-documents.controller.ts`, add the current user to `findOne` and pass the role:

```typescript
  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string, @CurrentUser() user: { role?: string | null }) {
    return this.service.findOne(id, user.role);
  }
```
(`@CurrentUser` is already imported + used by `createCreditNote`/`createPayroll` in this controller.)

- [ ] **Step 3e: Test the read mask.** Add to `payroll-user-link.service.spec.ts`:

```typescript
  describe('findOne — payroll taxId masking (read path)', () => {
    function mockFindOne() {
      prisma.expenseDocument = {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValueOnce({ documentType: 'PAYROLL', deletedAt: null }) // docType probe
          .mockResolvedValueOnce({
            documentType: 'PAYROLL',
            deletedAt: null,
            payroll: { lines: [{ employeeTaxId: '1234567890123', employeeName: 'สมชาย' }] },
          }),
      };
    }
    it('masks employeeTaxId for FINANCE_MANAGER', async () => {
      mockFindOne();
      const res: any = await service.findOne('doc-1', 'FINANCE_MANAGER');
      expect(res.payroll.lines[0].employeeTaxId).toBe('•••••••••0123');
    });
    it('returns full employeeTaxId for OWNER', async () => {
      mockFindOne();
      const res: any = await service.findOne('doc-1', 'OWNER');
      expect(res.payroll.lines[0].employeeTaxId).toBe('1234567890123');
    });
  });
```

> `findOne` calls `findUniqueOrThrow` twice (docType probe, then typed include) — the mock returns them in order via `mockResolvedValueOnce`. Re-check the call count if the real `findOne` body changed.

- [ ] **Step 4: Run the tests — expect pass.**

Run: `npm --prefix apps/api test -- --runInBand payroll-user-link.service`
Expected: PASS (all 9 — derive, override, taxIdOverride, reject-inactive, legacy, reject-neither, 2 create-response PII-mask cases, + the 2 `findOne` read-mask cases from Step 3e).

- [ ] **Step 5: Run the existing payroll service spec — no regression.**

Run: `npm --prefix apps/api test -- --runInBand payroll.service.spec`
Expected: PASS (legacy lines still build correctly; those mocks have no `userId` so the resolve block is skipped).

- [ ] **Step 6: Typecheck + commit.**

Run: `./tools/check-types.sh api` → OK

```bash
git add apps/api/src/modules/expense-documents/expense-documents.service.ts apps/api/src/modules/expense-documents/__tests__/payroll-user-link.service.spec.ts
git commit -m "feat(payroll): derive employee snapshot from userId, validate active employee (PR-C)"
```

---

## Task 4: JE anti-regression — `payroll.template.ts` is `userId`-agnostic

**Files:** Modify `apps/api/src/modules/expense-documents/__tests__/payroll.template.spec.ts`

The JE template reads only numeric sums (`baseSalary`/`ssoEmployee`/`whtAmount`/`netPaid`) + custom income/deduction; it never reads `employeeName`/`employeeTaxId`/`userId`. This test locks that in: identical line numerics → identical `journal.createAndPost` lines whether or not `userId` is set (spec §4.3).

- [ ] **Step 1: Write the failing test.** Append inside the existing `describe('PayrollTemplate', ...)` block (reuse its `beforeEach` harness — `journal`, `prisma`, `roles`, `template`, `docId`):

```typescript
  it('JE is identical whether payroll lines carry a userId or not (PR-C anti-regression)', async () => {
    const baseLine = {
      baseSalary: new Decimal('15000.00'),
      ssoEmployee: new Decimal('750.00'),
      whtAmount: new Decimal('0.00'),
      netPaid: new Decimal('14250.00'),
      customIncome: [],
      customDeduction: [],
    };
    const docOf = (userId: string | null) => ({
      id: docId,
      number: 'PR-20260601-0001',
      documentType: 'PAYROLL',
      documentDate: new Date('2026-06-01'),
      totalAmount: new Decimal('15000.00'),
      depositAccountCode: '11-1101',
      journalEntryId: null,
      payroll: {
        payrollPeriod: '2026-06',
        lines: [{ ...baseLine, userId, employeeName: 'สมชาย', employeeTaxId: '1234567890123' }],
      },
    });

    // Run WITHOUT userId
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue(docOf(null));
    await template.execute(docId);
    const legacyLines = journal.createAndPost.mock.calls[0][0].lines;

    // Reset + run WITH userId
    journal.createAndPost.mockClear();
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue(docOf('user-emp-1'));
    await template.execute(docId);
    const linkedLines = journal.createAndPost.mock.calls[0][0].lines;

    expect(JSON.stringify(linkedLines)).toEqual(JSON.stringify(legacyLines));
  });
```

- [ ] **Step 2: Run it.**

Run: `npm --prefix apps/api test -- --runInBand payroll.template.spec`
Expected: PASS immediately (no production code change in this task — the template already ignores `userId`). If it FAILS, the template improperly reads `userId` — stop and investigate before proceeding.

- [ ] **Step 3: Commit.**

```bash
git add apps/api/src/modules/expense-documents/__tests__/payroll.template.spec.ts
git commit -m "test(payroll): JE anti-regression — userId does not affect the journal entry (PR-C)"
```

---

## Task 5: `GET /sso-config/effective` — expose the period cap for FE pre-fill

**Files:** Create `apps/api/src/modules/sso-config/sso-config.controller.ts`; Modify `apps/api/src/modules/sso-config/sso-config.module.ts`; Test `apps/api/src/modules/sso-config/__tests__/sso-config.controller.spec.ts`

Read-only. Returns the period-effective ceiling + cap so the payroll form pre-fills SSO correctly (see decision D1). Roles match the payroll-create endpoint (`/expense-documents/payroll` → OWNER, BRANCH_MANAGER, FINANCE_MANAGER, ACCOUNTANT).

- [ ] **Step 1: Write the failing test.** Create `apps/api/src/modules/sso-config/__tests__/sso-config.controller.spec.ts`:

```typescript
import { Prisma } from '@prisma/client';
import { SsoConfigController } from '../sso-config.controller';

describe('SsoConfigController', () => {
  it('GET /sso-config/effective returns ceiling + cap + rate for the given date', async () => {
    const svc = {
      getEffectiveConfig: jest.fn().mockResolvedValue({
        id: 'cfg-1',
        salaryCeiling: new Prisma.Decimal('17500'),
        maxContribution: new Prisma.Decimal('875'),
        effectiveFrom: new Date('2026-01-01'),
        effectiveTo: null,
      }),
    };
    const controller = new SsoConfigController(svc as never);
    const res = await controller.effective('2026-06-01');
    expect(svc.getEffectiveConfig).toHaveBeenCalledWith(new Date('2026-06-01'));
    expect(res.maxContribution.toString()).toBe('875');
    expect(res.salaryCeiling.toString()).toBe('17500');
    expect(res.rate).toBe(0.05);
  });

  it('defaults to "now" when no date is provided', async () => {
    const svc = {
      getEffectiveConfig: jest.fn().mockResolvedValue({
        id: 'cfg-1',
        salaryCeiling: new Prisma.Decimal('17500'),
        maxContribution: new Prisma.Decimal('875'),
        effectiveFrom: new Date('2026-01-01'),
        effectiveTo: null,
      }),
    };
    const controller = new SsoConfigController(svc as never);
    await controller.effective(undefined);
    expect(svc.getEffectiveConfig).toHaveBeenCalledTimes(1);
    const arg = svc.getEffectiveConfig.mock.calls[0][0];
    expect(arg).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Run it — expect failure.**

Run: `npm --prefix apps/api test -- --runInBand sso-config.controller`
Expected: FAIL — `SsoConfigController` does not exist.

- [ ] **Step 3: Create the controller.** `apps/api/src/modules/sso-config/sso-config.controller.ts`:

```typescript
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SsoConfigService, SSO_RATE } from './sso-config.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('sso-config')
export class SsoConfigController {
  constructor(private readonly ssoConfig: SsoConfigService) {}

  /**
   * Period-effective SSO contribution config (ceiling + cap + rate) for a date.
   * Used by the payroll form to pre-fill SSO = round2(min(base, ceiling) × rate).
   * Roles mirror the payroll-create endpoint.
   */
  @Get('effective')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async effective(@Query('date') date?: string) {
    const when = date ? new Date(date) : new Date();
    const cfg = await this.ssoConfig.getEffectiveConfig(when);
    return {
      salaryCeiling: cfg.salaryCeiling, // Prisma.Decimal → JSON string
      maxContribution: cfg.maxContribution, // Prisma.Decimal → JSON string
      effectiveFrom: cfg.effectiveFrom,
      rate: SSO_RATE,
    };
  }
}
```

- [ ] **Step 4: Register the controller.** Edit `apps/api/src/modules/sso-config/sso-config.module.ts` to add `controllers`:

```typescript
import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SsoConfigService } from './sso-config.service';
import { SsoConfigController } from './sso-config.controller';

@Module({
  controllers: [SsoConfigController],
  providers: [SsoConfigService, PrismaService],
  exports: [SsoConfigService],
})
export class SsoConfigModule {}
```

> `SsoConfigModule` is already in the app graph (imported by `ExpenseDocumentsModule`), so the controller is registered. Verify at execution: `grep -rn "SsoConfigModule" apps/api/src/modules/expense-documents/expense-documents.module.ts apps/api/src/app.module.ts`. If `SsoConfigModule` is NOT reachable from `AppModule`, add it to `AppModule.imports`.

- [ ] **Step 5: Run the test — expect pass + typecheck.**

Run: `npm --prefix apps/api test -- --runInBand sso-config.controller` → PASS
Run: `./tools/check-types.sh api` → OK

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/modules/sso-config/
git commit -m "feat(sso-config): GET /sso-config/effective for payroll SSO pre-fill (PR-C)"
```

---

## Task 6: Web API clients — `employeesApi.pickable` + `ssoConfigApi.effective`

**Files:** Modify `apps/web/src/lib/api/employees.ts`; Create `apps/web/src/lib/api/ssoConfig.ts`

- [ ] **Step 1: Extend `employees.ts`.** Add the `PickableEmployee` type (after the `ProvisionableUser` interface), the `pickable` query key (inside `employeeKeys`), and the `pickable` method (inside `employeesApi`):

```typescript
export interface PickableEmployee {
  userId: string;
  employeeId: string | null;
  name: string;
  nickname: string | null;
  baseSalary: string | null; // Prisma Decimal → string
  ssoEligible: boolean;
}
```

In `employeeKeys`, add:

```typescript
  pickable: (search: string) => [...employeeKeys.all, 'pickable', search] as const,
```

In `employeesApi`, add:

```typescript
  pickable: (search?: string) =>
    api
      .get<PickableEmployee[]>('/employees/pickable', { params: search ? { search } : {} })
      .then((r) => r.data),
```

- [ ] **Step 2: Create `apps/web/src/lib/api/ssoConfig.ts`:**

```typescript
import api from '@/lib/api';

export interface SsoEffectiveConfig {
  salaryCeiling: string; // Decimal → string
  maxContribution: string; // Decimal → string (875 in 2569+)
  effectiveFrom: string;
  rate: number; // 0.05
}

export const ssoConfigKeys = {
  effective: (date: string) => ['sso-config', 'effective', date] as const,
};

export const ssoConfigApi = {
  effective: (date?: string) =>
    api
      .get<SsoEffectiveConfig>('/sso-config/effective', { params: date ? { date } : {} })
      .then((r) => r.data),
};
```

- [ ] **Step 3: Typecheck + commit.**

Run: `./tools/check-types.sh web` → OK

```bash
git add apps/web/src/lib/api/employees.ts apps/web/src/lib/api/ssoConfig.ts
git commit -m "feat(employees-ui): pickable API client + ssoConfig.effective client (PR-C)"
```

---

## Task 7: `EmployeeCombobox` — no-inline-create picker

**Files:** Create `apps/web/src/components/employees/EmployeeCombobox.tsx`; Test `apps/web/src/components/employees/__tests__/EmployeeCombobox.test.tsx`

Mirrors `ContactCombobox` structure (Popover + Command + debounced server search) but **no create action** — spec §3.2: "ไม่มี inline-create ... ถ้าไม่เจอโชว์ 'เพิ่มพนักงานที่หน้าทะเบียน'". On pick it returns the full `PickableEmployee` (caller derives userId + pre-fill). `value` is the display name (shows the snapshot for legacy rows even when no employee is currently picked).

- [ ] **Step 1: Write the failing test.** Create `apps/web/src/components/employees/__tests__/EmployeeCombobox.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EmployeeCombobox from '../EmployeeCombobox';
import type { PickableEmployee } from '@/lib/api/employees';

vi.mock('@/lib/api/employees', () => ({
  employeeKeys: { all: ['employees'], pickable: (s: string) => ['employees', 'pickable', s] },
  employeesApi: { pickable: vi.fn() },
}));

const wrap = (ui: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

const EMP: PickableEmployee = {
  userId: 'u1', employeeId: 'EMP-001', name: 'สมชาย ใจดี', nickname: 'ชาย',
  baseSalary: '15000', ssoEligible: true,
};

describe('EmployeeCombobox', () => {
  it('searches and selects an employee (returns the full pickable record)', async () => {
    const { employeesApi } = await import('@/lib/api/employees');
    (employeesApi.pickable as any).mockResolvedValue([EMP]);
    const onSelect = vi.fn();
    const user = userEvent.setup();
    wrap(<EmployeeCombobox value="" onSelect={onSelect} />);

    await user.click(screen.getByRole('combobox'));
    await user.type(screen.getByPlaceholderText(/ค้นหาพนักงาน/), 'สมชาย');
    await waitFor(() => expect(screen.getByText('สมชาย ใจดี')).toBeInTheDocument());
    await user.click(screen.getByText('สมชาย ใจดี'));
    expect(onSelect).toHaveBeenCalledWith(EMP);
  });

  it('shows a registry hint when no employee matches — and NO create action', async () => {
    const { employeesApi } = await import('@/lib/api/employees');
    (employeesApi.pickable as any).mockResolvedValue([]);
    const user = userEvent.setup();
    wrap(<EmployeeCombobox value="" onSelect={vi.fn()} />);

    await user.click(screen.getByRole('combobox'));
    await user.type(screen.getByPlaceholderText(/ค้นหาพนักงาน/), 'ไม่มีคนนี้');
    await waitFor(() => expect(screen.getByText(/เพิ่มที่หน้าทะเบียนพนักงาน/)).toBeInTheDocument());
    expect(screen.queryByText(/สร้างใหม่/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\+ สร้าง/)).not.toBeInTheDocument();
  });

  it('shows the current value as the trigger label (legacy snapshot display)', () => {
    wrap(<EmployeeCombobox value="พนักงานเก่า" onSelect={vi.fn()} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('พนักงานเก่า');
  });
});
```

- [ ] **Step 2: Run it — expect failure.**

Run: `npm --prefix apps/web run test -- src/components/employees/__tests__/EmployeeCombobox.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement `EmployeeCombobox.tsx`:**

```tsx
// Payroll employee picker. Searches the payroll registry (active employees only,
// server-side, debounced) via GET /employees/pickable. NO inline-create —
// employees are Users provisioned at /employees first (spec §3.2). On pick it
// hands the full PickableEmployee to the parent, which sets userId + pre-fills
// base salary / SSO. `value` is the display name (shows legacy snapshot too).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';
import { employeeKeys, employeesApi, type PickableEmployee } from '@/lib/api/employees';

interface Props {
  value: string; // current display name (picked or legacy snapshot)
  onSelect: (employee: PickableEmployee) => void;
  invalid?: boolean;
  placeholder?: string;
}

export default function EmployeeCombobox({
  value,
  onSelect,
  invalid,
  placeholder = 'เลือกพนักงาน',
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search);

  const query = useQuery({
    queryKey: employeeKeys.pickable(debounced || ''),
    queryFn: () => employeesApi.pickable(debounced || undefined),
    enabled: open,
    staleTime: 60 * 1000,
  });
  const employees = query.data ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          className={cn('w-full justify-between font-normal', !value && 'text-muted-foreground')}
        >
          <span className="truncate leading-snug" title={value || undefined}>
            {value || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="ค้นหาพนักงาน (ชื่อ / ชื่อเล่น / รหัส)"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {query.isLoading ? (
              <CommandEmpty>กำลังโหลด...</CommandEmpty>
            ) : query.isError ? (
              <CommandEmpty className="px-3 py-6 text-center leading-snug text-destructive">
                โหลดข้อมูลไม่สำเร็จ
              </CommandEmpty>
            ) : employees.length === 0 ? (
              <CommandEmpty className="px-3 py-6 text-center leading-snug text-muted-foreground">
                {search.trim()
                  ? `ไม่พบพนักงาน "${search.trim()}" — เพิ่มที่หน้าทะเบียนพนักงาน`
                  : 'พิมพ์เพื่อค้นหาพนักงาน'}
              </CommandEmpty>
            ) : (
              <CommandGroup heading="พนักงาน">
                {employees.map((e) => (
                  <CommandItem
                    key={e.userId}
                    value={e.userId}
                    onSelect={() => {
                      onSelect(e);
                      setOpen(false);
                      setSearch('');
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 size-4 shrink-0',
                        value === e.name ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span className="flex-1 truncate leading-snug">{e.name}</span>
                    {e.nickname && (
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                        {e.nickname}
                      </span>
                    )}
                    {e.employeeId && (
                      <Badge variant="secondary" className="ml-2 text-2xs">
                        {e.employeeId}
                      </Badge>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

> Verify at execution: the `Badge` `text-2xs` class + `CommandEmpty`/`Command` import paths exist (they're used by `ContactCombobox.tsx` — mirror it). If `text-2xs` is undefined in your Tailwind config, use `text-xs`.

- [ ] **Step 4: Run the test — expect pass.**

Run: `npm --prefix apps/web run test -- src/components/employees/__tests__/EmployeeCombobox.test.tsx`
Expected: PASS (all 3). Fix selector mismatches against the real shadcn `Command` DOM if needed.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/components/employees/EmployeeCombobox.tsx apps/web/src/components/employees/__tests__/EmployeeCombobox.test.tsx
git commit -m "feat(employees-ui): EmployeeCombobox (no inline-create payroll picker) (PR-C)"
```

---

## Task 8: Wire `EmployeeCombobox` into `PayrollLinesSection` + pre-fill base/SSO

**Files:** Modify `apps/web/src/components/expense-form-v4/types.ts`; Modify `apps/web/src/components/expense-form-v4/PayrollLinesSection.tsx`; Modify `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx`; Test `apps/web/src/components/expense-form-v4/__tests__/PayrollLinesSection.test.tsx`

- [ ] **Step 1: Add `userId` to the form line type.** In `types.ts`, add to `PayrollLineForm` (after `employeeName`):

```typescript
  // PR-C — FK to the chosen payroll employee. '' = legacy free-text row.
  userId: string;
```

And in `newPayrollLine`, add the default:

```typescript
  userId: '',
```

- [ ] **Step 2: Write the failing test.** Create `apps/web/src/components/expense-form-v4/__tests__/PayrollLinesSection.test.tsx`. A small stateful harness re-renders on `onChange` so we can observe pre-fill:

```tsx
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PayrollLinesSection } from '../PayrollLinesSection';
import { newPayrollLine, type PayrollFormFields } from '../types';
import type { PickableEmployee } from '@/lib/api/employees';

vi.mock('@/lib/api/employees', () => ({
  employeeKeys: { all: ['employees'], pickable: (s: string) => ['employees', 'pickable', s] },
  employeesApi: { pickable: vi.fn() },
}));
vi.mock('@/lib/api/ssoConfig', () => ({
  ssoConfigKeys: { effective: (d: string) => ['sso-config', 'effective', d] },
  ssoConfigApi: { effective: vi.fn() },
}));
// useUiFlags is consumed by the custom-income subtable; stub it.
vi.mock('@/hooks/useUiFlags', () => ({ useUiFlags: () => ({ taxExemptWarningEnabled: true }) }));

const EMP: PickableEmployee = {
  userId: 'u1', employeeId: 'EMP-001', name: 'สมชาย ใจดี', nickname: 'ชาย',
  baseSalary: '16000', ssoEligible: true,
};

function Harness({ initial }: { initial?: PayrollFormFields }) {
  const [value, setValue] = useState<PayrollFormFields>(
    initial ?? { year: 2569, month: 6, payrollPeriod: '2026-06', lines: [newPayrollLine()] },
  );
  return (
    <PayrollLinesSection
      value={value}
      onChange={setValue}
      documentDate="2026-06-01"
      onDocumentDateChange={() => {}}
    />
  );
}

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('PayrollLinesSection — employee link + pre-fill', () => {
  it('pre-fills base salary and SSO (capped) when an employee is picked', async () => {
    const { employeesApi } = await import('@/lib/api/employees');
    const { ssoConfigApi } = await import('@/lib/api/ssoConfig');
    (employeesApi.pickable as any).mockResolvedValue([EMP]);
    (ssoConfigApi.effective as any).mockResolvedValue({
      salaryCeiling: '17500', maxContribution: '875', effectiveFrom: '2026-01-01', rate: 0.05,
    });
    const user = userEvent.setup();
    wrap(<Harness />);

    await user.click(screen.getByRole('combobox'));
    await user.type(screen.getByPlaceholderText(/ค้นหาพนักงาน/), 'สมชาย');
    await waitFor(() => expect(screen.getByText('สมชาย ใจดี')).toBeInTheDocument());
    await user.click(screen.getByText('สมชาย ใจดี'));

    // base prefilled = 16000; SSO = min(16000*0.05, 875) = 800
    const base = screen.getByDisplayValue('16000');
    expect(base).toBeInTheDocument();
    await waitFor(() => expect(screen.getByDisplayValue('800')).toBeInTheDocument());
  });

  it('SSO pre-fill is 0 when the employee is not SSO-eligible', async () => {
    const { employeesApi } = await import('@/lib/api/employees');
    const { ssoConfigApi } = await import('@/lib/api/ssoConfig');
    (employeesApi.pickable as any).mockResolvedValue([{ ...EMP, ssoEligible: false }]);
    (ssoConfigApi.effective as any).mockResolvedValue({
      salaryCeiling: '17500', maxContribution: '875', effectiveFrom: '2026-01-01', rate: 0.05,
    });
    const user = userEvent.setup();
    wrap(<Harness />);

    await user.click(screen.getByRole('combobox'));
    await user.type(screen.getByPlaceholderText(/ค้นหาพนักงาน/), 'สมชาย');
    await waitFor(() => expect(screen.getByText('สมชาย ใจดี')).toBeInTheDocument());
    await user.click(screen.getByText('สมชาย ใจดี'));

    expect(screen.getByDisplayValue('16000')).toBeInTheDocument();
    // SSO stays 0
    const ssoInputs = screen.getAllByDisplayValue('0');
    expect(ssoInputs.length).toBeGreaterThan(0);
  });

  it('taxId column is read-only (server-derived) — no free-text taxId input (F3)', () => {
    wrap(<Harness />);
    // the old legacy free-text taxId input (placeholder "13 หลัก") is gone
    expect(screen.queryByPlaceholderText('13 หลัก')).not.toBeInTheDocument();
    expect(screen.getByText(/ดึงเลขบัตรอัตโนมัติตอนบันทึก/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it — expect failure.**

Run: `npm --prefix apps/web run test -- src/components/expense-form-v4/__tests__/PayrollLinesSection.test.tsx`
Expected: FAIL — section still renders the free-text name input; no combobox, no pre-fill.

- [ ] **Step 4: Wire the combobox + pre-fill into `PayrollLinesSection.tsx`.**

4a. Add imports at the top:

```tsx
import { useQuery } from '@tanstack/react-query';
import EmployeeCombobox from '@/components/employees/EmployeeCombobox';
import { type PickableEmployee } from '@/lib/api/employees';
import { ssoConfigApi, ssoConfigKeys } from '@/lib/api/ssoConfig';
```

4b. Inside the `PayrollLinesSection` component body (near the top, after `const updateField = ...`), fetch the period cap and write a per-row select handler:

```tsx
  // PR-C — period-effective SSO ceiling/cap for SSO pre-fill (decision D1).
  const ssoCfg = useQuery({
    queryKey: ssoConfigKeys.effective(documentDate || ''),
    queryFn: () => ssoConfigApi.effective(documentDate || undefined),
    enabled: !!documentDate,
    staleTime: 5 * 60 * 1000,
  });

  const round2 = (n: number) => Math.round(n * 100) / 100;

  const handlePickEmployee = (uid: string, emp: PickableEmployee) => {
    const base = emp.baseSalary != null ? parseFloat(emp.baseSalary) : NaN;
    const patch: Partial<PayrollLineForm> = {
      userId: emp.userId,
      employeeName: emp.name,
      // taxId snapshot is derived server-side on save — clear any stale value.
      employeeTaxId: '',
    };
    if (!Number.isNaN(base)) patch.baseSalary = String(base);
    // F5 — only pre-fill SSO with a CAPPED value. If the period cap hasn't
    // loaded yet, leave SSO for manual entry rather than auto-filling an
    // uncapped base×5% that could exceed the cap and fail server validation.
    const ceiling = ssoCfg.data ? parseFloat(ssoCfg.data.salaryCeiling) : null;
    const rate = ssoCfg.data?.rate ?? 0.05;
    if (emp.ssoEligible && !Number.isNaN(base) && ceiling != null) {
      patch.ssoEmployee = String(round2(Math.min(base, ceiling) * rate));
    }
    updateLine(uid, patch);
  };
```

4c. Pass the handler down to each row. Update the `<PayrollRow ... />` render call to add an `onPickEmployee` prop:

```tsx
              <PayrollRow
                key={row.uid}
                row={row}
                disableRemove={value.lines.length === 1}
                onUpdate={(p) => updateLine(row.uid, p)}
                onRemove={() => removeLine(row.uid)}
                onPickEmployee={(emp) => handlePickEmployee(row.uid, emp)}
              />
```

4d. In the `PayrollRow` function signature, add `onPickEmployee` to the destructured props and its type:

```tsx
function PayrollRow({
  row,
  disableRemove,
  onUpdate,
  onRemove,
  onPickEmployee,
}: {
  row: PayrollLineForm & {
    netPaid: number;
    baseN: number;
    ssoN: number;
    whtN: number;
    incomeN: number;
    deductionN: number;
    taxableBaseN: number;
    hasExtras: boolean;
  };
  disableRemove: boolean;
  onUpdate: (p: Partial<PayrollLineForm>) => void;
  onRemove: () => void;
  onPickEmployee: (emp: PickableEmployee) => void;
}) {
```

4e. Replace the name `<td>` (the free-text `employeeName` `<input>`) with the combobox:

```tsx
        <td className="px-2 py-1">
          <EmployeeCombobox
            value={row.employeeName}
            onSelect={onPickEmployee}
            placeholder="เลือกพนักงาน"
          />
        </td>
```

4f. Replace the taxId `<td>` with a **read-only** cell (F3 — `ExpenseFormV4` is create-only, verified: Props = `{ branchId, onClose, onSaved }`, `initial()` always seeds `newPayrollLine()`, no edit/load path). Every submittable row is picked → its taxId is server-derived → there is no in-form free-text taxId path. Show the snapshot if one is somehow present, else the placeholder:

```tsx
        <td className="px-2 py-1">
          <span className="block px-2 py-1.5 text-xs text-muted-foreground italic leading-snug">
            {row.employeeTaxId || '(ดึงเลขบัตรอัตโนมัติตอนบันทึก)'}
          </span>
        </td>
```

> Spec §3.2's "legacy free-text rows แสดง/แก้ได้" applies to historical-document VIEWERS, not this create form (which never loads legacy rows). The editable `!userId` taxId input is intentionally dropped — keeping it would be a dead/confusing control (you cannot set `employeeName` without picking, which sets `userId` and clears taxId).

> The base/SSO/WHT number inputs are unchanged — they remain hand-editable; `handlePickEmployee` only seeds defaults via `updateLine`.

- [ ] **Step 5: Forward `userId` in the POST body (`ExpenseFormV4.tsx`).** In the `state.docType === 'PAYROLL'` branch, inside the `.map((l) => { ... return { ... } })` for `lines`, add `userId` to the returned object (right above `employeeName`):

```tsx
              return {
                userId: l.userId || undefined,
                employeeName: l.employeeName,
                employeeTaxId: l.employeeTaxId || undefined,
                baseSalary: parseFloat(l.baseSalary),
                ssoEmployee: parseFloat(l.ssoEmployee) || 0,
                whtAmount: parseFloat(l.whtAmount) || 0,
                customIncome:
```

> The existing `.filter((l) => l.employeeName && parseFloat(l.baseSalary) > 0)` still holds — picking an employee sets `employeeName`, so linked rows pass the filter. Server overrides the name from `userId` anyway.

- [ ] **Step 6: Run the section test — expect pass.**

Run: `npm --prefix apps/web run test -- src/components/expense-form-v4/__tests__/PayrollLinesSection.test.tsx`
Expected: PASS (all 3). If a `getByDisplayValue('0')` assertion is ambiguous (WHT also defaults to '0'), tighten the selector to the SSO cell or assert the SSO input specifically.

- [ ] **Step 7: Typecheck + commit.**

Run: `./tools/check-types.sh web` → OK

```bash
git add apps/web/src/components/expense-form-v4/types.ts apps/web/src/components/expense-form-v4/PayrollLinesSection.tsx apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx apps/web/src/components/expense-form-v4/__tests__/PayrollLinesSection.test.tsx
git commit -m "feat(payroll-ui): EmployeeCombobox in PayrollLinesSection + base/SSO pre-fill + userId in payload (PR-C)"
```

---

## Task 9: Full verify + PR

- [ ] **Step 1: API tests (the touched suites, runInBand per memory `api-jest-parallel-db-flaky`).**

Run: `npm --prefix apps/api test -- --runInBand create-payroll.dto.spec payroll-user-link.service payroll.service.spec payroll.template.spec sso-config`
Expected: all green.

- [ ] **Step 2: Web tests.**

Run: `npm --prefix apps/web run test -- src/components/employees/__tests__/EmployeeCombobox.test.tsx src/components/expense-form-v4/__tests__/PayrollLinesSection.test.tsx`
Expected: all green.

- [ ] **Step 3: Typecheck both.**

Run: `./tools/check-types.sh api && ./tools/check-types.sh web`
Expected: 0 errors.

- [ ] **Step 4: Push + open PR (controller does this AFTER review; do NOT merge — owner merges → prod deploy).**

```bash
git push -u origin feat/payroll-employee-link
gh pr create --base main --head feat/payroll-employee-link \
  --title "feat(payroll): link PayrollLine to employee + server-derived snapshot (PR-C)" \
  --body "PR-C of Employee Master. Backend: PayrollLine.userId nullable FK + migration; createPayroll derives employeeName/employeeTaxId from the linked active employee (rejects inactive/resigned/non-employee userIds); legacy free-text lines unchanged. New GET /sso-config/effective exposes the period-effective SSO cap for the form pre-fill. JE template untouched — anti-regression test proves the journal entry is identical with vs without userId. Frontend: employeesApi.pickable + EmployeeCombobox (no inline-create) replaces the free-text name input in PayrollLinesSection; pre-fills base salary + SSO (=min(base, ceiling)*5%, period cap); taxId becomes read-only (server-derived). Depends at DEPLOY time on #1151 (schema) + #1152 (employees.ts client). Run prisma migrate deploy after merge. Tests green; tsc clean.

Decisions for review: (D1) SSO pre-fill uses the live period cap (875 in 2569+) via the new endpoint, NOT spec §3.2's stale 750 — owner-confirmed. (D2) employeeName is optional in the DTO; required only when no userId; server overrides client snapshot when userId present. (D4/PII) employeeTaxId is masked for non-OWNER/ACCOUNTANT on BOTH the create response AND the payroll-detail GET (shared maskPayrollTaxIds helper); full value stays stored for ภงด.1; list exposes no payroll lines."
```

> Then hand off to `scrutinize` (see below) and the owner. Per project rules: do NOT merge.

---

## Self-Review checklist

**1. Spec coverage:**
- §2.3 PayrollLine.userId nullable FK + snapshot retained → Task 1 ✅
- §3.2 EmployeeCombobox (no inline-create), pre-fill base/SSO, taxId read-only when linked, legacy rows editable → Tasks 7, 8 ✅
- §4.2 server-derive snapshot from userId, reject inactive employee, legacy path → Task 3 ✅
- §4.3 JE unchanged + anti-regression test → Task 4 ✅
- §6 tests: dto shape, service derive/reject/legacy, JE anti-regression, combobox, payroll section pre-fill → Tasks 2,3,4,7,8 ✅
- §7 edge cases: resigned employee not pickable (server `pickable` filter from PR-A + Task 3 reject), taxIdOverride, ssoEligible=false → 0, legacy snapshot display → Tasks 3, 7, 8 ✅

**2. Placeholder scan:** every code/test step has complete code; commands have expected output. No TBD/"add validation"/"similar to". ✅

**3. Type consistency:** `PickableEmployee` shape matches PR-A `pickable` projection (`{ userId, employeeId, name, nickname, baseSalary, ssoEligible }`) exactly. `userId` is `string` in the form type, `string | undefined` in the POST body, `string?` in the DTO, `String?` in the schema. `handlePickEmployee` / `onPickEmployee` names match between section and row. `ssoConfigApi.effective` / `ssoConfigKeys.effective` consistent across client + section + test.

**4. Execution-time verifications (read the real file, then match):**
- Exact `ExpenseDocumentsService` constructor arg order — Task 3's spec harness mirrors `payroll.service.spec.ts`; if PR-A/other PRs added a constructor dependency, re-copy the live `beforeEach` from `payroll.service.spec.ts`.
- `SsoConfigModule` reachable from `AppModule` (Task 5 Step 4 note).
- shadcn `Command`/`Badge` DOM + `text-2xs` class (Task 7 note) — mirror `ContactCombobox.tsx`.
- `ExpenseFormV4` payroll `.map` block still matches (Task 8 Step 5) — re-read lines ~217-250 before editing.

## Scrutinize — done (2026-06-05)
This plan was scrutinized before implementation. Findings + resolutions:
- **F1 (major, PII) — RESOLVED in plan (full clean-up).** The payroll-create response AND the payroll-detail read (`findOne` / `GET /expense-documents/:id`) echoed the server-derived `employeeTaxId` (= nationalId) to BRANCH_MANAGER/FINANCE_MANAGER, bypassing PR-A's PII gate. Fix: a shared `maskPayrollTaxIds` helper masks taxId for non-OWNER/ACCOUNTANT on both paths — create response (Step 3b) + `findOne` (Step 3c–3e). Owner chose "เก็บกวาดให้สุด" (2026-06-05) → read path masked too (not deferred). **Un-mask set = OWNER/ACCOUNTANT/FINANCE_MANAGER** (FM cleared — files PND1; owner decision 2026-06-05); BRANCH_MANAGER + others masked. `list` exposes no payroll lines (safe). Voucher PDF verified at implementation — renders no per-employee taxId (clean).
- **F2 (scope) — DECIDED 2026-06-05.** Keep SSO pre-fill + `GET /sso-config/effective` (owner-confirmed; see D1).
- **F3 (minor) — RESOLVED.** `ExpenseFormV4` verified create-only → taxId column always read-only (Task 8 4f); dead editable branch dropped.
- **F4 (minor) — RESOLVED.** Migration timestamp derived from latest-on-main, not a hardcoded literal (Task 1 Step 3).
- **F5 (minor) — RESOLVED.** SSO pre-fill fires only when the period cap has loaded; never auto-fills an uncapped value (Task 8 4b).
- **F6 (nit) — ACCEPTED.** Duplicate `userId` across lines in one doc isn't constrained; JE sums correctly. Optional future UI guard.

**Before merge:** re-run `scrutinize` on the actual PR diff to confirm F1's mask is wired on every payroll response path (create + any read endpoint touched), and that D2's server-override integrity holds end-to-end.
```