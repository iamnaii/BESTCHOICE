# Merge Guard Report — feat/p2-sp3-etax-thai-font

**Date**: 2026-05-18  
**Branch**: `feat/p2-sp3-etax-thai-font`  
**Author**: Akenarin Kongdach  
**Recommendation**: ✅ **APPROVE**

---

## File Changes Summary

| File | Lines Changed | Notes |
|------|--------------|-------|
| `apps/api/src/modules/e-tax/e-tax.service.ts` | +302 / -79 | Thai font integration + ม.86/4 invoice layout |
| `apps/api/src/modules/e-tax/thai-font.util.ts` | +89 (new) | Font loader utility |
| `apps/api/src/modules/e-tax/__tests__/e-tax.service.spec.ts` | +121 | Tests for Thai PDF + issuer lookup |
| `apps/web/src/pages/ETaxInvoicePage.tsx` | ±28 | UI text/banner update only |
| `apps/web/src/pages/ETaxInvoicePage.test.tsx` | ±16 | Test strings updated to match new UI text |

---

## Issues

No Critical issues found.

### 🟡 Warning

#### W1 — Duplicate entry in `FONT_DIR_CANDIDATES`

**File**: `apps/api/src/modules/e-tax/thai-font.util.ts`, lines 30–35

```typescript
const FONT_DIR_CANDIDATES = [
  // Dev: apps/api/src/modules/e-tax/ → ../../assets/fonts/
  path.join(__dirname, '..', '..', 'assets', 'fonts'),
  // Prod (nest build): dist/src/modules/e-tax/ → ../../assets/fonts/
  path.join(__dirname, '..', '..', 'assets', 'fonts'),  // ← exact duplicate
  ...
];
```

Both of the first two candidates resolve to the same `__dirname/../../assets/fonts` path regardless of dev or prod context (`__dirname` is already runtime-resolved). In a Cloud Run prod image where `dist/` is the root, `__dirname` will already point into `dist/`, so the second candidate is redundant. Harmless — `Array.find` short-circuits on the first match — but the comment suggests they should differ.

**Suggested fix**: replace the second candidate with the actual dist-specific path or remove it and rely on the cwd-relative fallbacks (candidates 3–5) which correctly target `dist/src/assets/fonts`.

#### W2 — Silent font fallback uses `console.error` instead of Sentry

**File**: `apps/api/src/modules/e-tax/thai-font.util.ts`, `loadFontBase64()`

When the font file is missing, the utility logs via `console.error` and returns an empty string (PDF renders with Helvetica). A missing font in production would produce tofu-box PDFs silently delivered to customers as ม.86/4 tax invoices — legal compliance failure.  
Given that other cron/service errors in this codebase forward to Sentry, `Sentry.captureException` or at minimum `Sentry.captureMessage` would make the failure visible in the dashboard without crashing the PDF endpoint.

---

### 🔵 Info

#### I1 — `companyInfo.findFirst` mock must be set per-test

**File**: `apps/api/src/modules/e-tax/__tests__/e-tax.service.spec.ts`

The test module sets `companyInfo: { findFirst: jest.fn().mockResolvedValue(null) }` as the default. Tests that exercise the issuer-populated PDF path must call `.mockResolvedValueOnce(issuerFixture)` explicitly. This is correct but relies on test-ordering being irrelevant — verified by the spec, but worth documenting in a comment for future test authors.

---

## What's Good ✅

- All money fields in new `e-tax.service.ts` code use `Prisma.Decimal` ✅
- `deletedAt: null` in all new queries ✅
- No new controllers — existing ETaxController guards unchanged ✅
- No raw `fetch()` in frontend changes ✅
- No hardcoded secrets ✅
- Font utility uses module-scoped caching (`cachedBase64`) — no per-request disk I/O ✅
- Font fallback degrades gracefully (no crash on missing asset) ✅
