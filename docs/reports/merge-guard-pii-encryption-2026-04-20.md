# Pre-Merge Guard Report — PII Encryption Phases 1, 3, 5

**Date**: 2026-04-20  
**Reviewer**: Pre-Merge Guard (automated)  
**Branches reviewed**: 3 most recently pushed unmerged branches  

---

## Summary

| Branch | Author | Last Commit | Files Changed | Recommendation |
|--------|--------|-------------|---------------|----------------|
| `feat/pii-encryption-phase1-foundation` | Akenarin Kongdach | 2026-04-19 23:24 +0700 | 9 | ✅ APPROVE |
| `feat/pii-encryption-phase3-dualwrite` | Akenarin Kongdach | 2026-04-19 23:43 +0700 | 6 | ✅ APPROVE |
| `feat/pii-encryption-phase5-reads-mask` | Akenarin Kongdach | 2026-04-20 00:59 +0700 | 8 | ⚠️ REVIEW |

Context: These are sequential phases of a PDPA/PII encryption implementation. Phase 1 lays the foundation (utils + audit service), Phase 3 adds dual-write on create/update, Phase 5 wires read-path decryption and role-based masking into controllers. Each branch diverged from main after the prior phase was merged.

---

## Branch 1: `feat/pii-encryption-phase1-foundation`

### Files Changed
```
apps/api/src/app.module.ts                        (+3 lines)
apps/api/src/modules/pii/pii-audit.service.ts     (new, +38)
apps/api/src/modules/pii/pii-audit.service.spec.ts (new, +73)
apps/api/src/modules/pii/pii.module.ts            (new, +11)
apps/api/src/utils/env-validation.ts              (+33)
apps/api/src/utils/env-validation.spec.ts         (new, +73)
apps/api/src/utils/pii.util.ts                    (new, +54)
apps/api/src/utils/pii.util.spec.ts               (new, +73)
```

### Critical Issues
_None found._

### Warnings
1. **`pii.util.ts:maskNationalId` — foreign ID not masked**  
   ```typescript
   // pii.util.ts:20
   if (value.length !== 13) return value;  // ← returns FULL unmasked value
   ```
   Foreign customer passport numbers (non-13-digit) are returned unmasked when `SALES` role calls `maskNationalId()`. If the Phase 5 masking path feeds passport values through this function, foreign customer IDs will be visible to SALES. Consider masking non-Thai IDs with a generic `XXX...XXX` pattern.

### Info
- `PiiModule` is `@Global()` — appropriate for a cross-cutting audit concern. Makes `PiiAuditService` injectable everywhere without explicit module imports.
- `PiiAuditService.logDecryption` swallows DB errors intentionally ("never let audit failure block PII access"). Pattern is documented and consistent with `v3` payment webhook hardening.
- `validateEnv()` in production mode throws at startup if `PII_ENCRYPTION_KEY` / `PII_HASH_SALT` are missing or malformed. Good fail-fast behavior.
- Test coverage is comprehensive: 3 spec files, 19 test cases.

---

## Branch 2: `feat/pii-encryption-phase3-dualwrite`

### Files Changed
```
apps/api/src/modules/customers/customers.service.ts      (+78)
apps/api/src/modules/customers/customers.service.spec.ts (+77)
apps/api/src/modules/trade-in/trade-in.service.ts        (+34)
apps/api/src/modules/trade-in/trade-in.service.spec.ts   (+44)
apps/api/src/utils/pii.util.ts                           (+41)
apps/api/scripts/backfill-pii-encryption.ts              (new, +159)
```

### Critical Issues
_None found._

### Warnings
1. **`buildPiiEncryptedFields` — dev mode silently falls back to plaintext**  
   ```typescript
   // customers.service.ts
   const enc = (v): string | null | undefined => {
     ...
     return key ? encryptPII(v, key) : v;  // ← v = plaintext stored as "encrypted" column
   };
   ```
   When `PII_ENCRYPTION_KEY` is not set (dev environment), plaintext values are written into the `*Encrypted` columns. This is intentional for rolling deploy safety, but means after Phase 6 (drop plaintext columns), rows written in dev without a key will have unencrypted values in what the app treats as encrypted columns. Acceptable if dev DB is never migrated to prod, but worth documenting in the backfill script.

### Info
- Backfill script (`backfill-pii-encryption.ts`) is idempotent: skips rows where `nationalIdEncrypted` + `nationalIdHash` are already set.
- Batch size of 100 rows with cursor-based pagination is safe for large tables.
- Script validates `PII_ENCRYPTION_KEY` + `PII_HASH_SALT` before connecting — no silent data corruption.
- Both `create` and `update` paths in `CustomersService` dual-write correctly (partial updates only encrypt fields present in the DTO).
- `encryptReferencesJson` handles the nested `references` JSON array; only top-level PII fields within each reference object are encrypted (by design).
- Test coverage: 3 new test suites, 9 test cases.

---

## Branch 3: `feat/pii-encryption-phase5-reads-mask`

