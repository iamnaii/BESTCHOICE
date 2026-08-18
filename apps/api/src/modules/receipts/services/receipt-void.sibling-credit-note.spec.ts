/**
 * Voiding one receipt of a MULTI-RECEIPT installment must issue a ใบลดหนี้
 * (credit note) for EVERY receipt it voids — not only the one the user clicked.
 *
 * Found on prod contract TEST-20260809-004 (2026-08-18): installment 4 had two
 * receipts (1,771 partial + 2,000 completion). Voiding the 2,000 one voided both
 * (correct — un-pay is per-Payment, see the service's "Un-pay semantics" note)
 * and reversed BOTH receipt JEs (correct — `originalEntries` is a findMany over
 * every JE sharing metadata.paymentId), but created exactly ONE credit note, for
 * 2,000. The 1,771 receipt — printed as "ใบเสร็จรับเงิน / ใบกำกับภาษี" whenever
 * VAT applies (receipt-pdf.service.ts) — was cancelled with no cancelling
 * document, i.e. a ม.86/10 gap for a VAT-registered entity (FINANCE).
 *
 * Jest unit spec (mocked prisma) — the DB-level flow lives in
 * park-void-restore.integration.spec.ts, which jest ignores by config.
 */
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReceiptVoidReversalTemplate } from '../../journal/cpa-templates/receipt-void-reversal.template';
import { ReceiptNumberService } from './receipt-number.service';
import { ReceiptVoidService } from './receipt-void.service';

const dec = (n: number) => new Prisma.Decimal(n);

const TARGET_ID = 'rcpt-2000';
const SIBLING_ID = 'rcpt-1771';
const PAYMENT_ID = 'pay-inst-4';
const CONTRACT_ID = 'contract-1';

function makeReceipt(over: Record<string, unknown> = {}) {
  return {
    id: TARGET_ID,
    receiptNumber: 'RT-202608-00007',
    contractId: CONTRACT_ID,
    paymentId: PAYMENT_ID,
    receiptType: 'INSTALLMENT',
    payerName: 'ทดสอบ ค้าง 3 งวด',
    receiverName: 'เอกนรินทร์ คงเดช',
    amount: dec(2000),
    installmentNo: 4,
    paymentMethod: 'CASH',
    paidDate: new Date('2026-08-16T00:00:00.000Z'),
    createdAt: new Date('2026-08-16T00:00:00.000Z'),
    isVoided: false,
    deletedAt: null,
    ...over,
  };
}

function setup() {
  const siblingRows = [
    {
      id: SIBLING_ID,
      receiptNumber: 'RT-202608-00006',
      contractId: CONTRACT_ID,
      paymentId: PAYMENT_ID,
      receiptType: 'INSTALLMENT',
      payerName: 'ทดสอบ ค้าง 3 งวด',
      receiverName: 'เอกนรินทร์ คงเดช',
      amount: dec(1771),
      installmentNo: 4,
      paymentMethod: 'CASH',
      paidDate: new Date('2026-08-16T00:00:00.000Z'),
    },
  ];

  const receiptCreate = jest.fn(({ data }: any) => Promise.resolve({ ...data, id: `cn-${data.receiptNumber}` }));

  const tx = {
    receipt: {
      findUnique: jest.fn().mockResolvedValue(makeReceipt()),
      findMany: jest.fn().mockResolvedValue(siblingRows),
      create: receiptCreate,
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: siblingRows.length }),
    },
    contract: {
      findUnique: jest.fn().mockResolvedValue({ id: CONTRACT_ID, status: 'ACTIVE' }),
      update: jest.fn().mockResolvedValue({}),
    },
    // No POSTED receipt JEs in this fixture → the ledger-reversal loop is a
    // graceful no-op (documented behaviour for legacy no-JE payments). The
    // credit-note obligation is independent of it.
    journalEntry: { findMany: jest.fn().mockResolvedValue([]) },
    payment: {
      findUnique: jest.fn().mockResolvedValue({
        id: PAYMENT_ID,
        status: 'PAID',
        amountPaid: dec(3771),
        amountDue: dec(3671),
        dueDate: new Date('2026-08-09T00:00:00.000Z'),
        contractId: CONTRACT_ID,
        installmentNo: 4,
        deletedAt: null,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    installmentSchedule: { findUnique: jest.fn().mockResolvedValue(null) },
    loyaltyPoint: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'approver-1', role: 'OWNER', isActive: true, deletedAt: null }),
    },
    // FINANCE not configured in this fixture → validatePeriodOpen is a
    // documented no-op without a companyId.
    companyInfo: { findFirst: jest.fn().mockResolvedValue(null) },
    systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((cb: any) => cb(tx)),
  } as unknown as PrismaService;

  let seq = 13;
  const numbers = {
    generateReceiptNumber: jest.fn(() =>
      Promise.resolve(`RT-202608-${String(++seq).padStart(5, '0')}`),
    ),
  } as unknown as ReceiptNumberService;

  const reversal = { voidReceipt: jest.fn() } as unknown as ReceiptVoidReversalTemplate;
  const service = new ReceiptVoidService(prisma, reversal, numbers);
  return { service, tx, receiptCreate };
}

