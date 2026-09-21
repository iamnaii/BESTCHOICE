import { randomUUID } from 'crypto';
import { Global, Logger, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import type { JourneySystemEntryKind } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerJourneyModule } from './customer-journey.module';
import { journeyDedupeKey } from './journey-data-schemas';
import { JourneyEntryWriter, type JourneyEntryInput } from './journey-entry-writer.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

/**
 * พิสูจน์กับ Postgres จริง: dedupe_key unique + skipDuplicates ได้แถวเดียว · recordAfterCommit ไม่โยนแม้ FK ล้ม ·
 * recordInTx อยู่ในทรานแซกชันของผู้เรียก (rollback แล้วแถวหาย, ซ้ำไม่ทำให้ทรานแซกชันพัง) · data ผ่าน whitelist ก่อนลงคอลัมน์ json
 * · รูป data ที่ hook ของ Task 4-6 ส่งจริงลงคอลัมน์ครบทุกคีย์ (ไม่มี kind ไหนกลายเป็น null เงียบ ๆ)
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest <ไฟล์นี้> --runInBand
 */
const prisma = new PrismaClient();

/** ชุดเดียวกับ HOOK_DATA ใน journey-data-schemas.spec.ts */
const HOOK_DATA: Record<JourneySystemEntryKind, Record<string, unknown>> = {
  CONTRACT_ACTIVATED: { contractNumber: 'BCP2609-00042', totalMonths: 12, monthlyPayment: 1813 },
  CONTRACT_REVIEWED: { decision: 'REJECTED', contractNumber: 'BCP2609-00042' },
  DEVICE_RETURNED: {
    docNumber: 'DR-20260920-0001',
    contractNumber: 'BCP2609-00042',
    returnKind: 'REPOSSESSION',
    returnReason: 'AFTER_TERMINATION',
  },
  CREDIT_CHECK_OPENED_BY: { via: 'CUSTOMER' },
  CREDIT_AI_SCORED: { score: null, status: 'MANUAL_REVIEW' },
  BOT_HANDOFF: { priority: 'normal', reasonCode: 'LOW_CONFIDENCE' },
  CONTACT_ADDED: { fields: ['nationalId', 'phone'], via: 'FILL_CONTACT' },
  LINE_LINKED: { channel: 'SHOP', via: 'SELF_LINK_PHONE' },
  PRODUCT_LINK_CLICK: { productId: '3f0c2b7e-9a41-4c55-8d2e-6b1f0a9c7d21' },
  PLACEHOLDER_MERGED: { roomCount: 2 },
};

@Global()
@Module({ providers: [{ provide: PrismaService, useValue: prisma }], exports: [PrismaService] })
class TestPrismaModule {}

