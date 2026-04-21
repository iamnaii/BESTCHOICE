# Merge Guard Report — refactor/contract-create-unify-docs

**Date**: 2026-04-21
**Branch**: `refactor/contract-create-unify-docs`
**Author**: Akenarin Kongdach
**Last commit**: 2026-04-20 — `refactor(contract-create): remove step 4 doc upload — consolidate to detail page`

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/web/src/pages/ContractCreatePage/index.tsx` | +80/-172 — remove Step 4, unify to 3 steps |
| `apps/web/src/pages/ContractCreatePage/hooks/useContractCreateData.ts` | +15/-72 — simplify mutation, remove doc upload logic |
| `apps/web/src/pages/ContractCreatePage/hooks/useOcrFlow.ts` | +0/-25 — remove `setPendingDocs` + `ocrScannedFile` refs |
| `apps/web/src/pages/ContractCreatePage/hooks/useDocumentUpload.ts` | deleted (114 lines) |
| `apps/web/src/pages/ContractCreatePage/components/DocumentUploadStep.tsx` | deleted (263 lines) |
| `apps/web/src/pages/ContractCreatePage/components/ContractSummaryPanel.tsx` | +1/-6 — remove `pendingDocs` prop |
| `apps/web/src/pages/ContractCreatePage/constants.ts` | +1/-17 — reduce STEPS array, remove DOCUMENT_TYPES |
| `apps/web/src/pages/ContractCreatePage/types.ts` | +0/-7 — remove `PendingDoc` type |
| `apps/web/tsconfig.tsbuildinfo` | modified (generated file) |

**9 files changed, 80 insertions(+), 600 deletions(-)**

---

## Issues by Severity

### Critical
_None found._

### Warning

**W-1 · Missing `queryClient.invalidateQueries()` after contract creation mutation**
- File: `apps/web/src/pages/ContractCreatePage/hooks/useContractCreateData.ts:392-407`
- The `createMutation.onSuccess` clears the draft and navigates away, but does not invalidate the contracts cache:
  ```typescript
  onSuccess: (data) => {
    draft.clear();
    toast.success('สร้างสัญญาสำเร็จ — อัปโหลดเอกสารที่หน้ารายละเอียดสัญญา');
    navigate(`/contracts/${data.id}`);
  },
  ```
- Frontend rule: "Cache invalidation: เรียก `queryClient.invalidateQueries()` หลัง mutation เสมอ"
- The user navigates to the contract detail page, which will do a fresh fetch. But the contracts list page (if visited next) will serve a stale cache that doesn't include the new contract until background refetch.
- **Fix**: Add `queryClient.invalidateQueries({ queryKey: ['contracts'] })` in `onSuccess`.

**W-2 · `submit-review` endpoint call removed without confirmation it's no longer needed**
- File: `apps/web/src/pages/ContractCreatePage/hooks/useContractCreateData.ts`
- The old flow had a "สร้าง + ส่งตรวจสอบ" button that called `POST /contracts/:id/submit-review`. This is now removed. The refactored flow only creates the contract; the user must manually submit for review from the contract detail page.
- This is a UX/business logic change, not a code defect — but confirm with product owner that the submit-review step is intentionally deferred to the detail page, and that the `submit-review` API endpoint can still be reached there.

### Info

**I-1 · `apps/web/tsconfig.tsbuildinfo` committed**
- This is a generated TypeScript incremental build cache file. It should be in `.gitignore`. Committing it adds noise to the diff and can cause conflicts on other contributors' machines.
- **Recommendation**: Add `**/tsconfig.tsbuildinfo` to `.gitignore` if not already present.

**I-2 · OCR scanning still works in Step 2 (Customer Select) but the resulting scanned file is no longer attached as a pending document**
- The `ocrScannedFile` state and auto-`setPendingDocs` logic in `useOcrFlow` was removed as part of this refactor. This means scanning a national ID card in Step 2 will still populate customer form fields (correct), but the scanned image file will no longer be auto-added to the contract's document list.
- The user must re-upload the ID card image from the contract detail page. This is the intended behavior per the refactor, but worth noting for UX testing.

**I-3 · `Save` import from `lucide-react` removed but the `Send` import is retained**
- File: `apps/web/src/pages/ContractCreatePage/index.tsx:3`
- Minor: `Save` icon is removed (correct, the "บันทึกร่าง" button no longer exists), `Send` icon is kept for the "สร้างสัญญา" button. No issue.

---

## Recommendation: **REVIEW**

This is a clean, focused refactoring that reduces code complexity significantly (-520 net lines). The logic is correct and the OCR flow is preserved. Fix **W-1** (add `invalidateQueries` after contract creation) before merging. Confirm **W-2** with the product owner. Address **I-1** (`tsconfig.tsbuildinfo` in .gitignore) as a follow-up or in this PR.
