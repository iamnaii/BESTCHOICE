# Merge Guard Report — feat/payment-wizard-je-preview

**Date**: 2026-05-15  
**Branch**: `feat/payment-wizard-je-preview`  
**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-05  
**Unique commits vs main**: 9 (top 5 are the wizard; 4 older commits pre-date main's current tip)  

---

## File Changes Summary

New 4-step `RecordPaymentWizard` with live JE preview + `POST /payments/preview-journal` endpoint.

| File | Change |
|------|--------|
| `apps/api/src/modules/payments/payments.controller.ts` | `@Post('preview-journal')` endpoint added |
| `apps/api/src/modules/payments/payments.service.ts` | `previewJournal()` — non-destructive JE computation |
| `apps/api/src/modules/payments/dto/payment.dto.ts` | `PreviewJournalDto` with full class-validator decorators |
| `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` | 1162-line 4-step wizard component |
| `apps/web/src/pages/PaymentsPage/index.tsx` | Wire wizard into payments page |
| `apps/api/src/modules/payments/__tests__/preview-journal.spec.ts` | 5 unit test cases |
| Spec doc | Retroactive design doc |

---

## Issues Found

### Critical (block merge)

None found.

---

### Warning (should fix before merge)

**W1 — Raw `fetch()` for S3 presigned URL upload (intentional but undocumented)**  
File: `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx:348`  

```ts
// Step 2: PUT file to S3/GCS
const putRes = await fetch(presign.uploadUrl, {
  method: presign.method,
  body: file,
  headers: { 'Content-Type': file.type },
});
```

This is a direct PUT to a presigned S3/GCS URL — it must bypass the API proxy because the upload goes directly to object storage, not through the backend. This is the correct pattern. However, it's the only `fetch()` call in the frontend codebase, which will trigger future guard reviews unnecessarily.

**Recommended fix**: Add a one-line comment: `// Direct S3/GCS PUT — presigned URL requires bypassing /api proxy` to make the intent explicit and suppress future false-positive reviews.

---

**W2 — `RecordPaymentWizard.tsx` is 1162 lines**  
The component handles 4 wizard steps, JE preview, slip upload, and reschedule preview in a single file. At this size it's hard to navigate and test. This isn't a blocker but should be tracked as tech debt.

**Recommended fix (post-merge)**: Extract each step (`AmountStep`, `CashAccountStep`, `MethodStep`, `ConfirmStep`) into separate files under `components/wizard/`.

---

### Info

**I1 — `toleranceApproverId` in `PreviewJournalDto` accepted but unused by `previewJournal()`**  
The DTO includes `toleranceApproverId?: string` which is only meaningful for the actual `recordPayment` call. The preview endpoint receives it but ignores it. This is harmless (the field is `@IsOptional()`), but could confuse future developers reading the DTO.

**I2 — `ChartOfAccountsPage` rewrite included (commit `28ac5137`)**  
This older commit rewrites the CoA page for Phase A.4 (105 accounts). Likely already reviewed in a prior cycle but appears in this branch's unique-commit list due to squash history divergence.

---

## Positive Signals

- `POST /payments/preview-journal` is protected by class-level `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` on `PaymentsController` — no guard gap.
- `@Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT')` on the new endpoint — appropriate role coverage.
- `PreviewJournalDto` has complete class-validator coverage: `@IsString`, `@IsNumber`, `@Min(0.01)`, `@Matches(CASH_CODE_REGEX)` on `depositAccountCode`, `@IsIn([...])` on `case`.
- `previewJournal()` is non-destructive — reads DB state, computes JE lines in memory, returns without persisting. Safe to call multiple times.
- Frontend uses `api.post()` from `@/lib/api` for the preview call (not raw `fetch()`).
- Parent page `recordMutation.onSuccess` properly calls `queryClient.invalidateQueries({ queryKey: ['pending-payments'] })` and `['daily-summary']` — wizard submission triggers cache refresh.
- Decimal arithmetic used throughout the wizard (`decimal.js` + `Prisma.Decimal`) — no precision loss in amount calculations.
- No hardcoded secrets, no unparameterized `$queryRaw`.
- Slip upload validates MIME type and 10MB size limit before upload.

---

## Recommendation

**REVIEW** — The branch is clean from a security standpoint. W1 (one-line comment on `fetch()`) is a minor polish item. W2 (file size) is tracked tech debt for post-merge. If the team is comfortable with the wizard file size, this can be **APPROVED** immediately. Otherwise add the `fetch()` comment and merge.
