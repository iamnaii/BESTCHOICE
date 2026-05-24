# Merge Guard Report — fix/exchange-pdpa-clone

**Date**: 2026-05-24  
**Branch**: `fix/exchange-pdpa-clone`  
**Author**: Akenarin Kongdach  
**Commit**: `e172e4eb` — fix(exchange): clone PDPA consent for new exchange contract  
**Files Changed**: 2 files, +79 / −5 lines

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/src/modules/contract-exchange/contract-exchange.service.ts` | `approve()` now clones the old contract's `PDPAConsent` row rather than reusing its ID — works around the `@unique` constraint on `Contract.pdpaConsentId` |
| `apps/api/src/modules/contract-exchange/contract-exchange.service.spec.ts` | Updated test title and expectations; added two new test cases: one for the clone path (with mock PDPA data), one confirming `null` when old contract has no consent |

---

## Critical Issues

**None found.**

- No new controller or endpoint introduced ✓  
- No `Number()` on money fields — PDPA fields are all strings/dates/enums ✓  
- No `deletedAt: null` queries needed (PDPA consent rows are immutable — no soft-delete per codebase conventions) ✓  
- No hardcoded secrets ✓  
- No `$queryRaw` ✓  

---

## Warning Issues

### W1 — PDPA clone runs outside `$transaction` scope check
The `pDPAConsent.create` call in `approve()` runs inside a `tx` (Prisma transaction client) — this is correct. However, if `pDPAConsent.findUnique` returns `null` for an ID that is set (`old.pdpaConsentId` is non-null but the row doesn't exist), the service silently sets `clonedPdpaConsentId = null` and creates the new contract without any consent reference. This could happen if a consent row was hard-deleted (which shouldn't happen per codebase rules, but is not guarded against in this method).

**Fix (low-urgency)**: Add a defensive throw/Sentry capture when `oldConsent` is null but `old.pdpaConsentId` is set. Example:
```ts
if (!oldConsent) {
  // Data integrity issue — log but don't block the exchange approval
  this.sentry?.captureMessage(`PDPA consent ${old.pdpaConsentId} not found during exchange clone`);
}
```

### W2 — New test cases don't assert no `pdpaConsentId` is the old one in the null-consent path
The test "sets pdpaConsentId=null when old contract has no consent" correctly asserts `createData.pdpaConsentId` is `null`, but does not assert that `pDPAConsent.create` was NOT called (which it does call in the correct path). This makes the test slightly weaker than it could be. The assertion `expect(prisma.pDPAConsent.create).not.toHaveBeenCalled()` is missing.

**Fix**: Add `expect(prisma.pDPAConsent.create).not.toHaveBeenCalled()` to the null-consent test case. *(The spec actually does have `expect(prisma.pDPAConsent.findUnique).not.toHaveBeenCalled()` — the missing assertion is only for `.create`.)*

---

## Info Issues

### I1 — Comment accuracy
The old comment read: "pdpaConsentId is carried from the old contract — the customer already consented." The new comment correctly explains the unique-constraint workaround. No action needed — documentation is now accurate.

---

## Recommendation

**APPROVE** — Correct fix for a real `@unique` constraint bug that would cause a runtime crash on exchange approval when the old contract has a PDPA consent. The implementation is clean, atomic (inside `$transaction`), and well-tested. The two warnings are minor defensive-coding suggestions that can be addressed in a follow-up.
