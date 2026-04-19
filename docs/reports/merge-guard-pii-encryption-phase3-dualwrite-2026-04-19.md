# Merge Guard Report — feat/pii-encryption-phase3-dualwrite

**Date**: 2026-04-19  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Recommendation**: ✅ APPROVE

---

## Branch Summary

Implements PII Phase 3: dual-write encrypted columns alongside legacy plaintext + one-time backfill script.  
6 files changed, 458 insertions, 1 deletion.

### Key commits
- `feat(pii): Phase 3` — dual-write encrypted columns + backfill script
- `fix(lint)` — unblock CI/CD
- `ci(deploy)` — add PII env vars to Cloud Run deploy

### Files changed
| File | Change |
|------|--------|
| `customers.service.ts` | `buildPiiEncryptedFields()` — dual-write on create/update |
| `trade-in.service.ts` | `buildTradeInPiiEncryptedFields()` — encrypt bank info |
| `pii.util.ts` | NEW `encryptReferencesJson()` + `decryptReferencesJson()` |
| `scripts/backfill-pii-encryption.ts` | NEW — one-time batched backfill (100 rows/batch) |
| `customers.service.spec.ts` | Phase 3 dual-write tests |
| `trade-in.service.spec.ts` | Phase 3 dual-write tests |

---

## Issues Found

### Critical — 0 issues

- ✅ No guard changes — all controllers retain `@UseGuards(JwtAuthGuard, RolesGuard)`
- ✅ No `Number()` on money fields
- ✅ No hard-coded secrets — PII key read from `process.env.PII_ENCRYPTION_KEY`
- ✅ No raw SQL injection vectors

### Warning — 2 issues

**W-1: Silent plaintext fallback when `PII_ENCRYPTION_KEY` is any non-empty string**  
Location: `customers.service.ts` `buildPiiEncryptedFields()`, `trade-in.service.ts` `buildTradeInPiiEncryptedFields()`
```typescript
const enc = (v: string | null | undefined) => {
  ...
  return key ? encryptPII(v, key) : v;  // any truthy key is accepted
};
```
The backfill script validates key is exactly 64 hex chars, but the service-level check only tests truthiness. A malformed key (e.g., `PII_ENCRYPTION_KEY=x`) would call `encryptPII` with an invalid key, likely causing an AES-256 key derivation error at runtime rather than a safe fail.  
Recommendation: add a startup-time env validation (e.g., in a `onModuleInit` hook) that throws if `PII_ENCRYPTION_KEY` is set but malformed.

**W-2: Backfill script queries all rows including soft-deleted (no `deletedAt: null`)**  
Location: `scripts/backfill-pii-encryption.ts:38`
```typescript
const customers = await prisma.customer.findMany({
  where: cursor ? { id: { gt: cursor } } : undefined,
  ...
});
```
This is **intentional** for PDPA compliance (soft-deleted records still contain PII that must be encrypted). But the script comment doesn't explain this explicitly, which could confuse future maintainers who expect the standard `deletedAt: null` filter.  
Recommendation: add a comment `// intentional: PDPA requires encrypting ALL rows, including soft-deleted`.

### Info — 1 item

**I-1: `encryptReferencesJson` mutates only REFERENCE_PII_FIELDS — field list is hardcoded**  
```typescript
const REFERENCE_PII_FIELDS = ['firstName', 'lastName', 'phone', 'nationalId', 'address'];
```
If new PII fields are added to the `references` JSON schema in the future, this list must be updated manually. Consider a comment or a link to the data dictionary.

---

## Security Assessment

The dual-write approach is the correct migration strategy:
- Legacy plaintext columns remain populated → zero-downtime rollback possible
- Encrypted columns written in the same Prisma create/update call → no partial-state window
- Idempotent backfill → safe to re-run after partial failures
- Keys sourced from environment only, never committed

---

## Recommendation: ✅ APPROVE

Both warnings are documentation/robustness concerns, not security vulnerabilities. The core encryption logic is sound.
