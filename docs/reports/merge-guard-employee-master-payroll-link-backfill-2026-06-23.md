# Pre-Merge Guard Report — 2026-06-23

**Branches reviewed (3 most recently updated)**
| Branch | Last commit | Author |
|---|---|---|
| `feat/employee-master` (PR-A) | 2026-06-04 23:44 BKK | iamnaii / Claude |
| `feat/payroll-employee-link` (PR-C) | 2026-06-05 02:46 BKK | iamnaii / Claude |
| `feat/payroll-backfill` (PR-D) | 2026-06-05 08:52 BKK | iamnaii / Claude |

These three branches form a stacked series: A → C → D. All three must merge together.

---

## Branch 1 — `feat/employee-master` (PR-A)

**What it does:** Adds the `EmployeeProfile` model and `/employees` NestJS module (backend master data for staff).

**Unique new files:**
- `apps/api/prisma/migrations/20260969000000_add_employee_profile/migration.sql`
- `apps/api/src/modules/employees/employees.controller.ts`
- `apps/api/src/modules/employees/employees.service.ts`
- `apps/api/src/modules/employees/dto/create-employee.dto.ts`
- `apps/api/src/modules/employees/dto/update-employee.dto.ts`
- `apps/api/src/modules/employees/dto/list-employees.dto.ts`
- `apps/api/src/modules/employees/employees.module.ts`
- `apps/api/src/modules/employees/employees.service.spec.ts`

### Critical — None found

### Warning — None found

### Info

- **`userSelect` private field includes `nationalId`** (`employees.service.ts`). This is intentional: `list()` masks it to `•••••••••XXXX`, and `findOne()` returns the full value behind `OWNER`/`ACCOUNTANT`-only guard. Pattern is correct but worth a future reviewer knowing.
- **No `deletedAt` on `PayrollLine`** — this is by pre-existing design (PayrollLine uses cascade from the parent `PayrollDetail` document). Not introduced by this branch.

### Checklist

| Rule | Status |
|---|---|
| `@UseGuards(JwtAuthGuard, RolesGuard)` at controller class level | ✅ |
| `@Roles()` on every method | ✅ (`OWNER`/`ACCOUNTANT` on all; `FINANCE_MANAGER` added to `pickable`) |
| `deletedAt: null` in all queries | ✅ |
| Money fields use `Prisma.Decimal` | ✅ (`baseSalary Decimal @db.Decimal(12,2)`) |
| DTO validators with Thai messages | ✅ |
| No hardcoded secrets | ✅ |
| UUID `@id @default(uuid())` | ✅ |
| `createdAt`, `updatedAt`, `deletedAt` on model | ✅ |
| PII safe — nationalId masked in list, full only in detail (restricted endpoint) | ✅ |
| No raw `$queryRaw` with user input | ✅ |

### Recommendation: **APPROVE**

---

## Branch 2 — `feat/payroll-employee-link` (PR-C)

**What it does:** Links `PayrollLine` to an `EmployeeProfile` via nullable `userId` FK. Adds server-side snapshot derivation so the client-submitted employee name/taxId is ignored when a `userId` is present.

**Unique new files:**
- `apps/api/prisma/migrations/20260970000000_add_payroll_line_user_fk/migration.sql`
- `apps/api/src/modules/sso-config/sso-config.controller.ts` (new `GET /sso-config/effective` endpoint)
- `apps/web/src/components/employees/EmployeeCombobox.tsx`
- `apps/web/src/lib/api/employees.ts`
- `apps/web/src/lib/api/ssoConfig.ts`
- Updates to `PayrollLinesSection`, `ExpenseFormV4`, `create-payroll.dto.ts`

### Critical — None found

### Warning — None found

### Info

- **`Number()` at lines 316, 344 of `expense-documents.service.ts`** — These read a `SystemConfig.value` string (stored as varchar) into a number for threshold comparison, then immediately wrap the result in `new Prisma.Decimal()`. Not a precision issue — the config value is a small integer (e.g. 50000). Acceptable.
- **`SsoConfigController.effective` accepts a `date` query param** and parses it with `new Date(date)`. Validates with `Number.isNaN(when.getTime())`. Could be hardened to reject formats other than ISO-8601 but is not a security bug.

