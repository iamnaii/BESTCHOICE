# Pre-Merge Guard Report — fix/letters-e2e-sales-assertion

**Date**: 2026-05-29  
**Branch**: `fix/letters-e2e-sales-assertion`  
**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-26 — fix(letters): E2E SALES assertion was matching CANCELLED tab button

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/web/e2e/letters-page.spec.ts` | +8 / -4 — replaces brittle button-text assertion with stable heading/URL check |

---

## Issues Found

### Critical
_None._

### Warning
_None._

### Info

- **Test-only change** — no production code modified.
- **Root cause of old brittleness**: the "CANCELLED" status tab label (`ยกเลิก`) is identical to the Cancel action button label, so `getByRole('button', { name: 'ยกเลิก', exact: true }).toHaveCount(0)` was checking the wrong thing and was prone to false passes/fails depending on what content loaded.
- **New assertion is correct**: verifying that the SALES role lands on `/letters` with the page heading `จัดการจดหมาย` is a robust access-control smoke test. The comment in the new code correctly explains that SALES cancel-permission enforcement is already covered by backend `@Roles` guards (403 on POST) and unit-tested component logic — not a job for this E2E.

---

## Recommendation

**✅ APPROVE**

Single-file, test-only change that repairs a brittle assertion with a semantically correct one. No production risk.
