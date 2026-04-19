# Merge Guard Report — feat/pii-encryption-phase5-reads-mask

**Date**: 2026-04-19  
**Branch**: `feat/pii-encryption-phase5-reads-mask`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Commits**: 5 (includes 2 CI fixes from main: #600, #601)

## File Changes Summary

| File | Change | Lines |
|------|--------|-------|
| `apps/api/src/modules/customers/customers.controller.ts` | +119 — PII audit + role mask on findAll/search/findOne | 241 total |
| `apps/api/src/modules/customers/customers.controller.spec.ts` | NEW — 107 lines, Phase 5 controller tests | — |
| `apps/api/src/modules/customers/customers.service.ts` | +88 — decrypt PII on read-path | **957 total** |
| `apps/api/src/modules/customers/customers.service.spec.ts` | +114 — decrypt + dedup hash tests | — |
| `apps/api/src/modules/trade-in/trade-in.controller.ts` | +85 — bank PII audit + role mask | 286 total |
| `apps/api/src/modules/trade-in/trade-in.controller.spec.ts` | NEW — 148 lines, Phase 5 controller tests | — |
| `apps/api/src/modules/trade-in/trade-in.service.ts` | +35 — decrypt bank PII on read-path | — |
| `apps/api/src/modules/trade-in/trade-in.service.spec.ts` | +40 — decrypt tests | — |

## Issues by Severity

### Critical — None

- `CustomersController`: retains `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at class level ✓
- `TradeInController`: retains `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at class level ✓
- All new/modified endpoints have `@Roles(...)` decorators ✓
- `PiiAuditService` injected via `@Global()` PiiModule — DI resolves without per-module import ✓
- No `Number()` on money fields ✓
- No hardcoded secrets — `piiKey` reads from `process.env.PII_ENCRYPTION_KEY` ✓
- No raw `$queryRaw` usage ✓
- `decryptCustomerPII` and `decryptTradeInPII` fall back to legacy plaintext columns when encrypted column is NULL — safe for rolling deploy ✓

### Warning

1. **`customers.service.ts` is 957 lines — exceeds 500-line threshold**  
   Phase 5 added decryption helpers on top of an already large file. Splitting into `CustomerReadService` / `CustomerWriteService` (or extracting PII decrypt logic into a `CustomerPiiDecryptUtil`) would improve testability and maintainability. Not a merge blocker but should be tracked.

2. **`search()` method skips PII audit log when results are empty**  
   `findAll()` and `findOne()` always fire the audit log; `search()` only logs when `results.length > 0`.  
   An audit-conscious attacker doing negative-space queries (searching for names that don't exist) would leave no trace. Consider logging unconditionally for consistent audit coverage.

3. **`void this.piiAudit.logDecryption(...)` — fire-and-forget audit failures not sent to Sentry**  
   `PiiAuditService` catches errors and logs them via `Logger.error` but does not call `Sentry.captureException`. In production, a broken DB connection would silently suppress all PII audit events. Consistent with Info #3 from Phase 1 report — would benefit from a Sentry capture in the catch block.

4. **`decryptCustomerPII` uses bracket access `r['id']`, `r['name']` etc. in `search()` result mapper**  
   After decryption the row is typed as `Record<string, unknown>`, losing the Prisma typed shape. Callers must use bracket notation, bypassing TypeScript safety. Consider defining an intermediate type or using `as Customer` after decryption to preserve type checking downstream.

### Info

1. **`as any` casts appear in spec files only** — no production `as any` introduced ✓ (test context is acceptable)

2. **`applyRoleMask` in `TradeInController` masks for both `BRANCH_MANAGER` and `SALES`**  
   `CustomersController` only masks `nationalId` for `SALES`. This asymmetry is intentional (bank account numbers are more sensitive than NID for branch managers) but should be documented in the masking policy / PII design doc to avoid future inconsistency.

3. **Batch audit log uses `customerId: BATCH:N` as entity ID**  
   `findAll` logs `customerId: "BATCH:42"` — not a real customer ID. This works for audit trail purposes (reviewer can correlate to the endpoint) but differs from `findOne` which logs the actual UUID. Consider using a consistent sentinel like `"*BATCH*"` or logging as `entityId: null` with a `batchCount` in `newValue` for cleaner querying.

## Recommendation: ✅ APPROVE

No critical or blocking issues. Security posture is maintained — all guards intact, no secrets exposed, no money precision issues. Warning items (#1 service size, #2 audit gap on empty search) should be tracked as follow-up tasks. Phase 5 is safe to merge in sequence after Phases 1–3.
