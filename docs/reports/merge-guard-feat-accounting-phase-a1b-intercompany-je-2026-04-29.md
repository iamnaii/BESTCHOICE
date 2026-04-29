# Pre-Merge Guard Report

**Branch**: `feat/accounting-phase-a1b-intercompany-je`
**Author**: Akenarin Kongdach
**Date**: 2026-04-29
**Recommendation**: ✅ REVIEW

---

## File Changes Summary

23 files changed — 3,835 insertions, 181 deletions

| Category | Files |
|---|---|
| Core services | `journal-auto.service.ts` (+665), `payments.service.ts` (+66), `repossessions.service.ts` (+38), `bad-debt.service.ts` (+48), `contract-workflow.service.ts` (+12), `contract-payment.service.ts` (+25), `paysolutions.service.ts` (+12), `data-audit.service.ts` (+12) |
| New utilities | `inter-company-link.util.ts` (+25) |
| Seeds | `chart-of-accounts.ts` (+50), `chart-of-accounts-finance.ts` (+1) |
| Tests | `journal-auto.service.spec.ts` (+796), `bad-debt.service.spec.ts` (+67), `repossessions.service.spec.ts` (+40), and others |
| E2E | `accounting-inter-company-flow.spec.ts` (+125) |
| Docs | 2 design/plan docs (+1,959 lines) |

---

## Issues

### Warning

**W-1 — Decimal→number→Decimal round-trip in journal line builder**
`apps/api/src/modules/journal/journal-auto.service.ts`

The `createAndPost` internal interface uses `debit: number; credit: number`, so callers pass `.toNumber()` values:
```ts
{ accountCode: FA.CASH, debit: amountPaid.toNumber(), credit: 0 },
```
These are immediately re-wrapped with `new Decimal(l.debit)` before the DB write, so no precision is lost for typical monetary values. However, the intermediate `number` type violates the project rule "ห้ามใช้ Float หรือ Int สำหรับจำนวนเงิน". The `createAndPost` interface should accept `debit: Prisma.Decimal | number` or be fully typed as Decimal.

Affects ~25 line-item additions across the new inter-company JE methods.

**W-2 — Large files exceeding 500-line guideline**

| File | Lines |
|---|---|
| `journal-auto.service.spec.ts` | 1,620 |
| `journal-auto.service.ts` | 1,124 |
| `payments.service.ts` | 1,291 |
| `paysolutions.service.ts` | 1,352 |
| `repossessions.service.ts` | 566 |
| `contract-workflow.service.ts` | 543 |

`journal-auto.service.ts` grew by 665 lines with Phase A.1b. Consider extracting `buildPaymentJournalLines` and `buildContractActivationJournalLines` into a `journal-line-builder.ts` helper to keep the service under 500 lines. (`payments.service.ts`, `paysolutions.service.ts` were pre-existing large files.)

---

### Info

**I-1 — `Number()` in test files only**
All `Number(l.debit ?? 0)` / `Number(l.credit ?? 0)` usages outside service code are in `*.spec.ts` files for Jest assertions using `toBeCloseTo`. This is acceptable for test assertions. Not a runtime concern.

**I-2 — `process.env.API_DIRECT_URL` in E2E test**
`apps/web/e2e/accounting-inter-company-flow.spec.ts` uses `process.env.API_DIRECT_URL || 'http://localhost:3000'` to bypass the Vite proxy for direct API calls during E2E. This is a known pattern for Playwright tests that need raw API access (no browser proxy). Not a security concern — E2E only.

---

## Security Checklist

| Check | Result |
|---|---|
| `@UseGuards(JwtAuthGuard, RolesGuard)` on modified controller | ✅ `repossessions.controller.ts` — class-level guard present |
| `@Roles()` on new/modified methods | ✅ All methods have role decorators |
| Missing `deletedAt: null` in queries | ✅ All new queries include filter |
| `$queryRaw` without parameterization | ✅ None found |
| Hardcoded secrets/API keys | ✅ None found |
| Decimal used for financial calculations | ⚠️ W-1 above — calculations correct, boundary typing loose |

---

## Recommendation: REVIEW

The accounting logic (Phase A.1b inter-company JE split) is correctly implemented — SHOP and FINANCE entries are properly separated, journal balance is enforced with Sentry alarm on unbalanced entries, and Decimal arithmetic is used for all calculations. The `as never` type cast in the repossessions test is in a `.spec.ts` file and does not affect production code.

**Action required before merge**: Address W-1 (the `createAndPost` internal interface should type `debit`/`credit` as `Prisma.Decimal` rather than `number`, eliminating the round-trip). W-2 is optional but recommended for long-term maintainability.
