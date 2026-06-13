# Pre-Merge Guard Report — 2026-06-13 (run6)

**Generated**: 2026-06-13  
**Reviewer**: Pre-Merge Guard Agent  
**Branches reviewed**: 3 (top non-guard/watchdog by recency)

---

## Summary

| Branch | Author | Last Commit | Critical | Warning | Info | Recommendation |
|--------|--------|-------------|----------|---------|------|----------------|
| `fix/ci-pre-existing-test-failures` | Akenarin Kongdach | 2026-06-08 | 1 | 2 | 3 | **BLOCK** |
| `feat/payroll-employee-link` | Akenarin Kongdach | 2026-06-05 | 0 | 1 | 3 | **REVIEW** |
| `feat/payroll-backfill` | Akenarin Kongdach | 2026-06-05 | 0 | 0 | 2 | **APPROVE** |

---

## Branch 1: `fix/ci-pre-existing-test-failures`

**Recommendation: BLOCK**

### File Changes (notable)

```
apps/api/src/modules/auth/auth.controller.ts            — 2FA endpoints removed
apps/api/src/modules/auth/auth.service.ts               — login flow simplified
apps/api/src/modules/refunds/refunds.controller.ts      — new controller
apps/api/src/modules/refunds/refunds.service.ts         — new service
apps/api/src/modules/reports/reports.controller.ts      — updated roles
apps/api/src/modules/contracts/contract-payment.service.ts — Decimal fix
apps/api/src/modules/journal/journal.service.ts         — exact-Decimal balance
apps/api/prisma/schema.prisma                           — drop twoFactor* columns
apps/web/src/pages/LoginPage.tsx                        — 2FA UI residue
apps/web/src/contexts/AuthContext.tsx                   — OTP state machine (dead)
```

### 🔴 Critical

**[C1] 2FA removal not login-tested before merge (commit c215e303)**

The commit message explicitly warns: *"needs login test before merge"* and *"touches login; merge auto-deploys"*. The commit:
- Deleted the entire `two-factor` module (controller, service, DTOs)
- Removed `TwoFactorOtpRequest` model and `User.twoFactor*` columns via migration
- Frontend `LoginPage.tsx` and `AuthContext.tsx` still contain dead OTP state machine code (never triggers, but adds maintenance debt)

The auth flow was changed from a multi-step state machine (returning `OTP_REQUIRED`) to single-step (always returns `AUTHENTICATED`). If the schema migration runs in production without a successful login test in staging first, the column drop is irreversible.

**Action required**: Run a full login flow test (valid credentials → JWT returned → `GET /auth/me` succeeds → refresh → logout) in dev/staging before merging. Then clean up dead OTP branches in `LoginPage.tsx`.

### 🟡 Warning

**[W1] `refunds.controller.ts` missing `BranchGuard`**

File: `apps/api/src/modules/refunds/refunds.controller.ts:26`

```ts
@UseGuards(JwtAuthGuard, RolesGuard)   // ← BranchGuard absent
```

`BRANCH_MANAGER` is in the `@Roles` list for `GET /refunds` and `GET /refunds/:id`. Without `BranchGuard`, a branch manager can list refunds from all branches. The `RefundsService.findAll` has no `branchId` filter. Compare to the standard pattern in `customers.controller.ts` which uses `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)`.

**Action**: Add `BranchGuard` to the controller, pass `user.branchId` to `findAll()`, and add a `branchId` filter in the service query.

**[W2] `VIEWER` role wired to reports without feature flag**

File: `apps/api/src/modules/reports/reports.controller.ts:14`

```ts
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER')
```

The schema comment on `VIEWER` says *"NO @Roles() decorator includes VIEWER by default — other-income, asset modules should add VIEWER when flag is on."* This controller includes `VIEWER` at the class level without a feature-flag gate. If VIEWER accounts exist in production (none currently, per schema), they would gain full read access to all reports without explicit opt-in.

**Action**: Either confirm with owner that VIEWER should have unconditional reports access, or gate behind `SystemConfig.VIEWER_REPORTS_ENABLED`.

### ℹ️ Info

- **[I1] Money precision fix** in `journal.service.ts`: Manual JE balance validation upgraded from `Math.abs(float_diff) <= 0.001` to exact `Prisma.Decimal` equality. Correct change — matches the void-revalidation path.
- **[I2] Wave-2/3 test backfill**: +84 and +105 characterization tests added. Baseline coverage increase is good.
- **[I3] `BankReconciliationService` deleted**: Dead/unwired code removed. No regression risk.

---

## Branch 2: `feat/payroll-employee-link`

**Recommendation: REVIEW**

