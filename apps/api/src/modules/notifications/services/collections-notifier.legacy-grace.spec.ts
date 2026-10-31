import { CollectionsNotifierService } from './collections-notifier.service';

/**
 * Task 30 ข้อ 2 — A3 แจ้งสถานะสัญญา (ACTIVE → OVERDUE / DEFAULT · cron 00:30) ทาง LINE Flex ตรง (ไม่ผ่าน dispatch):
 * สัญญานำเข้าที่ลูกค้าผูก LINE ยังไม่ครบ 7 วัน = ไม่ส่ง · เก็บแถว BLOCKED เหตุผล LEGACY_LINK_GRACE
 */
describe('CollectionsNotifierService.notifyStatusChangedCustomers — ผ่อนผันหลังผูก LINE', () => {
  const contract = (id: string, lineUserId: string) => ({
    id,
    customerId: `cust-${id}`,
    contractNumber: `CT-${id}`,
    totalMonths: 12,
    customer: { id: `cust-${id}`, name: 'สมชาย', phone: null, lineLinks: [{ lineUserId }] },
    payments: [
      {
        installmentNo: 1,
        dueDate: new Date('2026-12-01T00:00:00Z'),
        amountDue: 1515.83,
        amountPaid: 0,
        lateFee: 100,
      },
    ],
  });

  function build(inGrace: string[]) {
    const prisma = {
      contract: {
        findMany: jest
          .fn()
          // ครั้งแรก = โหลดสัญญาที่เปลี่ยนสถานะ · ครั้งที่สอง = สัญญาในช่วงผ่อนผัน
          .mockResolvedValueOnce([contract('legacy', 'U-legacy'), contract('native', 'U-native')])
          .mockResolvedValueOnce(inGrace.map((id) => ({ id }))),
      },
      notificationLog: { create: jest.fn().mockResolvedValue({ id: 'log' }) },
    };
    const lineOa = { sendFlexMessage: jest.fn().mockResolvedValue(undefined) };
    const pdpa = { hasActiveConsent: jest.fn().mockResolvedValue(true) };
    const service = new CollectionsNotifierService(
      prisma as never,
      lineOa as never,
      pdpa as never,
      {} as never,
      {} as never,
    );
    return { prisma, lineOa, pdpa, service };
  }

  it('สัญญาในช่วงผ่อนผันไม่ได้รับแจ้งสถานะ · สัญญาอื่นได้ตามเดิม', async () => {
    const { prisma, lineOa, service } = build(['legacy']);

    await service.notifyStatusChangedCustomers(['legacy', 'native']);

    expect(lineOa.sendFlexMessage).toHaveBeenCalledTimes(1);
    expect(lineOa.sendFlexMessage).toHaveBeenCalledWith(
      'U-native',
      expect.anything(),
      'line-finance',
    );
    expect(prisma.notificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recipient: 'U-legacy',
          status: 'BLOCKED',
          blockReason: 'LEGACY_LINK_GRACE',
          category: 'DUNNING',
          relatedId: 'legacy',
          customerId: 'cust-legacy',
        }),
      }),
    );
    expect(prisma.contract.findMany.mock.calls[1][0].where.id).toEqual({
      in: ['legacy', 'native'],
    });
  });

  it('ไม่มีสัญญาในช่วงผ่อนผัน → แจ้งทุกสัญญาตามเดิม', async () => {
    const { lineOa, service } = build([]);
    await service.notifyStatusChangedCustomers(['legacy', 'native']);
    expect(lineOa.sendFlexMessage).toHaveBeenCalledTimes(2);
  });
});
