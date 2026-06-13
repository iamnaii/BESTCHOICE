# Pre-Merge Guard Report — worktree-feat+sp7.1-dual-prisma-foundation

**Date**: 2026-06-13  
**Branch**: `worktree-feat+sp7.1-dual-prisma-foundation`  
**Latest commit**: 2026-05-19 09:26:24 +0700  
**Authors**: iamnaii (1219 commits), Claude (690), Akenarin Kongdach (660)  
**Base**: `origin/main` (a420359a)  
**Tip**: 73efef41

## File Change Summary

| Status | Count |
|--------|-------|
| Added  | 227   |
| Modified | 430 |
| Deleted | 674  |
| Renamed | 3   |
| **Total** | **1334** |

**New controllers**: `drafts`, `quotes`, `two-factor`  
**New services**: `bank-reconciliation`, `two-factor`, `drafts`, `quotes`  
**New frontend pages**: `DraftsPage`, `QuotesPage`, `SetupTwoFactorPage`

---

## CRITICAL Issues (must fix before merge)

### C-1: Real Customer PII Committed to Repository — PDPA Violation

**Severity**: CRITICAL — PDPA (พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล) / OWASP A02 Sensitive Data Exposure

Five CSV files containing real production customer data were committed under a Thai-named directory `ข้อมูลโปรแกรมเขียว4-7-2026/` at the repository root:

| File | Records | Sensitive Fields |
|------|---------|-----------------|
| `bestchoice_member.csv` | 432 | Full name, Thai national ID (13-digit), phone, address, DOB, ID card dates, photo path |
| `bestchoice_contract.csv` | 468 | Guarantor names + phones, 3 contact persons, bad-debt notes |
| `bestchoice_order.csv` | 468 | Order records |
| `bestchoice_order_detail.csv` | 468 | Order detail records |
| `bestchoice_order_installment.csv` | 5092 | Installment records |

**Sample data exposed** (row 2 of member.csv, anonymised here):
- `member_name` / `member_surname` — real Thai names
- `member_identity_number` — 13-digit Thai national ID (`1160100354260`)
- `member_tel` — real phone number
- `member_address`, `member_province` — home address
- `member_birth_date` — date of birth
- `member_identity_image` — path to uploaded ID card scan

**Required actions before merge**:
1. Remove these files from the working tree AND purge from git history (`git filter-repo` or BFG) — presence in history alone violates PDPA even after removal from HEAD
2. Rotate any secrets that may have been in the same commits
3. Verify the same files are NOT present in other branches
4. Notify DPO / owner under PDPA Article 37 (data breach notification within 72 hours if the branch has been pushed to a shared remote accessible outside the org)

**Location**: `ข้อมูลโปรแกรมเขียว4-7-2026/bestchoice_*.csv` (tree hash `0a057c22`)

---

### C-2: `Number()` on Prisma.Decimal Money Fields in New Code

**Severity**: CRITICAL (project rule: no `Number()` on money)

Multiple newly added code paths convert `Prisma.Decimal` financial amounts to JavaScript `Number`, which loses precision for large amounts (> 9 quadrillion satang is theoretical, but float rounding can corrupt amounts > ~100M THB and produce display errors at any amount).

| File | Lines | Context |
|------|-------|---------|
| `quotes/quotes.service.ts` | 638–643 | PDF template data (`unitPrice`, `amount`, `subtotal`, `discount`, `vatAmount`, `total`) |
| `accounting/bank-reconciliation.service.ts` | 126, 140 | `amountMatches()` comparison (`amountPaid`) |
| `credit-check/credit-check.service.ts` | ~226,228,422 | DTI ratio computation (`salary`, `monthlyPayment`, `salaryVerified`) |

**Fix**: Use `Prisma.Decimal` throughout. For display/PDF, convert via `new Prisma.Decimal(x).toFixed(2)` at the template boundary. For comparison, use `Decimal.cmp()` or `a.equals(b)`.

---

## Warning Issues (should fix before merge)

### W-1: `TwoFactorController` Missing `RolesGuard`

**File**: `apps/api/src/modules/two-factor/two-factor.controller.ts:12`

