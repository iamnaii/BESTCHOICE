import { ChatSalesDispositionService } from './chat-sales-disposition.service';

/**
 * Task 29 fix round 1 — ทำเครื่องหมายแชทขายล็อกลูกค้าตัวจริงก่อนห้อง (ลำดับเดียวกับ `VerificationService.bind`) · ลูกค้าของห้องเปลี่ยนระหว่างอ่านกับล็อก
 * = ยังไม่เขียนอะไรแล้วลองทั้งก้อนใหม่ · แข่งจริงบน Postgres ที่ `line-oa/services/finance-line-lock-order.db.spec.ts`
 */
describe('ChatSalesDispositionService.record — ลำดับล็อก ลูกค้า → ห้อง', () => {
  const room = { id: 'room', customerId: 'cust', channel: 'LINE_FINANCE' };
  function setup(roomReads: { customerId: string | null }[]) {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      systemConfig: { findFirst: jest.fn().mockResolvedValue({ value: 'true' }) },
      customer: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => ({
          id: where.id,
          deletedAt: null,
          mergedIntoId: null,
        })),
      },
      customerJourneyEntry: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'entry',
          ...data,
        })),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) };
    const queue = [...roomReads];
    const access = {
      currentActor: jest.fn().mockResolvedValue({ id: 'staff', role: 'OWNER' }),
      assertRoom: jest.fn(async () => ({ ...room, ...(queue.shift() ?? {}) })),
    };
    const states = { recompute: jest.fn().mockResolvedValue(undefined) };
    const service = new ChatSalesDispositionService(
      prisma as never,
      states as never,
      access as never,
    );
    const locked = () =>
      tx.$queryRaw.mock.calls.map((call) =>
        /FROM customers/.test((call[0] as string[]).join('?')) ? 'customers' : 'chat_rooms',
      );
    return { service, prisma, tx, locked };
  }
  const reopen = { roomId: 'room', action: 'REOPEN' as const, clientRequestId: 'req-1' };

  it('ล็อกลูกค้าตัวจริงก่อนห้อง แล้วบันทึกครั้งเดียว', async () => {
    const { service, tx, locked } = setup([]);
    await expect(
      service.record(reopen, { id: 'staff' } as never, { company: 'FINANCE' }),
    ).resolves.toMatchObject({ customerId: 'cust', kind: 'REOPENED' });
    expect(locked()).toEqual(['customers', 'chat_rooms']);
    expect(tx.customerJourneyEntry.create).toHaveBeenCalledTimes(1);
  });

  it('ลูกค้าของห้องเปลี่ยนระหว่างอ่านกับล็อก → ไม่เขียนรอบนั้น แล้วลองทั้งก้อนใหม่', async () => {
    // รอบ 1: อ่าน (ไม่ล็อก) ได้ห้องยังไม่ผูก → อ่านซ้ำใต้ล็อกได้ cust · รอบ 2: นิ่ง
    const { service, prisma, tx, locked } = setup([{ customerId: null }, { customerId: 'cust' }]);
    await service.record(reopen, { id: 'staff' } as never, { company: 'FINANCE' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.customerJourneyEntry.create).toHaveBeenCalledTimes(1);
    expect(locked()).toEqual(['chat_rooms', 'customers', 'chat_rooms']);
  });
});
