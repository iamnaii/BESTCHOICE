import { buildQueryService, enrichmentMocks } from './__tests__/mock-customer-db';

function detailFixture(overrides: Record<string, unknown> = {}) {
  const findUnique = jest.fn().mockResolvedValue({
    id: 'c1', name: 'สมชาย ใจดี', nickname: null, phone: '0812345678', nationalId: null,
    acquisitionSource: 'CHAT_FACEBOOK', referredById: null, deletedAt: null,
    contracts: [], sales: [], _count: { contracts: 0, referrals: 0 }, referredBy: null,
    ...overrides,
  });
  const enrich = enrichmentMocks();
  const db = {
    customer: { findUnique },
    customerTag: { findMany: jest.fn().mockResolvedValue([{ tag: 'LOYAL' }]) },
    callLog: { findMany: jest.fn().mockResolvedValue([]) },
    ...enrich,
  };
  return { db, service: buildQueryService(db, {}) };
}

describe('CustomerQueryService.findDetail', () => {
  it('รวมแท็ก · ที่มา · สรุปการซื้อ · ห้องแชท ไว้ในคำตอบเดียว และคงฟิลด์ของ findOne', async () => {
    const { db, service } = detailFixture();
    db.chatRoom.findMany.mockResolvedValue([
      { id: 'r1', customerId: 'c1', channel: 'FACEBOOK', lastMessageAt: new Date('2026-09-14T11:40:00.000Z'), lastCustomerAt: new Date('2026-09-14T11:40:00.000Z'), assignedTo: { id: 'u2', name: 'แนน' } },
    ]);
    const res = await service.findDetail('c1');
    expect(res).toMatchObject({
      id: 'c1',
      chatPlaceholder: false,
      tags: [{ tag: 'LOYAL' }],
      source: 'FACEBOOK',
      purchase: { installmentTotal: 0, cashCount: 0, externalFinanceCount: 0 },
      latestPurchase: null,
      installmentBalance: null,
      assignedTo: { id: 'u2', name: 'แนน' },
      openContracts: [],
    });
    expect(res.chatRooms).toEqual([expect.objectContaining({ roomId: 'r1', channel: 'FACEBOOK' })]);
    expect(db.customerTag.findMany).toHaveBeenCalledWith({ where: { customerId: 'c1', deletedAt: null }, select: { tag: true } });
  });

  it('สัญญาที่กำลังผ่อน → openContracts มาจากตารางงวดของสัญญานั้น + โทรล่าสุด', async () => {
    const { db, service } = detailFixture();
    const openRow = {
      id: 'k1', contractNumber: 'CT-2569-0042', status: 'ACTIVE', monthlyPayment: '4200.00', totalMonths: 2,
      createdAt: new Date('2026-08-05T03:00:00.000Z'), mdmLockedAt: null, shopWarrantyEndDate: null,
      branch: { name: 'สำนักงานใหญ่' }, product: { brand: 'Apple', model: 'iPhone 15', storage: '128GB', imeiSerial: null, warrantyExpireDate: null },
    };
    // purchase summary ก็เรียก contract.findMany / payment.findMany — แยกคำขอของ findDetail ด้วย select ที่มีเฉพาะมัน
    db.contract.findMany.mockImplementation(async (args: { select?: Record<string, unknown> }) => (args.select?.mdmLockedAt ? [openRow] : []));
    db.payment.findMany.mockImplementation(async (args: { distinct?: unknown }) =>
      args.distinct
        ? []
        : [
            { contractId: 'k1', installmentNo: 1, status: 'PAID', dueDate: new Date('2026-09-05T00:00:00.000Z'), amountDue: '4200.00', amountPaid: '4200.00' },
            { contractId: 'k1', installmentNo: 2, status: 'PENDING', dueDate: new Date('2099-10-05T00:00:00.000Z'), amountDue: '4200.00', amountPaid: '0' },
          ],
    );
    db.callLog.findMany.mockResolvedValue([
      { contractId: 'k1', calledAt: new Date('2026-09-10T07:32:00.000Z'), result: 'ANSWERED', notes: null, caller: { name: 'แนน' } },
    ]);
    const res = await service.findDetail('c1');
    expect(res.openContracts).toHaveLength(1);
    expect(res.openContracts[0]).toMatchObject({ contractNumber: 'CT-2569-0042', paidInstallments: 1, remainingInstallments: 1, outstanding: 4200, lastCall: { result: 'ANSWERED', callerName: 'แนน' } });
  });

  it('ลูกค้าไม่มีอยู่ → NotFoundException จาก findOne เดิม และไม่ยิง query เสริม', async () => {
    const { db, service } = detailFixture();
    db.customer.findUnique.mockResolvedValue(null);
    await expect(service.findDetail('nope')).rejects.toThrow('ไม่พบลูกค้า');
    expect(db.customerTag.findMany).not.toHaveBeenCalled();
  });
});
