import { ConflictException, Logger } from '@nestjs/common';
import { ChatChannel, PrismaClient } from '@prisma/client';
import { CustomerMergeService } from './customer-merge.service';

/**
 * พิสูจน์กับ Postgres จริง (สเปค §3.3): ชื่อ relation ใน `_count` ถูกต้อง · trigger ที่ referenceKey ชนกับปลายทาง
 * ถูกลบก่อนย้าย (ไม่ชน unique [customerId, referenceKey] จนทรานแซกชันถูกยกเลิก) · placeholder ถูก soft-delete
 * ต้องรันกับฐานที่ apply migration แล้ว: DATABASE_URL=<ฐานทดสอบ> npx jest <ไฟล์นี้> --runInBand
 */
describe('CustomerMergeService.absorbPlaceholder (real DB)', () => {
  const prisma = new PrismaClient();
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new CustomerMergeService(prisma as any, audit as any);
  const stamp = Date.now();
  const customerIds: string[] = [];
  const roomIds: string[] = [];

  beforeAll(() => jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined));

  afterAll(async () => {
    await prisma.chatAutoTrigger.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerTag.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.creditCheck.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerLineLink.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.$disconnect();
    jest.restoreAllMocks();
  });

  async function createPlaceholder(label: string) {
    const placeholder = await prisma.customer.create({
      data: { name: `merge spec ${label}`, phone: null, acquisitionSource: 'CHAT_FACEBOOK', creditCheckStatus: 'PRE_CHECK_PASSED' },
    });
    customerIds.push(placeholder.id);
    const room = await prisma.chatRoom.create({
      data: { channel: ChatChannel.FACEBOOK, externalUserId: `merge-spec-${label}-${stamp}`, customerId: placeholder.id },
    });
    roomIds.push(room.id);
    return { placeholder, room };
  }

  it('ย้ายห้อง/ผลเช็คเครดิต/แท็ก/trigger (k2 ชนปลายทาง → ลบของ placeholder) แล้ว soft-delete placeholder', async () => {
    const target = await prisma.customer.create({ data: { name: 'merge spec target', phone: `09${String(stamp).slice(-8)}` } });
    customerIds.push(target.id);
    const { placeholder, room } = await createPlaceholder('ok');
    const check = await prisma.creditCheck.create({ data: { customerId: placeholder.id } });
    await prisma.customerTag.create({ data: { customerId: placeholder.id, tag: 'VIP', source: 'MANUAL' } });
    await prisma.customerTag.create({ data: { customerId: placeholder.id, tag: 'NEW', source: 'AUTO' } });
    await prisma.customerTag.create({ data: { customerId: target.id, tag: 'VIP', source: 'MANUAL' } });
    const trigger = { triggerType: 'RECEIPT_DELIVERY' as const, scheduledFor: new Date(), payload: {} };
    await prisma.chatAutoTrigger.create({ data: { ...trigger, customerId: placeholder.id, referenceKey: `k1-${stamp}` } });
    await prisma.chatAutoTrigger.create({ data: { ...trigger, customerId: placeholder.id, referenceKey: `k2-${stamp}` } });
    await prisma.chatAutoTrigger.create({ data: { ...trigger, customerId: target.id, referenceKey: `k2-${stamp}` } });

    await expect(service.absorbPlaceholder(placeholder.id, target.id, { id: 'staff-1', role: 'SALES' })).resolves.toEqual({
      placeholderId: placeholder.id, targetId: target.id, movedRooms: 1, movedCreditChecks: 1,
    });

    expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: room.id } })).customerId).toBe(target.id);
    expect((await prisma.creditCheck.findUniqueOrThrow({ where: { id: check.id } })).customerId).toBe(target.id);
    const liveTargetTags = await prisma.customerTag.findMany({ where: { customerId: target.id, deletedAt: null }, select: { tag: true } });
    expect(liveTargetTags.map((t) => t.tag).sort()).toEqual(['NEW', 'VIP']);
    expect(await prisma.customerTag.count({ where: { customerId: placeholder.id, deletedAt: null } })).toBe(0);
    const targetKeys = await prisma.chatAutoTrigger.findMany({ where: { customerId: target.id }, select: { referenceKey: true } });
    expect(targetKeys.map((t) => t.referenceKey).sort()).toEqual([`k1-${stamp}`, `k2-${stamp}`]);
    expect(await prisma.chatAutoTrigger.count({ where: { customerId: placeholder.id } })).toBe(0);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: placeholder.id } })).deletedAt).not.toBeNull();
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: target.id } })).creditCheckStatus).toBe('PRE_CHECK_PASSED');
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('placeholder มีการผูก LINE → 409 บอกชื่อรายการ และห้องยังอยู่กับ placeholder', async () => {
    const target = await prisma.customer.create({ data: { name: 'merge spec target 2', phone: `08${String(stamp).slice(-8)}` } });
    customerIds.push(target.id);
    const { placeholder, room } = await createPlaceholder('blocked');
    await prisma.customerLineLink.create({ data: { customerId: placeholder.id, lineUserId: `Umerge-spec-${stamp}`, channel: 'FINANCE' } });

    await expect(service.absorbPlaceholder(placeholder.id, target.id, { id: 'staff-1', role: 'SALES' })).rejects.toThrow(
      new ConflictException('รวมไม่ได้: ผู้สนใจคนนี้มีการผูก LINE 1 รายการ — ให้แก้ที่รายการนั้นก่อน'),
    );
    expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: room.id } })).customerId).toBe(placeholder.id);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: placeholder.id } })).deletedAt).toBeNull();
  });
});
