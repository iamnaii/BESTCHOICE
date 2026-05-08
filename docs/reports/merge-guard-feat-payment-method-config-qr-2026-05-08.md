# Merge Guard Report — feat/payment-method-config-qr

**Date**: 2026-05-08  
**Branch**: `feat/payment-method-config-qr`  
**Author**: Akenarin Kongdach (akenarin.ak@gmail.com)  
**Merge base**: `9849213f` (PR #771)  
**Commits ahead of main**: 26 (superset of `feat/sticker-print-redesign` + 3 QR payment commits)

## File Changes Summary

| Area | Files | Description |
|------|-------|-------------|
| New module: `payment-method-config` | controller, service, 2 DTOs, module | CRUD for PaymentMethod↔CoA bindings |
| `payments.controller.ts` | +77 lines | 3 new endpoints for partial-payment QR |
| `payments.module.ts` | +11 | Module wiring for new deps |
| `paysolutions.service.ts` | +447 lines | `createEarlyPayoffQR` + `createPartialPaymentQR` |
| `partial-payment-expire.cron.ts` | new | Hourly ACTIVE→EXPIRED sweep |
| New LINE Flex messages | `early-payoff-qr.flex.ts`, `partial-payment-qr.flex.ts` | Push to customer LINE |
| Frontend: `PaymentMethodSettingsPage.tsx` | new, +397 | /settings/payment-methods OWNER UI |
| Frontend: `RecordPaymentWizard.tsx` | +256 | 3-method wizard + "ส่ง QR" flow |
| Frontend: `QrSentBadge.tsx` | new, +170 | Badge in payment table |
| Schema: `PartialPaymentLink`, `PaymentMethodConfig` | +2 new models | |
| Schema: `PricingTemplate` rate fields | +4 fields | |
| All `feat/sticker-print-redesign` changes | (inherited) | see sticker report |

**Total TS/TSX**: 53 files, ~3929 insertions, ~2203 deletions

---

## Issues Found

### Critical
_None_

All new controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` at class level. All methods have `@Roles(...)`. No `$queryRaw`, no hardcoded secrets, no unguarded public endpoints outside the known-safe list.

---

### Warning

**W1 — Controller directly uses `this.prisma` (violates backend.md rule)**

`apps/api/src/modules/payments/payments.controller.ts` — two new methods bypass the service layer:

```typescript
@Get(':id/partial-qr/active')
@Roles(...)
async getActivePartialQr(@Param('id', ParseUUIDPipe) id: string) {
  return this.prisma.partialPaymentLink.findFirst({ ... });   // ← direct Prisma in controller
}

@Delete(':id/partial-qr')
@Roles(...)
async cancelPartialQr(@Param('id', ParseUUIDPipe) id: string) {
  const link = await this.prisma.partialPaymentLink.findFirst({ ... });  // ← direct Prisma
  return this.prisma.partialPaymentLink.update({ ... });                  // ← direct Prisma
}
```

Rule: **"ห้ามเรียก PrismaService จาก controller โดยตรง — ต้องผ่าน service เสมอ"** (`rules/backend.md`)

**Fix**: Move both queries into `PaymentsService` as `getActivePartialQr(paymentId)` and `cancelPartialQr(paymentId)`, inject `PrismaService` there.

---

**W2 — Inline DTO class defined inside controller file**

`apps/api/src/modules/payments/payments.controller.ts`:

```typescript
class CreatePartialQrDto {
  @IsNumber()
  @Min(1, { message: 'ยอดต้องมากกว่า 0 บาท' })
  amount!: number;
}
```

DTOs must live in `dto/` files per module convention — not inline in controllers. This breaks Swagger type reflection and discoverability.

**Fix**: Move to `apps/api/src/modules/payments/dto/create-partial-qr.dto.ts`.

---

**W3 — `Number()` on Decimal money fields in `paysolutions.service.ts`**

v4 hardening eliminated all `Number()` on `Decimal` sums across 12 services. New additions re-introduce the pattern:

```typescript
// L328 — amount sent to PaySolutions LINE Flex builder
fullAmount: Number(payment.amountDue),

// L463 — amount passed to PaymentsService.recordPayment (financial recording path)
Number(link.amount),

// L483 — Sentry extra context (non-financial, but same pattern)
amount: Number(link.amount),
```

Line 463 is the most concerning: `Number(link.amount)` is the value that flows into `PaymentsService.recordPayment` as the actual amount recorded. For amounts < 10^13 with 2dp this won't lose precision, but the pattern directly contradicts v4 findings.

**Fix**:
- L328: `payment.amountDue.toNumber()` (for Flex display — intentional cast, document it)
- L463: Pass `link.amount` as `Prisma.Decimal` and update `recordPayment` signature if needed, or use `link.amount.toNumber()` with a comment
- L483: `Number(link.amount)` OK for Sentry context but add a comment

---

**W4 — `PartialPaymentLink` model missing `deletedAt` without exemption comment**

`apps/api/prisma/schema.prisma`:

```prisma
model PartialPaymentLink {
  ...
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  // ← no deletedAt
}
```

Rule: "โดย default ทุก model ต้องมี 3 fields นี้: `createdAt`, `updatedAt`, `deletedAt`" (`rules/database.md`).

Exemptions require a `///` doc comment explaining why (e.g., "Append-only event log"). The model has lifecycle state (`status: ACTIVE/PAID/EXPIRED/CANCELLED`) and `cancelledAt`, so `deletedAt` may not be appropriate — but the exemption must be documented.

**Fix**: Add `/// Payment QR lifecycle uses explicit status enum (ACTIVE/PAID/EXPIRED/CANCELLED) + cancelledAt for audit trail — deletedAt intentionally omitted` above the model, or add `deletedAt DateTime? @map("deleted_at")` if the team prefers consistency.

---

**W5 — Sticker batch endpoint accepts unvalidated string IDs (inherited from sticker branch)**

`apps/api/src/modules/stickers/stickers.controller.ts`:

```typescript
getStickerDataBatch(@Query('ids') ids?: string) {
  const productIds = ids.split(',').map((s) => s.trim()).filter(Boolean);
  // ← no UUID format validation — invalid IDs → PostgreSQL cast error → 500
}
```

**Fix**: Filter to valid UUIDs before passing to service, or return 400 for invalid format input.

---

### Info

**I1 — Hardcoded hex colors in LINE OA Flex messages**

Expected. LINE Flex messages are JSON payloads; CSS variables are inapplicable. No action needed.

**I2 — `PrismaService` injected into `PaymentsController`**

Only needed temporarily for the two direct-Prisma methods (W1). Once W1 is fixed and those move to the service, `PrismaService` should be removed from the controller constructor.

**I3 — Large new file: `paysolutions.service.ts`**

The diff adds ~450 lines to an already-large service. The two new methods (`createEarlyPayoffQR`, `createPartialPaymentQR`) follow existing patterns (fetch + Sentry + DB in `$transaction`). No architectural concern at this size, but worth noting for future splitting.

---

## Recommendation: 🔴 BLOCK

**4 must-fix warnings before merge** (W1–W4). Two are direct rule regressions from v3/v4 hardening:

| # | Issue | Effort |
|---|-------|--------|
| W1 | Direct `this.prisma` in controller — 2 methods | ~15 min |
| W2 | Inline DTO in controller | ~5 min |
| W3 | `Number()` on Decimal in paysolutions service — 3 call sites | ~15 min |
| W4 | Missing `deletedAt` exemption comment on `PartialPaymentLink` | ~2 min |
| W5 | UUID validation on sticker batch endpoint | ~10 min |

No critical security issues (no missing guards, no SQL injection, no hardcoded secrets). All financial guard rails (JwtAuthGuard, RolesGuard, BranchGuard, ThrottlerGuard) are correctly applied.
