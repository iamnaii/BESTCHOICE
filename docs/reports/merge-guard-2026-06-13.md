# Pre-Merge Guard Report — 2026-06-13

**Generated**: 2026-06-13  
**Repository**: iamnaii/bestchoice  
**Unmerged branches**: 369 total — reviewed top 3 by recency (excluding guard/watchdog/chore/deps branches)

---

## Branches Reviewed

| Branch | Author | Last Commit | Unique Commits | TS Files Changed |
|--------|--------|-------------|----------------|-----------------|
| `fix/ci-pre-existing-test-failures` | iamnaii | 2026-06-08 | 178 | 408 |
| `feat/payroll-backfill` | iamnaii | 2026-06-05 | 158 | 491 |
| `feat/payroll-employee-link` | iamnaii | 2026-06-05 | 10 (unique vs base) | 19 (unique) |

> **Note on branch lineage**: `feat/payroll-backfill` builds on top of `fix/ci-pre-existing-test-failures`, and `feat/payroll-employee-link` stacks on top of `feat/payroll-backfill`. The large commit/file counts for branches 1 and 2 reflect accumulated work across many PRs — findings below distinguish between pre-existing issues carried in the diff vs. issues introduced by unique commits.

---

## Branch 1: `fix/ci-pre-existing-test-failures`

### Summary
Large integration branch (178 commits, 408 TS files) consolidating CI fix, money math hardening, refund JE, LIFF chatbot cap, and 2FA removal. Many of the `Number()` usages flagged below are carried through the diff from older code being reorganized.

### Critical

#### C1 — `Number()` arithmetic on Decimal money fields
**Severity**: Critical  
**Rule**: `database.md` — use `Prisma.Decimal`, never `Float` or `Number()` for financial calculations.

Three locations introduce (or surface) floating-point arithmetic on money values:

| File | Line pattern | Impact |
|------|-------------|--------|
| `apps/api/src/modules/accounting/accounting.service.ts` | `const remaining = Number(p.amountDue) - Number(p.amountPaid ?? 0)` | Aging-bucket report — rounding errors could misclassify payments |
| `apps/api/src/modules/data-audit/data-audit.service.ts` | `.reduce((sum, p) => sum + Number(p.amountDue) - Number(p.amountPaid), 0)` | Data audit outstanding balance — float error accumulates across many installments |
| `apps/api/src/modules/notifications/scheduler.service.ts` | `(sum, p) => sum + (Number(p.amountDue) - Number(p.amountPaid) + Number(p.lateFee))` (×2) | Overdue notification threshold — could send/skip notification incorrectly |

**Fix**: Replace with `Prisma.Decimal` arithmetic:
```ts
// accounting.service.ts
import { Prisma } from '@prisma/client';
const remaining = new Prisma.Decimal(p.amountDue).minus(p.amountPaid ?? 0);

// reduce pattern
const total = payments.reduce(
  (sum, p) => sum.plus(new Prisma.Decimal(p.amountDue).minus(p.amountPaid ?? 0)),
  new Prisma.Decimal(0),
);
```

---

### Warning

#### W1 — `POST /shop/reviews` missing `@Roles()` decorator
**File**: `apps/api/src/modules/shop-reviews/shop-reviews.controller.ts`

```ts
@Post()
@UseGuards(JwtAuthGuard)   // ← RolesGuard absent; no @Roles()
create(@Body() dto: CreateReviewDto, @Req() req: ...) { ... }
```

Any JWT-authenticated user (OWNER, SALES, ACCOUNTANT etc.) can write product reviews. The GET routes are correctly public (shop storefront, `security.md` allows `shop-reviews` read). The write path should either:
- Add `@UseGuards(JwtAuthGuard, RolesGuard) + @Roles('CUSTOMER')` if a CUSTOMER role is planned, or
- Add a comment confirming staff-review is intentional per owner decision

The service does enforce a verified-purchase gate, which mitigates some risk, but role enforcement is the first line of defense.

#### W2 — `POST /line-oa/slip-upload` is fully public (no JWT)
**File**: `apps/api/src/modules/line-oa/line-oa-payment.controller.ts`

The slip-upload endpoint has `@SkipCsrf()` and rate-limit (`5/min`) but no authentication guard. This allows anyone on the internet to upload files as long as they can POST to the endpoint. Rate-limiting provides some protection, but unauthenticated file upload to S3 is a potential abuse vector.

Confirm this is intentional for LIFF customers submitting payment slips, and document it in `security.md`'s intentionally-public endpoint list.

#### W3 — `LoginTwoFactorDto`: `email` and `password` fields missing Thai error messages
**File**: `apps/api/src/modules/auth/dto/two-factor.dto.ts`

```ts
@IsString()
@IsNotEmpty()   // ← no { message: '...' }
email: string;
```

Minor inconsistency with `backend.md` convention (error messages in Thai). Other fields in the same DTO have Thai messages.

---

### Info

#### I1 — `.toNumber()` used for display-only formatting
Many `Decimal.toNumber()` and `Number(...).toLocaleString()` calls appear in template string contexts (PDF generation, flex messages). These are acceptable for display-only — they do not feed back into financial computations.

#### I2 — `data-audit/data-audit.service.ts` journal debit/credit reduction
`hpLines.reduce((sum, l) => sum + Number(l.debit) - Number(l.credit), 0)` — similar to C1 but in the data-audit (diagnostics) path. Lower business impact but should still use Decimal for consistency and correctness.

---

### Recommendation: **REVIEW**
C1 (Decimal arithmetic) should be fixed before merge. W1/W2 need owner confirmation on intent.

---

## Branch 2: `feat/payroll-backfill`

