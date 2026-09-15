import { PrismaClient } from '@prisma/client';
import type { JourneySystemEntryKind } from '@installment/shared';
import { journeyDedupeKey } from '../customer-journey/journey-data-schemas';
import { PDPAService } from './pdpa.service';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * PDPA กับ Postgres จริง — ปิดคำร้อง DELETION แล้ว customer_journey_entries (รวมบันทึกมือที่มี note)
 * และแคช customer_journey_states ของลูกค้า + placeholder ที่ถูกรวมเข้ามาต้องหายจริง ของลูกค้าคนอื่นต้องอยู่ครบ
 * · คำร้อง ACCESS ส่งออกประวัติชุดเดียวกัน (ids เดียวกับสิทธิ์ลบ) โดยไม่ลบอะไร
 * รัน: DATABASE_URL=<ฐานทดสอบที่ apply 20261002100000_customer_journey แล้ว> npx jest <ไฟล์นี้> --runInBand
 */
describe('PDPAService.processDSAR — ประวัติการเดินทาง: DELETION ลบ · ACCESS ส่งออก (real DB)', () => {
  const prisma = new PrismaClient();
  const service = new PDPAService(prisma as unknown as PrismaService);
  const stamp = Date.now();
  const at = new Date('2026-09-01T03:00:00.000Z');
  const customerIds: string[] = [];
  const dsarIds: string[] = [];

  beforeAll(() => {
    const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://unset/unset').pathname.slice(1);
    if (!/^test_db$|_test$/.test(dbName)) {
      throw new Error(`สเปคนี้ลบแถวจริง — ต้องรันกับฐานทดสอบ (test_db หรือ *_test) แต่ได้ "${dbName}"`);
    }
  });

  afterAll(async () => {
    await prisma.customerJourneyEntry.deleteMany({
      where: { OR: [{ customerId: { in: customerIds } }, { originCustomerId: { in: customerIds } }] },
    });
    await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.dSARRequest.deleteMany({ where: { id: { in: dsarIds } } });
    await prisma.customer.updateMany({ where: { id: { in: customerIds } }, data: { mergedIntoId: null } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.$disconnect();
  });

  async function createCustomer(label: string, extra: { deletedAt?: Date; mergedIntoId?: string } = {}) {
    const row = await prisma.customer.create({ data: { name: `dsar journey spec ${label}`, phone: null, ...extra } });
    customerIds.push(row.id);
    return row;
  }

  function systemEntry(customerId: string, originCustomerId: string, kind: JourneySystemEntryKind, key: string) {
    return {
      customerId,
      originCustomerId,
      origin: 'SYSTEM',
      kind,
      occurredAt: at,
      actorType: 'SYSTEM',
      dedupeKey: journeyDedupeKey(kind, 'dsar-spec', key, stamp),
    };
  }

  function stateOf(customerId: string) {
    return {
      customerId,
      stage: 'IDENTIFIED',
      stageEnteredAt: at,
      path: 'UNKNOWN',
      contactedAt: at,
      firstChannel: 'CHAT_FACEBOOK',
      firstSource: 'CHAT_FACEBOOK',
      computedAt: at,
    };
  }

  async function createRequest(customerId: string, suffix: string, requestType: 'DELETION' | 'ACCESS' = 'DELETION') {
    const request = await prisma.dSARRequest.create({
      data: { requestNumber: `DSAR-SPEC-${stamp}-${suffix}`, customerId, requestType, description: 'คำร้องจากสเปค', dueDate: at },
    });
    dsarIds.push(request.id);
    return request;
  }
  const createDeletionRequest = (customerId: string, suffix: string) => createRequest(customerId, suffix, 'DELETION');

  it('IN_PROGRESS ไม่ลบ · COMPLETED ลบ entries + state ของลูกค้าและ placeholder ที่รวม · ของคนอื่นอยู่ครบ · ปิดซ้ำได้', async () => {
    const target = await createCustomer('target');
    const placeholder = await createCustomer('placeholder', { deletedAt: at, mergedIntoId: target.id });
    const other = await createCustomer('other');
    await prisma.customerJourneyEntry.createMany({
      data: [
        systemEntry(target.id, target.id, 'CONTACT_ADDED', 'target'),
        systemEntry(target.id, placeholder.id, 'PLACEHOLDER_MERGED', 'merged'),
        {
          customerId: target.id,
          originCustomerId: target.id,
          origin: 'MANUAL',
          kind: 'TOUCHPOINT',
          occurredAt: at,
          actorType: 'STAFF',
          channel: 'PHONE',
          outcome: 'THINKING',
          note: 'ลูกค้าขอคิดก่อน',
        },
        systemEntry(other.id, other.id, 'CONTACT_ADDED', 'other'),
      ],
    });
    await prisma.customerJourneyState.createMany({ data: [stateOf(target.id), stateOf(placeholder.id), stateOf(other.id)] });
    const request = await createDeletionRequest(target.id, '1');

    await service.processDSAR(request.id, 'dsar-spec-user', 'IN_PROGRESS', 'กำลังตรวจ');
    expect(await prisma.customerJourneyEntry.count({ where: { customerId: target.id } })).toBe(3);

    const done = await service.processDSAR(request.id, 'dsar-spec-user', 'COMPLETED', 'ลบประวัติการเดินทางแล้ว');

    expect(done.responseData).toEqual({ journeyEntriesDeleted: 3, journeyStatesDeleted: 2 });
    expect(done.completedAt).not.toBeNull();
    const ids = [target.id, placeholder.id];
    expect(
      await prisma.customerJourneyEntry.count({
        where: { OR: [{ customerId: { in: ids } }, { originCustomerId: { in: ids } }] },
      }),
    ).toBe(0);
    expect(await prisma.customerJourneyState.count({ where: { customerId: { in: ids } } })).toBe(0);
    expect(await prisma.customerJourneyEntry.count({ where: { customerId: other.id } })).toBe(1);
    expect(await prisma.customerJourneyState.count({ where: { customerId: other.id } })).toBe(1);
    // ลบเฉพาะประวัติการเดินทาง — แถวลูกค้ายังอยู่ (สัญญา/ใบขายอยู่ใต้อายุความ)
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: target.id } })).deletedAt).toBeNull();

    const again = await service.processDSAR(request.id, 'dsar-spec-user', 'COMPLETED', 'ปิดซ้ำ');
    expect(again.responseData).toEqual({ journeyEntriesDeleted: 0, journeyStatesDeleted: 0 });
  });

  it('คำร้องยื่นตอนยังเป็น placeholder แล้วถูกรวมก่อนปิดคำร้อง → ลบประวัติของเจ้าของปัจจุบัน (คนเดียวกัน)', async () => {
    const placeholder = await createCustomer('late-placeholder');
    const request = await createDeletionRequest(placeholder.id, '2');
    const target = await createCustomer('late-target');
    // จำลองผลของ absorbPlaceholder: entries อยู่ใต้เจ้าของใหม่ + placeholder ถูก soft-delete พร้อม merged_into_id
    await prisma.customerJourneyEntry.createMany({
      data: [
        systemEntry(target.id, placeholder.id, 'PLACEHOLDER_MERGED', 'late-merged'),
        systemEntry(target.id, target.id, 'LINE_LINKED', 'late-target'),
      ],
    });
    await prisma.customer.update({ where: { id: placeholder.id }, data: { deletedAt: at, mergedIntoId: target.id } });
    await prisma.customerJourneyState.create({ data: stateOf(target.id) });

    const done = await service.processDSAR(request.id, 'dsar-spec-user', 'COMPLETED', 'ลบแล้ว');

    expect(done.responseData).toEqual({ journeyEntriesDeleted: 2, journeyStatesDeleted: 1 });
    expect(
      await prisma.customerJourneyEntry.count({ where: { OR: [{ customerId: target.id }, { originCustomerId: placeholder.id }] } }),
    ).toBe(0);
    expect(await prisma.customerJourneyState.count({ where: { customerId: target.id } })).toBe(0);
  });

  it('ACCESS → responseData.journey มีบันทึกของลูกค้าและ placeholder ที่รวมเข้ามา (รวมแถวที่ค้างใต้ placeholder) + แคช · ไม่มีของคนอื่น · ไม่ลบอะไร', async () => {
    const target = await createCustomer('access-target');
    const placeholder = await createCustomer('access-placeholder', { deletedAt: at, mergedIntoId: target.id });
    const other = await createCustomer('access-other');
    const note = 'ลูกค้าขอคิดก่อน';
    await prisma.customerJourneyEntry.createMany({
      data: [
        systemEntry(target.id, target.id, 'CONTACT_ADDED', 'access-target'),
        systemEntry(target.id, placeholder.id, 'PLACEHOLDER_MERGED', 'access-merged'),
        systemEntry(placeholder.id, placeholder.id, 'LINE_LINKED', 'access-left-behind'),
        {
          customerId: target.id,
          originCustomerId: target.id,
          origin: 'MANUAL',
          kind: 'TOUCHPOINT',
          occurredAt: at,
          actorType: 'STAFF',
          channel: 'PHONE',
          outcome: 'THINKING',
          note,
        },
        systemEntry(other.id, other.id, 'CONTACT_ADDED', 'access-other'),
      ],
    });
    await prisma.customerJourneyState.createMany({ data: [stateOf(target.id), stateOf(other.id)] });
    const request = await createRequest(target.id, '3', 'ACCESS');

    const done = await service.processDSAR(request.id, 'dsar-spec-user', 'COMPLETED', 'ส่งข้อมูลแล้ว');

    const journey = (done.responseData as { journey: { entries: Array<Record<string, unknown>>; states: Array<Record<string, unknown>> } }).journey;
    expect(journey.entries.map((row) => row.kind).sort()).toEqual(['CONTACT_ADDED', 'LINE_LINKED', 'PLACEHOLDER_MERGED', 'TOUCHPOINT']);
    expect(journey.entries.find((row) => row.kind === 'TOUCHPOINT')).toMatchObject({ origin: 'MANUAL', channel: 'PHONE', outcome: 'THINKING', note, deletedAt: null });
    for (const row of journey.entries) {
      for (const internal of ['customerId', 'originCustomerId', 'actorUserId', 'dedupeKey']) expect(row).not.toHaveProperty(internal);
    }
    expect(journey.states).toHaveLength(1);
    expect(journey.states[0]).toMatchObject({ stage: 'IDENTIFIED', firstSource: 'CHAT_FACEBOOK' });
    expect(journey.states[0]).not.toHaveProperty('customerId');
    // ส่งออกอย่างเดียว — ของทุกคนยังอยู่ครบ
    expect(await prisma.customerJourneyEntry.count({ where: { customerId: { in: [target.id, placeholder.id] } } })).toBe(4);
    expect(await prisma.customerJourneyState.count({ where: { customerId: { in: [target.id, other.id] } } })).toBe(2);
  });
});
