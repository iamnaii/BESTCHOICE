# Payment Partial (Underpay > 1฿) Design

**Date:** 2026-05-07
**Author:** owner + Claude
**Status:** Design (sections 1-3 approved, awaiting written-spec review)
**Related:** PR #762 OVERPAY_ADVANCE (mirror pattern), CSV `case-3-split-payment.csv`

## 1. Problem

Payment wizard currently blocks underpay > 1฿ with a misleading message:

> "ห่างเกิน 1 ฿ — ใช้เมนูแบ่งชำระ/ปิดยอดแทน"

**Two issues:**
1. The "เมนูแบ่งชำระ" referenced does not exist anywhere in the UI — it's a dead reference
2. Real-world cashier needs to record partial payments (customer pays 1,500 of 1,515.83 cash, planning to pay the rest later, or split between cash + transfer)

The CSV chart explicitly designs for this case at `case-3-split-payment.csv` — multiple `2B` JE entries per installment, each clearing partial of `11-2103`.

## 2. CSV Plan (already in chart)

Per `case-3-split-payment.csv`:

```
2A (accrual on due date — once per installment):
  Dr 11-2103  1,515.83  (open the receivable)

2B receipt #1 (customer pays 800):
  Dr 11-1101    800.00  (cash)
  Cr 11-2103    800.00  (partial clear) → remaining 715.83

2B receipt #2 (customer pays 715.83):
  Dr 11-1101    715.83
  Cr 11-2103    715.83  (remaining clear)
```

Key insight: `11-2103 ลูกหนี้ค้างชำระ` accumulates partial reductions until 0. **No new account, no new template, no installmentTotal check on 2B receipts.**

This design extends the existing `PaymentReceipt2BTemplate` to skip the tolerance check and post `Cr 11-2103 = amount` (not full installment) when `case='PARTIAL'`.

## 3. Architecture

```
PAYMENT (partial — first receipt):
  Customer pays 800 for งวด 2 (ค่างวด 1,515.83)
       ↓
  Wizard detectCase → PARTIAL (diff = -715.83)
       ↓
  Confirm dialog: "ลูกค้าจ่าย 800 ฿ (ขาด 715.83). บันทึกเป็นจ่ายบางส่วน?"
       ↓
  POST /payments/:id { case: 'PARTIAL', amountReceived: 800 }
       ↓
  payments.service.recordPayment:
    • Payment[งวด2].amountPaid = 800
    • Payment[งวด2].status = 'PARTIALLY_PAID'
    • JE 2B (extended):
        Dr 11-1101  800.00  (cash)
        Cr 11-2103  800.00  (partial clear, NOT installmentTotal)

LIST DISPLAY:
  /payments table row shows: 🟡 ค้าง 715.83 ฿ (chip on row)

NEXT RECEIPT (later — same wizard, same installment):
  Cashier clicks the same row → wizard re-opens งวด 2
  Left panel: ค่างวด 1,515.83 / จ่ายแล้ว 800 / ยอดเหลือ 715.83
  amountReceived pre-filled = 715.83
       ↓
  Customer pays 715.83 → case = NORMAL (within ±1฿ of remaining)
       ↓
  payments.service.recordPayment:
    • Payment[งวด2].amountPaid = 800 + 715.83 = 1,515.83
    • Payment[งวด2].status = 'PAID'
    • JE 2B:
        Dr 11-1101  715.83
        Cr 11-2103  715.83  (remaining clear)
```

**Mixed-method (C-case)** is just two PARTIAL receipts on the same day with different `depositAccountCode` (cash 800 / 11-1101, transfer 715.83 / 11-1201) — no new logic.

## 4. Components

### 4.1 Schema change

**None.** Reuses `Payment.amountPaid` (Decimal, cumulative) + `PaymentStatus` enum (`PAID`, `PARTIALLY_PAID`, `PENDING`, `OVERDUE`).

### 4.2 Enum

**None.** `PaymentCase.PARTIAL` already exists in `apps/api/src/modules/payments/dto/payment.dto.ts`.

### 4.3 Service logic — `recordPayment`

`apps/api/src/modules/payments/payments.service.ts`:

