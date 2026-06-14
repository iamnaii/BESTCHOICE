# Pre-Merge Guard Report — 2026-06-14

**Agent**: Pre-Merge Guard  
**Scope**: Top 2 open feature branches by recency  
**Date**: 2026-06-14  
**Repo**: iamnaii/BESTCHOICE

---

## Branches Reviewed

| # | Branch | Commits ahead | Files changed | Recommendation |
|---|--------|--------------|---------------|----------------|
| 1 | `feat/payroll-backfill` | 25+ | ~490 TS/TSX files | **REVIEW** |
| 2 | `fix/ci-pre-existing-test-failures` | 15+ | ~370 TS/TSX files | **REVIEW** |

> Note: 374 total unmerged branches exist. Only the 2 most recently updated feature branches were reviewed. Both share a very large common base; `feat/payroll-backfill` is a strict superset of its predecessor PRs.

---

## Branch 1: `feat/payroll-backfill`

### Summary

Multi-PR series (PR-A → PR-D) implementing the Employee Master and Party Master Mandatory features:

- **PR-A** (`feat/employee-master`): `EmployeeProfile` model + `/employees` NestJS module
- **PR-B** (`feat/employee-master-ui`): `/employees` React page + CRUD dialogs
- **PR-C** (`feat/payroll-employee-link`): Link `PayrollLine → EmployeeProfile`, `GET /sso-config/effective`, `EmployeeCombobox`
- **PR-D** (`feat/payroll-backfill`): Backfill CLIs for payroll user FK and employee profile provisioning
- **Party Master**: `ContactCombobox` replacing free-text on supplier/customer/trade-in pickers (P1–P4)

### File Changes Overview

| Area | Type | Count |
|------|------|-------|
| New controllers | `shop-promotions.controller.ts` | 1 |
| Removed controllers | `two-factor.controller.ts` (guarded; linked to 2FA removal) | 1 |
| New services (extracted) | Accounting, asset, contract, customer sub-services | ~30 |
| New CLI tools | `backfill-employee-profiles.cli.ts`, `backfill-payroll-user-fk.cli.ts` | 2 |
| New frontend pages | `EmployeesTab.tsx` (settings), `PromotionsPage.tsx` (web-shop) | 2 |
| Prisma schema | `EmployeeProfile` model + 2 migrations | — |

---

### Critical Issues

**None found.**

| Check | Result |
|-------|--------|
| Missing `@UseGuards(JwtAuthGuard)` on new controllers | ✅ None missing. `ShopPromotionsController` intentionally public — matches `security.md` whitelist for `shop-*` storefront |
| `Number()` mid-calculation on money fields | ✅ None. `.toNumber()` calls in `transactional-report.service.ts` are at the JSON serialization boundary only (end of Decimal chain) |
| Missing `deletedAt: null` in new queries | ✅ Queries reviewed (commission, chartOfAccount) include `deletedAt: null` |
| Hardcoded secrets or API keys | ✅ None in production code. Test seeds use known dev credentials (`admin@bestchoice.com / x`) |
| SQL injection via unparameterized `$queryRaw` | ✅ All raw SQL uses `Prisma.sql` tagged template literals (parameterized) — seen in `customer-analytics.service.ts`, `receivables-report.service.ts` |
| Missing `@Roles()` on controller methods | ✅ No new methods without `@Roles` |

---

### Warning Issues

**W1 — TypeScript `any` in contract document rendering utilities**

Files:
- `apps/api/src/modules/contracts/services/contract-document-format.util.ts`
- `apps/api/src/modules/contracts/services/document-rendering.service.ts`
- `apps/api/src/modules/contracts/services/document-persistence.service.ts`

Instances (~11 in production code):
```typescript
async replacePlaceholders(html: string, contract: any, lessorSig?: ...): Promise<string>
const payments: any[] = contract.payments || [];
(p: any) => ...
const references: any[] = contract.customer?.references || [];
```

These `any` types bypass TypeScript's type checking on the contract object passed to document rendering. A future contract schema change won't produce a compile-time error here. The risk is low because the contract data is pre-validated at the service layer, but proper interfaces should be defined.

**Suggested fix**: Extract a `ContractDocumentData` interface from the Prisma select shape used by the callers.

---

**W2 — EmployeesPage.tsx simplification removes QueryBoundary**

`apps/web/src/pages/EmployeesPage.tsx` was refactored to just re-export `EmployeesTab`:
```tsx
export default function EmployeesPage() {
  useDocumentTitle('พนักงาน');
  return <EmployeesTab />;
}
```

The original page had `QueryBoundary` wrapping. Verify `EmployeesTab.tsx` includes its own `QueryBoundary` (or equivalent error/retry UI) to maintain the v4 hardening standard that all data-list pages have error+retry UI.

---

### Info

**I1 — Large scope makes holistic review difficult**

This branch has 713 files changed vs the merge base (78k insertions, 210k deletions). The deletions are largely due to prior merges already in `main`. The effective new code is much smaller (PR-A through PR-D combined), but reviewers should ideally review each PR's diff individually rather than the cumulative branch.

**I2 — SSO config endpoint pre-exists in `main`**

