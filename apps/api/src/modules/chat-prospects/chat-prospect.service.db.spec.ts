import { Logger } from '@nestjs/common';
import { PrismaClient, ChatChannel } from '@prisma/client';
import { ChatProspectService } from './chat-prospect.service';

/**
 * พิสูจน์ advisory lock ต่อคน (สเปค §3.2 / ผลตรวจ Blocker 1): ห้อง Facebook สองห้องของ PSID เดียวกัน
 * (บั๊กเดิมของ findFirst ไม่มี lock ทำให้เกิดได้) เรียก ensureForRoom พร้อมกัน → ลูกค้า 1 คน
 * ต้องรันกับ Postgres จริง: DATABASE_URL=<ฐานทดสอบที่ apply migration แล้ว> npx jest <ไฟล์นี้> --runInBand
 * ถ้าล้มที่ pg_advisory_xact_lock ด้วย "Failed to deserialize column of type 'void'" แปลว่าล็อกถูกเขียนเป็น
 * `$queryRaw` — pg_advisory_xact_lock คืนชนิด void ที่ $queryRaw อ่านไม่ได้ ต้องใช้ `$executeRaw` (Ruling R2)
 */
describe('ChatProspectService.ensureForRoom (real DB, race)', () => {
  const prisma = new PrismaClient();
  const service = new ChatProspectService(prisma as any);
  const psid = `prospect-race-${Date.now()}`;
  const lineUserId = `Uprospect-line-${Date.now()}`;
  const roomIds: string[] = [];
  const extraCustomerIds: string[] = [];

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    for (let i = 0; i < 2; i++) {
      const room = await prisma.chatRoom.create({
        data: { channel: ChatChannel.FACEBOOK, externalUserId: psid, displayName: 'race spec' },
      });
      roomIds.push(room.id);
    }
  });

  afterAll(async () => {
    const customerIds = (await prisma.chatRoom.findMany({ where: { id: { in: roomIds } }, select: { customerId: true } }))
      .map((r) => r.customerId).filter((id): id is string => !!id);
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customerLineLink.deleteMany({ where: { lineUserId } });
    await prisma.customer.deleteMany({ where: { id: { in: [...customerIds, ...extraCustomerIds] } } });
    await prisma.$disconnect();
    jest.restoreAllMocks();
  });

  it('สองห้องพร้อมกัน → customerId เดียวกัน สร้างแค่ครั้งเดียว และ customers ของ PSID นี้มี 1 แถว', async () => {
    const results = await Promise.all(roomIds.map((id) => service.ensureForRoom(id)));
    expect(results[0]?.customerId).toBeDefined();
    expect(results[1]?.customerId).toBe(results[0]?.customerId);
    expect(results.filter((r) => r?.created).length).toBe(1);
    const count = await prisma.customer.count({ where: { facebookUserId: psid, deletedAt: null } });
    expect(count).toBe(1);
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: results[0]!.customerId } });
    expect(customer.phone).toBeNull();
    expect(customer.acquisitionSource).toBe('CHAT_FACEBOOK');
    expect(customer.name).toBe('race spec');
    // verifiedAt ของห้องไม่ถูกตั้งตอนสร้าง placeholder (สเปค §3.1)
    const rooms = await prisma.chatRoom.findMany({ where: { id: { in: roomIds } }, select: { verifiedAt: true } });
    expect(rooms.map((r) => r.verifiedAt)).toEqual([null, null]);
  });

  it('รันซ้ำบนห้องที่ผูกแล้ว → ไม่สร้างเพิ่ม (idempotent สำหรับ backfill)', async () => {
    const before = await prisma.customer.count({ where: { facebookUserId: psid, deletedAt: null } });
    const again = await service.ensureForRoom(roomIds[0]);
    expect(again?.created).toBe(false);
    expect(await prisma.customer.count({ where: { facebookUserId: psid, deletedAt: null } })).toBe(before);
  });

  it('LINE การเงิน: link ที่ยกเลิกแล้วไม่นับ → ใช้ลูกค้าที่ผูกคอลัมน์ lineIdFinance', async () => {
    const unlinked = await prisma.customer.create({ data: { name: 'line spec unlinked' } });
    const byColumn = await prisma.customer.create({ data: { name: 'line spec column', lineIdFinance: lineUserId } });
    extraCustomerIds.push(unlinked.id, byColumn.id);
    await prisma.customerLineLink.create({
      data: { customerId: unlinked.id, lineUserId, channel: 'FINANCE', unlinkedAt: new Date() },
    });
    const room = await prisma.chatRoom.create({ data: { channel: ChatChannel.LINE_FINANCE, lineUserId } });
    roomIds.push(room.id);

    await expect(service.ensureForRoom(room.id)).resolves.toEqual({ customerId: byColumn.id, created: false });
    expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: room.id } })).customerId).toBe(byColumn.id);
  });
});
