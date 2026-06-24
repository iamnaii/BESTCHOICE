# Merge Guard Report — feat/integrations-own-category
**Date**: 2026-06-24  
**Branch**: `feat/integrations-own-category`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Commits ahead of main**: 1 (stacks on `feat/settings-sidebar-driven-nav`)  
**Last updated**: 11 hours ago  

---

## File Changes Summary
9 files changed, 59 insertions(+), 30 deletions(−)

| File | Type | Changes |
|------|------|---------|
| `apps/web/src/config/settings-registry.tsx` | Frontend | Split `integrations` out of `system` into its own category |
| `apps/web/src/App.tsx` | Frontend | Redirect chain updated for moved paths |
| `apps/web/src/config/menu.ts` | Frontend | 1-line update |
| 3× test files | Test | Updated assertions |
| `.claude/rules/accounting.md` | Docs | 1-line URL update |

All changes are **frontend-only**.

---

## Security Checklist

| Check | Result |
|-------|--------|
| New controllers with missing `@UseGuards` | N/A |
| `Number()` on money fields | N/A |
| Hardcoded secrets | None |
| Role access regressions | Reviewed — see I1 |

---

## Issues Found

### Critical
_None._

### Warning

**W1 — Old `/settings/integrations` bookmark path no longer redirects (removed)**

The old redirect `<Route path="/settings/integrations" element={<Navigate to="/settings/system/integrations" replace />} />` was removed. However, `/settings/integrations` is now a **valid React Router path** — it renders the new "เชื่อมต่อ" category page (`categoryId="integrations"`). Users who had the old URL bookmarked will land on the correct category page rather than seeing a 404. **Verdict**: the removal is intentional and correct, but worth confirming no external URLs (LINE OA messages, printed QR codes, etc.) point to that exact path.

### Info

**I1 — `system` category roles changed from `['OWNER', 'ACCOUNTANT']` to `['OWNER']`**  
The change is correct: all items within `system` (`test-mode`, `pdpa`, `backup`, `audit-log`, `system-status`) already had individual `roles: ['OWNER']`. The old `ACCOUNTANT` at category level was leftover from when `integrations` (which is `['OWNER', 'ACCOUNTANT']`) lived inside `system`. Moving integrations out made the broader role unnecessary. ACCOUNTANT can still reach "การเชื่อมต่อ" (hub item) via the new `integrations` category.

**I2 — Redirect chain integrity verified**  
Full chain maintained:
- `/settings/system/integrations` → `/settings/integrations/hub` ✅
- `/settings/system/mdm` → `/settings/integrations/mdm` ✅  
- `/settings/mdm-test` → `/settings/integrations/mdm` ✅
- `/settings/integrations` → renders category page (no redirect needed — own route) ✅

**I3 — `Plug` icon correctly imported**  
New category uses `Plug` from `lucide-react` — correctly added to import list.

---

## Recommendation

**APPROVE** — Single-commit change, well-scoped, correct redirect chain. No security or data-integrity issues.

**Merge order note**: Must merge LAST — after `feat/settings-ia-redesign-p3p4` and `feat/settings-sidebar-driven-nav` both land on `main`.

---

## Stack Summary (merge in this order)
1. `feat/settings-ia-redesign-p3p4` → APPROVE
2. `feat/settings-sidebar-driven-nav` → APPROVE  
3. `feat/integrations-own-category` → APPROVE
