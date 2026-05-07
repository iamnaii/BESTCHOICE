# Merge Guard Report — feat/payment-method-config-qr

**Date**: 2026-05-07  
**Branch**: `feat/payment-method-config-qr`  
**Author**: Akenarin Kongdach  
**Reviewed by**: Pre-Merge Guard (automated)

---

## File Changes Summary

| Files | Insertions | Deletions |
|-------|-----------|-----------|
| 58 | +5,829 | −2,212 |

This branch extends `feat/sticker-print-redesign` (+27 files, +1,897 insertions):

### New modules / pages (unique to this branch)
1. **`PaymentMethodConfigModule`** — new NestJS module: maps `CASH/TRANSFER/QR` → Chart-of-Accounts codes. Settings page at `/settings/payment-methods`.
2. **Partial-payment QR flow** — cashier sends a partial-payment QR link to customer via LINE OA Flex; PaySolutions webhook auto-records on scan.
3. **`QrSentBadge.tsx`** — inline badge in `PaymentTable` showing active partial-QR status, countdown, cancel.
4. **`RecordPaymentWizard.tsx`** — updated to filter cash-account selector by picked payment method.
5. **`PartialPaymentLink` schema model** — new Prisma model for tracking sent QR links.
6. **LINE OA**: `partial-payment-qr.flex.ts`, `early-payoff-qr.flex.ts` — new Style D Flex templates.
7. **2 new DB migrations** covering `payment_method_configs` and `partial_payment_links` tables.

---

## Issues

### Critical
_None_

### Warning

**[WARN-1] `Number(link.amount)` passed to `recordPayment()` — precision risk**  
File: `apps/api/src/modules/paysolutions/paysolutions.service.ts`  
```typescript
await this.paymentsService.recordPayment(
  payment.contractId,
  payment.installmentNo,
  Number(link.amount),   // ← link.amount: Decimal @db.Decimal(12, 2)
  'ONLINE_GATEWAY',
  ...
);
```
`link.amount` is `Decimal @db.Decimal(12, 2)`. `recordPayment()` currently accepts `amount: number`. Converting Decimal → JS float can lose sub-cent precision for amounts like ฿1,333.33 (IEEE 754 binary cannot represent this exactly). v4 hardening already fixed 53 similar `Number()` calls in 12 services; this new call regresses that effort.

**Recommended fix** (in this branch or as follow-up before next accounting close):
```typescript
// Option A: update recordPayment signature to accept Decimal | number
async recordPayment(... amount: Prisma.Decimal | number ...)

// Option B (quick): use Prisma.Decimal directly
Number(link.amount.toString())  // still float but at least reads the string representation
// OR: pass Prisma.Decimal — requires RecordPayment refactor
```
The v4 pattern from `finance-receivable.service.ts` uses `new Prisma.Decimal(value.toString())` before arithmetic. Same principle applies here.

---

**[WARN-2] Payment URL sent to third-party QR-generation service**  
File: `apps/web/src/pages/PaymentsPage/components/QrSentBadge.tsx`  
```tsx
src={`https://api.qrserver.com/v1/create-qr-code/?size=400x400&...&data=${encodeURIComponent(data.paymentUrl ?? '')}`}
```
`data.paymentUrl` is a PaySolutions payment link (e.g. `https://payment.paysolutions.asia/...?token=...`). Sending it to `api.qrserver.com` (an external third-party service) means the payment token is logged on their infrastructure. PaySolutions tokens expire after 24 h (the `PartialPaymentLink.expiresAt` TTL), so the risk window is bounded, but it still leaks payment-intent tokens off-system.

**Recommended fix**: generate the QR image server-side or via a local library:
```bash
# Option A: backend endpoint returns a data-URL PNG
GET /payments/:id/partial-qr/qr-image  → image/png

# Option B: install `qrcode` on the web package
import QRCode from 'qrcode';
const dataUrl = await QRCode.toDataURL(data.paymentUrl);
```
If neither is feasible before launch, scope the fix as a follow-up and document in PDPA/security register.

---

### Info

**[INFO-1] `bg-white` on QR code `<img>` container**  
File: `QrSentBadge.tsx`  
```tsx
className="size-64 rounded-lg border border-border bg-white p-2"
```
QR codes require a white background to be scannable. This is a functional constraint, not aesthetic. Frontend rule excludes `bg-white` only for "print/receipt context" — QR display is borderline but has the same technical justification. Acceptable as-is; annotate with a comment `{/* white bg required for QR scanability */}` if desired.

**[INFO-2] `Number(data.amount)` for display only**  
File: `QrSentBadge.tsx`  
`data.amount` is typed `string` in the `PartialPaymentLink` interface (JSON serialization of Decimal). `Number("1500.00").toLocaleString(...)` is display-only formatting. No precision concern.

**[INFO-3] `fetch()` calls in PaySolutions service**  
The two new `await fetch(...)` calls in `paysolutions.service.ts` (partial-payment QR generation) follow the existing v3 hardening pattern: `AbortController` + `PAYSOLUTIONS_TIMEOUT_MS` timeout + Sentry on abort. This is backend-to-external-API, not a frontend anti-pattern. Acceptable.

**[INFO-4] New `PaymentMethodConfigModule` guards — verified complete**  
```
@Controller('payment-method-configs')
@UseGuards(JwtAuthGuard, RolesGuard)           ← class-level ✓
  @Get()    @Roles(OWNER|BM|FM|ACCOUNTANT|SALES) ✓
  @Post()   @Roles(OWNER|FM)                     ✓
  @Patch()  @Roles(OWNER|FM)                     ✓
  @Delete() @Roles(OWNER|FM)                     ✓
```
DTOs have Thai-language class-validator messages. Soft-delete pattern used throughout service. Duplicate guard (method+accountCode uniqueness) checked at service layer before DB constraint.

**[INFO-5] Module registered in `app.module.ts`** — confirmed at line ~211.

---

## New Prisma Models

### `PaymentMethodConfig`
- UUID PK, `createdAt/updatedAt/deletedAt` ✓
- `@@unique([method, accountCode])` ✓
- `@@index([method, enabled])` ✓
- No money fields — no Decimal concern

### `PartialPaymentLink`
- UUID PK, `createdAt/updatedAt/deletedAt` ✓
- `amount Decimal @db.Decimal(12, 2)` ✓
- FK → `Payment`, `Contract`, `Customer` ✓

---

## Verdict

**⚠️ REVIEW** — 2 warnings must be acknowledged before merge.

| # | Severity | Item | Action |
|---|----------|------|--------|
| WARN-1 | Warning | `Number(link.amount)` → `recordPayment()` precision | Fix before accounting-close month or create tracked follow-up |
| WARN-2 | Warning | Payment URL → `api.qrserver.com` (3rd party) | Fix or document in security register with TTL mitigation |

Both warnings are fixable in this branch without architectural changes. If owner accepts the risk (short token TTL, small amounts), WARN-2 can be deferred with a documented ticket. WARN-1 is lower risk (฿ amounts rarely hit IEEE 754 edge cases for whole multiples of 0.01) but should be tracked given the v4 precedent.

All security guards are in place. No hardcoded secrets. No SQL injection. No missing `deletedAt` filters.
