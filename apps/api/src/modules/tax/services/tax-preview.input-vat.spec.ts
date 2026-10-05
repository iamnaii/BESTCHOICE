import { Prisma } from '@prisma/client';
import { TaxPreviewService } from './tax-preview.service';

/** ก้อน 5 — previewPP30 (ไฟล์ ภ.พ.30 / TaxReport) รวมภาษีซื้อเครื่องขายผ่อนด้วย (เดิมกรอง flow expense-* อย่างเดียว) */
describe('TaxPreviewService.getInstallmentInputVatLineItems', () => {
  const start = new Date('2026-10-01T00:00:00+07:00');
  const end = new Date('2026-11-01T00:00:00+07:00');
  const d = (s: string) => new Prisma.Decimal(s);
  function build(lines: unknown[], items: unknown[] = []) {
    const prisma: any = {
      journalLine: { findMany: jest.fn().mockResolvedValue(lines) },
      journalEntry: { findMany: jest.fn().mockResolvedValue([]) },
      goodsReceivingItem: { findMany: jest.fn().mockResolvedValue(items) },
    };
    // constructor จริง: `constructor(private prisma: PrismaService)` (ตรวจแล้ว 2026-10-05)
    const service = new TaxPreviewService(prisma);
    return { service, prisma };
  }
  const claimLine = (debit: string, credit: string, meta: Record<string, unknown>, entryNumber = 'JE-C1') => ({
    accountCode: '11-4101', debit: d(debit), credit: d(credit), journalEntry: { id: meta.id ?? 'je-1', entryNumber, postedAt: new Date('2026-10-03T03:00:00Z'), description: 'x', metadata: meta },
  });

  it('รายการเคลม → vendor จากผู้จัดจำหน่ายของใบรับของ · taxInvoiceNo จาก metadata · ฐาน = receivedCost − receivedVat · vat = debit', async () => {
    const { service } = build(
      [claimLine('686', '0', { flow: 'finance-input-vat-installment', contractNumber: 'CT-1', productId: 'p1', receivingId: 'gr-1', taxInvoiceNumber: 'IV-9' })],
      [{ productId: 'p1', receivedCost: d('10486'), receivedVat: d('686'), receiving: { po: { supplier: { name: 'ร้าน A', taxId: '0105...' } } } }],
    );
    const out = await (service as any).getInstallmentInputVatLineItems('fin-co', start, end);
    expect(out).toEqual([expect.objectContaining({ vendorName: 'ร้าน A', vendorTaxId: '0105...', taxInvoiceNo: 'IV-9', description: expect.stringContaining('CT-1') })]);
    expect(out[0].totalAmount.toFixed(2)).toBe('9800.00');
    expect(out[0].vatAmount.toFixed(2)).toBe('686.00');
  });

  it('ใบกระจกจากยกเลิกสัญญา (Cr 11-4101 · reversesEntryId ชี้ใบ flow เรา) → รายการติดลบในเดือนที่ยกเลิก', async () => {
    const { service, prisma } = build(
      [claimLine('0', '686', { id: 'je-rev', tag: 'REVERSAL', flow: 'contract-cancellation', reversesEntryId: 'je-1' }, 'JE-REV')],
      [{ productId: 'p1', receivedCost: d('10486'), receivedVat: d('686'), receiving: { po: { supplier: { name: 'ร้าน A', taxId: null } } } }],
    );
    prisma.journalEntry.findMany.mockResolvedValue([{ id: 'je-1', metadata: { flow: 'finance-input-vat-installment', contractNumber: 'CT-1', productId: 'p1', receivingId: 'gr-1', taxInvoiceNumber: 'IV-9' } }]);
    const out = await (service as any).getInstallmentInputVatLineItems('fin-co', start, end);
    expect(out).toHaveLength(1);
    expect(out[0].vatAmount.toFixed(2)).toBe('-686.00');
    expect(out[0].totalAmount.toFixed(2)).toBe('-9800.00');
    expect(out[0].description).toContain('กลับรายการ');
  });

  it('ไม่มีรายการ → [] · query กรองด้วย companyId ของบริษัทที่ขอ preview (สมุด FINANCE เท่านั้นที่มีรายการนี้)', async () => {
    const { service, prisma } = build([]);
    await expect((service as any).getInstallmentInputVatLineItems('fin-co', start, end)).resolves.toEqual([]);
    expect(prisma.journalLine.findMany.mock.calls[0][0].where.journalEntry).toMatchObject({ companyId: 'fin-co', status: 'POSTED' });
  });
});
