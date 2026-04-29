# Merge Guard Report — Accounting Phase A.1b / A.1c / A.2

**Date**: 2026-04-29  
**Reviewer**: Pre-Merge Guard (automated)  
**Branches reviewed** (most-recently-updated 3 non-chore/non-watchdog):

| Branch | Commits | Files |
|--------|---------|-------|
| `fix/accounting-phase-a2-deferred-income` | 2 | 10 |
| `fix/accounting-phase-a1c-jebugs-v2` | 2 | 3 |
| `feat/accounting-phase-a1b-intercompany-je` | 6 | 23 |

**Author**: Akenarin Kongdach  
**Dependency order**: A.1b → A.1c → A.2 (must merge in this order)

---

## Branch 1 — `fix/accounting-phase-a2-deferred-income`

### Summary
Implements Phase A.2 deferred income recognition per TFRS for NPAEs (cash-basis): at contract activation, interest and commission are parked in `Unearned` liability accounts instead of recognised as income. Each payment drains the deferred balances into earned income and VAT-payable.

**Key changes:**
- Prisma schema: `unearnedInterest Decimal @db.Decimal(12,2)` + `unearnedCommission Decimal @db.Decimal(12,2)` on `Contract`
- New migration `20260616000000_add_unearned_income_fields` with backfill for ACTIVE/OVERDUE/DEFAULT contracts
- New account constants: `VAT_OUTPUT_PENDING ('21-2102')`, `UNEARNED_INTEREST ('21-2202')`, `UNEARNED_COMMISSION ('21-2201')`
- `createContractActivationJournal`: activation now credits `UNEARNED_INTEREST` / `VAT_OUTPUT_PENDING` (not income/VAT directly)
- `createPaymentJournal`: each payment drains `UNEARNED_INTEREST` + `VAT_OUTPUT_PENDING` → credits `INTEREST_INCOME` + `VAT_OUTPUT`
- `createEarlyPayoffJournal`: updated to Phase A.2 model — drains full unearned by owed amount, discount absorbed in earned recognition
- `contract.update` inside payment JE to keep `unearnedInterest`/`unearnedCommission` in sync (for dashboard queries)
- 266 new/modified spec lines

### Issues

#### Warning — Accounting Sign-Off Required (W-001)
**File**: `apps/api/src/modules/journal/journal-auto.service.ts`  
**Issue**: The deferred VAT approach (`VAT_OUTPUT_PENDING` at activation → drain per payment) changes when VAT is recognised as payable. Per `accounting.md`, **CR-001** (VAT treatment) is still a deferred item pending owner + accountant decision. This implementation implicitly resolves CR-001 in favour of recognising VAT as collected per installment tax invoice. This is likely correct per Thai law (§78, §79 Revenue Code — VAT point of taxation for hire-purchase = installment due date), but needs explicit sign-off before merging to main.

#### Info — Migration Date in Future (I-001)
**File**: `apps/api/prisma/migrations/20260616000000_add_unearned_income_fields/migration.sql`  
**Issue**: Migration name timestamp is 2026-06-16 but today is 2026-04-29. Prisma applies migrations by lexicographic order of filename, not by date semantics — this still works but is confusing. Low risk.

#### Info — Large Service File (I-002)
**File**: `apps/api/src/modules/journal/journal-auto.service.ts`  
**Issue**: File now accumulates 200+ additional lines on top of Phase A.1b/A.1c additions. Consider splitting into `journal-payment.service.ts` and `journal-activation.service.ts` after A.2 stabilises. Not a blocker.

### Recommendation: **REVIEW** (pending accounting sign-off on CR-001 VAT treatment)

---

## Branch 2 — `fix/accounting-phase-a1c-jebugs-v2`

### Summary
Fixes two bugs from Phase A.1b: (1) per-installment JEs on early payoff were unbalanced when discount > 0; (2) `generateEntryNumber` had a race condition when posting paired SHOP+FINANCE entries concurrently.

**Key changes:**
- `contract-payment.service.ts`: early payoff now snapshots all installments before the update loop, then calls one aggregated `createEarlyPayoffJournal` instead of per-installment JEs
- `journal-auto.service.ts`: adds `createEarlyPayoffJournal` method + replaces `count()`-based sequence with `SELECT ... FOR UPDATE` parameterized query
- 142 new spec lines covering 7 early-payoff scenarios

### Issues

#### Info — $queryRaw Cast (I-003)
**File**: `apps/api/src/modules/journal/journal-auto.service.ts:82`
```typescript
const result = await (tx as unknown as { $queryRaw: typeof PrismaService.prototype.$queryRaw }).$queryRaw<...>`...`
```
**Issue**: The `tx as unknown as {...}` cast is needed because `Prisma.TransactionClient` doesn't expose `$queryRaw` in its type (Prisma design). The tagged template literal is parameterized (safe from SQL injection). The pattern matches `receipts.service.generateReceiptNumber` which is production-proven. Acceptable but should be documented with a comment explaining why the cast is necessary. Already has a comment in this PR.