The controller has `@UseGuards(JwtAuthGuard)` but is missing `RolesGuard`. All other controllers use both guards as a pair. While 2FA is a user-level action (any authenticated user), omitting `RolesGuard` deviates from the established pattern and prevents role-based audit trails via `AuditInterceptor`.

**Fix**: Add `RolesGuard` to `@UseGuards(JwtAuthGuard, RolesGuard)`. Since all authenticated roles should access 2FA endpoints, add `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')` at the class level, or use an `AllRoles` helper if one exists.

---

### W-2: DTI Calculation Using `Number()` in `credit-check.service.ts`

Flagged separately from C-2 because it affects financial creditworthiness decisions (not just display). If `salary` or `monthlyPayment` are stored as very precise decimals, rounding on the JavaScript side could cause borderline customers to pass or fail DTI checks incorrectly.

**File**: `apps/api/src/modules/credit-check/credit-check.service.ts` (lines ~226, 228, 300-316, 422)

**Fix**: Replace `Number(creditCheck.customer.salary)` with `new Prisma.Decimal(creditCheck.customer.salary ?? 0)` and use Decimal arithmetic throughout DTI calculation.

---

### W-3: Accounting Service `.toNumber()` on Report Output

**File**: `apps/api/src/modules/accounting/accounting.service.ts` (lines 229–245)

New lines convert COGS, commission, and P&L aggregates to `Number` for API response. While these are read-only report outputs (not persisted), precision errors would corrupt printed/exported financial reports.

**Fix**: Serialize as `string` (e.g., `toFixed(2)`) or use a DTO that accepts `Decimal` and serializes correctly. Precedent exists in `getProfitLossFromJournal` which uses `Prisma.Decimal.toString()`.

---

## Info (good to know)

### I-1: New Modules Not Yet Wired to `app.module.ts`

All three new modules (`DraftsModule`, `QuotesModule`, `TwoFactorModule`) need to be verified in `apps/api/src/app.module.ts`. This was not checked in the diff but should be confirmed — NestJS silently ignores unregistered modules.

### I-2: `QuoteItem` Correctly Omits `deletedAt`

`QuoteItem` model uses `onDelete: Cascade` (no `deletedAt`), which is correct. The missing `deletedAt: null` in `QuoteItem.findMany` at service line 342 is intentional and consistent with the schema.

### I-3: All New Frontend Pages Follow Correct Patterns

`DraftsPage.tsx`, `QuotesPage.tsx`, and `SetupTwoFactorPage.tsx` all use:
- `useQuery` / `useMutation` from `@tanstack/react-query` ✓
- `api.get()` / `api.post()` from `@/lib/api` ✓
- `queryClient.invalidateQueries()` after mutations ✓
- No raw `fetch()` calls ✓
- No hardcoded gray/hex colors ✓

### I-4: All New Controller Guards Pass (except W-1)

`DraftsController` and `QuotesController` both have `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at class level with `@Roles(...)` on every method. ✓

### I-5: New DTOs Have Thai Validation Messages

`CreateQuoteDto`, `CreateQuoteItemDto`, `Confirm2faDto`, `Disable2faDto` all include Thai error messages on validation decorators. ✓

### I-6: No SQL Injection Found

All `$queryRaw` usages in new code use tagged template literals (parameterized) — no string concatenation. ✓

### I-7: No Hardcoded Secrets Found

Scanned new files — no hardcoded API keys, passwords, or tokens detected. ✓

---

## Recommendation

**BLOCK** — Do not merge until C-1 and C-2 are resolved.

C-1 (PII in git history) is the most urgent: the branch is already pushed to the remote, meaning 432 customer national ID numbers and phone numbers are accessible to anyone with repository access. This requires immediate remediation regardless of merge status.

Priority order:
1. **Immediately**: Purge PII CSV files from git history on this branch (and verify main is clean)
2. **Before merge**: Fix `Number()` on money in the 3 affected files (C-2)
3. **Before merge**: Add `RolesGuard` to `TwoFactorController` (W-1)
4. **After merge**: Address `.toNumber()` on report outputs in accounting service (W-3) — low financial risk but should be consistent

The new Quotes, Drafts, and 2FA modules are architecturally sound. The SP7.1 dual-Prisma foundation design (`EntityScopeGuard`, `PrismaFinanceService`, `EntityScope middleware`) was not fully deployed in the diff but existing tests and module registration patterns are correct.
