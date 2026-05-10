# Pre-Merge Guard Report

**Branch**: `feat/receipt-rt-format-and-partial`
**Author**: Akenarin Kongdach
**Date**: 2026-05-10
**Reviewer**: Pre-Merge Guard (automated)

---

## Summary

3 commits since `main`:

| Hash | Message |
|------|-------|
| `f4e030f8` | fix(receipts): document void-seq policy + add (contract,installment) index (review #786) |
| `2783d1db` | test(receipts): RT format + partial receipt coverage |
| `9f4a444d` | feat(receipts): RT-YYYYMM-NNNNN format + partial receipt fields (CPA Policy A) |

## Files Changed

| File | Change |
|------|------|
| `apps/api/prisma/schema.prisma` | +14 lines — 3 new Receipt fields + 1 compound index |
| `apps/api/prisma/migrations/…/migration.sql` | +14 lines — matching migration |
| `apps/api/src/modules/receipts/receipts.service.ts` | +60/-8 — receipt number format + partial fields logic |
| `apps/api/src/modules/receipts/receipts.service.spec.ts` | +148 — 5 new test cases |
| `apps/api/src/modules/payments/payments.service.spec.ts` | +1/-1 — mock receipt number updated |

---

## Issues Found

### Critical — None

- No new controllers: no guard check needed
- No `Number()` on money fields — all arithmetic uses `Prisma.Decimal` / `.plus()` / `.minus()`
- All Prisma queries include `deletedAt: null` filter (partial-receipt lookup: `isVoided: false, deletedAt: null`)
- No hardcoded secrets or API keys
- No unparameterized `$queryRaw` — existing advisory lock uses template literal

### Warning — None

- `receipts.service.ts` is a pure service (no controller change) — no DTO concerns
- No React mutations involved

### Info

1. **Receipt number format change is a breaking change for existing data**: `RC-YYYY-MM-NNNNN` → `RT-YYYYMM-NNNNN`. The migration adds the new columns but does not back-fill the format on *existing* receipt rows. Any reports or regex filters that rely on the `RC-` prefix will silently mismatch old data. **No code fix needed** (historical receipts keep old format intentionally per CPA Policy A), but ops team should be aware.

2. **`paymentStatus` stored as plain `String` (not enum)**: field accepts `"PAID"` / `"PARTIAL"`. Not type-enforced at DB level. Low risk — set only from within service code — but an enum would be safer long-term.

3. **`remainingAmount` clamp comment is correct**: overpay clamps to 0; test at line ~410 of spec confirms. Good.

---

## Recommendation: **APPROVE**

No critical or warning-level issues. Code quality is high: Decimal precision respected, advisory lock correctly reused, partial-receipt logic has 5 dedicated tests (seq increment, PARTIAL→PAID transition, clamp). Info items are acknowledged risks, not blockers.
