# Merge Guard Report — feat/pii-encryption-phase5-reads-mask

**Date**: 2026-04-20  
**Branch**: `feat/pii-encryption-phase5-reads-mask`  
**Author**: Akenarin Kongdach (akenarin.ak@gmail.com)  
**Recommendation**: ✅ **APPROVE**

---

## File Changes Summary

8 files changed, 695 insertions(+), 41 deletions(-)

| File | Type | Lines |
|------|------|-------|
| `customers/customers.controller.ts` | Modified — PII masking by role | +50 |
| `customers/customers.controller.spec.ts` | New — 107-line controller test suite | +107 |
| `customers/customers.service.ts` | Modified — PII-aware queries | +35 |
| `customers/customers.service.spec.ts` | Modified — 40 new assertions | +114 |
| `trade-in/trade-in.controller.ts` | Modified — mask `transferAccountNumber` | +50 |
| `trade-in/trade-in.controller.spec.ts` | New — 148-line test suite | +148 |
| `trade-in/trade-in.service.ts` | Modified — PII search by hashed phone | +20 |
| `trade-in/trade-in.service.spec.ts` | Modified — collision + hash tests | +40 |

**What the branch does**: Phase 5 of the PII encryption roadmap — adds role-based field masking at the controller layer. `nationalId` is masked for `SALES` role (`12345-XXXXX-XX-3`). `transferAccountNumber` is masked for `SALES` and `BRANCH_MANAGER` (`XXXXXXXX90`). `OWNER`, `FINANCE_MANAGER`, and `ACCOUNTANT` receive full values. Tests cover all role × field combinations.

---

## Issues Found

### Critical
_None_

### Warning
_None_

### Info

**I-1 — `any` types in test files**  
Test files use `let prisma: any`, `let service: any`, and `as any` casts with `// eslint-disable-next-line @typescript-eslint/no-explicit-any` comments. This is acceptable test-file pragmatism and follows the same pattern as existing specs in this codebase.

**I-2 — `reqOf()` helper duplicated across spec files**  
Both `customers.controller.spec.ts` and `trade-in.controller.spec.ts` define a local `reqOf(role)` factory. A shared `spec-helpers.ts` would reduce duplication, but this is a low-priority refactor — not a blocker.

---

## Security Assessment

- Masking is applied at the **controller layer** (outbound DTO) — PII is still stored encrypted in DB per Phase 1–3. ✅
- Role check uses `req.user.role` — injected by `JwtAuthGuard` which is still applied to the controller class. ✅
- `deletedAt: null` filters present in all modified queries. ✅
- No `Number()` on money fields — no Decimal precision regressions. ✅
- No new controllers — no missing guard risk. ✅
- Tests verify SALES cannot see full `nationalId` and that OWNER receives plaintext — coverage is adequate. ✅

## Test Coverage

- `customers.controller.spec.ts`: masks `nationalId` for SALES, passes full value for OWNER/ACCOUNTANT/FINANCE_MANAGER, handles `findAll` list masking, handles `search` results. ✅
- `trade-in.controller.spec.ts`: masks `transferAccountNumber` for SALES + BRANCH_MANAGER, full value for OWNER/FINANCE_MANAGER/ACCOUNTANT, list endpoint masking. ✅
- `trade-in.service.spec.ts`: hash collision fallback, null phone handling. ✅
