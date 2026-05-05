# Merge Guard Report — `feat/payment-wizard-je-preview` (PR #752)

**Date:** 2026-05-05  
**Author:** Akenarin Kongdach  
**PR:** [#752](https://github.com/iamnaii/BESTCHOICE/pull/752) — "feat(payments): wizard UI with live JE preview + late fee"  
**Branch:** `origin/feat/payment-wizard-je-preview`  
**Target:** `main`  
**Diff:** 10 files changed, +1428 / -273

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/src/cli/seed-coa.cli.ts` | NEW — 48-line CLI for seeding CoA |
| `apps/api/src/modules/payments/dto/payment.dto.ts` | Modified — new `PreviewJournalDto` |
| `apps/api/src/modules/payments/payments.controller.ts` | Modified — new `POST /payments/preview-journal` |
| `apps/api/src/modules/payments/payments.service.ts` | Modified — new `previewJournal()` method (+116 lines) |
| `apps/api/src/modules/payments/payments.service.spec.ts` | Extended — 5 new `previewJournal` tests (+145 lines) |
| `apps/web/src/pages/ChartOfAccountsPage.tsx` | Heavily refactored — 572 lines net |
| `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` | NEW — 711-line 4-step wizard |
| `apps/web/src/pages/PaymentsPage/index.tsx` | Modified — wires wizard, replaces modal trigger |
| `apps/web/src/pages/PaymentsPage/types.ts` | Modified — adds `contract.totalMonths`, `contract.monthlyPayment` |
| `apps/api/package.json` | Modified — adds seed-coa npm script |

---

## Critical Issues

**None.**

The `PaymentsController` has class-level `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` (confirmed in full file — line 19). The new `previewJournal` method has `@Roles(...)` and inherits the class guards. The service uses `Prisma.Decimal` correctly throughout. Frontend uses `api.get`/`api.post` from `@/lib/api`. `recordMutation` already has `onSuccess` with `queryClient.invalidateQueries(['pending-payments', 'daily-summary'])`.

---

## Warning Issues

### W-1 — `installmentSchedule.findUnique` missing `deletedAt: null`

**File:** `apps/api/src/modules/payments/payments.service.ts`

```typescript
const inst = await this.prisma.installmentSchedule.findUnique({
  where: { contractId_installmentNo: { contractId: input.contractId, installmentNo: input.installmentNo } },
  include: { contract: true },
});
```

`InstallmentSchedule` has a `deletedAt` field. Querying without `deletedAt: null` allows preview of soft-deleted installment records. `Contract` included via relation also lacks the filter.

**Fix:** Switch to `findFirst` to allow adding the extra condition:

```typescript
const inst = await this.prisma.installmentSchedule.findFirst({
  where: {
    contractId: input.contractId,
    installmentNo: input.installmentNo,
    deletedAt: null,
    contract: { deletedAt: null },
  },
  include: { contract: true },
});
```

---

### W-2 — `chartOfAccount.findMany` missing `deletedAt: null`

**File:** `apps/api/src/modules/payments/payments.service.ts`

```typescript
const coaRows = await this.prisma.chartOfAccount.findMany({
  where: { code: { in: codes } },
  select: { code: true, name: true },
});
```

Soft-deleted (decommissioned) CoA entries would appear in the JE preview name lookup and be shown to users as if active.

**Fix:**

```typescript
where: { code: { in: codes }, deletedAt: null },
```

---

### W-3 — `previewJournal` missing `@UseGuards(UserThrottlerGuard)` — per-user rate limit absent

**File:** `apps/api/src/modules/payments/payments.controller.ts`

```typescript
@Post('preview-journal')
@Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT')
previewJournal(@Body() dto: PreviewJournalDto) { ... }
```

The global `ThrottlerGuard` (200 req/min app-wide) applies, but `POST /payments/record` has `@UseGuards(UserThrottlerGuard)` for per-user limiting. The wizard debounces at 300ms, but an authenticated user can still call this endpoint continuously. Each call queries `installmentSchedule` + `chartOfAccount`.

**Fix:** Add `@UseGuards(UserThrottlerGuard)` or `@Throttle({ default: { ttl: 60000, limit: 120 } })`.

---

### W-4 — `parseFloat()` on financial amounts in wizard

**File:** `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx`

```typescript
amountReceived: parseFloat(amountReceived) || 0,  // submit payload
amount: parseFloat(amountReceived) || 0,           // mutation payload
if (step === 2) return parseFloat(amountReceived) > 0;  // step guard
```

The component already imports and uses `Decimal` elsewhere (e.g., `lateFeeDecimal`). `parseFloat` introduces IEEE-754 float imprecision inconsistently.

**Fix:** Use `new Decimal(amountReceived).toNumber()` (or `.toFixed(2)` for the payload) for consistency.

---

### W-5 — `previewJournal` service missing null guard for nullable contract fields

**File:** `apps/api/src/modules/payments/payments.service.ts`

```typescript
const financed = new Prisma.Decimal(c.financedAmount.toString());
const interest = new Prisma.Decimal(c.interestTotal.toString());
```

If `financedAmount` or `interestTotal` is `null` on an older migrated contract, `null.toString()` throws `TypeError` with a raw Node stack trace (unhandled 500, not a NestJS exception).

**Fix:** Add null guards and wrap in `BadRequestException`:

```typescript
if (!c.financedAmount || !c.interestTotal) {
  throw new BadRequestException('ข้อมูลสัญญาไม่ครบ ไม่สามารถคำนวณ JE preview ได้');
}
```

---

### W-6 — `ChartOfAccountsPage` mutations missing `onError` toast

**File:** `apps/web/src/pages/ChartOfAccountsPage.tsx`

`createMutation` and `updateMutation` both have `onSuccess` handlers but no `onError`. A 400/409/500 from the API silently fails with no user feedback.

**Fix:** Add to both mutations:

```typescript
onError: (err: unknown) => {
  const msg = (err as any)?.response?.data?.message ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่';
  toast.error(msg);
},
```

---

### W-7 — `toleranceApproverId` in `PreviewJournalDto` is unused and unvalidated

**File:** `apps/api/src/modules/payments/dto/payment.dto.ts`

```typescript
@IsOptional()
@IsString()
toleranceApproverId?: string;
```

The controller does not pass this field to `previewJournal()`. It belongs on `RecordPaymentDto` (where it is already present), not on the preview DTO.

**Fix:** Remove `toleranceApproverId` from `PreviewJournalDto`.

---

## Info Issues

| # | File | Note |
|---|------|------|
| I-1 | `RecordPaymentWizard.tsx` | 711 lines — sub-components (`CaseStep`, `ChannelStep`, `JePreviewPanel`, etc.) could be split into a `wizard/` subdirectory |
| I-2 | `ChartOfAccountsPage.tsx` | 572 lines — form overlay (`ChartOfAccountForm`) extractable as separate file |
| I-3 | `payment.dto.ts` + `RecordPaymentWizard.tsx` | `PaymentCase` union type duplicated in DTO and frontend — belongs in `packages/shared/` |
| I-4 | `ChartOfAccountsPage.tsx` | `codePrefix()` function: both branches of the `if` return `code.slice(0, 2)` — the condition is dead code |
| I-5 | `seed-coa.cli.ts` | `$queryRaw` uses a fixed SQL string with no interpolation — safe, no SQL injection risk |
| I-6 | `payments.service.ts` | 2B-only path shows UNBALANCED JE for OVERPAY/UNDERPAY cases (tolerance lines 52-1104/53-1503 not generated in preview) — wizard correctly blocks submit, but user sees no explanation; worth a follow-up UX ticket |

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Warning | 7 |
| Info | 6 |

**Recommendation: `REVIEW`**

The wizard architecture is solid — proper guards, correct `Prisma.Decimal` arithmetic, React Query + `api.post()` patterns, 45 passing service tests. **Two fixes are required before merge:**

- **W-1**: Switch `findUnique` → `findFirst` + add `deletedAt: null` (prevents soft-deleted data leaking into preview)
- **W-2**: Add `deletedAt: null` to `chartOfAccount.findMany` (one-line fix)

W-3, W-5, and W-6 are strongly recommended in the same PR. W-4, W-7, and Info items can be fast-follow.
