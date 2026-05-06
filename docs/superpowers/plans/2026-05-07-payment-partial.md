# Payment Partial (Underpay > 1฿) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend wizard + backend to handle underpay > 1฿ as `case='PARTIAL'`. Cashier confirms via dialog → `Payment.amountPaid` accumulates → status `PARTIALLY_PAID` until total reaches `amountDue`. Re-payment uses the same wizard re-opening; list row shows "ค้าง XXX ฿" chip.

**Architecture:** Mirror PR #762 OVERPAY_ADVANCE pattern. Add `partialClear?: boolean` flag to `PaymentReceipt2BTemplate`; when set, skip tolerance + emit only `Dr cash X / Cr 11-2103 X` (per CSV `case-3-split-payment.csv`). Service detects shortage > 1฿ + requires `paymentCase='PARTIAL'`. No schema change, no enum change.

**Tech Stack:** NestJS + Prisma (api), React 18 + TypeScript + Decimal.js (web)

---

## File Inventory

### Backend
- **Modify** `apps/api/src/modules/journal/cpa-templates/payment-receipt-2b.template.ts` — add `partialClear?: boolean` input, when set → skip tolerance check + emit minimal partial JE
- **Modify** `apps/api/src/modules/payments/payments.service.ts` — `recordPayment` shortage check + pass `partialClear` to template; `previewJournal` PARTIAL branch
- **Test** `apps/api/src/modules/journal/cpa-templates/payment-receipt-2b.template.spec.ts` — append 1 new test (partial clear)
- **Test** `apps/api/src/modules/payments/payments.service.advance.spec.ts` — append 3 new tests (partial / re-pay / multi-receipt)

### Frontend
- **Modify** `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` — extend `DetectedCase`, `detectCase()`, `CaseBadge`; add ConfirmDialog gate before submit
- **Modify** `apps/web/src/pages/PaymentsPage/components/PaymentTable.tsx` — replace small status badge with prominent "ค้าง XXX ฿" chip when status=PARTIALLY_PAID

---

## Phases

1. **Backend — template** (T1)
2. **Backend — service + preview** (T2)
3. **Frontend — wizard + dialog** (T3)
4. **Frontend — list chip** (T4)
5. **Verification** (T5)

---

## Phase 1: Backend template

