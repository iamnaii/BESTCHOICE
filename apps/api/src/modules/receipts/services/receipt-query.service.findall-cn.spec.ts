import { ReceiptQueryService } from './receipt-query.service';

/**
 * ReceiptQueryService.findAll — Phase 3 Task 6 addition: batch-attach the
 * latest CN (ใบลดหนี้) LINE-delivery status onto CN rows (cnSource != null)
 * so ReceiptsTab can render a ส่งแล้ว/ส่งไม่สำเร็จ/ยังไม่ส่ง chip without an
 * N+1 NotificationLog lookup per row.
 */
describe('ReceiptQueryService.findAll — lastCnDelivery attach', () => {
  let service: ReceiptQueryService;
  let prisma: {
    receipt: { findMany: jest.Mock; count: jest.Mock; aggregate: jest.Mock };
    notificationLog: { findMany: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      receipt: {
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 }, _count: 0 }),
      },
      notificationLog: { findMany: jest.fn() },
    };
    service = new ReceiptQueryService(prisma as never);
  });

  it('does not query NotificationLog when the page has no CN rows', async () => {
    prisma.receipt.findMany.mockResolvedValue([
      { id: 'r1', cnSource: null, receiptType: 'PAYMENT' },
    ]);

    const result = await service.findAll({});

    expect(prisma.notificationLog.findMany).not.toHaveBeenCalled();
    expect(result.data[0].lastCnDelivery).toBeUndefined();
  });

  it('attaches the latest NotificationLog status for CN rows, batched (single query for all CN ids)', async () => {
    prisma.receipt.findMany.mockResolvedValue([
      { id: 'r1', cnSource: 'REPOSSESSION', receiptType: 'CREDIT_NOTE' },
      { id: 'r2', cnSource: 'WRITE_OFF', receiptType: 'CREDIT_NOTE' },
      { id: 'r3', cnSource: null, receiptType: 'PAYMENT' },
    ]);
    const newest = new Date('2026-07-24T10:00:00Z');
    const older = new Date('2026-07-20T10:00:00Z');
    prisma.notificationLog.findMany.mockResolvedValue([
      { relatedId: 'r1', status: 'SENT', createdAt: newest },
      { relatedId: 'r1', status: 'FAILED', createdAt: older }, // older attempt — must not win
      { relatedId: 'r2', status: 'FAILED', createdAt: newest },
    ]);

    const result = await service.findAll({});

    expect(prisma.notificationLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { category: 'CREDIT_NOTE', relatedId: { in: ['r1', 'r2'] } },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(result.data[0].lastCnDelivery).toEqual({ status: 'SENT', createdAt: newest });
    expect(result.data[1].lastCnDelivery).toEqual({ status: 'FAILED', createdAt: newest });
    // Non-CN row keeps lastCnDelivery undefined (not even attempted).
    expect(result.data[2].lastCnDelivery).toBeUndefined();
  });

  it('sets lastCnDelivery to null for a CN row with no delivery log yet', async () => {
    prisma.receipt.findMany.mockResolvedValue([
      { id: 'r1', cnSource: 'REPOSSESSION', receiptType: 'CREDIT_NOTE' },
    ]);
    prisma.notificationLog.findMany.mockResolvedValue([]);

    const result = await service.findAll({});

    expect(result.data[0].lastCnDelivery).toBeNull();
  });
});
