# Merge Guard Report — feat/p3-sp6-e2e-expansion

**Date**: 2026-05-18  
**Branch**: `feat/p3-sp6-e2e-expansion`  
**Author**: Akenarin Kongdach  
**Commits**: 4  
**Files changed**: 12 (+1,033 / -0)  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

| Area | Files | Notes |
|------|-------|-------|
| E2E POMs | `PosPage.ts`, `QuoteCreatePage.ts`, `YearEndClosingPage.ts`, `BookingPage.ts`, `ContractCreatePage.ts` | New Page Object Models |
| E2E Specs | `pos-surfaces.spec.ts`, `quote-to-sale.spec.ts`, `year-end-closing-guards.spec.ts`, `booking-deposit-convert.spec.ts`, `installment-surfaces.spec.ts` | 5 golden-path flow specs |
| Test helpers | `e2e/fixtures/seed-data.ts` | Extended seed helpers |
| Config | `playwright.config.ts` | Retry + timeout tuning |

---

## Critical Issues

None found.

This branch contains **only E2E test files and Playwright config**. No backend controllers, no services, no DTOs, no Prisma schema changes. All critical security checks (guards, money types, soft-delete, SQL injection) are N/A.

---

## Warning Issues

### W1 — Test credentials use documented dev accounts only
**File**: `apps/web/e2e/fixtures/seed-data.ts`  
Credentials (`admin1234`) are the same test accounts documented in `CLAUDE.md`. Acceptable for E2E test fixtures. No production credentials present. ✅

### W2 — `retries: process.env.CI ? 2 : 1` may mask flaky tests locally
**File**: `apps/web/playwright.config.ts`  
Retrying once locally (changed from 0) means a flaky test can silently pass on the developer's machine. The fix-commit message (`68bedebb`) explicitly scoped specs down to reduce flakiness rather than relying on retries — this is the right approach. Acceptable trade-off.

---

## Info

### I1 — `timeout: 30_000` added globally; flow specs opt-in to 60s
The global 30s timeout protects the 80+ existing smoke specs from slow regressions. Flow specs that need longer use `test.describe.configure({ timeout: 60_000 })` locally. Good pattern.

### I2 — Spec naming scoped correctly after fix commit
Commit `68bedebb` renamed specs from over-broad golden-path names to honest `*-surfaces.spec.ts` names that describe what's actually tested. This avoids false confidence in CI.

---

## Test Coverage Added

| Spec | What it covers |
|------|----------------|
| `pos-surfaces.spec.ts` | POS page renders, cash-sale flow surfaces |
| `quote-to-sale.spec.ts` | Quote creation → sales conversion UI flow |
| `booking-deposit-convert.spec.ts` | Booking → deposit → contract convert |
| `installment-surfaces.spec.ts` | Installment contract creation surfaces |
| `year-end-closing-guards.spec.ts` | OWNER-only guards on year-end closing page |

---

## Recommendation: ✅ APPROVE

Pure test/config additions. No security surface, no production code. The fix commit properly scoped overreaching specs. Safe to merge.