describe('JourneyEntryWriter (real DB)', () => {
  const stamp = Date.now();
  const customerIds: string[] = [];
  let writer: JourneyEntryWriter;
  let warn: jest.SpyInstance;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestPrismaModule, CustomerJourneyModule],
    }).compile();
    writer = moduleRef.get(JourneyEntryWriter);
  });

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.mocked(Sentry.captureException).mockClear();
    jest.mocked(Sentry.captureMessage).mockClear();
  });

  afterEach(() => {
    warn.mockRestore();
  });

  afterAll(async () => {
    try {
      await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  async function customer(label: string) {
    const row = await prisma.customer.create({
      data: { name: `journey writer spec ${label} ${stamp}`, phone: null },
    });
    customerIds.push(row.id);
    return row;
  }

  function entry(
    customerId: string,
    overrides: Partial<JourneyEntryInput> = {},
  ): JourneyEntryInput {
    const refId = randomUUID();
    return {
      customerId,
      kind: 'CONTRACT_REVIEWED',
      occurredAt: new Date('2026-09-15T03:00:00.000Z'),
      actorType: 'STAFF',
      actorUserId: null,
      roomId: null,
      refType: 'contract',
      refId,
      data: { decision: 'APPROVED', contractNumber: 'BCP2609-00042' },
      dedupeKey: journeyDedupeKey('CONTRACT_REVIEWED', refId, '2026-09-15T03:00:00.000Z'),
      ...overrides,
    };
  }

  it('เขียนแถว SYSTEM: originCustomerId = customerId · คีย์นอก whitelist ถูกตัดก่อนลงฐาน', async () => {
    const c = await customer('write');
    const e = entry(c.id, {
      data: {
        decision: 'APPROVED',
        contractNumber: 'BCP2609-00042',
        reviewNotes: 'โทร 0812345678',
      },
    });

    await expect(writer.recordAfterCommit(e)).resolves.toBeUndefined();

    const rows = await prisma.customerJourneyEntry.findMany({ where: { customerId: c.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      customerId: c.id,
      originCustomerId: c.id,
      origin: 'SYSTEM',
      kind: 'CONTRACT_REVIEWED',
      actorType: 'STAFF',
      actorUserId: null,
      roomId: null,
      refType: 'contract',
      refId: e.refId,
      dedupeKey: e.dedupeKey,
      data: { decision: 'APPROVED', contractNumber: 'BCP2609-00042' },
      channel: null,
      outcome: null,
      note: null,
      deletedAt: null,
    });
    expect(rows[0].occurredAt.toISOString()).toBe('2026-09-15T03:00:00.000Z');
    expect(JSON.stringify(rows[0])).not.toContain('0812345678');
  });

  it('dedupeKey ซ้ำ → แถวเดียว ค่าแรกคงอยู่ ไม่โยน ไม่แจ้ง Sentry (skipDuplicates)', async () => {
    const c = await customer('dup');
    const e = entry(c.id);

    await writer.recordAfterCommit(e);
    await writer.recordAfterCommit({ ...e, occurredAt: new Date('2026-09-15T04:00:00.000Z') });
    await writer.recordAfterCommit(e);

    expect(await prisma.customerJourneyEntry.count({ where: { dedupeKey: e.dedupeKey } })).toBe(1);
    const row = await prisma.customerJourneyEntry.findUniqueOrThrow({
      where: { dedupeKey: e.dedupeKey },
    });
    expect(row.occurredAt.toISOString()).toBe('2026-09-15T03:00:00.000Z');
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('ฐานข้อมูลปฏิเสธ (ลูกค้าไม่มีอยู่ → FK) → recordAfterCommit ไม่โยน · Logger.warn + Sentry.captureException', async () => {
    const e = entry(randomUUID());

    await expect(writer.recordAfterCommit(e)).resolves.toBeUndefined();

    expect(await prisma.customerJourneyEntry.count({ where: { dedupeKey: e.dedupeKey } })).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('CONTRACT_REVIEWED'));
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(jest.mocked(Sentry.captureException).mock.calls[0][1]).toMatchObject({
      tags: { module: 'customer-journey', action: 'record_after_commit' },
    });
  });

  it('data ไม่ผ่าน whitelist (reasonCode เป็นข้อความหน้าตาเหมือนเบอร์) → ยังเก็บแถว แต่ data เป็น null · captureMessage ระดับ warning ไม่มีค่าจริง', async () => {
    const c = await customer('pii');
    const e = entry(c.id, {
      kind: 'BOT_HANDOFF',
      actorType: 'BOT',
      refType: null,
      refId: null,
      data: { priority: 'high', reasonCode: '0812345678' },
      dedupeKey: journeyDedupeKey('BOT_HANDOFF', randomUUID(), stamp),
    });

    await writer.recordAfterCommit(e);

    const row = await prisma.customerJourneyEntry.findUniqueOrThrow({
      where: { dedupeKey: e.dedupeKey },
    });
    expect(row.kind).toBe('BOT_HANDOFF');
    expect(row.data).toBeNull();
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        level: 'warning',
        extra: { kind: 'BOT_HANDOFF', issues: ['reasonCode:invalid_enum_value'] },
      }),
    );
    expect(JSON.stringify(jest.mocked(Sentry.captureMessage).mock.calls)).not.toContain(
      '0812345678',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('0812345678');
  });

  it('kind บันทึกมือ / dedupeKey ว่าง / วันที่เสีย / actorType แปลก / refType ยาวเกินคอลัมน์ → ข้าม ไม่เขียน ไม่โยน', async () => {
    const c = await customer('skip');
    const bad: JourneyEntryInput[] = [
      entry(c.id, { kind: 'TOUCHPOINT', data: {} }),
      entry(c.id, { dedupeKey: '   ' }),
      entry(c.id, { occurredAt: new Date('not a date') }),
      entry(c.id, { actorType: 'ROBOT' as JourneyEntryInput['actorType'] }),
      entry(c.id, { refType: 'x'.repeat(25) }),
    ];

    for (const e of bad) {
      await expect(writer.recordAfterCommit(e)).resolves.toBeUndefined();
    }

    expect(await prisma.customerJourneyEntry.count({ where: { customerId: c.id } })).toBe(0);
    expect(Sentry.captureException).toHaveBeenCalledTimes(bad.length);
  });

  it('recordInTx อยู่ในทรานแซกชันของผู้เรียก — rollback แล้วแถวหาย · บันทึกซ้ำในทรานแซกชันไม่ทำให้คำสั่งถัดไปล้ม', async () => {
    const c = await customer('tx');
    const rolledBack = entry(c.id, {
      kind: 'PLACEHOLDER_MERGED',
      actorType: 'SYSTEM',
      refType: null,
      refId: null,
      data: { roomCount: 1 },
      dedupeKey: journeyDedupeKey('PLACEHOLDER_MERGED', randomUUID()),
    });

    await expect(
      prisma.$transaction(async (tx) => {
        await writer.recordInTx(tx, rolledBack);
        throw new Error('rollback-spec');
      }),
    ).rejects.toThrow('rollback-spec');
    expect(
      await prisma.customerJourneyEntry.count({ where: { dedupeKey: rolledBack.dedupeKey } }),
    ).toBe(0);

    const committed = {
      ...rolledBack,
      dedupeKey: journeyDedupeKey('PLACEHOLDER_MERGED', randomUUID()),
    };
    await prisma.$transaction(async (tx) => {
      await writer.recordInTx(tx, committed);
      await writer.recordInTx(tx, committed);
      await tx.customer.update({ where: { id: c.id }, data: { nickname: 'หลังบันทึกซ้ำ' } });
    });

    expect(
      await prisma.customerJourneyEntry.count({ where: { dedupeKey: committed.dedupeKey } }),
    ).toBe(1);
    expect(
      (
        await prisma.customerJourneyEntry.findUniqueOrThrow({
          where: { dedupeKey: committed.dedupeKey },
        })
      ).data,
    ).toEqual({ roomCount: 1 });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).nickname).toBe(
      'หลังบันทึกซ้ำ',
    );
  });

  it('recordInTx: ฐานข้อมูลปฏิเสธ → โยนต่อให้ทรานแซกชันของผู้เรียก rollback (ไม่กลืน)', async () => {
    const ghost = entry(randomUUID(), {
      kind: 'PLACEHOLDER_MERGED',
      actorType: 'SYSTEM',
      refType: null,
      refId: null,
      data: { roomCount: 0 },
      dedupeKey: journeyDedupeKey('PLACEHOLDER_MERGED', randomUUID()),
    });

    await expect(
      prisma.$transaction(async (tx) => {
        await writer.recordInTx(tx, ghost);
      }),
    ).rejects.toThrow();
    expect(await prisma.customerJourneyEntry.count({ where: { dedupeKey: ghost.dedupeKey } })).toBe(
      0,
    );
  });

  it('ทุก SYSTEM kind ด้วยรูป data ที่ hook ของ Task 4-6 ส่งจริง → คอลัมน์ data เท่ากับที่ส่งทุกคีย์ ไม่มี warning', async () => {
    const c = await customer('contract');
    for (const [kind, data] of Object.entries(HOOK_DATA) as [
      JourneySystemEntryKind,
      Record<string, unknown>,
    ][]) {
      const e = entry(c.id, { kind, data, dedupeKey: journeyDedupeKey(kind, randomUUID()) });
      await writer.recordAfterCommit(e);
      const row = await prisma.customerJourneyEntry.findUniqueOrThrow({
        where: { dedupeKey: e.dedupeKey },
      });
      expect({ kind: row.kind, data: row.data }).toEqual({ kind, data });
    }
    expect(await prisma.customerJourneyEntry.count({ where: { customerId: c.id } })).toBe(
      Object.keys(HOOK_DATA).length,
    );
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
