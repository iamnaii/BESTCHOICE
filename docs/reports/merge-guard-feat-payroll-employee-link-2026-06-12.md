# Merge Guard Report — `feat/payroll-employee-link` (PR-C)

**Date**: 2026-06-12  
**Author**: Akenarin Kongdach  
**Branch**: `feat/payroll-employee-link`  
**Unique commits vs main**: 164 (branch diverged from main; scope of this review = the 10 commits unique to this branch vs `feat/payroll-backfill`)

---

## File Changes Summary (unique to this branch vs `feat/payroll-backfill`)

| File | Type |
|---|---|
| `apps/api/prisma/migrations/20260970000000_add_payroll_line_user_fk/migration.sql` | New migration |
| `apps/api/prisma/schema.prisma` | Schema change |
| `apps/api/src/modules/sso-config/sso-config.controller.ts` | New controller |
| `apps/api/src/modules/sso-config/sso-config.module.ts` | New module |
| `apps/web/src/components/employees/EmployeeCombobox.tsx` | New component |
| `apps/web/src/components/expense-form-v4/PayrollLinesSection.tsx` | Modified |
| `apps/web/src/lib/api/employees.ts` | New API client |
| Test specs (5 files) | Tests |

---

## Commit Summary (unique)

1. `feat(payroll)`: add `PayrollLine.userId` nullable FK + migration (PR-C)
2. `feat(payroll)`: `PayrollLineInput.userId` + optional `employeeName` in DTO
3. `feat(payroll)`: derive employee snapshot from `userId` + PII mask (create + read)
4. `test(payroll)`: JE anti-regression — `userId` does not affect the journal entry
5. `feat(sso-config)`: `GET /sso-config/effective` for payroll SSO pre-fill
6. `feat(employees-ui)`: pickable API client + `ssoConfig.effective` client
7. `feat(employees-ui)`: `EmployeeCombobox` (no inline-create payroll picker)
8. `feat(payroll-ui)`: `EmployeeCombobox` in `PayrollLinesSection` + base/SSO pre-fill + `userId` in payload (PR-C)
9. `docs(payroll)`: align PR-C plan with FM-cleared PII decision
10. PR merge commit

---

## Issues

### Critical — None

### Warning — None

### Info

**Migration is safe for existing data**

```sql
ALTER TABLE "payroll_lines" ADD COLUMN "user_id" TEXT;
CREATE INDEX "payroll_lines_user_id_idx" ON "payroll_lines"("user_id");
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

Column is nullable — no default needed. `ON DELETE SET NULL` is correct (preserves payroll history when a user is deactivated/deleted). Index added. No data migration on deploy.

**New `sso-config` controller properly guarded**

```ts
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('sso-config')
export class SsoConfigController {
  @Get('effective')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async effective(@Query('date') date?: string) { ... }
}
```

Class-level `@UseGuards`, method-level `@Roles`. Input validated (`Number.isNaN(when.getTime())` check, Thai error message). Correct.

**Frontend uses `api` client correctly**

`apps/web/src/lib/api/employees.ts` imports from `@/lib/api` (not raw `fetch`/`axios`). `EmployeeCombobox` uses `useQuery` from `@tanstack/react-query`. No raw fetch calls found.

**Server-derives employee snapshot**

Server reads `employeeName` and `employeeTaxId` from the `User` model when `userId` is provided — the client payload is not trusted for PII fields. This is the correct pattern per security rules.

---

## Recommendation: **APPROVE**

No security issues, no missing guards, no `Number()` on financial DB fields, no raw SQL injection risk. The nullable FK migration is safe to run on a live database. Frontend patterns are compliant with project rules.

> Note: This branch has 164 commits ahead of main due to branch divergence — most of these are the base feature work (PR-A, PR-B shared history). The security review focused on the 10 commits unique to PR-C.
