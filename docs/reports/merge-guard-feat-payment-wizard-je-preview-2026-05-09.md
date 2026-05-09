# Pre-Merge Guard Report

**Branch:** `feat/payment-wizard-je-preview`
**Author:** Akenarin Kongdach `<iamnaii@MacBook-Pro-khxng-Akenarin.local>`
**Review Date:** 2026-05-09
**Reviewer:** Pre-Merge Guard Agent

---

## File Changes Summary

11 files changed, 2,211 insertions(+), 279 deletions(-)

**Key changes:**
- `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` — new file, 1,162 lines
  multi-step payment wizard with live JE preview
- `apps/api/src/modules/payments/payments.service.ts` — +182 lines: `previewJournal()` method
- `apps/api/src/modules/payments/payments.controller.ts` — +62 lines: `POST /payments/preview-journal`
- `apps/api/src/modules/payments/dto/payment.dto.ts` — +116 lines: `PreviewJournalDto`
- `apps/api/src/modules/payments/payments.service.spec.ts` — +145 tests
- `apps/web/src/pages/ChartOfAccountsPage.tsx` — rewrite for Phase A.4 schema (572 lines)
- `apps/api/src/cli/seed-coa.cli.ts` — new non-destructive CoA seed CLI
- `apps/web/src/pages/PaymentsPage/index.tsx` — +53 lines

---

## Issues by Severity

### CRITICAL

No critical issues found.

- `POST /payments/preview-journal` has `@Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT')` — all roles, correct since preview is read-only.
- Controller retains class-level `@UseGuards(JwtAuthGuard, RolesGuard)`. No guard regression.
- `payments.service.ts` `previewJournal()` uses `new Prisma.Decimal()` throughout — correct
  Decimal arithmetic with proper rounding modes (`ROUND_DOWN`, `ROUND_HALF_UP`). Matches
  `accounting.md` rounding spec exactly.
- No hardcoded secrets detected.
- No raw SQL (`$queryRaw`) introduced.
- No `deletedAt: null` omissions — all queries pass through existing service methods.

---

### WARNING

#### W-1: `@IsNumber()` / `number` type on money fields in `PreviewJournalDto`
**File:** `apps/api/src/modules/payments/dto/payment.dto.ts`

```typescript
@IsNumber()
@Min(0, { message: 'จำนวนเงินต้องไม่ติดลบ' })
amountReceived: number;

@IsOptional()
@IsNumber()
@Min(0)
lateFee?: number;
```

`amountReceived` and `lateFee` are money fields. Using `number` in the DTO means the
client sends a JSON float, which can lose precision before reaching the service layer.
The service immediately recovers via `new Prisma.Decimal(input.amountReceived.toString())`,
which is safe for typical THB amounts — but it relies on JS float→string being lossless,
which holds for two-decimal values in practice but is not guaranteed by spec.

For consistency with the codebase convention, the DTO should accept strings validated by
`@Matches(/^\d+(\.\d{1,2})?$/)`.

This is a warning (not critical) because: (a) the endpoint is non-destructive (preview
only), (b) no money is stored via this path, and (c) the wizard UI sends integer baht
amounts in practice.

#### W-2: Raw `fetch()` in `RecordPaymentWizard.tsx` for S3 presigned URL
**File:** `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx`

```typescript
// Step 2: PUT file to S3/GCS
const putRes = await fetch(presign.uploadUrl, {
  method: presign.method,
  body: file,
  headers: { 'Content-Type': file.type },
});
```

Using raw `fetch()` to PUT a binary to a pre-signed S3/GCS URL is a **legitimate
exception** — the target is the storage provider (different host), binary body, and the
BESTCHOICE `api.*` Axios client cannot be used here. The step-1 URL is obtained correctly
via `api.post('/shop/upload/signed-url', ...)`.

Recommendation: add a one-line comment to prevent future lint/reviewer questions:

```typescript
// Direct PUT to pre-signed storage URL — different host from API; api.* client not applicable
const putRes = await fetch(presign.uploadUrl, { ... });
```

---

### INFO

#### I-1: Excellent Decimal arithmetic in `previewJournal()`
`payments.service.ts` uses `new Prisma.Decimal(c.financedAmount.toString())`, `.times()`,
`.div()`, `.toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN)` throughout. Rounding modes
correctly match the accounting spec (`grossExclVat` ROUND_DOWN, `vatTotal` ROUND_HALF_UP).

#### I-2: Slip-upload mutation omits `invalidateQueries` — intentional
`useUploadSlip` hook returns a `publicUrl` string. It does not mutate app server state, so
`invalidateQueries` is not needed.

#### I-3: `seed-coa.cli.ts` is non-destructive
Skips existing accounts and is guarded against production misuse. Safe to ship.

#### I-4: 145 new tests cover `previewJournal()` paths
Good scenario coverage. No regressions visible in the diff.

#### I-5: `ChartOfAccountsPage.tsx` is 572 lines
Dense but self-contained. Consider extracting the account-row component if it grows
further. Not a blocker.

---

## Recommendation

**APPROVE** — ready to merge after W-2 comment is added (one line).

- No critical blockers.
- Financial arithmetic uses correct Prisma.Decimal throughout the service layer.
- W-1 (DTO money type convention) can be addressed as a follow-up chore; it has no
  correctness impact on the non-destructive preview endpoint.
- W-2 (raw fetch comment) is a one-line doc change — can be done in this PR.
- All guards, soft-delete filters, and cache invalidation patterns are correct.
