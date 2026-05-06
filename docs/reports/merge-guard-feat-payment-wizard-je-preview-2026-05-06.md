# Merge Guard Report — feat/payment-wizard-je-preview

**Date**: 2026-05-06  
**Branch**: `feat/payment-wizard-je-preview`  
**Author**: Akenarin Kongdach `<iamnaii@MacBook-Pro-khxng-Akenarin.local>`  
**Recommendation**: ⚠️ **REVIEW** — address Warning items before merge

---

## File Changes Summary

| File | +Lines | -Lines | Type |
|------|--------|--------|------|
| `apps/api/src/modules/payments/payments.controller.ts` | +50 | -8 | Feature (new endpoint) |
| `apps/api/src/modules/payments/payments.service.ts` | +186 | -2 | Feature (previewJournal) |
| `apps/api/src/modules/payments/dto/payment.dto.ts` | +78 | -1 | Feature (new DTOs) |
| `apps/api/src/modules/payments/payments.service.spec.ts` | +149 | 0 | Tests |
| `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` | +1162 | -279 | Feature (4-step wizard) |
| `apps/web/src/pages/PaymentsPage/index.tsx` | +27 | -26 | Refactor |
| `apps/web/src/pages/PaymentsPage/types.ts` | +2 | 0 | Types |
| `docs/…/2026-05-05-payment-wizard-je-preview-design.md` | +144 | 0 | Design doc |

**Total**: 11 files changed, 2,211 insertions(+), 279 deletions(−)

---

## Issues Found

### 🔴 Critical — None

No critical security issues found:
- ✅ Controller class has `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at class level
- ✅ New `previewJournal` endpoint has `@Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT')` ✓
- ✅ All financial calculations in service use `new Prisma.Decimal(...)` — no raw `Number()` on monetary values
- ✅ No hardcoded secrets or API keys
- ✅ `fetch(presign.uploadUrl, {...})` — intentional S3 pre-signed URL direct upload (correct pattern; must bypass `api.post()` because auth header would invalidate the S3 signature)
- ✅ No unparameterized `$queryRaw`

---

### 🟡 Warning — Should Fix

**W-1: `installmentSchedule.findUnique` missing `deletedAt: null` filter**

`apps/api/src/modules/payments/payments.service.ts` — `previewJournal()`:

```typescript
const inst = await this.prisma.installmentSchedule.findUnique({
  where: { contractId_installmentNo: { contractId: input.contractId, installmentNo: input.installmentNo } },
  include: { contract: true },
});
```

Database rule requires every query to include `where: { deletedAt: null }`. `findUnique` with a compound key cannot easily combine with `deletedAt: null` — refactor to `findFirst` with both conditions:

```typescript
const inst = await this.prisma.installmentSchedule.findFirst({
  where: {
    contractId: input.contractId,
    installmentNo: input.installmentNo,
    deletedAt: null,
  },
  include: { contract: true },
});
```

**W-2: `(dto as any).case` type bypass in controller**

`apps/api/src/modules/payments/payments.controller.ts` line ~246:

```typescript
if ((dto as any).case === 'RESCHEDULE') {
```

`RecordPaymentDto` does not declare a `case` field — the check bypasses TypeScript's type system via `as any`. The stub throw is intentional (RESCHEDULE not yet wired), but the `case` field should either be added to `RecordPaymentDto` with `@IsOptional() @IsIn([...])` decorators, or the stub guard should be removed and the feature tracked separately. Using `as any` on the request DTO in production code is a code quality issue.

---

### 🔵 Info

**I-1: `RecordPaymentWizard.tsx` is 1,162 lines**

`apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` — 1,162 lines is large. Consider extracting the step sub-components (Step1ContractLookup, Step2AmountEntry, Step3PaymentMethod, Step4JePreview) into separate files inside a `RecordPaymentWizard/` directory. Not required before merge but will help maintainability.

**I-2: `.toNumber()` used for UI display and DTO serialization**

Frontend `RecordPaymentWizard.tsx` uses `.toNumber()` on Decimal values in several places. These are all either:
- Display-only `.toLocaleString()` formatting (acceptable)
- Serializing to `number` for `PreviewJournalDto.amountReceived` (which is `@IsNumber()`) — the service immediately re-wraps in `new Prisma.Decimal(input.amountReceived.toString())`, so financial precision is preserved on the backend

No action required, but the pattern is worth documenting in the component.

---

## Verification Checklist

- [ ] W-1: Refactor `findUnique` → `findFirst` with `deletedAt: null`
- [ ] W-2: Add `case?: PaymentCase` to `RecordPaymentDto` with `@IsOptional() @IsIn([...])`, or remove the stub guard entirely
- [ ] Confirm `previewJournal` tests pass: `npm run test -- payments.service.spec.ts`
