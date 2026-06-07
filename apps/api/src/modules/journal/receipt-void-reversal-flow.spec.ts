// Jest unit test for the `flow` param of ReceiptVoidReversalTemplate.
// NOTE: lives in journal/ (not cpa-templates/) on purpose — jest ignores
// /cpa-templates/*.spec.ts (those are vitest DB-integration specs run separately),
// so a jest-runnable unit test for this logic must sit outside that folder.
import { Prisma } from '@prisma/client';
import { JournalAutoService } from './journal-auto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ReceiptVoidReversalTemplate } from './cpa-templates/receipt-void-reversal.template';

describe('ReceiptVoidReversalTemplate flow param', () => {
  function setup() {
    const findFirst = jest.fn().mockResolvedValue(null); // no existing reversal
    const findUnique = jest.fn().mockResolvedValue({
      id: 'je-1',
      entryNumber: 'JE-0001',
      status: 'POSTED',
      metadata: {},
      lines: [
        { accountCode: '11-1201', debit: new Prisma.Decimal(100), credit: new Prisma.Decimal(0), description: 'x' },
        { accountCode: '11-2101', debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(100), description: 'y' },
      ],
    });
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      journalEntry: { findFirst, findUnique, update },
    } as unknown as PrismaService;
    const createAndPost = jest.fn().mockResolvedValue({ entryNumber: 'JE-0002' });
    const journal = { createAndPost } as unknown as JournalAutoService;
    const tpl = new ReceiptVoidReversalTemplate(journal, prisma);
    return { tpl, findFirst, createAndPost };
  }

  it('default flow is receipt-void (unchanged)', async () => {
    const { tpl, findFirst, createAndPost } = setup();
    await tpl.voidReceipt('je-1');
    const idemWhere = findFirst.mock.calls[0][0].where.AND;
    expect(idemWhere).toEqual(
      expect.arrayContaining([{ metadata: { path: ['flow'], equals: 'receipt-void' } }]),
    );
    expect(createAndPost.mock.calls[0][0].metadata.flow).toBe('receipt-void');
  });

  it('opts.flow overrides both the idempotency lookup and the metadata stamp', async () => {
    const { tpl, findFirst, createAndPost } = setup();
    await tpl.voidReceipt('je-1', undefined, { flow: 'refund-reversal' });
    const idemWhere = findFirst.mock.calls[0][0].where.AND;
    expect(idemWhere).toEqual(
      expect.arrayContaining([{ metadata: { path: ['flow'], equals: 'refund-reversal' } }]),
    );
    expect(createAndPost.mock.calls[0][0].metadata.flow).toBe('refund-reversal');
  });
});
