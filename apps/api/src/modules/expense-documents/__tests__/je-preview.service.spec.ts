import { JePreviewService } from '../services/je-preview.service';
import { LineAggregatorService } from '../services/line-aggregator.service';

describe('JePreviewService', () => {
  let svc: JePreviewService;
  const names = new Map<string, string>([
    ['53-1101', 'ค่าใช้จ่ายเงินเดือน'],
    ['53-1404', 'ค่าทำความสะอาด'],
    ['11-4101', 'ภาษีซื้อ'],
    ['11-1101', 'เงินสด'],
    ['11-1201', 'KBank'],
    ['21-1104', 'AP กิจการ'],
    ['21-3102', 'PND.3'],
    ['21-3103', 'PND.53'],
  ]);

  beforeEach(() => {
    svc = new JePreviewService(new LineAggregatorService());
  });

  it('same-day: 1 line, 7% VAT, no WHT — balanced', () => {
    const r = svc.preview({
      documentType: 'EXPENSE', branchId: 'b1', documentDate: '2026-05-11',
      priceType: 'EXCLUSIVE',
      paymentMethod: 'CASH', depositAccountCode: '11-1101',
      lines: [{ category: '53-1101', quantity: 1, unitPrice: 4500, vatPercent: 7, whtPercent: 0 }],
    } as never, names);
    expect(r.flow).toBe('expense-same-day');
    expect(r.totals.balanced).toBe(true);
    expect(r.totals.drSum).toBe('4815.00');
    expect(r.totals.crSum).toBe('4815.00');
    expect(r.lines.find((l) => l.accountCode === '53-1101')?.dr).toBe('4500.00');
    // VAT must book to 11-4101 (Input Tax Credit), NOT 11-2104 (ม.83/6 overseas).
    // Mirrors expense-same-day.template.ts:119 and expense-accrual.template.ts:93.
    expect(r.lines.find((l) => l.accountCode === '11-4101')?.dr).toBe('315.00');
    expect(r.lines.find((l) => l.accountCode === '11-2104')).toBeUndefined();
    expect(r.lines.find((l) => l.accountCode === '11-1101')?.cr).toBe('4815.00');
  });

  it('accrual: 2 lines, no payment — balanced via 21-1104', () => {
    const r = svc.preview({
      documentType: 'EXPENSE', branchId: 'b1', documentDate: '2026-05-11',
      priceType: 'EXCLUSIVE',
      lines: [
        { category: '53-1101', quantity: 1, unitPrice: 5000, vatPercent: 7, whtPercent: 0 },
        { category: '53-1404', quantity: 1, unitPrice: 1500, vatPercent: 7, whtPercent: 0 },
      ],
    } as never, names);
    expect(r.flow).toBe('expense-accrual');
    expect(r.totals.balanced).toBe(true);
    expect(r.lines.find((l) => l.accountCode === '21-1104')?.cr).toBe('6955.00');
  });

  it('PND.53 routing — WHT lands on 21-3103', () => {
    const r = svc.preview({
      documentType: 'EXPENSE', branchId: 'b1', documentDate: '2026-05-11',
      priceType: 'EXCLUSIVE',
      paymentMethod: 'BANK_TRANSFER', depositAccountCode: '11-1201',
      whtFormType: 'PND53',
      lines: [{ category: '53-1404', quantity: 1, unitPrice: 10000, vatPercent: 7, whtPercent: 3 }],
    } as never, names);
    expect(r.lines.find((l) => l.accountCode === '21-3103')?.cr).toBe('300.00');
    expect(r.totals.balanced).toBe(true);
  });

  it('multiple lines same category collapse to ONE Dr row', () => {
    const r = svc.preview({
      documentType: 'EXPENSE', branchId: 'b1', documentDate: '2026-05-11',
      priceType: 'EXCLUSIVE',
      paymentMethod: 'CASH', depositAccountCode: '11-1101',
      lines: [
        { category: '53-1101', quantity: 1, unitPrice: 1000, vatPercent: 7, whtPercent: 0 },
        { category: '53-1101', quantity: 2, unitPrice: 500,  vatPercent: 7, whtPercent: 0 },
      ],
    } as never, names);
    const drExpense = r.lines.filter((l) => l.accountCode === '53-1101');
    expect(drExpense).toHaveLength(1);
    expect(drExpense[0].dr).toBe('2000.00');
  });

  // Regression: Fix #C7. The accounts shown in the preview must match
  // the accounts the post() will actually book. Specifically, VAT must
  // always be 11-4101 (Input Tax Credit) and never 11-2104 (ม.83/6 overseas).
  it('preview never books VAT to 11-2104 (P0-1 regression guard)', () => {
    const r = svc.preview({
      documentType: 'EXPENSE', branchId: 'b1', documentDate: '2026-05-11',
      priceType: 'EXCLUSIVE',
      paymentMethod: 'CASH', depositAccountCode: '11-1101',
      lines: [{ category: '53-1101', quantity: 1, unitPrice: 1000, vatPercent: 7, whtPercent: 0 }],
    } as never, names);
    expect(r.lines.some((l) => l.accountCode === '11-2104')).toBe(false);
    expect(r.lines.some((l) => l.accountCode === '11-4101')).toBe(true);
  });

  // Regression: Fix #C7. Same VAT routing rule on the accrual path
  // (no payment supplied → flow=expense-accrual). Mirrors the
  // expense-accrual.template.ts:93 booking.
  it('accrual preview also books VAT to 11-4101 (not 11-2104)', () => {
    const r = svc.preview({
      documentType: 'EXPENSE', branchId: 'b1', documentDate: '2026-05-11',
      priceType: 'EXCLUSIVE',
      lines: [{ category: '53-1101', quantity: 1, unitPrice: 1000, vatPercent: 7, whtPercent: 0 }],
    } as never, names);
    expect(r.flow).toBe('expense-accrual');
    expect(r.lines.some((l) => l.accountCode === '11-2104')).toBe(false);
    expect(r.lines.some((l) => l.accountCode === '11-4101')).toBe(true);
  });

  // W8 — adjustments are rendered as Dr/Cr rows in the preview, matching
  // the actual JE that expense-same-day.template.ts will book. Service
  // V12 keeps signedSum=diff so the rendered JE balances.
  // Scenario: expected 1000, paid 1001 → overpay, Cr cash=1001 and we Dr
  //   the 1฿ to 53-1503 (loss on rounding).
  //   Service signedSum check: side='DR' amt=1 → signedSum = -1.
  //   diff = amountPaid − netExpected = 1001 − 1000 = +1.
  //   ❌ -1 ≠ +1 → would fail V12.
  //   So the only consistent direction here is side='CR' amt=1.
  // We bypass service V12 here (we're testing JePreviewService directly).
  it('W8: renders adjustment rows in the preview', () => {
    const r = svc.preview({
      documentType: 'EXPENSE', branchId: 'b1', documentDate: '2026-05-11',
      priceType: 'EXCLUSIVE',
      paymentMethod: 'CASH', depositAccountCode: '11-1101',
      lines: [{ category: '53-1101', quantity: 1, unitPrice: 1000, vatPercent: 0, whtPercent: 0 }],
      // No amountPaid → cashCr = totalAmount − wht = 1000. Adjustment row
      // appears in the preview regardless of V12 balance (preview is best-
      // effort; service validates V12 separately before the JE is written).
      adjustments: [
        { accountCode: '52-1104', side: 'DR', amount: '1', note: 'ปรับเศษ' },
        { accountCode: '53-1503', side: 'CR', amount: '1' },
      ],
    } as never, new Map<string, string>([
      ['53-1101', 'salary'],
      ['11-1101', 'cash'],
      ['52-1104', 'ส่วนลดเศษสตางค์'],
      ['53-1503', 'กำไรจากการปัดเศษ'],
    ]));
    const dradj = r.lines.find((l) => l.accountCode === '52-1104');
    const cradj = r.lines.find((l) => l.accountCode === '53-1503');
    expect(dradj).toBeDefined();
    expect(dradj!.dr).toBe('1.00');
    expect(dradj!.cr).toBe('0.00');
    expect(cradj).toBeDefined();
    expect(cradj!.cr).toBe('1.00');
    expect(cradj!.dr).toBe('0.00');
    // Both adjustments balance each other (Dr 1, Cr 1) — overall JE balanced.
    expect(r.totals.balanced).toBe(true);
  });

  // W8 — per-line whtFormType emits both 21-3102 and 21-3103 when a doc
  // mixes individual + juristic vendors. Mirrors expense-same-day.template
  // line 146-182 (P2-4 routing).
  it('W8: per-line whtFormType routes WHT to both 21-3102 and 21-3103', () => {
    const r = svc.preview({
      documentType: 'EXPENSE', branchId: 'b1', documentDate: '2026-05-11',
      priceType: 'EXCLUSIVE',
      paymentMethod: 'BANK_TRANSFER', depositAccountCode: '11-1201',
      lines: [
        { category: '53-1101', quantity: 1, unitPrice: 1000, vatPercent: 0, whtPercent: 1, whtFormType: 'PND3' },
        { category: '53-1404', quantity: 1, unitPrice: 2000, vatPercent: 0, whtPercent: 3, whtFormType: 'PND53' },
      ],
    } as never, names);
    const pnd3 = r.lines.find((l) => l.accountCode === '21-3102');
    const pnd53 = r.lines.find((l) => l.accountCode === '21-3103');
    expect(pnd3?.cr).toBe('10.00'); // 1% × 1000
    expect(pnd53?.cr).toBe('60.00'); // 3% × 2000
    expect(r.totals.balanced).toBe(true);
  });
});
