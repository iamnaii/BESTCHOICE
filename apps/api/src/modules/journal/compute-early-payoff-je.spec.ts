import { Decimal } from '@prisma/client/runtime/library';
import {
  EarlyPayoffJe,
  EarlyPayoffLedger,
  buildEarlyPayoffJE,
  buildEarlyPayoffJournal,
  computeEarlyPayoffJE,
  readEarlyPayoffLedger,
  sumAccruedUnpaid,
} from './compute-early-payoff-je';
import { ledgerLines } from './__tests__/ledger-lines-mock';

/**
 * Golden / characterization test for the SINGLE source-of-truth early-payoff JE
 * math. Before this extraction, the JE was re-implemented in THREE places that
 * could silently drift:
 *   A) EarlyPayoffJP4Template.execute()         — the JP4 posting template
 *   B) ContractPaymentService.getEarlyPayoffQuote() — the UI/LIFF JE preview
 *   C) ContractPaymentService.earlyPayoff()     — the inline ledger posting
 *
 * This spec pins the canonical money math for `computeEarlyPayoffJE` against the
 * CPA golden fixtures so all three callers can never diverge by a satang.
 *
 * Rounding rules (.claude/rules/accounting.md — MUST match CPA CSV golden):
 *   grossExclVat / totalMonths → ROUND_DOWN   (17000/12 = 1416.66, NOT .67)
 *   interest    / totalMonths → ROUND_HALF_UP (1190/12 = 99.17)
 *   vat         / totalMonths → ROUND_HALF_UP
 *   per-installment total = sum of the above
 *
 * Policy A (CPA decision · 2026-05-09): VAT ไม่ลดตามส่วนลดดอกเบี้ย —
 *   Cr 21-2101 = remainingDeferredVat เต็มยอด (settleVat = remainingDeferredVat).
 */
