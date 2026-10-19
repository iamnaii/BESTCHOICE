import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import VatPage from '../VatPage';
import { exportToExcel } from '@/utils/excel.util';
import { toast } from 'sonner';
import { setRequestCompany } from '@/lib/company-scope';

/**
 * หน้า /finance/vat (เมนู "VAT (ภ.พ.30)") — ภาษีขายจากตัวคำนวณเดียวของ ภ.พ.30 (2026-09-30)
 * ตัวเลขเดือนตุลาคมเดียวกับ spec ต่อฐานจริง `apps/api/src/modules/accounting/pp30-output-vat.integration.spec.ts`
 * ภาษีขาย 60 วัน (21-2103) สุทธิรวมในยอดตั้งแต่ 16/10/2569 (ฝ่ายบัญชีข้อ 11.1 — `mandatory60DayIncluded: true`)
 * snapshot/TaxReport ที่เก็บก่อนหน้านั้นยัง `false` ⇒ หน้าแสดงแถวและหัวข้อแบบเดิม
 */
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  default: { get: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock('@/utils/excel.util', () => ({ exportToExcel: vi.fn().mockResolvedValue(undefined) }));

const OCTOBER = {
  period: { year: 2026, month: 10 },
  vatOutput: '892.49',
  vatDeferred: '0.00',
  vatInput: '100.00',
  netVat: '792.49',
  outputVat: {
    settledGross: '991.66',
    reductionReversal: '99.17',
    reductionCreditNote: '99.17',
    reductionAdvanceApplied: '0.00',
    reductionOther: '0.00',
    reductionTotal: '198.34',
    settledNet: '793.32',
    mandatory60DayCredit: '198.34',
    mandatory60DayDebit: '99.17',
    mandatory60DayNet: '99.17',
    mandatory60DayIncluded: true,
    totalOutputVat: '892.49',
  },
  lineCount: 0,
  lines: [],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <VatPage />
    </QueryClientProvider>,
  );
  return { ...result, client };
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
  setRequestCompany(undefined);
});

