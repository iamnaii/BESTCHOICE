import { ReceiptQueryService } from './receipt-query.service';
import { attachReceiptPaymentHistory } from './receipt-payment-history';

jest.mock('./receipt-payment-history', () => ({ attachReceiptPaymentHistory: jest.fn() }));
jest.mock('./receipt-fee-breakdown', () => ({
  attachReceiptFeeBreakdowns: jest.fn(async (_prisma: unknown, rows: unknown[]) => rows),
}));
jest.mock('./receipt-document-balance', () => ({
  getReceiptDocumentBalance: jest.fn(async () => ({})),
}));

/**
 * PR4ข (ฝ่ายบัญชี 16/10/2569 ข้อ 14 / 23.1 / 23.2 · mockup FWZ6vrgaixKmP1buUdrUry): PDF ของใบปรับดิว 6a และใบส่วนเกินลิงก์ชำระ
 * ต้องการบริบทจาก metadata ของรายการบัญชีต้นทาง — getReceipt โหลดให้เฉพาะสองชนิดนี้
 */
describe('ReceiptQueryService.getReceipt — บริบทใบปรับดิว / ใบส่วนเกินลิงก์ชำระ (PR4ข)', () => {
  const contract = {
    contractNumber: 'TEST-1',
    financedAmount: '10000',
    storeCommission: '1000',
    interestTotal: '6000',
    vatAmount: '1190',
    totalMonths: 12,
  };
  const base = {
    contractId: 'c-1',
    issuedById: 'u-1',
    deletedAt: null,
    voidedReceiptId: null,
    createdAt: new Date('2026-10-13T03:00:00Z'),
    contract,
  };
  const rows: Record<string, Record<string, unknown>> = {
    'r-6a': {
      ...base,
      id: 'r-6a',
      receiptType: 'RESCHEDULE_FEE',
      paymentId: 'p-4',
      installmentNo: 4,
      transactionRef: 'SLIP-1',
      sourceJournalEntryId: 'je-6a',
    },
    'r-6a-old': {
      ...base,
      id: 'r-6a-old',
      receiptType: 'RESCHEDULE_FEE',
      paymentId: 'p-4',
      installmentNo: 4,
      transactionRef: null,
      sourceJournalEntryId: 'je-6a-old',
    },
    'r-surplus': {
      ...base,
      id: 'r-surplus',
      receiptType: 'ADVANCE_SURPLUS',
      paymentId: null,
      installmentNo: null,
      transactionRef: 'TXN-9',
      sourceJournalEntryId: 'je-surplus',
    },
    'r-inst': {
      ...base,
      id: 'r-inst',
      receiptType: 'INSTALLMENT',
      paymentId: 'p-5',
      installmentNo: 5,
      transactionRef: 'TXN-9',
      sourceJournalEntryId: 'je-inst',
    },
  };
  const entries: Record<string, { metadata: Record<string, unknown> }> = {
    'je-6a': {
      metadata: {
        tag: 'reschedule-collect',
        variant: '6a',
        installmentNo: 4,
        daysToShift: 30,
        newDueDate: '2026-11-12T17:00:00.000Z',
        rescheduleFee: '1516',
        lateFeeCollected: '50',
      },
    },
    // รายการก่อน PR4ข — ไม่มี newDueDate
    'je-6a-old': {
      metadata: { tag: 'reschedule-collect', variant: '6a', daysToShift: 30, rescheduleFee: '1516' },
    },
    'je-surplus': {
      metadata: {
        tag: 'paysolutions-surplus-advance',
        refno: 'REF-9',
        surplus: '500',
        paidAmount: '2015.83',
        appliedAmount: '1515.83',
        installmentNos: [5],
        nextInstallmentNo: 6,
      },
    },
  };

  function build() {
    const prisma = {
      receipt: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => rows[where.id] ?? null),
        findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
          Object.values(rows)
            .filter((r) => r.receiptType === 'INSTALLMENT' && r.transactionRef === where.transactionRef)
            .map((r) => ({ receiptNumber: `RT-${r.id}`, installmentNo: r.installmentNo })),
        ),
        count: jest.fn().mockResolvedValue(0),
      },
      journalEntry: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => entries[where.id] ?? null),
      },
      companyInfo: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      payment: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    (attachReceiptPaymentHistory as jest.Mock).mockReset();
    (attachReceiptPaymentHistory as jest.Mock).mockImplementation(
      async (_prisma: unknown, list: Array<{ id: string }>) =>
        list.map((r) => ({ ...r, installmentAllocations: null })),
    );
    return { svc: new ReceiptQueryService(prisma as never), prisma };
  }

  it('ใบปรับดิว 6a → rescheduleContext จาก metadata: งวดที่ 4 เลื่อน 30 วัน ครบกำหนดใหม่ · surplusContext null', async () => {
    const view = await build().svc.getReceipt('r-6a');

    expect(view.rescheduleContext).toEqual({
      installmentNo: 4,
      daysToShift: 30,
      newDueDate: '2026-11-12T17:00:00.000Z',
    });
    expect(view.surplusContext).toBeNull();
  });

  it('ใบปรับดิวของรายการเก่าที่ไม่มี newDueDate → newDueDate null (ไม่เดา)', async () => {
    const view = await build().svc.getReceipt('r-6a-old');

    expect(view.rescheduleContext).toEqual({ installmentNo: 4, daysToShift: 30, newDueDate: null });
  });

  it('ใบส่วนเกินลิงก์ชำระ → surplusContext: refno · ยอดโอน 2,015.83 · เข้างวด 1,515.83 · งวด [5] · งวดถัดไป 6 · ใบงวดพี่น้อง (transactionRef เดียวกัน)', async () => {
    const { svc, prisma } = build();
    const view = await svc.getReceipt('r-surplus');

    expect(view.surplusContext).toEqual({
      refno: 'REF-9',
      paidAmount: '2015.83',
      appliedAmount: '1515.83',
      installmentNos: [5],
      nextInstallmentNo: 6,
      siblingReceipts: [{ receiptNumber: 'RT-r-inst', installmentNo: 5 }],
    });
    expect(view.rescheduleContext).toBeNull();
    expect(prisma.receipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contractId: 'c-1',
          transactionRef: 'TXN-9',
          isVoided: false,
          deletedAt: null,
        }),
      }),
    );
  });

  it('ใบค่างวดธรรมดา → ไม่โหลดรายการบัญชี ไม่มีบริบททั้งสอง', async () => {
    const { svc, prisma } = build();
    const view = await svc.getReceipt('r-inst');

    expect(view.rescheduleContext).toBeNull();
    expect(view.surplusContext).toBeNull();
    expect(prisma.journalEntry.findUnique).not.toHaveBeenCalled();
  });
});
