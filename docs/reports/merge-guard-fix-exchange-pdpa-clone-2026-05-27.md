# Merge Guard Report — fix/exchange-pdpa-clone

**Date**: 2026-05-27  
**Branch**: `fix/exchange-pdpa-clone`  
**Author**: Akenarin Kongdach (akenarin.ak@gmail.com)  
**Against**: `origin/main`  
**Note**: This branch builds on top of `feat/sp2-exchange-sign-flow` (already merged to `main`). It contains exactly **1 commit** ahead of `main`.

---

## File Changes Summary

| File | +Lines | -Lines | Notes |
|------|--------|--------|-------|
| `contract-exchange.service.ts` | +30 | -3 | PDPA consent clone logic added |
| `contract-exchange.service.spec.ts` | +54 | -1 | Updated + new test cases for clone behavior |

**2 files changed, 79 insertions(+), 5 deletions(-)**

---

## Context

`Contract.pdpaConsentId` is `@unique` in Prisma schema. The original `approve()` implementation tried to reuse the old contract's `pdpaConsentId` directly on the new exchange contract, which would violate the unique constraint (two Contract rows pointing to the same PDPAConsent row). This fix correctly clones the PDPAConsent row so the new contract gets a fresh consent ID while preserving the customer's consent semantics.

---

## Issues Found

### 🟡 Warning

#### W1 — `pDPAConsent.findUnique` without `deletedAt: null` check

**File**: `apps/api/src/modules/contract-exchange/contract-exchange.service.ts`

```ts
const oldConsent = await tx.pDPAConsent.findUnique({
  where: { id: old.pdpaConsentId },
});
if (oldConsent) {
  const cloned = await tx.pDPAConsent.create({
    data: {
      ...
      status: oldConsent.status,  // ← could clone a REVOKED or deleted consent
```

**Risk 1 — Soft-deleted consent**: If the source PDPAConsent has `deletedAt != null`, the clone will silently copy a deleted consent into the new contract. The cloned row would not have `deletedAt` set (only the enumerated fields are copied), so the new contract would hold an "active" consent that was derived from a deleted one.

**Risk 2 — Revoked consent**: If `oldConsent.status === 'REVOKED'`, the new contract gets a clone with `status: 'REVOKED'` — which may be semantically incorrect for an exchange that the customer agreed to.

**Recommendation**: Add `AND deletedAt IS NULL` guard and optionally reset `status` to `'GRANTED'` (or the customer's most recent granted consent version) when cloning.

---

### 🔵 Info

#### I1 — No test for soft-deleted source consent

The new spec tests:
- ✅ Normal clone (source consent exists with `status: 'GRANTED'`)
- ✅ `pdpaConsentId: null` → no clone
- ✅ Cloned ID differs from original

Missing test: source consent with `deletedAt != null` — should clone be skipped or proceed? Worth adding once the W1 behavior is defined.

#### I2 — `signatureImage` could be large (DB.Text)

`PDPAConsent.signatureImage` is `@db.Text` and may contain a Base64-encoded e-signature image. The clone copies it verbatim. This is semantically correct (the customer's signature is evidence of consent) but means the clone doubles storage for large signatures. Acceptable for now; note for future PII compression work.

---

## Security Checklist

| Check | Result |
|-------|--------|
| New controllers / guards | ✅ No new controllers |
| `Number()` on money fields | ✅ No money arithmetic |
| `deletedAt: null` on new queries | ⚠️ Missing on `pDPAConsent.findUnique` (W1 above) |
| Hardcoded secrets | ✅ None |
| SQL injection / raw queries | ✅ None |
| DTO validation | ✅ No new DTOs |
| Idempotency | ✅ `pdpaConsentId` is nullable on the new contract — re-running `approve()` without the fix would fail at `contract.create`, not leave orphan consents |

---

## Recommendation

### ✅ APPROVE (with one follow-up)

The core fix is correct and necessary — reusing a `@unique` FK across two rows would cause a Prisma P2002 unique constraint violation in production. The test coverage for the happy path and null case is solid.

**Required follow-up (W1):**  
Add `deletedAt: null` guard to the `pDPAConsent.findUnique` lookup, and define behavior when source consent is `REVOKED` (likely: treat as `null` → set `clonedPdpaConsentId = null` so the exchange contract uses no consent, then prompt re-consent at signing).
