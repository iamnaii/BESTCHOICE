# Full Codebase Audit Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 15 Critical, 27 Warning, and 18 Info issues found in the 2026-04-17 full codebase audit.

**Architecture:** Systematic sweep organized by impact area — Decimal precision first (biggest blast radius), then security, frontend runtime, soft-delete, integration robustness, and frontend quality. Each task is self-contained and independently committable.

**Tech Stack:** NestJS + Prisma.Decimal, React 18, TypeScript, crypto (timingSafeEqual), class-validator

---

## File Map

### Backend — Decimal Precision Fixes
- Modify: `apps/api/src/modules/payments/payments.service.ts` (core payment path)
- Modify: `apps/api/src/modules/contracts/contract-payment.service.ts` (early payoff + schedule)
- Modify: `apps/api/src/modules/paysolutions/paysolutions.service.ts` (webhook + intent)
- Modify: `apps/api/src/modules/repossessions/repossessions.service.ts` (preview calc)
- Modify: `apps/api/src/modules/inter-company/inter-company.service.ts` (summary)
- Modify: `apps/api/src/modules/accounting/accounting.service.ts` (expense update)
- Modify: `apps/api/src/modules/purchase-orders/purchase-orders.service.ts` (aging)
- Modify: `apps/api/src/modules/contracts/contracts.service.ts` (edit flow)
- Modify: `apps/api/src/modules/accounting/monthly-close.service.ts` (balance check)
- Modify: `apps/api/src/modules/accounting/data-audit.service.ts` (audit checks)
- Modify: `apps/api/src/modules/analytics/analytics.service.ts` (raw query)
- Modify: `apps/api/src/modules/commission/commission.service.ts` (chat commerce)
- Create: `apps/api/src/utils/decimal.util.ts` (shared Decimal helpers)

### Backend — Security Fixes
- Modify: `apps/api/src/modules/paysolutions/paysolutions.controller.ts` (webhook HMAC + intent guard)
- Modify: `apps/api/src/modules/facebook/facebook-webhook.controller.ts` (raw body HMAC + deauthorize + timingSafeEqual)
- Modify: `apps/api/src/modules/line-oa/line-login.controller.ts` (token in URL)
- Modify: `apps/api/src/modules/notifications/notifications.service.ts` (PII masking)
- Modify: `apps/api/src/modules/csat/csat.controller.ts` (throttle)
- Modify: `apps/api/src/modules/web-widget/web-widget.controller.ts` (throttle)
- Modify: `apps/api/src/modules/line-oa/line-oa-payment.controller.ts` (RolesGuard)
- Modify: `apps/api/src/modules/integrations/integration-config.service.ts` (startup validation)
- Modify: `apps/api/src/main.ts` (raw body preservation for Facebook)

### Backend — Soft-Delete + Race Conditions
- Modify: `apps/api/src/modules/contracts/contract-payment.service.ts` (deletedAt filters + isolation)

### Backend — Integration Robustness
- Modify: `apps/api/src/modules/peak/peak.service.ts` (timeout + HMAC review)
- Modify: `apps/api/src/modules/chatbot-finance-liff/liff-token.guard.ts` (timeout)
- Modify: `apps/api/src/modules/mdm/mdm-auto.service.ts` (atomicity)
- Modify: `apps/api/src/modules/notifications/scheduler.service.ts` (N+1 + empty catch)

### Backend — Performance
- Modify: `apps/api/src/modules/commission/commission.service.ts` (pagination)
- Modify: `apps/api/src/modules/accounting/bad-debt.service.ts` (pagination)

### Frontend — Runtime Fixes
- Modify: `apps/web/src/pages/MdmDashboardPage.tsx` (setState in render)
- Modify: `apps/web/src/pages/SystemStatusPage.tsx` (data! assertions)

### Frontend — QueryBoundary
- Modify: `apps/web/src/pages/POSPage/index.tsx`
- Modify: `apps/web/src/pages/SettingsPage/index.tsx`
- Modify: `apps/web/src/pages/LineOaSettingsPage.tsx`
- Modify: `apps/web/src/pages/LineGreetingPage.tsx`
- Modify: `apps/web/src/pages/BroadcastPage.tsx`
- Modify: `apps/web/src/pages/MdmDashboardPage.tsx`
- Modify: `apps/web/src/pages/RichMenuPage.tsx`
- Modify: `apps/web/src/pages/StickerPrintPage.tsx`
- Modify: `apps/web/src/pages/NotificationsPage/index.tsx`

### Frontend — Design Token + Thai Text
- Modify: `apps/web/src/pages/RepossessionsPage.tsx` (65 hardcoded colors)
- Modify: `apps/web/src/components/ui/card.tsx` (leading-none → leading-snug)
- Modify: Multiple pages for Thai date formatting
- Modify: Multiple pages for hardcoded chart/dashboard colors

### Frontend — Type Safety
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx`
- Modify: `apps/web/src/hooks/useUnreadChat.ts`

---

## Task 1: Create Decimal Utility Helpers

**Files:**
- Create: `apps/api/src/utils/decimal.util.ts`
- Test: `apps/api/src/utils/decimal.util.spec.ts`

**Why:** Every Decimal fix needs the same helpers. Create once, use everywhere.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/utils/decimal.util.spec.ts
import { Prisma } from '@prisma/client';
import { d, dAdd, dSub, dMul, dSum, dGte, dAbs, dRound, dCompare } from './decimal.util';

describe('decimal.util', () => {
  describe('d()', () => {
    it('converts number to Decimal', () => {
      expect(d(123.45).toString()).toBe('123.45');
    });
    it('converts string to Decimal', () => {
      expect(d('999.99').toString()).toBe('999.99');
    });
    it('passes through Prisma.Decimal', () => {
      const val = new Prisma.Decimal('100.00');
      expect(d(val).toString()).toBe('100');
    });
    it('handles null/undefined as zero', () => {
      expect(d(null).toString()).toBe('0');
      expect(d(undefined).toString()).toBe('0');
    });
  });

  describe('arithmetic', () => {
    it('dAdd adds two decimals', () => {
      expect(dAdd('100.10', '200.20').toString()).toBe('300.3');
    });
    it('dSub subtracts', () => {
      expect(dSub('300.30', '100.10').toString()).toBe('200.2');
    });
    it('dMul multiplies', () => {
      expect(dMul('10.50', '3').toString()).toBe('31.5');
    });
    it('dSum sums array', () => {
      expect(dSum(['10.10', '20.20', '30.30']).toString()).toBe('60.6');
    });
  });

  describe('comparison', () => {
    it('dGte returns true if a >= b', () => {
      expect(dGte('100.01', '100.00')).toBe(true);
      expect(dGte('100.00', '100.00')).toBe(true);
      expect(dGte('99.99', '100.00')).toBe(false);
    });
    it('dCompare returns -1, 0, 1', () => {
      expect(dCompare('100', '200')).toBe(-1);
      expect(dCompare('200', '200')).toBe(0);
      expect(dCompare('300', '200')).toBe(1);
    });
  });

  describe('dRound', () => {
    it('rounds to 2 decimal places (satang)', () => {
      expect(dRound('100.555').toString()).toBe('100.56');
      expect(dRound('100.554').toString()).toBe('100.55');
    });
  });

  describe('dAbs', () => {
    it('returns absolute value', () => {
      expect(dAbs('-100.50').toString()).toBe('100.5');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest src/utils/decimal.util.spec.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// apps/api/src/utils/decimal.util.ts
import { Prisma } from '@prisma/client';

type DecimalInput = Prisma.Decimal | string | number | null | undefined;

/** Convert any value to Prisma.Decimal (null/undefined → 0) */
export function d(val: DecimalInput): Prisma.Decimal {
  if (val === null || val === undefined) return new Prisma.Decimal(0);
  if (val instanceof Prisma.Decimal) return val;
  return new Prisma.Decimal(val);
}

export function dAdd(a: DecimalInput, b: DecimalInput): Prisma.Decimal {
  return d(a).add(d(b));
}

export function dSub(a: DecimalInput, b: DecimalInput): Prisma.Decimal {
  return d(a).sub(d(b));
}

export function dMul(a: DecimalInput, b: DecimalInput): Prisma.Decimal {
  return d(a).mul(d(b));
}

export function dDiv(a: DecimalInput, b: DecimalInput): Prisma.Decimal {
  return d(a).div(d(b));
}

export function dSum(vals: DecimalInput[]): Prisma.Decimal {
  return vals.reduce<Prisma.Decimal>((acc, v) => acc.add(d(v)), new Prisma.Decimal(0));
}

export function dGte(a: DecimalInput, b: DecimalInput): boolean {
  return d(a).gte(d(b));
}

export function dAbs(a: DecimalInput): Prisma.Decimal {
  return d(a).abs();
}

/** Round to 2 decimal places (satang precision) */
export function dRound(a: DecimalInput): Prisma.Decimal {
  return d(a).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function dCompare(a: DecimalInput, b: DecimalInput): -1 | 0 | 1 {
  return d(a).cmp(d(b)) as -1 | 0 | 1;
}

/** Check if two Decimals are within tolerance (default 0.01 baht) */
export function dClose(a: DecimalInput, b: DecimalInput, tolerance = '0.01'): boolean {
  return dAbs(dSub(a, b)).lte(new Prisma.Decimal(tolerance));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest src/utils/decimal.util.spec.ts --no-coverage`
