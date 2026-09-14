import { ConflictException, Logger } from '@nestjs/common';
import { ChatChannel, PrismaClient } from '@prisma/client';
import { CustomerMergeService } from './customer-merge.service';
import { AuditService } from '../audit/audit.service';

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
    // ปลายทางถูกสร้างก่อน placeholder (ซื้อก่อน ผูกห้องทีหลัง) → ที่มาไม่ถูกยก (Ruling R24)
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: target.id } })).acquisitionSource).toBeNull();
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  // Ruling R24 (แก้สเปค §3.3) — พิสูจน์บนคอลัมน์จริง: ทักมาก่อน แล้วพนักงานสร้างลูกค้าจากกล่องข้อความทีหลัง
  it('แชทมาก่อนและปลายทางไม่มีที่มา → ยกที่มา CHAT_* + PSID ไปให้ปลายทาง (KPI มาจากแชทยังนับคนนี้)', async () => {
    const { placeholder, room } = await createPlaceholder('source-carry');
    await prisma.customer.update({
      where: { id: placeholder.id },
      data: { facebookUserId: `psid-carry-${stamp}`, facebookName: 'ชื่อจากเฟซ' },
    });
    // ปลายทางถูกสร้างหลัง placeholder — CreateCustomerDto ไม่มีช่อง acquisitionSource จึงเป็น null เสมอ
    const target = await prisma.customer.create({ data: { name: 'merge spec target 3', phone: `06${String(stamp).slice(-8)}` } });
    customerIds.push(target.id);

    await service.absorbPlaceholder(placeholder.id, target.id, { id: 'staff-1', role: 'SALES' });

    const after = await prisma.customer.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.acquisitionSource).toBe('CHAT_FACEBOOK');
    expect(after.facebookUserId).toBe(`psid-carry-${stamp}`);
    expect(after.facebookName).toBe('ชื่อจากเฟซ');
    expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: room.id } })).customerId).toBe(target.id);
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

/**
 * Ruling R12, ต่อจริงกับ Postgres (ไม่ใช่ audit mock แบบ describe ด้านบน) — พิสูจน์ว่า
 * audit_logs_user_id_fkey ไม่พังเงียบอีกต่อไปเมื่อ actor เป็น SYSTEM_ACTOR: ต้อง resolve
 * เป็นแถว User ที่ isSystemUser=true จริง (seed โดย collections-foundation.seed.ts) แล้ว
 * เขียนแถว AuditLog สำเร็จจริงด้วย userId นั้น
 */
describe('CustomerMergeService.absorbPlaceholder — R12 SYSTEM actor audit (real DB + real AuditService)', () => {
  const prisma = new PrismaClient();
  const realAudit = new AuditService(prisma as any);
  const service = new CustomerMergeService(prisma as any, realAudit);
  const stamp = Date.now();
  const customerIds: string[] = [];

  beforeAll(() => jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined));

  afterAll(async () => {
    // AuditLog เป็น immutable (DB trigger T2-C4 บล็อก DELETE) — ปล่อยแถว audit ของเทสไว้ตามปกติ
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.$disconnect();
    jest.restoreAllMocks();
  });

  it('actor SYSTEM_ACTOR → เขียน AuditLog สำเร็จจริงผ่าน FK ด้วย userId ของแถว isSystemUser=true', async () => {
    const sysUser = await prisma.user.findFirstOrThrow({ where: { isSystemUser: true }, select: { id: true } });
    const target = await prisma.customer.create({ data: { name: 'r12 db target', phone: `07${String(stamp).slice(-8)}` } });
    customerIds.push(target.id);
    const placeholder = await prisma.customer.create({
      data: { name: 'r12 db placeholder', phone: null, acquisitionSource: 'CHAT_FACEBOOK' },
    });
    customerIds.push(placeholder.id);

    await service.absorbPlaceholder(placeholder.id, target.id, { id: 'system', role: 'SYSTEM' });

    const rows = await prisma.auditLog.findMany({
      where: { action: 'CUSTOMER_PLACEHOLDER_MERGED', entity: 'customer', entityId: target.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(sysUser.id);
  });
});