describe('computeEarlyPayoffJE (single-source early-payoff JE math)', () => {
  const drOf = (r: ReturnType<typeof computeEarlyPayoffJE>, code: string) =>
    r.lines.find((l) => l.accountCode === code)?.dr.toFixed(2);
  const crOf = (r: ReturnType<typeof computeEarlyPayoffJE>, code: string) =>
    r.lines.find((l) => l.accountCode === code)?.cr.toFixed(2);
  const totals = (r: ReturnType<typeof computeEarlyPayoffJE>) => {
    const dr = r.lines.reduce((s, l) => s.plus(l.dr), new Decimal(0));
    const cr = r.lines.reduce((s, l) => s.plus(l.cr), new Decimal(0));
    return { dr: dr.toFixed(2), cr: cr.toFixed(2) };
  };

  // ── CPA golden case-4 (17K/12M, 6 unpaid, 50% discount) ─────────────────────
  // Mirrors apps/api/.../fixtures/cpa-cases/case-4-early-payoff.csv exactly.
  describe('CPA golden case-4 (17K/12M · 6 unpaid · 50% discount)', () => {
    const input = {
      depositAccountCode: '11-1101',
      financedAmount: '10000',
      storeCommission: '1000',
      interestTotal: '6000',
      vatAmount: '1190',
      totalMonths: 12,
      unpaidCount: 6,
      interestDiscountPercent: '50',
    };

    it('rounds per-installment principal ROUND_DOWN and interest/VAT ROUND_HALF_UP', () => {
      const r = computeEarlyPayoffJE(input);
      // 17000/12 = 1416.666.. → ROUND_DOWN → 1416.66
      expect(r.installmentExclVat.toFixed(2)).toBe('1416.66');
      // 6000/12 = 500.00
      expect(r.interestPerInst.toFixed(2)).toBe('500.00');
      // 1190/12 = 99.1666.. → ROUND_HALF_UP → 99.17
      expect(r.vatPerInst.toFixed(2)).toBe('99.17');
    });

    it('produces the 8 documented FINANCE lines in order with the golden amounts', () => {
      const r = computeEarlyPayoffJE(input);
      expect(r.lines.map((l) => l.accountCode)).toEqual([
        '11-1101', '11-2106', '21-2102', '52-1106', '11-2101', '11-2105', '41-1101', '21-2101',
      ]);
      expect(drOf(r, '11-1101')).toBe('7594.98'); // settlement
      expect(drOf(r, '11-2106')).toBe('3000.00'); // remaining deferred interest
      expect(drOf(r, '21-2102')).toBe('595.02'); // remaining deferred VAT
      expect(drOf(r, '52-1106')).toBe('1500.00'); // 50% discount
      expect(crOf(r, '11-2101')).toBe('8499.96'); // remaining gross
      expect(crOf(r, '11-2105')).toBe('595.02');
      expect(crOf(r, '41-1101')).toBe('3000.00');
      expect(crOf(r, '21-2101')).toBe('595.02'); // Policy A — full deferred VAT
    });

    it('is balanced at 12,690.00', () => {
      const r = computeEarlyPayoffJE(input);
      const t = totals(r);
      expect(t.dr).toBe('12690.00');
      expect(t.cr).toBe('12690.00');
    });

    it('exposes derived scalars (settlement, discount, settleVat)', () => {
      const r = computeEarlyPayoffJE(input);
      expect(r.settlement.toFixed(2)).toBe('7594.98');
      expect(r.discount.toFixed(2)).toBe('1500.00');
      expect(r.settleVat.toFixed(2)).toBe('595.02');
      expect(r.remainingDeferredInterest.toFixed(2)).toBe('3000.00');
      expect(r.remainingDeferredVat.toFixed(2)).toBe('595.02');
      expect(r.remainingGross.toFixed(2)).toBe('8499.96');
    });

    it('100% discount → settlement 6094.98, Cr 21-2101 still full (Policy A)', () => {
      const r = computeEarlyPayoffJE({ ...input, interestDiscountPercent: '100' });
      expect(drOf(r, '52-1106')).toBe('3000.00');
      expect(drOf(r, '11-1101')).toBe('6094.98'); // 8499.96 - 3000 + 595.02
      expect(crOf(r, '21-2101')).toBe('595.02');
    });
  });

  // ── 18K/12M case (preview B + posting C golden) ─────────────────────────────
  describe('18K/12M · 6 unpaid', () => {
    const input = {
      depositAccountCode: '11-1101',
      financedAmount: '18000',
      storeCommission: '1800',
      interestTotal: '1800',
      vatAmount: '1512',
      totalMonths: 12,
      unpaidCount: 6,
      interestDiscountPercent: '50',
    };

    it('50% discount → cash 11106.00, discount 450.00, balanced 13212.00', () => {
      const r = computeEarlyPayoffJE(input);
      expect(drOf(r, '11-1101')).toBe('11106.00');
      expect(drOf(r, '11-2106')).toBe('900.00');
      expect(drOf(r, '21-2102')).toBe('756.00');
      expect(drOf(r, '52-1106')).toBe('450.00');
      expect(crOf(r, '11-2101')).toBe('10800.00');
      expect(crOf(r, '11-2105')).toBe('756.00');
      expect(crOf(r, '41-1101')).toBe('900.00');
      expect(crOf(r, '21-2101')).toBe('756.00');
      expect(totals(r).dr).toBe('13212.00');
      expect(totals(r).cr).toBe('13212.00');
    });

    it('30% discount → discount 270.00, settlement 11286.00', () => {
      const r = computeEarlyPayoffJE({ ...input, interestDiscountPercent: '30' });
      expect(drOf(r, '52-1106')).toBe('270.00'); // 900 × 30/100
      expect(drOf(r, '11-1101')).toBe('11286.00'); // 10800 - 270 + 756
    });
  });

  // ── Zero-discount → GUARD: omit the 52-1106 line (canonical) ────────────────
  describe('zero-discount guard (omit 52-1106)', () => {
    const base = {
      depositAccountCode: '11-1101',
      financedAmount: '18000',
      storeCommission: '1800',
      interestTotal: '1800',
      vatAmount: '1512',
      totalMonths: 12,
      unpaidCount: 6,
    };

    it('0% discount → no 52-1106 line, 7 lines, still balanced', () => {
      const r = computeEarlyPayoffJE({ ...base, interestDiscountPercent: '0' });
      expect(r.lines.find((l) => l.accountCode === '52-1106')).toBeUndefined();
      expect(r.lines).toHaveLength(7);
      expect(r.discount.toFixed(2)).toBe('0.00');
      // settlement = 10800 - 0 + 756 = 11556.00
      expect(drOf(r, '11-1101')).toBe('11556.00');
      expect(totals(r).dr).toBe(totals(r).cr);
      expect(totals(r).dr).toBe('13212.00');
    });

    it('zero interestTotal → discount 0 → omit 52-1106 (7 lines, 0.00 interest legs)', () => {
      // Mirrors the contract-payment exec spec (e) scenario at the pure-fn level.
      const r = computeEarlyPayoffJE({ ...base, interestTotal: '0', interestDiscountPercent: '50' });
      expect(r.lines.find((l) => l.accountCode === '52-1106')).toBeUndefined();
      expect(r.lines).toHaveLength(7);
      expect(drOf(r, '11-2106')).toBe('0.00');
      expect(crOf(r, '41-1101')).toBe('0.00');
      // gross = 19800; installmentExclVat = 1650.00; remainingGross = 9900.00
      expect(crOf(r, '11-2101')).toBe('9900.00');
      expect(drOf(r, '11-1101')).toBe('10656.00'); // 9900 - 0 + 756
      expect(totals(r).dr).toBe(totals(r).cr);
    });
  });

  // ── Late-fee leg (owner 2026-07-20: เงินรับจริงต้องเท่า Dr เงินสด) ────────────
  // ค่าปรับไม่มี VAT + ไม่ร่วมส่วนลด (นโยบายเดียวกับ 2B receipt) — Dr เงินสด
  // grossed up ทั้งก้อน / Cr 42-1103 ทั้งก้อน. เดิมค่าปรับถูกเก็บจากลูกค้า
  // (quote.totalPayoff รวมค่าปรับ) แต่ไม่เคยมีขา JE — รายได้ค่าปรับหายจาก ledger.
  describe('late-fee leg (Cr 42-1103 · no VAT · no discount)', () => {
    const base = {
      depositAccountCode: '11-1101',
      financedAmount: '10000',
      storeCommission: '1000',
      interestTotal: '6000',
      vatAmount: '1190',
      totalMonths: 12,
      unpaidCount: 6,
      interestDiscountPercent: '50',
    };

    it('unpaidLateFees 100 → Dr cash grossed up to 7694.98 + Cr 42-1103 100.00, balanced 12790.00', () => {
      const r = computeEarlyPayoffJE({ ...base, unpaidLateFees: '100' });
      expect(r.lines.map((l) => l.accountCode)).toEqual([
        '11-1101', '11-2106', '21-2102', '52-1106', '11-2101', '11-2105', '41-1101', '21-2101', '42-1103',
      ]);
      expect(drOf(r, '11-1101')).toBe('7694.98'); // settlement 7594.98 + fee 100
      expect(crOf(r, '42-1103')).toBe('100.00');
      expect(r.settlement.toFixed(2)).toBe('7594.98'); // settlement unchanged (excl fee)
      expect(r.lateFees.toFixed(2)).toBe('100.00');
      expect(r.totalCash.toFixed(2)).toBe('7694.98');
      expect(totals(r).dr).toBe('12790.00');
      expect(totals(r).cr).toBe('12790.00');
    });

    it('fee is NOT discounted and NOT VAT-divided — Cr 42-1103 stays 100.00 at 0% and 100% discount', () => {
      const r0 = computeEarlyPayoffJE({ ...base, interestDiscountPercent: '0', unpaidLateFees: '100' });
      const r100 = computeEarlyPayoffJE({ ...base, interestDiscountPercent: '100', unpaidLateFees: '100' });
      expect(crOf(r0, '42-1103')).toBe('100.00');
      expect(crOf(r100, '42-1103')).toBe('100.00');
      expect(totals(r0).dr).toBe(totals(r0).cr);
      expect(totals(r100).dr).toBe(totals(r100).cr);
    });

    it('omitted / 0 fees → no 42-1103 line (CPA case-4 golden byte-for-byte unchanged)', () => {
      const rOmit = computeEarlyPayoffJE(base);
      const rZero = computeEarlyPayoffJE({ ...base, unpaidLateFees: '0' });
      expect(rOmit.lines.find((l) => l.accountCode === '42-1103')).toBeUndefined();
      expect(rZero.lines.find((l) => l.accountCode === '42-1103')).toBeUndefined();
      expect(rOmit.totalCash.toFixed(2)).toBe(rOmit.settlement.toFixed(2));
    });
  });

  // ── Park-relief leg (owner 2026-08-16 §จุดหัก 3 · review finding C-3) ────────
  // ยอดปิดสัญญา (computePayoffQuote) หักถังพักงวดสุดท้ายให้ลูกค้าไปแล้ว แต่ JE เดิม
  // ยัง Dr เงินสดเต็มจำนวน → เงินสดในบัญชีเกินเงินรับจริงเท่ายอดถังพัก + เครดิตผี
  // ค้างใน 21-1103 บนสัญญาที่ปิดไปแล้ว. ขาปลดหนี้ Dr 21-1103 ปิดช่องนี้ โดย
  // "ยอด Dr รวมเท่าเดิม" — ทุกขา Cr จึงไม่ขยับแม้แต่บาทเดียว.
  describe('park-relief leg (Dr 21-1103 · ขาเงินสดลดเท่ากัน · ทุกขา Cr เท่าเดิม)', () => {
    const base = {
      depositAccountCode: '11-1101',
      financedAmount: '10000',
      storeCommission: '1000',
      interestTotal: '6000',
      vatAmount: '1190',
      totalMonths: 12,
      unpaidCount: 6,
      interestDiscountPercent: '50',
    };

    it('parkRelief 354 → Dr เงินสด 7240.98 (7594.98 − 354) + Dr 21-1103 354.00, ยอดรวมและทุกขา Cr เท่าเดิมเป๊ะ', () => {
      const golden = computeEarlyPayoffJE(base);
      const r = computeEarlyPayoffJE({ ...base, parkRelief: '354' });

      expect(drOf(r, '11-1101')).toBe('7240.98'); // 7594.98 − 354.00
      expect(drOf(r, '21-1103')).toBe('354.00');
      expect(r.parkRelief.toFixed(2)).toBe('354.00');
      expect(r.cashReceived.toFixed(2)).toBe('7240.98');
      // totalCash = ยอดปิดรวมก่อนหักถังพัก — ไม่เปลี่ยนความหมายเดิม
      expect(r.totalCash.toFixed(2)).toBe('7594.98');

      // ขาเงินสด + ขาปลดหนี้ = ขาเงินสดเดิมพอดี → ยอด Dr รวมเท่าเดิม
      expect(r.cashReceived.plus(r.parkRelief).toFixed(2)).toBe(golden.totalCash.toFixed(2));
      expect(totals(r).dr).toBe(totals(golden).dr);
      expect(totals(r).cr).toBe(totals(golden).cr);
      expect(totals(r).dr).toBe(totals(r).cr);

      // ทุกขา Cr ต้องเหมือน golden ที่ไม่มีถังพัก byte-for-byte
      const crLines = (x: ReturnType<typeof computeEarlyPayoffJE>) =>
        x.lines.filter((l) => l.cr.gt(0)).map((l) => `${l.accountCode}:${l.cr.toFixed(2)}`);
      expect(crLines(r)).toEqual(crLines(golden));
    });

    it('parkRelief 0 / omitted → ไม่มีบรรทัด 21-1103 เลย และ JE เท่า golden เดิมทุกไบต์', () => {
      const golden = computeEarlyPayoffJE(base);
      const rZero = computeEarlyPayoffJE({ ...base, parkRelief: '0' });
      const rNull = computeEarlyPayoffJE({ ...base, parkRelief: null });

      for (const r of [rZero, rNull]) {
        expect(r.lines.find((l) => l.accountCode === '21-1103')).toBeUndefined();
        expect(r.lines.map((l) => l.accountCode)).toEqual(golden.lines.map((l) => l.accountCode));
        expect(r.lines.map((l) => `${l.dr.toFixed(2)}/${l.cr.toFixed(2)}`)).toEqual(
          golden.lines.map((l) => `${l.dr.toFixed(2)}/${l.cr.toFixed(2)}`),
        );
        expect(r.parkRelief.toFixed(2)).toBe('0.00');
        expect(r.cashReceived.toFixed(2)).toBe(golden.totalCash.toFixed(2));
      }
    });

    it('parkRelief > totalCash → clamp ที่ totalCash: Dr เงินสด 0.00 ห้ามติดลบ, JE ยัง balanced', () => {
      const r = computeEarlyPayoffJE({ ...base, parkRelief: '999999' });

      expect(drOf(r, '11-1101')).toBe('0.00');
      expect(r.cashReceived.isNegative()).toBe(false);
      expect(drOf(r, '21-1103')).toBe('7594.98'); // = totalCash
      expect(totals(r).dr).toBe(totals(r).cr);
      expect(totals(r).dr).toBe('12690.00'); // เท่ากับ golden case-4 เดิม
    });

    it('อยู่ร่วมกับค่าปรับได้: parkRelief หักจาก totalCash (settlement + fee) ไม่ใช่ settlement เปล่า', () => {
      const r = computeEarlyPayoffJE({ ...base, unpaidLateFees: '100', parkRelief: '354' });

      expect(r.totalCash.toFixed(2)).toBe('7694.98'); // 7594.98 + 100
      expect(drOf(r, '11-1101')).toBe('7340.98'); // 7694.98 − 354
      expect(drOf(r, '21-1103')).toBe('354.00');
      expect(crOf(r, '42-1103')).toBe('100.00'); // ค่าปรับยังลงเต็มก้อนเหมือนเดิม
      expect(totals(r).dr).toBe('12790.00');
      expect(totals(r).cr).toBe('12790.00');
    });
  });

  // ── Default derivations when storeCommission / vatAmount are null ────────────
  describe('null storeCommission / vatAmount defaults', () => {
    it('null storeCommission → financed × 10%', () => {
      // financed 10000 → commission 1000 → identical to case-4
      const r = computeEarlyPayoffJE({
        depositAccountCode: '11-1101',
        financedAmount: '10000',
        storeCommission: null,
        interestTotal: '6000',
        vatAmount: '1190',
        totalMonths: 12,
        unpaidCount: 6,
        interestDiscountPercent: '50',
      });
      expect(drOf(r, '11-1101')).toBe('7594.98');
      expect(totals(r).dr).toBe('12690.00');
    });

    it('null vatAmount → grossExclVat × 7%', () => {
      // (10000 + 1000 + 6000) × 0.07 = 1190.00 → identical to case-4
      const r = computeEarlyPayoffJE({
        depositAccountCode: '11-1101',
        financedAmount: '10000',
        storeCommission: '1000',
        interestTotal: '6000',
        vatAmount: null,
        totalMonths: 12,
        unpaidCount: 6,
        interestDiscountPercent: '50',
      });
      expect(drOf(r, '21-2102')).toBe('595.02');
      expect(crOf(r, '21-2101')).toBe('595.02');
      expect(totals(r).dr).toBe('12690.00');
    });
  });

  // ── Deposit account dimension flows into the cash (Dr) line ──────────────────
  it('honours a custom depositAccountCode on the cash line', () => {
    const r = computeEarlyPayoffJE({
      depositAccountCode: '11-1201',
      financedAmount: '18000',
      storeCommission: '1800',
      interestTotal: '1800',
      vatAmount: '1512',
      totalMonths: 12,
      unpaidCount: 6,
      interestDiscountPercent: '50',
    });
    expect(r.lines[0].accountCode).toBe('11-1201');
    expect(r.lines[0].dr.toFixed(2)).toBe('11106.00');
  });

  // ── Accepts Decimal / number forms for the discount percent ──────────────────
  it('accepts Decimal and number forms for interestDiscountPercent', () => {
    const base = {
      depositAccountCode: '11-1101',
      financedAmount: '18000',
      storeCommission: '1800',
      interestTotal: '1800',
      vatAmount: '1512',
      totalMonths: 12,
      unpaidCount: 6,
    };
    const asDecimal = computeEarlyPayoffJE({ ...base, interestDiscountPercent: new Decimal('50') });
    const asNumber = computeEarlyPayoffJE({ ...base, interestDiscountPercent: 50 });
    const asString = computeEarlyPayoffJE({ ...base, interestDiscountPercent: '50' });
    expect(asDecimal.discount.toFixed(2)).toBe('450.00');
    expect(asNumber.discount.toFixed(2)).toBe('450.00');
    expect(asString.discount.toFixed(2)).toBe('450.00');
  });
  // ── ก1 (29/09/2569): งวดที่ยังไม่ชำระแต่ใบรับชำระบางส่วนตั้งลูกหนี้งวดไปแล้วบางส่วน ─────────────────
  // ส่วนที่ตั้งแล้วถูกล้างจาก 11-2101/11-2105/21-2102/11-2106 และรับรู้เป็น 41-1101/21-2101 ไปแล้ว —
  // JP4 ล้างเฉพาะส่วนที่เหลือ (ถ้าล้างเต็มงวด = รับรู้ดอกเบี้ย/ภาษีขายของส่วนนั้นซ้ำ)
  describe('ก1 — งวดที่ตั้งลูกหนี้งวดไปแล้วบางส่วน (accruedUnpaid)', () => {
    const base = {
      depositAccountCode: '11-1101',
      financedAmount: '10000',
      storeCommission: '1000',
      interestTotal: '6000',
      vatAmount: '1190',
      totalMonths: 12,
      unpaidCount: 6,
      interestDiscountPercent: '50',
    };

    it('งวด 7 รับบางส่วน 1,000 ก่อนครบกำหนด (2A 1,000 / VAT 65.42 / ดอกเบี้ย 329.85) → ล้างเฉพาะส่วนที่เหลือ', () => {
      const r = computeEarlyPayoffJE({
        ...base,
        accruedUnpaid: { amount: '1000.00', vat: '65.42', interest: '329.85' },
      });
      // gross 8,499.96 − (1,000 − 65.42) = 7,565.38 · ดอกเบี้ย 3,000 − 329.85 = 2,670.15 · VAT 595.02 − 65.42 = 529.60
      expect(r.remainingGross.toFixed(2)).toBe('7565.38');
      expect(r.remainingDeferredInterest.toFixed(2)).toBe('2670.15');
      expect(r.remainingDeferredVat.toFixed(2)).toBe('529.60');
      // ส่วนลด 50% ของดอกเบี้ยที่ยังไม่รับรู้ = 1,335.075 → 1,335.08
      expect(r.discount.toFixed(2)).toBe('1335.08');
      // 7,565.38 − 1,335.08 + 529.60
      expect(r.settlement.toFixed(2)).toBe('6759.90');
      expect(drOf(r, '11-1101')).toBe('6759.90');
      expect(drOf(r, '11-2106')).toBe('2670.15');
      expect(drOf(r, '21-2102')).toBe('529.60');
      expect(drOf(r, '52-1106')).toBe('1335.08');
      expect(crOf(r, '11-2101')).toBe('7565.38');
      expect(crOf(r, '11-2105')).toBe('529.60');
      expect(crOf(r, '41-1101')).toBe('2670.15');
      expect(crOf(r, '21-2101')).toBe('529.60');
      expect(totals(r)).toEqual({ dr: '11294.73', cr: '11294.73' });
      // JP4 ไม่มีขา 11-2103 (ส่วนที่ตั้งแล้วถูกใบรับชำระล้างไปแล้ว)
      expect(r.lines.find((l) => l.accountCode === '11-2103')).toBeUndefined();
    });

    it('ไม่ส่ง / ส่งศูนย์ → golden เดิมทุกบาท (7,594.98)', () => {
      expect(drOf(computeEarlyPayoffJE(base), '11-1101')).toBe('7594.98');
      expect(
        drOf(
          computeEarlyPayoffJE({ ...base, accruedUnpaid: { amount: '0', vat: '0', interest: '0' } }),
          '11-1101',
        ),
      ).toBe('7594.98');
    });

    it('sumAccruedUnpaid: รวมเฉพาะงวดที่ยังตั้งไม่ครบ (ลิงก์ว่าง) — งวดที่ตั้งครบแล้วไม่นับ (งานของ PR5)', () => {
      const d = (v: string) => new Decimal(v);
      const share = sumAccruedUnpaid([
        { accrualJournalEntryId: null, accruedAmount: d('1000'), accruedVat: d('65.42'), accruedInterest: d('329.85') },
        { accrualJournalEntryId: null, accruedAmount: d('500'), accruedVat: d('32.71'), accruedInterest: d('164.93') },
        { accrualJournalEntryId: 'JE-202609-00001', accruedAmount: d('1515.83'), accruedVat: d('99.17'), accruedInterest: d('500') },
        { accrualJournalEntryId: null, accruedAmount: d('0'), accruedVat: d('0'), accruedInterest: d('0') },
      ]);
      expect([share.amount, share.vat, share.interest].map((v) => v.toFixed(2))).toEqual([
        '1500.00',
        '98.13',
        '494.78',
      ]);
    });

    it('sumAccruedUnpaid: แถวที่ไม่ได้เลือกลิงก์หรือคอลัมน์ยอดสะสมมา → throw ไม่นับเป็นศูนย์หรือยังไม่เคยตั้ง', () => {
      const d = (v: string) => new Decimal(v);
      expect(() =>
        sumAccruedUnpaid([
          { accruedAmount: d('1515.83'), accruedVat: d('99.17'), accruedInterest: d('500') },
        ] as never),
      ).toThrow('accrualJournalEntryId is missing');
      expect(() => sumAccruedUnpaid([{ accrualJournalEntryId: null }] as never)).toThrow(
        'accruedAmount is missing',
      );
    });
  });
});

