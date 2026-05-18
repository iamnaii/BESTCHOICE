# Pre-Merge Guard Report — 2026-05-18

**Reviewed by**: Pre-Merge Guard agent  
**Date**: 2026-05-18  
**Branches reviewed** (3 most recent by commit date, excluding watchdog/guard/reports/deps):

| # | Branch | Author | Files Changed | Lines |
|---|--------|--------|---------------|-------|
| 1 | `feat/sidebar-sp6` | Akenarin Kongdach | 32 | +4759 / -21 |
| 2 | `feat/a1-d1.3.2.4-reverse-permission` | Akenarin Kongdach | 7 | +197 / -3 |
| 3 | `feat/a1-d1.2.1-frontend-approval-ui` | Akenarin Kongdach | 6 | +505 / -15 |

---

## Branch 1: `feat/sidebar-sp6`

**Description**: SP6 — New `BankAccountsModule` (NestJS controller + service + DTOs + Prisma migration + React frontend page). Adds `/bank-accounts` endpoint and `/finance/bank-accounts` UI page. Bank/cash account directory mirrors CoA codes 11-1101..1203 with live balances computed from posted journal lines.

### File Changes Summary
- `apps/api/src/modules/bank-accounts/` — new module (controller, service, DTOs, spec)
- `apps/api/prisma/migrations/20260941000000_add_bank_accounts/migration.sql` — new table + partial unique index + seed
- `apps/api/prisma/schema.prisma` — new `BankAccount` model
- `apps/api/src/app.module.ts` — `BankAccountsModule` registered
- Frontend: new `BankAccountsPage.tsx` + supporting components

### Issues

#### ⚠️ Warning — PII in Migration Seed (git-permanent)

**File**: `apps/api/prisma/migrations/20260941000000_add_bank_accounts/migration.sql`

Real bank account numbers are hardcoded in the migration seed:
```sql
('11-1201', ..., '203-1-16520-5', ...),
('11-1202', ..., '579-4-13208-8', ...),
('11-1203', ..., '579-4-13209-6', ...),
```

These are committed to git history **permanently** — even if later changed. Under PDPA and internal PII policy, bank account numbers are sensitive. Recommend replacing with placeholder values (e.g. `NULL` or `'xxx-x-xxxxx-x'`) in the migration and letting operators update them via the UI after deploy.

**Severity**: Warning — no security bypass, but PII leak risk in git history.

#### ⚠️ Warning — Invalid Migration Timestamp

**File**: `apps/api/prisma/migrations/20260941000000_add_bank_accounts/migration.sql`

Timestamp `20260941000000` has month `41` which is not a valid calendar date. Prisma uses lexicographic ordering for migrations — this will sort correctly relative to any migration whose timestamp is numerically smaller, but it is confusing and may cause issues with migration tooling that validates timestamps.

Recommend renaming to a valid date-based timestamp (e.g. `20260518000000_add_bank_accounts`).

#### ✅ Security checks passed
- `@UseGuards(JwtAuthGuard, RolesGuard)` present at class level on `BankAccountsController`
- All 6 endpoints have explicit `@Roles(...)` decorators (`OWNER` or `OWNER+FINANCE_MANAGER+ACCOUNTANT`)
- `deletedAt: null` filter present in every Prisma query
- Balance arithmetic uses `Prisma.Decimal` — no `Number()` on financial values
- DTOs have full class-validator decorators with Thai error messages
- Frontend uses `api.get()`/`api.post()` from `@/lib/api` — no raw `fetch()`
- `queryClient.invalidateQueries({ queryKey: ['bank-accounts'] })` called on mutation success
- No hardcoded secrets or API keys
- No BranchGuard — intentionally omitted per accounting spec (FINANCE-global, not branch-scoped)

#### ℹ️ Info — Large test file
`bank-accounts.service.spec.ts` is 346 lines — well within acceptable range and has good test coverage (findAll, findByCode, getTransactions, create, update, disable, balance calculation edge cases).

### Recommendation: **REVIEW**

The two Warning items should be addressed before merge. The PII issue is the higher-priority concern.

---

## Branch 2: `feat/a1-d1.3.2.4-reverse-permission`

**Description**: D1.3.2.4 — Adds `ReversePermissionGuard`, a dynamic role gate for `POST /expense-documents/:id/void`. Mirrors the `PostPermissionGuard` pattern from D1.3.2.3. Reads `reverse_permission` SystemConfig key to allow OWNER to narrow who can reverse/void posted documents.

### File Changes Summary
- `reverse-permission.guard.ts` — new guard + `resolveReversePermissionRoles` shared resolver
- `expense-documents.controller.ts` — `@UseGuards(ReversePermissionGuard)` added to `void` endpoint
- `expense-documents.service.ts` — service-side defense-in-depth check via `resolveReversePermissionRoles`
- `expense-documents.module.ts` — guard registered as provider
- `settings.service.ts` — `reversePermission` added to settings bundle
- `useUiFlags.ts` — `reversePermission` flag type + default
- `reverse-permission.guard.spec.ts` — 4 test cases (default, OWNER_ONLY, malformed value, DB error)

### Issues

None found.

