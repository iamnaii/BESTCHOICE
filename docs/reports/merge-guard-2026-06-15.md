# Pre-Merge Guard Report — 2026-06-15

**Run date**: 2026-06-15  
**Branches reviewed**: 3 most recently active feature/fix branches not on `main`

---

## Branch 1: `fix/ci-pre-existing-test-failures`

**Author**: Akenarin Kongdach  
**Commits unique to branch**: 20  
**Last commit**: 2026-06-08 (77f12aed)

### File Changes Summary

| Area | Key Changes |
|------|-------------|
| `auth/` | REMOVED: TwoFactorService, 2FA endpoints, two-factor module |
| `prisma/schema.prisma` | REMOVED: 5 `twoFactor*` columns from `User`, `TwoFactorOtpRequest` table |
| `prisma/migrations/20260971000000_remove_2fa/` | DROP TABLE + DROP COLUMN (IRREVERSIBLE) |
| `finance-tools.service.ts` | Fixed LIFF late-fee quote to use capped formula |
| `utils/late-fee.util.ts` | New shared `computeCappedLateFee` utility |
| `finance-receivable.dto.ts` | Added `@Max(1)` on `commissionRate` |
| `accounting/bank-reconciliation.service.ts` | DELETED (dead code) |
| `e2e/approval-workflow.e2e-spec.ts` | Excluded from CI (incomplete harness) |

### Issues Found

#### 🔴 Critical

**C1 — IRREVERSIBLE 2FA REMOVAL MIGRATION NOT VERIFIED**

Commit `c215e303` removes staff-login 2FA entirely. The migration `20260971000000_remove_2fa` executes:
```sql
ALTER TABLE "users" DROP COLUMN IF EXISTS "two_factor_secret", ...
DROP TABLE IF EXISTS "two_factor_otp_requests";
```

This is **irreversible**. The commit message itself explicitly warns:
> "⚠️ Do NOT merge until staff login is verified end-to-end in staging — merge auto-deploys + applies the migration to prod."

The author acknowledged the risk and marked this WIP. No evidence of end-to-end login verification in staging. Merging this to `main` auto-deploys and drops the 2FA schema from production.

#### ✅ Info

**I1 — commissionRate cap (8578057b)**: Good fix. Prevents negative `netExpectedAmount` when `commissionRate > 1`. DTO bound correct. Tests added.

**I2 — Late-fee cap (d6ef53b3)**: Fixes LIFF chatbot over-quoting fines. New `computeCappedLateFee` utility correctly implements `min(perDay×days, flatCap, amountDue×5%)`. 25 tests cover edge cases.

**I3 — Dead code removal (3d527ec5)**: `BankReconciliationService` was provided/exported but had zero callers. Clean removal with no runtime impact.

### Recommendation

**🔴 BLOCK** — Do not merge until staff login is verified end-to-end in staging (dev + staging environment, both happy path and wrong-password/lockout scenarios). The migration is irreversible. All other changes in this branch are clean.

---

## Branch 2: `feat/payroll-employee-link`

**Author**: Akenarin Kongdach  
**Commits unique to branch**: 10 (PR-C only — employee-payroll link layer)  
**Last commit**: 2026-06-05 (ca3c8e0f)

### File Changes Summary

| Area | Key Changes |
|------|-------------|
| `sso-config/sso-config.controller.ts` | NEW: `GET /sso-config/effective` endpoint |
| `expense-documents/dto/create-payroll.dto.ts` | `employeeName` now optional; added `userId` field |
| `expense-documents/expense-documents.service.ts` | Server-derives `employeeName`/`employeeTaxId` from `userId`; PII masking |
| `components/employees/EmployeeCombobox.tsx` | NEW: Employee picker for payroll form |
| `expense-form-v4/PayrollLinesSection.tsx` | Adds EmployeeCombobox, SSO pre-fill |
| `lib/api/employees.ts` + `lib/api/ssoConfig.ts` | New API clients |
| `prisma/migrations/20260970000000_add_payroll_line_user_fk/` | Adds nullable `userId` FK to `PayrollLine` (additive) |

### Issues Found

#### ✅ No Critical Issues

All new endpoints have proper guards:
- `SsoConfigController`: `@UseGuards(JwtAuthGuard, RolesGuard)` at class level ✓
- `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')` on `effective` endpoint ✓

Money fields: No `Number()` casts on financial values ✓

Soft delete: `deletedAt: null` present in all new queries ✓

PII masking: `maskPayrollTaxIds` correctly masks `employeeTaxId` for non-OWNER/ACCOUNTANT roles ✓

Validation: Thai error messages on DTOs ✓ (`'ชื่อพนักงานต้องมีอย่างน้อย 2 ตัวอักษร'`)

#### ⚠️ Warning

**W1 — `employeeName as string` temporary casts (f31fd9ae)**

Two `as string` casts exist in `expense-documents.service.ts` for `l.employeeName` before the type can be `string | undefined`. The subsequent commit `363070c1` replaces these with proper server-side derivation. When reviewing the complete PR stack these casts are resolved. If any commit is cherry-picked in isolation, TypeScript safety is reduced between those two commits.

**Impact**: Not a runtime bug (service guards against missing name in the derivation step), but worth noting for code-review hygiene. Consider squashing or reordering these commits before merge.

### Recommendation

**✅ APPROVE** — Clean implementation. Proper RBAC, PII masking, and additive migration. The `as string` cast in W1 is a transitional artifact resolved in the same PR stack.

