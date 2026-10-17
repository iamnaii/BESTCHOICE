// jest — วางนอก cpa-templates/ (jest ข้าม spec ใต้โฟลเดอร์นั้น)
import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { JournalAutoService } from './journal-auto.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DefectExchangeReversalTemplate,
  DEFECT_EXCHANGE_CREDIT_IN_FLOW,
  DEFECT_EXCHANGE_CREDIT_OUT_FLOW,
} from './cpa-templates/defect-exchange-reversal.template';

const line = (accountCode: string, debit: number, credit: number) => ({
  accountCode,
  debit: new Prisma.Decimal(debit),
  credit: new Prisma.Decimal(credit),
  description: 'x',
});

function setup(entries: Array<Record<string, unknown>>) {
  const prisma = {
    contract: { findUniqueOrThrow: jest.fn().mockResolvedValue({ contractNumber: 'CT-OLD' }) },
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

const activation = {
  id: 'je-1a',
  entryNumber: 'JE-0001',
  metadata: { tag: '1A', contractId: 'ct-1' },
  lines: [line('11-2101', 17000, 0), line('21-1101', 0, 17000)],
};

describe('DefectExchangeReversalTemplate — flow เครดิตเปลี่ยนเครื่อง + รายการเงินสด (15ข)', () => {
  it.each([DEFECT_EXCHANGE_CREDIT_OUT_FLOW, DEFECT_EXCHANGE_CREDIT_IN_FLOW])(
    'ข้าม flow %s (ไม่ mirror การย้ายเครดิต)',
    async (flow) => {
      const credit = {
        id: 'je-credit',
        entryNumber: 'JE-0005',
        metadata: { tag: 'DEFECT_EXCHANGE', flow, contractId: 'ct-1' },
        lines: [line('21-1106', 1515.83, 0), line('21-5101', 0, 1515.83)],
      };
      const { tpl, createAndPost } = setup([activation, credit]);
      const result = await tpl.reverseContract('ct-1');
      expect(result.reversedCount).toBe(1);
      expect(createAndPost.mock.calls[0][0].metadata.originalEntryId).toBe('je-1a');
    },
  );

  it('รายการเงินสดที่คู่เป็นเงินของลูกค้าล้วน (overpayment-credit: Dr ธนาคาร / Cr 21-5101 + ภาษีพัก) = ข้าม ไม่ mirror', async () => {
    const overpay = {
      id: 'je-over',
      entryNumber: 'JE-0006',
      metadata: { tag: 'overpayment-credit', contractId: 'ct-1', paymentId: 'pay-1', advanceVatPark: '19.63' },
      lines: [line('11-1201', 300, 0), line('21-5101', 0, 300), line('21-2102', 19.63, 0), line('21-2101', 0, 19.63)],
    };
    const { tpl, createAndPost } = setup([activation, overpay]);
    const result = await tpl.reverseContract('ct-1');
    expect(result.reversedCount).toBe(1);
    expect(createAndPost).toHaveBeenCalledTimes(1);
  });

  it('รายการเงินสดอื่น (ใบรับชำระที่ไม่ถูกยกเลิกก่อน: Dr ธนาคาร / Cr 11-2103) = ปฏิเสธทั้งรายการ ระบุเลขที่', async () => {
    const orphanReceipt = {
      id: 'je-rc',
      entryNumber: 'JE-0007',
      metadata: { tag: 'receipt', flow: 'payment-receipt', contractId: 'ct-1', paymentId: 'pay-2' },
      lines: [line('11-1201', 1515.83, 0), line('11-2103', 0, 1515.83)],
    };
    const { tpl, createAndPost } = setup([activation, orphanReceipt]);
    await expect(tpl.reverseContract('ct-1')).rejects.toThrow(BadRequestException);
    await expect(tpl.reverseContract('ct-1')).rejects.toThrow(/JE-0007/);
    expect(createAndPost).not.toHaveBeenCalled();
  });
});
