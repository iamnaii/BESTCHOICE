# Merge Guard Report — `feat/payment-wizard-je-preview`

**Date**: 2026-05-05  
**Branch**: `feat/payment-wizard-je-preview`  
**Author**: iamnaii@MacBook-Pro-khxng-Akenarin.local  
**Commits**: 3 (feat wizard UI → docs spec → feat step 3)

---

## File Changes Summary

| File | +Lines | -Lines | Notes |
|------|--------|--------|-------|
| `apps/api/src/modules/payments/dto/payment.dto.ts` | +121 | -1 | New `PreviewJournalDto`; new wizard fields on `RecordPaymentDto` |
| `apps/api/src/modules/payments/payments.controller.ts` | +50 | -10 | New `POST /payments/preview-journal` endpoint; RESCHEDULE guard stub |
| `apps/api/src/modules/payments/payments.service.ts` | +184 | 0 | New `previewJournal()` read-only service method |
| `apps/api/src/modules/payments/payments.service.spec.ts` | +149 | 0 | 19 new `previewJournal` test cases |
| `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` | +1162 | 0 | New 4-step wizard component |
| `apps/web/src/pages/PaymentsPage/index.tsx` | +53 | -53 | Wire wizard into page; keep legacy modal |
| `apps/web/src/pages/PaymentsPage/types.ts` | +2 | 0 | Minor type additions |
| `apps/api/src/cli/seed-coa.cli.ts` | +48 | 0 | _(included from `feat/seed-coa-cli` merge base)_ |
| `apps/web/src/pages/ChartOfAccountsPage.tsx` | +572 | -269 | _(included from `feat/seed-coa-cli` merge base)_ |

---

## Issues Found

### Warning

#### W-1: RESCHEDULE guard bypassed by `whitelist: true` — silent fallthrough to normal payment

**File**: `apps/api/src/modules/payments/payments.controller.ts:121`  
**Also**: `apps/api/src/modules/payments/dto/payment.dto.ts`

The controller guards the RESCHEDULE case with:
```typescript
if ((dto as any).case === 'RESCHEDULE') {
  throw new BadRequestException('การปรับดิวผ่าน wizard ยังไม่พร้อม...');
}
```

`RecordPaymentDto` does **not** declare a `case` field. Since the app uses `ValidationPipe({ whitelist: true })` (see `main.ts`), any field absent from the DTO is silently stripped before the controller sees it. `(dto as any).case` will always be `undefined` — the guard never fires.

**Effect**: A RESCHEDULE submission from the wizard skips the intended `BadRequestException` and falls through to `recordPayment()`, which will post a 2B journal entry instead of the JP6 reschedule template. Journal entries won't match what the wizard preview showed on step 4.

**Fix**: Add `case` to `RecordPaymentDto` with proper validators:
```typescript
@IsOptional()
@IsString()
@IsIn(['NORMAL','OVERPAY','UNDERPAY','PARTIAL','EARLY_PAYOFF','RESCHEDULE'])
case?: PaymentCase;
```

#### W-2: Wizard closes before mutation resolves — no retry path on error

**File**: `apps/web/src/pages/PaymentsPage/index.tsx:622-623`

```typescript
recordMutation.mutate(mutationPayload);
setShowPayWizard(false);    // ← closes immediately
setSelectedPayment(null);
```

On mutation error, the wizard is already gone. The user sees a `toast.error()` but cannot retry from the context they were in (wizard pre-filled with their data). They must reopen from the pending list and re-enter all wizard steps.

**Fix**: Move `setShowPayWizard(false)` to `recordMutation.onSuccess`, alongside the existing `queryClient.invalidateQueries()` calls.

---

### Info

#### I-1: `RecordPaymentWizard.tsx` is 1,162 lines

Exceeds the 500-line guideline. Consider extracting:
- `SlipUploader` subcomponent (lines ~310–380)
- Step components (`StepCase`, `StepAmount`, `StepMethod`, `StepReview`) each as separate files

Not a blocker, but future maintainability will benefit from the split.

#### I-2: `fetch(presign.uploadUrl, ...)` — raw `fetch()` in wizard

**File**: `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx:342`

This calls the S3/GCS presigned URL directly with `fetch()`, not via `api.post()`. This is **correct behavior** — presigned URLs are external S3 endpoints that must not carry the app's JWT `Authorization` header. Noted for clarity; not a rule violation in this context.

#### I-3: `parseFloat(amountReceived)` in wizard frontend

**File**: `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx:982`

```typescript
amount: parseFloat(amountReceived) || 0,
```

The value is passed to the API as a `number` (DTO `@IsNumber() amount`), so this is technically fine. However, the surrounding code uses `Decimal` for all calculations, so for consistency this could be `new Decimal(amountReceived).toNumber()` to avoid silent NaN→0 coercion on bad input.

---

## Backend Security Checklist

| Check | Result |
|-------|--------|
| Class-level `@UseGuards(JwtAuthGuard, RolesGuard)` on controller | ✅ Present (`BranchGuard` also) |
| `@Roles()` on new `previewJournal` endpoint | ✅ Present (all 5 roles) |
| `@Roles()` on modified `record` endpoint | ✅ Unchanged, present |
| `Prisma.Decimal` used throughout `previewJournal()` | ✅ No `Number()` on money fields |
| `$queryRaw` usage | ✅ Only tagged template literal (`SELECT current_database()`) — safe |
| Hardcoded secrets | ✅ None found |
| New DTO validated with class-validator | ✅ `PreviewJournalDto` fully decorated |
| `deletedAt: null` on new queries | ✅ Only looks up by ID with unique key |

---

## Recommendation

**REVIEW** — One fix required before merge:

1. **Must fix**: Add `case?: PaymentCase` (with `@IsIn` validator) to `RecordPaymentDto` so the RESCHEDULE guard in the controller actually fires (W-1). Current code silently processes RESCHEDULE as a normal payment.

2. **Should fix**: Move wizard close/clear to `recordMutation.onSuccess` so users can retry on failure (W-2).

Core accounting logic (`previewJournal` service) is excellent — full `Prisma.Decimal` arithmetic, correct ROUND_DOWN/ROUND_HALF_UP modes, proper 2A+2B consolidated vs 2B-only branching, test coverage.