### Files Changed
```
apps/api/src/modules/customers/customers.controller.ts      (+85 lines)
apps/api/src/modules/customers/customers.controller.spec.ts (new, +107)
apps/api/src/modules/customers/customers.service.ts         (+88)
apps/api/src/modules/customers/customers.service.spec.ts    (+114)
apps/api/src/modules/trade-in/trade-in.controller.ts        (+85)
apps/api/src/modules/trade-in/trade-in.controller.spec.ts   (new, +148)
apps/api/src/modules/trade-in/trade-in.service.ts           (+35)
apps/api/src/modules/trade-in/trade-in.service.spec.ts      (+40)
```

### Critical Issues
_None found._

Guards, Roles, deletedAt, money types, SQL injection — all clear.

### Warnings

1. **`customers.controller.ts:findAll` — misleading PII audit log field list**  
   ```typescript
   // customers.controller.ts ~line 210-220
   void this.piiAudit.logDecryption({
     fields: ['nationalId', 'phone'],  // ← says phone is accessed
     masked: role === 'SALES',         // ← but phone is NOT masked for SALES
   ```
   The `fields` array declares `['nationalId', 'phone']` but the masking function (`applyRoleMask`) only masks `nationalId` for SALES — `phone` is returned in full. The audit trail will claim `phone` was part of a masked access when it was actually fully visible. This affects audit correctness.  
   **Suggested fix**: Change to `fields: ['nationalId']` for the findAll audit call, since that's the only field that's actually masked.

2. **`pii.util.ts:maskNationalId` — foreign IDs unmasked (inherited from Phase 1)**  
   ```typescript
   if (value.length !== 13) return value;  // foreign passport = no masking
   ```
   Phase 5 `applyRoleMask` in `CustomersController` calls `maskNationalId` for SALES. Foreign customers with passport-style IDs will have their full national ID returned to SALES staff. Inherited from Phase 1 warning above.

3. **`customers.controller.ts:findOne` — redundant null check**  
   ```typescript
   const customer = await this.customersService.findOne(id);
   if (!customer) return customer;  // service already throws NotFoundException
   ```
   `CustomersService.findOne` throws `NotFoundException` when `!customer || customer.deletedAt`. The null check in the controller will never be reached. Not harmful, but adds dead code.

### Info
- `decryptCustomerPII` gracefully handles `PII_ENCRYPTION_KEY` missing: `if (!key) return c` — returns plaintext columns unchanged. ✓
- Fallback logic `enc = encrypted || legacy` correctly supports rolling deploy: pre-backfill rows (null encrypted column) fall back to legacy plaintext. ✓
- `PiiAuditService` injection in `CustomersController` and `TradeInController` works via `@Global()` `PiiModule` from Phase 1. ✓
- Fire-and-forget `void this.piiAudit.logDecryption(...)` correctly avoids blocking the response path. ✓
- `TradeInController` masks `transferAccountNumber` for `BRANCH_MANAGER` and `SALES` (bank account numbers are financial PII). Role matrix differs from Customers (BRANCH_MANAGER also masked for trade-in). ✓
- Test coverage: 5 new spec blocks, ~40 test cases.

---

## Cross-Branch Issues

### Phase dependency chain
These branches are **sequential** (Phase N branches from Phase N-1). They must be merged in order:
```
main ← Phase 1 ← Phase 2 (schema) ← Phase 3 ← Phase 4 (?) ← Phase 5
```
Merging Phase 5 without Phase 3 merged first will cause compilation errors (missing `decryptReferencesJson`, `piiKey` getter, etc.).

Note: `feat/pii-encryption-phase2-schema` exists in remote — confirm it has been merged before Phase 3.

### No new `@queryRaw` calls
No parameterized or unparameterized raw SQL found in any diff. ✓

### No hardcoded secrets
All key references use `process.env.PII_ENCRYPTION_KEY`. ✓

---

## Recommendations by Branch

### Phase 1 — ✅ APPROVE
Clean foundation. Minor concern about foreign IDs, but it's a design choice that can be addressed in a follow-up. All guards, tests, and structure are correct.

### Phase 3 — ✅ APPROVE
Dual-write is correct and idempotent. Dev-mode fallback is acceptable and consistent with the existing pattern in `backup.sh`. Tests are solid.

### Phase 5 — ⚠️ REVIEW
Two issues should be addressed before merge:

1. **Fix misleading audit `fields` array** in `customers.controller.ts:findAll` and `search` methods. Quick 1-line fix: use `['nationalId']` instead of `['nationalId', 'phone']` for SALES-masked calls.
2. **Decide on foreign ID masking** — either add a fallback mask in `maskNationalId` for non-13-digit IDs, or document that foreign IDs are intentionally unmasked for SALES (PDPA compliance review needed).

If item 1 is fixed and item 2 is documented/accepted, Phase 5 can be approved.

---

_Generated by Pre-Merge Guard — 2026-04-20_
