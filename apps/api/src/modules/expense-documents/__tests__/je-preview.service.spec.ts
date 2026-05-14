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
});
