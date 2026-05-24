# Merge Guard Report — feat/data-deletion-page

**Date**: 2026-05-24  
**Branch**: `feat/data-deletion-page`  
**Author**: Akenarin Kongdach  
**Reviewed against**: `origin/main`

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/web/src/App.tsx` | +2 lines — adds lazy import + route |
| `apps/web/src/pages/DataDeletionPage.tsx` | +123 lines — new public page |

**Total**: 2 files changed, 125 insertions

---

## Purpose

Adds a public `/privacy/data-deletion` page required by Meta for Facebook App Review (Settings → Basic → Data Deletion Instructions URL). The page is a static PDPA compliance page with contact channels for data deletion requests.

---

## Critical Issues

_None._

---

## Warning Issues

_None._

---

## Info

| # | Location | Note |
|---|----------|------|
| I-1 | `DataDeletionPage.tsx:28` | Date "24 พฤษภาคม 2569" is hardcoded — requires a code change each time the policy is updated. Acceptable for a legal page but worth noting. |
| I-2 | `DataDeletionPage.tsx:35–55` | Contact details (email, phone, LINE OA handle) are inline JSX. Acceptable for a static legal page; no environment-variable abstraction needed unless contact channels frequently change. |

---

## Checklist

- [x] No `@UseGuards` needed — public route, no backend changes
- [x] Route is correctly unprotected (no `ProtectedRoute` wrapper)
- [x] Design tokens used correctly (`bg-background`, `text-foreground`, `text-muted-foreground`, `bg-muted`)
- [x] Thai text uses `leading-snug` throughout
- [x] Page lazy-loaded via `React.lazy()` in `App.tsx`
- [x] No money fields, no DB access, no mutations

---

## Recommendation

**APPROVE** — Clean public static page. No security or convention issues.
