import { ConflictException, Logger } from '@nestjs/common';
import { ChatChannel, PrismaClient } from '@prisma/client';
import { CustomerMergeService, MergeActor, SYSTEM_ACTOR } from './customer-merge.service';
import { AuditService } from '../audit/audit.service';
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';

/**
 * พนักงานจริงหนึ่งคนต่อ describe — PLACEHOLDER_MERGED เก็บ actorUserId ที่มี FK ไป users
 * จึงใช้ id ปลอมอย่าง 'staff-1' ไม่ได้ (ทรานแซกชันการรวมจะชน FK แล้ว rollback ทั้งใบ)
 */
async function createStaff(prisma: PrismaClient, key: string): Promise<MergeActor> {
  const user = await prisma.user.create({
    data: { email: `${key}@merge-spec.test`, name: 'merge spec staff', password: '__NO_LOGIN__', role: 'SALES', isActive: false },
  });
  return { id: user.id, role: 'SALES' };
}

/** entries มี FK Restrict ไป customers และ placeholder ชี้ merged_into_id ไปปลายทาง — เคลียร์ก่อนลบลูกค้าเสมอ */
async function clearJourney(prisma: PrismaClient, customerIds: string[]): Promise<void> {
  await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.customer.updateMany({ where: { id: { in: customerIds } }, data: { mergedIntoId: null } });
}

/**
 * พิสูจน์กับ Postgres จริง (สเปค §3.3): ชื่อ relation ใน `_count` ถูกต้อง · trigger ที่ referenceKey ชนกับปลายทาง
 * ถูกลบก่อนย้าย (ไม่ชน unique [customerId, referenceKey] จนทรานแซกชันถูกยกเลิก) · placeholder ถูก soft-delete
 * ต้องรันกับฐานที่ apply migration แล้ว: DATABASE_URL=<ฐานทดสอบ> npx jest <ไฟล์นี้> --runInBand
 */
