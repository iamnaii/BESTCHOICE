# เงินที่รับเกินยอดปิด + เครดิต 21-5101 ที่เหลือหลังปิด → รายได้ 42-1106 (18.2 / 22.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เงินของลูกค้าที่เกินลูกหนี้ตามบัญชีตอนปิดยอดก่อนกำหนด (เกิน 1.00) และเครดิต 21-5101 ที่เหลือหลังสัญญาปิด ถูกรับรู้เป็นรายได้ 42-1106 (ภาษีขาย 7/107 ตามกติกา 14) แทนการปฏิเสธ/ค้างถาวร · รายการกลับ VAT 60 วันของใบรับชำระย้อนวันลงวันเดียวกับใบรับชำระ

**Architecture:** (1) `buildEarlyPayoffJE` (ฟังก์ชันบริสุทธิ์ที่ preview และรายการจริงใช้ร่วมกัน) เปลี่ยนสาขา `excessReceived` เป็นบรรทัด `Cr 42-1106` + `Cr 21-2101` — ผู้เรียกสองราย (`ContractPaymentService.earlyPayoff` · `EarlyPayoffJP4Template`) เลิก throw และ stamp metadata · (2) `AdvanceExcessIncomeTemplate.run` กวาด 21-1103 **และ** 21-5101 ในรายการเดียว (`emptiesBucket = true` เสมอ) + cron เลือกสัญญาจากสองบัญชี/สามคอลัมน์ + `reverse()` คืน `creditBalance` · (3) `PaymentReceiptOrchestrator` ส่ง `effectivePaidDate` ให้ `Vat60dayReversalTemplate.execute` (พารามิเตอร์ที่ #1704 เพิ่ม — PR นี้แตกจาก main ก่อน #1704 merge จึง**เพิ่มพารามิเตอร์เดียวกันซ้ำแบบเข้ากันได้** ถ้าไฟล์ยังไม่มี)

**Tech Stack:** NestJS · Prisma · `Decimal` เท่านั้น · jest (unit/mock) · vitest (DB: `source ~/Documents/BESTCHOICE-docs/pr4-advance-vat/test-env.sh && npx vitest run --root <abs apps/api> --no-file-parallelism <files>`)

**Spec:** ไม่มีสเปกไฟล์ — อ้างคำตอบฝ่ายบัญชี 16/10/2569 ข้อ 18.2 ("ส่วนเกิน ≥1.00 ตอนปิดยอด → Cr รายได้อื่น ใช้ 42-1106 แทนปฏิเสธ") · 22.2 ("เครดิต 21-5101 เหลือหลังปิด = รายได้ 42-1106") · คำตัดสินเจ้าของ 16/10 ("ลงรายได้ 42-1106 ไม่คืนลูกค้า") · 17/10 ("I1 ฝั่งใบรับชำระย้อนวัน รวมใน PR นี้") — บันทึกใน memory `bestchoice-accounting-decisions-2026-10-11.md`

## Global Constraints

- เงินเป็น `Decimal` เสมอ · ภาษีของเงินที่รับ = `advanceVatOf(amount)` = HALF_UP(amount × 7/107) (`journal/advance-vat.ts`) — ห้ามมีสูตรที่สอง
- preview === posted: `getEarlyPayoffQuote` และ `earlyPayoff` ใช้ `buildEarlyPayoffJournal` ตัวเดียว ห้ามแตกสาขา
- เศษ ≤ 1.00 ยังเป็น `Cr 53-1503` (นโยบาย tolerance เดิม) · เกิน 1.00 = รายได้ 42-1106 (คำตอบ 18.2 เขียน "≥1.00" = เกินเพดานเศษสตางค์)
- รอบกวาดห้ามอยู่บนเส้นทางเงิน (doctrine R-1) · Sentry หลัง commit เท่านั้น (`DeferredWarning`)
- ไม่มี backfill · forward-only · web `apps/web/package.json` → **26.10.35** (ต่อจาก #1704 = 26.10.34; merge สลับลำดับให้ bump ใหม่)
- lint: `npx eslint --no-fix <abs files>` (ห้าม `apps/api run lint`) · type: `./tools/check-types.sh api`
- commit ลงท้าย `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` · PR body ลงท้าย `🤖 Generated with [Claude Code](https://claude.com/claude-code)`

## Review Focus

1. ปิดยอดที่ส่วนเกินพอดี 1.00 ต้องยังเป็น 53-1503 (ไม่ใช่รายได้) · 1.01 ต้องเป็นรายได้ 0.94 + ภาษี 0.07 — ปักที่ Task 1 step 1
2. ปิดยอดที่เครดิต 21-5101 มากกว่าหนี้ (ยอดปิด 0.00) ต้องปิดสัญญาได้และลงรายได้ — ปักที่ Task 1 step 5 (ledger spec)
3. รอบกวาดสัญญาที่มีเฉพาะ 21-5101 (21-1103 = 0 · เช่น X2 ลิงก์ชำระตั้ง `creditBalance 0` ไม่มีรายการ) ต้องกวาด — ปักที่ Task 2 step 1 (golden) และ step 5 (cron DB)
4. `reverse()` ของรายการที่กวาด 21-5101 ต้องคืน `creditBalance` — ปักที่ Task 2 step 1
5. ใบรับชำระย้อนวันข้ามเดือนของงวดที่มีธง 60 วัน: รายการกลับลง `entryDate` = วันที่รับเงิน (ไม่ก่อนรายการตั้ง) — ปักที่ Task 3 step 1

---

### Task 1: 18.2 — เงินที่รับเกินลูกหนี้ตามบัญชีเกิน 1.00 → Cr 42-1106 + Cr 21-2101 (แทนปฏิเสธ)

**Files:**
- Modify: `apps/api/src/modules/journal/compute-early-payoff-je.ts`
- Modify: `apps/api/src/modules/contracts/contract-payment.service.ts` (บล็อก `if (epJe.excessReceived.gt(0)) throw` + `epDescriptions` + `jeMetadata` + สัญญาณเตือนหลัง commit)
- Modify: `apps/api/src/modules/journal/cpa-templates/early-payoff-jp4.template.ts` (บล็อก throw เดียวกัน + metadata)
- Test: `apps/api/src/modules/journal/compute-early-payoff-je.spec.ts` · `apps/api/src/modules/contracts/contract-payment.early-payoff-ledger.spec.ts` · `apps/api/src/modules/journal/early-payoff-jp4.template.golden.spec.ts`

**Interfaces:**
- Produces: `EarlyPayoffJe.excessIncome: Decimal` (ยอดรวมภาษี · 0 เมื่อไม่มี) · `EarlyPayoffJe.excessVat: Decimal` · `EarlyPayoffJeLine.excessIncome?: true` (ธงบรรทัด 42-1106 / 21-2101 ของส่วนเกิน) · ค่าคงที่ `EARLY_PAYOFF_EXCESS_INCOME_ACCOUNT = '42-1106'` · metadata JP4 `excessIncome` / `excessVat` (สตริง 2 ตำแหน่ง เฉพาะเมื่อ > 0) · ฟิลด์ `excessReceived` ถูกลบ

- [ ] **Step 1: RED — แก้เทส builder**

ใน `compute-early-payoff-je.spec.ts` เคส `'เงินที่รับ + เงินของลูกค้าเกินลูกหนี้ตามบัญชี: พอดี 1.00 → Cr 53-1503 1.00 · เกิน 1.01 → excessReceived 1.01 …'` เปลี่ยนเป็น:

```ts
  it('เงินที่รับ + เงินของลูกค้าเกินลูกหนี้ตามบัญชี: พอดี 1.00 → Cr 53-1503 1.00 · เกิน 1.01 → รายได้ 42-1106 0.94 + ภาษีขาย 21-2101 0.07 (ฝ่ายบัญชี 18.2) สมดุล', () => {
    const atLimit = buildEarlyPayoffJE({ depositAccountCode: '11-1201', cashReceived: '18191.00', ledger: opened, discountPercent: '0' });
    expect(atLimit.roundingGain.toFixed(2)).toBe('1.00');
    expect(atLimit.excessIncome.toFixed(2)).toBe('0.00');
    expect(totals(atLimit)).toEqual({ dr: '25381.00', cr: '25381.00' });

    const over = buildEarlyPayoffJE({ depositAccountCode: '11-1201', cashReceived: '17891.01', ledger: opened, creditRelief: '300.00', discountPercent: '0' });
    expect(over.excessIncome.toFixed(2)).toBe('1.01');
    expect(over.excessVat.toFixed(2)).toBe('0.07');
    expect(over.roundingGain.toFixed(2)).toBe('0.00');
    expect(over.discount.toFixed(2)).toBe('0.00');
    expect(over.lines.map((l) => l.accountCode)).not.toContain('53-1503');
    expect(over.lines.map((l) => l.accountCode)).not.toContain('52-1106');
    const excessLines = over.lines.filter((l) => l.excessIncome);
    expect(excessLines.map((l) => `${l.accountCode}:${l.cr.toFixed(2)}`)).toEqual(['42-1106:0.94', '21-2101:0.07']);
    expect(totals(over)).toEqual({ dr: '25381.01', cr: '25381.01' });
  });
```
และแก้ทุก `excessReceived` อื่นในไฟล์ (บรรทัด 72 · 521 · 745) เป็น `excessIncome`.

- [ ] **Step 2: Run — เห็นล้ม**

Run: `npx jest --runInBand src/modules/journal/compute-early-payoff-je.spec.ts` (cwd `apps/api`)
Expected: FAIL — `excessIncome` undefined / TS error ที่ฟิลด์

- [ ] **Step 3: GREEN — builder**

ใน `compute-early-payoff-je.ts`: เพิ่ม `export const EARLY_PAYOFF_EXCESS_INCOME_ACCOUNT = '42-1106';` · `EarlyPayoffJeLine` เพิ่ม `excessIncome?: true` · ผล `EarlyPayoffJe` แทน `excessReceived` ด้วย `excessIncome` + `excessVat` (อัปเดต docblock แถว "ต่ำกว่า −1.00 → …") · ในตัวสร้าง:

```ts
  let excessIncome = zero;
  let excessVat = zero;
  if (plug.gte(0)) discount = plug;
  else if (plug.abs().lte(EARLY_PAYOFF_ROUNDING_TOLERANCE)) roundingGain = plug.abs();
  else {
    // ฝ่ายบัญชี 16/10/2569 ข้อ 18.2 — เงินของลูกค้าที่เกินลูกหนี้ตามบัญชีเกินเศษสตางค์ = รายได้อื่น 42-1106 (ไม่คืนลูกค้า —
    // เจ้าของ 16/10) · ภาษีขาย 7/107 ของเงินที่รับรู้เป็นรายได้ตามกติกา 14 (ภาษีของเงินที่รับ ณ วันรับ) — สูตรเดียวกับเงินรับล่วงหน้า
    excessIncome = plug.abs();
    excessVat = advanceVatOf(excessIncome);
  }
  …
  credit(EARLY_PAYOFF_ROUNDING_ACCOUNT, roundingGain);
  if (excessIncome.gt(0)) {
    lines.push({ accountCode: EARLY_PAYOFF_EXCESS_INCOME_ACCOUNT, dr: zero, cr: excessIncome.minus(excessVat), excessIncome: true });
    if (excessVat.gt(0)) lines.push({ accountCode: '21-2101', dr: zero, cr: excessVat, excessIncome: true });
  }
```
import `advanceVatOf` จาก `./advance-vat`.

- [ ] **Step 4: Run — เขียว**

Run: `npx jest --runInBand src/modules/journal/compute-early-payoff-je.spec.ts`
Expected: PASS ทุกเคส

- [ ] **Step 5: RED — ผู้เรียก (service + template)**

`contract-payment.early-payoff-ledger.spec.ts` เคส `'เครดิต 12,000 … → preview ไม่สมดุล · ปฏิเสธ …'` เปลี่ยนเป็น: preview สมดุล (`isBalanced true`) มีบรรทัด `42-1106` cr `414.95` และ `21-2101` cr `29.05` (444.00 × 7/107 = 29.05) · `approvedEarlyPayoff` ไม่ throw · `h.createAndPost` ถูกเรียก 1 ครั้งด้วยบรรทัด 42-1106 `414.95` + 21-2101 `29.05` และ metadata `excessIncome: '444.00'`, `excessVat: '29.05'` · contract update มี `status: 'EARLY_PAYOFF'` · `Sentry.captureMessage` ถูกเรียก 1 ครั้งด้วย tag `action: 'early-payoff-excess-income'` (หลัง commit).
`early-payoff-jp4.template.golden.spec.ts` เคส `'เงินที่รับเกินลูกหนี้ตามบัญชีเกิน 1.00 → throw ไม่ลงรายการ'` เปลี่ยนเป็น: `run('0', '9096.03')` ไม่ throw · `lineFor(je, '42-1106')!.cr` = `0.94` · บรรทัด 21-2101 ของส่วนเกิน `0.07` (รวม 21-2101 = 594.98 + 0.07 = 595.05) · `createAndPost` ถูกเรียก.

- [ ] **Step 6: Run — เห็นล้ม**

Run: `npx jest --runInBand src/modules/contracts/contract-payment.early-payoff-ledger.spec.ts src/modules/journal/early-payoff-jp4.template.golden.spec.ts`
Expected: FAIL ที่สองเคสนั้น (throw ยังอยู่)

- [ ] **Step 7: GREEN — ผู้เรียก**

`contract-payment.service.ts`: ลบบล็อก `if (epJe.excessReceived.gt(0)) { throw … }` · `epDescriptions` เพิ่ม `'42-1106': 'เงินที่รับเกินยอดปิด — รับรู้เป็นรายได้ (ฝ่ายบัญชี 18.2)'` และ map บรรทัดที่ `l.excessIncome && l.accountCode === '21-2101'` → `'ภาษีขายของเงินที่รับเกินยอดปิด'` · `jeMetadata` เพิ่ม `...(epJe.excessIncome.gt(0) ? { excessIncome: epJe.excessIncome.toFixed(2), excessVat: epJe.excessVat.toFixed(2) } : {})` · หลังอ่าน `epJe` เมื่อ `excessIncome > 0` push `DeferredWarning` ลง `epWarnings` (`message: '[early-payoff] money received exceeds the contract ledger receivable — recognised as income 42-1106'`, `tags: { module: 'contracts', action: 'early-payoff-excess-income', flow: 'early-payoff' }`, `extra: { contractId, excessIncome, excessVat, cashReceived, creditRelief, advanceRelief, parkRelief }`) — `epWarnings = [...epJe.warnings, warning]`.
`early-payoff-jp4.template.ts`: ลบ throw เดียวกัน · metadata เพิ่ม `excessIncome` / `excessVat` เฉพาะเมื่อ > 0.

- [ ] **Step 8: Run — เขียว + ชุดข้างเคียง**

Run: `npx jest --runInBand 'contract-payment\.' 'early-payoff-jp4' 'compute-early-payoff-je' 'payoff-parity'`
Expected: PASS ทั้งหมด

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/journal/compute-early-payoff-je.ts apps/api/src/modules/journal/compute-early-payoff-je.spec.ts apps/api/src/modules/contracts/contract-payment.service.ts apps/api/src/modules/contracts/contract-payment.early-payoff-ledger.spec.ts apps/api/src/modules/journal/cpa-templates/early-payoff-jp4.template.ts apps/api/src/modules/journal/early-payoff-jp4.template.golden.spec.ts
git commit -m "feat(accounting): 18.2 เงินที่รับเกินยอดปิดเกิน 1.00 → รายได้ 42-1106 + ภาษีขาย 7/107 แทนปฏิเสธ"
```

---

### Task 2: 22.2 — รอบกวาดเงินพักส่วนเกินรวมเครดิต 21-5101 ที่เหลือหลังปิด

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/advance-excess-income.template.ts`
- Modify: `apps/api/src/modules/journal/cron/advance-excess-income.cron.ts` (เลือกสัญญา + ข้อความงานแจ้ง)
- Test: `apps/api/src/modules/journal/advance-excess-income.template.golden.spec.ts` (jest mock) · `apps/api/src/modules/journal/cron/advance-excess-income.cron.spec.ts` (vitest DB — CI `JOURNAL_FILES`)

**Interfaces:**
- Consumes: `readContractCloseAdvances(tx, contract, 'excess-income')` → `{ advance, credit, warnings }` (มีอยู่)
- Produces: `AdvanceExcessIncomeResult POSTED` เพิ่ม `advance: Decimal` · `credit: Decimal` (`amount` = ผลรวม) · `COLUMNS_ONLY` เพิ่ม `creditBalance: Decimal` · metadata เพิ่ม `credit` (`ledger21_1103` = advance · `ledger21_5101` = credit เดิม) · `tx.contract.update` ตั้ง `creditBalance: 0` ด้วย · `reverse()` คืน `creditBalance` จาก `creditBalanceBefore`

- [ ] **Step 1: RED — golden (mock)**

ใน `advance-excess-income.template.golden.spec.ts` เคส `'ต4: มี 21-5101 300 ค้าง …'` เปลี่ยนเป็น `'22.2: มี 21-5101 300 ค้าง (ภาษี 19.63) → กวาดทั้ง 21-1103 500 และ 21-5101 300 ในรายการเดียว ภาษีค้างทั้งก้อน 52.34 · creditBalance = 0'`:

```ts
    expect(tuples(posted().lines)).toEqual([
      '21-1103 500.00 0.00',
      '21-5101 300.00 0.00',
      '42-1106 0.00 747.66',
      '21-2102 0.00 52.34',
    ]);
    expect(posted().metadata[ADVANCE_VAT_META.consume]).toBe('52.34');
    expect(posted().metadata.ledger21_1103).toBe('500.00');
    expect(posted().metadata.ledger21_5101).toBe('300.00');
    expect(posted().metadata.credit).toBe('300.00');
    expect(posted().metadata.amount).toBe('800.00');
    expect(tx.contract.update).toHaveBeenCalledWith({ where: { id: 'contract-1' }, data: { advanceBalance: 0, rescheduleAdvanceBalance: 0, creditBalance: 0 } });
```
เพิ่มเคส `'22.2 / X2: มีเฉพาะ 21-5101 2,000 (21-1103 = 0 · creditBalance คอลัมน์ 0 — ลิงก์ชำระตั้ง 0 โดยไม่มีรายการ) → กวาด Dr 21-5101 2,000 / Cr 42-1106 1,869.16 / Cr 21-2102 130.84 + columnsMismatch'` (stamps park 130.84 · ledger `{ '21-5101': '2000.00' }` · columns ทั้งหมด 0 · คาด POSTED · `columnsMismatch true`).
เคส `'บัญชี 21-1103 = 0 แต่คอลัมน์ถัง > 0 → COLUMNS_ONLY'` เพิ่มการตรวจ `result.creditBalance` = `0.00` · เพิ่มเคส `'บัญชีสองตัว 0 แต่ creditBalance คอลัมน์ 50 → COLUMNS_ONLY (creditBalance 50.00)'`.
เคส reverse `'กระจกทุกบรรทัด …'`: `existing[0]` เพิ่ม `creditBalanceBefore: '300.00'` + `originalLines` เพิ่ม `21-5101 300 dr` → คาด `tx.contract.update` คืน `creditBalance: dec('300.00')` ด้วย (อ่าน assertion เดิมของคอลัมน์แล้วเติม).
ทุก `toHaveBeenCalledWith({ … data: { advanceBalance: 0, rescheduleAdvanceBalance: 0 } })` เดิม (G6 ฯลฯ) เติม `creditBalance: 0`.

- [ ] **Step 2: Run — เห็นล้ม**

Run: `npx jest --runInBand src/modules/journal/advance-excess-income.template.golden.spec.ts`
Expected: FAIL เคส 22.2 / X2 / COLUMNS_ONLY ใหม่ / reverse (บรรทัด 21-5101 และ creditBalance)

- [ ] **Step 3: GREEN — template**

ใน `run()`:
```ts
    const advance = advances.advance;
    const credit = advances.credit;
    const amount = advance.plus(credit);
    if (!amount.gt(0)) {
      if (advanceBalanceBefore.plus(parkBalanceBefore).plus(creditBalanceBefore).gt(0)) {
        return { result: { outcome: 'COLUMNS_ONLY', contractId, contractNumber, advanceBalance: advanceBalanceBefore, rescheduleAdvanceBalance: parkBalanceBefore, creditBalance: creditBalanceBefore }, warnings: advances.warnings, contractNumber };
      }
      return { result: { outcome: 'NOTHING', contractId, contractNumber }, warnings: advances.warnings, contractNumber };
    }
    …
    // 22.2 (ฝ่ายบัญชี 16/10/2569): รายการนี้ล้างทั้ง 21-1103 และ 21-5101 ⇒ ถังของสัญญาเป็น 0 เสมอ → ภาษีที่ยังค้างทั้งก้อน (ต4)
    let vat = await resolveConsumeVat(tx, contractId, amount, true);
    if (vat.gt(amount)) vat = amount;
    const income = amount.minus(vat);
    const lines: JeLineInput[] = [];
    if (advance.gt(0)) lines.push({ accountCode: '21-1103', dr: advance, cr: ZERO, description: LINE_DESCRIPTION });
    if (credit.gt(0)) lines.push({ accountCode: '21-5101', dr: credit, cr: ZERO, description: CREDIT_LINE_DESCRIPTION });
    …(42-1106 / 21-2102 เดิม)
    const money = { amount, income, vat, advance: advance.toFixed(2), credit: credit.toFixed(2), advanceBalanceBefore, rescheduleAdvanceBalanceBefore, creditBalanceBefore, ledger21_1103: advance.toFixed(2), ledger21_5101: credit.toFixed(2) };
    await tx.contract.update({ where: { id: contractId }, data: { advanceBalance: 0, rescheduleAdvanceBalance: 0, creditBalance: 0 } });
```
`CREDIT_LINE_DESCRIPTION = 'รับรู้เครดิตที่เหลือหลังปิดสัญญาเป็นรายได้ (เงินพักค่าปรับดิวสะสมเกิน)'` · คำอธิบายรายการเดิมคงไว้ · ผล POSTED เพิ่ม `advance`, `credit` · docblock ของคลาสอัปเดต (ถ3 ปิด) · `reverse()`: คืน `creditBalance: toDecimal(meta.creditBalanceBefore)` เพิ่มจากสองคอลัมน์เดิม (meta เก่าที่ไม่มีคีย์ → 0).

- [ ] **Step 4: Run — เขียว**

Run: `npx jest --runInBand src/modules/journal/advance-excess-income.template.golden.spec.ts`
Expected: PASS

- [ ] **Step 5: RED — cron DB spec**

ใน `advance-excess-income.cron.spec.ts` เคส `'คัดเลือกสัญญา: …'`: สัญญา D (ต4) คาดหลังรอบกวาด: `glContractBalance(D, '21-5101', 'cr')` = `0.00` · บรรทัดของรายการกวาด D มี `21-5101 300.00` Dr · `Cr 42-1106 747.66` · `Cr 21-2102 52.34` · `creditBalance` ของ D = 0 (อ่าน assertion เดิมของ D แล้วแก้ค่า) · เพิ่มสัญญา **K** (X2): `status COMPLETED` · คอลัมน์ทั้งสาม 0 · synthetic `['11-1201','2000.00','0'], ['21-5101','0','2000.00'], ['21-2102','130.84','0'], ['21-2101','0','130.84']` stamp park 130.84 · ทุกงวด PAID → คาด posted นับเพิ่ม 1 (`r1.posted` = 4) · รายการ `Dr 21-5101 2,000.00 / Cr 42-1106 1,869.16 / Cr 21-2102 130.84` · metadata `columnsMismatch: true` · งานแจ้ง 1 ใบ · ข้อความงานมี "21-5101".
ส่วน `notifyColumnsOnly`: สัญญา F ข้อความเดิม (ไม่มีเครดิต) คงเดิม.

- [ ] **Step 6: Run — เห็นล้ม**

Run: `source ~/Documents/BESTCHOICE-docs/pr4-advance-vat/test-env.sh && npx vitest run --root <abs apps/api> --no-file-parallelism src/modules/journal/cron/advance-excess-income.cron.spec.ts`
Expected: FAIL (K ไม่ถูกเลือก · D ไม่กวาด 21-5101)

- [ ] **Step 7: GREEN — cron**

`selectCandidates`: SQL `WHERE jl.account_code IN ('21-1103', '21-5101')` · columnRows `OR: [advanceBalance gt 0, rescheduleAdvanceBalance gt 0, creditBalance gt 0]` · `notifyPosted`: ข้อความ `Dr 21-1103 ${advance}` + (credit > 0 ? ` / Dr 21-5101 ${credit}` : '') + "… ตามคำตอบฝ่ายบัญชี เล่ม 1 ข้อ 3 (29/09/2569) และ 22.2 (16/10/2569) · คอลัมน์ advanceBalance / rescheduleAdvanceBalance / creditBalance ของสัญญาตั้งเป็น 0 แล้ว" · `notifyColumnsOnly`: total รวม `creditBalance` และข้อความระบุสามคอลัมน์ + "บัญชี 21-1103 / 21-5101 = 0" · docblock คลาส cron อัปเดต (ถ3).

- [ ] **Step 8: Run — เขียว + ชุดข้างเคียง**

Run: vitest เดิม + `src/modules/accounting/pp30-output-vat.integration.spec.ts` · jest `'advance-excess'` + `'receipt-void'` (ด่าน void) 
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/journal/cpa-templates/advance-excess-income.template.ts apps/api/src/modules/journal/cron/advance-excess-income.cron.ts apps/api/src/modules/journal/advance-excess-income.template.golden.spec.ts apps/api/src/modules/journal/cron/advance-excess-income.cron.spec.ts
git commit -m "feat(accounting): 22.2 รอบกวาดเงินพักส่วนเกินรวมเครดิต 21-5101 ที่เหลือหลังปิด → 42-1106"
```

---

### Task 3: ใบรับชำระย้อนวัน — รายการกลับ VAT 60 วันลงวันที่รับเงิน

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/vat-60day-reversal.template.ts` (ถ้ายังไม่มีพารามิเตอร์ `postedAt` — #1704 ยังไม่ merge: เพิ่มแบบเดียวกันทุกตัวอักษรกับ #1704 commit `8c545b20d` เพื่อให้ merge ทับกันได้: select `entryDate` ของรายการตั้ง · `reversalPostedAt = max(postedAt, mandatoryEntryDate)` · ไม่ส่ง = ตอนนี้)
- Modify: `apps/api/src/modules/payments/services/payment-receipt-orchestrator.ts` (จุดที่ 1 — ใบรับชำระจากหน้าจอ ส่ง `effectivePaidDate`; จุดที่ 2/3 (กระจายเงิน/ใช้เครดิต) และ webhook ลงตอนนี้อยู่แล้ว ไม่แตะ)
- Test: `apps/api/src/modules/payments/services/accrue-at-receipt.integration.spec.ts` · `apps/api/src/modules/journal/cpa-templates/vat-60day-reversal.template.spec.ts` (เฉพาะเมื่อต้องเพิ่มพารามิเตอร์ — คัดลอกเคส 3 เคสจาก #1704)

**Interfaces:**
- Consumes: `Vat60dayReversalTemplate.execute(installmentScheduleId, outerTx?, postedAt?)`

- [ ] **Step 1: RED — DB spec**

ใน `accrue-at-receipt.integration.spec.ts` (describe `'ใบรับชำระที่ทำให้งวดชำระครบ'`) เพิ่มเคส `'ใบรับชำระย้อนวันข้ามเดือนของงวดที่ถูกตั้ง VAT บังคับ 60 วัน → รายการกลับ 21-2103 ลงวันเดียวกับใบรับชำระ (ไม่ก่อนรายการตั้ง)'`: `seedContract({ dueDate: futureDue(), paymentRows: [1] })` · `Vat60dayMandatoryTemplate.execute(insts[0].id)` แล้วย้ายวันรายการตั้งเป็น 40 วันก่อน (update `entryDate`/`postedAt`) · `paidDate` = วันสุดท้ายของเดือนก่อน 12:00 (เปิดงวดบัญชีถ้าปิด แบบเดียวกับเคส JP4 ย้อนวันใน #1704) · `record(c.id, 1, 1515.83, 'AAR-V60-BACK', { paidDate })` · คาด: รายการ `tag VAT60-REVERSAL` ของสัญญา 1 ใบ `entryDate` = `paidDate` · `balance(c.id,'21-2103','cr')` = `0.00` · ใบรับชำระ (`flowEntries(c.id,'payment-receipt')` หรือ tag `receipt`) `entryDate` = `paidDate`.
ถ้า `vat-60day-reversal.template.ts` ยังไม่มี `postedAt`: เพิ่ม 3 เคสจาก #1704 ลง `vat-60day-reversal.template.spec.ts` (postedAt หลังรายการตั้ง → ลงวันนั้น · ก่อน → ลงวันรายการตั้ง · ไม่ส่ง → ตอนนี้).

- [ ] **Step 2: Run — เห็นล้ม**

Run: vitest ไฟล์ข้างบน `-t 'ย้อนวันข้ามเดือน|postedAt'`
Expected: FAIL (รายการกลับลงวันนี้)

- [ ] **Step 3: GREEN**

orchestrator จุดที่ 1: `await this.vat60Reversal.execute(instSched.id, tx, effectivePaidDate);` + คอมเมนต์ (รายการกลับอยู่เดือนเดียวกับใบรับชำระย้อนวัน — ภ.พ.30 รายเดือนที่รวม 21-2103 ไม่นับซ้ำ) · template ตามที่ระบุ (ถ้าจำเป็น).

- [ ] **Step 4: Run — เขียว + ชุดข้างเคียง**

Run: vitest ไฟล์ข้างบนเต็ม + jest `'payments\.' 'payments-financial' 'paysolutions\.'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(payments): รายการกลับ VAT 60 วันของใบรับชำระย้อนวัน ลงวันที่รับเงิน"
```

---

### Task 4: เอกสาร + เวอร์ชัน + ตรวจรวม

**Files:**
- Modify: `.claude/rules/accounting.md` — ตาราง JP4 แถว "เศษ / เงินเกินหนี้" (เกิน 1.00 → 42-1106 + 21-2101 7/107 · ไม่ปฏิเสธ · สัญญาณเตือน `early-payoff-excess-income`) · แถว metadata (+`excessIncome`/`excessVat`) · หัวข้อ PR4 ตาราง ต6 (กวาด 21-1103 + 21-5101 · `emptiesBucket` เสมอ · คอลัมน์ creditBalance = 0) · "ที่ยังเปิดอยู่" ถ3 · ถ4 · X2 ขีดฆ่า (ปิด 2026-10-17) · ตาราง JP4 แถว "ไม่แก้ใน PR5 / PR5ข" รายการ X2 ขีดฆ่า · หัวข้อ "VAT 60-Day Rule" (ใบรับชำระจากหน้าจอส่งวันที่รับเงินแล้ว — กระจายเงิน/ใช้เครดิต/webhook ลงตอนนี้อยู่แล้ว) · ตารางด่านใบลดหนี้/ยกเลิกใบเสร็จ ไม่เปลี่ยน
- Modify: `apps/web/package.json` → `26.10.35`

- [ ] **Step 1: แก้เอกสาร + เวอร์ชัน**
- [ ] **Step 2: ตรวจรวม**

Run: `./tools/check-types.sh api` · `npx eslint --no-fix <abs ไฟล์ที่แก้ทั้งหมด>` · jest ชุดเดิมทั้งสาม task · vitest ไฟล์ DB ทั้งสาม task
Expected: ผ่านหมด · 0 eslint error

- [ ] **Step 3: Commit**

```bash
git commit -m "docs(accounting): 18.2/22.2 + ใบรับชำระย้อนวัน · bump web 26.10.35"
```

หลังจากนั้น: ผู้ตรวจอิสระ (Fable) → แก้ Critical/Important แบบ RED→GREEN → push → `gh pr create` (body ลงท้าย 🤖) · ระบุใน PR ว่า merge หลัง #1704 และถ้า `vat-60day-reversal.template.ts` ชนกัน ให้ถือของ #1704