### Task 1: Extend `PaymentReceipt2BTemplate` with `partialClear` flag (TDD)

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/payment-receipt-2b.template.ts`
- Test: `apps/api/src/modules/journal/cpa-templates/payment-receipt-2b.template.spec.ts`

- [ ] **Step 1.1: Add input field**

In `payment-receipt-2b.template.ts`, extend `PaymentReceiptInput`:

```typescript
export interface PaymentReceiptInput {
  installmentScheduleId: string;
  amountReceived: Decimal;
  depositAccountCode: string;
  toleranceApproverId?: string;
  existingPaymentId?: string;
  advanceCredit?: Decimal;
  advanceConsume?: Decimal;
  /**
   * Customer pays less than the full installment intentionally.
   * Skip tolerance check; emit only Dr cash X / Cr 11-2103 X (partial clear).
   * Per CSV case-3-split-payment.csv pattern.
   */
  partialClear?: boolean;
}
```

- [ ] **Step 1.2: Write failing test**

Append to `payment-receipt-2b.template.spec.ts` inside the existing describe block (just before the closing brace):

```typescript
  describe('partial clear', () => {
    it('partial: posts only Dr cash + Cr 11-2103 (amount), no tolerance check', async () => {
      // installmentTotal = 1515.83, customer pays 800
      const result = await template.execute({
        installmentScheduleId: inst.id,
        amountReceived: new Decimal('800'),
        depositAccountCode: '11-1101',
        partialClear: true,
      });
      const je = await prisma.journalEntry.findUnique({
        where: { entryNumber: result.entryNo },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      expect(je!.lines).toHaveLength(2);
      const cash = je!.lines.find((l) => l.accountCode === '11-1101')!;
      expect(cash.debit.toString()).toBe('800');
      expect(cash.credit.toString()).toBe('0');
      const recv = je!.lines.find((l) => l.accountCode === '11-2103')!;
      expect(recv.debit.toString()).toBe('0');
      expect(recv.credit.toString()).toBe('800'); // partial — NOT installmentTotal
      // No 53-1503 / 52-1104 lines
      expect(je!.lines.find((l) => l.accountCode === '53-1503')).toBeUndefined();
      expect(je!.lines.find((l) => l.accountCode === '52-1104')).toBeUndefined();
      // Balanced
      const totalDr = je!.lines.reduce((s, l) => s.plus(l.debit), new Decimal(0));
      const totalCr = je!.lines.reduce((s, l) => s.plus(l.credit), new Decimal(0));
      expect(totalDr.eq(totalCr)).toBe(true);
    });
  });
```

- [ ] **Step 1.3: Run failing test**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && DATABASE_URL=postgresql://localhost:5432/bestchoice_oi_test npx vitest run src/modules/journal/cpa-templates/payment-receipt-2b.template.spec.ts -t "partial"
```

Expected: FAIL — `partialClear` field unknown OR template throws tolerance error.

- [ ] **Step 1.4: Implement partial branch in `execute()`**

In `payment-receipt-2b.template.ts`, find the start of the line-building block (after the rounding diff check, around the `lines: { ... }[] = []` declaration). Add a partialClear branch BEFORE the existing logic:

```typescript
      const lines: {
        accountCode: string;
        dr: Decimal;
        cr: Decimal;
        description?: string;
      }[] = [];

      // Partial clear: skip tolerance + advance + rounding logic.
      // Emit only Dr cash + Cr 11-2103 (per CSV case-3 pattern).
      if (input.partialClear) {
        lines.push({
          accountCode: input.depositAccountCode,
          dr: input.amountReceived,
          cr: zero,
          description: 'รับชำระบางส่วน',
        });
        lines.push({
          accountCode: '11-2103',
          dr: zero,
          cr: input.amountReceived, // partial — NOT installmentTotal
          description: 'ล้างลูกหนี้ค้างชำระ (บางส่วน)',
        });
      } else {
        // ... existing 6-step logic (cash, advance consume, underpay, clear, advance credit, overpay) ...
      }
```

Wrap the existing 6-step line-building (cash/advConsume/underpayRounding/clearReceivable/advCredit/overpayRounding) inside the `else` branch.

Also wrap the **tolerance check** (`if (roundingDiff.abs().gt(TOLERANCE))`) and **underpay-requires-approver check** in a `if (!input.partialClear)` guard so they don't fire on partial:

```typescript
    const advCredit = input.advanceCredit ?? new Decimal(0);
    const advConsume = input.advanceConsume ?? new Decimal(0);

    if (!input.partialClear) {
      const roundingDiff = input.amountReceived
        .plus(advConsume)
        .minus(installmentTotal)
        .minus(advCredit);

      if (roundingDiff.abs().gt(TOLERANCE)) {
        throw new BadRequestException(
          `Payment difference ${roundingDiff.abs().toFixed(2)} exceeds tolerance 1.00`,
        );
      }

      if (roundingDiff.lt(0) && !input.toleranceApproverId) {
        throw new BadRequestException(
          'Underpay tolerance requires approver (toleranceApproverId)',
        );
      }
    }
```

For the `roundingDiff` variable used later inside the line-builder (in the `else` branch), keep it scoped or recompute inside the branch. Simplest: declare `roundingDiff` outside the `if`, default to `new Decimal(0)` when partial:

```typescript
    let roundingDiff = new Decimal(0);
    if (!input.partialClear) {
      roundingDiff = input.amountReceived
        .plus(advConsume)
        .minus(installmentTotal)
        .minus(advCredit);
      // ... validation as above ...
    }
```

- [ ] **Step 1.5: Run test to pass**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && DATABASE_URL=postgresql://localhost:5432/bestchoice_oi_test npx vitest run src/modules/journal/cpa-templates/payment-receipt-2b.template.spec.ts
```

Expected: 10/10 pass (9 existing + 1 new partial).

- [ ] **Step 1.6: TS check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api
```

Expected: 0 errors.

- [ ] **Step 1.7: Commit**

```bash
git add apps/api/src/modules/journal/cpa-templates/
git commit -m "$(cat <<'EOF'
feat(payments): extend 2B template with partialClear flag

- Cr 11-2103 = amount (partial clear, NOT installmentTotal)
- Skip tolerance + underpay-approver checks when partialClear=true
- No advance / VAT / WHT / rounding lines on partial path
- Mirrors CSV case-3-split-payment pattern (multi-receipt per installment)
- 1 new TDD test covers partial clear

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: Backend service + preview

### Task 2: `recordPayment` shortage check + `previewJournal` PARTIAL branch (TDD)

**Files:**
- Modify: `apps/api/src/modules/payments/payments.service.ts`
- Test: `apps/api/src/modules/payments/payments.service.advance.spec.ts`

- [ ] **Step 2.1: Add shortage check to `recordPayment`**

In `payments.service.ts:107` (`recordPayment`), find the existing OVERPAY_ADVANCE block (around line 224-260, the `if (overage.gt(d('1.00')))` block). Add the mirror shortage block right after it:

```typescript
      const overage = d(amount).minus(remaining);
      let advanceCredit = d(0);
      let advanceConsume = d(0);
      const beforeAdvance = d(contract.advanceBalance ?? 0);
      let isPartialClear = false;

      if (overage.gt(d('1.00'))) {
        if (paymentCase !== 'OVERPAY_ADVANCE') {
          throw new BadRequestException(
            `จำนวนเงินเกินยอดค้างชำระ (ยอดค้าง ${remaining.toNumber().toLocaleString()} บาท, ชำระ ${amount.toLocaleString()} บาท) — ต้องเลือก case 'OVERPAY_ADVANCE' เพื่อบันทึกส่วนเกินเป็นเงินรับล่วงหน้า`,
          );
        }
        advanceCredit = overage;
      } else if (
        d(amount).lt(remaining) &&
        beforeAdvance.gt(0) &&
        (paymentCase === undefined || paymentCase === 'NORMAL')
      ) {
        const gap = remaining.minus(d(amount));
        advanceConsume = Prisma.Decimal.min(beforeAdvance, gap);
      }

      // NEW: shortage > 1฿ requires explicit PARTIAL flag
      const shortage = remaining.minus(d(amount)).minus(advanceConsume);
      if (shortage.gt(d('1.00'))) {
        if (paymentCase !== 'PARTIAL') {
          throw new BadRequestException(
            `จำนวนเงินน้อยกว่ายอดที่ต้องชำระ (ยอดที่ต้องชำระ ${remaining.toNumber().toLocaleString()} บาท, ชำระ ${amount.toLocaleString()} บาท) — เลือก case 'PARTIAL' เพื่อบันทึกเป็นจ่ายบางส่วน`,
          );
        }
        isPartialClear = true;
      }
```

- [ ] **Step 2.2: Update `recordedAmountPaid` + status**

Find the existing block:
```typescript
      const recordedAmountPaid =
        paymentCase === 'OVERPAY_ADVANCE' ? remaining : dAdd(prevPaid, amount).plus(advanceConsume);

      const isPaidInFull =
        paymentCase === 'OVERPAY_ADVANCE' ? true : dGte(recordedAmountPaid, amountDue);
```

No change needed — `dGte(recordedAmountPaid, amountDue)` already returns `false` for partial (where `prevPaid + amount + 0 < amountDue`), and the existing `status: isPaidInFull ? 'PAID' : 'PARTIALLY_PAID'` handles it correctly.

- [ ] **Step 2.3: Pass `partialClear` to template**

Find the existing `paymentReceipt2BTemplate.execute({...})` call. Add `partialClear`:

```typescript
          await this.paymentReceipt2BTemplate.execute({
            installmentScheduleId: instSched.id,
            amountReceived: new Prisma.Decimal(amount.toString()),
            depositAccountCode: resolvedDepositAccountCode,
            toleranceApproverId: toleranceApproverId,
            existingPaymentId: result.id,
            advanceCredit: advanceCredit.gt(0) ? advanceCredit : undefined,
            advanceConsume: advanceConsume.gt(0) ? advanceConsume : undefined,
            partialClear: isPartialClear ? true : undefined,
          });
```

- [ ] **Step 2.4: Add PARTIAL branch to `previewJournal`**

In `previewJournal` (around line 1442), find the "Normal / Overpay / Underpay / Partial / EarlyPayoff" branch (around line 1551). At the top of that branch (right after the existing RESCHEDULE early-return), add:

```typescript
    // ── PARTIAL case: minimal partial-clear preview ─────────────────────────
    if (input.case === 'PARTIAL') {
      const amountReceived = new Prisma.Decimal(input.amountReceived.toString());
      rawLines.push({ code: input.depositAccountCode, dr: amountReceived, cr: zero, description: 'รับชำระบางส่วน' });
      rawLines.push({ code: '11-2103', dr: zero, cr: amountReceived, description: 'ล้างลูกหนี้ค้างชำระ (บางส่วน)' });

      // Resolve names + return balanced
      const codes = [...new Set(rawLines.map((l) => l.code))];
      const coaRows = await this.prisma.chartOfAccount.findMany({
        where: { code: { in: codes } },
        select: { code: true, name: true },
      });
      const nameMap = new Map(coaRows.map((r) => [r.code, r.name]));
      let totalDebit = zero;
      let totalCredit = zero;
      for (const l of rawLines) {
        totalDebit = totalDebit.plus(l.dr);
        totalCredit = totalCredit.plus(l.cr);
      }
      return {
        lines: rawLines.map((l) => ({
          accountCode: l.code,
          accountName: nameMap.get(l.code) ?? l.code,
          debit: l.dr.toFixed(2),
          credit: l.cr.toFixed(2),
          description: l.description,
        })),
        totalDebit: totalDebit.toFixed(2),
        totalCredit: totalCredit.toFixed(2),
        isBalanced: totalDebit.toFixed(2) === totalCredit.toFixed(2),
      };
    }

    // ── Normal / Overpay / Underpay / EarlyPayoff (existing logic continues) ─
```

- [ ] **Step 2.5: Write failing service tests**

Append to `apps/api/src/modules/payments/payments.service.advance.spec.ts` inside the existing describe block:

```typescript
  describe('PARTIAL case', () => {
    it('partial 800 of 1000 → status PARTIALLY_PAID, amountPaid=800', async () => {
      // Use existing buildMockPrisma + service from outer setup
      // Seed payment row with amountDue=1000, amountPaid=0, lateFee=0
      mockPrismaInst.payment.findFirst.mockResolvedValueOnce({
        id: 'p-partial-1', contractId: 'c-1', installmentNo: 1,
        amountDue: new Decimal(1000), amountPaid: new Decimal(0), lateFee: new Decimal(0),
        status: 'PENDING', dueDate: new Date(), notes: '',
      });

      const updated = { id: 'p-partial-1', status: 'PARTIALLY_PAID', amountPaid: new Decimal(800) };
      mockPrismaInst.payment.update.mockResolvedValueOnce(updated);

      const result = await service.recordPayment(
        'c-1', 1, 800, 'CASH', 'u-1',
        undefined, undefined, 'TEST-P1', '11-1101', undefined,
        'PARTIAL',
      );

      expect(mockPrismaInst.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amountPaid: expect.any(Object), // Decimal(800)
            status: 'PARTIALLY_PAID',
          }),
        }),
      );
      // partialClear should be passed to template
      expect(receipt2BExecute).toHaveBeenCalledWith(expect.objectContaining({ partialClear: true }));
    });

    it('rejects shortage > 1฿ when paymentCase !== PARTIAL', async () => {
      mockPrismaInst.payment.findFirst.mockResolvedValueOnce({
        id: 'p-partial-2', contractId: 'c-1', installmentNo: 2,
        amountDue: new Decimal(1000), amountPaid: new Decimal(0), lateFee: new Decimal(0),
        status: 'PENDING', dueDate: new Date(), notes: '',
      });

      await expect(
        service.recordPayment('c-1', 2, 800, 'CASH', 'u-1', undefined, undefined, 'TEST-P2', '11-1101'),
      ).rejects.toThrow(/PARTIAL/);
    });

    it('re-pay remainder after partial → status PAID', async () => {
      // Simulate prevPaid=800, customer now pays 200 (full clear)
      mockPrismaInst.payment.findFirst.mockResolvedValueOnce({
        id: 'p-partial-3', contractId: 'c-1', installmentNo: 3,
        amountDue: new Decimal(1000), amountPaid: new Decimal(800), lateFee: new Decimal(0),
        status: 'PARTIALLY_PAID', dueDate: new Date(), notes: '',
      });

      const updated = { id: 'p-partial-3', status: 'PAID', amountPaid: new Decimal(1000) };
      mockPrismaInst.payment.update.mockResolvedValueOnce(updated);

      await service.recordPayment(
        'c-1', 3, 200, 'CASH', 'u-1',
        undefined, undefined, 'TEST-P3', '11-1101',
      );

      expect(mockPrismaInst.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amountPaid: expect.any(Object), // Decimal(1000) cumulative
            status: 'PAID',
          }),
        }),
      );
      // No partialClear — case is undefined and shortage <= 1
      expect(receipt2BExecute).toHaveBeenCalledWith(expect.not.objectContaining({ partialClear: true }));
    });
  });
