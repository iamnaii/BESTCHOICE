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
 * ใบลดหนี้ตอนยกเลิกใบเสร็จ (PR3): ประวัติการจัดสรรของใบลดหนี้เองไม่มี — getReceipt หางวดเป้าหมายของเงินพักค่าปรับดิว
 * จากใบที่ถูกยกเลิก (voidedReceiptId) เพื่อให้ป้ายแถวเงินรับล่วงหน้าบนใบลดหนี้เท่าใบเดิม
 */
describe('ReceiptQueryService.getReceipt — งวดเป้าหมายของเงินพักบนใบลดหนี้', () => {
  const contract = {
    financedAmount: '22000',
    storeCommission: '2200',
    interestTotal: '17594.40',
    vatAmount: '2925.61',
    totalMonths: 10,
  };
  const rows: Record<string, Record<string, unknown>> = {
    'cn-1': {
      id: 'cn-1',
      receiptType: 'CREDIT_NOTE',
      voidedReceiptId: 'r-5516',
      paymentId: 'p-4',
      contractId: 'c-1',
      installmentNo: 4,
      issuedById: 'u-1',
      deletedAt: null,
      createdAt: new Date('2026-10-02T03:00:00Z'),
      contract,
    },
    'r-5516': {
      id: 'r-5516',
      receiptType: 'INSTALLMENT',
      voidedReceiptId: null,
      paymentId: 'p-4',
      contractId: 'c-1',
      installmentNo: 4,
      issuedById: 'u-1',
      deletedAt: null,
      isVoided: true,
      createdAt: new Date('2026-10-01T03:00:00Z'),
      contract,
    },
  };

  function build() {
    const prisma = {
      receipt: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => rows[where.id] ?? null),
        count: jest.fn().mockResolvedValue(0),
      },
      companyInfo: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      payment: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    (attachReceiptPaymentHistory as jest.Mock).mockReset();
    (attachReceiptPaymentHistory as jest.Mock).mockImplementation(
      async (_prisma: unknown, list: Array<{ id: string }>) =>
        list.map((r) =>
          r.id === 'r-5516'
            ? {
                ...r,
                installmentAllocations: [
                  { installmentNo: 4, amount: '4472.00', kind: 'INSTALLMENT' },
                  { installmentNo: 10, amount: '1044.00', kind: 'RESCHEDULE_ADVANCE' },
                ],
              }
            : { ...r, installmentAllocations: null },
        ),
    );
    return new ReceiptQueryService(prisma as never);
  }

  it('ใบลดหนี้ที่อ้างใบรวม 5,516 → advanceTargetInstallmentNo = งวด 10 (งวดเป้าหมายของเงินพักในใบเดิม)', async () => {
    const view = await build().getReceipt('cn-1');

    expect(view.advanceTargetInstallmentNo).toBe(10);
    expect(view.installmentAllocations).toBeNull();
  });

  it('ใบที่ไม่ใช่ใบลดหนี้ → ไม่ค้นใบเดิม (advanceTargetInstallmentNo = null)', async () => {
    const view = await build().getReceipt('r-5516');

    expect(view.advanceTargetInstallmentNo).toBeNull();
    expect(attachReceiptPaymentHistory).toHaveBeenCalledTimes(1);
  });
});
