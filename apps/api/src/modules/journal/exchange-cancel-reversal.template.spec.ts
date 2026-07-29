import { Decimal } from '@prisma/client/runtime/library';
import { ExchangeCancelReversalTemplate } from './cpa-templates/exchange-cancel-reversal.template';

describe('ExchangeCancelReversalTemplate (cancel — workbook Cases 3A/3B, spec §9)', () => {
  let createAndPost: jest.Mock;
  let findMany: jest.Mock;
  let update: jest.Mock;
  let template: ExchangeCancelReversalTemplate;

  const makeJe = (over: Record<string, unknown> = {}) => ({
    id: 'je1',
    entryNumber: 'JE-202607-0001',
    companyId: 'finance-co',
    metadata: { flow: 'exchange-1a', contractId: 'new-c' },
    lines: [
      {
        accountCode: '11-2101',
        debit: new Decimal('17000'),
        credit: new Decimal(0),
        description: 'ตั้งลูกหนี้',
      },
      {
        accountCode: '21-1101',
        debit: new Decimal(0),
        credit: new Decimal('17000'),
        description: 'เจ้าหนี้',
      },
    ],
    ...over,
  });

  beforeEach(() => {
    let n = 0;
    createAndPost = jest.fn().mockImplementation(async () => {
      n += 1;
      return { id: `rev-${n}`, entryNumber: `JE-202607-900${n}` };
    });
    findMany = jest.fn().mockResolvedValue([]);
    update = jest.fn().mockResolvedValue({});
    const journal = { createAndPost } as any;
    const prisma = { journalEntry: { findMany, update } } as any;
    template = new ExchangeCancelReversalTemplate(journal, prisma);
  });

  it('mirror-flips ทุกบรรทัด (dr↔cr) + copy companyId จาก JE เดิม', async () => {
    findMany
      .mockResolvedValueOnce([makeJe()]) // byId
      .mockResolvedValueOnce([]); // swept
    const result = await template.reverse({ jeIds: ['je1'], newContractId: 'new-c' });

    expect(result.reversalJeIds).toEqual(['rev-1']);
    const input = createAndPost.mock.calls[0][0];
    // dr↔cr per line
    expect(input.lines[0].accountCode).toBe('11-2101');
    expect(input.lines[0].dr.toString()).toBe('0');
    expect(input.lines[0].cr.toString()).toBe('17000');
    expect(input.lines[1].accountCode).toBe('21-1101');
    expect(input.lines[1].dr.toString()).toBe('17000');
    expect(input.lines[1].cr.toString()).toBe('0');
    // companyId copied from original JE
    expect(input.companyId).toBe('finance-co');
  });

  it('metadata: tag REVERSAL, flow exchange-cancel, idempotencyKey cancel:<id>, originalEntryId/reversesEntryId, contractId copied', async () => {
    findMany.mockResolvedValueOnce([makeJe()]).mockResolvedValueOnce([]);
    await template.reverse({ jeIds: ['je1'], newContractId: 'new-c' });

    const input = createAndPost.mock.calls[0][0];
    expect(input.metadata).toEqual(
      expect.objectContaining({
        tag: 'REVERSAL',
        flow: 'exchange-cancel',
        idempotencyKey: 'cancel:je1',
        originalEntryId: 'je1',
        reversesEntryId: 'je1',
        contractId: 'new-c', // copied from original JE metadata
      }),
    );
  });

  it('copy SHOP companyId สำหรับ A.4 JE (ไม่ default เป็น FINANCE)', async () => {
    findMany
      .mockResolvedValueOnce([makeJe({ id: 'je4', companyId: 'shop-co' })])
      .mockResolvedValueOnce([]);
    await template.reverse({ jeIds: ['je4'], newContractId: 'new-c' });
    expect(createAndPost.mock.calls[0][0].companyId).toBe('shop-co');
  });

  it('ข้าม JE ที่ reverse ไปแล้ว (metadata.reversed === true)', async () => {
    findMany
      .mockResolvedValueOnce([
        makeJe({ metadata: { flow: 'exchange-1a', contractId: 'new-c', reversed: true } }),
      ])
      .mockResolvedValueOnce([]);
    const result = await template.reverse({ jeIds: ['je1'], newContractId: 'new-c' });
    expect(result.reversalJeIds).toEqual([]);
    expect(createAndPost).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("ข้าม reversal ของตัวเองที่ sweep เจอ (flow === 'exchange-cancel')", async () => {
    findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeJe({
          id: 'rev-old',
          metadata: { flow: 'exchange-cancel', contractId: 'new-c' },
        }),
      ]);
    const result = await template.reverse({ jeIds: [], newContractId: 'new-c' });
    expect(result.reversalJeIds).toEqual([]);
    expect(createAndPost).not.toHaveBeenCalled();
  });

  it('stamp reversed:true + reversedByEntryNumber ลง JE เดิม', async () => {
    findMany.mockResolvedValueOnce([makeJe()]).mockResolvedValueOnce([]);
    await template.reverse({ jeIds: ['je1'], newContractId: 'new-c' });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'je1' },
        data: {
          metadata: expect.objectContaining({
            flow: 'exchange-1a', // original metadata preserved
            reversed: true,
            reversedByEntryNumber: 'JE-202607-9001',
          }),
        },
      }),
    );
  });

  it('dedupe: JE เจอทั้ง byId และ sweep → reverse ครั้งเดียว', async () => {
    const je = makeJe();
    findMany.mockResolvedValueOnce([je]).mockResolvedValueOnce([je]);
    const result = await template.reverse({ jeIds: ['je1'], newContractId: 'new-c' });
    expect(result.reversalJeIds).toHaveLength(1);
    expect(createAndPost).toHaveBeenCalledTimes(1);
  });

  it('sweep JE อื่นบนสัญญาใหม่ (เช่น 2A accrual ระหว่าง window) ถูก reverse ด้วย', async () => {
    findMany
      .mockResolvedValueOnce([makeJe()])
      .mockResolvedValueOnce([
        makeJe({
          id: 'accrual-je',
          entryNumber: 'JE-202607-0500',
          metadata: { flow: 'installment-accrual-2a', contractId: 'new-c' },
        }),
      ]);
    const result = await template.reverse({ jeIds: ['je1'], newContractId: 'new-c' });
    expect(result.reversalJeIds).toHaveLength(2);
    expect(createAndPost).toHaveBeenCalledTimes(2);
  });
});