```

- [ ] **Step 2.6: Run failing tests**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest src/modules/payments/payments.service.advance.spec.ts
```

Expected: tests fail until Steps 2.1-2.3 land.

- [ ] **Step 2.7: Iterate to green**

Common adjustments:
- If `mockPrismaInst.payment.findFirst` not aware of new test, copy existing test's mock setup pattern
- If `receipt2BExecute` doesn't capture `partialClear`, verify Step 2.3 call signature

- [ ] **Step 2.8: TS check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api
```

- [ ] **Step 2.9: Commit**

```bash
git add apps/api/src/modules/payments/
git commit -m "$(cat <<'EOF'
feat(payments): recordPayment supports PARTIAL + previewJournal mirror

- shortage > 1฿ requires explicit case='PARTIAL' (mirror OVERPAY_ADVANCE)
- recordedAmountPaid accumulates; status='PARTIALLY_PAID' until full
- partialClear flag passed to 2B template (skip tolerance, partial JE)
- previewJournal PARTIAL branch shows Dr cash / Cr 11-2103 = amount
- 3 new mocked-Prisma tests cover partial / reject / re-pay-to-PAID

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: Frontend wizard + dialog

### Task 3: Wizard `detectCase` + PARTIAL badge + ConfirmDialog

**Files:**
- Modify: `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx`

