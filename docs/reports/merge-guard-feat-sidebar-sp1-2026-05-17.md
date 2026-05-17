# Pre-Merge Guard Report — feat/sidebar-sp1

**Date:** 2026-05-17  
**Branch:** `feat/sidebar-sp1`  
**Author:** Akenarin Kongdach `<iamnaii@MacBook-Pro-khxng-Akenarin.local>`  
**Commits:** 9 (most recent: `947582de` — 2026-05-18 00:59:39 +0700)

---

## File Changes Summary

| File | +/- |
|------|-----|
| `apps/web/src/config/menu.ts` | +332/-5 |
| `apps/web/src/App.tsx` | +137/-1 |
| `apps/web/src/components/layout/Sidebar.tsx` | +156/-8 |
| `apps/web/src/components/ComingSoonPage.tsx` | +84 new |
| `apps/web/src/components/layout/PillSwitcher.tsx` | +52 new |
| `apps/web/e2e/sidebar-zones.spec.ts` | +140 new |
| `apps/web/src/components/layout/MainLayout.tsx` | +59/-5 |
| `apps/web/src/components/layout/GearButton.tsx` | +27 new |
| `apps/web/src/components/layout/LayoutContext.tsx` | +38/-3 |
| `apps/web/src/components/layout/MobileBottomNav.tsx` | +7/-2 |
| `apps/web/src/config/menu.test.ts` | +118 new |
| `apps/web/src/components/ComingSoonPage.test.tsx` | +65 new |
| `apps/web/src/components/layout/LayoutContext.test.tsx` | +59 new |
| docs (3 md files) | +2020 new |
| **Total** | **+3286 / -26** |

**What this branch does:**
- Introduces a two-zone sidebar (SHOP / FIN) with a `PillSwitcher` component and `GearButton`
- Adds `useSidebarZoneStore` (Zustand) with `localStorage` persistence for zone + collapse state
- Adds a cross-zone access guard in `MainLayout` (redirects SALES/ACC if they navigate to FIN-only paths)
- Registers 13 new placeholder routes via a `ComingSoonPage` component (for SP2–SP6 features)
- Adds Playwright E2E tests for zone switching, persistence, cross-zone guard

---

## Issues

### Warning — 13 Placeholder Routes Missing Role-Based ProtectedRoute

**Files:** `apps/web/src/App.tsx` (lines ~1105–1237)

All 13 new `<Route>` elements use `<ComingSoonPage>` without a `<ProtectedRoute roles={[...]}>` wrapper:

```tsx
{/* SP1 placeholder routes */}
<Route path="/finance/vat"     element={<ComingSoonPage feature="VAT (ภ.พ.30)" ... />} />
<Route path="/finance/wht"     element={<ComingSoonPage ... />} />
<Route path="/settings/backup" element={<ComingSoonPage ... />} />
// ... and 10 more
```

The routes ARE behind the top-level `<ProtectedRoute>` (authentication required), but any authenticated role — including SALES — can navigate to `/settings/backup`, `/finance/vat`, `/finance/wht`, etc. and see the "Coming Soon" page.

**Risk level:** Low (no sensitive data rendered, no actions possible), but:
1. Violates least-privilege: SALES should not see finance/settings URLs at all.
2. Sets a bad pattern — when real implementations land in SP2–SP6, the placeholder's missing role guard may be overlooked.

**Fix:** Wrap each placeholder with an appropriate `<ProtectedRoute roles={[...]}>`:

```tsx
<Route
  path="/finance/vat"
  element={
    <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
      <ComingSoonPage feature="VAT (ภ.พ.30)" trackingSP="SP3" eta="ภายในไตรมาส 3/2026" />
    </ProtectedRoute>
  }
/>
<Route
  path="/settings/backup"
  element={
    <ProtectedRoute roles={['OWNER']}>
      <ComingSoonPage feature="Backup" trackingSP="SP4" eta="..." />
    </ProtectedRoute>
  }
/>
```

### Info — localStorage for UI Preferences

**Files:** `apps/web/src/components/layout/LayoutContext.tsx`, `apps/web/e2e/sidebar-zones.spec.ts`

`localStorage` is used for:
- `bc.sidebar.lastZone` — persists the user's selected zone (SHOP/FIN)
- `sidebar_collapse` — persists sidebar collapsed/expanded state

This is **acceptable** per the security rules — the prohibition covers auth tokens only. Zone/UI preferences are non-sensitive.

### Info — Hardcoded Pixel Font Sizes

**Files:** `apps/web/src/components/layout/Sidebar.tsx`, `apps/web/src/components/layout/PillSwitcher.tsx`

```tsx
className="text-[13px] font-semibold ..."  // Sidebar item labels
className="text-[12px] font-semibold ..."  // PillSwitcher badges
```

Minor inconsistency with Tailwind's semantic size scale (`text-xs` = 12px, `text-sm` = 14px). Functionally fine but breaks typographic token consistency. Consider `text-xs`/`text-sm` if exact sizes don't matter.

---

## Recommendation: **REVIEW**

The branch is well-structured with proper design tokens, good test coverage (E2E + Vitest), and clean component architecture. One issue must be addressed before merge:

**Blocker (Warning → fix before merge):**  
Add `<ProtectedRoute roles={[...]}>` wrappers to the 13 SP1 placeholder routes in `App.tsx`. The exact roles per route should match what the real implementation will require (e.g., finance routes → OWNER/FINANCE_MANAGER/ACCOUNTANT; settings routes → OWNER).