describe('CustomerMergeService.absorbPlaceholder (real DB)', () => {
  const prisma = new PrismaClient();
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const journeyState = { recompute: jest.fn().mockResolvedValue(undefined) };
  const service = new CustomerMergeService(prisma as any, audit as any, new JourneyEntryWriter(prisma as any), journeyState as any);
  const stamp = Date.now();
  const customerIds: string[] = [];
  const roomIds: string[] = [];
  let staff: MergeActor;

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    staff = await createStaff(prisma, `merge-spec-${stamp}`);
  });

  afterAll(async () => {
    await clearJourney(prisma, customerIds);
    await prisma.chatAutoTrigger.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerTag.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.creditCheck.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerLineLink.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.user.delete({ where: { id: staff.id } });
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

    await expect(service.absorbPlaceholder(placeholder.id, target.id, staff)).resolves.toEqual({
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

    await service.absorbPlaceholder(placeholder.id, target.id, staff);

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

    await expect(service.absorbPlaceholder(placeholder.id, target.id, staff)).rejects.toThrow(
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
  const service = new CustomerMergeService(
    prisma as any,
    realAudit,
    new JourneyEntryWriter(prisma as any),
    { recompute: jest.fn().mockResolvedValue(undefined) } as any,
  );
  const stamp = Date.now();
  const customerIds: string[] = [];

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    // AuditLog เป็น immutable (DB trigger T2-C4 บล็อก DELETE) — ปล่อยแถว audit ของเทสไว้ตามปกติ
    await clearJourney(prisma, customerIds);
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

    await service.absorbPlaceholder(placeholder.id, target.id, SYSTEM_ACTOR);

    const rows = await prisma.auditLog.findMany({
      where: { action: 'CUSTOMER_PLACEHOLDER_MERGED', entity: 'customer', entityId: target.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(sysUser.id);
  });
});

/**
 * การเดินทางของลูกค้า (Plan 2 Task 4) บน Postgres จริง — writer ของจริง (เขียนใน tx ของการรวม)
 * ส่วน JourneyStateService เป็น mock เพื่อไม่ผูกผลเทสนี้กับ journey-state.sql
 */
describe('CustomerMergeService.absorbPlaceholder — การเดินทางของลูกค้า (real DB)', () => {
  const prisma = new PrismaClient();
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const journeyState = { recompute: jest.fn().mockResolvedValue(undefined) };
  const writer = new JourneyEntryWriter(prisma as any);
  const service = new CustomerMergeService(prisma as any, audit as any, writer, journeyState as any);
  const stamp = Date.now();
  const customerIds: string[] = [];
  const roomIds: string[] = [];
  let staff: MergeActor;
  let phoneSeq = 0;

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    staff = await createStaff(prisma, `journey-spec-${stamp}`);
  });

  beforeEach(() => {
    journeyState.recompute.mockReset();
    journeyState.recompute.mockResolvedValue(undefined);
    audit.log.mockClear();
  });

  afterAll(async () => {
    await clearJourney(prisma, customerIds);
    await prisma.customerLineLink.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.user.delete({ where: { id: staff.id } });
    await prisma.$disconnect();
    jest.restoreAllMocks();
  });

  async function placeholder(label: string) {
    const customer = await prisma.customer.create({
      data: { name: `journey spec ${label}`, phone: null, acquisitionSource: 'CHAT_FACEBOOK' },
    });
    customerIds.push(customer.id);
    const room = await prisma.chatRoom.create({
      data: { channel: ChatChannel.FACEBOOK, externalUserId: `journey-spec-${label}-${stamp}`, customerId: customer.id },
    });
    roomIds.push(room.id);
    return { customer, room };
  }

  async function realCustomer(label: string) {
    const customer = await prisma.customer.create({
      data: { name: `journey spec ${label}`, phone: `05${phoneSeq++}${String(stamp).slice(-7)}` },
    });
    customerIds.push(customer.id);
    return customer;
  }

  function seedHandoff(customerId: string, dedupeKey: string) {
    return prisma.customerJourneyEntry.create({
      data: {
        customerId, originCustomerId: customerId, origin: 'SYSTEM', kind: 'BOT_HANDOFF',
        occurredAt: new Date('2026-09-01T03:00:00.000Z'), actorType: 'BOT', dedupeKey,
      },
    });
  }

  function seedState(customerId: string, contactedAtIso: string, channel: string, stage = 'CONTACTED') {
    const at = new Date(contactedAtIso);
    return prisma.customerJourneyState.create({
      data: { customerId, stage, stageEnteredAt: at, path: 'UNKNOWN', contactedAt: at, firstChannel: channel, firstSource: channel, computedAt: at },
    });
  }

  it('ย้าย entries ของ placeholder ไปปลายทาง (origin คงเดิม) · soft-delete คู่ merged_into_id · PLACEHOLDER_MERGED 1 แถวไม่มี PII · recompute หลัง commit', async () => {
    const target = await realCustomer('move-target');
    const { customer: ph, room } = await placeholder('move');
    const handoff = await seedHandoff(ph.id, `BOT_HANDOFF:${room.id}:${stamp}`);

    await service.absorbPlaceholder(ph.id, target.id, staff);

    expect(await prisma.customerJourneyEntry.findUniqueOrThrow({ where: { id: handoff.id } })).toMatchObject({
      customerId: target.id, originCustomerId: ph.id,
    });
    const gone = await prisma.customer.findUniqueOrThrow({ where: { id: ph.id } });
    expect(gone.deletedAt).not.toBeNull();
    expect(gone.mergedIntoId).toBe(target.id);
    const merged = await prisma.customerJourneyEntry.findMany({ where: { customerId: target.id, kind: 'PLACEHOLDER_MERGED' } });
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      origin: 'SYSTEM', actorType: 'STAFF', actorUserId: staff.id, dedupeKey: `PLACEHOLDER_MERGED:${ph.id}`,
      data: { roomCount: 1 }, roomId: null, note: null,
    });
    expect(Object.keys(merged[0].data as object)).toEqual(['roomCount']);
    expect(merged[0].occurredAt.getTime()).toBe(gone.deletedAt?.getTime());
    expect(journeyState.recompute).toHaveBeenCalledWith([target.id, ph.id]);
  });

  it('chain: A → B (รวมห้องแชท) แล้ว B → C · merged_into_id ของ A ถูกยุบมาที่ C · ids ชั้นเดียว = BFS ของ merged_into_id ∪ audit', async () => {
    const chainService = new CustomerMergeService(prisma as any, new AuditService(prisma as any), writer, journeyState as any);
    const a = (await placeholder('chain-a')).customer;
    const b = (await placeholder('chain-b')).customer;
    const c = await realCustomer('chain-c');

    await chainService.absorbPlaceholder(a.id, b.id, SYSTEM_ACTOR, { allowPlaceholderTarget: true });
    await chainService.absorbPlaceholder(b.id, c.id, SYSTEM_ACTOR);

    const oneLevel = (await prisma.customer.findMany({ where: { mergedIntoId: c.id }, select: { id: true } }))
      .map((r) => r.id)
      .sort();
    expect(oneLevel).toEqual([a.id, b.id].sort());

    // oracle อิสระ: เดินกราฟทุกชั้นจาก merged_into_id และ audit CUSTOMER_PLACEHOLDER_MERGED (oldValue.placeholderId → entityId)
    const seen = new Set<string>();
    const queue: string[] = [c.id];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      const viaColumn = await prisma.customer.findMany({ where: { mergedIntoId: id }, select: { id: true } });
      const viaAudit = await prisma.auditLog.findMany({
        where: { action: 'CUSTOMER_PLACEHOLDER_MERGED', entity: 'customer', entityId: id },
        select: { oldValue: true },
      });
      const children = [
        ...viaColumn.map((r) => r.id),
        ...viaAudit.map((r) => String((r.oldValue as Record<string, unknown>).placeholderId)),
      ];
      for (const child of children) {
        if (!seen.has(child)) {
          seen.add(child);
          queue.push(child);
        }
      }
    }
    expect([...seen].sort()).toEqual(oneLevel);

    const mergedEntries = await prisma.customerJourneyEntry.findMany({
      where: { customerId: c.id, kind: 'PLACEHOLDER_MERGED' },
      select: { dedupeKey: true, actorType: true, actorUserId: true },
    });
    expect(mergedEntries.map((e) => e.dedupeKey).sort()).toEqual([`PLACEHOLDER_MERGED:${a.id}`, `PLACEHOLDER_MERGED:${b.id}`].sort());
    expect(mergedEntries.every((e) => e.actorType === 'SYSTEM' && e.actorUserId === null)).toBe(true);
  });

  it('แช่แข็ง: placeholder ทักก่อนปลายทาง → ปลายทางได้ contactedAt/firstChannel/firstSource ของ placeholder แต่ขั้นเดิมไม่เปลี่ยน · แคช placeholder ถูกลบ', async () => {
    const target = await realCustomer('freeze-target');
    const { customer: ph } = await placeholder('freeze');
    await seedState(ph.id, '2026-03-01T03:00:00.000Z', 'CHAT_FACEBOOK');
    await seedState(target.id, '2026-09-10T03:00:00.000Z', 'WALK_IN', 'PURCHASED');

    await service.absorbPlaceholder(ph.id, target.id, staff);

    expect(await prisma.customerJourneyState.findUniqueOrThrow({ where: { customerId: target.id } })).toMatchObject({
      stage: 'PURCHASED',
      contactedAt: new Date('2026-03-01T03:00:00.000Z'),
      firstChannel: 'CHAT_FACEBOOK',
      firstSource: 'CHAT_FACEBOOK',
    });
    expect(await prisma.customerJourneyState.findUnique({ where: { customerId: ph.id } })).toBeNull();
  });

  it('แช่แข็ง: ปลายทางยังไม่มีแคช → สร้างจากแคช placeholder · ปลายทางทักก่อน → ค่าเดิมของปลายทางคงอยู่', async () => {
    const fresh = await realCustomer('freeze-fresh');
    const { customer: ph1 } = await placeholder('freeze-fresh');
    await seedState(ph1.id, '2026-04-01T03:00:00.000Z', 'CHAT_LINE_SHOP', 'INTERESTED');
    await service.absorbPlaceholder(ph1.id, fresh.id, staff);
    expect(await prisma.customerJourneyState.findUniqueOrThrow({ where: { customerId: fresh.id } })).toMatchObject({
      stage: 'INTERESTED',
      contactedAt: new Date('2026-04-01T03:00:00.000Z'),
      firstChannel: 'CHAT_LINE_SHOP',
      firstSource: 'CHAT_LINE_SHOP',
    });

    const older = await realCustomer('freeze-older');
    const { customer: ph2 } = await placeholder('freeze-older');
    await seedState(ph2.id, '2026-05-01T03:00:00.000Z', 'CHAT_FACEBOOK');
    await seedState(older.id, '2026-01-15T03:00:00.000Z', 'WALK_IN');
    await service.absorbPlaceholder(ph2.id, older.id, staff);
    expect(await prisma.customerJourneyState.findUniqueOrThrow({ where: { customerId: older.id } })).toMatchObject({
      contactedAt: new Date('2026-01-15T03:00:00.000Z'),
      firstChannel: 'WALK_IN',
      firstSource: 'WALK_IN',
    });
    expect(await prisma.customerJourneyState.count({ where: { customerId: { in: [ph1.id, ph2.id] } } })).toBe(0);
  });

  it('actor SYSTEM ที่หา system user ไม่เจอ → audit ถูกข้ามทั้งใบ แต่ PLACEHOLDER_MERGED ยังถูกเขียน (actorType SYSTEM · actorUserId null)', async () => {
    const lonely = new CustomerMergeService(prisma as any, audit as any, writer, journeyState as any);
    jest.spyOn(lonely as any, 'resolveSystemActorUserId').mockResolvedValue(null);
    const target = await realCustomer('system-target');
    const { customer: ph } = await placeholder('system');

    await lonely.absorbPlaceholder(ph.id, target.id, SYSTEM_ACTOR);

    expect(audit.log).not.toHaveBeenCalled();
    const merged = await prisma.customerJourneyEntry.findMany({ where: { customerId: target.id, kind: 'PLACEHOLDER_MERGED' } });
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ actorType: 'SYSTEM', actorUserId: null, dedupeKey: `PLACEHOLDER_MERGED:${ph.id}` });
  });

  it('recordInTx ล้มกลางทรานแซกชัน → rollback ทั้งใบ: ห้อง/entry กลับอยู่กับ placeholder · ไม่ถูกลบ · merged_into_id ว่าง · ไม่ audit · ไม่ recompute', async () => {
    const target = await realCustomer('rollback-target');
    const { customer: ph, room } = await placeholder('rollback');
    const handoff = await seedHandoff(ph.id, `BOT_HANDOFF:${room.id}:rollback-${stamp}`);
    jest.spyOn(writer, 'recordInTx').mockRejectedValueOnce(new Error('journey write failed'));

    await expect(service.absorbPlaceholder(ph.id, target.id, staff)).rejects.toThrow('journey write failed');

    expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: room.id } })).customerId).toBe(ph.id);
    expect((await prisma.customerJourneyEntry.findUniqueOrThrow({ where: { id: handoff.id } })).customerId).toBe(ph.id);
    const still = await prisma.customer.findUniqueOrThrow({ where: { id: ph.id } });
    expect(still.deletedAt).toBeNull();
    expect(still.mergedIntoId).toBeNull();
    expect(await prisma.customerJourneyEntry.count({ where: { dedupeKey: `PLACEHOLDER_MERGED:${ph.id}` } })).toBe(0);
    expect(audit.log).not.toHaveBeenCalled();
    expect(journeyState.recompute).not.toHaveBeenCalled();
  });

  it('recompute หลัง commit ล้ม → การรวมยังสำเร็จ และ PLACEHOLDER_MERGED ถูก commit แล้ว', async () => {
    journeyState.recompute.mockRejectedValueOnce(new Error('recompute down'));
    const target = await realCustomer('recompute-target');
    const { customer: ph } = await placeholder('recompute');

    await expect(service.absorbPlaceholder(ph.id, target.id, staff)).resolves.toMatchObject({ placeholderId: ph.id, targetId: target.id });

    expect(await prisma.customerJourneyEntry.count({ where: { dedupeKey: `PLACEHOLDER_MERGED:${ph.id}` } })).toBe(1);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: ph.id } })).mergedIntoId).toBe(target.id);
  });
});