---

## Branch 3: `feat/payroll-backfill`

**Author**: Akenarin Kongdach  
**Commits unique to branch**: 3 new commits on top of `feat/payroll-employee-link` (+Employee Master backend/frontend + backfill CLIs)  
**Last commit**: 2026-06-05 (b92ecc24)

### File Changes Summary

| Area | Key Changes |
|------|-------------|
| `prisma/migrations/20260969000000_add_employee_profile/` | NEW: `employee_profiles` table (UUID PK, 1:1 User FK) |
| `prisma/schema.prisma` | NEW: `EmployeeProfile` model, `EmploymentType` enum |
| `modules/employees/` | NEW: full CRUD module (controller, service, 3 DTOs, spec) |
| `pages/EmployeesPage.tsx` | NEW: `/employees` list page (OWNER/ACCOUNTANT only) |
| `components/employees/ProvisionEmployeeDialog.tsx` | NEW: dialog to assign EmployeeProfile to existing User |
| `components/employees/EditEmployeeDialog.tsx` | NEW: dialog to edit profile + soft-delete |
| `config/menu.ts` | Adds `/employees` to OWNER and ACCOUNTANT menu configs only |
| `cli/backfill-employee-profiles.cli.ts` | CLI: provision profiles for active staff |
| `cli/backfill-payroll-user-fk.cli.ts` | CLI: tier-1 (taxId) + tier-2 (name) linking of legacy PayrollLines |

### Issues Found

#### ✅ No Critical Issues

**Guards**: `EmployeesController` has `@UseGuards(JwtAuthGuard, RolesGuard)` at class level, every method has `@Roles('OWNER', 'ACCOUNTANT')` (except `pickable` which adds `FINANCE_MANAGER`). ✓

**Money**: `EmployeeProfile.baseSalary` is `Decimal @db.Decimal(12, 2)` ✓. No `Number()` on financial fields ✓.

**Soft delete**: All service queries include `deletedAt: null` filters. Test confirms: `expect(prisma.employeeProfile.findMany.mock.calls[0][0].where.deletedAt).toBeNull()` ✓.

**PII**: `nationalId` is masked in `list()` endpoint (returns `***-xxx-xxx`) and only full in `findOne()` (OWNER/ACCOUNTANT only). `pickable` endpoint explicitly comments `NEVER include nationalId here (PII)`. ✓.

**Backfill CLI**: Proper guards — dry-run by default, `ALLOW_PROD_BACKFILL=YES_I_AM_SURE` required for production, `EXPECTED_DB_NAME` validated against current database. Idempotent (only updates `userId IS NULL` rows). ✓.

#### ⚠️ Warning

**W1 — `/employees` route lacks role-gated `ProtectedRoute`**

In `App.tsx` line 487:
```tsx
<Route path="/employees" element={<EmployeesPage />} />
```

Compare to sensitive pages like `/branches`:
```tsx
<Route path="/branches" element={<ProtectedRoute roles={['OWNER']}><BranchesPage /></ProtectedRoute>} />
```

The `/employees` route relies on the parent `<ProtectedRoute>` (requires login) but has no role restriction. A BRANCH_MANAGER or SALES user who navigates directly to `/employees` will see the page skeleton — the API will 403 and `QueryBoundary` will show an error, but they won't be redirected away cleanly.

The menu correctly hides the entry for non-OWNER/ACCOUNTANT roles, so this path requires deliberate URL manipulation. Backend RBAC is enforced. Low severity but inconsistent with the pattern used for other role-restricted pages.

**Suggested fix**:
```tsx
<Route path="/employees" element={
  <ProtectedRoute roles={['OWNER', 'ACCOUNTANT']}>
    <EmployeesPage />
  </ProtectedRoute>
} />
```

#### ℹ️ Info

**I1 — EmployeesPage renders `nationalId` column**: The page renders `e.user.nationalId` in the table. The backend `list()` endpoint masks this for all callers (OWNER/ACCOUNTANT only receive the masked `***-xxx-xxx` form in the list response; detail is unmasked). No raw PII exposure via this column.

**I2 — Backfill tier-2 requires `BACKFILL_ACTOR_USER_ID`**: The CLI correctly requires an actor UUID for audit logging in tier-2 (name-matched) mode, and outputs an audit-review CSV for manual sign-off before applying. Good design.

### Recommendation

**⚠️ REVIEW** — One warning (W1 route protection inconsistency). All critical security and data patterns are correct. The `/employees` route should be wrapped with `ProtectedRoute roles={['OWNER', 'ACCOUNTANT']}` before merge for consistency. All other checks pass.

---

## Summary Table

| Branch | Critical | Warning | Info | Recommendation |
|--------|----------|---------|------|----------------|
| `fix/ci-pre-existing-test-failures` | 1 (2FA migration unverified) | 0 | 3 | 🔴 BLOCK |
| `feat/payroll-employee-link` | 0 | 1 (transitional cast) | 0 | ✅ APPROVE |
| `feat/payroll-backfill` | 0 | 1 (route protection) | 2 | ⚠️ REVIEW |

**Recommended merge order** (once `fix/ci` is unblocked):
1. `feat/payroll-employee-link` — clean, no changes needed
2. `feat/payroll-backfill` — fix W1 route wrapper first
3. `fix/ci-pre-existing-test-failures` — after staging login verification
