# Merge Guard Report — fix/letters-e2e-sales-assertion

**Date:** 2026-06-01  
**Branch:** `fix/letters-e2e-sales-assertion`  
**Reviewed against:** `origin/main`

---

## File Changes Summary

| File | +/- | Notes |
|------|-----|-------|
| `apps/web/e2e/letters-page.spec.ts` | +8 / −4 | Replace brittle Cancel-button assertion with page-access check |

---

## Issues by Severity

### Critical — None

### Warning — None

### Info

- **Reduced assertion scope** — the old test checked that `button[name="ยกเลิก"]` has count 0 for SALES role. This was ambiguous because the "CANCELLED" status tab renders a button with matching text. The replacement asserts `h1[name="จัดการจดหมาย"]` is visible and the URL stays at `/letters`, which correctly verifies that SALES can reach the page without a redirect.
- **Backdoor coverage note in comment** — the comment correctly states that cancel-button permission is enforced both at the backend (`POST /overdue/letters/:id/cancel` returns 403 for SALES) and at the component unit-test level, so the E2E does not need to re-test it.

---

## Recommendation

**✅ APPROVE**

Single-file test fix. Removes a false-negative assertion, replaces it with a correct access-gate check. No production code changed.