### Checklist

| Rule | Status |
|---|---|
| `@UseGuards(JwtAuthGuard, RolesGuard)` at SsoConfigController class level | ✅ |
| `@Roles()` on `GET /sso-config/effective` | ✅ (`OWNER`, `BRANCH_MANAGER`, `FINANCE_MANAGER`, `ACCOUNTANT`) |
| Server-derived snapshot: client `employeeName`/`employeeTaxId` overridden by DB when `userId` present | ✅ |
| `userId`-linked employees validated as active/non-resigned before accepting payroll | ✅ |
| All Decimal calculations use `Prisma.Decimal` throughout `createPayroll()` | ✅ |
| Frontend uses `api.get()`/`api.post()` from `@/lib/api` — no raw `fetch()` | ✅ |
| `EmployeeCombobox` uses `useQuery` + `useDebounce` | ✅ |
| `ProvisionEmployeeDialog` / `EditEmployeeDialog` call `queryClient.invalidateQueries()` on success | ✅ |
| Toast uses `sonner` | ✅ |
| No hardcoded secrets | ✅ |

### Recommendation: **APPROVE**

---

## Branch 3 — `feat/payroll-backfill` (PR-D)

**What it does:** Adds two one-time CLI scripts:
1. `backfill:employee-profiles` — provisions an `EmployeeProfile` for every active non-system `User` without one.
2. `backfill:payroll-user-fk` — links legacy `PayrollLine` rows (where `userId IS NULL`) to a `User` via two-tier matching (taxId = confident; name = manual review CSV).

**Unique new files:**
- `apps/api/src/cli/backfill-employee-profiles.cli.ts`
- `apps/api/src/cli/backfill-payroll-user-fk.cli.ts`
- `apps/api/src/cli/backfill-employee-profiles.cli.spec.ts`
- `apps/api/src/cli/backfill-payroll-user-fk.cli.spec.ts`

### Critical — None found

### Warning — None found

### Info

- **CSV string interpolation in `backfill-payroll-user-fk.cli.ts`**: The `matched-by-name.csv` rows are built with template literals. If `employeeName` contains a comma or double-quote character (e.g. `"สมชาย, เจริญ"`), the CSV will be malformed. This is a cosmetic bug in an internal owner-review file — it won't cause data corruption since it's read-only output, and the full CSV is also emitted to Cloud Logging stdout. Low risk, but worth fixing.

### Checklist

| Rule | Status |
|---|---|
| `EXPECTED_DB_NAME` guard (rejects wrong DB) | ✅ |
| `ALLOW_PROD_BACKFILL=YES_I_AM_SURE` gate for production runs | ✅ |
| 5-second abort window before prod write | ✅ |
| Dry-run by default | ✅ |
| Idempotent: only processes `userId IS NULL` rows | ✅ |
| Tier-2 apply requires real `BACKFILL_ACTOR_USER_ID` verified against DB | ✅ |
| Audit log written for every tier-2 link | ✅ |
| Audit/link count mismatch detected and warned | ✅ |
| No `$queryRaw` with user-controlled input (only `SELECT current_database()` template literal) | ✅ |
| No hardcoded secrets | ✅ |

### Recommendation: **APPROVE** (with optional CSV-encoding fix before running in prod)

---

## Summary

| Branch | Files changed (unique) | Criticals | Warnings | Infos | Verdict |
|---|---|---|---|---|---|
| `feat/employee-master` | 9 | 0 | 0 | 1 | ✅ APPROVE |
| `feat/payroll-employee-link` | 20 | 0 | 0 | 2 | ✅ APPROVE |
| `feat/payroll-backfill` | 4 | 0 | 0 | 1 | ✅ APPROVE |

All three branches are safe to merge. No blocking issues. The single actionable item (CSV encoding in the backfill CLI) is a cosmetic bug in an internal review artifact and does not affect DB correctness or security.

**Optional pre-merge fix**: In `backfill-payroll-user-fk.cli.ts`, replace the bare string-template CSV rows with a proper CSV escaper (e.g. wrap each field in `"` and escape internal `"` as `""`).
