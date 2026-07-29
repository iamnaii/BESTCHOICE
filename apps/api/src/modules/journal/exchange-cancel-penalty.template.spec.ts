import { Decimal } from '@prisma/client/runtime/library';
import { ExchangeCancelPenaltyTemplate } from './cpa-templates/exchange-cancel-penalty.template';

describe('ExchangeCancelPenaltyTemplate (workbook Case 3B — ค่าปรับ 8-30 วัน → 42-1107)', () => {
  let createAndPost: jest.Mock;
  let template: ExchangeCancelPenaltyTemplate;

  const baseInput = {
    requestId: 'req-11111111-aaaa',
    oldContractId: 'old-c',
    depositAccountCode: '11-1101',
    penalty: new Decimal('400'),
  };

  beforeEach(() => {
    createAndPost = jest.fn().mockResolvedValue({ id: 'pje', entryNumber: 'JE-202607-7777' });
    const journal = { createAndPost } as any;
    const prisma = {} as any;
    template = new ExchangeCancelPenaltyTemplate(journal, prisma);
  });

  it('Dr {cash} / Cr 42-1107 = penalty — ไม่มีบรรทัด VAT (นโยบายค่าปรับ)', async () => {
    const result = await template.execute(baseInput);

    expect(result).toEqual({ id: 'pje', entryNumber: 'JE-202607-7777' });
    const input = createAndPost.mock.calls[0][0];
    expect(input.lines).toHaveLength(2); // exactly Dr cash + Cr income — no VAT line
    const dr = input.lines.find((l: any) => l.accountCode === '11-1101');
    const cr = input.lines.find((l: any) => l.accountCode === '42-1107');
    expect(dr.dr.toString()).toBe('400');
    expect(dr.cr.toString()).toBe('0');
    expect(cr.cr.toString()).toBe('400');
    expect(cr.dr.toString()).toBe('0');
  });

  it('metadata: flow exchange-cancel-penalty, idempotencyKey = requestId, contractId = สัญญาเก่า', async () => {
    await template.execute(baseInput);

    const input = createAndPost.mock.calls[0][0];
    expect(input.metadata).toEqual(
      expect.objectContaining({
        flow: 'exchange-cancel-penalty',
        idempotencyKey: 'req-11111111-aaaa',
        contractId: 'old-c',
        requestId: 'req-11111111-aaaa',
      }),
    );
  });

  it('ส่งต่อ tx ให้ createAndPost (โพสต์ใน transaction เดียวกับ cancel)', async () => {
    const tx = { fake: true } as any;
    await template.execute(baseInput, tx);
    expect(createAndPost.mock.calls[0][1]).toBe(tx);
  });
});
