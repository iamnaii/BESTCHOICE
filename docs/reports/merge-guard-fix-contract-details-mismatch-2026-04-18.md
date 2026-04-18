# Merge Guard Report — claude/fix-contract-details-mismatch-rGvPp

**Date**: 2026-04-18  
**Branch**: `claude/fix-contract-details-mismatch-rGvPp`  
**Author**: Claude <noreply@anthropic.com> (top commit) / iamnaii <akenarin.ak@gmail.com>  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

| Commit | Description | Files |
|--------|-------------|-------|
| `8e0fb90f` | fix: use contract's planType to resolve template instead of hardcoded STORE_DIRECT | `documents.service.ts` (+2/-2) |

Total: 1 file changed, 2 insertions, 2 deletions.

**Bug fixed:** Document preview and generation always resolved the contract template using the hardcoded string `'STORE_DIRECT'` regardless of the contract's actual `planType`. This caused the signing page to render wrong contract details for contracts with `planType` of `CREDIT_CARD` or `STORE_WITH_INTEREST`.

---

## Issues

### Critical
_None found._

### Warning
_None found._

### Info

**I1 — Fallback to `'STORE_DIRECT'` if `planType` is null**

The fix uses `contract.planType || 'STORE_DIRECT'` as a safe fallback. This is correct given `planType` could be `null` on older records. No issue, just noting the guard is intentional.

---

## Checklist

| Check | Result |
|-------|--------|
| New controllers have `@UseGuards(JwtAuthGuard)` | N/A — no new controllers |
| No `Number()` on money/Decimal fields | N/A — no financial arithmetic |
| All queries include `deletedAt: null` | N/A — no new queries |
| No hardcoded secrets | ✅ Pass |
| DTOs have class-validator decorators | N/A — no new DTOs |
| Frontend uses `api.get/post` | N/A — no frontend changes |
| Thai validation messages | N/A |
| No SQL injection risk | ✅ Pass |
| Fix is targeted and minimal | ✅ Pass — 2 lines changed, correct fallback |
