# Merge Guard Report — fix/installment-schedules-on-activate

**Date**: 2026-05-05  
**Branch**: `fix/installment-schedules-on-activate`  
**Author**: Akenarin Kongdach (iamnaii@gmail.com)  
**Reviewed at**: 2026-05-05T11:16 UTC  
**Recommendation**: ⚠️ REVIEW — fix 2 Warnings before merge

---

## File Changes Summary

| File | Changes |
|------|---------|
| `apps/api/src/cli/seed-coa.cli.ts` | +48 (new file) |
| `apps/api/src/modules/contracts/contract-workflow.service.ts` | +64 |
| `apps/api/src/modules/payments/dto/payment.dto.ts` | +116 / -1 |
| `apps/api/src/modules/payments/payments.controller.ts` | +62 / -18 |
| `apps/api/src/modules/payments/payments.service.spec.ts` | +145 |
| `apps/api/src/modules/payments/payments.service.ts` | +182 |
| `apps/web/src/pages/ChartOfAccountsPage.tsx` | +286 / -286 (refactor) |
| `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` | +1162 (new file) |
| `apps/web/src/pages/PaymentsPage/index.tsx` | +53 / -2 |
| `apps/web/src/pages/PaymentsPage/types.ts` | +2 |
| `docs/.../2026-05-05-payment-wizard-je-preview-design.md` | +144 (new) |

**Total**: 12 files, +2275 / -279 lines

---

## Issues

### Warning (should fix before merge)

#### W-1: `(dto as any).case` bypasses TypeScript type safety
**File**: `apps/api/src/modules/payments/payments.controller.ts:120`

```ts
if ((dto as any).case === 'RESCHEDULE') {
```

The `case` field is defined on `PreviewJournalDto` but NOT on `RecordPaymentDto`. The controller accesses it via `as any`, bypassing type safety. This guard is intended to prevent the RESCHEDULE case from executing via `/payments/record`, but its reliability depends on an untyped field.

**Fix**: Add the field to `RecordPaymentDto`:
```ts
@IsOptional()
@IsString()
@IsIn(['NORMAL', 'OVERPAY', 'UNDERPAY', 'PARTIAL', 'EARLY_PAYOFF', 'RESCHEDULE'])
case?: PaymentCase;
```

#### W-2: `slipUrl` missing HTTPS URL validation in `RecordPaymentDto`
**File**: `apps/api/src/modules/payments/dto/payment.dto.ts`

The existing `evidenceUrl` field has `@Matches(/^https:\/\/.+/)` to enforce HTTPS. The new `slipUrl` field only has `@MaxLength(2048)` — no URL format enforcement. An attacker (or bug) could submit `http://` or relative paths.

**Fix**: Add `@Matches(/^https:\/\/.+/, { message: 'slipUrl ต้องเป็น HTTPS URL' })` to `slipUrl` in `RecordPaymentDto`.

---

### Info (acceptable, note for future)

#### I-1: Raw `fetch()` for presigned S3 upload
**File**: `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx`

```ts
const putRes = await fetch(presign.uploadUrl, {
  method: presign.method,
  body: file,
  headers: { 'Content-Type': file.type },
});
```

This is a direct PUT to a presigned S3/GCS URL — the only valid pattern for this operation (adding JWT `Authorization` headers via `api.post()` would break the presigned-URL signature). However, it technically violates the frontend rule "no raw `fetch()`". Add a comment to document the intent:

```ts
// Direct PUT to presigned S3 URL — cannot use api.post() as JWT headers break the signature
```

#### I-2: `generateInstallmentSchedules` reads soft-deleted contracts
**File**: `apps/api/src/modules/contracts/contract-workflow.service.ts`

```ts
const c = await this.prisma.contract.findUniqueOrThrow({
  where: { id: contract.id },  // no deletedAt: null
});
```

Called non-blockingly after activation (so in practice the contract cannot be deleted yet), but inconsistent with the database convention. Low risk. Could add `deletedAt: null` to be safe, though `findUniqueOrThrow` on a primary key will always find the row regardless.

#### I-3: `RecordPaymentWizard.tsx` is >1000 lines
New component adds 1162 lines. Even after the `fix/payment-single-screen` collapse this will be ~600 lines. Consider splitting `useUploadSlip` hook and JE preview logic into separate files in a follow-up.

#### I-4: RESCHEDULE case has a controller-level TODO stub
**File**: `apps/api/src/modules/payments/payments.controller.ts:120–125`

The RESCHEDULE case throws `BadRequestException` with a TODO comment. Preview works fine; only execution is blocked. This should be tracked as a follow-up issue so it doesn't get forgotten.

#### I-5: Design doc checked in under wrong directory
`docs/2026-05-05-payment-wizard-je-preview-design.md` is at the repo root docs level. Project convention places specs in `docs/specs/`. Not a blocker, but misfile for future searching.

---

## Positive Highlights

- **Decimal arithmetic is correct** throughout `previewJournal` and `generateInstallmentSchedules` — uses `Prisma.Decimal` with explicit rounding modes matching the CPA spec (`ROUND_DOWN` for principal, `ROUND_HALF_UP` for interest/VAT).
- **Guards are correct** — `preview-journal` endpoint has `@Roles()` set; class-level `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` applies to all methods.
- **`42-1103` (ค่าปรับชำระล่าช้า) confirmed in CoA CSV** — account reference in `previewJournal` is valid.
- **`queryClient.invalidateQueries`** is called after `recordMutation` in the parent `PaymentsPage` — cache invalidation is correct.
- **Idempotency guard on schedule generation** — `generateInstallmentSchedules` skips if rows already exist. Correct.
- **Sentry capture** on schedule-generation failure. Good observability.
- **145 new API spec tests** for `previewJournal` (5 cases including consolidated 2A+2B and accrued-only 2B).