```typescript
async recordPayment(/* existing params */, paymentCase?: PaymentCase) {
  // ... existing setup ...

  const remaining = dRound(dSub(amountDue, prevPaid));
  const overage = d(amount).minus(remaining);
  const shortage = remaining.minus(d(amount));

  // Existing OVERPAY_ADVANCE logic — unchanged
  if (overage.gt(d('1.00'))) { /* require OVERPAY_ADVANCE */ }

  // NEW: shortage > 1฿ requires explicit PARTIAL
  if (shortage.gt(d('1.00')) && paymentCase !== 'PARTIAL') {
    throw new BadRequestException(
      `จำนวนเงินน้อยกว่ายอดที่ต้องชำระ (ยอดที่ต้องชำระ ${remaining}, จ่าย ${amount}) — ` +
      `เลือก case 'PARTIAL' เพื่อบันทึกเป็นจ่ายบางส่วน`,
    );
  }

  // ... advance auto-consume (existing) ...

  const recordedAmountPaid = d(amount).plus(advanceConsume).plus(prevPaid);
  // (no special branch for PARTIAL — amountPaid is just cumulative)

  const isPaidInFull = dGte(recordedAmountPaid, amountDue);
  const status = isPaidInFull ? 'PAID' : 'PARTIALLY_PAID';

  // ... call template with new partialClear flag ...
}
```

### 4.4 Template extension

`apps/api/src/modules/journal/cpa-templates/payment-receipt-2b.template.ts`:

```typescript
export interface PaymentReceiptInput {
  // ... existing fields ...
  /** Skip tolerance check + clear receivable by amount only (not installmentTotal). */
  partialClear?: boolean;
}

// In execute():
if (input.partialClear) {
  // Skip tolerance + skip rounding lines (53-1503/52-1104)
  // Build minimal JE:
  lines.push({
    accountCode: input.depositAccountCode,
    dr: input.amountReceived,
    cr: zero,
    description: 'รับชำระบางส่วน',
  });
  lines.push({
    accountCode: '11-2103',
    dr: zero,
    cr: input.amountReceived, // partial clear = amount, NOT installmentTotal
    description: 'ล้างลูกหนี้ค้างชำระ (บางส่วน)',
  });
  // No advance / VAT / WHT lines — partial is the simplest case
}
```

When `partialClear=true`, advance handling and rounding tolerance both bypassed. The template is intentionally minimal — partial pay = "just record the cash + reduce the receivable by that amount."

### 4.5 `previewJournal` mirror

Mirror the same `partialClear` branch in `previewJournal`:

```typescript
if (input.case === 'PARTIAL') {
  // Skip the existing 2A+2B consolidated / 2B-only logic
  rawLines.push({ code: input.depositAccountCode, dr: amountReceived, cr: zero, description: 'รับชำระบางส่วน' });
  rawLines.push({ code: '11-2103', dr: zero, cr: amountReceived, description: 'ล้างลูกหนี้ค้างชำระ (บางส่วน)' });
  // Skip: late fee, advance, VAT, WHT
  return /* balanced result */;
}
```

### 4.6 Wizard `detectCase`

`apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx`:

```typescript
type DetectedCase = 'NORMAL' | 'OVERPAY' | 'UNDERPAY' | 'OVERPAY_ADVANCE' | 'PARTIAL' | 'OUT_OF_RANGE';

function detectCase(received, expectedTotal, advanceBalance) {
  // ... existing logic ...
  if (diff > 1) return 'OVERPAY_ADVANCE';
  if (diff < -1) return 'PARTIAL';   // ← NEW: was OUT_OF_RANGE
  return 'OUT_OF_RANGE';              // ← only if received <= 0 (zero/negative)
}
```

### 4.7 CaseBadge — PARTIAL render

```tsx
if (detectedCase === 'PARTIAL') {
  return (
    <div className="rounded-lg border border-warning/40 bg-warning/5 ...">
      <AlertCircle className="text-warning" />
      <span className="text-warning font-medium">
        จ่ายขาด {absDiff} ฿ — บันทึกบางส่วน ลูกค้าค้าง {absDiff} ฿ ต่อ
      </span>
    </div>
  );
}
```

### 4.8 Confirm dialog (D-case guard)

When `detectedCase === 'PARTIAL'` and user clicks Save, show modal:

```tsx
<ConfirmDialog
  title="ยืนยันบันทึกบางส่วน"
  body={
    <div>
      <p>ค่างวด: {expectedTotal.toFixed(2)} ฿</p>
      <p>ลูกค้าจ่าย: {received.toFixed(2)} ฿</p>
      <p className="font-bold">ค้าง: {absDiff.toFixed(2)} ฿</p>
      <p className="text-xs text-muted-foreground mt-2">
        ลูกค้าจะค้างยอดนี้ จนกว่าจะจ่ายเพิ่ม
      </p>
    </div>
  }
  cancelLabel="ยกเลิก"
  confirmLabel="ยืนยันบันทึก"
  onConfirm={() => actuallySubmit()}
/>
```

Reuse the existing `ConfirmDialog` component from `apps/web/src/components/`.

### 4.9 Wizard left panel — paid breakdown

Add when `payment.amountPaid > 0`:

