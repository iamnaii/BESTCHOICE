# Merge Guard Report — feat/accounting-phase-a1b-intercompany-je

**Date**: 2026-05-04  
**Branch**: `feat/accounting-phase-a1b-intercompany-je`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Base**: `origin/main`  
**Last commit**: 2026-04-29 18:10 +0700

---

## File Changes Summary

23 files changed — 3,835 insertions, 181 deletions.

| Area | Files |
|------|-------|
| Journal service | `journal-auto.service.ts`, `inter-company-link.util.ts` |
| Contract services | `contract-workflow.service.ts`, `contract-payment.service.ts` |
| Accounting | `bad-debt.service.ts` |
| Repossessions | `repossessions.service.ts`, `repossessions.controller.ts` |
| Payments/PaySolutions | `payments.service.ts`, `paysolutions.service.ts` |
| Data audit | `data-audit.service.ts` |
| Seeds | `chart-of-accounts.ts`, `chart-of-accounts-finance.ts` |
| Tests | 8 spec files + 1 E2E spec |
| Docs | 2 design/plan docs |

---

## Issues

### Critical (must fix before merge)

**None found.**

---

### Warning (should fix)

**W-001 — `Number()` wrapping in `repossessions.service.ts`**

```typescript
// repossessions.service.ts (SOLD branch, ~line in diff)
const resellPrice = new Prisma.Decimal(
  dto.resellPrice ?? Number(repo.resellPrice ?? 0),
);
```

`repo.resellPrice` comes from a `@db.Decimal(12,2)` Prisma field. Passing it through `Number()` before handing to `new Prisma.Decimal(...)` is technically safe (Decimal constructor accepts number) but violates the no-`Number()`-on-money rule and introduces unnecessary float intermediate. Prefer:

```typescript
const resellPrice = new Prisma.Decimal(dto.resellPrice ?? repo.resellPrice ?? 0);
```

---

### Info

**I-001 — Inter-company link via description prefix**  
`inter-company-link.util.ts` links paired SHOP+FINANCE `JournalEntry` rows by embedding a shared UUID in the `description` field (`[IC-<uuid>] …`). This is a pragmatic approach but relies on string parsing for future queries. Consider a dedicated `interCompanyGroupId` column if query patterns grow.

**I-002 — New SHOP chart accounts added via upsert**  
`chart-of-accounts.ts` now upserts `11-2105` (Due-from-FINANCE) and `42-1105` (Commission Income) for the SHOP entity. The Phase A.4 wipe CLI doc references a 99-account FINANCE chart only — SHOP chart additions should be recorded in the accounting rules doc to keep it as the source of truth.

**I-003 — Test-only `Number()` usage**  
Multiple spec files use `Number()` on mock journal line amounts for `toBeCloseTo` assertions. This is fine in test context only.

---

## Positives

- All new endpoints use existing `@UseGuards(JwtAuthGuard, RolesGuard)` (no new controllers added).
- `bad-debt.service.ts` correctly fetches prior provisions inside the same DB call before reversing (`deletedAt: null` present).
- All new `companyInfo.findFirst` queries include `deletedAt: null`.
- `createBadDebtProvisionJournal` failures are caught per-contract — a single JE failure won't abort the full provision run (non-blocking Sentry capture pattern).
- SHOP+FINANCE entries both individually balance (debit = credit) — verified by new spec tests.
- Inter-company invariant tested: `SHOP Due-from-FINANCE Dr = FINANCE Due-to-SHOP Cr`.

---

## Recommendation

**APPROVE** (fix W-001 before or shortly after merge — not a blocker given it is wrapped in `Prisma.Decimal` immediately).
