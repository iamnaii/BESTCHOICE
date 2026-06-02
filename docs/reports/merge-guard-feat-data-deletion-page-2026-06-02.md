# Merge Guard Report — feat/data-deletion-page

**Date:** 2026-06-02  
**Branch:** `feat/data-deletion-page`  
**Author:** Akenarin Kongdach  
**Commit:** `1e38eee5` — feat(privacy): add public /privacy/data-deletion instructions page  
**Recommendation:** ✅ APPROVE

---

## File Changes Summary

| File | Changes |
|------|---------|
| `apps/web/src/App.tsx` | +2 lines — lazy import + new public route `/privacy/data-deletion` |
| `apps/web/src/pages/DataDeletionPage.tsx` | +123 lines — new public PDPA data-deletion instructions page |

**Total:** 2 files changed, 125 insertions

---

## Issues Found

### Critical — 0 found ✅

### Warning — 0 found ✅

### Info

| # | File | Note |
|---|------|------|
| I-1 | `DataDeletionPage.tsx:44` | Contact email `akenarin.ak@gmail.com` and phone `0955678887` are hardcoded in source. These are intentional business contact details (required by Meta's App Review for PDPA compliance), but updating them in the future requires a code change. Consider sourcing from `CompanyInfo` API or a config constant if these are expected to change. |
| I-2 | `DataDeletionPage.tsx` | Page does not set `<title>` or Open Graph meta tags. For a public-facing PDPA page that Meta links to directly, a `<Helmet>` or `document.title` assignment could help with clarity. Not a correctness issue. |
| I-3 | `App.tsx:270` | Route correctly placed outside `ProtectedRoute` wrapper — page is public, matching `/privacy` pattern. ✓ |

---

## Detailed Analysis

### Purpose
This page serves as the "Data Deletion Instructions URL" required by Facebook App settings (Settings → Basic) to comply with Meta's GDPR/PDPA data deletion policy. Without it, the Facebook app integration could be flagged during Meta App Review.

### Security
- Route is **public** (no `ProtectedRoute` wrapper) — this is correct and intentional; the page must be accessible without login for Meta's automated checks.
- No API calls, no user data exposed.
- No XSS vectors — all content is static strings, no `dangerouslySetInnerHTML`.

### Frontend patterns compliance
- **Lazy loading:** `React.lazy()` used ✓
- **Design tokens:** `bg-background`, `text-foreground`, `text-muted-foreground`, `bg-muted`, `border-border` — no hardcoded colors ✓
- **Thai text:** `leading-snug` / `leading-relaxed` on Thai text elements ✓
- **No raw fetch / no API calls:** static content page, N/A ✓

### Content correctness
- PDPA Thai law reference (พ.ศ. 2562) ✓
- 30-day processing window stated ✓
- Legal retention exceptions listed ✓
- English summary included for Meta's automated review ✓

---

## Verdict

**✅ APPROVE** — Simple, compliant public page needed for Meta App Review. No security or pattern violations. The one actionable Info item (hardcoded contacts) is a design note for future maintainability, not a blocking concern.
