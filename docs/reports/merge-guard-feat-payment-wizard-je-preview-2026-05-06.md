# Pre-Merge Guard Report

**Branch**: `feat/payment-wizard-je-preview`
**Author**: Akenarin Kongdach
**Review date**: 2026-05-06
**Recommendation**: 🟡 REVIEW

---

## File Changes Summary

| File | +/- |
|------|-----|
| `apps/api/package.json` | +4/-1 |
| `apps/api/src/cli/seed-coa.cli.ts` | +48 (new) |
| `apps/api/src/modules/payments/dto/payment.dto.ts` | +116/-0 |
| `apps/api/src/modules/payments/payments.controller.ts` | +62/-0 |
| `apps/api/src/modules/payments/payments.service.spec.ts` | +145 |
| `apps/api/src/modules/payments/payments.service.ts` | +182 |
| `apps/web/src/pages/ChartOfAccountsPage.tsx` | +572/-0 (refactor) |
| `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` | +1162 (new) |
| `apps/web/src/pages/PaymentsPage/index.tsx` | +53/-0 |
| `apps/web/src/pages/PaymentsPage/types.ts` | +2 |
| `docs/specs/2026-05-05-payment-wizard-je-preview-design.md` | +144 |

**Total**: 11 files changed, 2211 insertions(+), 279 deletions(-)

---

## Issues

### 🔴 Critical

_None._

Guards are properly inherited: `PaymentsController` has class-level `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)`. New `preview-journal` endpoint has `@Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT')`. No hardcoded secrets or SQL injection vectors found. `previewJournal` service method uses `Prisma.Decimal` with correct rounding modes throughout.

---

### ⚠️ Warning

#### [W-1] Raw `fetch()` in `RecordPaymentWizard.tsx` for S3 presigned URL

**Location**: `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` (step 3 slip upload)

```typescript
const { data: presign } = await api.post<{ uploadUrl: string }>(...);
const putRes = await fetch(presign.uploadUrl, {        // ← raw fetch
  method: 'PUT',
  body: file,
  headers: { 'Content-Type': file.type },
});
```

The `uploadUrl` is a presigned S3 PUT URL that must be called directly (not through the API proxy). This is architecturally correct behaviour. However, it technically triggers the "raw fetch() instead of api.get()/api.post()" Warning rule. Flagged for awareness — the reviewer should confirm the presigned URL is always HTTPS and validate `putRes.ok` before proceeding (verify existing code does this).

#### [W-2] `/payments/preview-journal` missing `@UseGuards(UserThrottlerGuard)`

**Location**: `apps/api/src/modules/payments/payments.controller.ts:91`

```typescript
@Post('preview-journal')
@Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT')
// ← no @UseGuards(UserThrottlerGuard)
previewJournal(@Body() dto: PreviewJournalDto) {
```

The `record` endpoint directly below has `@UseGuards(UserThrottlerGuard)`. The preview endpoint does DB reads on each call (installmentSchedule + contract + CoA lookup) and is called live as the user types. Without per-user throttling it could be hit in rapid succession. The global 200 req/sec `ThrottlerGuard` is still active, but adding `UserThrottlerGuard` here is consistent with the other mutation endpoints.

#### [W-3] Unsafe type cast `(dto as any).case`

**Location**: `apps/api/src/modules/payments/payments.controller.ts:120`

```typescript
if ((dto as any).case === 'RESCHEDULE') {
```

`RecordPaymentDto` does not declare a `case` field, but `PreviewJournalDto` does. The controller casts `dto as any` to check for RESCHEDULE and then throws a `BadRequestException`. This should be modelled as a properly-typed optional field on `RecordPaymentDto` (or handled via a discriminated union) rather than bypassing TypeScript.

---

### ℹ️ Info

#### [I-1] `RecordPaymentWizard.tsx` is 1162 lines

Large single-file component. The wizard steps (Step1InstallmentSelect, Step2AmountCase, Step3Method, Step4JournalPreview) are defined inline. Consider extracting each step into its own file under `PaymentsPage/components/wizard/` if the file continues to grow.

#### [I-2] RESCHEDULE case returns 400 (stub)

The `/payments/record` endpoint explicitly throws `BadRequestException` for `case === 'RESCHEDULE'`. This is documented as a TODO pending `RescheduleService.execute()` wiring. This is acceptable for the wizard preview feature, but the TODO should be tracked and the stub removed before the wizard is publicly used.

---

## Summary

This branch adds a 4-step `RecordPaymentWizard` UI with live journal-entry preview (`/payments/preview-journal`). The backend implementation uses correct `Prisma.Decimal` arithmetic with proper rounding modes. Auth and roles are correctly applied. The three Warnings are low-risk but should be addressed before the wizard ships to production users.

**Recommended action**: Address W-2 (add `UserThrottlerGuard`) and W-3 (remove `as any` cast) before merge. W-1 (presigned fetch) can be left with a short comment explaining S3 presigned URL semantics.
