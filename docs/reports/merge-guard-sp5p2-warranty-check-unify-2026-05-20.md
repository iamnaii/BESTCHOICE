# Pre-Merge Guard Report: feat/sp5p2-warranty-check-unify

**Date**: 2026-05-20  
**Branch**: `feat/sp5p2-warranty-check-unify`  
**Latest commit**: `ea454def` (8 commits ahead of main)  
**Compared against**: `origin/main`

---

## Summary

SP5 Phase 2 final PR (C): adds a standalone `WarrantyCheckPage`, unifies the Insurance sidebar entry under a single parent, replaces the `/defect-exchange` route with a redirect to the unified wizard, and deletes the now-superseded `CreateRepairTicketPage`. Includes E2E smoke specs for warranty-check, wizard (repair branch), and wizard (exchange/bypass branch).

## File Changes

| File | +/- | Notes |
|------|-----|-------|
| `apps/web/src/pages/insurance/WarrantyCheckPage.tsx` | +172 / 0 | New lookup page |
| `apps/web/src/pages/insurance/WarrantyCheckPage.test.tsx` | +215 / 0 | Unit tests |
| `apps/web/src/pages/insurance/CreateRepairTicketPage.tsx` | 0 / -528 | Deleted — superseded by wizard |
| `apps/web/src/pages/insurance/RepairTicketDetailPage.tsx` | +47 / -22 | Role-gate on replace action |
| `apps/web/src/pages/InsurancePage.tsx` | +11 / -5 | Adds "เช็คประกัน" CTA button |
| `apps/web/src/components/DefectExchangeRedirect.tsx` | +13 / 0 | Redirect helper |
| `apps/web/src/App.tsx` | +22 / -5 | New routes for warranty-check + redirect |
| `apps/web/e2e/insurance-warranty-check.spec.ts` | +225 / 0 | E2E smoke |
| `apps/web/e2e/insurance-wizard-exchange.spec.ts` | +174 / 0 | E2E smoke |
| `apps/web/e2e/insurance-wizard-repair.spec.ts` | +159 / 0 | E2E smoke |
| Docs (3 md files) | +212 / 0 | Design docs |

**Total**: 12 files changed, 1048 insertions, 579 deletions.

---

## Issues Found

### Critical
*None.*

### Warning

- **W-01** — `WarrantyCheckPage` customer search mode shows placeholder "Customer UUID (จาก /customers — รอ integrate autocomplete)". Users must know and paste a raw UUID. The 'customer' tab is effectively unusable from the UI until an autocomplete is wired in. Recommend either hiding the 'customer' tab for now or adding a comment in the ticket to track this.

- **W-02** — `RepairTicketDetailPage.tsx` now shows the "ซ่อมไม่ได้ — ออกใหม่" button only to `OWNER` and `BRANCH_MANAGER` (`canReplace`). However, the old "เปลี่ยนเครื่องแทน" button was visible to ALL roles. This tightens access correctly — but verify with the owner that SALES role should NOT have this action (they previously could navigate to `/defect-exchange`).

### Info

- **I-01** — `WarrantyCheckPage` has no `staleTime` on the `warranty-lookup` query. Each mode-switch that sets `submitted = ''` clears the result, which is the intended behaviour. No functional issue.

- **I-02** — `/insurance/warranty-check` is in `ProtectedRoute` with all 5 roles including `ACCOUNTANT` and `FINANCE_MANAGER`. They can look up warranty status but cannot create tickets (guarded by the page-level `canCreateTicket` check). This is intentional read-only access for finance staff. ✓

- **I-03** — E2E specs use the `gotoWithRetry` + graceful skip pattern consistently. Tests will not block CI on DB drift. ✓

---

## Recommendation: ✅ APPROVE (with W-01 tracked)

Security posture is sound: `useQuery` + `api.get()`, proper ProtectedRoute roles, role-gated action buttons. The only merge blocker would be if the owner requires the "ซ่อมไม่ได้ — ออกใหม่" button to be accessible to SALES (W-02) — confirm before merge. W-01 (customer UUID input) should be filed as a follow-up ticket.
