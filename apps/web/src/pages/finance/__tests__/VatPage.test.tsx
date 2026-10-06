import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import VatPage from '../VatPage';

/**
 * หน้า /finance/vat (เมนู "VAT (ภ.พ.30)") — ภาษีขายจากตัวคำนวณเดียวของ ภ.พ.30 (2026-09-30)
 * ตัวเลขเดือนตุลาคมเดียวกับ spec ต่อฐานจริง `apps/api/src/modules/accounting/pp30-output-vat.integration.spec.ts`
 * ภาษีขาย 60 วัน (21-2103) เป็นข้อมูลประกอบ ไม่รวมในยอด — รอฝ่ายบัญชีวินิจฉัย
 */
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  default: { get: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

const OCTOBER = {
  period: { year: 2026, month: 10 },
  vatOutput: '793.32',
  vatDeferred: '0.00',
  vatInput: '100.00',
  netVat: '693.32',
  outputVat: {
    settledGross: '991.66',
    reductionReversal: '99.17',
    reductionCreditNote: '99.17',
    reductionOther: '0.00',
    reductionTotal: '198.34',
    settledNet: '793.32',
    mandatory60DayCredit: '198.34',
    mandatory60DayDebit: '99.17',
    mandatory60DayNet: '99.17',
    mandatory60DayIncluded: false,
    totalOutputVat: '793.32',
  },
  lineCount: 0,
  lines: [],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <VatPage />
    </QueryClientProvider>,
  );
}

/** แถวของกล่อง "ที่มาของภาษีขายเดือนนี้" ตามลำดับบนจอ — [ป้าย, ยอดที่แสดง] */
async function breakdownRows() {
  const section = await screen.findByRole('region', { name: 'ที่มาของภาษีขายเดือนนี้' });
  return Array.from(section.querySelectorAll('dt')).map((dt) => [
    dt.textContent,
    dt.nextElementSibling?.textContent,
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('VatPage — ภาษีขายเดือนนี้ (ภ.พ.30)', () => {
  it('แยกที่มาของภาษีขาย: ตั้ง · หักกลับรายการ · หักใบลดหนี้ · หักอื่น ๆ · รวม — แล้วภาษีขาย 60 วันเป็นข้อมูลประกอบแยก (ไม่รวม)', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: OCTOBER });
    renderPage();

    expect(await breakdownRows()).toEqual([
      ['ภาษีขายที่ตั้งในเดือน (เครดิต 21-2101)', '991.66 ฿'],
      ['หัก กลับรายการ', '99.17 ฿'],
      ['หัก ใบลดหนี้ (ม.82/5)', '99.17 ฿'],
      ['หัก รายการอื่นที่ลดภาษีขาย', '0.00 ฿'],
      ['ภาษีขายเดือนนี้ (ภ.พ.30)', '793.32 ฿'],
      ['ตั้งในเดือน (เครดิต 21-2103)', '198.34 ฿'],
      ['กลับรายการ (เดบิต 21-2103)', '99.17 ฿'],
      ['สุทธิ', '99.17 ฿'],
    ]);
    expect(
      screen.getByText(
        'ภาษีขาย 60 วัน (21-2103) — ข้อมูลประกอบ ยังไม่รวมในยอดข้างบน (รอฝ่ายบัญชีวินิจฉัย)',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'รายการกลับรายการและใบลดหนี้ลดภาษีขายของเดือนที่ลงรายการ — ไม่แก้ตัวเลขของเดือนเดิม · ดูรายการทีละบรรทัดได้ในตารางด้านล่าง',
      ),
    ).toBeInTheDocument();
  });

  it('การ์ดใบแรกเป็น "ภาษีขายเดือนนี้ (ภ.พ.30)" (ป้ายเดิม "ภาษีขาย 21-2101" ไม่อยู่แล้ว) · การ์ดสุทธิ = ภาษีขาย − ภาษีซื้อ', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: OCTOBER });
    renderPage();
    await breakdownRows();

    expect(screen.getAllByText('ภาษีขายเดือนนี้ (ภ.พ.30)')).toHaveLength(2); // การ์ด + แถวรวมในกล่อง
    expect(screen.queryByText('ภาษีขาย 21-2101')).toBeNull();
    expect(screen.getAllByText('793.32 ฿')).toHaveLength(2); // การ์ด + แถวรวมในกล่อง
    expect(screen.getByText('693.32 ฿')).toBeInTheDocument(); // VAT สุทธิ (ออก − ซื้อ)
    expect(screen.getByText('100.00 ฿')).toBeInTheDocument(); // ภาษีซื้อ 11-4101
  });

  it('ภาษีขายติดลบ (เดือนที่มีแต่รายการกลับรายการ) แสดงตามจริง', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        ...OCTOBER,
        vatOutput: '-99.17',
        vatInput: '0.00',
        netVat: '-99.17',
        outputVat: {
          ...OCTOBER.outputVat,
          settledGross: '0.00',
          reductionReversal: '99.17',
          reductionCreditNote: '0.00',
          reductionTotal: '99.17',
          settledNet: '-99.17',
          mandatory60DayCredit: '0.00',
          mandatory60DayDebit: '0.00',
          mandatory60DayNet: '0.00',
          totalOutputVat: '-99.17',
        },
      },
    });
    renderPage();

    const rows = await breakdownRows();
    expect(rows[4]).toEqual(['ภาษีขายเดือนนี้ (ภ.พ.30)', '-99.17 ฿']);
  });

  it('เรียก API เดิมโดยไม่ส่ง companyId (ภาษีขายเป็นของบริษัท FINANCE ฝั่ง API)', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: OCTOBER });
    renderPage();
    await breakdownRows();

    expect(api.get).toHaveBeenCalledWith(
      expect.stringMatching(/^\/finance-tax\/vat-monthly\?year=\d{4}&month=\d{1,2}$/),
    );
  });

  it('API รุ่นก่อน (ไม่มี outputVat — เว็บขึ้นก่อน API) → แสดงการ์ดตามเดิม ไม่แสดงกล่องที่มา ไม่ล่ม', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        period: { year: 2026, month: 8 },
        vatOutput: 1788.89,
        vatDeferred: 0,
        vatInput: 0,
        netVat: 1788.89,
        lineCount: 0,
        lines: [],
      },
    });
    renderPage();

    expect(await screen.findByText('ภาษีขายเดือนนี้ (ภ.พ.30)')).toBeInTheDocument();
    expect(screen.getAllByText('1,788.89 ฿')).toHaveLength(2); // การ์ดภาษีขาย + การ์ดสุทธิ
    expect(screen.queryByRole('region', { name: 'ที่มาของภาษีขายเดือนนี้' })).toBeNull();
  });
});

