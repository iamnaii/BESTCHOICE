# Merge Guard Report — `fix/letters-e2e-sales-assertion`

**Date**: 2026-05-27  
**Branch**: `fix/letters-e2e-sales-assertion`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Latest commit**: `8f3439b6` — fix(letters): E2E SALES assertion was matching CANCELLED tab button

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/web/e2e/letters-page.spec.ts` | 1 file, +8 / -4 lines |

**Scope**: E2E test only — zero production code changes.

---

## Issue Analysis

### 🔴 Critical — None found

### 🟡 Warning — None found

### 🔵 Info

**I-1**: Test intent clarified from RBAC check to page-access smoke check  
- File: `apps/web/e2e/letters-page.spec.ts:44`  
- The old assertion (`expect(page.getByRole('button', { name: 'ยกเลิก', exact: true })).toHaveCount(0)`) was incorrectly matching the "CANCELLED" status tab, which also contains the text "ยกเลิก". The replacement asserts on the page heading (`จัดการจดหมาย`) and URL instead.  
- The comment in the new code explains that the per-row Cancel button behavior is already covered by:
  1. Backend `@Roles` guard returning 403 for SALES on `POST /overdue/letters/:id/cancel`
  2. Unit tests in `LetterTable` component logic  
- This is the correct separation: E2E covers *route accessibility*, unit/API tests cover *role-specific button visibility*.

---

## Recommendation

> **✅ APPROVE — Safe to merge**

Single test file change. Fixes a brittle, mis-targeted assertion. The replacement assertion is more meaningful and correctly reflects what E2E tests should own (route access) vs what component/API tests own (RBAC UI behavior). No risk of regressions.