#### ✅ Security checks passed
- `@UseGuards(JwtAuthGuard, RolesGuard)` already at class level (not changed)
- `@Roles('OWNER', 'FINANCE_MANAGER')` remains on method — method-level guard is now the superset
- `ReversePermissionGuard` narrows per-request based on SystemConfig value
- `deletedAt: null` filter present in SystemConfig query
- Safe fallback to `OWNER+FINANCE_MANAGER` (current behavior) on DB error or malformed value
- Service-side check (`resolveReversePermissionRoles`) provides defense-in-depth against guard bypass
- Thai error messages: `ไม่มีสิทธิ์กลับรายการเอกสาร`, `ไม่พบข้อมูลผู้ใช้`
- No hardcoded secrets

#### ✅ Pattern consistency
Exactly mirrors `PostPermissionGuard` (D1.3.2.3) — same exported resolver function, same fallback logic, same module registration pattern.

### Recommendation: **APPROVE**

Clean, well-tested implementation. No issues.

---

## Branch 3: `feat/a1-d1.2.1-frontend-approval-ui`

**Description**: D1.2.1 — Frontend approval workflow UI for expense documents. Adds `useApprovalActions` hook (submit-for-approval + approve mutations), `getApprovalReason` helper, `canApprove` helper, and wires new `PENDING_APPROVAL`/`APPROVED` statuses into `ExpensesPage`. Also adds `approvalThreshold`, `approversList`, `approvalRequiredDocTypes`, and `settingsAccessRole` to `UiFlags`.

### File Changes Summary
- `useApprovalActions.ts` — new hook with 2 mutations + 2 pure helper functions
- `useApprovalActions.test.tsx` — 195-line test file (hook behavior + pure helpers)
- `useUiFlags.ts` — 4 new flags: `approvalThreshold`, `approversList`, `approvalRequiredDocTypes`, `settingsAccessRole`
- `ExpensesPage.tsx` — new status badges (PENDING_APPROVAL / APPROVED), submit/approve buttons in row menu
- `settings.service.ts` (backend) — reads `approvalThreshold`, `approversList`, `approvalRequiredDocTypes` from SystemConfig

### Issues

#### ⚠️ Warning — `getApprovalReason` does not accept `approvalEnabled`

**File**: `apps/web/src/hooks/useApprovalActions.ts` (line ~76)

```ts
export function getApprovalReason(args: {
  totalAmount: number;
  docType: string;
  approvalThreshold: number;
  approvalRequiredDocTypes: string[];
}): string | null
```

The function returns non-null values (e.g. "ทุกเอกสารต้องผ่านการอนุมัติ" when `approvalThreshold === 0`) even when `approvalEnabled === false`. The current call site in `ExpensesPage.tsx` gates the entire block on `uiFlags.approvalEnabled`, so the rendered output is correct today. However, if another caller invokes `getApprovalReason` directly without gating on `approvalEnabled`, it will produce misleading helper text. Consider adding `approvalEnabled: boolean` to the function signature (default `true` for backwards compat) or documenting the assumption.

**Severity**: Warning — current callers are correct, but function contract is fragile.

#### ℹ️ Info — `approvalRequiredDocTypes` uses raw strings, no enum validation

**File**: `apps/web/src/hooks/useApprovalActions.ts` and `apps/api/src/modules/settings/settings.service.ts`

`approvalRequiredDocTypes` is stored as a JSON array of strings in SystemConfig and passed through as `string[]`. If an operator stores a typo (e.g. `"PAYROL"` instead of `"PAYROLL"`), `isRequiredType` silently returns `false` with no error. A Zod/enum validation step in the settings service parse path would make this safer.

**Severity**: Info — low-risk for current usage.

#### ℹ️ Info — `settingsAccessRole` cross-branch dependency

`settingsAccessRole` is added to `UiFlags` type + defaults in this branch. The corresponding backend change that serves this field in the settings API response belongs to `feat/a1-d1.3.2.2-settings-access-role` (different branch). Until that branch is merged, the flag will always render as the safe default `'OWNER'`. No runtime error, but the dependency should be noted in the PR description.

**Severity**: Info.

#### ✅ Security checks passed
- Uses `api.post()` from `@/lib/api` — no raw `fetch()`
- `queryClient.invalidateQueries()` called for `['expenses']` + `['expenses-summary']` on success
- `canApprove` correctly returns `false` when `userId` is null (defensive)
- Backend re-validates `assertUserCanApprove()` — frontend gating is UI-only
- No hardcoded secrets
- `toast.success()` / `toast.error()` from sonner used correctly

### Recommendation: **APPROVE**

No critical issues. The Warning item on `getApprovalReason` is a minor contract clarity issue — acceptable to merge with a comment, or fix in a small follow-up.

---

## Summary Table

| Branch | Critical | Warning | Info | Recommendation |
|--------|----------|---------|------|----------------|
| `feat/sidebar-sp6` | 0 | 2 | 1 | **REVIEW** — fix PII in seed + invalid timestamp before merge |
| `feat/a1-d1.3.2.4-reverse-permission` | 0 | 0 | 0 | **APPROVE** |
| `feat/a1-d1.2.1-frontend-approval-ui` | 0 | 1 | 2 | **APPROVE** (Warning is minor / no current impact) |

---

*Generated by Pre-Merge Guard agent — BESTCHOICE monorepo*
