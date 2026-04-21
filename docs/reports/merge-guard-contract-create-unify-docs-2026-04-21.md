# Pre-Merge Guard Report — refactor/contract-create-unify-docs

**Date:** 2026-04-21
**PR:** #606 — refactor(contract-create): consolidate doc upload to detail page
**Author:** Akenarin Kongdach
**Branch:** `refactor/contract-create-unify-docs` → `main`
**Files changed:** 9 files (+80 / -600) — net −520 LOC

---

## File Changes Summary

| File | Change |
|------|--------|
| `ContractCreatePage/components/DocumentUploadStep.tsx` | Deleted (263 LOC) |
| `ContractCreatePage/hooks/useDocumentUpload.ts` | Deleted (114 LOC) |
| `ContractCreatePage/constants.ts` | Removed `DOCUMENT_TYPES`, updated `STEPS` (4→3) |
| `ContractCreatePage/types.ts` | Removed `PendingDoc` interface |
| `ContractCreatePage/hooks/useContractCreateData.ts` | Simplified mutation (removed doc upload loop + submit-for-review dual-button) |
| `ContractCreatePage/hooks/useOcrFlow.ts` | Removed `setPendingDocs` cross-dependency, removed `ocrScannedFile` auto-attach |
| `ContractCreatePage/components/ContractSummaryPanel.tsx` | Removed `pendingDocs` prop |
| `ContractCreatePage/index.tsx` | Removed Step 4, removed `useDocumentUpload` hook, removed "สร้าง + ส่งตรวจสอบ" dual-button |

---

## Issues by Severity

### 🔴 Critical — NONE

No security issues, missing guards, money field violations, or missing soft-delete filters.

### 🟡 Warning — NONE

No missing DTO validation, no raw `fetch()`, no missing `invalidateQueries`.

### 🔵 Info — NONE

---

## Recommendation

**✅ APPROVE — Safe to merge.**

This is a pure deletion refactor that removes the doc-upload wizard step (Step 4) and moves document upload responsibility to the contract detail page. Changes are well-scoped:

- Backend endpoints (`POST /contracts/:id/documents`, `POST /contracts/:id/submit-review`) are untouched — no API breakage.
- OCR auto-fill still works via smart card reader in the customer modal.
- The `ContractCreatePage` mutation is simplified and correct: creates contract → redirect → user uploads docs at detail page.
- TypeScript: 0 errors (confirmed in PR description).
- No dead code left behind — all types (`PendingDoc`), constants (`DOCUMENT_TYPES`), and hooks (`useDocumentUpload`) were fully removed.

**Note for QA:** Manually verify that creating a new contract → redirecting to `/contracts/:id` → uploading documents there works end-to-end, as the E2E smoke test for this flow is marked pending in the PR.
