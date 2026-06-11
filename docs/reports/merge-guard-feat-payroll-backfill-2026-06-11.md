# Pre-Merge Guard Report

| Field | Value |
|-------|-------|
| **Branch** | `feat/payroll-backfill` |
| **Base** | `origin/main` |
| **Author** | Akenarin Kongdach `<akenarin.ak@gmail.com>` |
| **Report date** | 2026-06-11 |
| **Recommendation** | 🔶 **REVIEW** |

---

## Summary

Large integration branch (158 unique commits ahead of main) combining four
sequential feature slices:

| Slice | PRs included | Scope |
|-------|-------------|-------|
| Party Master Mandatory P0–P4 | #1143–#1149 | Contacts epic — all pickers use `ContactCombobox` |
| Employee Master PR-A | #1151 | `EmployeeProfile` model + `employees` module |
| Employee Master PR-B | #1152 | `/employees` page |
| Employee Master PR-C | #1153 | `PayrollLine.userId` FK + PII masking + `EmployeeCombobox` |
| Employee Master PR-D | *(unmerged)* | Two backfill CLIs (`backfill:employee-profiles`, `backfill:payroll-user-fk`) |

PR-D (backfill CLIs) is the only slice **not yet merged** — PRs #1143–#1153 were
merged into this branch sequentially and are the primary review surface for
the guard's scope (3 newest unmerged commits on this branch vs main).

Reviewed diff surface: `feat/payroll-employee-link...feat/payroll-backfill`
(~20 files, the PR-D delta) plus spot-checks on new controllers introduced by
the full branch.

---

## File Changes Summary (PR-D delta)

| File | Type | Change |
|------|------|--------|
| `apps/api/src/cli/backfill-employee-profiles.cli.ts` | **NEW** | Provisions `EmployeeProfile` rows for all active staff |
| `apps/api/src/cli/backfill-payroll-user-fk.cli.ts` | **NEW** | Links legacy `PayrollLine.userId` by taxId/name matching |
| `apps/api/src/modules/expense-documents/expense-documents.service.ts` | Modified | `findOne()` now passes `viewerRole` to PII masker |
| `apps/api/src/modules/expense-documents/expense-documents.controller.ts` | Modified | `findOne()` injects `@CurrentUser()` for role-based masking |
| `apps/api/src/modules/sso-config/sso-config.controller.ts` | **NEW** | `GET /sso-config/effective` for payroll SSO pre-fill |
| `apps/api/src/modules/sso-config/sso-config.module.ts` | Modified | Exports new controller |
| `apps/web/src/components/employees/EmployeeCombobox.tsx` | **NEW** | Payroll employee picker (useQuery + api.get) |
| `apps/web/src/components/expense-form-v4/PayrollLinesSection.tsx` | Modified | Wires `EmployeeCombobox`, pre-fills base/SSO from employee data |
| `apps/api/prisma/schema.prisma` | Modified | Adds `PayrollLine.userId` nullable FK |
| `apps/api/prisma/migrations/.../migration.sql` | **NEW** | `ALTER TABLE payroll_lines ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE SET NULL` |

---

## Issues by Severity

### 🔴 Critical — None

- **New controllers have proper guards**: `SsoConfigController` has
  `@UseGuards(JwtAuthGuard, RolesGuard)` at class level and `@Roles(...)` on
  every method. `EmployeesController` (PR-A, spot-checked) likewise.
- **No unparameterized `$queryRaw`**: The backfill CLI uses
  `` $queryRaw<[...]>`SELECT current_database()` `` — no user input
  interpolated, no injection surface.
- **No hardcoded secrets or API keys**.
- **Decimal arithmetic**: All salary/SSO/WHT/netPaid calculations use
  `new Prisma.Decimal(...)` arithmetic in the service. No `Number()` on stored
  financial fields.
- **Soft-delete filter**: `employeeProfile.findMany` in both CLIs and the service
  correctly include `deletedAt: null`. `PayrollLine` intentionally has no
  `deletedAt` field (immutable append-only entries per `employees` module design)
  — the missing filter there is correct.

### 🟡 Warning

#### W1 — PII masking scope: `BRANCH_MANAGER` cannot see employee `taxId` in payroll view

**File**: `apps/api/src/modules/expense-documents/expense-documents.service.ts`

```ts
// Current allow-list (unmask if):
if (role === 'OWNER' || role === 'ACCOUNTANT' || role === 'FINANCE_MANAGER') return;
```

`BRANCH_MANAGER` will see `•••••••••XXXX` on all employee tax IDs in payroll
documents they created. This is intentional per the FM-cleared PII decision
(commit `ca3c8e0f` docs note), but it means a BM cannot verify their own
payroll submission has the correct tax IDs.

**Action needed**: Confirm with owner that BM intentionally cannot see
full tax IDs in payroll. If BMs need to submit payroll, consider whether the
masking policy should be relaxed (e.g. mask only for `SALES`, not for the
creator).

#### W2 — Tier-2 name-match backfill writes `PAYROLL_FK_MATCHED_BY_NAME` audit but `BACKFILL_ACTOR_USER_ID` is optional

**File**: `apps/api/src/cli/backfill-payroll-user-fk.cli.ts`

When `--tier=2` is applied with no `BACKFILL_ACTOR_USER_ID`, the audit log
`userId` will be `null`. The CLI warns about this but still proceeds. Per the
audit conventions (`userId` = real UUID FK), null audit entries are non-ideal
for the tier-2 bulk link.

**Action needed**: Make `BACKFILL_ACTOR_USER_ID` required when `--tier=2` is
requested, or at minimum error-exit rather than warn.

### 🟢 Info

#### I1 — `feat/payroll-backfill` is an integration branch, not a clean PR

With 158 unique commits this branch contains all of Party Master + Employee
Master work. PRs #1143–#1153 have already been code-reviewed individually.
The guard's responsibility here is the PR-D delta (CLIs). The branch is not
blocking CI (based on commit messages referencing passing tests).

#### I2 — `PayrollLine.userId` migration uses `SET NULL` on user delete

```sql
ALTER TABLE payroll_lines ADD COLUMN user_id UUID
REFERENCES users(id) ON DELETE SET NULL;
```

This is the correct pattern (preserve payroll history when a user is
soft-deleted or deactivated). Confirmed against Prisma schema
`onDelete: SetNull`.

#### I3 — `backfill:employee-profiles` CLI does not check `ALLOW_PROD_BACKFILL`

The `backfill-employee-profiles.cli.ts` only checks `EXPECTED_DB_NAME` and
`APPLY`. The `backfill-payroll-user-fk.cli.ts` adds the additional
`ALLOW_PROD_BACKFILL=YES_I_AM_SURE` gate for production. Both CLIs are
additive (no deletes), so the asymmetry is acceptable but could be made
consistent for defence-in-depth.

---

## Recommendation: 🔶 REVIEW

No critical blockers. The PR-D code is well-structured and follows the
project's patterns. However:

1. **W1** (PII masking scope) needs owner sign-off before merge — it
   affects what BRANCH_MANAGERs can see in their own payroll documents.
2. **W2** (audit actor for tier-2 backfill) should be tightened.

The bulk of this branch (PRs #1143–#1153) was already reviewed as individual
PRs. Once W1 is confirmed and W2 is addressed, this branch can be
**APPROVED**.