describe('VatPage — ภาษีขายเดือนนี้ (ภ.พ.30)', () => {
  it('exports the displayed period and signed amounts, preserving document and account identifiers', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: {
      ...OCTOBER, netVat: '-1234.50',
      lines: [{ accountCode: '001-02', documentNumber: '000001', postedAt: '2026-10-01T00:00:00Z', description: 'รายการตัวอย่าง', debit: 12345.67, credit: 0 }],
      installmentInputVatLines: [{ entryNumber: '000002', postedAt: '2026-10-01T00:00:00Z', contractNumber: 'FIN-01', grNumber: '000004', taxInvoiceNumber: '000003', taxInvoiceDate: '2026-03-01', invoiceAgeMonths: 7, amount: '-70.00', reversal: true }],
    } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'ส่งออก Excel' }));
    await waitFor(() => expect(exportToExcel).toHaveBeenCalledOnce());
    const options = vi.mocked(exportToExcel).mock.calls[0][0];
    expect(options.filename).toBe('VAT-2026-10.xlsx');
    expect(options.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ description: 'ภาษีสุทธิ', amount: -1234.5 }),
      expect.objectContaining({ document: '000001', account: '001-02', debit: 12345.67 }),
      expect.objectContaining({ document: '000002', amount: -70, contract: 'FIN-01', goodsReceipt: '000004', taxInvoice: '000003', invoiceAgeMonths: 7, status: 'กลับรายการ', taxInvoiceDate: expect.stringContaining('2569') }),
      expect.objectContaining({ section: 'ที่มาของภาษีขาย', description: 'หัก กลับรายการ', amount: 99.17 }),
      expect.objectContaining({ section: 'ภาษีขาย 60 วัน', amount: 99.17, status: 'รวมในภาษีขายแล้ว' }),
    ]));
    expect(options.assertCurrent).toBeTypeOf('function');
    expect(screen.getByRole('button', { name: 'ส่งออก XML' })).toBeDisabled();
  });

  it('rejects an export snapshot after the report changes', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: OCTOBER });
    const { client } = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'ส่งออก Excel' }));
    await waitFor(() => expect(exportToExcel).toHaveBeenCalledOnce());
    const { assertCurrent } = vi.mocked(exportToExcel).mock.calls[0][0];
    expect(() => assertCurrent?.()).not.toThrow();
    await act(async () => {
      client.setQueriesData({ queryKey: ['vat-monthly'] }, { ...OCTOBER, netVat: '-500.00' });
    });
    await screen.findByText('-500.00 ฿');
    expect(() => assertCurrent?.()).toThrow('รายงานมีการเปลี่ยนแปลง กรุณาส่งออกใหม่');
  });

  it('rejects an export snapshot when the work company changes', async () => {
    setRequestCompany('FINANCE');
    vi.mocked(api.get).mockResolvedValue({ data: OCTOBER });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'ส่งออก Excel' }));
    await waitFor(() => expect(exportToExcel).toHaveBeenCalledOnce());
    const { assertCurrent } = vi.mocked(exportToExcel).mock.calls[0][0];
    expect(() => assertCurrent?.()).not.toThrow();
    setRequestCompany('SHOP');
    expect(() => assertCurrent?.()).toThrow();
    setRequestCompany(undefined);
  });

  it('reports an export failure in Thai', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: OCTOBER });
    vi.mocked(exportToExcel).mockRejectedValueOnce(new Error('write failed'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'ส่งออก Excel' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('ส่งออก Excel ไม่สำเร็จ กรุณาลองใหม่'));
    expect(screen.getByRole('button', { name: 'ส่งออก Excel' })).toBeEnabled();
  });

  it('แยกที่มาของภาษีขาย: ตั้ง · หักกลับรายการ · หักใบลดหนี้ · หักเงินรับล่วงหน้าที่หักเข้างวด · หักอื่น ๆ · 21-2101 สุทธิ · บวกภาษีขาย 60 วันสุทธิ · รวม (mandatory60DayIncluded = true)', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: OCTOBER });
    renderPage();

    expect(await breakdownRows()).toEqual([
      ['ภาษีขายที่ตั้งในเดือน (เครดิต 21-2101)', '991.66 ฿'],
      ['หัก กลับรายการ', '99.17 ฿'],
      ['หัก ใบลดหนี้ (ม.82/5)', '99.17 ฿'],
      ['หัก เงินรับล่วงหน้าที่หักเข้างวด (รับรู้ภาษีแล้วตอนรับ)', '0.00 ฿'],
      ['หัก รายการอื่นที่ลดภาษีขาย', '0.00 ฿'],
      ['ภาษีขาย 21-2101 สุทธิ', '793.32 ฿'],
      ['บวก ภาษีขาย 60 วัน (21-2103) สุทธิ', '99.17 ฿'],
      ['ภาษีขายเดือนนี้ (ภ.พ.30)', '892.49 ฿'],
      ['ตั้งในเดือน (เครดิต 21-2103)', '198.34 ฿'],
      ['กลับรายการ (เดบิต 21-2103)', '99.17 ฿'],
      ['สุทธิ', '99.17 ฿'],
    ]);
    expect(
      screen.getByText('ภาษีขาย 60 วัน (21-2103) — รวมในยอดภาษีขายข้างบนแล้ว (ฝ่ายบัญชี 16/10/2569)'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ยังไม่รวมในยอดข้างบน/)).toBeNull();
    expect(
      screen.getByText(
        'รายการกลับรายการและใบลดหนี้ลดภาษีขายของเดือนที่ลงรายการ — ไม่แก้ตัวเลขของเดือนเดิม · ดูรายการทีละบรรทัดได้ในตารางด้านล่าง',
      ),
    ).toBeInTheDocument();
  });

  it('snapshot ก่อน 16/10/2569 (mandatory60DayIncluded = false): คงแถวเดิม 6 แถว + หัวข้อ "ยังไม่รวม" — ไม่คิดตัวเลขใหม่', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        ...OCTOBER,
        vatOutput: '793.32',
        netVat: '693.32',
        outputVat: { ...OCTOBER.outputVat, mandatory60DayIncluded: false, totalOutputVat: '793.32' },
      },
    });
    renderPage();

    expect(await breakdownRows()).toEqual([
      ['ภาษีขายที่ตั้งในเดือน (เครดิต 21-2101)', '991.66 ฿'],
      ['หัก กลับรายการ', '99.17 ฿'],
      ['หัก ใบลดหนี้ (ม.82/5)', '99.17 ฿'],
      ['หัก เงินรับล่วงหน้าที่หักเข้างวด (รับรู้ภาษีแล้วตอนรับ)', '0.00 ฿'],
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
  });

  it('PR4 ต10: เดือนที่เงินพักถูกหักเข้างวด (G2 ธ.ค.) — แถว "หัก เงินรับล่วงหน้าที่หักเข้างวด" 92.83 · สุทธิ 6.30 (ภาษีรับรู้แล้วตอนรับเดือนก่อน)', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        ...OCTOBER,
        period: { year: 2026, month: 12 },
        vatOutput: '6.30',
        vatInput: '0.00',
        netVat: '6.30',
        outputVat: {
          ...OCTOBER.outputVat,
          settledGross: '99.13',
          reductionReversal: '0.00',
          reductionCreditNote: '0.00',
          reductionAdvanceApplied: '92.83',
          reductionOther: '0.00',
          reductionTotal: '92.83',
          settledNet: '6.30',
          mandatory60DayCredit: '0.00',
          mandatory60DayDebit: '0.00',
          mandatory60DayNet: '0.00',
          totalOutputVat: '6.30',
        },
      },
    });
    renderPage();

    const rows = await breakdownRows();
    expect(rows[3]).toEqual(['หัก เงินรับล่วงหน้าที่หักเข้างวด (รับรู้ภาษีแล้วตอนรับ)', '92.83 ฿']);
    expect(rows[5]).toEqual(['ภาษีขาย 21-2101 สุทธิ', '6.30 ฿']);
    expect(rows[6]).toEqual(['บวก ภาษีขาย 60 วัน (21-2103) สุทธิ', '0.00 ฿']);
    expect(rows[7]).toEqual(['ภาษีขายเดือนนี้ (ภ.พ.30)', '6.30 ฿']);
  });

  it('API รุ่นก่อน PR4 (outputVat ไม่มี reductionAdvanceApplied) → แถวใหม่แสดง 0.00 ไม่ล่ม', async () => {
    const { reductionAdvanceApplied: _omit, ...legacyOutputVat } = OCTOBER.outputVat;
    void _omit;
    vi.mocked(api.get).mockResolvedValue({ data: { ...OCTOBER, outputVat: legacyOutputVat } });
    renderPage();

    const rows = await breakdownRows();
    expect(rows[3]).toEqual(['หัก เงินรับล่วงหน้าที่หักเข้างวด (รับรู้ภาษีแล้วตอนรับ)', '0.00 ฿']);
  });

  it('การ์ดใบแรกเป็น "ภาษีขายเดือนนี้ (ภ.พ.30)" (ป้ายเดิม "ภาษีขาย 21-2101" ไม่อยู่แล้ว) · การ์ดสุทธิ = ภาษีขาย − ภาษีซื้อ', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: OCTOBER });
    renderPage();
    await breakdownRows();

    expect(screen.getAllByText('ภาษีขายเดือนนี้ (ภ.พ.30)')).toHaveLength(2); // การ์ด + แถวรวมในกล่อง
    expect(screen.queryByText('ภาษีขาย 21-2101')).toBeNull();
    expect(screen.getAllByText('892.49 ฿')).toHaveLength(2); // การ์ด + แถวรวมในกล่อง (รวม 60 วันแล้ว)
    expect(screen.getAllByText('793.32 ฿')).toHaveLength(1); // แถว "ภาษีขาย 21-2101 สุทธิ" เท่านั้น
    expect(screen.getByText('792.49 ฿')).toBeInTheDocument(); // VAT สุทธิ (ออก − ซื้อ)
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
    expect(rows[5]).toEqual(['ภาษีขาย 21-2101 สุทธิ', '-99.17 ฿']);
    expect(rows[7]).toEqual(['ภาษีขายเดือนนี้ (ภ.พ.30)', '-99.17 ฿']);
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
