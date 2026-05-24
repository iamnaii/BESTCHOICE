# Merge Guard Report — fix/sp2-blockers

**Date**: 2026-05-24  
**Branch**: `fix/sp2-blockers`  
**Author**: Akenarin Kongdach (iamnaii)  
**Reviewed by**: Pre-Merge Guard Agent  
**Closes**: Issue #1086 items 1, 2, 5

---

## File Changes Summary

| File | +Lines | −Lines | Notes |
|------|--------|--------|-------|
| `contract-exchange.controller.ts` | +4 | −1 | Pass full `req.user` to `submit()` |
| `contract-exchange.service.ts` | +65 | −15 | Branch check, null-price guard, downPayment fix |
| `contract-exchange.service.spec.ts` | +90 | −10 | 6 new test cases covering the 3 fixes |

**Total**: 132 insertions / 25 deletions across 3 files

---

## Issues Found

### Critical — None

All three fixes in this branch address previously-open security/correctness bugs:

- **Item 1 fixed**: Null price silent bypass → now throws `BadRequestException('ราคาเครื่องไม่ถูกตั้งค่า — ตรวจสอบเครื่องในระบบ')`
- **Item 2 fixed**: Cross-branch access → now enforced via `hasCrossBranchAccess()` (same util used by BranchGuard); throws `ForbiddenException`
- **Item 5 fixed**: New exchange contract copied old `downPayment` → now always `new Decimal(0)` per spec v3

No new issues introduced.

### Warning — 1 item

**W1: `RequestUser` interface not shared via `packages/shared`**

A local `interface RequestUser { id, role?, branchId? }` is declared at the top of `contract-exchange.service.ts`. The same shape is extracted from `req.user` in several other services across the codebase. Consider centralising this type in `packages/shared/types` to avoid drift. Non-blocking for this PR.

### Info — 1 item

**I1: `OWNER_USER.branchId = null` in test fixtures**  
Tests correctly reflect that OWNER users have `branchId: null`, which passes `hasCrossBranchAccess`. Matches the `CROSS_BRANCH_ROLES` source of truth in `branch-access.util.ts`. Good.

---

## Security Assessment

**Item 2 (cross-branch ForbiddenException) is the most security-relevant fix in this branch.**

Before this fix, a SALES user at branch B could submit an exchange request for a contract belonging to branch A simply by knowing the `oldContractId`. The DTO carries no `branchId`, so the existing `BranchGuard` had no surface to block on. The in-service check added here closes this gap correctly using the established `hasCrossBranchAccess()` util.

Test coverage verifies:
- SALES (same branch) → passes
- SALES (different branch) → `ForbiddenException`
- OWNER (cross-branch role, `branchId: null`) → passes

---

## Recommendation: ✅ APPROVE

Three targeted bug fixes, each with a dedicated test case. No new patterns introduced, no guard regressions. This branch should merge before `feat/sp2-exchange-sign-flow` since both operate on the same service (merge order: blockers → sign-flow).
