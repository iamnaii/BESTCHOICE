# Merge Guard Report — Employee Master Stack
**Date**: 2026-06-21  
**Reviewed by**: Pre-Merge Guard (automated)  
**Author**: Akenarin Kongdach

---

## Branches Reviewed (5 branches, sequential merge stack)

| Branch | Commits | Files | Age |
|--------|---------|-------|-----|
| `fix/ci-pre-existing-test-failures` | 2 | 4 | 13 days |
| `feat/employee-master` (PR-A) | 12 | 12 | 2 weeks |
| `feat/employee-master-ui` (PR-B) | 6 | 8 | 2 weeks |
| `feat/payroll-employee-link` (PR-C) | 10 | 22 | 2 weeks |
| `feat/payroll-backfill` (PR-D) | 3 | 6 | 2 weeks |

---

## Branch 1: `fix/ci-pre-existing-test-failures`

**Recommendation: ✅ APPROVE**

### Changes
- `e2e/jest-e2e.json` — adds `testPathIgnorePatterns: ["approval-workflow.e2e-spec.ts"]` to exclude an incomplete harness (tracked in #1192)
- `contract-signing-workflow.spec.ts` — adds missing `findUniqueOrThrow` mock + `installmentSchedule` mock so the spec passes
- `env-validation.spec.ts` — removes 2 tests that asserted `ENCRYPTION_KEY` is required in prod; that field was removed in #1169 (2FA deleted)

### Issues
None. All changes are test-infrastructure maintenance. The approval-workflow exclusion is explicitly documented with a comment + issue reference. The `ENCRYPTION_KEY` removal is correct — PII now uses the `PII_ENCRYPTION_KEY` path which still has coverage.

---

## Branch 2: `feat/employee-master` (PR-A — Backend module)

**Recommendation: ✅ APPROVE**

### Changes
- New `EmployeeProfile` Prisma model (1:1 with `User`, soft-delete, Decimal `baseSalary`)
- New `EmployeesModule` (controller + service + 3 DTOs + 171-line spec)
- Migration `20260969000000_add_employee_profile`
- `app.module.ts` registration

### Issues

#### Info
- **`baseSalary` typed as `number` in DTO but correctly converted to `Prisma.Decimal` in service** — this is the standard DTO boundary pattern in this codebase (class-validator validates the HTTP input as a number; service wraps with `new Prisma.Decimal()` before persistence). Not a bug.
- **`BRANCH_MANAGER` and `SALES` excluded from all endpoints** — intentional per the spec. `FINANCE_MANAGER` gets read-only `pickable` access only. This matches the principle-of-least-privilege for payroll PII.

### Security Review
- ✅ `@UseGuards(JwtAuthGuard, RolesGuard)` at class level
- ✅ All 7 methods have `@Roles()` decorators
- ✅ `deletedAt: null` present in all queries (soft-delete-aware)
- ✅ `nationalId` masked in `list()` (`•••••••••XXXX`) — full value only on `findOne()` (OWNER/ACCOUNTANT only)
- ✅ `pickable()` and `provisionable()` explicitly exclude `nationalId` from the SELECT (PII-safe)
- ✅ No raw SQL injection risk — no `$queryRaw` usage
- ✅ `P2002` conflict correctly caught and mapped to `ConflictException`
- ✅ Soft-delete pattern followed (no hard deletes)
- ✅ `baseSalary` uses `Prisma.Decimal` — no `Number()` on money fields

---

## Branch 3: `feat/employee-master-ui` (PR-B — Frontend page)

**Recommendation: ✅ APPROVE**

### Changes
- `EmployeesPage.tsx` — list page with search, pagination, RBAC-aware actions
- `ProvisionEmployeeDialog.tsx` — create dialog (picks provisionable user, fills payroll fields)
- `EditEmployeeDialog.tsx` — edit + soft-delete dialog
- `apps/web/src/lib/api/employees.ts` — API client (all calls use `api.get/post/patch/delete`)
- `apps/web/src/App.tsx` — lazy-loaded route `/employees`
- `apps/web/src/config/menu.ts` — menu entry (OWNER/ACCOUNTANT only)
- `EmployeesPage.test.tsx` — 104-line test

### Issues

#### Warning
- **`/employees` route added without a role-specific `ProtectedRoute` wrapper** — This is a **non-issue** because `MainLayout` itself is already wrapped in `<ProtectedRoute>` (the global auth gate), and the menu only exposes the link to OWNER/ACCOUNTANT. Any other authenticated role that navigates directly will still render the page (they'll just see empty data or 403 from the API). **Recommendation**: add `<ProtectedRoute roles={['OWNER', 'ACCOUNTANT']}>` to mirror the API's guards, consistent with other sensitive pages like `/chatbot-finance/knowledge`. Low severity since API guards are the real gate.

### Security Review
- ✅ All API calls use `api.get/post/patch/delete` from `@/lib/api`
- ✅ `useQuery`/`useMutation` from React Query — no raw `fetch()`
- ✅ `queryClient.invalidateQueries()` called after every mutation
- ✅ `toast.success/error` from `sonner` — no `alert()/confirm()`
- ✅ `React.lazy()` for route code splitting
- ✅ No hardcoded hex colors — semantic tokens used throughout
- ✅ Thai UI text and error messages

---

## Branch 4: `feat/payroll-employee-link` (PR-C — Payroll ↔ Employee FK)

**Recommendation: ✅ APPROVE**

### Changes
- `PayrollLine.userId` nullable FK → `User` (migration `20260970000000`)
- `createPayroll.dto.ts` — `userId` optional, `employeeName` now optional (derived from user when `userId` present)
- `expense-documents.service.ts` — server derives `employeeName`/`employeeTaxId` from `userId` (never trusts client PII snapshot)
- `expense-documents.controller.ts` — `findOne` passes viewer role for PII masking
- `maskPayrollTaxIds()` — masks `employeeTaxId` in list response for roles below OWNER/ACCOUNTANT/FINANCE_MANAGER
- New `sso-config.controller.ts` — `GET /sso-config/effective` (returns SSO ceiling/rate for payroll pre-fill)
- `EmployeeCombobox.tsx` + `PayrollLinesSection.tsx` — payroll form picks employee, pre-fills base salary + SSO
- Multiple test files updated

### Issues

#### Info
- **`maskPayrollTaxIds` mutates the response object in place** — functional but unconventional. Not a bug since Prisma returns plain objects (not proxied). No risk of mutating DB state.
- **`employeeName` becoming optional in DTO with server-side derivation** — correctly guarded in service: throws `BadRequestException` when both `userId` and `employeeName` are absent. Covered by tests.

### Security Review
- ✅ `sso-config.controller.ts` has `@UseGuards(JwtAuthGuard, RolesGuard)` at class level
- ✅ `GET /sso-config/effective` restricted to OWNER/BRANCH_MANAGER/FINANCE_MANAGER/ACCOUNTANT (no SALES/public access)
- ✅ PII masking: `employeeTaxId` masked for roles without payroll PII clearance
- ✅ Server derives employee data from DB when `userId` is present — does not trust client-supplied `employeeName`/`employeeTaxId`
- ✅ No raw SQL injection risks
- ✅ `$queryRaw` not used in new code

---

## Branch 5: `feat/payroll-backfill` (PR-D — One-time backfill CLIs)

**Recommendation: ✅ APPROVE**

### Changes
- `backfill-employee-profiles.cli.ts` — provisions `EmployeeProfile` rows for all active non-system users that lack one
- `backfill-payroll-user-fk.cli.ts` — links legacy `PayrollLine` rows to a `User` via tier-1 (taxId) or tier-2 (name match, audited)
- 2 test files (unit tests for the pure matching logic)
- No Prisma schema changes

### Issues
None found.

### Security Review
- ✅ `EXPECTED_DB_NAME` environment variable guard (prevents running on wrong DB)
- ✅ Production requires `ALLOW_PROD_BACKFILL=YES_I_AM_SURE` + 5-second abort window
- ✅ `$queryRaw\`SELECT current_database()\`` uses tagged template literal (no injection risk)
- ✅ Idempotent: only touches rows with `userId IS NULL`, P2002 swallowed on re-run
- ✅ Tier-2 name matches written to CSV for owner review before auto-linking
- ✅ Tier-2 ambiguous (2+ users with same name) → never auto-linked
- ✅ Pure matching logic (`selectProfileCandidates`, `resolvePayrollMatch`) is separately unit-tested with edge cases

---

## Summary

| Branch | Critical | Warning | Info | Verdict |
|--------|----------|---------|------|---------|
| `fix/ci-pre-existing-test-failures` | 0 | 0 | 0 | ✅ APPROVE |
| `feat/employee-master` | 0 | 0 | 1 | ✅ APPROVE |
| `feat/employee-master-ui` | 0 | 1 | 0 | ✅ APPROVE |
| `feat/payroll-employee-link` | 0 | 0 | 1 | ✅ APPROVE |
| `feat/payroll-backfill` | 0 | 0 | 0 | ✅ APPROVE |

**Overall: APPROVE** — No blocking issues found. One low-severity warning on `feat/employee-master-ui` about missing role-scoped `ProtectedRoute` on `/employees` (API guards enforce authorization; this is defense-in-depth). Suggest fixing before merge but not blocking.

### Suggested fix for Warning (employee-master-ui)
```tsx
// apps/web/src/App.tsx
<Route
  path="/employees"
  element={
    <ProtectedRoute roles={['OWNER', 'ACCOUNTANT']}>
      <EmployeesPage />
    </ProtectedRoute>
  }
/>
```
