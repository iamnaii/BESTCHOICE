import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { InstallmentInputVatTemplate } from '../cpa-templates/installment-input-vat.template';

/** ก้อน 5 · ฝ่ายบัญชี 2.4 แบบ ก: Dr 11-4101 / Cr 42-1108 สมุด FINANCE ลงวันเปิดสัญญา · กลับรายการผ่าน sweep ยกเลิกสัญญา (ไม่มี reverse() เอง) */
function build() {
  const createAndPost = jest.fn().mockResolvedValue({ id: 'je-1', entryNumber: 'JE-202610-00001' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx: any = { journalEntry: { findFirst: jest.fn().mockResolvedValue(null) } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = { $transaction: jest.fn((cb: (t: unknown) => Promise<unknown>) => cb(tx)) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const companies: any = { getFinanceCompanyId: jest.fn().mockResolvedValue('fin-co') };
  const template = new InstallmentInputVatTemplate({ createAndPost } as never, prisma, companies);
  return { template, createAndPost, tx };
}

const base = {
  contractId: 'c1',
  contractNumber: 'CT-20261005-0001',
  productId: 'p1',
  receivingId: 'gr-1',
  grNumber: 'GR-20261005-001',
  amount: new Decimal('686'),
  taxInvoiceNumber: 'IV-9',
  taxInvoiceDate: new Date('2026-09-29T17:00:00Z'), // 30/09/2569 เที่ยงคืนไทย
  postedAt: new Date('2026-10-05T03:00:00Z'),
};

describe('InstallmentInputVatTemplate.execute', () => {
  it('Dr 11-4101 686 / Cr 42-1108 686 · companyId FINANCE · postedAt ที่ส่ง · metadata ครบ ไม่มี saleId/shopReceivableType', async () => {
    const { template, createAndPost } = build();
    const out = await template.execute(base);
    expect(out).toEqual({ entryNo: 'JE-202610-00001', journalEntryId: 'je-1' });
    const arg = createAndPost.mock.calls[0][0];
    expect(arg.lines).toHaveLength(2);
    expect(arg.lines[0]).toMatchObject({ accountCode: '11-4101' });
    expect(arg.lines[0].dr.toFixed(2)).toBe('686.00');
    expect(arg.lines[0].cr.toFixed(2)).toBe('0.00');
    expect(arg.lines[1]).toMatchObject({ accountCode: '42-1108' });
    expect(arg.lines[1].cr.toFixed(2)).toBe('686.00');
    expect(arg.companyId).toBe('fin-co');
    expect(arg.postedAt).toEqual(base.postedAt);
    expect(arg.reference).toBe('input-vat:c1');
    expect(arg.metadata).toMatchObject({
      tag: 'INSTALLMENT_INPUT_VAT',
      flow: 'finance-input-vat-installment',
      idempotencyKey: 'input-vat:c1',
      contractId: 'c1',
      contractNumber: 'CT-20261005-0001',
      productId: 'p1',
      receivingId: 'gr-1',
      grNumber: 'GR-20261005-001',
      taxInvoiceNumber: 'IV-9',
      taxInvoiceDate: '2026-09-30',
      invoiceAgeMonths: 0,
      companyCode: 'FINANCE',
      amount: '686.00',
    });
    for (const k of ['saleId', 'shopReceivableType', 'paymentId', 'installmentScheduleId', 'postedOnInvoiceDate']) {
      expect(arg.metadata).not.toHaveProperty(k);
    }
    expect(createAndPost.mock.calls[0][1]).toBeDefined(); // ส่ง tx ต่อ
  });

  it('postedOnInvoiceDate: true → stamp ลง metadata (งวดเดือนเปิดสัญญาปิด ลงวันนี้แทน)', async () => {
    const { template, createAndPost } = build();
    await template.execute({ ...base, postedOnInvoiceDate: true });
    expect(createAndPost.mock.calls[0][0].metadata).toMatchObject({ postedOnInvoiceDate: true });
  });

  it('idempotent — มี JE เดิมด้วย flow+key แล้วคืนใบเดิม ไม่โพสต์ซ้ำ', async () => {
    const { template, createAndPost, tx } = build();
    tx.journalEntry.findFirst.mockResolvedValue({ id: 'je-old', entryNumber: 'JE-OLD' });
    await expect(template.execute(base)).resolves.toEqual({ entryNo: 'JE-OLD', journalEntryId: 'je-old' });
    expect(createAndPost).not.toHaveBeenCalled();
    const where = tx.journalEntry.findFirst.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('finance-input-vat-installment');
    expect(JSON.stringify(where)).toContain('input-vat:c1');
  });

  it('amount ≤ 0 → BadRequest ไม่โพสต์', async () => {
    const { template, createAndPost } = build();
    await expect(template.execute({ ...base, amount: new Decimal(0) })).rejects.toBeInstanceOf(BadRequestException);
    expect(createAndPost).not.toHaveBeenCalled();
  });
});