- [ ] **Step 3.1: Extend `DetectedCase`**

Around line 42, change:
```typescript
type DetectedCase = 'NORMAL' | 'OVERPAY' | 'UNDERPAY' | 'OVERPAY_ADVANCE' | 'PARTIAL' | 'OUT_OF_RANGE';
```

- [ ] **Step 3.2: Update `detectCase` function**

Find `function detectCase(received, expectedTotal, advanceBalance)` (around line 347). Replace the `diff < -1` branch:

```typescript
  if (diff > 0 && diff <= 1) return 'OVERPAY';
  if (diff < 0 && diff >= -1) return 'UNDERPAY';
  if (diff > 1) return 'OVERPAY_ADVANCE';
  if (diff < -1) return 'PARTIAL';   // ← NEW: was OUT_OF_RANGE
  return 'OUT_OF_RANGE';              // only when received <= 0
```

- [ ] **Step 3.3: Update `toApiCase`**

Add the new branch:
```typescript
function toApiCase(detected: DetectedCase): PaymentCase {
  if (detected === 'OVERPAY') return 'OVERPAY';
  if (detected === 'UNDERPAY') return 'UNDERPAY';
  if (detected === 'OVERPAY_ADVANCE') return 'OVERPAY_ADVANCE';
  if (detected === 'PARTIAL') return 'PARTIAL';
  return 'NORMAL';
}
```

