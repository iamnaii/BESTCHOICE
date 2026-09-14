import { planBackfill, runBackfill } from './backfill-chat-prospects.cli';

const rooms = [
  { id: 'r1', channel: 'FACEBOOK', lineUserId: null, externalUserId: 'psid-a', displayName: 'A', createdAt: new Date('2026-05-12') },
  { id: 'r2', channel: 'FACEBOOK', lineUserId: null, externalUserId: 'psid-a', displayName: null, createdAt: new Date('2026-06-01') }, // ห้องซ้ำของ A
  { id: 'r3', channel: 'LINE_SHOP', lineUserId: 'Ub', externalUserId: null, displayName: 'B', createdAt: new Date('2026-07-01') },
];

/** where ที่ planBackfill/runBackfill ต้องส่งให้ prisma เสมอ — กันห้อง WEB ที่ยังไม่มีข้อความลูกค้าเลย (Ruling R3) */
const EXPECTED_WHERE = {
  deletedAt: null,
  customerId: null,
  OR: [{ channel: { not: 'WEB' } }, { channel: 'WEB', messages: { some: { role: 'CUSTOMER' } } }],
};

const ROOM_SELECT = { id: true, channel: true, lineUserId: true, externalUserId: true, displayName: true, createdAt: true };

describe('planBackfill', () => {
  it('นับห้อง/คน (จัดกลุ่มช่องทาง+รหัส)/คนที่มีลูกค้าเดิม/ห้องไม่มีชื่อ — ส่ง where ที่กันห้อง WEB ไม่มีข้อความลูกค้า (R3)', async () => {
    const prisma: any = {
      chatRoom: { findMany: jest.fn().mockResolvedValue(rooms) },
      customer: { findFirst: jest.fn(({ where }: any) => Promise.resolve(where.lineIdShop === 'Ub' ? { id: 'cust-b' } : null)) },
      customerLineLink: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    await expect(planBackfill(prisma)).resolves.toEqual({
      rooms: 3, persons: 2, personsWithExistingCustomer: 1, roomsWithoutName: 1, byChannel: { FACEBOOK: 2, LINE_SHOP: 1 },
    });
    expect(prisma.chatRoom.findMany).toHaveBeenCalledWith({
      where: EXPECTED_WHERE,
      select: ROOM_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  });
});

describe('runBackfill', () => {
  it('เรียก ensureForRoom เรียงตาม createdAt ทีละชุด และนับผล', async () => {
    const prisma: any = { chatRoom: { findMany: jest.fn().mockResolvedValueOnce(rooms).mockResolvedValueOnce([]) } };
    const service: any = {
      ensureForRoom: jest
        .fn()
        .mockResolvedValueOnce({ customerId: 'c1', created: true })
        .mockResolvedValueOnce({ customerId: 'c1', created: false })
        .mockRejectedValueOnce(new Error('boom')),
    };
    const log = jest.fn();
    await expect(runBackfill(prisma, service, { batchSize: 500, log })).resolves.toEqual({
      processed: 3, created: 1, linkedExisting: 1, skipped: 0, failed: 1,
    });
    expect(service.ensureForRoom.mock.calls.map((c: any[]) => c[0])).toEqual(['r1', 'r2', 'r3']);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('r3'));
  });

  it('ชุดแรกไม่มี cursor + where กันห้อง WEB ไม่มีข้อความลูกค้า (R3) — ชุดถัดไปเริ่มจากห้องสุดท้ายของชุดก่อนเสมอ แม้ห้องนั้นจะล้ม (R7)', async () => {
    const prisma: any = { chatRoom: { findMany: jest.fn().mockResolvedValueOnce(rooms).mockResolvedValueOnce([]) } };
    const service: any = {
      ensureForRoom: jest
        .fn()
        .mockResolvedValueOnce({ customerId: 'c1', created: true })
        .mockResolvedValueOnce({ customerId: 'c1', created: false })
        .mockRejectedValueOnce(new Error('boom')), // r3 ล้ม
    };
    const log = jest.fn();
    await runBackfill(prisma, service, { batchSize: 500, log });

    expect(prisma.chatRoom.findMany).toHaveBeenNthCalledWith(1, {
      where: EXPECTED_WHERE,
      select: ROOM_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 500,
    });
    // r3 ล้ม แต่ cursor ยังขยับไปที่ r3 (ห้องสุดท้ายของชุด) — ไม่ค้างอยู่ที่ r1/r2 (Ruling R7)
    expect(prisma.chatRoom.findMany).toHaveBeenNthCalledWith(2, {
      where: EXPECTED_WHERE,
      select: ROOM_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 500,
      cursor: { id: 'r3' },
      skip: 1,
    });
  });

  it('ชุดที่ล้มทั้งชุดยังขยับ cursor ต่อ ไม่วนซ้ำชุดเดิมไม่รู้จบ (Ruling R7)', async () => {
    const failBatch = [
      { id: 'f1', channel: 'FACEBOOK', lineUserId: null, externalUserId: 'psid-f1', displayName: 'F1', createdAt: new Date('2026-05-13') },
      { id: 'f2', channel: 'FACEBOOK', lineUserId: null, externalUserId: 'psid-f2', displayName: 'F2', createdAt: new Date('2026-05-14') },
    ];
    const prisma: any = { chatRoom: { findMany: jest.fn().mockResolvedValueOnce(failBatch).mockResolvedValueOnce([]) } };
    const service: any = { ensureForRoom: jest.fn().mockRejectedValue(new Error('boom')) };
    const log = jest.fn();

    await expect(runBackfill(prisma, service, { batchSize: 2, log })).resolves.toEqual({
      processed: 2, created: 0, linkedExisting: 0, skipped: 0, failed: 2,
    });

    // สองห้องล้มทั้งคู่ แต่ loop ต้องไม่วนค้างที่ชุดเดิม — เรียก findMany แค่ 2 ครั้ง (ชุดล้ม + ชุดว่างปิดลูป)
    expect(prisma.chatRoom.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.chatRoom.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: { id: 'f2' }, skip: 1 }),
    );
  });
});