### Recommendation: **APPROVE** (no blocking issues; builds correctly on A.1b)

---

## Branch 3 — `feat/accounting-phase-a1b-intercompany-je`

### Summary
Foundation branch: adds paired SHOP+FINANCE journal entries for inter-company transactions (contract activation, payment, credit allocation, repossession resale, bad debt provision). All JEs linked via `[IC-<uuid>]` prefix in description. Largest of the three branches (3835 insertions, 23 files).

**Key changes:**
- `journal-auto.service.ts`: `createContractActivationJournal`, `createPaymentJournal`, `createCreditAllocationJournal` — all extended to post paired SHOP+FINANCE entries
- New `createRepossessionResaleJournal` and `createBadDebtProvisionJournal` methods
- New `inter-company-link.util.ts`: `generateInterCompanyId()` + `formatInterCompanyDescription()`
- `repossessions.controller.ts`: `update()` now passes `@CurrentUser()` to service for `userId` (audit trail on resale JE)
- `repossessions.service.ts`: posts resale JE async (non-blocking, `.catch()` → Sentry)
- New E2E spec `accounting-inter-company-flow.spec.ts` (125 lines)
- Two design docs added under the branch (`.md` in repo root-level doc path)

### Issues

#### Warning — Number() on Decimal Money Field (W-002)
**File**: `apps/api/src/modules/repossessions/repossessions.service.ts`
```typescript
const resellPrice = new Prisma.Decimal(
  dto.resellPrice ?? Number(repo.resellPrice ?? 0),  // ← Number() on Decimal
);
```
**Issue**: `repo.resellPrice` is a `Decimal @db.Decimal(12,2)` field. Coercing via `Number()` loses IEEE 754 precision for values above 15 significant digits (unlikely for Thai phone prices but violates the project rule: never use `Number()` on money). Should be:
```typescript
const resellPrice = new Prisma.Decimal(dto.resellPrice ?? repo.resellPrice ?? 0);
```
Prisma.Decimal constructor accepts Decimal directly. Must fix before merge.

#### Info — Async Fire-and-Forget JE (I-004)
**File**: `apps/api/src/modules/repossessions/repossessions.service.ts`  
**Issue**: The resale JE is posted outside the `$transaction` block (fire-and-forget with `.catch()`). This means if the JE fails after the repo update commits, the DB has a sold repossession with no journal entry. The Sentry alarm fires but reconciliation is manual. Acceptable as a design decision (non-blocking to UX) but should be noted in the runbook.

#### Info — Repossession `update()` Signature Change (I-005)
**File**: `apps/api/src/modules/repossessions/repossessions.service.ts`  
`update(id, dto)` → `update(id, dto, userId?: string)` — the `userId` param is optional which means existing callers compile without changes. Good defensive design.

### Recommendation: **REVIEW** (fix W-002 before merge)

---

## Security Checklist — All 3 Branches

| Check | B1 (A.2) | B2 (A.1c) | B3 (A.1b) |
|-------|----------|-----------|-----------|
| New controllers without `@UseGuards` | ✅ None | ✅ None | ✅ None |
| Missing `@Roles` on controller methods | ✅ N/A | ✅ N/A | ✅ Existing guards intact |
| `Number()` on money fields (production) | ✅ None | ✅ None | ⚠️ W-002 |
| `deletedAt: null` in new queries | ✅ Present | ✅ N/A | ✅ Present |
| Hardcoded secrets / API keys | ✅ None | ✅ None | ✅ None |
| Unparameterized `$queryRaw` | ✅ None | ✅ Parameterized (safe) | ✅ None |
| Raw `fetch()` in frontend | ✅ None | ✅ None | ✅ None |

---

## Merge Order & Blockers

```
feat/accounting-phase-a1b-intercompany-je  (fix W-002 first) → REVIEW
  ↓
fix/accounting-phase-a1c-jebugs-v2                            → APPROVE
  ↓
fix/accounting-phase-a2-deferred-income    (accounting sign-off on VAT) → REVIEW
```

**Must fix before any merge:**
1. **W-002** in `fix/accounting-phase-a1b`: `Number(repo.resellPrice)` → `repo.resellPrice` directly in `Prisma.Decimal()` constructor

**Must confirm before merging A.2:**
2. **W-001**: Explicit owner + accountant sign-off that deferred VAT per installment (not at activation) is the intended CR-001 resolution

**Deferred / not blocking:**
- I-001 through I-005 are informational; no action required before merge