### Summary
Builds on `fix/ci-pre-existing-test-failures`. Unique additions: Employee Master backend (PR-A), Employee Master page (PR-B), PayrollLine→Employee link (PR-C), backfill CLIs (PR-D). The new employee/payroll code is clean.

### Critical
None found in the unique employee/payroll commits.

### Warning

#### W1 — `TwoFactorController` missing `@Roles()` on all methods
**File**: `apps/api/src/modules/two-factor/two-factor.controller.ts`

```ts
@UseGuards(JwtAuthGuard)   // ← RolesGuard absent at class level
@Controller('2fa')
export class TwoFactorController {
  @Post('enroll')           // no @Roles()
  @Post('confirm')          // no @Roles()
  @Post('disable')          // no @Roles()
  @Post('backup-codes')     // no @Roles()
```

2FA enrollment should be available to all authenticated users regardless of role (by design). If that is the intent, add a comment clarifying this is intentionally role-agnostic and document it in `security.md`. Without `RolesGuard`, the `@Roles` decorator on other controllers does not apply here as an implicit default.

#### W2 — Same `LoginTwoFactorDto` Thai message gap (carried from branch 1)
See Branch 1 W3 — same file, same issue.

#### W3 — `employees.controller.ts` includes `VIEWER` role in `@Roles()` on `findPickable`
**File**: `apps/api/src/modules/employees/employees.controller.ts`

`GET /employees/pickable` uses `@Roles('OWNER', 'ACCOUNTANT', 'FINANCE_MANAGER')`. The main list and CRUD operations restrict to OWNER+ACCOUNTANT only. This asymmetry is probably intentional (FM needs to pick employees in payroll forms), but worth confirming.

### Info

#### I1 — Employee Master properly uses `new Prisma.Decimal(dto.baseSalary)`
The new `baseSalary` field correctly converts to Decimal on write and returns `Decimal → string in JSON` as a comment explains. No float issues.

#### I2 — Backfill CLIs are `dry-run` by default with explicit `--execute` flag
`backfill-payroll-user-fk.cli.ts` follows a safe pattern: dry-run by default, two-pass (tier-1 auto / tier-2 audited), writes audit trail. Well-structured.

---

### Recommendation: **REVIEW**
No blocking Critical issues in the unique code. W1 (2FA roles) needs documentation or role check clarification before merge. Branch cannot be cleanly merged until `fix/ci-pre-existing-test-failures` (its base) resolves C1.

---

## Branch 3: `feat/payroll-employee-link`

### Summary
Most focused of the three. 10 unique commits, 19 changed files. Adds `PayrollLine.userId` nullable FK, employee snapshot derivation with PII masking, `EmployeeCombobox` component, and `GET /sso-config/effective` endpoint. Solid test coverage (242-line spec for payroll-user-link, 48-line SSO controller spec).

### Critical
None found.

### Warning

#### W1 — `PayrollLineInput.userId` uses `@IsString()` instead of `@IsUUID()`
**File**: `apps/api/src/modules/expense-documents/dto/create-payroll.dto.ts`

```ts
@IsString()
@IsOptional()
userId?: string;
```

Since `userId` is a FK to `User.id` (UUID), it should be validated as a UUID:

```ts
@IsUUID('4', { message: 'userId ต้องเป็น UUID ที่ถูกต้อง' })
@IsOptional()
userId?: string;
```

Without `@IsUUID()`, a malformed string (e.g. an email address or a sequential integer) would pass validation and reach the DB layer, causing a Prisma FK violation with a confusing error.

### Info

#### I1 — Good security posture
- `SsoConfigController` properly uses `@UseGuards(JwtAuthGuard, RolesGuard)` at class level + `@Roles()` on the single GET method
- `EmployeeCombobox.tsx` uses `useQuery` from `@tanstack/react-query` (not raw `fetch`)
- `PayrollLinesSection.tsx` has no mutations (read-only combobox for pre-fill), so no `invalidateQueries` needed
- PII masking (`payroll-pii-mask.util.ts`) prevents `employeeName`/`taxId` leaking to non-OWNER roles

#### I2 — Prisma Decimal used correctly
`baseSalary` and SSO amounts use `new Prisma.Decimal()` — no float issues.

#### I3 — JE anti-regression test added
`payroll.template.spec.ts` includes a test that `userId` on a line does NOT affect the journal entry amounts — this prevents future regressions where PII linkage accidentally changes accounting behaviour.

---

### Recommendation: **APPROVE** (with W1 fix)
Fix `@IsUUID()` on `userId` before merge. The rest is clean. Note: branch stacks on `feat/payroll-backfill` which stacks on `fix/ci-pre-existing-test-failures` — all three need to merge in sequence.

---

## Cross-Branch Summary

| Issue | Branch(es) | Severity | Status |
|-------|-----------|----------|--------|
| `Number()` arithmetic on `amountDue`/`amountPaid` money fields | fix/ci, payroll-backfill | Critical | Must fix |
| `POST /shop/reviews` missing `@Roles()` | fix/ci, payroll-backfill | Warning | Confirm intent or add role |
| `POST /line-oa/slip-upload` unauthenticated file upload | fix/ci, payroll-backfill | Warning | Document in security.md |
| `LoginTwoFactorDto` missing Thai error messages | payroll-backfill | Warning | Minor |
| `TwoFactorController` no `@Roles()` | payroll-backfill | Warning | Document as intentional |
| `PayrollLineInput.userId` should use `@IsUUID()` | payroll-employee-link | Warning | Easy fix |

**Merge order (when cleared)**: `fix/ci` → `feat/payroll-backfill` → `feat/payroll-employee-link`