```tsx
<div className="space-y-1 text-sm">
  <Row label="ค่างวด" value={amountDue.toFixed(2)} />
  {amountPaid.gt(0) && (
    <Row label="จ่ายแล้ว" value={amountPaid.toFixed(2)} className="text-muted-foreground" />
  )}
  <hr />
  <Row
    label="ยอดเหลือ"
    value={remaining.toFixed(2)}
    className={remaining.gt(0) ? "text-warning font-bold text-lg" : "text-success font-bold"}
  />
</div>
```

### 4.10 amountReceived pre-fill

When opening wizard for `payment.status === 'PARTIALLY_PAID'`:

```typescript
// instead of `defaultAmount = amountDue + lateFee - amountPaid`
// it's already correct — just verify behavior:
const defaultAmount = amountDueDecimal.add(lateFeeDecimal).sub(amountPaidDecimal);
// = (1515.83 + 0) - 800 = 715.83 ✓
```

The existing pre-fill formula already handles this correctly because `amountPaid` is cumulative. **No code change needed for pre-fill.**

### 4.11 /payments list row — outstanding chip

`apps/web/src/pages/PaymentsPage/components/PendingTab.tsx` (or list table):

When `payment.status === 'PARTIALLY_PAID'`, replace the small badge with a prominent chip:

```tsx
{payment.status === 'PARTIALLY_PAID' && (
  <Chip variant="warning" size="lg">
    🟡 ค้าง {(amountDue - amountPaid).toFixed(2)} ฿
  </Chip>
)}
```

## 5. Re-payment flow (multi-day partial)

1. Customer pays 800 today → wizard records PARTIAL → `Payment.status = PARTIALLY_PAID`, `amountPaid = 800`
2. Cashier sees row in list with chip "ค้าง 715.83 ฿"
3. Days/weeks later, customer comes back with 715.83
4. Cashier clicks the same row → wizard re-opens
5. Left panel auto-shows "ยอดเหลือ 715.83 ฿"
6. `amountReceived` pre-filled = 715.83 (existing formula)
7. Cashier confirms → `case='NORMAL'` (within ±1฿ tolerance)
8. JE: `Dr cash 715.83 / Cr 11-2103 715.83` → `status = PAID`

**Mixed-method (C-case)** = step 1 with cash, step 4-7 with transfer on the same day. Just two PARTIAL receipts, different `depositAccountCode`.

## 6. Edge cases

| Scenario | Behavior |
|---|---|
| Customer overpays the remainder (e.g. pays 720 of 715.83) | Existing rounding tolerance handles ±1฿. > 1฿ would be OVERPAY_ADVANCE on the remainder. |
| Customer pays into already-PAID installment | Service rejects (`status === 'PAID'` guard exists) |
| Late fee on partial-paid installment | LateFee accrues normally based on dueDate. When PARTIAL receipt happens after dueDate, lateFee included in `remaining` calc. Customer must clear lateFee + remaining principal — existing pattern. |
| Repeated partial (3+ receipts) | All accumulate in `amountPaid`. Each is a fresh JE 2B receipt. |
| User cancels confirm dialog | Wizard stays open, no save. |
| Underpay > 1฿ but `paymentCase !== 'PARTIAL'` | Service rejects with explicit error (mirror OVERPAY_ADVANCE pattern). |

## 7. Acceptance criteria

- [ ] Wizard accepts underpay > 1฿ when user confirms (case='PARTIAL')
- [ ] Confirm dialog appears before save with breakdown
- [ ] JE posts `Dr cash X / Cr 11-2103 X` (no full installmentTotal clear, no rounding lines)
- [ ] `Payment.amountPaid` accumulates across receipts
- [ ] `Payment.status = PARTIALLY_PAID` after first receipt, `PAID` after total reaches `amountDue`
- [ ] Re-opening wizard for PARTIALLY_PAID installment shows "ยอดเหลือ" + pre-fills `remaining`
- [ ] /payments list row shows "ค้าง XXX ฿" chip on PARTIALLY_PAID rows
- [ ] previewJournal mirrors PARTIAL JE
- [ ] Existing tests pass (no regression)
- [ ] 4 new tests: partial receipt, re-pay, multi-receipt, overpay-on-remainder

## 8. Out of scope (post-MVP)

- Per-receipt history view (audit trail of all 2B receipts on one installment) — exists implicitly via JournalEntry but no dedicated UI
- Customer-facing partial-pay reminder (LIFF push notification when PARTIALLY_PAID)
- Auto-reminder cron for stale PARTIAL (e.g., 7 days unpaid → call cron)
- Reports column "outstanding partial" on contracts list

## 9. Open questions

None — design follows existing CSV pattern (case-3) and mirrors the OVERPAY_ADVANCE PR #762 pattern.
