# Pre-Merge Guard Report — Dependency Update Branches

**Date**: 2026-04-13
**Author**: iamnaii <akenarin.ak@gmail.com>
**Reviewer**: Pre-Merge Guard Agent

---

## Branch 1: `chore/deps-tier3-chunk9-react-router7`

**Recommendation**: ✅ APPROVE

### File Changes Summary

56 files changed, 83 insertions(+), 83 deletions(-)

Pure import-path migration: `react-router-dom` → `react-router` (v7 merged the two packages into one).

### Checks

| Check | Result |
|-------|--------|
| New controllers | None |
| `Number()` on financial fields | None |
| Missing `deletedAt: null` | N/A (no new queries) |
| Hardcoded secrets | None |
| Raw `fetch()` in frontend | None |
| Missing `invalidateQueries()` | N/A (no new mutations) |

### Issues

**Critical**: 0 | **Warning**: 0 | **Info**: 0

All 56 changed files are mechanical 1-line import replacements across pages (`ContractsPage`, `CustomerDetailPage`, `ContractCreatePage`, etc.), components (`Sidebar`, `TopBar`, `ProtectedRoute`, etc.), and app entry (`main.tsx`). No remaining `react-router-dom` imports detected in the diff. No logic changes, no security impact.

`vite.config.ts` also correctly updates the vendor chunk to reference `react-router` instead of `react-router-dom`.

---

## Branch 2: `chore/deps-tier3-chunk7-vite8`

**Recommendation**: ✅ APPROVE

### File Changes Summary

4 files changed, 1219 insertions(+), 1553 deletions(-) — mostly `package-lock.json` churn

### Meaningful changes

| File | Change |
|------|--------|
| `apps/web/package.json` | Bumps vite 6→8, @vitejs/plugin-react 4→6, vitest 2→4 |
| `apps/web/vite.config.ts` | Migrates `build.rollupOptions.output.manualChunks` → `build.rolldownOptions.manualChunks` (Rolldown API in Vite 8); adds `react-router` to vendor chunk |
| `apps/web/src/contexts/AuthContext.test.tsx` | Minor test assertion alignment for updated mock behavior |

### Checks

| Check | Result |
|-------|--------|
| New controllers | None |
| `Number()` on financial fields | None |
| Missing `deletedAt: null` | N/A |
| Hardcoded secrets | None |
| Raw `fetch()` in frontend | None |
| Security-relevant logic change | None |

### Issues

**Critical**: 0 | **Warning**: 0 | **Info**: 0

No application logic changes. Bundle splitting strategy preserved (vendor / query / liff / excel / pdf / charts chunks). Test fix in `AuthContext.test.tsx` correctly aligns expectations with the updated mock behavior — not a regression.
