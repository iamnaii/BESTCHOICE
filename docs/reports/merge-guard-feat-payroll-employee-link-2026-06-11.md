# Pre-Merge Guard Report

| Field | Value |
|-------|-------|
| **Branch** | `feat/payroll-employee-link` |
| **Base** | `origin/main` |
| **Author** | Akenarin Kongdach `<akenarin.ak@gmail.com>` |
| **Report date** | 2026-06-11 |
| **Recommendation** | 🔶 **REVIEW** |

---

## Summary

Working branch for Employee Master PR-C — the "link `PayrollLine` to
`EmployeeProfile`" slice. This branch contains 164 unique commits ahead of
main, including the same Party Master + Employee Master PR-A/B foundation as
`feat/payroll-backfill`, plus the **unmerged PR-C UI work** (individual commits
not yet squashed into a merge commit).

The key difference vs `feat/payroll-backfill`:
- `feat/payroll-backfill` has PR-C landed as a single merge commit (#1153),
  then adds PR-D backfill CLIs on top.
- This branch (`feat/payroll-employee-link`) has PR-C as individual commits
  still in flight, without PR-D.

**PR-C unique commits on this branch** (vs `feat/payroll-backfill`):

| Commit | Description |
|--------|-------------|
| `ca3c8e0f` | docs(payroll): align PR-C plan with FM-cleared PII decision |
| `c22eb56c` | feat(payroll-ui): `EmployeeCombobox` in `PayrollLinesSection` + base/SSO pre-fill |
| `8b77d262` | feat(employees-ui): `EmployeeCombobox` (no inline-create payroll picker) |
| `d53eb4af` | feat(employees-ui): pickable API client + `ssoConfig.effective` client |
| `2caedc10` | feat(sso-config): `GET /sso-config/effective` for payroll SSO pre-fill |
| `d0d66466` | test(payroll): JE anti-regression — `userId` does not affect journal entry |
| `363070c1` | feat(payroll): derive employee snapshot from `userId` + PII mask (create + read) |
| `f31fd9ae` | feat(payroll): `PayrollLineInput.userId` + optional `employeeName` |
| `45021c3e` | feat(payroll): add `PayrollLine.userId` nullable FK + migration |
| `e7881352` | docs(payroll): PR-C implementation plan |

---

## File Changes Summary (PR-C delta vs `feat/payroll-backfill`)

| File | Type | Change |
|------|------|--------|
| `apps/api/src/modules/sso-config/sso-config.controller.ts` | **NEW** | `GET /sso-config/effective` endpoint |
| `apps/api/src/modules/expense-documents/expense-documents.service.ts` | Modified | `createPayroll()` resolves `userId` → employee snapshot; `findOne()` masks PII |
| `apps/api/src/modules/expense-documents/expense-documents.controller.ts` | Modified | `findOne()` injects `@CurrentUser()` |
| `apps/web/src/components/employees/EmployeeCombobox.tsx` | **NEW** | Picker component using `useQuery` |
| `apps/web/src/components/expense-form-v4/PayrollLinesSection.tsx` | Modified | Wires `EmployeeCombobox`, pre-fills salary/SSO |
| `apps/web/src/lib/api/employees.ts` | **NEW** | `employeesApi.pickable()` using `api.get()` |
| `apps/api/prisma/schema.prisma` | Modified | `PayrollLine.userId` nullable FK |

---

## Issues by Severity

### 🔴 Critical — None

- **`SsoConfigController`** has `@UseGuards(JwtAuthGuard, RolesGuard)` at class
  level and `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')`
  on the `effective` endpoint. No unguarded routes.
- **Frontend**: `EmployeeCombobox` uses `useQuery` from `@tanstack/react-query`
  and `employeesApi.pickable()` (which calls `api.get()`). No raw `fetch()`.
- **No hardcoded secrets**.
- **Decimal math**: salary/SSO calculations in the service use `new Prisma.Decimal()`
  throughout. `Number()` is not used on stored financial fields.
- **`deletedAt: null`**: Employee profile lookups in the service include the
  soft-delete filter.

### 🟡 Warning

#### W1 — Same PII masking scope concern as `feat/payroll-backfill`

**File**: `apps/api/src/modules/expense-documents/expense-documents.service.ts`

Same as W1 in the `feat/payroll-backfill` report: `BRANCH_MANAGER` cannot see
full employee tax IDs in the payroll `findOne()` response. Needs owner
sign-off that this is the intended behaviour.

#### W2 — `EmployeeCombobox` has no `QueryBoundary` wrapper in `PayrollLinesSection`

**File**: `apps/web/src/components/expense-form-v4/PayrollLinesSection.tsx`

The `EmployeeCombobox` query (`GET /employees/pickable`) uses `useQuery` with
`enabled: open` (only fires when the popover is open). On API error, the
`query.data ?? []` fallback silently shows an empty list with no error
feedback to the user. Should surface an error state (e.g. `query.isError &&
<span>ไม่สามารถโหลดรายชื่อพนักงาน</span>`).

### 🟢 Info

#### I1 — Relationship to `feat/payroll-backfill`

This branch is the source for PR #1153. Once this PR is merged to `main`, the
commits here will also land in `feat/payroll-backfill`. There is no need to
merge both — merging one will make the other's unique commits redundant.
Recommend merging `feat/payroll-employee-link` → `main` as PR-C, then
rebasing `feat/payroll-backfill` on the resulting main for PR-D.

#### I2 — JE anti-regression test in `d0d66466`

`test(payroll): JE anti-regression — userId does not affect the journal entry`
verifies the important invariant that adding `userId` to a payroll line does
not change the double-entry bookkeeping. Good defensive test; confirms the
accounting is unaffected by the new FK.

#### I3 — `ssoConfig.effective` response leaks `salaryCeiling` as `Prisma.Decimal`

The controller returns `cfg.salaryCeiling` and `cfg.maxContribution` as
`Prisma.Decimal` objects, which JSON-serialize to strings. This is functional
(the frontend parses them via `Number()`), but the API contract is implicit.
A DTO or explicit `.toNumber()` / `.toString()` in the response would make the
contract explicit.

---

## Recommendation: 🔶 REVIEW

No critical blockers. The implementation is clean and follows project patterns.

Before merge:
1. **W1** — confirm PII masking policy for `BRANCH_MANAGER` with owner.
2. **W2** — add error state to `EmployeeCombobox` in `PayrollLinesSection` for
   failed employee list fetch.

Once addressed, this branch can be **APPROVED** for merge as PR-C.
