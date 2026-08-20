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

  it("sweep เจอ void JE (tag REVERSAL, flow receipt-void) → ข้าม ไม่ mirror ไม่ stamp", async () => {
    // Receipt-void pair: original 2B (stamped reversed:true → skipped) + its void JE.
    // Mirroring the void JE would RE-POST the receipt effect into GL with no cash.
    findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeJe({
          id: 'void-je',
          metadata: { tag: 'REVERSAL', flow: 'receipt-void', contractId: 'new-c' },
        }),
      ]);
    const result = await template.reverse({ jeIds: [], newContractId: 'new-c' });
    expect(result.reversalJeIds).toEqual([]);
    expect(createAndPost).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
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

  // ─── Phase 3 Task 1: generalized sweep (excludeFlows / redirects / flowLabel) ──

  describe('generalized sweep options (Phase 3)', () => {
    const mkLine = (accountCode: string, debit: string, credit: string, description = '') => ({
      accountCode,
      debit: new Decimal(debit),
      credit: new Decimal(credit),
      description,
    });

    it('default: ไม่ส่ง options ใหม่ → พฤติกรรมเดิมทุกประการ + redirectedTotals ว่าง', async () => {
      findMany.mockResolvedValueOnce([makeJe()]).mockResolvedValueOnce([]);
      const result = await template.reverse({ jeIds: ['je1'], newContractId: 'new-c' });

      expect(result.redirectedTotals).toEqual({});
      const input = createAndPost.mock.calls[0][0];
      // exchange defaults byte-identical: flow / idempotencyKey / description / reference
      expect(input.metadata.flow).toBe('exchange-cancel');
      expect(input.metadata.idempotencyKey).toBe('cancel:je1');
      expect(input.description).toBe('[ยกเลิกเปลี่ยนเครื่อง] กลับรายการ JE-202607-0001');
      expect(input.reference).toBe('je1:exchange-cancel');
      expect(input.lines[0].description).toBe('[ยกเลิกเปลี่ยนเครื่อง] ตั้งลูกหนี้');
    });

    it('excludeFlows: JE flow=provision ไม่ถูก mirror และไม่ถูก stamp reversed', async () => {
      findMany
        .mockResolvedValueOnce([makeJe()])
        .mockResolvedValueOnce([
          makeJe({ id: 'prov-je', metadata: { flow: 'provision', contractId: 'new-c' } }),
        ]);
      const result = await template.reverse({
        jeIds: ['je1'],
        newContractId: 'new-c',
        excludeFlows: ['provision'],
      });

      expect(result.reversalJeIds).toHaveLength(1);
      expect(createAndPost).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledTimes(1);
      expect(update.mock.calls[0][0].where).toEqual({ id: 'je1' });
    });

    it('redirect: mirror leg 21-1101 Dr 10,000 → 11-2107 Dr 10,000 + description ใหม่ + JE stamp redirectStamp', async () => {
      const je = makeJe({
        lines: [
          mkLine('21-1101', '0', '10000', 'เจ้าหนี้ยอดจัด'),
          mkLine('11-1201', '10000', '0', 'ธนาคาร'),
        ],
      });
      findMany.mockResolvedValueOnce([je]).mockResolvedValueOnce([]);
      const result = await template.reverse({
        jeIds: ['je1'],
        newContractId: 'new-c',
        redirects: { '21-1101': { to: '11-2107', description: 'ตั้งลูกหนี้เรียกคืนจากยกเลิก' } },
        redirectStamp: { shopReceivableType: 'PAYOUT_RECALL' },
      });

      const input = createAndPost.mock.calls[0][0];
      // redirected leg: mirror amount (dr↔cr swapped) lands on the destination account
      expect(input.lines[0].accountCode).toBe('11-2107');
      expect(input.lines[0].dr.toString()).toBe('10000');
      expect(input.lines[0].cr.toString()).toBe('0');
      expect(input.lines[0].description).toBe('ตั้งลูกหนี้เรียกคืนจากยกเลิก');
      // non-redirected leg untouched (still mirrored with prefix)
      expect(input.lines[1].accountCode).toBe('11-1201');
      expect(input.lines[1].cr.toString()).toBe('10000');
      // redirectStamp merged into metadata of the JE that has a redirect leg
      expect(input.metadata).toEqual(
        expect.objectContaining({ shopReceivableType: 'PAYOUT_RECALL' }),
      );
      expect(result.redirectedTotals['11-2107'].toFixed(2)).toBe('10000.00');
    });

    it('redirectStamp: JE ที่ไม่มี redirect leg ต้องไม่ถูก stamp', async () => {
      findMany
        .mockResolvedValueOnce([
          makeJe({
            id: 'no-redirect-je',
            lines: [mkLine('11-2101', '5000', '0'), mkLine('11-2106', '0', '5000')],
          }),
        ])
        .mockResolvedValueOnce([]);
      await template.reverse({
        jeIds: ['no-redirect-je'],
        newContractId: 'new-c',
        redirects: { '21-1101': { to: '11-2107', description: 'x' } },
        redirectStamp: { shopReceivableType: 'PAYOUT_RECALL' },
      });
      const input = createAndPost.mock.calls[0][0];
      expect(input.metadata.shopReceivableType).toBeUndefined();
    });

    it('redirectedTotals: รวม Dr−Cr ต่อบัญชีปลายทาง (สอง JE, สองบัญชีต้นทาง → ปลายทางเดียว)', async () => {
      const jeA = makeJe({
        id: 'jeA',
        lines: [mkLine('21-1101', '0', '10000'), mkLine('11-1201', '10000', '0')],
      });
      const jeB = makeJe({
        id: 'jeB',
        lines: [
          mkLine('21-1101', '200', '0'), // mirror = Cr 200 → −200 on destination
          mkLine('11-1201', '1300', '0'),
          mkLine('21-1102', '0', '1500'), // mirror = Dr 1500 → +1500
        ],
      });
      findMany.mockResolvedValueOnce([jeA, jeB]).mockResolvedValueOnce([]);
      const result = await template.reverse({
        jeIds: ['jeA', 'jeB'],
        newContractId: 'new-c',
        redirects: {
          '21-1101': { to: '11-2107', description: 'x' },
          '21-1102': { to: '11-2107', description: 'y' },
        },
      });

      // 10000 (jeA) + 1500 − 200 (jeB) = 11300 — computed from mirror lines (Dr−Cr)
      expect(result.redirectedTotals['11-2107'].toFixed(2)).toBe('11300.00');
      expect(Object.keys(result.redirectedTotals)).toEqual(['11-2107']);
    });

    it('flowLabel/descriptionPrefix override: metadata.flow, idempotencyKey, description เปลี่ยน + skip flow ตัวเองใช้ label ใหม่', async () => {
      findMany
        .mockResolvedValueOnce([makeJe()])
        .mockResolvedValueOnce([
          makeJe({
            id: 'own-rev',
            metadata: { flow: 'contract-cancel-c2', contractId: 'new-c' },
          }),
        ]);
      const result = await template.reverse({
        jeIds: ['je1'],
        newContractId: 'new-c',
        flowLabel: 'contract-cancel-c2',
        descriptionPrefix: '[ยกเลิกสัญญา]',
      });

      // own-flow JE (resolved label) skipped — not hardcoded 'exchange-cancel'
      expect(result.reversalJeIds).toHaveLength(1);
      expect(createAndPost).toHaveBeenCalledTimes(1);
      const input = createAndPost.mock.calls[0][0];
      expect(input.metadata.flow).toBe('contract-cancel-c2');
      expect(input.metadata.idempotencyKey).toBe('contract-cancel-c2:je1');
      expect(input.description).toBe('[ยกเลิกสัญญา] กลับรายการ JE-202607-0001');
      expect(input.reference).toBe('je1:contract-cancel-c2');
      expect(input.lines[0].description).toBe('[ยกเลิกสัญญา] ตั้งลูกหนี้');
    });
  });
});