- [ ] **Step 3.4: Add CaseBadge branch**

In `CaseBadge` component (around line 145), add before the existing `OUT_OF_RANGE` branch:

```tsx
  if (detectedCase === 'PARTIAL') {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm">
        <AlertCircle className="size-4 text-warning shrink-0" />
        <span className="text-warning font-medium leading-snug">
          จ่ายขาด {absDiff} ฿ — บันทึกบางส่วน ลูกค้าค้าง {absDiff} ฿ ต่อ
        </span>
      </div>
    );
  }
```

- [ ] **Step 3.5: Allow Save when PARTIAL**

Find `canSubmit()` (around line 555). The condition `if (detectedCase === 'OUT_OF_RANGE') return false;` already allows PARTIAL. Verify by reading the function — no change needed if only OUT_OF_RANGE is blocked. If a different allow-list pattern is found, add `&& detectedCase !== 'PARTIAL'` to allow PARTIAL.

- [ ] **Step 3.6: Add ConfirmDialog state + import**

At the top of RecordPaymentWizard.tsx, add:

```typescript
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
```

In the component body (around the other useState calls, ~line 408):

```typescript
  const [showPartialConfirm, setShowPartialConfirm] = useState(false);
```

- [ ] **Step 3.7: Gate submit on PARTIAL**

Find the `handleSubmit` / submit mutation logic (search for `mutate(` or `onSubmit`). Wrap the submit call:

