# Merge Guard Report — `fix/pdf-preview-modal`

**Date**: 2026-04-23  
**Branch**: `fix/pdf-preview-modal`  
**Author**: Akenarin Kongdach  
**Last commit**: 2026-04-22  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

| File | +/- |
|------|-----|
| `apps/api/src/modules/contracts/contract-document.service.ts` | +1 / -1 |
| `apps/api/src/modules/contracts/contract-documents.service.ts` | +6 / -2 |
| `apps/api/src/utils/validation.util.ts` | +7 / -2 |
| `apps/web/src/components/contract/DocumentUpload.tsx` | +69 / -49 |

**Total**: 4 files, 69 insertions / 49 deletions (net +20 lines)

---

## Issues

### 🔴 Critical — None

### 🟡 Warning (1)

**W-1 · `download` attribute ineffective for cross-origin S3 URLs**  
`DocumentUpload.tsx` — The new preview modal header includes:
```tsx
<a href={viewingFile.url} download={viewingFile.name} target="_blank" rel="noopener noreferrer">
  ดาวน์โหลด
</a>
```
The HTML `download` attribute is ignored by browsers for cross-origin URLs (which all S3 / CloudFront file URLs are). The link will open the file in a new tab instead of downloading it. This is a browser security restriction and cannot be worked around from the frontend alone without a server-side download proxy.

**Options**: (a) accept current behavior — the file opens in a new tab, which is usable; (b) add a backend `/contracts/:id/documents/:docId/download` proxy endpoint that sets `Content-Disposition: attachment`. Option (a) is acceptable for now given scope.

### 🔵 Info (2)

**I-1 · Business logic change: removed `DOWN_PAYMENT_RECEIPT` + `PDPA_CONSENT` from required docs**  
Consistent across 3 files (`contract-document.service.ts`, `contract-documents.service.ts`, `validation.util.ts`). Comments explain the rationale clearly: PDPA_CONSENT is auto-generated post e-signature; DOWN_PAYMENT_RECEIPT is recorded through POS, not file upload. Change is intentional and documented.

**I-2 · PDF preview uses `<iframe>` — subject to browser CSP / X-Frame-Options**  
The new modal renders non-image files in an `<iframe src={viewingFile.url}>`. If the S3 bucket or CDN sets `X-Frame-Options: DENY` or a strict `frame-ancestors` CSP, the iframe will be blocked. Test with production S3 URLs before releasing to confirm the iframe renders correctly.

---

## Security Checklist

| Check | Result |
|-------|--------|
| No new controllers | ✅ Only service and UI changes |
| `@UseGuards` / `@Roles` unchanged | ✅ Existing guards untouched |
| No `Number()` on money fields | ✅ No financial arithmetic |
| `deletedAt: null` in queries | ✅ No new DB queries |
| No hardcoded secrets | ✅ Clean |
| Frontend uses `api.*` | ✅ No new API calls added; uses existing query data |
| No raw `fetch()` | ✅ Clean |
| `queryClient.invalidateQueries()` after mutations | ✅ No mutations added; view-only changes |

---

## Recommendation: ✅ APPROVE

Clean, well-scoped fix. The document preview refactor (modal instead of new-tab popup) is a usability improvement. The required-docs simplification is consistent and documented. W-1 (`download` attribute) is a known browser limitation — the current fallback (open-in-new-tab) is acceptable. Can merge as-is.
