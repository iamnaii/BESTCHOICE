# Merge Guard Report — feat/ecl-stage-reverse

**Date**: 2026-05-10  
**Branch**: `feat/ecl-stage-reverse`  
**Author**: Akenarin Kongdach  
**Base**: `origin/main`  
**Recommendation**: 🟢 APPROVE

---

## File Changes Summary

| Metric | Value |
|--------|-------|
| Files changed | 10 |
| Insertions | +543 |
| Deletions | 0 |
| Commits | 5 |

**Key areas touched:**
- `bad-debt.service.ts` — new `reverseStageOnPayment()` method
- `ecl-stage-reverse.template.ts` — new JE template (`Dr 11-2102 / Cr 51-1103`)
- `payments.service.ts` — calls `reverseStageOnPayment` atomically inside payment transaction
- New spec files: `ecl-stage-reverse.template.spec.ts`, `bad-debt.service.ts` additions, `payments.service.spec.ts` mock

---

## Issues

No Critical or Warning issues found.

### ℹ️ Info

#### 1. `reverseStageOnPayment` is fire-and-throw (not fire-and-forget)

The payments service intentionally wraps the ECL reverse call in `try/catch` then re-throws:

```ts
try {
  await this.badDebtService.reverseStageOnPayment(contract.id, tx);
} catch (err) {
  Sentry.captureException(err);
  throw err;   // rolls back entire receipt tx
}
```

This is the correct pattern (CPA Policy A §3.6 requires atomicity), but it means a provisioning calculation error on any overdue contract could block a payment from recording. Consider adding a feature-flag toggle or a service-level circuit-breaker if edge cases emerge in production.

#### 2. Mock added for `BadDebtService` in three existing spec files

**Files**: `payments.service.spec.ts`, `payments.service.advance.spec.ts`, `payments-financial.integration.spec.ts`

The mock stubs are minimal `{ reverseStageOnPayment: jest.fn().mockResolvedValue(null) }`. Correct and sufficient for existing test coverage; no action needed.

---

## Security & Correctness Checklist

| Check | Result |
|-------|--------|
| `@UseGuards` on new controllers | No new controllers (service-only change) |
| `@Roles` on new endpoints | No new endpoints |
| `Number()` on Decimal fields | None — all arithmetic uses `new Decimal(...)` |
| `deletedAt: null` on new queries | ✅ All new `findFirst` / `findMany` queries include `deletedAt: null` |
| Hardcoded secrets | None |
| Raw SQL (`$queryRaw`) | None |
| `invalidateQueries` after mutations | No frontend changes |

---

## Recommendation

**🟢 APPROVE** — Small, focused change with correct Decimal arithmetic, proper query guards, and atomicity wiring. The Info note about payment blocking is worth monitoring in prod but is intentional by design.