/**
 * PR5 — ปิดยอดก่อนกำหนดล้างตามยอดในบัญชี (คำตอบฝ่ายบัญชี เล่ม 1 ข้อ 5.1–5.4 · 29/09/2569).
 * สัญญาตัวอย่างของฝ่ายบัญชี: 17,000/12 งวด งวดละ 1,515.83 (ขายสด 12,000 ดาวน์ 2,000 ค่าคอม 1,000 ดอกเบี้ย 6,000
 * VAT 1,190) — รายการเปิดสัญญา (1A) ตั้ง 11-2101 17,000.00 · 11-2105 1,190.00 · 11-2106 6,000.00 · 21-2102 1,190.00
 */
describe('buildEarlyPayoffJE — รายการปิดยอดก่อนกำหนดตามยอดในบัญชี (PR5)', () => {
  const d = (v: string) => new Decimal(v);
  const ledger = (v: {
    gross: string;
    accrued?: string;
    vatReceivable: string;
    deferredInterest: string;
    deferredVat: string;
  }): EarlyPayoffLedger => ({
    gross: d(v.gross),
    accrued: d(v.accrued ?? '0'),
    vatReceivable: d(v.vatReceivable),
    deferredInterest: d(v.deferredInterest),
    deferredVat: d(v.deferredVat),
  });
  /** ยังไม่จ่ายเลย — ยอดหลังรายการเปิดสัญญา */
  const opened = ledger({
    gross: '17000.00',
    vatReceivable: '1190.00',
    deferredInterest: '6000.00',
    deferredVat: '1190.00',
  });
  const linesOf = (je: EarlyPayoffJe) =>
    je.lines.map((l) => `${l.accountCode}:${l.dr.toFixed(2)}:${l.cr.toFixed(2)}`);
  const totals = (je: EarlyPayoffJe) => ({
    dr: je.lines.reduce((s, l) => s.plus(l.dr), new Decimal(0)).toFixed(2),
    cr: je.lines.reduce((s, l) => s.plus(l.cr), new Decimal(0)).toFixed(2),
  });

  it('ตัวอย่างฝ่ายบัญชี: ยังไม่จ่ายเลย ส่วนลด 50% ลูกค้าจ่าย 15,189.98 → เงินสด 15,189.98 · 52-1106 3,000.02 · ล้างลูกหนี้ 17,000.00 / ภาษี 1,190.00 ตามบัญชี', () => {
    const je = buildEarlyPayoffJE({
      depositAccountCode: '11-1201',
      cashReceived: '15189.98',
      ledger: opened,
      discountPercent: '50',
    });
    expect(linesOf(je)).toEqual([
      '11-1201:15189.98:0.00',
      '11-2106:6000.00:0.00',
      '21-2102:1190.00:0.00',
      '52-1106:3000.02:0.00',
      '11-2101:0.00:17000.00',
      '11-2105:0.00:1190.00',
      '41-1101:0.00:6000.00',
      '21-2101:0.00:1190.00',
    ]);
    expect(totals(je)).toEqual({ dr: '25380.00', cr: '25380.00' });
    expect(je.receivableCleared.toFixed(2)).toBe('18190.00');
    expect(je.discount.toFixed(2)).toBe('3000.02');
    // ฐานข้อ 5.2 = 50% × 6,000.00 · ส่วนที่เกิน = เศษงวดสุดท้าย 0.02 (ผู้เรียกไม่บันทึก — ไม่เกิน 1.00)
    expect(je.deferredInterestDiscountBase.toFixed(2)).toBe('3000.00');
    expect(je.discountBeyondDeferredBase.toFixed(2)).toBe('0.02');
    expect(je.roundingGain.toFixed(2)).toBe('0.00');
    expect(je.excessReceived.toFixed(2)).toBe('0.00');
  });

  it('มีเงินพักค่าปรับดิว 1,044.00 ลูกค้าจ่าย 14,318.16 → Dr 21-1103 1,044.00 แทนเงินสด · 52-1106 2,827.84', () => {
    const je = buildEarlyPayoffJE({
      depositAccountCode: '11-1201',
      cashReceived: '14318.16',
      ledger: opened,
      parkRelief: '1044.00',
      discountPercent: '50',
    });
    expect(linesOf(je)).toEqual([
      '11-1201:14318.16:0.00',
      '11-2106:6000.00:0.00',
      '21-2102:1190.00:0.00',
      '52-1106:2827.84:0.00',
      '21-1103:1044.00:0.00',
      '11-2101:0.00:17000.00',
      '11-2105:0.00:1190.00',
      '41-1101:0.00:6000.00',
      '21-2101:0.00:1190.00',
    ]);
    expect(totals(je)).toEqual({ dr: '25380.00', cr: '25380.00' });
  });

  it('6 งวดค้าง งวดแรกรับบางส่วน 1,000 ก่อนครบกำหนด (2A เท่ายอดที่รับ) ลูกค้าจ่าย 7,062.28 → เงินสด = เงินที่รับ · ล้างส่วนที่ยังไม่ตั้งตามบัญชี · 52-1106 1,032.74', () => {
    const je = buildEarlyPayoffJE({
      depositAccountCode: '11-1201',
      cashReceived: '7062.28',
      // 6 งวดแรกตั้งและรับครบ · งวด 7 ตั้งเท่ายอดที่รับ 1,000 (ex-VAT 934.58 · VAT 65.42 · ดอกเบี้ย 329.85)
      ledger: ledger({
        gross: '7565.46',
        vatReceivable: '529.56',
        deferredInterest: '2670.15',
        deferredVat: '529.56',
      }),
      discountPercent: '50',
    });
    expect(linesOf(je)).toEqual([
      '11-1201:7062.28:0.00',
      '11-2106:2670.15:0.00',
      '21-2102:529.56:0.00',
      '52-1106:1032.74:0.00',
      '11-2101:0.00:7565.46',
      '11-2105:0.00:529.56',
      '41-1101:0.00:2670.15',
      '21-2101:0.00:529.56',
    ]);
    expect(totals(je)).toEqual({ dr: '11294.73', cr: '11294.73' });
  });

  it('ข้อ 5.1: งวด 1–4 ตั้งลูกหนี้แล้วค้าง (งวด 1 รับบางส่วน 500) → Cr 11-2103 ตามยอดค้างจริง 5,563.32 · ดอกเบี้ย/ภาษีรับรู้เฉพาะ 8 งวดที่ยังไม่ถึงกำหนด · 52-1106 เกินฐานข้อ 5.2 (50% × 4,000.00) อยู่ 766.37', () => {
    const je = buildEarlyPayoffJE({
      depositAccountCode: '11-1201',
      cashReceived: '14923.63',
      ledger: ledger({
        gross: '11333.36',
        accrued: '5563.32',
        vatReceivable: '793.32',
        deferredInterest: '4000.00',
        deferredVat: '793.32',
      }),
      discountPercent: '50',
    });
    expect(linesOf(je)).toEqual([
      '11-1201:14923.63:0.00',
      '11-2106:4000.00:0.00',
      '21-2102:793.32:0.00',
      '52-1106:2766.37:0.00',
      '11-2103:0.00:5563.32',
      '11-2101:0.00:11333.36',
      '11-2105:0.00:793.32',
      '41-1101:0.00:4000.00',
      '21-2101:0.00:793.32',
    ]);
    expect(totals(je)).toEqual({ dr: '22483.32', cr: '22483.32' });
    // ส่วนลดบนจอคิดจากทุกงวดค้าง (รวม 4 งวดที่ตั้งลูกหนี้แล้ว) ⇒ 2,766.37 − ฐานข้อ 5.2 2,000.00 = 766.37 (ถ1)
    expect(je.deferredInterestDiscountBase.toFixed(2)).toBe('2000.00');
    expect(je.discountBeyondDeferredBase.toFixed(2)).toBe('766.37');
  });

  it('ข้อ 5.2 เทียบ 5.3: 4 งวดตั้งลูกหนี้แล้วค้าง + 4 งวดยังไม่ถึงกำหนด ลูกค้าจ่าย 10,126.65 → 52-1106 2,000.03 · ฐานข้อ 5.2 1,000.00 (50% × ดอกเบี้ย 4 งวด 2,000.00) · เกิน 1,000.03', () => {
    const je = buildEarlyPayoffJE({
      depositAccountCode: '11-1201',
      cashReceived: '10126.65',
      // 4 งวดแรกตั้งและรับครบ · งวด 5–8 ตั้งลูกหนี้แล้วค้าง (4 × 1,515.83) · งวด 9–12 ยังไม่ถึงกำหนด (งวด 12 ถือเศษ)
      ledger: ledger({
        gross: '5666.72',
        accrued: '6063.32',
        vatReceivable: '396.64',
        deferredInterest: '2000.00',
        deferredVat: '396.64',
      }),
      discountPercent: '50',
    });
    expect(je.receivableCleared.toFixed(2)).toBe('12126.68');
    expect(je.discount.toFixed(2)).toBe('2000.03');
    expect(je.deferredInterestDiscountBase.toFixed(2)).toBe('1000.00');
    expect(je.discountBeyondDeferredBase.toFixed(2)).toBe('1000.03');
    expect(totals(je)).toEqual({ dr: '14523.32', cr: '14523.32' });
  });

  it('ข้อ 5.2: งวดที่ตั้งแล้วค้าง 9 งวด เหลือยังไม่ถึงกำหนด 3 งวด → 52-1106 3,000.02 มากกว่าดอกเบี้ยที่ยังไม่รับรู้ทั้งก้อน (1,500.00) · เกินฐานข้อ 5.2 (750.00) อยู่ 2,250.02 (ลงทั้งก้อนตามข้อ 5.3 · บอกยอดที่เกินไว้)', () => {
    const je = buildEarlyPayoffJE({
      depositAccountCode: '11-1201',
      cashReceived: '15189.98',
      ledger: ledger({
        gross: '4250.06',
        accrued: '13642.47',
        vatReceivable: '297.47',
        deferredInterest: '1500.00',
        deferredVat: '297.47',
      }),
      discountPercent: '50',
    });
    expect(je.discount.toFixed(2)).toBe('3000.02');
    expect(je.deferredInterestDiscountBase.toFixed(2)).toBe('750.00');
    expect(je.discountBeyondDeferredBase.toFixed(2)).toBe('2250.02');
    expect(totals(je)).toEqual({ dr: '19987.47', cr: '19987.47' });
  });

  it('ข้อ 5.1: งวดที่เหลือตั้งลูกหนี้ครบทุกงวดแล้ว (11-2103 18,190.00 · ไม่มีส่วนที่ยังไม่ถึงกำหนด) → ไม่มีบรรทัด 11-2106 / 21-2102 / 41-1101 / 21-2101 · ไม่รับรู้ดอกเบี้ยหรือภาษีขายซ้ำ', () => {
    const je = buildEarlyPayoffJE({
      depositAccountCode: '11-1201',
      cashReceived: '15189.98',
      ledger: ledger({
        gross: '0.00',
        accrued: '18190.00',
        vatReceivable: '0.00',
        deferredInterest: '0.00',
        deferredVat: '0.00',
      }),
      discountPercent: '50',
    });
    expect(linesOf(je)).toEqual([
      '11-1201:15189.98:0.00',
      '52-1106:3000.02:0.00',
      '11-2103:0.00:18190.00',
    ]);
    expect(je.deferredInterest.toFixed(2)).toBe('0.00');
    expect(je.deferredInterestDiscountBase.toFixed(2)).toBe('0.00');
    expect(je.discountBeyondDeferredBase.toFixed(2)).toBe('3000.02');
    expect(je.ledger.accrued.toFixed(2)).toBe('18190.00');
  });

  it('จ่ายงวด 1 ในวันครบกำหนดก่อนรอบกลางคืนตั้งลูกหนี้งวด (11-2103 ติดลบ 1,515.83) → Dr 11-2103 1,515.83 · ล้าง 11-2101 ทั้งก้อน · รับรู้ดอกเบี้ย 6,000.00 ครบ', () => {
    const je = buildEarlyPayoffJE({
      depositAccountCode: '11-1201',
      cashReceived: '13924.15',
      ledger: ledger({
        gross: '17000.00',
        accrued: '-1515.83',
        vatReceivable: '1190.00',
        deferredInterest: '6000.00',
        deferredVat: '1190.00',
      }),
      discountPercent: '50',
    });
    expect(linesOf(je)).toEqual([
      '11-1201:13924.15:0.00',
      '11-2106:6000.00:0.00',
      '21-2102:1190.00:0.00',
      '52-1106:2750.02:0.00',
      '11-2103:1515.83:0.00',
      '11-2101:0.00:17000.00',
      '11-2105:0.00:1190.00',
      '41-1101:0.00:6000.00',
      '21-2101:0.00:1190.00',
    ]);
    expect(totals(je)).toEqual({ dr: '25380.00', cr: '25380.00' });
  });

  it('ค่าปรับ 100 + เงินเกินของลูกค้า 300 → Cr 42-1103 100.00 (เงินสดรวมค่าปรับ) · Dr 21-5101 300.00 แทนเงินสด', () => {
    const je = buildEarlyPayoffJE({
      depositAccountCode: '11-1201',
      cashReceived: '15130.17',
      ledger: opened,
      unpaidLateFees: '100.00',
      creditRelief: '300.00',
      discountPercent: '50',
    });
    expect(linesOf(je)).toEqual([
      '11-1201:15130.17:0.00',
      '11-2106:6000.00:0.00',
      '21-2102:1190.00:0.00',
      '52-1106:2859.83:0.00',
      '21-5101:300.00:0.00',
      '11-2101:0.00:17000.00',
      '11-2105:0.00:1190.00',
      '41-1101:0.00:6000.00',
      '21-2101:0.00:1190.00',
      '42-1103:0.00:100.00',
    ]);
    expect(totals(je)).toEqual({ dr: '25480.00', cr: '25480.00' });
  });

  it('ส่วนลด 0% ลูกค้าจ่ายมากกว่าลูกหนี้ตามบัญชี 0.08 (ค่างวดปัดขึ้น) → ไม่มี 52-1106 · Cr 53-1503 0.08', () => {
    const je = buildEarlyPayoffJE({
      depositAccountCode: '11-1201',
      cashReceived: '18190.08',
      ledger: opened,
      discountPercent: '0',
    });
    expect(linesOf(je)).toEqual([
      '11-1201:18190.08:0.00',
      '11-2106:6000.00:0.00',
      '21-2102:1190.00:0.00',
      '11-2101:0.00:17000.00',
      '11-2105:0.00:1190.00',
      '41-1101:0.00:6000.00',
      '21-2101:0.00:1190.00',
      '53-1503:0.00:0.08',
    ]);
    expect(je.roundingGain.toFixed(2)).toBe('0.08');
    expect(je.discount.toFixed(2)).toBe('0.00');
    expect(totals(je)).toEqual({ dr: '25380.08', cr: '25380.08' });
  });

  it('เงินที่รับ + เงินของลูกค้าเกินลูกหนี้ตามบัญชี: พอดี 1.00 → Cr 53-1503 1.00 · เกิน 1.01 → excessReceived 1.01 ไม่มีบรรทัดรับ (ผู้เรียกปฏิเสธ)', () => {
    const atLimit = buildEarlyPayoffJE({
      depositAccountCode: '11-1201',
      cashReceived: '18191.00',
      ledger: opened,
      discountPercent: '0',
    });
    expect(atLimit.roundingGain.toFixed(2)).toBe('1.00');
    expect(atLimit.excessReceived.toFixed(2)).toBe('0.00');
    expect(totals(atLimit)).toEqual({ dr: '25381.00', cr: '25381.00' });

    const over = buildEarlyPayoffJE({
      depositAccountCode: '11-1201',
      cashReceived: '17891.01',
      ledger: opened,
      creditRelief: '300.00',
      discountPercent: '0',
    });
    expect(over.excessReceived.toFixed(2)).toBe('1.01');
    expect(over.roundingGain.toFixed(2)).toBe('0.00');
    expect(over.discount.toFixed(2)).toBe('0.00');
    expect(over.lines.map((l) => l.accountCode)).not.toContain('53-1503');
    expect(over.lines.map((l) => l.accountCode)).not.toContain('52-1106');
    expect(totals(over)).toEqual({ dr: '25381.01', cr: '25380.00' });
  });

  it('ยอดเงินที่ส่งเข้าติดลบหรือเกิน 2 ตำแหน่ง → throw (ห้ามลงยอดที่ฐานข้อมูลจะปัดเพี้ยน)', () => {
    expect(() =>
      buildEarlyPayoffJE({
        depositAccountCode: '11-1201',
        cashReceived: '-1',
        ledger: opened,
        discountPercent: '50',
      }),
    ).toThrow('cashReceived must be a non-negative amount with at most 2 decimals');
    expect(() =>
      buildEarlyPayoffJE({
        depositAccountCode: '11-1201',
        cashReceived: '15189.98',
        ledger: opened,
        parkRelief: '354.005',
        discountPercent: '50',
      }),
    ).toThrow('parkRelief must be a non-negative amount with at most 2 decimals');
  });
});

