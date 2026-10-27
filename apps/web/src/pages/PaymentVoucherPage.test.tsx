import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Decimal from 'decimal.js';

const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({ default: { get: (...a: unknown[]) => apiGet(...a) } }));
vi.mock('@/hooks/useCompanyInfo', () => ({
  useCompanyInfo: () => ({}),
  useCompanyDisplayName: () => 'บริษัท เบสท์ช้อยส์โฟน จำกัด',
  useCompanyAddress: () => '',
  useCompanyTaxId: () => '',
  useCompanyLogoUrl: () => null,
}));
vi.mock('@/hooks/useUiFlags', () => ({ useUiFlags: () => ({ voucherPrintMode: 'single', voucherIncludeAdjustment: false }) }));

import PaymentVoucherPage, { bucketWhtByRate } from './PaymentVoucherPage';

/**
 * W7 (Round 2) — Form 50 ทวิ is a legal cert; per-row sums MUST equal
 * the line-by-line totals exactly. parseFloat + += would drift on mixed-
 * rate docs. These tests pin the Decimal-precision contract.
 */
describe('bucketWhtByRate — W7 Decimal precision', () => {
  it('mixed 3% + 5% + 1% rates → three buckets with exact per-rate sums', () => {
    // Lines that intentionally exercise float drift: 0.1, 0.2, 0.3 + irrationals
    const lines = [
      // 3% bucket
      { lineNo: 1, category: '53-1302', description: 'a', quantity: '1',
        unitPrice: '100', amountBeforeVat: '100.10', vatAmount: '7',
        whtAmount: '3.00', whtPercent: '3' },
      { lineNo: 2, category: '53-1302', description: 'b', quantity: '1',
        unitPrice: '200', amountBeforeVat: '200.20', vatAmount: '14',
        whtAmount: '6.00', whtPercent: '3' },
      // 5% bucket
      { lineNo: 3, category: '53-1303', description: 'c', quantity: '1',
        unitPrice: '1000', amountBeforeVat: '1000.33', vatAmount: '70',
        whtAmount: '50.00', whtPercent: '5' },
      // 1% bucket
      { lineNo: 4, category: '53-1304', description: 'd', quantity: '1',
        unitPrice: '5000', amountBeforeVat: '5000.10', vatAmount: '350',
        whtAmount: '50.00', whtPercent: '1' },
    ];
    const subtotal = new Decimal('6300.73');
    const wht = new Decimal('109.00');
    const buckets = bucketWhtByRate(lines, subtotal, wht);

    expect(buckets).toHaveLength(3);
    const byRate = new Map(buckets.map((b) => [b.rate.toFixed(2), b]));

    // 3% bucket: 100.10 + 200.20 = 300.30 (exact); tax = 9.00
    expect(byRate.get('3.00')!.base.toFixed(2)).toBe('300.30');
    expect(byRate.get('3.00')!.tax.toFixed(2)).toBe('9.00');
    // 5% bucket
    expect(byRate.get('5.00')!.base.toFixed(2)).toBe('1000.33');
    expect(byRate.get('5.00')!.tax.toFixed(2)).toBe('50.00');
    // 1% bucket
    expect(byRate.get('1.00')!.base.toFixed(2)).toBe('5000.10');
    expect(byRate.get('1.00')!.tax.toFixed(2)).toBe('50.00');
  });

  it('per-bucket totals equal the line-by-line sum exactly (no float drift)', () => {
    // 100 lines @ 0.1 each = 10.00 exact (parseFloat would give 9.999...)
    const lines = Array.from({ length: 100 }, (_, i) => ({
      lineNo: i + 1, category: '53-1302', description: '', quantity: '1',
      unitPrice: '0.1', amountBeforeVat: '0.1', vatAmount: '0',
      whtAmount: '0.003', whtPercent: '3',
    }));
    const buckets = bucketWhtByRate(lines, new Decimal('10'), new Decimal('0.30'));
    expect(buckets).toHaveLength(1);
    expect(buckets[0].base.toFixed(2)).toBe('10.00');
    expect(buckets[0].tax.toFixed(2)).toBe('0.30');
  });

  it('legacy fallback — no rated lines → single weighted-average bucket', () => {
    const buckets = bucketWhtByRate([], new Decimal('1000'), new Decimal('30'));
    expect(buckets).toHaveLength(1);
    expect(buckets[0].rate.toFixed(2)).toBe('3.00');
    expect(buckets[0].base.toFixed(2)).toBe('1000.00');
    expect(buckets[0].tax.toFixed(2)).toBe('30.00');
  });

  it('legacy fallback — zero subtotal → zero rate (no division by zero)', () => {
    const buckets = bucketWhtByRate([], new Decimal('0'), new Decimal('0'));
    expect(buckets).toHaveLength(1);
    expect(buckets[0].rate.toFixed(2)).toBe('0.00');
  });

  it('buckets are sorted descending by tax amount', () => {
    const lines = [
      { lineNo: 1, category: '53-1302', description: '', quantity: '1',
        unitPrice: '100', amountBeforeVat: '100', vatAmount: '0',
        whtAmount: '1', whtPercent: '1' },
      { lineNo: 2, category: '53-1303', description: '', quantity: '1',
        unitPrice: '100', amountBeforeVat: '100', vatAmount: '0',
        whtAmount: '5', whtPercent: '5' },
      { lineNo: 3, category: '53-1304', description: '', quantity: '1',
        unitPrice: '100', amountBeforeVat: '100', vatAmount: '0',
        whtAmount: '3', whtPercent: '3' },
    ];
    const buckets = bucketWhtByRate(lines, new Decimal('300'), new Decimal('9'));
    expect(buckets[0].rate.toFixed(2)).toBe('5.00');
    expect(buckets[1].rate.toFixed(2)).toBe('3.00');
    expect(buckets[2].rate.toFixed(2)).toBe('1.00');
  });

  it('ignores lines with whtAmount=0 or whtPercent null', () => {
    const lines = [
      { lineNo: 1, category: '53-1302', description: '', quantity: '1',
        unitPrice: '100', amountBeforeVat: '100', vatAmount: '0',
        whtAmount: '0', whtPercent: '3' }, // zero wht → skip
      { lineNo: 2, category: '53-1303', description: '', quantity: '1',
        unitPrice: '100', amountBeforeVat: '100', vatAmount: '0',
        whtAmount: '5' }, // no whtPercent → skip
      { lineNo: 3, category: '53-1304', description: '', quantity: '1',
        unitPrice: '100', amountBeforeVat: '100', vatAmount: '0',
        whtAmount: '3', whtPercent: '3' }, // included
    ];
    const buckets = bucketWhtByRate(lines, new Decimal('300'), new Decimal('3'));
    expect(buckets).toHaveLength(1);
    expect(buckets[0].base.toFixed(2)).toBe('100.00');
    expect(buckets[0].tax.toFixed(2)).toBe('3.00');
  });
});