This branch is stacked on top of a common ancestor with `feat/payroll-backfill`. It adds PR-C: linking `PayrollLine` rows to `EmployeeProfile` records (userId FK, server-derived PII snapshot, SSO pre-fill endpoint, `EmployeeCombobox` UI).

### File Changes (PR-C specific)

```
apps/api/src/modules/expense-documents/expense-documents.controller.ts  — createPayroll updated
apps/api/src/modules/expense-documents/expense-documents.service.ts     — userId resolution
apps/api/src/modules/expense-documents/dto/create-payroll.dto.ts        — userId field added
apps/api/src/modules/sso-config/sso-config.controller.ts                — new endpoint
apps/web/src/components/employees/EmployeeCombobox.tsx                  — new component
apps/web/src/components/expense-form-v4/PayrollLinesSection.tsx         — combobox wired
apps/web/src/lib/api/employees.ts                                       — API client
apps/web/src/lib/api/ssoConfig.ts                                       — API client
```

### 🟡 Warning

**[W1] `PayrollLineInput.userId` not validated as UUID**

File: `apps/api/src/modules/expense-documents/dto/create-payroll.dto.ts` (PayrollLineInput)

```ts
@IsString()
@IsOptional()
userId?: string;
```

The field is declared as a FK to `User` (PostgreSQL UUID). A malformed string (e.g. `"admin"`) will pass DTO validation and then fail with a cryptic Prisma DB error (P2025 or P2023) rather than a clean `400 Bad Request`. Add `@IsUUID('4')` alongside `@IsString()`.

### ℹ️ Info

- **[I1] Guard coverage**: All new controllers (`employees.controller.ts`, `sso-config.controller.ts`) have `@UseGuards(JwtAuthGuard, RolesGuard)` at class level and `@Roles(...)` on every method. ✓
- **[I2] API client pattern**: `apps/web/src/lib/api/employees.ts` uses `api.get()`/`api.post()` from `@/lib/api` — correct pattern, no raw `fetch()`. ✓
- **[I3] `Number()` in `PayrollLinesSection.tsx`** (lines 126, 149): Used only to convert HTML `<select>` option values for year/month integers — not financial fields. Not a precision concern. ✓
- **[I4] `deletedAt` filters**: All new `findMany`/`findFirst` queries in `expense-documents.service.ts` and `employees.service.ts` include `deletedAt: null`. ✓

---

## Branch 3: `feat/payroll-backfill`

**Recommendation: APPROVE**

Adds PR-D: two one-time backfill CLIs for provisioning employee profiles and linking legacy PayrollLine rows to User records. These are CLI-only tools — no new HTTP endpoints, no controller changes.

### File Changes (PR-D specific)

```
apps/api/src/cli/backfill-employee-profiles.cli.ts   — new CLI
apps/api/src/cli/backfill-payroll-user-fk.cli.ts     — new CLI
apps/api/src/cli/backfill-employee-profiles.cli.spec.ts
apps/api/src/cli/backfill-payroll-user-fk.cli.spec.ts
```

### ℹ️ Info

- **[I1] Production guards**: Both CLIs require `EXPECTED_DB_NAME`, `ALLOW_PROD_BACKFILL=YES_I_AM_SURE`, and have a 5-second abort window before writing to production. Matches the established pattern from `wipe-accounting.cli.ts`. ✓
- **[I2] Idempotency**: `backfill-employee-profiles` filters to `userId IS NULL` profiles only; `backfill-payroll-user-fk` guards with `userId: null` filter in `updateMany`. Re-runs are safe. ✓
- **[I3] Tier-2 name matching risk**: The payroll backfill correctly identifies tier-2 (name-only) matches as risky, writes them to a CSV for manual review, and requires `--tier=2` opt-in to apply. Appropriate design. ✓

---

## Appendix: Checks Performed

| Check | fix/ci | payroll-employee-link | payroll-backfill |
|-------|--------|-----------------------|-----------------|
| `@UseGuards(JwtAuthGuard)` on new controllers | ⚠️ W1 | ✅ | N/A (no controllers) |
| `@Roles()` on all methods | ✅ | ✅ | N/A |
| `Number()` on money fields | ✅ (Decimal used) | ✅ (UI int only) | N/A |
| `deletedAt: null` in queries | ✅ | ✅ | ✅ |
| Hardcoded secrets | ✅ (test fixtures only) | ✅ | ✅ |
| SQL injection (`$queryRaw`) | ✅ (parameterized) | N/A | ✅ |
| Raw `fetch()` in frontend | N/A | ✅ (`api.*` used) | N/A |
| `queryClient.invalidateQueries` after mutations | N/A | ✅ (parent form) | N/A |
| DTO validation decorators | N/A | ⚠️ W1 (no `@IsUUID`) | N/A |

---

*Pre-Merge Guard Agent — automated check, not a substitute for human code review.*
