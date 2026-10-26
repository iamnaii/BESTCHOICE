// jest — วางนอก cpa-templates/ (jest ข้าม spec ใต้โฟลเดอร์นั้น)
import { Prisma } from '@prisma/client';
import { JournalAutoService } from './journal-auto.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ReceiptVoidReversalTemplate,
  redirectMirroredLines,
  type ReceiptVoidRedirect,
} from './cpa-templates/receipt-void-reversal.template';

const line = (accountCode: string, debit: string, credit: string, description = 'x') => ({
  accountCode,
  debit: new Prisma.Decimal(debit),
  credit: new Prisma.Decimal(credit),
  description,
});

const REDIRECT: ReceiptVoidRedirect = {
  accountPrefixes: ['11-11', '11-12'],
  to: '21-1106',
  description: 'โอนเป็นเครดิตเปลี่ยนเครื่อง',
};

function setup() {
  const original = {
    id: 'je-receipt',
    entryNumber: 'JE-0007',
    status: 'POSTED',
    metadata: { tag: 'receipt', flow: 'payment-receipt', contractId: 'ct-old', paymentId: 'pay-1' },
    lines: [line('11-1201', '1515.83', '0'), line('11-2103', '0', '1515.83')],
  };
  const prisma = {
    journalEntry: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(original),
      update: jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;
  const createAndPost = jest.fn().mockResolvedValue({ entryNumber: 'JE-0008' });
  const journal = { createAndPost } as unknown as JournalAutoService;
  return { tpl: new ReceiptVoidReversalTemplate(journal, prisma), createAndPost };
}

describe('redirectMirroredLines (pure)', () => {
  it('ย้ายเฉพาะบรรทัดที่บัญชีขึ้นต้นด้วย prefix — ยอด/ฝั่งเท่าเดิม ต่อท้ายคำอธิบาย', () => {
    const mirrored = [
      { accountCode: '11-2103', dr: new Prisma.Decimal('1515.83'), cr: new Prisma.Decimal(0), description: '[VOID] x' },
      { accountCode: '11-1201', dr: new Prisma.Decimal(0), cr: new Prisma.Decimal('1515.83'), description: '[VOID] x' },
    ];
    const out = redirectMirroredLines(mirrored, REDIRECT);
    expect(out.redirected).toBe(true);
    expect(out.lines.map((l) => l.accountCode)).toEqual(['11-2103', '21-1106']);
    expect(out.lines[1].cr.toFixed(2)).toBe('1515.83');
    expect(out.lines[1].description).toBe('[VOID] x · โอนเป็นเครดิตเปลี่ยนเครื่อง');
  });

  it('ไม่ส่ง redirect = บรรทัดเดิมทุกตัวอักษร', () => {
    const mirrored = [{ accountCode: '11-1201', dr: new Prisma.Decimal(0), cr: new Prisma.Decimal('1'), description: 'd' }];
    const out = redirectMirroredLines(mirrored, undefined);
    expect(out).toEqual({ lines: mirrored, redirected: false });
  });
});

describe('ReceiptVoidReversalTemplate.voidReceipt — redirect', () => {
  it('มี redirect: กระจกลง Cr 21-1106 แทน 11-1201 และ stamp redirectedTo', async () => {
    const { tpl, createAndPost } = setup();
    await tpl.voidReceipt('je-receipt', undefined, { redirect: REDIRECT });
    const input = createAndPost.mock.calls[0][0];
    const codes = input.lines.map((l: { accountCode: string }) => l.accountCode);
    // mirrorPostedLines คงลำดับบรรทัดเดิม (11-1201 ก่อน 11-2103) — เทียบแบบไม่สนลำดับ
    expect([...codes].sort()).toEqual(['11-2103', '21-1106']);
    expect(codes).not.toContain('11-1201');
    expect(input.metadata.redirectedTo).toBe('21-1106');
    expect(input.metadata.flow).toBe('receipt-void');
    expect(input.metadata.contractId).toBe('ct-old');
  });

  it('ไม่มี redirect: กระจก 11-1201 ตามเดิม ไม่มี redirectedTo', async () => {
    const { tpl, createAndPost } = setup();
    await tpl.voidReceipt('je-receipt');
    const input = createAndPost.mock.calls[0][0];
    expect(input.lines.map((l: { accountCode: string }) => l.accountCode).sort()).toEqual(['11-1201', '11-2103']);
    expect(input.metadata).not.toHaveProperty('redirectedTo');
  });
});