/** ก้อน 5 — ภาษีซื้อของเครื่องขายผ่อน (Dr 11-4101 / Cr 42-1108) แยกจากภาษีซื้อค่าใช้จ่าย · ตารางรายสัญญา · ป้ายอายุใบกำกับ */
describe('ภาษีซื้อจากเครื่องขายผ่อน (ก้อน 5)', () => {
  const WITH_INSTALLMENT = {
    ...OCTOBER,
    vatInput: '786.00',
    vatInputExpense: '100.00',
    vatInputInstallment: '686.00',
    installmentInputVatLines: [
      { postedAt: '2026-10-05T03:00:00.000Z', entryNumber: 'JE-202610-00009', contractId: 'c1', contractNumber: 'CT-20261005-0001', productId: 'p1', grNumber: 'GR-20261005-001', taxInvoiceNumber: 'IV-9', taxInvoiceDate: '2026-10-01', invoiceAgeMonths: 0, amount: '686.00', reversal: false, reversed: false },
      { postedAt: '2026-10-06T03:00:00.000Z', entryNumber: 'JE-202610-00012', contractId: 'c2', contractNumber: 'CT-20261006-0002', productId: 'p2', grNumber: 'GR-20260301-004', taxInvoiceNumber: 'IV-2', taxInvoiceDate: '2026-03-15', invoiceAgeMonths: 6, amount: '343.00', reversal: false, reversed: true },
      { postedAt: '2026-10-07T03:00:00.000Z', entryNumber: 'JE-202610-00015', contractId: 'c2', contractNumber: 'CT-20261006-0002', productId: 'p2', grNumber: 'GR-20260301-004', taxInvoiceNumber: 'IV-2', taxInvoiceDate: '2026-03-15', invoiceAgeMonths: 6, amount: '-343.00', reversal: true, reversed: false },
    ],
  };

  it('แสดงสองยอดแยก + ตารางรายสัญญา · แถวกลับรายการติดป้าย · ใบกำกับ ≥ 6 เดือนติดป้ายเตือน', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: WITH_INSTALLMENT });
    renderPage();
    const section = await screen.findByRole('region', { name: 'ภาษีซื้อจากเครื่องขายผ่อน' });
    expect(section).toHaveTextContent('ภาษีซื้อค่าใช้จ่าย');
    expect(section).toHaveTextContent('100.00 ฿');
    expect(section).toHaveTextContent('ภาษีซื้อเครื่องขายผ่อน');
    expect(section).toHaveTextContent('686.00 ฿');
    const rows = section.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('CT-20261005-0001');
    expect(rows[0]).toHaveTextContent('GR-20261005-001');
    expect(rows[0]).toHaveTextContent('IV-9');
    expect(rows[0]).not.toHaveTextContent('เกิน 6 เดือน');
    expect(rows[1]).toHaveTextContent('เกิน 6 เดือน');
    expect(rows[1]).toHaveTextContent('ถูกกลับรายการ');
    expect(rows[2]).toHaveTextContent('กลับรายการ');
    expect(rows[2]).toHaveTextContent('-343.00');
  });

  it('API รุ่นเก่า (ไม่มีฟิลด์) → ไม่แสดงส่วนนี้ · การ์ดภาษีซื้อรวมยังแสดงเหมือนเดิม', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: OCTOBER });
    renderPage();
    await screen.findByRole('region', { name: 'ที่มาของภาษีขายเดือนนี้' });
    expect(screen.queryByRole('region', { name: 'ภาษีซื้อจากเครื่องขายผ่อน' })).toBeNull();
  });

  it('มีฟิลด์แต่ไม่มีรายการในเดือน → แสดงยอด 0.00 และข้อความว่าง', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { ...WITH_INSTALLMENT, vatInputInstallment: '0.00', installmentInputVatLines: [] } });
    renderPage();
    const section = await screen.findByRole('region', { name: 'ภาษีซื้อจากเครื่องขายผ่อน' });
    expect(section).toHaveTextContent('ยังไม่มีสัญญาผ่อนที่เคลมภาษีซื้อในเดือนนี้');
  });
});