describe('readEarlyPayoffLedger / buildEarlyPayoffJournal — อ่านยอดในบัญชีของสัญญา (PR5)', () => {
  const contract = (cols: {
    advanceBalance?: string;
    rescheduleAdvanceBalance?: string;
    creditBalance?: string;
  }) => ({
    id: 'contract-jp4-ledger',
    contractNumber: 'CT-JP4-LEDGER',
    advanceBalance: new Decimal(cols.advanceBalance ?? '0'),
    rescheduleAdvanceBalance: new Decimal(cols.rescheduleAdvanceBalance ?? '0'),
    creditBalance: new Decimal(cols.creditBalance ?? '0'),
  });

  it('อ่าน 11-2101 / 11-2103 / 11-2105 ด้าน Dr และ 11-2106 / 21-2102 ด้าน Cr ของสัญญาด้วย client ที่ส่งมา', async () => {
    const findMany = jest.fn(
      ledgerLines({
        '11-2101': '11333.36',
        '11-2103': '5563.32',
        '11-2105': '793.32',
        '11-2106': '4000.00',
        '21-2102': '793.32',
      }),
    );
    const l = await readEarlyPayoffLedger({ journalLine: { findMany } } as never, 'contract-x');
    expect(
      [l.gross, l.accrued, l.vatReceivable, l.deferredInterest, l.deferredVat].map((v) =>
        v.toFixed(2),
      ),
    ).toEqual(['11333.36', '5563.32', '793.32', '4000.00', '793.32']);
    expect(findMany.mock.calls.map((c) => c[0].where.accountCode)).toEqual([
      '11-2101',
      '11-2103',
      '11-2105',
      '11-2106',
      '21-2102',
    ]);
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { journalEntry: { metadata: { path: ['contractId'], equals: 'contract-x' } } },
    });
  });

  it('เงินพักที่หัก = min(ยอดที่ยอดปิดหักให้ 1,044, คอลัมน์ถังพัก 1,044, ยอด 21-1103 ในบัญชี 1,544 — มีถังรวม 500) · เงินเกินของลูกค้า 300 · ถังรวมไม่ถูกหัก · คอลัมน์ตรงบัญชีและ 52-1106 ต่างจากส่วนลดบนจอ 0.04 → ไม่มีสัญญาณ', async () => {
    const findMany = jest.fn(
      ledgerLines({
        '11-2101': '17000.00',
        '11-2105': '1190.00',
        '11-2106': '6000.00',
        '21-2102': '1190.00',
        '21-1103': '1544.00',
        '21-5101': '300.00',
      }),
    );
    const je = await buildEarlyPayoffJournal({ journalLine: { findMany } } as never, {
      contract: contract({
        advanceBalance: '500',
        rescheduleAdvanceBalance: '1044',
        creditBalance: '300',
      }),
      depositAccountCode: '11-1201',
      // computePayoffQuote (เครดิต 300 · ถังพัก 1,044 · ส่วนลด 50%): ยอดปิด 14,158.35 · ส่วนลด 2,687.61
      cashReceived: '14158.35',
      unpaidLateFees: '0',
      parkReliefApplied: '1044.00',
      quoteDiscountAmount: '2687.61',
      discountPercent: '50',
    });
    expect(je.parkRelief.toFixed(2)).toBe('1044.00');
    expect(je.creditRelief.toFixed(2)).toBe('300.00');
    // 18,190.00 − 14,158.35 − 1,044.00 − 300.00 (ถังรวม 500 ไม่ถูกหัก — ยังเป็นเงินของลูกค้าใน 21-1103)
    expect(je.discount.toFixed(2)).toBe('2687.65');
    expect(je.warnings).toEqual([]);
  });

  it('เงินเกินของลูกค้าที่หัก = min(คอลัมน์ที่ยอดปิดหักให้, ยอด 21-5101 ในบัญชี): บัญชี 2,000 คอลัมน์ 0 → ไม่หัก (2,000 ยังเป็นเงินของลูกค้า) + สัญญาณเตือน · คอลัมน์ 300 → หัก 300', async () => {
    const ledger = {
      '11-2101': '17000.00',
      '11-2105': '1190.00',
      '11-2106': '6000.00',
      '21-2102': '1190.00',
      '21-5101': '2000.00',
    };
    const notDeducted = await buildEarlyPayoffJournal(
      { journalLine: { findMany: jest.fn(ledgerLines(ledger)) } } as never,
      {
        contract: contract({}),
        depositAccountCode: '11-1201',
        cashReceived: '15189.98',
        unpaidLateFees: '0',
        parkReliefApplied: '0',
        quoteDiscountAmount: '2999.98',
        discountPercent: '50',
      },
    );
    expect(notDeducted.creditRelief.toFixed(2)).toBe('0.00');
    expect(notDeducted.lines.map((l) => l.accountCode)).not.toContain('21-5101');
    expect(notDeducted.discount.toFixed(2)).toBe('3000.02');
    expect(notDeducted.excessReceived.toFixed(2)).toBe('0.00');
    expect(notDeducted.warnings.map((w) => w.tags.action)).toEqual([
      'close-advance-ledger-mismatch',
    ]);
    expect(notDeducted.warnings[0].extra).toMatchObject({
      ledger21_5101: '2000.00',
      creditBalance: '0.00',
    });

    // computePayoffQuote (เครดิต 300): ยอดปิด 15,030.17 · ส่วนลด 2,859.79
    const partly = await buildEarlyPayoffJournal(
      { journalLine: { findMany: jest.fn(ledgerLines(ledger)) } } as never,
      {
        contract: contract({ creditBalance: '300' }),
        depositAccountCode: '11-1201',
        cashReceived: '15030.17',
        unpaidLateFees: '0',
        parkReliefApplied: '0',
        quoteDiscountAmount: '2859.79',
        discountPercent: '50',
      },
    );
    expect(partly.creditRelief.toFixed(2)).toBe('300.00');
    expect(partly.discount.toFixed(2)).toBe('2859.83');
    expect(partly.warnings.map((w) => w.tags.action)).toEqual(['close-advance-ledger-mismatch']);
  });

  it('52-1106 ต่างจากส่วนลดบนหน้าจอเกิน 1.00 (ยอดในบัญชีมากกว่ายอดค้างตามงวด) → สัญญาณเตือน early-payoff-discount-vs-quote · ต่างไม่เกิน 1.00 → ไม่มี', async () => {
    const opened = {
      '11-2101': '17000.00',
      '11-2105': '1190.00',
      '11-2106': '6000.00',
      '21-2102': '1190.00',
    };
    const input = {
      contract: contract({}),
      depositAccountCode: '11-1201',
      cashReceived: '15189.98',
      unpaidLateFees: '0',
      parkReliefApplied: '0',
      quoteDiscountAmount: '2999.98',
      discountPercent: '50',
    };
    // ปกติ: 3,000.02 เทียบจอ 2,999.98 (เศษงวดสุดท้าย 0.04)
    const normal = await buildEarlyPayoffJournal(
      { journalLine: { findMany: jest.fn(ledgerLines(opened)) } } as never,
      input,
    );
    expect(normal.warnings).toEqual([]);

    // ลูกหนี้ในบัญชีเกินยอดค้างตามงวด 1,515.83 (เช่นแถวงวดถูกตั้ง PAID โดยไม่มีรายการรับชำระ)
    const anomaly = await buildEarlyPayoffJournal(
      {
        journalLine: {
          findMany: jest.fn(
            ledgerLines({
              ...opened,
              '11-2101': '18416.66',
              '11-2105': '1289.17',
              '11-2106': '6500.00',
              '21-2102': '1289.17',
            }),
          ),
        },
      } as never,
      input,
    );
    expect(anomaly.discount.toFixed(2)).toBe('4515.85');
    expect(anomaly.warnings).toHaveLength(1);
    expect(anomaly.warnings[0]).toMatchObject({
      message: '[early-payoff] 52-1106 differs from the payoff-screen discount by more than 1.00',
      tags: { module: 'journal', action: 'early-payoff-discount-vs-quote', flow: 'early-payoff' },
      extra: {
        contractId: 'contract-jp4-ledger',
        discount: '4515.85',
        quoteDiscountAmount: '2999.98',
        difference: '1515.87',
      },
    });
  });

  it('ยอด 21-1103 ในบัญชีน้อยกว่าคอลัมน์ถังพัก → หักเงินพักเท่ายอดในบัญชี 200 · ส่วนที่ขาด 154 ไหลเข้า 52-1106 → สัญญาณเตือนสองตัว flow early-payoff (ผู้เรียกส่งหลัง commit)', async () => {
    const findMany = jest.fn(
      ledgerLines({
        '11-2101': '17000.00',
        '11-2105': '1190.00',
        '11-2106': '6000.00',
        '21-2102': '1190.00',
        '21-1103': '200.00',
      }),
    );
    const je = await buildEarlyPayoffJournal({ journalLine: { findMany } } as never, {
      contract: contract({ rescheduleAdvanceBalance: '354' }),
      depositAccountCode: '11-1201',
      // computePayoffQuote (ถังพัก 354 · ส่วนลด 50%): ยอดปิด 14,894.37 · ส่วนลด 2,941.59
      cashReceived: '14894.37',
      unpaidLateFees: '0',
      parkReliefApplied: '354.00',
      quoteDiscountAmount: '2941.59',
      discountPercent: '50',
    });
    expect(je.parkRelief.toFixed(2)).toBe('200.00');
    // 18,190.00 − 14,894.37 − 200.00 = 3,095.63 (ส่วนลดบนจอ 2,941.59 + เงินพักที่ไม่มีในบัญชี 154.00 + เศษ 0.04)
    expect(je.discount.toFixed(2)).toBe('3095.63');
    expect(je.warnings).toHaveLength(2);
    expect(je.warnings[1].tags.action).toBe('early-payoff-discount-vs-quote');
    expect(je.warnings[1].extra).toMatchObject({ difference: '154.04' });
    expect(je.warnings[0].tags).toEqual({
      module: 'journal',
      action: 'close-advance-ledger-mismatch',
      flow: 'early-payoff',
    });
    expect(je.warnings[0].extra).toMatchObject({
      contractId: 'contract-jp4-ledger',
      ledger21_1103: '200.00',
      rescheduleAdvanceBalance: '354.00',
    });
  });
});