Expected: PASS (all 10 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/utils/decimal.util.ts apps/api/src/utils/decimal.util.spec.ts
git commit -m "feat: add Decimal utility helpers for safe financial arithmetic"
```

---

## Task 2: Fix payments.service.ts — Decimal Precision (CRITICAL C1)

**Files:**
- Modify: `apps/api/src/modules/payments/payments.service.ts:120-139,306-309,619-639,720-721`

**Why:** Core payment recording path uses `Number()` on Decimal fields — financial data integrity risk.

- [ ] **Step 1: Add import at top of file**

At the top of `payments.service.ts`, add:

```typescript
import { d, dAdd, dSub, dMul, dRound, dGte, dClose } from '../../utils/decimal.util';
```

- [ ] **Step 2: Fix recordPayment (lines ~120-139)**

Replace the Number()-based arithmetic in the `recordPayment` method:

```typescript
// OLD (lines 120-139):
let lateFee = Number(payment.lateFee);
// ... late fee calculation with Number() ...
const amountDue = roundBaht(Number(payment.amountDue) + lateFee);
const prevPaid = roundBaht(Number(payment.amountPaid));

// NEW:
let lateFee = d(payment.lateFee);
if (payment.status !== 'PAID' && !payment.lateFeeWaived) {
  const daysLate = /* keep existing daysLate calculation */;
  if (daysLate > 0) {
    const feePerDay = config ? d(config.value) : d(50);
    const cap = capConfig ? d(capConfig.value) : d(1500);
    const pctCap = dMul(payment.amountDue, BUSINESS_RULES.LATE_FEE_CAP_PCT);
    const rawFee = dRound(dMul(feePerDay, daysLate));
    lateFee = dRound(Prisma.Decimal.min(rawFee, cap, pctCap));
  }
}
const amountDue = dRound(dAdd(payment.amountDue, lateFee));
const prevPaid = dRound(d(payment.amountPaid));
```

For every subsequent `Number()` call in this method, replace with the `d()` equivalents. The comparison `if (amount > amountDue - prevPaid)` becomes `if (d(amount).gt(dSub(amountDue, prevPaid)))`.

- [ ] **Step 3: Fix autoAllocatePayment (lines ~306-309)**

```typescript
// OLD:
const amountDue = roundBaht(Number(payment.amountDue) + Number(payment.lateFee) - Number(payment.amountPaid));
const payAmount = roundBaht(Math.min(remaining, amountDue));
const totalPaid = roundBaht(Number(payment.amountPaid) + payAmount);
const isPaidInFull = totalPaid >= roundBaht(Number(payment.amountDue) + Number(payment.lateFee));

// NEW:
const amountDue = dRound(dSub(dAdd(payment.amountDue, payment.lateFee), payment.amountPaid));
const payAmount = dRound(Prisma.Decimal.min(d(remaining), amountDue));
const totalPaid = dRound(dAdd(payment.amountPaid, payAmount));
const isPaidInFull = dGte(totalPaid, dRound(dAdd(payment.amountDue, payment.lateFee)));
```

Update `remaining` to be tracked as `Prisma.Decimal` throughout the loop:
```typescript
let remaining = d(amount); // at start of method
// after each allocation:
remaining = dSub(remaining, payAmount);
```

- [ ] **Step 4: Fix applyCreditBalance (lines ~619-639)**

Same pattern as autoAllocatePayment:

```typescript
// OLD:
const credit = Number(contract.creditBalance);

// NEW:
const credit = d(contract.creditBalance);
let remaining = credit;
// ... same dRound/dAdd/dSub pattern as Step 3 ...
```

- [ ] **Step 5: Fix CSV import parseFloat (line ~721)**

```typescript
// OLD:
const amount = parseFloat(amountStr);

// NEW:
const trimmed = amountStr?.trim();
if (!trimmed || isNaN(Number(trimmed))) {
  errors.push(`Row ${i}: invalid amount "${amountStr}"`);
  continue;
}
const amount = new Prisma.Decimal(trimmed);
```

- [ ] **Step 6: Remove roundBaht usage — replace with dRound**

Search for all `roundBaht(` calls in this file and replace with `dRound(`. The old `roundBaht` function used `Math.round()` which is float-based.

- [ ] **Step 7: Run existing tests**

Run: `cd apps/api && npx jest --testPathPattern=payments --no-coverage`
Expected: All existing payment tests PASS

- [ ] **Step 8: Run type check**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/payments/payments.service.ts
git commit -m "fix(payments): replace Number() with Prisma.Decimal in core payment path

AUDIT-C1: recordPayment, autoAllocatePayment, applyCreditBalance, CSV import
all converted to Decimal arithmetic to prevent float drift on financial data"
```

---

## Task 3: Fix payments.service.ts — Journal Failure Sentry (CRITICAL C6)

**Files:**
- Modify: `apps/api/src/modules/payments/payments.service.ts:193-196`

- [ ] **Step 1: Add Sentry import if missing**

```typescript
import * as Sentry from '@sentry/node';
```

- [ ] **Step 2: Add Sentry capture to journal catch block**

```typescript
// OLD (lines 193-196):
} catch (err) {
  // Don't fail payment if journal fails — log and continue
  this.logger.error(`Auto-journal failed for payment ${result.id}: ${err}`);
}

// NEW:
} catch (err) {
  this.logger.error(`Auto-journal failed for payment ${result.id}: ${err}`);
  Sentry.captureException(err, {
    tags: { module: 'payments', action: 'auto-journal' },
    extra: { paymentId: result.id, contractId: result.contractId },
  });
}
```

- [ ] **Step 3: Run type check**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/payments/payments.service.ts
git commit -m "fix(payments): add Sentry capture on journal failure

AUDIT-C6: payment records as PAID but journal fails silently — now Sentry alerts"
```

---

## Task 4: Fix contract-payment.service.ts — Decimal + Soft-Delete + Isolation (CRITICAL C2, C4 + WARNING)

**Files:**
- Modify: `apps/api/src/modules/contracts/contract-payment.service.ts:17-20,53-109,121-149`

- [ ] **Step 1: Add Decimal import**

```typescript
import { Prisma } from '@prisma/client';
import { d, dAdd, dSub, dMul, dDiv, dRound, dSum } from '../../utils/decimal.util';
```

- [ ] **Step 2: Fix getSchedule — add deletedAt filter (line 17-20)**

```typescript
// OLD:
return this.prisma.payment.findMany({
  where: { contractId: id },
  orderBy: { installmentNo: 'asc' },
});

// NEW:
return this.prisma.payment.findMany({
  where: { contractId: id, deletedAt: null },
  orderBy: { installmentNo: 'asc' },
});
```

- [ ] **Step 3: Fix getEarlyPayoffQuote — all Number() → Decimal (lines 53-109)**

```typescript
// OLD:
const monthlyPayment = Number(contract.monthlyPayment);
const creditBalance = Number(contract.creditBalance || 0);
// ... etc

// NEW:
const monthlyPayment = d(contract.monthlyPayment);
const creditBalance = d(contract.creditBalance);
const totalAlreadyPaid = dSum(paidPayments.map((p) => d(p.amountPaid)));
const remainingMonths = totalMonths - paidPayments.length;
const totalRemaining = dMul(monthlyPayment, remainingMonths);
const vatPct = d(contract.vatPct);
const truePrincipal = dSub(contract.sellingPrice, contract.downPayment);
const financeCost = dAdd(truePrincipal, d(contract.storeCommission));
// ... continue converting all Number() calls to d() equivalents
```

Every `Number()` in this method becomes `d()`. Every `+` becomes `dAdd()`. Every `-` becomes `dSub()`. Every `*` becomes `dMul()`. Every `/` becomes `dDiv()`.

- [ ] **Step 4: Fix earlyPayoff transaction — deletedAt + isolation (lines 121-149)**

```typescript
// OLD (line 121):
return this.prisma.$transaction(async (tx) => {

// NEW:
return this.prisma.$transaction(async (tx) => {
  // ... existing code ...
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
```

Fix the findMany inside the transaction (lines 130-133):
```typescript
// OLD:
const unpaidPayments = await tx.payment.findMany({
  where: { contractId: id, status: { not: 'PAID' } },
  orderBy: { installmentNo: 'asc' },
});

// NEW:
const unpaidPayments = await tx.payment.findMany({
  where: { contractId: id, status: { not: 'PAID' }, deletedAt: null },
  orderBy: { installmentNo: 'asc' },
});
```

Fix the Decimal math in the loop (lines 138-139):
```typescript
// OLD:
const lateFee = payment.lateFeeWaived ? 0 : Number(payment.lateFee);
const owed = Number(payment.amountDue) + lateFee - Number(payment.amountPaid);

// NEW:
const lateFee = payment.lateFeeWaived ? d(0) : d(payment.lateFee);
const owed = dSub(dAdd(payment.amountDue, lateFee), payment.amountPaid);
```

- [ ] **Step 5: Run tests**

Run: `cd apps/api && npx jest --testPathPattern=contract-payment --no-coverage`
Expected: PASS

- [ ] **Step 6: Run type check**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/contracts/contract-payment.service.ts
git commit -m "fix(contracts): Decimal precision + soft-delete + Serializable in early payoff

AUDIT-C2: early payoff calc Number() → Prisma.Decimal
AUDIT-C4: getSchedule + earlyPayoff missing deletedAt: null
AUDIT-W8: earlyPayoff transaction now Serializable isolation"
```

---

## Task 5: Fix paysolutions.service.ts — Decimal Precision (CRITICAL C3)

**Files:**
- Modify: `apps/api/src/modules/paysolutions/paysolutions.service.ts:128,387`

- [ ] **Step 1: Add import**

```typescript
import { d, dAdd, dSub, dClose } from '../../utils/decimal.util';
```

- [ ] **Step 2: Fix amount comparison (line 128)**

```typescript
// OLD:
const expectedAmount = Number(paymentRecord.amountDue) + Number(paymentRecord.lateFee) - Number(paymentRecord.amountPaid);
if (Math.abs(amount - expectedAmount) > 0.01) {

// NEW:
const expectedAmount = dSub(dAdd(paymentRecord.amountDue, paymentRecord.lateFee), paymentRecord.amountPaid);
if (!dClose(amount, expectedAmount)) {
```

- [ ] **Step 3: Fix parseFloat on webhook amount (line 387)**

```typescript
// OLD:
amountPaid: total ? parseFloat(total) : paymentLink.amount,

// NEW:
amountPaid: total && !isNaN(Number(total)) ? new Prisma.Decimal(total) : paymentLink.amount,
```

- [ ] **Step 4: Run tests**

Run: `cd apps/api && npx jest --testPathPattern=paysolutions --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/paysolutions/paysolutions.service.ts
git commit -m "fix(paysolutions): replace Number()/parseFloat() with Prisma.Decimal

AUDIT-C3: webhook amountPaid + intent expectedAmount now use Decimal arithmetic"
```

---

## Task 6: Fix PaySolutions Security — Webhook HMAC + Intent Guard (CRITICAL C7, C8)

**Files:**
- Modify: `apps/api/src/modules/paysolutions/paysolutions.controller.ts:37-43,73`
- Modify: `apps/api/src/modules/paysolutions/paysolutions.service.ts` (add HMAC verify helper)

- [ ] **Step 1: Add HMAC signature verification to webhook handler**

In `paysolutions.service.ts`, add a signature verification method:

```typescript
import { createHmac, timingSafeEqual } from 'crypto';

verifyWebhookSignature(body: Record<string, string>, signature: string): boolean {
  const config = this.getConfig();
  if (!config.secretKey) {
    this.logger.warn('[PaySolutions] No secret key configured — skipping HMAC verify');
    return true; // graceful degradation until key is configured
  }
  const payload = Object.keys(body).sort().map(k => `${k}=${body[k]}`).join('&');
  const expected = createHmac('sha256', config.secretKey).update(payload).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false; // length mismatch
  }
}
```

**Note:** The exact HMAC algorithm depends on PaySolutions documentation. If PaySolutions does NOT support HMAC, add IP whitelist verification instead:

```typescript
private readonly PAYSOLUTIONS_IPS = ['203.xxx.xxx.xxx']; // from PaySolutions docs

verifyWebhookIP(ip: string): boolean {
  return this.PAYSOLUTIONS_IPS.includes(ip);
}
```

- [ ] **Step 2: Add LiffTokenGuard to create-intent endpoint**

```typescript
// OLD (line 37-43):
@Post('create-intent')
@SkipCsrf()
@Throttle({ short: { ttl: 10000, limit: 5 } })
async createPaymentIntent(@Body() dto: CreatePaymentIntentDto) {

// NEW:
@Post('create-intent')
@SkipCsrf()
@UseGuards(LiffTokenGuard)
@Throttle({ short: { ttl: 10000, limit: 5 } })
async createPaymentIntent(@Body() dto: CreatePaymentIntentDto) {
```

Add the import:
```typescript
import { LiffTokenGuard } from '../chatbot-finance-liff/liff-token.guard';
```

- [ ] **Step 3: Run type check**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/paysolutions/
git commit -m "fix(paysolutions): add webhook signature verify + LiffTokenGuard on create-intent

AUDIT-C7: webhook now verifies HMAC signature (or IP whitelist if HMAC unsupported)
AUDIT-C8: create-intent requires valid LIFF token, not just lineId string"
```

---

## Task 7: Fix Facebook Webhook Security (CRITICAL C9, C10)

**Files:**
- Modify: `apps/api/src/modules/facebook/facebook-webhook.controller.ts:271,301-310,316-337`
- Modify: `apps/api/src/main.ts` (preserve raw body for Facebook routes)

- [ ] **Step 1: Preserve raw body in main.ts**

In `main.ts`, add raw body preservation for Facebook webhook route (similar to LINE):

```typescript
// In the NestFactory.create options or bodyParser config:
app.use('/api/webhooks/facebook', express.json({
  verify: (req: any, _res, buf) => {
    req.rawBody = buf;
  },
}));
```

- [ ] **Step 2: Fix verifySignature to use raw bytes (lines 316-337)**

```typescript
// OLD:
private verifySignature(body: any, signature: string): boolean {
  // ...
  .update(JSON.stringify(body))
  .digest('hex');

// NEW:
private verifySignature(rawBody: Buffer, signature: string): boolean {
  if (!signature?.startsWith('sha256=')) return false;
  const appSecret = this.getAppSecret();
  const expected = createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');
  const provided = signature.slice('sha256='.length);
  try {
    return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
```

Update the webhook handler to pass rawBody:
```typescript
async handleWebhook(@Req() req: any, @Body() body: any, ...) {
  if (!this.verifySignature(req.rawBody, req.headers['x-hub-signature-256'])) {
    throw new ForbiddenException('Invalid signature');
  }
  // ...
}
```

- [ ] **Step 3: Fix data-deletion — use timingSafeEqual (line 271)**

```typescript
// OLD:
if (sigB64 !== expectedSig) {

// NEW:
try {
  if (!timingSafeEqual(Buffer.from(sigB64), Buffer.from(expectedSig))) {
    throw new ForbiddenException('Invalid signed_request');
  }
} catch {
  throw new ForbiddenException('Invalid signed_request');
}
```

- [ ] **Step 4: Add signature verification to deauthorize (lines 301-310)**

```typescript
// OLD:
async handleDeauthorize(
  @Body() body: { signed_request?: string },
): Promise<{ success: boolean }> {
  this.logger.log('[FB Deauthorize] User revoked app authorization');
  return { success: true };

// NEW:
async handleDeauthorize(
  @Body() body: { signed_request?: string },
): Promise<{ success: boolean }> {
  if (!body.signed_request) {
    throw new BadRequestException('Missing signed_request');
  }
  const [sigB64, payloadB64] = body.signed_request.split('.');
  const appSecret = this.getAppSecret();
  const expectedSig = createHmac('sha256', appSecret)
    .update(payloadB64)
    .digest('base64url');
  try {
    if (!timingSafeEqual(Buffer.from(sigB64), Buffer.from(expectedSig))) {
      throw new ForbiddenException('Invalid signed_request');
    }
  } catch {
    throw new ForbiddenException('Invalid signed_request');
  }
  this.logger.log('[FB Deauthorize] User revoked app authorization (verified)');
  return { success: true };
}
```

- [ ] **Step 5: Run type check**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/facebook/facebook-webhook.controller.ts apps/api/src/main.ts
git commit -m "fix(facebook): use raw body for HMAC + timingSafeEqual + verify deauthorize

AUDIT-C9: webhook HMAC now uses raw body bytes instead of JSON.stringify
AUDIT-C10: data-deletion uses timingSafeEqual, deauthorize now verifies signature"
```

---

## Task 8: Fix LINE Login Token Leak (CRITICAL C11)

**Files:**
- Modify: `apps/api/src/modules/line-oa/line-login.controller.ts:139`

- [ ] **Step 1: Replace URL param with short-lived server-side code**

Instead of passing the LINE ID token in the URL, store it server-side with a short-lived code:

```typescript
// OLD (line 139):
redirectUrl.searchParams.set('line_id_token', tokenData.id_token);

// NEW:
// Generate a short-lived exchange code
const code = randomBytes(32).toString('hex');
await this.cacheManager.set(`line-login:${code}`, tokenData.id_token, 60_000); // 60s TTL
redirectUrl.searchParams.set('line_code', code);
```

The frontend then exchanges this code for the token via a POST endpoint:
```typescript
@Post('exchange-code')
@SkipCsrf()
@Throttle({ short: { ttl: 10000, limit: 5 } })
async exchangeCode(@Body('code') code: string) {
  const idToken = await this.cacheManager.get<string>(`line-login:${code}`);
  if (!idToken) throw new BadRequestException('Invalid or expired code');
  await this.cacheManager.del(`line-login:${code}`); // one-time use
  return { id_token: idToken };
}
```

Add imports:
```typescript
import { randomBytes } from 'crypto';
import { CACHE_MANAGER } from '@nestjs/common';
import { Cache } from 'cache-manager';
```

Inject cache in constructor:
```typescript
constructor(
  @Inject(CACHE_MANAGER) private cacheManager: Cache,
  // ... existing deps
) {}
```

- [ ] **Step 2: Add throttle to existing OAuth endpoints**

```typescript
@Get('authorize')
@Throttle({ default: { ttl: 60000, limit: 10 } })
async authorize(...) { ... }

@Get('callback')
@Throttle({ default: { ttl: 60000, limit: 10 } })
async callback(...) { ... }
```

- [ ] **Step 3: Run type check**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/line-oa/line-login.controller.ts
git commit -m "fix(line-login): replace URL token param with server-side code exchange

AUDIT-C11: LINE ID token no longer in URL query params — uses one-time code exchange
Also adds throttle to OAuth authorize + callback endpoints"
```

---

## Task 9: Fix PII in Logs (CRITICAL C15)

**Files:**
- Modify: `apps/api/src/modules/notifications/notifications.service.ts:208`
- Modify: `apps/api/src/modules/email/email.service.ts:66` (Warning — same pattern)

- [ ] **Step 1: Create PII masking helper**

Add to `apps/api/src/utils/mask.util.ts`:

```typescript
/** Mask phone: 0812345678 → 081****678 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + '****' + phone.slice(-3);
}

/** Mask email: user@example.com → us****@example.com */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return local.slice(0, 2) + '****@' + domain;
}
```

- [ ] **Step 2: Fix SMS dev-mode log (line 208)**

```typescript
// OLD:
this.logger.warn(`[SMS-DEV] Skipping real SMS. Message to ${recipient}: ${message}`);

// NEW:
this.logger.warn(`[SMS-DEV] Skipping real SMS to ${maskPhone(recipient)} (${message.length} chars)`);
```

Import: `import { maskPhone } from '../../utils/mask.util';`

- [ ] **Step 3: Fix email log**

```typescript
// OLD:
this.logger.log(`Password reset email sent to ${to}`);

// NEW:
this.logger.log(`Password reset email sent to ${maskEmail(to)}`);
```

- [ ] **Step 4: Also fix the SMS DLR webhook log (notifications.service.ts:345)**

```typescript
// OLD:
this.logger.log(`[SMS-DLR] Received: ... body=${JSON.stringify(body).substring(0, 500)}`);

// NEW:
const safeFields = { message_id: body.message_id, status: body.status, delivery_time: body.delivery_time };
this.logger.log(`[SMS-DLR] Received: ${JSON.stringify(safeFields)}`);
```

- [ ] **Step 5: Run type check**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/utils/mask.util.ts apps/api/src/modules/notifications/notifications.service.ts apps/api/src/modules/email/email.service.ts
git commit -m "fix: mask PII in logs — phone numbers, emails, SMS content

AUDIT-C15: SMS dev log leaked customer name+phone+contract
AUDIT-W: email log leaked email address, SMS DLR logged full body"
```

---

## Task 10: Fix Frontend Runtime Crashes (CRITICAL C12, C13)

**Files:**
- Modify: `apps/web/src/pages/MdmDashboardPage.tsx:244-246`
- Modify: `apps/web/src/pages/SystemStatusPage.tsx:111-265`

- [ ] **Step 1: Fix MdmDashboardPage — setState during render**

```typescript
// OLD (lines 244-246):
if (!isInSync) {
  setRestrictions(restrictionsData);
}

// NEW — wrap in useEffect:
useEffect(() => {
  if (restrictionsData && !isInSync) {
    setRestrictions(restrictionsData);
  }
}, [restrictionsData, isInSync]);
```

Remove the bare `if (!isInSync) { setRestrictions(restrictionsData); }` from the render body entirely.

- [ ] **Step 2: Fix SystemStatusPage — replace data! with null guard**

Add a null guard before the QueryBoundary children:

```typescript
// Inside the QueryBoundary render, before using data:
const status = data;
if (!status) return null;

// Then replace ALL data! with status:
// OLD: data!.timestamp → NEW: status.timestamp
// OLD: data!.api.status → NEW: status.api.status
// OLD: data!.database.connected → NEW: status.database.connected
// etc. for all ~30 occurrences
```

Do a find-and-replace: `data!.` → `status.` within the QueryBoundary block.

- [ ] **Step 3: Run type check**

Run: `./tools/check-types.sh web`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/MdmDashboardPage.tsx apps/web/src/pages/SystemStatusPage.tsx
git commit -m "fix: MdmDashboard setState loop + SystemStatus null safety

AUDIT-C12: move setRestrictions into useEffect to prevent infinite re-render
AUDIT-C13: replace 30 data! assertions with null-guarded status variable"
```

---

## Task 11: Fix Remaining Decimal Services (CRITICAL C4, C5 + WARNINGS)

**Files:**
- Modify: `apps/api/src/modules/repossessions/repossessions.service.ts:195-216`
- Modify: `apps/api/src/modules/inter-company/inter-company.service.ts:271-293`
- Modify: `apps/api/src/modules/accounting/accounting.service.ts:290-297`
- Modify: `apps/api/src/modules/purchase-orders/purchase-orders.service.ts:281-300`
- Modify: `apps/api/src/modules/contracts/contracts.service.ts:484-495`
- Modify: `apps/api/src/modules/accounting/monthly-close.service.ts:365-374`
- Modify: `apps/api/src/modules/accounting/data-audit.service.ts:228,265`
- Modify: `apps/api/src/modules/analytics/analytics.service.ts:123,211`

**Why:** Same Number() → Decimal pattern as Task 2 but in secondary services.

- [ ] **Step 1: Fix repossessions.service.ts (lines 195-216)**

Add import: `import { d, dAdd, dSub, dRound } from '../../utils/decimal.util';`

```typescript
// OLD:
outstandingBalance += Number(p.amountDue) - Number(p.amountPaid) + lateFee;
totalPaid += Number(p.amountPaid);
const financeCost = Number(contract.financedAmount) + Number(contract.storeCommission || 0);

// NEW:
let outstandingBalance = d(0);
let totalPaid = d(0);
for (const p of payments) {
  const lateFee = p.lateFeeWaived ? d(0) : d(p.lateFee);
  outstandingBalance = dAdd(outstandingBalance, dSub(dAdd(p.amountDue, lateFee), p.amountPaid));
  totalPaid = dAdd(totalPaid, p.amountPaid);
}
const financeCost = dAdd(contract.financedAmount, d(contract.storeCommission));
```

- [ ] **Step 2: Fix inter-company.service.ts (lines 271-293)**

```typescript
// OLD:
const shopProfit = Number(t.shopProfit);
// ... += pattern in loop

// NEW:
let totalShopProfit = d(0);
let totalFinanceProfit = d(0);
// ... etc. Use dAdd in the loop:
for (const t of transactions) {
  totalShopProfit = dAdd(totalShopProfit, t.shopProfit);
  totalFinanceProfit = dAdd(totalFinanceProfit, t.financeProfit);
  // ... same for all fields
}
```

- [ ] **Step 3: Fix accounting.service.ts (lines 290-297)**

```typescript
// OLD:
data.totalAmount = amount + vatAmount;

// NEW:
data.totalAmount = dAdd(data.amount, data.vatAmount ?? 0);
```

- [ ] **Step 4: Fix purchase-orders.service.ts (lines 281-300)**

Same dAdd loop pattern for payables aging.

- [ ] **Step 5: Fix contracts.service.ts (lines 484-495)**

Replace `Number()` comparisons with `d()` equivalents for sellingPrice, downPayment, interestRate.

- [ ] **Step 6: Fix monthly-close.service.ts (lines 365-374)**

```typescript
// OLD:
const totalDebit = lines.reduce((s, l) => s + Number(l.debit ?? 0), 0);
const totalCredit = lines.reduce((s, l) => s + Number(l.credit ?? 0), 0);
if (Math.abs(totalDebit - totalCredit) > 0.01) { ... }

// NEW:
import { d, dSum, dSub, dAbs, dClose } from '../../utils/decimal.util';
const totalDebit = dSum(lines.map((l) => d(l.debit)));
const totalCredit = dSum(lines.map((l) => d(l.credit)));
if (!dClose(totalDebit, totalCredit)) { ... }
```

- [ ] **Step 7: Fix data-audit.service.ts (lines 228, 265)**

Same pattern — replace `Number()` comparisons with Decimal.

- [ ] **Step 8: Fix analytics.service.ts (lines 123, 211)**

```typescript
// OLD:
amount: parseFloat(r.amount) || 0

// NEW:
amount: r.amount ? new Prisma.Decimal(r.amount) : new Prisma.Decimal(0)
```

Note: If the output is JSON for charts (display-only), `Number()` is acceptable here. Use `d(r.amount).toNumber()` explicitly to signal intent.

- [ ] **Step 9: Run all tests**

Run: `cd apps/api && npx jest --no-coverage`
Expected: All tests PASS

- [ ] **Step 10: Run type check**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/modules/repossessions/repossessions.service.ts \
  apps/api/src/modules/inter-company/inter-company.service.ts \
  apps/api/src/modules/accounting/accounting.service.ts \
  apps/api/src/modules/purchase-orders/purchase-orders.service.ts \
  apps/api/src/modules/contracts/contracts.service.ts \
  apps/api/src/modules/accounting/monthly-close.service.ts \
  apps/api/src/modules/accounting/data-audit.service.ts \
  apps/api/src/modules/analytics/analytics.service.ts
git commit -m "fix: sweep remaining Number() → Prisma.Decimal in 8 services

AUDIT-C4,C5 + W1,W6,W7,W11: repossessions, inter-company, accounting,
purchase-orders, contracts edit, monthly-close, data-audit, analytics"
```

---

## Task 12: Fix Security — Throttle + Guards on Public Endpoints (WARNINGS)

**Files:**
- Modify: `apps/api/src/modules/csat/csat.controller.ts:16`
- Modify: `apps/api/src/modules/web-widget/web-widget.controller.ts`
- Modify: `apps/api/src/modules/line-oa/line-oa-payment.controller.ts:481`
- Modify: `apps/api/src/modules/integrations/integration-config.service.ts`

- [ ] **Step 1: Add throttle to CSAT**

```typescript
@Post('submit')
@SkipCsrf()
@Throttle({ default: { ttl: 60000, limit: 5 } })
async submitRating(...) { ... }
```

- [ ] **Step 2: Add throttle to web-widget init**

```typescript
@Post('init')
@SkipCsrf()
@Throttle({ default: { ttl: 60000, limit: 10 } })
async initWidget(...) { ... }
```

- [ ] **Step 3: Add RolesGuard to line-oa-payment QR endpoint**

```typescript
// OLD:
@UseGuards(JwtAuthGuard)
@Get(':paymentId/qr')

// NEW:
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
@Get(':paymentId/qr')
```

- [ ] **Step 4: Add startup validation for encryption key**

In `integration-config.service.ts`, add `onModuleInit`:

```typescript
onModuleInit() {
  const key = this.configService.get<string>('INTEGRATION_ENCRYPTION_KEY');
  if (!key) {
    this.logger.warn(
      '[IntegrationConfig] INTEGRATION_ENCRYPTION_KEY not set — credentials stored in plaintext!',
    );
    Sentry.captureMessage('INTEGRATION_ENCRYPTION_KEY not configured', 'warning');
  }
}
```

- [ ] **Step 5: Run type check**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/csat/csat.controller.ts \
  apps/api/src/modules/web-widget/web-widget.controller.ts \
  apps/api/src/modules/line-oa/line-oa-payment.controller.ts \
  apps/api/src/modules/integrations/integration-config.service.ts
git commit -m "fix: add throttle to CSAT/widget, RolesGuard on payment QR, encryption key warning

AUDIT-W: public endpoints without throttle + missing RolesGuard + silent encryption fallback"
```

---

## Task 13: Fix Integration Robustness (WARNINGS)

**Files:**
- Modify: `apps/api/src/modules/peak/peak.service.ts:237-248`
- Modify: `apps/api/src/modules/chatbot-finance-liff/liff-token.guard.ts:59`
- Modify: `apps/api/src/modules/mdm/mdm-auto.service.ts:130-134`
- Modify: `apps/api/src/modules/notifications/scheduler.service.ts:214-231,323-325`

- [ ] **Step 1: Add timeout to PEAK getFromPeak()**

```typescript
// OLD:
async getFromPeak(path: string) {
  const response = await fetch(`${baseUrl}${path}`, { headers });

// NEW:
async getFromPeak(path: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers,
      signal: controller.signal,
    });
    // ... existing code ...
  } finally {
    clearTimeout(timeout);
  }
```

- [ ] **Step 2: Add timeout to LIFF token verify**

```typescript
// OLD (line 59):
const response = await fetch('https://api.line.me/oauth2/v2.1/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: params.toString(),
});

// NEW:
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10_000);
try {
  const response = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    signal: controller.signal,
  });
  // ... existing code ...
} finally {
  clearTimeout(timeout);
}
```

- [ ] **Step 3: Fix MDM auto-lock atomicity**

```typescript
// OLD:
await this.mdmService.lockDeviceByImei(imei);
await this.prisma.contract.update({
  where: { id: contract.id },
  data: { mdmLockedAt: new Date() },
});

// NEW — write optimistic flag first, rollback on MDM failure:
await this.prisma.contract.update({
  where: { id: contract.id },
  data: { mdmLockedAt: new Date() },
});
try {
  await this.mdmService.lockDeviceByImei(imei);
} catch (err) {
  // Rollback — MDM lock failed
  await this.prisma.contract.update({
    where: { id: contract.id },
    data: { mdmLockedAt: null },
  });
  throw err;
}
```

- [ ] **Step 4: Fix scheduler N+1 in dunning escalation (lines 214-231)**

```typescript
// OLD: individual findUnique per escalated contract
for (const c of result.escalated) {
  const contract = await this.prisma.contract.findUnique({ where: { id: c.contractId }, include: { payments: true } });
  // ...
}

// NEW: batch fetch
const contractIds = result.escalated.map((c) => c.contractId);
const contracts = await this.prisma.contract.findMany({
  where: { id: { in: contractIds } },
  include: { payments: { where: { deletedAt: null } } },
});
const contractMap = new Map(contracts.map((c) => [c.id, c]));
for (const c of result.escalated) {
  const contract = contractMap.get(c.contractId);
  if (!contract) continue;
  // ...
}
```

- [ ] **Step 5: Fix empty catch in scheduler SLA (lines 323-325)**

```typescript
// OLD:
} catch {
  // Skip if notification log creation fails
}

// NEW:
} catch (err) {
  this.logger.error(`[SLA] Failed to create notification log: ${err}`);
  Sentry.captureException(err, { tags: { module: 'scheduler', action: 'sla-notification' } });
}
```

- [ ] **Step 6: Run type check**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/peak/peak.service.ts \
  apps/api/src/modules/chatbot-finance-liff/liff-token.guard.ts \
  apps/api/src/modules/mdm/mdm-auto.service.ts \
  apps/api/src/modules/notifications/scheduler.service.ts
git commit -m "fix: integration robustness — timeouts, MDM atomicity, N+1, error capture

AUDIT-W: PEAK GET timeout, LIFF verify timeout, MDM lock rollback,
dunning N+1 batch, SLA empty catch → Sentry"
```

---

## Task 14: Fix Performance — Unbounded Queries (WARNINGS)

**Files:**
- Modify: `apps/api/src/modules/commission/commission.service.ts:89-93,315-318`
- Modify: `apps/api/src/modules/accounting/bad-debt.service.ts:67-81`

- [ ] **Step 1: Add pagination/streaming to commission getSummary**

```typescript
// OLD:
const commissions = await this.prisma.salesCommission.findMany({
  where: { deletedAt: null, ...filters },
});

// NEW: Use cursor-based batching for the aggregation
const commissions = await this.prisma.salesCommission.findMany({
  where: { deletedAt: null, ...filters },
  take: 10000, // safety cap — if more, use aggregation query
  orderBy: { createdAt: 'desc' },
});
if (commissions.length >= 10000) {
  this.logger.warn('[Commission] getSummary hit 10k cap — consider using groupBy aggregation');
}
```

Better approach for the summary — use Prisma `groupBy` instead of loading all records:

```typescript
const summary = await this.prisma.salesCommission.groupBy({
  by: ['salesUserId'],
  where: { deletedAt: null, ...filters },
  _sum: { amount: true, paid: true },
  _count: true,
});
```

- [ ] **Step 2: Add pagination to bad-debt calculateProvisions**

```typescript
// OLD:
const overduePayments = await this.prisma.payment.findMany({
  where: { status: { in: ['OVERDUE', 'PARTIAL'] }, deletedAt: null, ... },
});

// NEW: Process in batches
const BATCH_SIZE = 5000;
let skip = 0;
let allBuckets = { current: d(0), days30: d(0), days60: d(0), days90: d(0), days180: d(0) };
while (true) {
  const batch = await this.prisma.payment.findMany({
    where: { status: { in: ['OVERDUE', 'PARTIAL'] }, deletedAt: null },
    take: BATCH_SIZE,
    skip,
    orderBy: { dueDate: 'asc' },
  });
  if (batch.length === 0) break;
  // process batch into buckets...
  skip += BATCH_SIZE;
  if (batch.length < BATCH_SIZE) break;
}
```

- [ ] **Step 3: Run type check**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/commission/commission.service.ts \
  apps/api/src/modules/accounting/bad-debt.service.ts
git commit -m "fix: add pagination/groupBy to unbounded commission + bad-debt queries

AUDIT-W: commission getSummary and bad-debt calculateProvisions loaded all records"
```

---

## Task 15: Add QueryBoundary to 9 Pages (WARNINGS)

**Files:**
- Modify: `apps/web/src/pages/POSPage/index.tsx`
- Modify: `apps/web/src/pages/SettingsPage/index.tsx`
- Modify: `apps/web/src/pages/LineOaSettingsPage.tsx`
- Modify: `apps/web/src/pages/LineGreetingPage.tsx`
- Modify: `apps/web/src/pages/BroadcastPage.tsx`
- Modify: `apps/web/src/pages/MdmDashboardPage.tsx`
- Modify: `apps/web/src/pages/RichMenuPage.tsx`
- Modify: `apps/web/src/pages/StickerPrintPage.tsx`
- Modify: `apps/web/src/pages/NotificationsPage/index.tsx`

**Pattern:** Each page needs `<QueryBoundary>` wrapping the data-dependent section. Follow the existing pattern from other pages.

- [ ] **Step 1: Check existing QueryBoundary pattern**

Read one page that already uses QueryBoundary (e.g., `CustomersPage.tsx`) to confirm the import path and usage pattern.

- [ ] **Step 2: Add QueryBoundary to POSPage (highest priority)**

```typescript
import { QueryBoundary } from '@/components/QueryBoundary';

// Wrap the main content that depends on pos-config and top-products queries:
<QueryBoundary queries={[posConfigQuery, topProductsQuery]}>
  {/* existing POS content */}
</QueryBoundary>
```

- [ ] **Step 3: Add QueryBoundary to SettingsPage**

Same pattern — wrap content that depends on the settings query.

- [ ] **Step 4: Add QueryBoundary to remaining 7 pages**

Apply the same pattern to: LineOaSettingsPage, LineGreetingPage, BroadcastPage, MdmDashboardPage, RichMenuPage, StickerPrintPage, NotificationsPage.

- [ ] **Step 5: Run type check**

Run: `./tools/check-types.sh web`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/POSPage/index.tsx \
  apps/web/src/pages/SettingsPage/index.tsx \
  apps/web/src/pages/LineOaSettingsPage.tsx \
  apps/web/src/pages/LineGreetingPage.tsx \
  apps/web/src/pages/BroadcastPage.tsx \
  apps/web/src/pages/MdmDashboardPage.tsx \
  apps/web/src/pages/RichMenuPage.tsx \
  apps/web/src/pages/StickerPrintPage.tsx \
  apps/web/src/pages/NotificationsPage/index.tsx
git commit -m "fix(web): add QueryBoundary to 9 pages — error+retry UI on API failure

AUDIT-W: POSPage, SettingsPage, LineOa, Greeting, Broadcast, MDM, RichMenu,
Sticker, Notifications now show error state instead of blank page"
```

---

## Task 16: Fix RepossessionsPage Hardcoded Colors (WARNING)

**Files:**
- Modify: `apps/web/src/pages/RepossessionsPage.tsx` (~65 replacements)

- [ ] **Step 1: Find-and-replace color tokens**

Systematic replacements:

| Old | New |
|-----|-----|
| `bg-white` | `bg-card` |
| `bg-slate-50` | `bg-muted` |
| `bg-slate-100` | `bg-muted` |
| `bg-slate-900/30` | `bg-background/80` |
| `text-slate-500` | `text-muted-foreground` |
| `text-slate-600` | `text-muted-foreground` |
| `text-slate-700` | `text-foreground` |
| `text-slate-800` | `text-foreground` |
| `text-slate-900` | `text-foreground` |
| `border-slate-200` | `border-border` |
| `border-slate-300` | `border-border` |
| `hover:bg-slate-50` | `hover:bg-accent` |
| `hover:bg-slate-100` | `hover:bg-accent` |
| `divide-slate-200` | `divide-border` |

- [ ] **Step 2: Run type check**

Run: `./tools/check-types.sh web`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/RepossessionsPage.tsx
git commit -m "fix(web): replace 65 hardcoded slate/white colors with design tokens

AUDIT-W: RepossessionsPage now uses bg-card, text-foreground, border-border etc."
```

---

## Task 17: Fix Thai Date Formatting + CardTitle leading-none (WARNINGS)

**Files:**
- Modify: `apps/web/src/components/ui/card.tsx:127`
- Modify: 9 page files with Thai date issues

- [ ] **Step 1: Fix CardTitle leading-none**

```typescript
// OLD (card.tsx line 127):
className={cn('leading-none tracking-tight', className)}

// NEW:
className={cn('leading-snug tracking-tight', className)}
```

- [ ] **Step 2: Fix Thai date formatting in 9 locations**

For each location, replace `toLocaleDateString('th-TH', ...)` or `toLocaleTimeString('th-TH', ...)` with the project's `formatDateMedium` / `formatDateTime` from `@/utils/formatters`.

Example for TodoForm.tsx:59:
```typescript
// OLD:
new Date(dateStr).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })

// NEW:
import { formatDateMedium } from '@/utils/formatters';
formatDateMedium(dateStr)
```

Apply same pattern to:
- `ChatbotFinanceKnowledgePage.tsx:495`
- `ChatbotFinanceLearningPage.tsx:188`
- `FinancialAuditPage.tsx:49`
- `StockAdjustmentsPage.tsx:185`
- `SalesHistoryPage.tsx:283`
- `ChatbotFinanceSessionsPage.tsx:228`
- `PaymentSummary.tsx:112`
- `SystemStatusPage.tsx:112`

- [ ] **Step 3: Run type check**

Run: `./tools/check-types.sh web`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/card.tsx \
  apps/web/src/pages/TodosPage/components/TodoForm.tsx \
  apps/web/src/pages/ChatbotFinanceKnowledgePage.tsx \
  apps/web/src/pages/ChatbotFinanceLearningPage.tsx \
  apps/web/src/pages/FinancialAuditPage.tsx \
  apps/web/src/pages/StockAdjustmentsPage.tsx \
  apps/web/src/pages/SalesHistoryPage.tsx \
  apps/web/src/pages/ChatbotFinanceSessionsPage.tsx \
  apps/web/src/pages/PaymentsPage/components/PaymentSummary.tsx \
  apps/web/src/pages/SystemStatusPage.tsx
git commit -m "fix(web): Thai date formatters + CardTitle leading-snug for Thai diacritics

AUDIT-W: 9 locations using raw toLocaleDateString → project formatters
AUDIT-W: card.tsx leading-none clips Thai สระ/วรรณยุกต์"
```

---

## Task 18: Fix Hardcoded Chart/Dashboard Colors (WARNING + INFO)

**Files:**
- Modify: `apps/web/src/pages/AnalyticsPage.tsx`
- Modify: `apps/web/src/pages/DashboardPage/types.tsx`
- Modify: `apps/web/src/pages/ReportsPage.tsx`
- Modify: `apps/web/src/pages/LandingPage.tsx`

- [ ] **Step 1: Fix AnalyticsPage heatmap colors**

```typescript
// OLD:
const emptyColor = '#f3f4f6';
const colors = ['#3b82f6', '#f59e0b', '#64748b', '#94a3b8'];

// NEW — use CSS variables via getComputedStyle or define chart color constants:
// For Recharts/SVG, CSS vars don't work directly. Use a chart palette constant:
const CHART_COLORS = {
  primary: 'hsl(var(--primary))',
  warning: 'hsl(var(--chart-2))',
  muted: 'hsl(var(--muted-foreground))',
  empty: 'hsl(var(--muted))',
} as const;
```

Note: If the chart library (Recharts) doesn't support CSS variables, use `getComputedStyle(document.documentElement).getPropertyValue('--primary')` to resolve at runtime. If this is too complex, keeping hex for chart-specific colors is acceptable — add a comment explaining why.

- [ ] **Step 2: Fix DashboardPage status color map**

```typescript
// These are status indicator colors — acceptable as hardcoded if used consistently.
// Move to a shared constant file if not already:
// apps/web/src/constants/status-colors.ts
```

- [ ] **Step 3: Fix LandingPage text-gray-300**

```typescript
// OLD:
text-gray-300

// NEW:
text-white/70
```

- [ ] **Step 4: Run type check**

Run: `./tools/check-types.sh web`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/AnalyticsPage.tsx \
  apps/web/src/pages/DashboardPage/types.tsx \
  apps/web/src/pages/ReportsPage.tsx \
  apps/web/src/pages/LandingPage.tsx
git commit -m "fix(web): replace hardcoded hex in charts/dashboard with design tokens where possible

AUDIT-W/I: AnalyticsPage, DashboardPage, ReportsPage, LandingPage color fixes"
```

---

## Task 19: Fix Frontend Type Safety (WARNINGS)

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx`
- Modify: `apps/web/src/hooks/useUnreadChat.ts`
- Modify: `apps/web/src/pages/POSPage/components/ProductSearch.tsx:161`

- [ ] **Step 1: Fix Customer360Panel — replace `any` types**

Define proper interfaces for the data:

```typescript
interface ActiveContract {
  id: string;
  contractNumber: string;
  status: string;
  monthlyPayment: string;
  remainingMonths: number;
}

interface RecentPayment {
  id: string;
  installmentNo: number;
  amountPaid: string;
  paidDate: string;
  status: string;
}

// Replace all (item: any) => with typed callbacks
// e.g., activeContracts.map((c: any) => ...) → activeContracts.map((c: ActiveContract) => ...)
```

Replace all 18+ `any` occurrences with proper types.

- [ ] **Step 2: Fix useUnreadChat**

```typescript
// OLD:
api.get('/staff-chat/unread-count').then((r: any) => r.data)

// NEW:
api.get<{ unread: number }>('/staff-chat/unread-count').then((r) => r.data)
```

- [ ] **Step 3: Fix ProductSearch.tsx non-null assertion**

```typescript
// OLD (line 161):
{parseFloat(p.prices.find((pr) => pr.isDefault)!.amount).toLocaleString()} ฿

// NEW:
{(() => {
  const defaultPrice = p.prices.find((pr) => pr.isDefault);
  return defaultPrice ? parseFloat(defaultPrice.amount).toLocaleString() : '-';
})()} ฿
```

- [ ] **Step 4: Run type check**

Run: `./tools/check-types.sh web`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx \
  apps/web/src/hooks/useUnreadChat.ts \
  apps/web/src/pages/POSPage/components/ProductSearch.tsx
git commit -m "fix(web): replace 20+ any types with proper interfaces + fix non-null assertion

AUDIT-W: Customer360Panel, useUnreadChat, ProductSearch type safety"
```

---

## Task 20: Fix Info-Level Issues (INFO batch)

**Files:**
- Modify: `apps/web/src/pages/StickerPrintPage.tsx` (minor)
- Modify: `apps/web/src/pages/TodosPage/components/TodoKanbanView.tsx` (minor)
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ConversationItem.tsx` (leading-none)
- Modify: `apps/web/src/components/layout/Sidebar.tsx` (leading-none)
- Modify: `apps/web/src/components/layout/MobileBottomNav.tsx` (leading-none)

- [ ] **Step 1: Fix leading-none on badge components**

For each file, replace `leading-none` with `leading-snug` on badge elements that might contain Thai numerals:

- `ConversationItem.tsx:125`: `leading-none` → `leading-snug`
- `Sidebar.tsx:471`: `leading-none` → `leading-snug`
- `MobileBottomNav.tsx:93`: `leading-none` → `leading-snug`

- [ ] **Step 2: Fix TodoKanbanView hardcoded color**

```typescript
// OLD:
bg-slate-400

// NEW:
bg-muted-foreground
```

- [ ] **Step 3: Run type check**

Run: `./tools/check-types.sh web`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/ConversationItem.tsx \
  apps/web/src/components/layout/Sidebar.tsx \
  apps/web/src/components/layout/MobileBottomNav.tsx \
  apps/web/src/pages/TodosPage/components/TodoKanbanView.tsx
git commit -m "fix(web): leading-snug on badges + TodoKanban design token

AUDIT-I: 3 badge components leading-none → leading-snug, 1 hardcoded color"
```

---

## Task 21: Final Verification

- [ ] **Step 1: Run full type check**

Run: `./tools/check-types.sh all`
Expected: 0 errors on both API and Web

- [ ] **Step 2: Run API tests**

Run: `cd apps/api && npx jest --no-coverage`
Expected: All tests PASS

- [ ] **Step 3: Run web tests**

Run: `cd apps/web && npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Quick grep for remaining Number() on Decimal fields**

Run: `grep -rn "Number(.*\.\(amountDue\|amountPaid\|lateFee\|sellingPrice\|downPayment\|monthlyPayment\|creditBalance\|financedAmount\|costPrice\|commission\))" apps/api/src/modules/ --include="*.ts" | grep -v ".spec.ts" | grep -v "node_modules"`

Expected: 0 remaining instances (or only display-only `.toNumber()` calls with comment)

- [ ] **Step 5: Quick grep for remaining parseFloat on financial paths**

Run: `grep -rn "parseFloat" apps/api/src/modules/ --include="*.ts" | grep -v ".spec.ts" | grep -v "node_modules"`

Review: Any remaining `parseFloat` should be in non-financial context only.

- [ ] **Step 6: Commit final state if any cleanup needed**

```bash
git add -A
git commit -m "chore: final audit fix verification — 0 type errors, all tests pass"
```
