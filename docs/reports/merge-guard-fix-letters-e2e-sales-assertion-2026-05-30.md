# Merge Guard Report — `fix/letters-e2e-sales-assertion`

**Date**: 2026-05-30  
**Branch**: `fix/letters-e2e-sales-assertion`  
**Author**: Akenarin Kongdach  
**Last commit**: `8f3439b6` — fix(letters): E2E SALES assertion was matching CANCELLED tab button  

---

## Summary of Changes

| File | +/- |
|---|---|
| `apps/web/e2e/letters-page.spec.ts` | +8 / -4 |

**What it does**: Fixes a brittle E2E assertion in the SALES-role test for `/letters`. The old test asserted `getByRole('button', { name: 'ยกเลิก' })` has count 0, but the "CANCELLED" status tab also renders a button/element with the text "ยกเลิก", causing false positives. The new test simply verifies that SALES can reach the page (no redirect, heading visible) — a valid, stable assertion.

---

## Issues Found

### Critical — None

### Warning — None

### Info — 1

- The new test drops the "no Cancel button for SALES" assertion. The commit comment correctly notes that the Cancel-button access control is enforced at the API level (`POST /overdue/letters/:id/cancel` returns 403 for SALES) and is unit-tested in the component. Removing a UI-layer assertion for a backend-enforced rule is acceptable, and the comment documents the reasoning. ✅

---

## Verdict: ✅ APPROVE

Single-file E2E fix. The brittle selector is replaced with a stable heading check. Access control for the Cancel action is preserved at the backend (403 on the API endpoint for SALES role). No functional regression.

Safe to merge.
