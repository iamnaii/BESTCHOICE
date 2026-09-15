import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';

/**
 * พิสูจน์ migration 20261002100000_customer_journey กับ Postgres จริง (Plan 2 Task 1):
 * ตารางใหม่ใช้งานได้ · dedupe_key กันเขียนซ้ำ (createMany skipDuplicates ได้ 0 แถว / create ตรง = P2002)
 * · entries → customers = RESTRICT · states → customers = CASCADE · merged_into_id + absorbed
 * · SQL เติมย้อนหลังในไฟล์ migration เติมจาก audit จริง ยุบ chain และรันซ้ำแล้วไม่เปลี่ยนอะไร
 * รัน (จาก apps/api): DATABASE_URL=<ฐานทดสอบตาม Global Constraints> npx jest <ไฟล์นี้> --runInBand
 */
const MIGRATION_SQL = join(__dirname, '../../../prisma/migrations/20261002100000_customer_journey/migration.sql');

/** ตัดช่วง journey-backfill ของ migration แล้วแยกทีละคำสั่ง — $executeRawUnsafe รับครั้งละหนึ่งคำสั่ง */
function backfillStatements(): string[] {
  const sql = readFileSync(MIGRATION_SQL, 'utf8');
  const start = sql.indexOf('-- journey-backfill:start');
  const end = sql.indexOf('-- journey-backfill:end');
  if (start < 0 || end < start) throw new Error('migration ไม่มีช่วง journey-backfill:start/end');
  return sql
    .slice(start, end)
    .split(/;\s*\n/)
    .map((chunk) =>
      chunk
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((statement) => statement.length > 0);
}

/** โยนออกจาก interactive transaction เพื่อ rollback — audit_logs ลบไม่ได้ (trigger audit_logs_no_delete) */
class RollbackProbe extends Error {}

describe('migration 20261002100000_customer_journey (real DB)', () => {
  const prisma = new PrismaClient();
  const stamp = Date.now();
  const customerIds: string[] = [];

  async function createCustomer(label: string) {
    const customer = await prisma.customer.create({ data: { name: `journey schema ${label} ${stamp}`, phone: null } });
    customerIds.push(customer.id);
    return customer;
  }

  afterAll(async () => {
    await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.updateMany({ where: { id: { in: customerIds } }, data: { mergedIntoId: null } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.$disconnect();
  });

  it('entries: dedupe_key ซ้ำ → createMany skipDuplicates ได้ 0 แถว · create ตรง = P2002 · MANUAL (dedupe_key null) ซ้ำได้ · note เกิน 140 = P2000', async () => {
    const customer = await createCustomer('dedupe');
    const system = {
      customerId: customer.id,
      originCustomerId: customer.id,
      origin: 'SYSTEM',
      kind: 'CONTRACT_ACTIVATED',
      occurredAt: new Date('2026-09-15T03:00:00.000Z'),
      actorType: 'STAFF',
      refType: 'contract',
      refId: `contract-${stamp}`,
      data: { contractNumber: 'CT-2569-0001' },
      dedupeKey: `CONTRACT_ACTIVATED:contract-${stamp}`,
    };
    expect((await prisma.customerJourneyEntry.createMany({ data: [system], skipDuplicates: true })).count).toBe(1);
    expect((await prisma.customerJourneyEntry.createMany({ data: [system], skipDuplicates: true })).count).toBe(0);
    await expect(prisma.customerJourneyEntry.create({ data: system })).rejects.toMatchObject({ code: 'P2002' });

    const manual = {
      customerId: customer.id,
      originCustomerId: customer.id,
      origin: 'MANUAL',
      kind: 'TOUCHPOINT',
      occurredAt: new Date('2026-09-15T04:00:00.000Z'),
      actorType: 'STAFF',
      channel: 'PHONE',
      outcome: 'THINKING',
    };
    await prisma.customerJourneyEntry.create({ data: manual });
    await prisma.customerJourneyEntry.create({ data: manual });
    await expect(prisma.customerJourneyEntry.create({ data: { ...manual, note: 'ก'.repeat(141) } })).rejects.toMatchObject({
      code: 'P2000',
    });

    const rows = await prisma.customerJourneyEntry.findMany({
      where: { customerId: customer.id },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      select: { kind: true, origin: true, dedupeKey: true, actorUserId: true, data: true, deletedAt: true },
    });
    expect(rows.map((row) => row.kind)).toEqual(['TOUCHPOINT', 'TOUCHPOINT', 'CONTRACT_ACTIVATED']);
    expect(rows[2]).toEqual({
      kind: 'CONTRACT_ACTIVATED',
      origin: 'SYSTEM',
      dedupeKey: `CONTRACT_ACTIVATED:contract-${stamp}`,
      actorUserId: null,
      data: { contractNumber: 'CT-2569-0001' },
      deletedAt: null,
    });
  });

  it('ลบลูกค้าที่มี entries ไม่ได้ (RESTRICT) · state 1:1 ต่อคนและหายตามลูกค้า (CASCADE)', async () => {
    const withEntry = await createCustomer('restrict');
    await prisma.customerJourneyEntry.create({
      data: {
        customerId: withEntry.id,
        originCustomerId: withEntry.id,
        origin: 'MANUAL',
        kind: 'HEARD_FROM',
        occurredAt: new Date('2026-09-15T05:00:00.000Z'),
        actorType: 'STAFF',
        heardFrom: 'FB_AD',
      },
    });
    await expect(prisma.customer.delete({ where: { id: withEntry.id } })).rejects.toMatchObject({ code: 'P2003' });

    const withState = await createCustomer('cascade');
    const state = {
      customerId: withState.id,
      stage: 'CONTACTED',
      stageEnteredAt: new Date('2026-09-01T02:00:00.000Z'),
      path: 'UNKNOWN',
      contactedAt: new Date('2026-09-01T02:00:00.000Z'),
      firstChannel: 'CHAT_FACEBOOK',
      firstSource: 'CHAT_FACEBOOK',
      computedAt: new Date('2026-09-15T05:00:00.000Z'),
    };
    await prisma.customerJourneyState.create({ data: state });
    await expect(prisma.customerJourneyState.create({ data: state })).rejects.toMatchObject({ code: 'P2002' });
    await prisma.customer.delete({ where: { id: withState.id } });
    expect(await prisma.customerJourneyState.count({ where: { customerId: withState.id } })).toBe(0);
  });

  it('merged_into_id ชี้ลูกค้าปลายทาง และอ่านย้อนได้ผ่าน absorbed', async () => {
    const target = await createCustomer('merge-target');
    const placeholder = await createCustomer('merge-placeholder');
    await prisma.customer.update({
      where: { id: placeholder.id },
      data: { deletedAt: new Date('2026-09-15T06:00:00.000Z'), mergedIntoId: target.id },
    });

    const read = await prisma.customer.findUniqueOrThrow({
      where: { id: target.id },
      select: { mergedIntoId: true, absorbed: { select: { id: true } } },
    });
    expect(read).toEqual({ mergedIntoId: null, absorbed: [{ id: placeholder.id }] });
  });

  it('SQL เติมย้อนหลังใน migration: เติมจาก audit CUSTOMER_PLACEHOLDER_MERGED · ยุบ chain A→B→ลูกค้าจริง · รันซ้ำได้ 0 แถว', async () => {
    const statements = backfillStatements();
    expect(statements).toHaveLength(2);

    const created: Record<'target' | 'placeholderA' | 'placeholderB' | 'unrelated', string> = {
      target: '',
      placeholderA: '',
      placeholderB: '',
      unrelated: '',
    };
    let mergedAfterFirstRun: Record<string, string | null> = {};
    const secondRun: number[] = [];

    const run = prisma.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: { email: `journey-backfill-${stamp}@spec.local`, password: 'not-a-real-hash', name: 'journey backfill spec' },
        });
        const target = await tx.customer.create({ data: { name: 'journey backfill ลูกค้าจริง', phone: null } });
        const placeholderB = await tx.customer.create({
          data: { name: 'journey backfill B', phone: null, acquisitionSource: 'CHAT_FACEBOOK', deletedAt: new Date('2026-09-10T02:00:00.000Z') },
        });
        const placeholderA = await tx.customer.create({
          data: { name: 'journey backfill A', phone: null, acquisitionSource: 'CHAT_LINE_SHOP', deletedAt: new Date('2026-09-09T02:00:00.000Z') },
        });
        const unrelated = await tx.customer.create({
          data: { name: 'journey backfill ลบด้วยเหตุอื่น', phone: null, deletedAt: new Date('2026-09-09T02:00:00.000Z') },
        });
        Object.assign(created, { target: target.id, placeholderA: placeholderA.id, placeholderB: placeholderB.id, unrelated: unrelated.id });

        // รูปแถวเดียวกับ CustomerMergeService.absorbPlaceholder (customer-merge.service.ts:216-223)
        // A → B ก่อน (รวมห้องแชทระหว่างผู้สนใจสองคน) แล้ว B → ลูกค้าจริง
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'CUSTOMER_PLACEHOLDER_MERGED',
            entity: 'customer',
            entityId: placeholderB.id,
            oldValue: { placeholderId: placeholderA.id },
            newValue: { roomIds: [], movedCreditChecks: 0, sourceCopied: false },
            createdAt: new Date('2026-09-09T02:00:00.000Z'),
          },
        });
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'CUSTOMER_PLACEHOLDER_MERGED',
            entity: 'customer',
            entityId: target.id,
            oldValue: { placeholderId: placeholderB.id },
            newValue: { roomIds: [], movedCreditChecks: 0, sourceCopied: false },
            createdAt: new Date('2026-09-10T02:00:00.000Z'),
          },
        });

        for (const statement of statements) await tx.$executeRawUnsafe(statement);
        const rows = await tx.customer.findMany({
          where: { id: { in: Object.values(created) } },
          select: { id: true, mergedIntoId: true },
        });
        mergedAfterFirstRun = Object.fromEntries(rows.map((row) => [row.id, row.mergedIntoId]));

        for (const statement of statements) secondRun.push(await tx.$executeRawUnsafe(statement));
        throw new RollbackProbe('rollback');
      },
      { timeout: 20_000 },
    );

    await expect(run).rejects.toBeInstanceOf(RollbackProbe);
    expect(mergedAfterFirstRun).toEqual({
      [created.target]: null,
      [created.placeholderB]: created.target,
      [created.placeholderA]: created.target,
      [created.unrelated]: null,
    });
    expect(secondRun).toEqual([0, 0]);
    expect(await prisma.customer.count({ where: { id: { in: Object.values(created) } } })).toBe(0);
  }, 30_000);
});
