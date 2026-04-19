# Merge Guard Report — feat/pii-encryption-phase3-dualwrite

**Date**: 2026-04-19  
**Branch**: `feat/pii-encryption-phase3-dualwrite`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Commits**: 3

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/scripts/backfill-pii-encryption.ts` | NEW — 130+ lines, one-time migration script |
| `apps/api/src/modules/customers/customers.service.ts` | +107 lines — dual-write PII on create/update |
| `apps/api/src/modules/customers/customers.service.spec.ts` | Updated specs |
| `apps/api/src/modules/trade-in/trade-in.service.ts` | +34 lines — dual-write bank PII |
| `apps/api/src/modules/trade-in/trade-in.service.spec.ts` | Updated specs |
| `apps/api/src/utils/pii.util.ts` | +44 lines — encryptReferencesJson + decryptReferencesJson |

## Issues by Severity

### Critical — None

- No new controllers, guards not applicable ✓
- No `Number()` on money fields — dual-write only touches String PII fields ✓
- No hardcoded secrets — `piiKey` and `hashSalt` use `process.env` getters ✓
- `customers.service.ts` line 441: dedup check now uses `phoneHash` with `deletedAt: null` ✓

### Warning

1. **`backfill-pii-encryption.ts` — `findMany` queries missing `deletedAt: null` filter**  
   `prisma.customer.findMany` and `prisma.tradeIn.findMany` iterate ALL rows including soft-deleted.  
   Soft-deleted rows will be backfilled with encrypted PII data.  
   **Impact**: Wasteful extra updates on deleted rows; not a data integrity issue. Encrypting deleted-customer PII is defensible under PDPA (data at rest stays encrypted), but if Phase 6 DROP of plaintext columns ever relies on "all non-deleted rows are encrypted" count, this distinction matters.  
   **Suggested fix**: Add `where: { ...(cursor ? { id: { gt: cursor } } : {}), deletedAt: null }` — or explicitly document the intent to backfill all rows regardless of deletion status.

2. **`buildPiiEncryptedFields` silently skips encryption when `PII_ENCRYPTION_KEY` is empty**  
   `const enc = (v) => key ? encryptPII(v, key) : v;` — in dev without the key set, plaintext is written to the encrypted column.  
   This is intentional for dev ergonomics per the comment, but means `nationalIdEncrypted` would hold unencrypted plaintext, which could confuse the Phase 5 `isEncrypted()` check.  
   `isEncrypted()` tests for `:` separator — a raw NID like `"1234567890123"` has no colon, so Phase 5 would fall back to the legacy column correctly. Risk is low but worth documenting explicitly.

### Info

1. **`customers.service.ts` grows to ~900 lines** after this change.  
   Not a blocker, but the service is approaching the point where splitting into `CustomerReadService` / `CustomerWriteService` would improve maintainability.

2. **`encryptReferencesJson` in `pii.util.ts` — non-array `refs` is returned as-is**  
   If `references` is an object `{}` rather than an array `[]`, the function silently no-ops.  
   Schema defines `references Json?` — consider adding a runtime check with a logger warning.

## Recommendation: ⚠️ REVIEW

Good implementation with no critical issues. The backfill script's missing soft-delete filter (Warning #1) should be resolved or explicitly documented before running in production. All other items are low-risk.