The `GET /sso-config/effective` referenced in PR-C commit already exists in `main` at `apps/api/src/modules/sso-config/sso-config.controller.ts`, correctly guarded with:
```typescript
@UseGuards(JwtAuthGuard, RolesGuard)
@Get('effective')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
```
PR-C only wired the frontend to this existing endpoint. No new security surface.

**I3 — PII masking util for payroll is well-tested**

`payroll-pii-mask.util.ts` (new file) has a corresponding `payroll-pii-mask.util.spec.ts`. The FM-cleared PII decision is documented in the commit. Good practice.

---

### Recommendation: REVIEW

No blocking issues. Merge is safe from a security standpoint. Resolve W1 (TypeScript `any` in contract rendering) and verify W2 (QueryBoundary in EmployeesTab) before final approval.

---

## Branch 2: `fix/ci-pre-existing-test-failures`

### Summary

Contains everything in `feat/payroll-backfill` PLUS a series of fixes targeting the merge gate:

| Commit | Description |
|--------|-------------|
| `fix(api): Wave-1 autonomous batch` | 5 bug fixes: payment, contract, audit paths |
| `fix(money): Wave 2 — commission + PO VAT` | Exact Decimal arithmetic for commission × rate |
| `fix(api): Wave-1 money — manual-JE + early-payoff 100x` | **Critical business fix**: early-payoff was 100× over-discounting |
| `fix(finance-receivable): cap commissionRate at 1` | Prevents negative receivable when rate > 1 |
| `fix(chatbot-finance): cap LIFF late-fee quote` | Chatbot showed wrong late fee |
| `chore(accounting): remove BankReconciliationService` | Dead code removal (was unwired) |
| `chore: remove staff-login 2FA` | Schema migration + backend/frontend removal |
| `test(api): Wave 2/3 characterization (+189 tests)` | Golden tests for regulated money paths |
| `ci(e2e): exclude approval-workflow harness` | Excludes incomplete test from CI gate |

---

### Critical Issues

**None found.**

| Check | Result |
|-------|--------|
| Guards on new/changed controllers | ✅ Same as Branch 1; no new unguarded endpoints |
| Money calculation safety | ✅ Early-payoff 100x fix uses Decimal correctly; commission cap uses numeric comparison |
| SQL injection | ✅ Same as Branch 1 |
| Hardcoded secrets | ✅ None |

---

### Warning Issues

**W1 — 2FA removal prerequisite not verified**

Commit `c215e303` has message: *"remove staff-login 2FA (backend+frontend+schema) — **needs login test before merge**"*

The 2FA module removal is accompanied by migration `20260971000000_remove_2fa`. Before merging, confirm:
1. End-to-end login flow works without 2FA in a staging environment.
2. No active users have 2FA enrolled in production (or they've been notified).
3. The `apps/api/prisma/schema.prisma` no longer references 2FA fields that would break migration.

**W2 — Early-payoff fix is a high-impact money path change**

`fix(api): Wave-1 money — manual-JE exact balance (#10) + early-payoff false-100x (#4/#11)` corrects a bug where the early-payoff discount was 100× too large. This is a high-impact financial path. Confirm:
- The `EarlyPayoffJP4Template` test coverage covers the fixed case.
- The fix uses `Prisma.Decimal` arithmetic throughout (not `Number()` mid-calculation).

**W3 — Same `any` typing warnings as Branch 1**

Same contract rendering `any` types (W1 from Branch 1) carry over here.

---

### Info

**I1 — Test coverage significantly improved**

Wave 2/3 characterization tests add 189 tests (+84, +105 in two commits) covering:
- MDM auto-lock/unlock
- PaySolutions cross-path
- Finance tools (chatbot)
- PDPA encryption
- Analytics

This is a strong positive signal for merge readiness.

**I2 — `BankReconciliationService` removal is correct**

The `accounting.md` rules and code confirm this was dead/unwired code. The commit references dead code audit issue #18. Safe to remove.

**I3 — `ci(e2e): exclude approval-workflow harness`**

The approval-workflow E2E spec is incomplete and being excluded from the CI gate. The spec file remains in the repo (not deleted), which is appropriate. Ensure it's tracked in the backlog for completion.

---

### Recommendation: REVIEW

No critical security or data integrity issues. Resolve W1 (verify 2FA login flow works post-removal) before merging. W2 (early-payoff fix) should have test coverage confirmed. The money fixes are important and correct the direction.

---

## Summary Table

| Branch | Critical | Warning | Info | Verdict |
|--------|----------|---------|------|---------|
| `feat/payroll-backfill` | 0 | 2 | 3 | **REVIEW** |
| `fix/ci-pre-existing-test-failures` | 0 | 3 | 3 | **REVIEW** |

---

## Checklist Before Merge (Either Branch)

- [ ] TypeScript `any` in contract rendering utilities addressed or accepted with comment
- [ ] `EmployeesTab.tsx` confirmed to have QueryBoundary / error+retry UI
- [ ] 2FA removal tested end-to-end on staging login flow
- [ ] Early-payoff fix confirmed covered by `EarlyPayoffJP4Template` test
- [ ] Approval-workflow E2E spec tracked in backlog for later completion
- [ ] `./tools/check-types.sh all` passes (0 TypeScript errors)
- [ ] `./tools/run-tests.sh` passes (lint + types + unit tests)

---

*Generated by Pre-Merge Guard agent — 2026-06-14*
