import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { JournalAutoService } from '../journal-auto.service';

const prisma = new PrismaClient();
const SQL = readFileSync(
  join(
    __dirname,
    '../../../../prisma/migrations/20261013000000_backfill_reversal_contract_id/migration.sql',
  ),
  'utf8',
);

const lines = (amount: string, reversed = false) => [
  {
    accountCode: reversed ? '11-2103' : '11-1101',
    dr: new Decimal(amount),
    cr: new Decimal(0),
    description: 'dr',
  },
  {
    accountCode: reversed ? '11-1101' : '11-2103',
    dr: new Decimal(0),
    cr: new Decimal(amount),
    description: 'cr',
  },
];

async function metaOf(id: string) {
  const je = await prisma.journalEntry.findUniqueOrThrow({ where: { id } });
  return je.metadata as Record<string, unknown>;
}

describe('migration 20261013000000 — เติม contractId ให้รายการกลับรายการเดิม', () => {
  let journal: JournalAutoService;
  const ids: Record<string, string> = {};
  // ไม่ล้างตารางบัญชี — spec นี้สร้างแถวของตัวเองและตรวจเฉพาะแถวนั้น. reference ต้องไม่ซ้ำข้ามรอบรัน
  // (unique index journal_entries_ref_unique) จึงผูกกับเวลาที่รัน
  const RUN = Date.now().toString(36);

  beforeAll(async () => {
    await seedFinanceCoa(prisma);
    const admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    if (!admin) {
      await prisma.user.create({
        data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
      });
    }
    journal = new JournalAutoService(prisma as any);

    const post = async (key: string, metadata: Record<string, unknown>, reversed = false) => {
      const { id } = await journal.createAndPost({
        description: key,
        reference: `backfill-spec:${RUN}:${key}`,
        metadata: metadata as Prisma.JsonObject,
        lines: lines('100.00', reversed),
      });
      ids[key] = id;
      return id;
    };

    // (1) ใบรับชำระปกติ + รายการกลับรายการแบบเก่า (ไม่มี contractId) → ต้องถูกเติม
    const orig1 = await post('orig1', { tag: 'receipt', contractId: `ct-A-${RUN}`, paymentId: 'p-1' });
    await post('rev1', { tag: 'REVERSAL', flow: 'receipt-void', originalEntryId: orig1 }, true);
    // (2) คืนเงิน → ต้องถูกเติมเหมือนกัน
    const orig2 = await post('orig2', { tag: 'receipt', contractId: 'ct-B' });
    await post('rev2', { tag: 'REVERSAL', flow: 'refund-reversal', originalEntryId: orig2 }, true);
    // (3) รายการเดิมไม่มี contractId → ห้ามแตะ
    const orig3 = await post('orig3', { tag: 'receipt' });
    await post('rev3', { tag: 'REVERSAL', flow: 'receipt-void', originalEntryId: orig3 }, true);
    // (4) มี contractId อยู่แล้ว → ห้ามเขียนทับ
    const orig4 = await post('orig4', { tag: 'receipt', contractId: 'ct-D' });
    await post(
      'rev4',
      { tag: 'REVERSAL', flow: 'receipt-void', originalEntryId: orig4, contractId: 'ct-KEEP' },
      true,
    );
    // (5) flow อื่น → ห้ามแตะ
    const orig5 = await post('orig5', { tag: '1A', contractId: 'ct-E' });
    await post('rev5', { tag: 'REVERSAL', flow: 'some-other-flow', originalEntryId: orig5 }, true);
  });

  it('เติมเฉพาะแถวที่เข้าเงื่อนไข และคงคีย์เดิมไว้ครบ', async () => {
    await prisma.$executeRawUnsafe(SQL);

    // brief's toEqual comparison assumes createAndPost writes metadata verbatim
    // (no extra keys of its own). Confirmed by reading journal-auto.service.ts —
    // `metadata: input.metadata ?? Prisma.JsonNull` — so comparing against the
    // literal metadata objects posted above (plus the migration's one added key)
    // is safe and matches the row's pre-migration shape exactly.
    expect(await metaOf(ids.rev1)).toEqual({
      tag: 'REVERSAL',
      flow: 'receipt-void',
      originalEntryId: ids.orig1,
      contractId: `ct-A-${RUN}`,
    });
    expect((await metaOf(ids.rev2))['contractId']).toBe('ct-B');
    expect(await metaOf(ids.rev3)).not.toHaveProperty('contractId');
    expect((await metaOf(ids.rev4))['contractId']).toBe('ct-KEEP');
    expect(await metaOf(ids.rev5)).not.toHaveProperty('contractId');
    // รายการเดิมไม่ถูกแตะ
    expect(await metaOf(ids.orig1)).toEqual({
      tag: 'receipt',
      contractId: `ct-A-${RUN}`,
      paymentId: 'p-1',
    });
  });

  it('รันซ้ำได้ ไม่เปลี่ยนแถวใดอีก', async () => {
    // รอบแรกเติมทุกแถวที่เข้าเงื่อนไขในฐานไปแล้ว (รวมแถวของ spec อื่น) รอบสองจึงต้องเป็น 0
    const changed = await prisma.$executeRawUnsafe(SQL);
    expect(changed).toBe(0);
  });
});
