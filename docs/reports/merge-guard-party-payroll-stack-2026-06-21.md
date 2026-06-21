# Pre-Merge Guard Report — Party Master P3 / Contacts Followups / Payroll Employee Link

**Run date**: 2026-06-21 (run3)
**Reviewed by**: Pre-Merge Guard (automated)
**Branches reviewed**: 3
**Prior coverage today**: run1 (fb-webhook, letters, canned-response) · run2 (contacts-audit-cleanup PR #1150)

---

## Branches Reviewed

| # | Branch | Author | Unique Commits | Last Commit |
|---|--------|--------|----------------|-------------|
| 1 | `feat/party-master-mandatory-p3` | Akenarin Kongdach | 3 new (P3+P4) | 2026-06-04 |
| 2 | `feat/contacts-followups` | Akenarin Kongdach | 2 new (on top of P3) | 2026-06-04 |
| 3 | `feat/payroll-employee-link` | Akenarin Kongdach | 9 new (PR-C payroll) | 2026-06-05 |

> **Branch stack**: These three branches form a linear stack. `contacts-followups` is built on top of `party-master-mandatory-p3`; `payroll-employee-link` is built on top of `contacts-followups` (plus adds Employee Master PR-A/PR-B already reviewed 2026-06-20). Each branch is reviewed only for its incremental commits above its predecessor.

---

## Branch 1: `feat/party-master-mandatory-p3`

**Incremental commits** (beyond already-merged PRs #1143–#1147 and main):
- `b0231fb5` — feat(expense): persist vendor/line supplier FK (P3 backend)
- `1e585c5f` — feat(web): expense form sends vendorSupplierId / line supplierId from picker (P3 frontend)
- `341199a0` — chore(contacts): P4 cleanup — remove dead onTypeName + stub-duplicate Customer guard

**Summary**: Adds durable nullable `Supplier` FK to `ExpenseDocument` (vendorSupplierId) and `ExpenseLine` (supplierId) — the last document type to store contact as free-text only. The frontend picker now threads the resolved supplierId into the submit payload. P4 cleanup removes dead `onTypeName` free-text chain and adds a stub-upgrade guard in `CustomersService.create()` to prevent duplicate Customer rows on same contactId.

### Critical Issues
None.

### Warning Issues
None.

### Info
- **Migration is hand-written SQL** (not prisma generate) — documented in commit message: `prisma migrate dev` was non-interactive-blocked by pre-existing dev-DB drift. Migration `20260968000000_add_expense_vendor_supplier_fk` matches the contact-party-master precedent with `ON DELETE SET NULL` (correct for nullable FK). ✅
- **No controller changes**: The expense controller already had proper `@UseGuards(JwtAuthGuard, RolesGuard)` — the new FK fields are passed through existing DTO paths. ✅
- **Stub-upgrade guard** in `CustomersService.create()` calls `tx.customer.findFirst()` inside the transaction to detect an existing stub on the same `contactId`, then upgrades it via `tx.customer.update()` instead of creating a duplicate. Tests cover this case. ✅
- **DTO validation**: `vendorSupplierId?` and `supplierId?` are `@IsOptional()` (not required — existing programmatic subtypes like payroll/template/credit-note still work). ✅

**Recommendation: APPROVE** — nullable FK addition, clean migration, P4 cleanup tightens the Customer stub path.

---

## Branch 2: `feat/contacts-followups`

**Incremental commits** (beyond party-master-mandatory-p3):
- `a9c7f7db` — fix(contacts): repair-ticket expense sets vendorSupplierId + @IsUUID on FK DTOs
- `ece0da8c` — feat(expense): safe backfill CLI to link historical vendor FK by taxId

**Summary**: Fix A threads `ticket.repairSupplierId` into the auto-created `REPAIR_SERVICE` ExpenseDocument so it carries the party-master FK. Fix B replaces `@IsString()` with `@IsUUID('4')` on `vendorSupplierId` in 5 DTOs (`create.dto.ts`, `create-credit-note.dto.ts`, `create-settlement.dto.ts`, `create-petty-cash.dto.ts`, `trade-in.dto.ts`) to prevent raw FK errors (P2003) on empty-string inputs. The backfill CLI is a one-time idempotent script that links historical `ExpenseDocument.vendorSupplierId` by exact taxId match.

### Critical Issues
None.

### Warning Issues
None.

### Info
- **`$queryRaw` usage** in backfill CLI (`ece0da8c`) — `SELECT current_database()` static query with no user input. Not a SQL injection risk. ✅
- **Production guards**: CLI requires `EXPECTED_DB_NAME` (must match actual DB) + `ALLOW_PROD_BACKFILL=YES_I_AM_SURE` for production apply — mirrors the hardening pattern from wipe-accounting.cli (v3). ✅
- **Dry-run by default**: `--apply` flag required to write; Cloud Run job uses `APPLY=true` env var. ✅
- **@IsUUID fix**: Replacing `@IsString()` with `@IsUUID('4')` on FK fields is a hardening improvement — empty strings ("") would pass `@IsString()` and cause a Postgres FK error (P2003), but fail the UUID regex. `@IsOptional()` is preserved so undefined values still pass validation. ✅
- **9 unit tests** cover all matching edge cases: eligible, no-supplier, ambiguous, null, empty-string, whitespace, supplier-with-null-taxId, second-supplier, empty-supplier-list. ✅

**Recommendation: APPROVE** — clean hardening commit, backfill CLI is safe and well-tested.

---

## Branch 3: `feat/payroll-employee-link`

**Incremental commits** (beyond contacts-followups; Employee Master PR-A/PR-B previously reviewed 2026-06-20):
- `45021c3e` — feat(payroll): add PayrollLine.userId nullable FK + migration (PR-C)
- `f31fd9ae` — feat(payroll): PayrollLineInput.userId + optional employeeName (PR-C)
- `363070c1` — feat(payroll): derive employee snapshot from userId + PII mask (create + read) (PR-C)
- `d0d66466` — test(payroll): JE anti-regression — userId does not affect journal entry (PR-C)
- `2caedc10` — feat(sso-config): GET /sso-config/effective for payroll SSO pre-fill (PR-C)
- `d53eb4af` — feat(employees-ui): pickable API client + ssoConfig.effective client (PR-C)
- `8b77d262` — feat(employees-ui): EmployeeCombobox (no inline-create payroll picker) (PR-C)
- `c22eb56c` — feat(payroll-ui): EmployeeCombobox in PayrollLinesSection + base/SSO pre-fill + userId in payload (PR-C)
- `ca3c8e0f` — docs(payroll): align PR-C plan with FM-cleared PII decision (docs only)

**Summary**: Adds `PayrollLine.userId` (nullable FK → `users`) so payroll lines can be linked to the Employee Master. When `userId` is present the server derives `employeeName`/`employeeTaxId` from `EmployeeProfile` (spec §4.2 — never trust client snapshot); it rejects userIds not in active payroll. PII masking (`maskPayrollTaxIds`) hides nationalId from non-OWNER/ACCOUNTANT/FINANCE_MANAGER roles. Frontend adds `EmployeeCombobox` + SSO auto-pre-fill on employee select.

### Critical Issues
None.

### Warning Issues

**W1 — `parseFloat()` for SSO pre-fill in `PayrollLinesSection.tsx`**

File: `apps/web/src/components/expense-form-v4/PayrollLinesSection.tsx` (commit `c22eb56c`)

```ts
const base = emp.baseSalary != null ? parseFloat(emp.baseSalary) : NaN;
const ceiling = ssoCfg.data ? parseFloat(ssoCfg.data.salaryCeiling) : null;
```

And in `ExpenseFormV4.tsx` (submit payload):
```ts
baseSalary: parseFloat(l.baseSalary),
```

`baseSalary` comes from the API as a Decimal-serialized string (e.g., `"5000.00"`). Using `parseFloat()` converts it to a JS `number`. This was flagged in the previous guard run (2026-06-20-run4) for the same file.

**Risk assessment (lower than typical)**: `baseSalary` and `salaryCeiling` are salary amounts (whole-baht integers in practice: 5000, 17500, 20000). IEEE 754 doubles represent these exactly — no precision loss. The server DTO enforces `@IsNumber({ maxDecimalPlaces: 2 })` and the service wraps received values in `new Prisma.Decimal(l.baseSalary)` before DB write. The SSO pre-fill is a UI convenience only; the server re-validates the contribution cap via `SsoConfigService.validateContribution`. Accounting impact of imprecision: none for typical Thai salary values.

**Still a Warning** because `parseFloat` on Decimal fields is a code-style deviation from project convention — even if safe here, it sets a pattern that could be copied in contexts where precision matters.

**Suggested fix**: Use `Number(emp.baseSalary)` (same result but signaling intent) or `Prisma.Decimal`-aware arithmetic if the `packages/shared` exports it. Or add a comment explaining why `parseFloat` is acceptable here.

### Info

- **New `sso-config/effective` endpoint** (`2caedc10`): `@UseGuards(JwtAuthGuard, RolesGuard)` at class level, `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')` on `@Get('effective')`. No `SALES` access (payroll is above sales scope). Date validation rejects invalid strings with `BadRequestException` before reaching the service. ✅
- **PII masking** (`363070c1`): `maskPayrollTaxIds` is response-only (mutates the return object, never the DB value). Roles `OWNER`, `ACCOUNTANT`, `FINANCE_MANAGER` see the real nationalId; `BRANCH_MANAGER` and `SALES` see `•••••••••XXXX`. ✅
- **Migration** `20260970000000_add_payroll_line_user_fk`: `ON DELETE SET NULL` (correct for nullable FK — keeps payroll history if a user is deactivated). Index on `user_id`. ✅
- **JE anti-regression test** (`d0d66466`): Confirms that adding `userId` to a payroll line doesn't change the journal entry (JE depends on amounts only, not who the employee is). ✅
- **EmployeeCombobox** (`8b77d262`): No inline-create option (payroll picker must select from registry only — no free-text fallback). API calls use `api.get()` from `@/lib/api` via the `employeeApi.pickable()` wrapper. ✅
- **`ca3c8e0f`** is a docs-only commit (1 markdown file, 2 lines changed). ✅

**Recommendation: REVIEW** — W1 `parseFloat` pattern should be addressed (comment or minor refactor) before merge. No blocking security or correctness issues.

---

## Summary

| Branch | Critical | Warning | Info | Verdict |
|--------|----------|---------|------|---------|
| `feat/party-master-mandatory-p3` | 0 | 0 | 3 | **APPROVE** |
| `feat/contacts-followups` | 0 | 0 | 4 | **APPROVE** |
| `feat/payroll-employee-link` | 0 | 1 | 5 | **REVIEW** |

**Merge order**: These branches form a stack — merge P3 first, then contacts-followups, then payroll-employee-link after addressing W1. All migrations are additive nullable FK additions; no destructive schema changes.
