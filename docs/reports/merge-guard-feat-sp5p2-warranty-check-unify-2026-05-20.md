# Merge Guard Report — feat/sp5p2-warranty-check-unify

**Date**: 2026-05-20  
**Branch**: `feat/sp5p2-warranty-check-unify`  
**Author**: Akenarin Kongdach  
**Latest commit**: `08e95d74 chore(insurance): Task C.4 — docs update + stale page cleanup (SP5 Phase 2 final)`

---

## File Changes Summary

| File | +/- | Notes |
|------|-----|-------|
| `apps/web/e2e/insurance-warranty-check.spec.ts` | +225 / 0 | New E2E smoke tests (6 scenarios) |
| `apps/web/e2e/insurance-wizard-exchange.spec.ts` | +174 / 0 | New E2E smoke tests (3 scenarios) |
| `apps/web/e2e/insurance-wizard-repair.spec.ts` | +159 / 0 | New E2E smoke tests (4 scenarios) |
| `apps/web/src/App.tsx` | +28 / -14 | Add `/insurance/warranty-check` route; remove `DefectExchangePage` import; add `DefectExchangeRedirect` |
| `apps/web/src/components/DefectExchangeRedirect.tsx` | +13 / 0 | New: redirect `/defect-exchange*` → `/insurance/new?intent=exchange` |
| `apps/web/src/config/menu.ts` | +34 / -14 | Sidebar unification — single "รับประกัน/ส่งซ่อม" parent |
| `apps/web/src/pages/InsurancePage.tsx` | +16 / -16 | "เช็คประกัน" CTA button added to list page header |
| `apps/web/src/pages/insurance/CreateRepairTicketPage.tsx` | 0 / -528 | **Deleted** — superseded by unified wizard |
| `apps/web/src/pages/insurance/RepairTicketDetailPage.tsx` | +47 / -47 | Minor refactor |
| `apps/web/src/pages/insurance/WarrantyCheckPage.test.tsx` | +215 / 0 | New unit tests (8 scenarios) |
| `apps/web/src/pages/insurance/WarrantyCheckPage.tsx` | +172 / 0 | New page at `/insurance/warranty-check` |
| `.claude/rules/accounting.md` | +16 / -2 | Docs update only |

**Total**: 12 files, ~1048 insertions, ~579 deletions  
**Backend changes**: None (frontend-only PR)

---

## Analysis

### Security Checks
- **JwtAuthGuard**: N/A — no new controllers.
- **Raw fetch()**: Not used. All API calls go through `api.get()` from `@/lib/api`. ✓
- **Hardcoded secrets**: None. ✓

### Data Access Patterns
- `WarrantyCheckPage.tsx` uses `useQuery` from `@tanstack/react-query`. ✓
- No mutations → no `queryClient.invalidateQueries()` needed. ✓
- Role-based CTA visibility (`canCreateTicket`) is evaluated from `useAuth()`. ✓

### Design Tokens
- Uses `bg-muted/50`, `text-muted-foreground`, `border-border`, `text-foreground` — all semantic tokens. ✓
- No hardcoded hex colors or `bg-white` / `text-gray-*`. ✓
- Thai text uses `leading-snug` indirectly (via `PageHeader`). ✓

---

## Issues Found

### Critical
_None_

### Warnings

**W1 — `WarrantyCheckPage.tsx:50` — Customer search mode incomplete (UX)**  
The `'customer'` search mode placeholder reads:  
```
Customer UUID (จาก /customers — รอ integrate autocomplete)
```  
A staff member cannot realistically look up a customer by UUID manually. The tab renders and accepts input but forces users to know an internal UUID. If this mode is exposed in production before the autocomplete is added, it will be confusing.

**Mitigation**: Either disable the `ลูกค้า` tab in UI until the autocomplete is ready, or add a `comingSoon` badge to make the incomplete state explicit.

### Info
- `DefectExchangeRedirect.tsx` correctly forwards all query params so existing `/defect-exchange?contractId=X` deep-links continue to work.
- `CreateRepairTicketPage.tsx` deletion is clean — the route was already removed in a prior commit; no orphan routes remain.
- E2E specs are well-guarded: `test.skip()` gracefully on DB-drift or pre-merge server state.

---

## Recommendation

**APPROVE** ✅ _(with suggestion to address W1 before or shortly after merge)_

All critical checks pass. The one warning is a UX concern on an incomplete search mode that won't cause data corruption or security issues. Acceptable to merge and track as a follow-up task.
