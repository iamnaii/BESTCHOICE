# Merge Guard Report — `fix/customer-intake-bank-statement-pdf`

**Date**: 2026-04-23  
**Branch**: `fix/customer-intake-bank-statement-pdf`  
**Author**: Akenarin Kongdach  
**Last commit**: 2026-04-22  
**Recommendation**: ⚠️ REVIEW

---

## File Changes Summary

| File | +/- |
|------|-----|
| `apps/api/src/modules/ocr/dto/ocr.dto.ts` | +10 / -4 |
| `apps/api/src/modules/ocr/ocr.controller.ts` | +1 / -1 |
| `apps/api/src/modules/ocr/ocr.service.ts` | +78 / -14 |
| `apps/web/e2e/customer-intake-pdf-upload.spec.ts` | +211 (new) |
| `apps/web/src/components/credit-check/useCreditCheckCreate.ts` | +18 / -7 |
| `apps/web/src/lib/compressImage.ts` | +29 |
| `apps/web/src/pages/CustomerIntakePage/components/PreCheckUploadStep.tsx` | +55 / -26 |

**Total**: 7 files changed

---

## Issues

### 🔴 Critical — None

### 🟡 Warning (2)

**W-1 · Possible TypeScript type mismatch in `analyzeBankStatement`**  
`ocr.service.ts` — The new `callClaudeOcrMultiFileWithRetry` returns `Promise<Record<string, unknown>>`, but `analyzeBankStatement` is typed to return `Promise<OcrBankStatementResult>`. The diff does not show the return statement casting — if the existing code relies on implicit coercion without an explicit cast or type assertion, TypeScript may report an error or the runtime shape may not match the declared type at callsites.

**Action required**: Run `./tools/check-types.sh api` before merge to confirm there are no type errors in `ocr.service.ts`.

**W-2 · `<button>` → `<div role="button">` a11y regression**  
`PreCheckUploadStep.tsx` — The original upload area was a native `<button>` element. It has been replaced with a `<div role="button">` to enable drag-and-drop. Native `<button>` fully supports `onDragOver`/`onDrop` in React. CLAUDE.md notes v4 hardening explicitly fixed "div→button" regressions. The new code does provide correct `tabIndex`, `aria-disabled`, and `onKeyDown` handling, but using `<div role="button">` is a weaker pattern than `<button>`. 

**Suggested fix**:
```tsx
<button
  type="button"
  disabled={ocrLoading}
  onClick={() => fileRef.current?.click()}
  onDragOver={...}
  onDrop={...}
  onDragLeave={...}
  className="..."
>
```

### 🔵 Info (2)

**I-1 · Multi-line JSDoc comments in `compressImage.ts`**  
`fileToBase64DataUrl` and `fileToOcrBase64` each have a multi-line `/** */` block. Per coding standards: one short comment line max. Content is useful but format violates the rule.

**I-2 · E2E test uses `test.skip()` on navigation failure**  
`customer-intake-pdf-upload.spec.ts` uses `if (!ok) test.skip()` after `gotoWithRetry`. This pattern silently skips tests if the page is unavailable in CI. Acceptable as a smoke-gate pattern, but a clear comment explaining the intent would help future readers.

---

## Security Checklist

| Check | Result |
|-------|--------|
| `@UseGuards` / `@Roles` on controller | ✅ Existing OCR controller — guards unchanged, OWNER/BRANCH_MANAGER/FINANCE_MANAGER/SALES |
| No `Number()` on money fields | ✅ `Number(bestResult.confidence)` is a 0–1 score, not financial data |
| `deletedAt: null` in queries | ✅ No new DB queries |
| No hardcoded secrets | ✅ Clean |
| Frontend uses `api.post()` | ✅ Both `useCreditCheckCreate.ts` and `PreCheckUploadStep.tsx` use `@/lib/api` |
| DTO validation decorators | ✅ Full coverage with Thai messages on new `filesBase64` array field |
| Max files enforced (10) | ✅ `@ArrayMaxSize(10)` on DTO |

---

## Recommendation: ⚠️ REVIEW

The fix is functionally correct and well-tested. Two items to address before merge:

1. **Run TypeScript check** — `./tools/check-types.sh api` — to confirm `analyzeBankStatement` return type is sound (W-1).
2. **Consider reverting `<div role="button">` to `<button>`** — drag-and-drop works with native `<button>` in React; this restores the v4 a11y gain (W-2).

If TypeScript check passes and W-2 is addressed (or consciously accepted), this branch is safe to merge.