const creditNotesFrom = (createMock: jest.Mock) =>
  createMock.mock.calls
    .map(([{ data }]: any) => data)
    .filter((d: any) => d.receiptType === 'CREDIT_NOTE');

describe('ReceiptVoidService — credit note per voided receipt', () => {
  it('issues a credit note for the sibling receipt voided alongside the target', async () => {
    const { service, receiptCreate } = setup();

    await service.voidReceipt(TARGET_ID, 'คีย์ยอดผิด', 'maker-1', 'approver-1', 'OWNER');

    const cns = creditNotesFrom(receiptCreate as jest.Mock);
    expect(cns).toHaveLength(2);
    expect(cns.map((c: any) => c.voidedReceiptId).sort()).toEqual([SIBLING_ID, TARGET_ID].sort());
  });

  it('credit-note total equals the money actually cancelled (2,000 + 1,771)', async () => {
    const { service, receiptCreate } = setup();

    await service.voidReceipt(TARGET_ID, 'คีย์ยอดผิด', 'maker-1', 'approver-1', 'OWNER');

    const total = creditNotesFrom(receiptCreate as jest.Mock).reduce(
      (acc: Prisma.Decimal, c: any) => acc.plus(new Prisma.Decimal(c.amount)),
      new Prisma.Decimal(0),
    );
    expect(total.toFixed(2)).toBe('3771.00');
  });

  it('each credit note carries its own source receipt amount and installment', async () => {
    const { service, receiptCreate } = setup();

    await service.voidReceipt(TARGET_ID, 'คีย์ยอดผิด', 'maker-1', 'approver-1', 'OWNER');

    const bySource = new Map(
      creditNotesFrom(receiptCreate as jest.Mock).map((c: any) => [c.voidedReceiptId, c]),
    );
    expect(new Prisma.Decimal(bySource.get(TARGET_ID).amount).toFixed(2)).toBe('2000.00');
    expect(new Prisma.Decimal(bySource.get(SIBLING_ID).amount).toFixed(2)).toBe('1771.00');
    expect(bySource.get(SIBLING_ID).installmentNo).toBe(4);
    expect(bySource.get(SIBLING_ID).receiptType).toBe('CREDIT_NOTE');
  });

  it('records every credit note in the RECEIPT_VOID audit trail', async () => {
    const { service, tx } = setup();

    await service.voidReceipt(TARGET_ID, 'คีย์ยอดผิด', 'maker-1', 'approver-1', 'OWNER');

    const audit = (tx.auditLog.create as jest.Mock).mock.calls[0][0].data;
    expect(audit.action).toBe('RECEIPT_VOID');
    expect(audit.newValue.siblingCreditNoteNumbers).toHaveLength(1);
  });

  it('single-receipt installment still issues exactly one credit note', async () => {
    const { service, tx, receiptCreate } = setup();
    (tx.receipt.findMany as jest.Mock).mockResolvedValue([]);
    (tx.receipt.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

    await service.voidReceipt(TARGET_ID, 'คีย์ยอดผิด', 'maker-1', 'approver-1', 'OWNER');

    expect(creditNotesFrom(receiptCreate as jest.Mock)).toHaveLength(1);
  });
});