// Payroll D4 ส่วนที่ 1 (Task 8, mockup กระดาน 3) — สลิปเงินเดือน: ชม. × อัตรา, แถวปรับปรุงงวดก่อน, กล่องสรุปเวลาทำงาน,
// พิมพ์ได้เฉพาะใบที่ลงบัญชีแล้ว · ทุกยอดเป็นยอดที่เก็บไว้ (ไม่คิดใหม่บนเว็บ)
describe('PayrollSlipSheet (PAYROLL voucher)', () => {
  const income = (over: Record<string, unknown>) => ({
    isTaxable: true, quantity: null, rate: null, multiplier: null, source: 'MANUAL', ...over,
  });
  const line = {
    id: 'l1', employeeName: 'สมศรี มีสุข', employeeTaxId: null,
    baseSalary: '15000', ssoEmployee: '750', whtAmount: '0', netPaid: '16734.38',
    customIncome: [
      income({ id: 'i1', accountCode: 'S52-1202', name: 'OT วันทำงาน (1.5 เท่า)', amount: '609.38', source: 'ATTENDANCE_OT', quantity: '6.5', rate: '93.7500', multiplier: '1.5' }),
      income({ id: 'i2', accountCode: 'S52-1202', name: 'ทำงานวันหยุด (1 เท่า)', amount: '500', source: 'ATTENDANCE_HOLIDAY', quantity: '8.0', rate: '62.5000', multiplier: '1' }),
      income({ id: 'i3', accountCode: 'S52-1202', name: 'OT วันหยุด (3 เท่า)', amount: '375', source: 'ATTENDANCE_HOLIDAY_OT', quantity: '2.0', rate: '187.5000', multiplier: '3' }),
      income({ id: 'i4', accountCode: 'S52-1204', name: 'เบี้ยขยัน', amount: '500' }),
      income({ id: 'i5', accountCode: 'S52-1202', name: 'OT ก.ย. ที่จ่ายขาด', amount: '500', source: 'ADJUSTMENT' }),
    ],
    customDeduction: [],
    attendanceSummary: {
      workDays: 25, lateCount: 2, lateMinutes: 18, absent: 0, leave: 1, otHours: '6.5', holidayHours: '8.0',
      holidayOtHours: '2.0', holidayWorkedDays: 1, reviewCount: 0, autoOtEligible: true,
    },
  };
  const voucher = (status: string) => ({
    id: 'pr-1', number: 'PR-20261031-0001', documentType: 'PAYROLL', documentDate: '2026-11-02',
    vendorName: null, vendorTaxId: null, taxInvoiceNo: null, description: null,
    subtotal: '16734.38', vatAmount: '0', withholdingTax: '0', whtFormType: null, totalAmount: '16734.38',
    netPayment: '16734.38', depositAccountCode: 'S11-1201', status, reference: null, note: null,
    expenseDetail: null, payroll: { payrollPeriod: '2026-10', lines: [line] }, journalLines: [],
  });
  function mountVoucher(status: string) {
    apiGet.mockResolvedValue({ data: voucher(status) });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/expenses/pr-1/voucher']}>
          <Routes><Route path="/expenses/:id/voucher" element={<PaymentVoucherPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }
  // บล็อก ไม่ใช่ arrow ที่คืนค่า — vitest ถือฟังก์ชันที่ hook คืนเป็น teardown (mockReset คืนตัว mock เอง)
  beforeEach(() => {
    apiGet.mockReset();
  });

  it('shows hours × rate (rate 2 dp) next to the stored amount — 6.5 × 93.75 = 609.38', async () => {
    mountVoucher('POSTED');
    expect(await screen.findByRole('columnheader', { name: 'ชม. × อัตรา' })).toBeInTheDocument();
    const ot = screen.getByRole('row', { name: /OT วันทำงาน \(1\.5 เท่า\)/ });
    expect(within(ot).getByText('6.5 × 93.75')).toBeInTheDocument();
    expect(within(ot).getByText('609.38')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /ทำงานวันหยุด \(1 เท่า\)/ })).getByText('8 × 62.50')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /OT วันหยุด \(3 เท่า\)/ })).getByText('2 × 187.50')).toBeInTheDocument();
    // แถวที่ไม่มีชั่วโมง (เงินเดือนพื้นฐาน · กรอกเอง · ค่าคอมของส่วนที่ 2) = —
    expect(within(screen.getByRole('row', { name: /เงินเดือนพื้นฐาน/ })).getByText('—')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /เบี้ยขยัน/ })).getByText('—')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /รวมรายได้/ })).getByText('17,484.38')).toBeInTheDocument();
  });

  it('shows the period as a Thai month (board 3), and "—" reads as ไม่มี', async () => {
    mountVoucher('POSTED');
    expect(await screen.findByText('ตุลาคม 2569')).toBeInTheDocument();
    expect(screen.queryByText('2026-10')).not.toBeInTheDocument();
    const base = screen.getByRole('row', { name: /เงินเดือนพื้นฐาน/ });
    expect(within(base).getByText('ไม่มี')).toHaveClass('sr-only');
    expect(within(base).getByText('—')).toHaveAttribute('aria-hidden', 'true');
  });

  it('lines the deductions table up with the 3-column earnings table', async () => {
    mountVoucher('POSTED');
    const sso = await screen.findByRole('cell', { name: 'เงินสมทบประกันสังคม (พนักงาน)' });
    expect(sso).toHaveAttribute('colspan', '2');
    expect(screen.getByRole('cell', { name: 'รวมรายการหัก' })).toHaveAttribute('colspan', '2');
  });

  it('keeps printing off while the document loads', async () => {
    apiGet.mockReturnValue(new Promise(() => {}));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/expenses/pr-1/voucher']}>
          <Routes><Route path="/expenses/:id/voucher" element={<PaymentVoucherPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('button', { name: /พิมพ์ \/ บันทึก PDF/ })).toBeDisabled();
  });

  it('labels prior-period adjustment rows (ปรับปรุงงวดก่อน)', async () => {
    mountVoucher('POSTED');
    const adj = await screen.findByRole('row', { name: /OT ก\.ย\. ที่จ่ายขาด/ });
    expect(adj).toHaveTextContent('(ปรับปรุงงวดก่อน)');
    expect(screen.getByRole('row', { name: /เบี้ยขยัน/ })).not.toHaveTextContent('(ปรับปรุงงวดก่อน)');
  });

  it('shows the attendance summary as information that does not change pay, and the v2 footer', async () => {
    mountVoucher('POSTED');
    const box = (await screen.findByText('ข้อมูลประกอบ — ไม่มีผลต่อยอดเงิน')).closest('section') as HTMLElement;
    expect(within(box).getByText('สรุปเวลาทำงาน ต.ค. 2569')).toBeInTheDocument();
    expect(within(box).getByText('25 วัน')).toBeInTheDocument();
    expect(within(box).getByText('6.5 ชม.')).toBeInTheDocument();
    expect(screen.getByText('ใบจ่ายเงินเดือน v2')).toBeInTheDocument();
  });

  it.each([
    ['DRAFT', /ลงบัญชีก่อนจึงพิมพ์สลิปได้/],
    ['PENDING_APPROVAL', /ลงบัญชีก่อนจึงพิมพ์สลิปได้/],
    ['APPROVED', /ลงบัญชีก่อนจึงพิมพ์สลิปได้/],
    ['VOIDED', /ใบนี้กลับรายการแล้ว/],
  ])('%s: a message instead of slips, and printing is off', async (status, message) => {
    mountVoucher(status);
    const block = (await screen.findByText(message)).closest('[role="status"]') as HTMLElement;
    expect(block).not.toBeNull();
    expect(screen.queryByText('สมศรี มีสุข')).not.toBeInTheDocument();
    expect(screen.queryByText('ใบจ่ายเงินเดือน v2')).not.toBeInTheDocument();
    const print = screen.getByRole('button', { name: /พิมพ์ \/ บันทึก PDF/ });
    expect(print).toBeDisabled();
    expect(print).toHaveAttribute('aria-describedby', block.id);
  });
});
