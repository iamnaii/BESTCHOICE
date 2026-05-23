# Merge Guard Report — fix/menu-dedup-and-restructure

**Date**: 2026-05-23  
**Branch**: `fix/menu-dedup-and-restructure`  
**Base**: `origin/main`  
**Reviewed by**: Pre-Merge Guard Agent

---

## File Changes Summary

| File | +/- |
|------|-----|
| `apps/web/src/config/menu.ts` | +26 / -84 |
| `apps/web/src/config/menu.test.ts` | +1 / -1 |

Total: **3 files changed**, 26 insertions(+), 84 deletions(-)

---

## Commits on Branch (beyond main)

_(branch tip diff vs main — single logical change)_

---

## Issues

### Critical
_None found._

### Warning

**W1 — Test assertion replaced with a comment, not updated**  
`menu.test.ts` removes `expect(keys).toContain('owner-fin-collection')` and replaces it with a comment:
```
// owner-fin-collection removed — collection links merged into owner-fin-revenue
```
The merged overdue/MDM/repossession links now live in `owner-fin-revenue`. No assertion verifies that `owner-fin-revenue` still contains the `/overdue`, `/mdm`, and `/repossessions` paths after the restructure. A future refactor could silently remove them.

**Recommended fix**: Replace the removed assertion with assertions on the new location, e.g.:
```ts
const ownerFinRevItems = getSidebarForRole('OWNER', 'fin')
  .find(s => s.key === 'owner-fin-revenue')?.items ?? [];
expect(ownerFinRevItems.some(i => i.path === '/overdue')).toBe(true);
expect(ownerFinRevItems.some(i => i.path === '/repossessions')).toBe(true);
```

### Info

**I1 — Insurance menu flattened (nested children removed)**  
For SALES, BRANCH_MANAGER, and OWNER: the `รับซ่อม/รับประกัน` nested children are removed and replaced with two flat items (`รับซ่อม/รับประกัน` → `/insurance` and `เช็คประกัน` → `/insurance/warranty-check`). This is a navigation simplification — no routing or API impact.

**I2 — `owner-fin-collection` section removed**  
The dedicated "ติดตามหนี้" sidebar section for OWNER is removed. Its 3 items (overdue, repossessions, MDM) are merged into `owner-fin-revenue`. The items are present in the new section — no functionality lost.

**I3 — `owner-accounting` section renamed and de-duplicated**  
Period-close items moved out of `owner-accounting` into dedicated `owner-period-close` section. `owner-accounting` renamed to "งบการเงิน". Cleans up the previous duplication where `/monthly-close` and `/accounting/periods` appeared in two places.

**I4 — MDM icon changed from `Smartphone` to `Lock`**  
"ล็อคเครื่อง (MDM)" item now uses the `Lock` icon (same as repossessions). Both repossession and MDM items use `Lock` — slightly ambiguous but acceptable for sidebar density.

**I5 — MDM removed from integrations section**  
`/mdm` (`จัดการอุปกรณ์ (MDM)`) removed from the integrations zone and kept only in `owner-fin-revenue`. Reduces duplication.

---

## Recommendation

**REVIEW** — The restructure is logically sound and reduces duplication. The single Warning (W1) is a test coverage gap: the removed assertion is not replaced with an equivalent check for the new location of collection links. This is low risk but should be addressed before merge to prevent silent regressions in future menu refactors.

_No security, money, or data-integrity concerns. Backend unchanged._
