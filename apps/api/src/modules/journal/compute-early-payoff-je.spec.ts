import { Decimal } from '@prisma/client/runtime/library';
import { computeEarlyPayoffJE } from './compute-early-payoff-je';

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
});
