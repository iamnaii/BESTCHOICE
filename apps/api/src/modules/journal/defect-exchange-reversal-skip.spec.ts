// Jest unit test — วางนอก cpa-templates/ เพราะ jest ข้ามทุก spec ใต้โฟลเดอร์นั้น
// (ดู testPathIgnorePatterns ใน apps/api/package.json).
import { Prisma } from '@prisma/client';
import { JournalAutoService } from './journal-auto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DefectExchangeReversalTemplate } from './cpa-templates/defect-exchange-reversal.template';

const line = (accountCode: string, debit: number, credit: number) => ({
  accountCode,
  debit: new Prisma.Decimal(debit),
  credit: new Prisma.Decimal(credit),
  description: 'x',
});

function setup(entries: Array<Record<string, unknown>>) {
  const prisma = {
    contract: { findUniqueOrThrow: jest.fn().mockResolvedValue({ contractNumber: 'BCP-0001' }) },
    journalEntry: {
      findMany: jest.fn().mockResolvedValue(entries),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;
  const createAndPost = jest.fn().mockResolvedValue({ entryNumber: 'JE-9999' });
  const journal = { createAndPost } as unknown as JournalAutoService;
  return { tpl: new DefectExchangeReversalTemplate(journal, prisma), createAndPost };
}

describe('DefectExchangeReversalTemplate — ข้ามรายการกลับรายการ', () => {
  const activation = {
    id: 'je-1a',
    entryNumber: 'JE-0001',
    metadata: { tag: '1A', contractId: 'ct-1' },
    lines: [line('11-2101', 17000, 0), line('21-1101', 0, 17000)],
  };

  it.each(['receipt-void', 'refund-reversal', 'defect-exchange', 'exchange-cancel'])(
    'ไม่ mirror รายการกลับรายการ flow %s ที่ผูก contractId',
    async (flow) => {
      const reversal = {
        id: 'je-rev',
        entryNumber: 'JE-0003',
        metadata: { tag: 'REVERSAL', flow, originalEntryId: 'je-2b', contractId: 'ct-1' },
        lines: [line('11-2103', 1515.83, 0), line('11-1101', 0, 1515.83)],
      };
      const { tpl, createAndPost } = setup([activation, reversal]);

      const result = await tpl.reverseContract('ct-1');

      expect(result.reversedCount).toBe(1);
      expect(createAndPost).toHaveBeenCalledTimes(1);
      expect(createAndPost.mock.calls[0][0].metadata.originalEntryId).toBe('je-1a');
    },
  );

  it('ใบรับชำระที่ถูกกลับรายการแล้ว (reversed: true) ยังถูกข้ามเหมือนเดิม', async () => {
    const reversedReceipt = {
      id: 'je-2b',
      entryNumber: 'JE-0002',
      metadata: { tag: 'receipt', contractId: 'ct-1', reversed: true },
      lines: [line('11-1101', 1515.83, 0), line('11-2103', 0, 1515.83)],
    };
    const { tpl, createAndPost } = setup([activation, reversedReceipt]);
    await tpl.reverseContract('ct-1');
    expect(createAndPost).toHaveBeenCalledTimes(1);
  });
});
