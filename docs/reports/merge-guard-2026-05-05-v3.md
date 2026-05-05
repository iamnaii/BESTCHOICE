# Pre-Merge Guard Report — 2026-05-05 (v3)

**Generated**: 2026-05-05  
**Branches reviewed**: 3 most recently active unmerged branches  
**Reviewer**: Pre-Merge Guard Agent (automated)

---

## Branch 1: `fix/installment-schedules-on-activate`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-05 17:01  
**PRs**: Accumulates #753 (schedule gen on activate), #754 (wizard auto-detect), #755 (backfill CLI), #756 (status filter fix), #757 (single-screen wizard), plus seed:coa CLI and ChartOfAccountsPage rewrite

### File changes summary (vs `main`)

| File | Change |
|------|--------|
| `apps/api/src/cli/seed-coa.cli.ts` | NEW — non-destructive CoA upsert CLI |
| `apps/api/src/cli/backfill-installment-schedules.cli.ts` | NEW — backfill CLI for pre-#753 contracts |
| `apps/api/src/modules/contracts/contract-workflow.service.ts` | +64 — `generateInstallmentSchedules` on activation |
| `apps/api/src/modules/payments/dto/payment.dto.ts` | +116 — new `PreviewJournalDto`, extends `RecordPaymentDto` |
| `apps/api/src/modules/payments/payments.controller.ts` | +62 — new `POST /payments/preview-journal` |
| `apps/api/src/modules/payments/payments.service.ts` | +182 — `previewJournal()` calculation engine |
| `apps/api/src/modules/payments/payments.service.spec.ts` | +145 — 5 new test cases for `previewJournal` |
| `apps/web/src/pages/ChartOfAccountsPage.tsx` | REWRITE — Phase A.4 schema (code-based grouping) |
| `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` | NEW — 4-step wizard + single-screen variant |
| `apps/web/src/pages/PaymentsPage/index.tsx` | +53 |
| `apps/web/src/pages/PaymentsPage/types.ts` | +2 |

### Security checks

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` on `PaymentsController` | ✓ Class-level, covers all endpoints |
| `@Roles(...)` on new `previewJournal` endpoint | ✓ All 5 roles declared |
| `Number()` on money fields | ✓ None — all use `Prisma.Decimal` |
| Hardcoded secrets | ✓ None found |
| Raw `$queryRaw` SQL injection | ✓ None — only `SELECT current_database()` (no user input) |
| `deletedAt: null` in new queries | ⚠️ Partial — see Warning W1 |

### Issues

#### Warning W1 — `findUnique` returns soft-deleted installment schedules

**File**: `apps/api/src/modules/payments/payments.service.ts`, `previewJournal()`  
**Severity**: Warning

```typescript
const inst = await this.prisma.installmentSchedule.findUnique({
  where: { contractId_installmentNo: { contractId: input.contractId, installmentNo: input.installmentNo } },
  include: { contract: true },
});
```

`findUnique` with a compound unique key cannot include `deletedAt: null` in the `where` clause. If a schedule row is soft-deleted, this returns it anyway. Should use `findFirst` instead:

```typescript
const inst = await this.prisma.installmentSchedule.findFirst({
  where: {
    contractId: input.contractId,
    installmentNo: input.installmentNo,
    deletedAt: null,
  },
  include: { contract: true },
});
if (!inst) throw new NotFoundException('ไม่พบงวดชำระ');
```

#### Warning W2 — `(dto as any).case` type-escape in controller

**File**: `apps/api/src/modules/payments/payments.controller.ts`, line ~328  
**Severity**: Warning

```typescript
if ((dto as any).case === 'RESCHEDULE') {
  throw new BadRequestException('...');
}
```

`RecordPaymentDto` does not declare a `case` field, so the controller casts to `any`. This bypasses TypeScript validation. Either:
- Add `case?: PaymentCase` (with `@IsOptional() @IsIn([...])`) to `RecordPaymentDto`, or
- Move this check into a DTO transform/pipe layer

#### Warning W3 — `slipUrl` missing HTTPS URL validation

**Files**: `apps/api/src/modules/payments/dto/payment.dto.ts` — both `RecordPaymentDto.slipUrl` and `PreviewJournalDto.slipUrl`  
**Severity**: Warning

```typescript
// New fields — no URL format validation:
@IsOptional()
@IsString()
@MaxLength(2048)
slipUrl?: string;

// Existing field — properly validated:
@Matches(/^https:\/\/.+/, { message: 'evidenceUrl ต้องเป็น HTTPS URL' })
evidenceUrl?: string;
```

`slipUrl` accepts any string. Add `@Matches(/^https:\/\/.+/, { message: 'slipUrl ต้องเป็น HTTPS URL' })` to match the validation on `evidenceUrl`.

#### Warning W4 — `workflowStatus: 'ACTIVE' as any` in backfill CLI

**File**: `apps/api/src/cli/backfill-installment-schedules.cli.ts`, line ~36  
**Severity**: Warning

```typescript
where: {
  workflowStatus: 'ACTIVE' as any,
  deletedAt: null,
},
```

This field filter is wrong — `workflowStatus` is not the correct Prisma field name and the value is typed as `any`. The companion branch `fix/backfill-status-filter` partially fixes this to `status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT', 'LEGAL'] as any }` but still uses `as any`. The correct fix is to import and use `ContractStatus` enum from `@prisma/client`:

