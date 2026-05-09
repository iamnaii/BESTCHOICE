# Merge Guard Report — feat/payment-method-config-qr

**Date**: 2026-05-09  
**Branch**: `feat/payment-method-config-qr`  
**Author**: Akenarin Kongdach  
**Commits**: 10  
**Recommendation**: ⚠️ REVIEW

---

## File Changes Summary

| Area | Files | Net lines |
|------|-------|----------|
| API: new `payment-method-config` module | 4 | +253 |
| API: `paysolutions.service.ts` (partial QR) | 1 | +447 |
| API: `payments.controller.ts` (3 new endpoints) | 1 | +77 |
| API: LINE OA flex messages (Style C → D rewrite) | 17 | +1,854 / −2,189 |
| API: `paysolutions.module.ts` + cron | 2 | +46 |
| API: Prisma schema + 2 migrations | 3 | +196 |
| API: pricing-template DTO (4 new fields) | 1 | +40 |
| Web: `PaymentMethodConfigPage.tsx` (new) | 1 | +~300 |
| Web: `RecordPaymentWizard` + form updates | ~4 | +~400 |
| Tests | 5 | +18 |
| **Total** | **58** | **+5,829 / −2,212** |

---

## Issues

### ⚠️ Warning — `Number()` on Decimal money fields in `paysolutions.service.ts`

**Files**: `apps/api/src/modules/paysolutions/paysolutions.service.ts`

Two separate patterns found:

**W-1** — `Number(payment.amountDue)` passed as `fullAmount` to `buildPartialPaymentQRFlex()`.
`amountDue` is `Decimal @db.Decimal(12, 2)`. The value is used for display text in a LINE Flex message (`fullAmount` in `PartialPaymentQRFlexData`), not for financial recording. JS `Number` can represent THB amounts up to ~9 trillion exactly at 2dp, so no practical precision loss here — but it violates the project convention (`Prisma.Decimal` all the way through, use `.toNumber()` only at display boundary and label it explicitly).

**Suggested fix**:
```ts
// Before
fullAmount: Number(payment.amountDue),

// After
fullAmount: payment.amountDue.toNumber(), // display boundary — safe for THB Decimal(12,2)
```

**W-2** — `Number(link.amount)` passed to `this.paymentsService.recordPayment(...)`.
`link.amount` is `Decimal @db.Decimal(12, 2)` on `PartialPaymentLink`. `recordPayment` currently declares its `amount` parameter as `number` (line 111 in `payments.service.ts`), so the conversion is required by the existing interface. However:
- The conversion itself is safe at Thai phone-sale amounts (≤Decimal(12,2)).
- The root issue is that `recordPayment` accepts `number` not `Decimal` — this is a pre-existing interface debt, not introduced by this branch.

**Suggested fix** (note: requires a coordinated change to `payments.service.ts`):
```ts
// Short-term: label the boundary
Number(link.amount), // interface accepts number; amount ≤ Decimal(12,2), IEEE-754 safe

// Long-term: change recordPayment(amount: number) → recordPayment(amount: Prisma.Decimal)
```

---

### ⚠️ Warning — `Number()` on Decimal pricing fields in sticker data endpoint

**File**: `apps/api/src/modules/stickers/` service (sticker data batch endpoint)

```ts
cashPrice: pricing ? Number(pricing.cashPrice) : null,
downPayment: pricing.rate1DownPayment !== null ? Number(pricing.rate1DownPayment) : defaults.rate1Down,
monthlyPrice: Number(pricing.installmentBestchoicePrice),
```

These are display-only values returned to the frontend for sticker printing. Same precision argument as W-1 — safe in practice but violates convention.

**Suggested fix**: Use `.toNumber()` with a comment at the JSON serialization boundary.

---

### ⚠️ Warning — `Number()` on form `onChange` in frontend (minor)

**File**: `apps/web/src/pages/` (pricing template settings form)

```tsx
onChange={(e) => setForm((f) => ({ ...f, rate1DownPayment: ... Number(e.target.value) }))}
```

Form input values are strings from `<input type="number">`. Converting with `Number()` is standard React form practice (not a Decimal/Prisma context). Not a Decimal violation. Noted for completeness only.

---

## Things That Look Good

| Check | Result |
|-------|--------|
| New `PaymentMethodConfigController` has `@UseGuards(JwtAuthGuard, RolesGuard)` at class level | ✅ |
| All 4 methods have `@Roles(...)` | ✅ |
| New payments endpoints (`/partial-qr`) have `@Roles(...)` | ✅ |
| `PaymentMethodConfigService` uses `deletedAt: null` in all queries | ✅ |
| `CreatePaymentMethodConfigDto` has class-validator + Thai messages | ✅ |
| `PartialPaymentLink` webhook handler is idempotent (`link.status !== 'ACTIVE'` guard) | ✅ |
| `handlePartialPaymentCallback` marks link PAID before `recordPayment` (prevents race) | ✅ |
| No hardcoded secrets or API keys | ✅ |
| No raw `$queryRaw` SQL | ✅ |
| Frontend uses `api.get()`/`api.post()` from `@/lib/api` | ✅ |
| `queryClient.invalidateQueries()` called after all mutations | ✅ |
| `PartialPaymentLink` has no `deletedAt` — by design (status-lifecycle model, TTL-cleaned) | ✅ acceptable |
| Backend `fetch()` calls are server→PaySolutions gateway (not frontend raw fetch) | ✅ acceptable |

---

## Recommendation

**⚠️ REVIEW** — No Criticals. Two Warnings around `Number()` on Decimal fields. Issues are:
1. Convention violations (not data-loss at current amount scale).
2. `recordPayment`'s `number` interface is pre-existing debt — cannot be fixed in this branch alone.

**Suggested action before merge**: At minimum, rename the conversion calls to `.toNumber()` so intent is explicit and searchable for future refactors. The `recordPayment` interface refactor can be tracked separately.