```typescript
  const handleSubmitClick = () => {
    if (detectedCase === 'PARTIAL') {
      setShowPartialConfirm(true);
    } else {
      actuallySubmit();
    }
  };

  const actuallySubmit = () => {
    setShowPartialConfirm(false);
    // ... existing submit logic (mutation.mutate(...) or similar)
  };
```

Replace the Save button's `onClick` with `handleSubmitClick`.

- [ ] **Step 3.8: Render the ConfirmDialog**

Near the bottom of the JSX (just before the closing element), add:

```tsx
      <ConfirmDialog
        open={showPartialConfirm}
        onOpenChange={setShowPartialConfirm}
        title="ยืนยันบันทึกบางส่วน"
        description={`ค่างวด ${expectedTotal.toFixed(2)} ฿\nลูกค้าจ่าย ${parseFloat(amountReceived).toFixed(2)} ฿\nค้าง ${Math.abs(amountDiff).toFixed(2)} ฿\n\nลูกค้าจะค้างยอดนี้ จนกว่าจะจ่ายเพิ่ม`}
        confirmLabel="ยืนยันบันทึก"
        cancelLabel="ยกเลิก"
        onConfirm={actuallySubmit}
      />
```

(If the existing `ConfirmDialog` doesn't render `\n` correctly, replace `description` with a custom `<DialogDescription>` block; or use the existing pattern from `MdmDeviceWidget.tsx` where the dialog renders multi-line by passing JSX.)

- [ ] **Step 3.9: Add paid breakdown to left panel**

Find the left panel block (around line 600-640, look for "ค่างวด" labels). Add a "จ่ายแล้ว" / "ยอดเหลือ" group when `amountPaidDecimal.gt(0)`:

```tsx
{amountPaidDecimal.gt(0) && (
  <>
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">จ่ายแล้ว</span>
      <span className="text-muted-foreground font-mono">{amountPaidDecimal.toFixed(2)} ฿</span>
    </div>
    <hr className="border-border my-1" />
    <div className="flex justify-between">
      <span className="text-warning font-bold">ยอดเหลือ</span>
      <span className="text-warning font-bold font-mono text-lg">
        {amountDueDecimal.add(currentLateFee).sub(amountPaidDecimal).toFixed(2)} ฿
      </span>
    </div>
  </>
)}
```

(Match exact tailwind classes used by adjacent rows.)

- [ ] **Step 3.10: TS check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web
```

- [ ] **Step 3.11: Commit**

```bash
git add apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx
git commit -m "$(cat <<'EOF'
feat(payments/web): wizard supports PARTIAL with confirm dialog

- detectCase: diff < -1 → PARTIAL (was OUT_OF_RANGE)
- CaseBadge yellow 'จ่ายขาด N ฿ — บันทึกบางส่วน'
- ConfirmDialog gates save on PARTIAL with breakdown display
- Left panel shows 'จ่ายแล้ว' / 'ยอดเหลือ' when amountPaid > 0
- Pre-fill formula already correct (amountDue + lateFee - amountPaid)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4: List row chip

### Task 4: Replace status badge with prominent "ค้าง" chip on PARTIALLY_PAID rows

**Files:**
- Modify: `apps/web/src/pages/PaymentsPage/components/PaymentTable.tsx`

- [ ] **Step 4.1: Update status column render**

In `PaymentTable.tsx`, find the `status` column render (around line 89-95). Replace:

```tsx
      {
        key: 'status',
        label: 'สถานะ',
        render: (p: PendingPayment) => {
          if (p.status === 'PARTIALLY_PAID') {
            const owed = (parseFloat(p.amountDue) + parseFloat(p.lateFee)) - parseFloat(p.amountPaid);
            return (
              <Badge variant="warning" appearance="solid" size="md">
                ค้าง {owed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿
              </Badge>
            );
          }
          const cfg = getStatusBadgeProps(p.status, paymentStatusMap);
          return <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">{cfg.label}</Badge>;
        },
      },
```

- [ ] **Step 4.2: TS check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web
```

If `Badge variant="warning"` doesn't exist, check available variants in the Badge component and use the closest "warning" tone (e.g., `variant="default"` with custom className, or `variant="warning"` if defined).

- [ ] **Step 4.3: Commit**

```bash
git add apps/web/src/pages/PaymentsPage/components/PaymentTable.tsx
git commit -m "$(cat <<'EOF'
feat(payments/web): prominent 'ค้าง XXX ฿' chip on PARTIALLY_PAID rows

- Replaces small status badge with size-md warning chip
- Cashier can scan outstanding amount without opening wizard
- Other statuses (PENDING/OVERDUE/PAID) unchanged

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5: Verification

### Task 5: Final TS + manual smoke + PR prep

- [ ] **Step 5.1: Full TS check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh all
```

Expected: 0 errors.

- [ ] **Step 5.2: Run all OI + payment tests**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest src/modules/payments/__tests__/ src/modules/payments/payments.service.advance.spec.ts 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 5.3: Lint**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && npm run lint 2>&1 | tail -20 || true
```

Note any NEW errors introduced by this branch (the previous `prefer-const` fixed; we should not regress on warnings).

- [ ] **Step 5.4: Manual smoke (owner runs)**

1. Login as `admin@bestchoice.com` / `admin1234`
2. Open contract → /payments → pick installment with full balance owing
3. Type `800` for installment of `1,515.83` (or whatever the actual installment is) — verify:
   - Yellow PARTIAL badge appears
   - Save → confirm dialog shows breakdown
   - Confirm → success
   - Contract page shows `amountPaid = 800`, `status = PARTIALLY_PAID`
4. Back at /payments list → verify row shows `ค้าง 715.83 ฿` chip
5. Click that row again → wizard opens with:
   - Left panel: ค่างวด 1,515.83 / จ่ายแล้ว 800 / ยอดเหลือ 715.83
   - amountReceived pre-fill = 715.83
6. Type 715.83 → no badge (NORMAL) → Save → success → status PAID

- [ ] **Step 5.5: Push + PR (await owner instruction)**

```bash
git push -u origin feat/payment-partial
gh pr create --title "feat(payments): underpay > 1฿ → PARTIAL (multi-receipt per installment)" --body "$(cat <<'EOF'
## Summary
- Wizard accepts underpay > 1฿ (no longer blocked with dead 'เมนูแบ่งชำระ' reference)
- Customer can pay partial amount; remaining accumulates in same installment row
- Per CSV case-3-split-payment.csv pattern (multiple 2B JE per installment)
- ConfirmDialog gate prevents typo accidents

## Spec + Plan
- Spec: \`docs/superpowers/specs/2026-05-07-payment-partial-design.md\`
- Plan: \`docs/superpowers/plans/2026-05-07-payment-partial.md\`

## Schema
- None (reuses Payment.amountPaid + status enum existing)

## Backend
- \`PaymentReceipt2BTemplate.partialClear?: boolean\` flag
- \`recordPayment\` shortage > 1฿ requires explicit \`case='PARTIAL'\`
- \`previewJournal\` PARTIAL branch
- 1 template test + 3 service tests

## Frontend
- Wizard \`detectCase\` returns PARTIAL for diff < -1 (was OUT_OF_RANGE)
- New yellow PARTIAL badge + ConfirmDialog gate before save
- Left panel shows 'จ่ายแล้ว / ยอดเหลือ' when amountPaid > 0
- /payments list shows 'ค้าง XXX ฿' chip on PARTIALLY_PAID rows
- Pre-fill formula unchanged (already returns remaining)

## Test plan
- [ ] Type 800 for 1,515.83 installment → PARTIAL badge → Save → confirm dialog → submit → status=PARTIALLY_PAID
- [ ] List shows 'ค้าง 715.83 ฿' chip
- [ ] Re-open same row → pre-fill = 715.83 → Save → status=PAID
- [ ] Underpay <1฿ still UNDERPAY (rounding tolerance, regression check)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Note: per project memory, do NOT push until owner says "push" / "create PR".**

---

## Self-review

- [ ] All 5 tasks completed
- [ ] `./tools/check-types.sh all` exits 0
- [ ] All payment tests pass
- [ ] Manual smoke (5 steps) passes
- [ ] No `console.log` / `TODO` introduced
- [ ] No regression in NORMAL/OVERPAY/UNDERPAY/OVERPAY_ADVANCE behavior

---

## Out of scope (post-MVP)

- Per-receipt history view (audit trail of all 2B receipts on one installment)
- Customer-facing partial-pay reminder (LIFF push)
- Auto-reminder cron for stale PARTIAL
- Reports column "outstanding partial" on contracts list
- Late fee on partial-paid installment (currently inherited from existing lateFee logic — may need follow-up if cashier wants to defer late fee until full clear)

---

*End of plan.*