```typescript
import { ContractStatus } from '@prisma/client';
// ...
where: {
  status: { in: [ContractStatus.ACTIVE, ContractStatus.OVERDUE, ContractStatus.DEFAULT, ContractStatus.LEGAL] },
  deletedAt: null,
},
```

Note: `fix/backfill-status-filter` (1-line fix) is NOT merged into this branch.

#### Info I1 — Large files

| File | Lines | Concern |
|------|-------|---------|
| `RecordPaymentWizard.tsx` | 867 lines (branch tip) | Acceptable for a full-featured payment dialog |
| `payments.service.ts` | ~1600+ lines total | Service accumulates many responsibilities |

### Recommendation: **REVIEW**

Fix W1 (use `findFirst`), W2 (`as any` cast), W3 (`slipUrl` HTTPS validation), and W4 (enum import) before merge. No critical blockers, but W1 and W3 are correctness/security issues in a payment-critical path.

---

## Branch 2: `fix/payment-single-screen`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-05 19:04 (most recent of all branches)  
**PR**: #757

### File changes summary (vs `main`)

| File | Change |
|------|--------|
| `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` | 303 insertions, 564 deletions |

**Net effect**: Collapses the 4-step payment wizard into a single-screen layout for faster cashier workflow. No backend changes.

### Security checks

| Check | Result |
|-------|--------|
| New controllers/endpoints | ✓ None (frontend-only) |
| Raw `fetch()` usage | ✓ Only for S3 presigned URL PUT — intentional, correct pattern |
| `api.get()`/`api.post()` for backend calls | ✓ All backend API calls use the `api` client |
| Hardcoded secrets | ✓ None |
| `queryClient.invalidateQueries()` after mutations | ✓ No new mutations (display/input only) |

### Issues

#### Info I1 — `parseFloat()` on amount string for UI validation

**File**: `RecordPaymentWizard.tsx`

```typescript
const receivedNum = parseFloat(amountReceived) || 0;
// Used only for: canSubmit() guard and detectCase() UI badge
```

`parseFloat` is used on the `<Input type="number">` string value for UI validation logic. Financial calculations use `Decimal.js` objects. This is an acceptable pattern for client-side input validation (not financial arithmetic), but reviewers should confirm `receivedNum` is never sent directly to the API — confirmed, the wizard submits structured DTO fields.

#### Info I2 — Component is 867 lines

Within the project's acceptable range for a complex payment dialog; not actionable.

### Recommendation: **APPROVE**

Pure UI refactoring, no security or correctness concerns. The single-screen layout improves cashier UX without changing any business logic.

---

## Branch 3: `fix/backfill-schedules-cli`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-05 17:45  
**PR**: #755

### File changes summary (vs `main`)

| File | Change |
|------|--------|
| `apps/api/package.json` | +1 — adds `backfill:schedules` npm script |
| `apps/api/src/cli/backfill-installment-schedules.cli.ts` | NEW — 109 lines |

### Security checks

| Check | Result |
|-------|--------|
| Auth guards | ✓ CLI tool, no HTTP endpoints |
| Hardcoded secrets | ✓ None |
| `$queryRaw` injection | ✓ None — only `SELECT current_database()` (no user input) |
| `EXPECTED_DB_NAME` guard | ✓ Requires env var, aborts on mismatch |
| `deletedAt: null` in queries | ✓ Present on both `contract.findMany` and `installmentSchedule.count` |
| Money fields | ✓ All use `Prisma.Decimal` |

### Issues

#### Warning W1 — `workflowStatus: 'ACTIVE' as any` incorrect field and unsafe type

**File**: `apps/api/src/cli/backfill-installment-schedules.cli.ts`, line 36  
**Severity**: Warning

```typescript
where: {
  workflowStatus: 'ACTIVE' as any,  // Wrong field name + as any
  deletedAt: null,
},
```

- `workflowStatus` is not a Prisma field on `Contract` — likely `status` or a workflow-stage field. This filter silently matches nothing or causes a Prisma validation error at runtime.
- Fix tracked in `fix/backfill-status-filter` (changes to `status: { in: [...] as any }` — still uses `as any` but correct field name).
- Final fix should import `ContractStatus` enum: `status: { in: [ContractStatus.ACTIVE, ...] }`.

**Risk**: If this filter matches no contracts (due to wrong field name), the CLI silently does nothing instead of backfilling. This is a data integrity risk for the P0 fix it supports.

#### Info I1 — `fix/backfill-status-filter` must be applied first

The companion 1-line fix branch `fix/backfill-status-filter` should be merged before or alongside this branch. Currently the two are separate branches.

### Recommendation: **REVIEW**

W1 is not a security issue but is a data-correctness bug — the CLI may not backfill any contracts if the field filter silently fails. Apply the `fix/backfill-status-filter` fix and use the `ContractStatus` enum before merging.

---

## Summary

| Branch | Risk | Recommendation |
|--------|------|---------------|
| `fix/installment-schedules-on-activate` | Medium | **REVIEW** — 4 warnings (W1–W4), no critical blockers |
| `fix/payment-single-screen` | Low | **APPROVE** — pure UI refactor, clean |
| `fix/backfill-schedules-cli` | Medium | **REVIEW** — wrong filter field may silently skip all contracts |

### Cross-branch note

`fix/backfill-schedules-cli` and `fix/installment-schedules-on-activate` both contain the backfill CLI with the `workflowStatus` issue. The fix is in `fix/backfill-status-filter` (separate branch). Coordinate merge order to ensure the corrected version lands.
