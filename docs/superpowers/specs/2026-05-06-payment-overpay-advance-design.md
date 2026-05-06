# Payment Overpay → Advance (21-1103) Design

**Date:** 2026-05-06
**Author:** owner + Claude
**Status:** Design (approved sections 1-3, awaiting written-spec review)
**Related:** Phase A.4 CPA Chart (PR #741), Reschedule JP6 template (existing pattern)

## 1. Problem

When a customer pays more than the installment amount + 1฿ tolerance, the wizard currently blocks save with a misleading message:

> "ห่างเกิน 1 ฿ — ใช้เมนูแบ่งชำระ/ปิดยอดแทน"

Real-world scenario (frequent for cash-paying customers): customer hands over 1,600฿ for an installment of 1,515.83฿ — they want to pay round numbers and have the extra credited toward the next installment.

The CSV chart of accounts already plans for this case (see §3).

## 2. CSV Plan (already in chart)

| Code | Name | Purpose |
|------|------|---------|
| `21-1103` | เงินรับล่วงหน้า-ชำระก่อนครบกำหนด | "เงินที่ลูกค้าชำระล่วงหน้าก่อนถึงงวด **พักรอหักในงวดที่ถึงกำหนด**" |
| `53-1503` | กำไร/ขาดทุนจากการปัดเศษ | Dr ขาด / Cr เกิน — **เฉพาะ ≤1฿ rounding** (existing tolerance, unchanged) |

The plan is explicit: overpay > 1฿ is **not** rounding — it's a legitimate **advance payment** that posts to `21-1103` and gets consumed FIFO when the next installment comes due.

The `reschedule-jp6.template.ts` already implements this exact pattern for reschedule fees:

1. `recordFeeAdvance` — `Dr cash / Cr 21-1103` (park the advance)
2. `consumeAdvanceOnFinalInstallment` — `Dr 21-1103 + Dr cash / Cr 11-2103` (drain when due)

This design extends the same pattern to general overpayments.

## 3. Architecture

```
PAYMENT (overpay):
  Customer pays 1,600 for งวด 2 (ค่างวด 1,515.83)
       ↓
  Wizard detectCase → OVERPAY_ADVANCE (diff = +84.17)
       ↓
  POST /payments/:id { case: 'OVERPAY_ADVANCE', amountReceived: 1600 }
       ↓
  payments.service.recordPayment:
    • Payment[งวด2].amountPaid = 1,515.83 (full installment)
    • Payment[งวด2].status = 'PAID'
    • Contract.advanceBalance += 84.17  ← denorm field (new)
    • JE 2B (extended):
        Dr 11-1101  1,600.00  (cash)
        Cr 11-2101  1,515.83  (HP receivable)
        Cr 21-1103     84.17  (advance — NEW LINE)

NEXT INSTALLMENT (consume):
  Open wizard for งวด 3
       ↓
  Banner shown: "ลูกค้ามีเงินล่วงหน้า 84.17 ฿"
  Suggested amount: 1,515.83 - 84.17 = 1,431.66
       ↓
  Customer pays 1,431.66 → case = NORMAL (with auto-consume)
       ↓
  payments.service.recordPayment:
    • Payment[งวด3].amountPaid = 1,515.83
    • Contract.advanceBalance -= 84.17 → 0
    • JE 2B (extended):
        Dr 11-1101  1,431.66  (cash actually received)
        Dr 21-1103     84.17  (consume advance — NEW LINE)
        Cr 11-2101  1,515.83  (HP receivable cleared)
```

## 4. Components

### 4.1 Schema change

`apps/api/prisma/schema.prisma`:

```prisma
model Contract {
  // ... existing fields ...
  advanceBalance Decimal @default(0) @db.Decimal(12, 2)  // NEW
}
```

Migration: `add_contract_advance_balance` — additive, default 0, safe for existing rows.

### 4.2 Enum

`apps/api/src/modules/payments/dto/payment.dto.ts`:

```typescript
export type PaymentCase =
  | 'NORMAL'
  | 'OVERPAY'           // ≤1฿ rounding — existing
  | 'UNDERPAY'          // ≤1฿ rounding — existing
  | 'PARTIAL'
  | 'EARLY_PAYOFF'
  | 'RESCHEDULE'
  | 'OVERPAY_ADVANCE';  // NEW — overpay > 1฿
```

### 4.3 Service logic — `recordPayment`

`apps/api/src/modules/payments/payments.service.ts`:

```typescript
async recordPayment(paymentId: string, dto: RecordPaymentDto, userId: string) {
  return this.prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { contract: true } });
    const amountDue = new Decimal(payment.amountDue).plus(payment.lateFee).minus(payment.amountPaid);
    const received = new Decimal(dto.amountReceived);
    const advanceBalance = new Decimal(payment.contract.advanceBalance);

    let advanceCredit = ZERO;   // post Cr 21-1103 (overpay → advance)
    let advanceConsume = ZERO;  // post Dr 21-1103 (consume advance)
    let cashAmount = received;

    switch (dto.case) {
      case 'OVERPAY_ADVANCE':
        // Customer paid more than amountDue+1฿ → park excess
        advanceCredit = received.minus(amountDue);
        cashAmount = received;
        // Update Payment: paid full amountDue
        // Update Contract: advanceBalance += advanceCredit
        break;

      case 'NORMAL':
      case 'OVERPAY':
      case 'UNDERPAY':
        // If contract has advance, consume FIFO
        if (advanceBalance.gt(0) && received.lt(amountDue)) {
          const gap = amountDue.minus(received);
          advanceConsume = Decimal.min(advanceBalance, gap);
          // Update Contract: advanceBalance -= advanceConsume
        }
        break;
    }

    // Update Payment row, Contract row
    // Call PaymentReceipt2BTemplate with { advanceCredit, advanceConsume }
  });
}
```

### 4.4 Template extension

`apps/api/src/modules/journal/cpa-templates/payment-receipt-2b.template.ts`:

```typescript
export interface PaymentReceipt2BInput {
  // ... existing fields ...
  advanceCredit?: Decimal;   // Cr 21-1103 (overpay)
  advanceConsume?: Decimal;  // Dr 21-1103 (use existing advance)
}

generate(input): JeLineInput[] {
  const lines = [/* existing logic */];

  if (input.advanceCredit?.gt(0)) {
    lines.push({ accountCode: '21-1103', debit: ZERO, credit: input.advanceCredit, description: 'เงินรับล่วงหน้า' });
  }
  if (input.advanceConsume?.gt(0)) {
    lines.push({ accountCode: '21-1103', debit: input.advanceConsume, credit: ZERO, description: 'หักเงินรับล่วงหน้า' });
  }

  // Edge: when 100% of installment is covered by advance, cashAmount=0 → skip Dr cash line
  // (template's existing cash-line logic must already check `if (cashAmount.gt(0))`)

  return lines;
}
```

### 4.5 Frontend — wizard

`apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx`:

```typescript
type DetectedCase = 'NORMAL' | 'OVERPAY' | 'UNDERPAY' | 'OVERPAY_ADVANCE' | 'OUT_OF_RANGE';

function detectCase(
  received: number,
  expectedTotal: Decimal,
  advanceBalance: Decimal = ZERO,
): DetectedCase {
  if (received <= 0 && advanceBalance.lt(expectedTotal)) return 'OUT_OF_RANGE';

  // effective amount due = full installment minus advance available
  // (advance auto-consumes FIFO, so cashier only collects the difference)
  const effectiveDue = Decimal.max(ZERO, expectedTotal.minus(advanceBalance));
  const diff = received - effectiveDue.toNumber();

  if (received === 0 && advanceBalance.gte(expectedTotal)) return 'NORMAL'; // 100% from advance
  if (Math.abs(diff) < 0.01) return 'NORMAL';
  if (diff > 0 && diff <= 1) return 'OVERPAY';            // rounding
  if (diff < 0 && diff >= -1) return 'UNDERPAY';          // rounding
  if (diff > 1) return 'OVERPAY_ADVANCE';                 // overpay → grow advance
  return 'OUT_OF_RANGE';                                  // diff < -1: still blocked
}
```

`CaseBadge` component — add render branch for `OVERPAY_ADVANCE`:

```tsx
if (detectedCase === 'OVERPAY_ADVANCE') {
  return (
    <div className="rounded-lg border border-info/40 bg-info/5 px-3 py-2">
      <span className="text-info font-medium">
        เกิน {absDiff} ฿ — บันทึกเป็นเงินรับล่วงหน้า (หักงวดถัดไปอัตโนมัติ)
      </span>
    </div>
  );
}
```

Save button — enable for `OVERPAY_ADVANCE`:

```typescript
const submitDisabled =
  detectedCase === 'OUT_OF_RANGE' ||
  /* other existing conditions */;
```

JE preview — append `Cr 21-1103 {advanceCredit}` line when `OVERPAY_ADVANCE`.

### 4.6 Frontend — AdvanceBalanceBanner

New component, shown above amount field when `contract.advanceBalance > 0`:

```tsx
function AdvanceBalanceBanner({ amountDue, advanceBalance, onApply }: Props) {
  const netDue = amountDue.minus(advanceBalance).toFixed(2);
  return (
    <div className="rounded-lg border border-success/40 bg-success/5 p-3">
      <p className="text-sm font-medium">💰 ลูกค้ามีเงินล่วงหน้า {advanceBalance.toFixed(2)} ฿</p>
      <p className="text-xs text-muted-foreground">ค่างวด {amountDue.toFixed(2)} − ล่วงหน้า {advanceBalance.toFixed(2)} = ยอดที่ต้องเก็บ {netDue}</p>
      <button onClick={() => onApply(netDue)} className="text-xs underline mt-1">ใช้ยอดนี้</button>
    </div>
  );
}
```

GET `/contracts/:id` response must include `advanceBalance: string`.

## 5. Allocation strategy

**FIFO** — advance is consumed against the **next earliest unpaid installment** automatically when that installment is recorded. No manual allocation in v1.

Multi-installment overpay: if customer overpays งวด 2 by 2,000฿ (covering งวด 3 entirely + part of งวด 4):
- v1 behavior: parks 2,000฿ in `21-1103`, consumes 1,515.83฿ from advance when งวด 3 recorded, leaves 484.17฿ for งวด 4
- Wizard UX: cashier opens งวด 3 wizard, banner shows "ล่วงหน้า 2,000฿", suggests amountReceived = 0 (or 0.00 — fully covered by advance)
- A purely-from-advance payment is a special edge case — ensure JE balances even when cashAmount = 0

## 6. Edge cases

| Scenario | Behavior |
|---|---|
| Overpay covers entire next installment | Apply 100% from advance; cashAmount=0; Save button still works (no cash needed) |
| Overpay > 1 future installment (e.g., 2 งวด) | Parks total; consumed FIFO across multiple ถัดไป |
| Customer requests refund of advance | Manual journal — `Dr 21-1103 / Cr cash` (manager-approved, out of scope v1) |
| Contract reposses/closes with advance > 0 | Manual handling at closure — flag in repossession flow (out of scope v1) |
| Underpay > 1฿ | Still blocked — owner must use "แบ่งชำระ" flow (unchanged) |

## 7. Acceptance criteria

- [ ] `Contract.advanceBalance` field added via migration
- [ ] PaymentCase enum extended with `OVERPAY_ADVANCE`
- [ ] Wizard accepts overpay > 1฿ (Save button enabled)
- [ ] Posting overpay creates `Cr 21-1103` line in JE
- [ ] `Contract.advanceBalance` increments correctly
- [ ] Next installment wizard shows AdvanceBalanceBanner with current balance
- [ ] Recording next installment auto-consumes FIFO from advance
- [ ] Posted JE balances (Dr = Cr) in all cases
- [ ] `Contract.advanceBalance` decrements to 0 after full consume
- [ ] Underpay > 1฿ still blocked (no regression)
- [ ] All existing payment tests pass
- [ ] 4 new tests: overpay, consume, multi-overpay, full-cover-by-advance

## 8. Out of scope (v1)

- Manual refund of advance balance (cash out)
- Per-installment manual allocation (FIFO is automatic)
- Advance display in customer-facing LIFF
- Reporting (advance balance per contract on contracts list)
- Edge: contract closure with non-zero advance (warn-only banner, manual ops)

## 9. Open questions

None — design follows existing patterns (reschedule-jp6) and CSV intent (`21-1103`).
