# Merge Guard Report — feat/accounting-phase-a1b-intercompany-je

**Date**: 2026-04-30  
**Branch**: `feat/accounting-phase-a1b-intercompany-je`  
**Last commit**: `fa27da7d` (2026-04-29 18:10 +0700)  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Recommendation**: ⚠️ REVIEW

---

## File Changes Summary

23 files changed, 3835 insertions(+), 181 deletions(-)

| Area | Key Files |
|------|-----------|
| Accounting | `journal-auto.service.ts` (+665 lines), `journal-auto.service.spec.ts` (+796 lines) |
| Bad Debt | `bad-debt.service.ts` (+48 lines), `bad-debt.service.spec.ts` (+67 lines) |
| Contracts | `contract-workflow.service.ts`, `contract-payment.service.ts` |
| Payments | `payments.service.ts`, `paysolutions.service.ts` |
| Repossessions | `repossessions.service.ts`, `repossessions.controller.ts` |
| Utilities | `inter-company-link.util.ts` (new), `inter-company-link.util.spec.ts` (new) |
| E2E | `accounting-inter-company-flow.spec.ts` (+125 lines, new) |
| Docs | Plan + design docs (~1,960 lines) |

---

## Issues Found

### ⚠️ Warning (2)

#### W1 — `.toNumber()` on Decimal money values in `journal-auto.service.ts` (15+ instances)

**Files**: `apps/api/src/modules/journal/journal-auto.service.ts`

Multiple journal line construction calls convert Prisma `Decimal` to JS `number` via `.toNumber()` before building the `JournalLineInput` array:

```typescript
{ accountCode: FA.CASH, debit: amountPaid.toNumber(), credit: 0 },
{ accountCode: FA.HP_RECEIVABLE, credit: hpReceivableCredit.toNumber(), debit: 0 },
{ accountCode: FA.INTEREST_INCOME, credit: interest.toNumber(), debit: 0 },
// ... 12+ more instances
```

The `JournalLine.debit`/`credit` fields are `Decimal @db.Decimal(12,2)` in the schema. Prisma will convert JS numbers back to Decimal on write, but the intermediate pass through IEEE-754 float can corrupt amounts >9,007,199,254,740,992 satang (≈90M THB). More importantly, the v4 hardening sprint (PR #444) specifically fixed 53 such `Number()` instances across 12 services as a precision policy — this branch re-introduces the pattern.

**Fix**: Replace `.toNumber()` with `Decimal.toFixed(2)` or pass the `Prisma.Decimal` directly if `JournalLineInput.debit` can be typed as `Prisma.Decimal | number`.

#### W2 — `any` types in test helpers (low risk, test-only)

**Files**: `apps/api/src/modules/journal/journal-auto.service.spec.ts`

Test mock uses `(args: any)` for `companyInfo.findFirst` mock implementations and `(c: any[]) => c[0].data` for call args extraction. These are isolated to test files and do not affect runtime type safety.

---

### ℹ️ Info (2)

#### I1 — `companyInfo.findFirst` without `deletedAt: null` filter

**File**: `apps/api/src/modules/journal/journal-auto.service.ts`

`companyInfo.findFirst({ where: { companyCode: 'SHOP' } })` is called without a `deletedAt: null` guard. Verify that `CompanyInfo` model does not have `deletedAt` (if it is a static config table this is intentional) or add the filter.

#### I2 — Large file

`journal-auto.service.ts` grows to 665+ new lines in this branch. Consider splitting into `journal-payment.service.ts` and `journal-contract.service.ts` in a follow-up.

---

## Security Checklist

| Check | Status |
|-------|--------|
| New controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` | ✅ No new controllers added |
| All new controller methods have `@Roles()` | ✅ N/A |
| No `Number()` on DB-bound money fields | ⚠️ `.toNumber()` used in JournalLine construction |
| `deletedAt: null` in all new queries | ✅ (spec: CompanyInfo may lack deletedAt — verify) |
| No hardcoded secrets / API keys | ✅ Clean |
| No unparameterized `$queryRaw` | ✅ Clean |
| No raw `fetch()` in frontend | ✅ N/A (backend-only branch) |
| `queryClient.invalidateQueries()` after mutations | ✅ N/A (backend-only branch) |

---

## Recommendation: ⚠️ REVIEW

This branch implements the Phase A.1b inter-company journal split — a high-value accounting feature with good test coverage (+796 spec lines, +125 E2E lines). The core logic appears sound.

**Block condition**: W1 (`.toNumber()` proliferation) contradicts the v4 Decimal precision policy and should be fixed before merge. The risk is low for typical Thai mobile shop amounts but sets a bad precedent.

**Suggested action**: Fix the 15+ `.toNumber()` calls in `journal-auto.service.ts` to preserve `Prisma.Decimal` through the `JournalLineInput` pipeline, then APPROVE.
