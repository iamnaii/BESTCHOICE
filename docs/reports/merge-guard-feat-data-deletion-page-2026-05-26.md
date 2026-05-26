# Merge Guard Report — feat/data-deletion-page

**Date**: 2026-05-26
**Branch**: `feat/data-deletion-page`
**Author**: Akenarin Kongdach
**Recommendation**: ✅ APPROVE

---

## Summary

Adds a public static PDPA data-deletion instructions page at `/privacy/data-deletion` to satisfy Meta's Facebook App "Data Deletion Instructions URL" requirement (App Settings → Basic).

**Files changed (2)**:
```
apps/web/src/App.tsx                    +2
apps/web/src/pages/DataDeletionPage.tsx +123 (new)
```

---

## Issues

### Critical
_None found._

### Warning
_None found._

### Info

**I1 — Public route with no auth guard (intentional)**

`/privacy/data-deletion` is added as a public unauthenticated route alongside `/privacy`. This is intentional — Meta requires the data deletion URL to be publicly accessible without login so users can find it from the Facebook platform. No security concern.

**I2 — Contact details hardcoded in the page**

Email `akenarin.ak@gmail.com`, LINE `@bestchoice`, and phone `095-567-8887` are hardcoded in the JSX. This is appropriate for a legal/PDPA contact page — the content is intentionally public. If these contact details ever change, the page will need a code update, but that is acceptable for a compliance page.

**I3 — Page uses semantic CSS tokens throughout**

No hardcoded hex colours, no `bg-gray-*` / `text-gray-*`. All tokens (`bg-background`, `text-foreground`, `text-muted-foreground`, `bg-muted`, `border-border`, `text-primary`) conform to the project's design token convention. `leading-snug` is used on all Thai-language text paragraphs. ✓

**I4 — Lazy-loaded correctly**

```tsx
const DataDeletionPage = lazy(() => import('@/pages/DataDeletionPage'));
```
Follows the project's lazy-load pattern. ✓

---

## Recommendation: ✅ APPROVE

Clean implementation. Public page with no auth, no API calls, no hardcoded colours, correct lazy-loading. No issues requiring action.
