import { Prisma, PrismaClient } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { TEST_DOC_PREFIX, TEST_NAME_PREFIX } from '../../../utils/test-data-markers';
import { DataAuditChecksService } from '../services/data-audit-checks.service';

/**
 * `journal_balance` — สมดุลพอดีทุกสตางค์ (คำตัดสินเจ้าของ 2026-10-31) บน Postgres จริง: รายการ POSTED ที่ Σ เดบิต ≠ Σ เครดิต แม้ 0.01
 * ต้องติด (เดิมเผื่อ 0.01 ⇒ ไม่ติด) · รายการที่สมดุลพอดีไม่ติด · นับเป็นส่วนต่างของ `count` (ข้อนี้ตรวจทั้งฐาน — ฐานทดสอบอาจมีแถวของสเปคอื่น)
 *
 * รัน: DATABASE_URL=<ฐานทดสอบ *_test> npx jest <ไฟล์นี้> --runInBand · ไม่มี DATABASE_URL = ข้าม
 */
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('journal_balance — exact balance, no tolerance (real DB)', () => {
  const prisma = new PrismaClient();
  const checks = new DataAuditChecksService(prisma as unknown as PrismaService);
  const stamp = Date.now().toString(36).toUpperCase();
  let companyId = '';
  let userId = '';
  const entryIds: string[] = [];

  beforeAll(async () => {
    const company = await prisma.companyInfo.create({
      data: {
        nameTh: `${TEST_NAME_PREFIX} สมดุลรายการ ${stamp}`,
        taxId: '0000000000000',
        address: 'ข้อมูลทดสอบระบบ — ลบได้',
        directorName: TEST_NAME_PREFIX,
      },
    });
    companyId = company.id;
    const user = await prisma.user.create({
      data: {
        email: `journal-balance-${stamp.toLowerCase()}@test.local`,
        password: 'x',
        name: `${TEST_NAME_PREFIX} สมดุลรายการ`,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: entryIds } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
    if (companyId) await prisma.companyInfo.delete({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  /** รายการ POSTED เขียนตรง (นอกสองทางลงบัญชีที่บังคับสมดุล — แบบเดียวกับข้อมูลเก่า / SQL ตรงที่ข้อนี้มีไว้จับ) */
  async function postedEntry(seq: number, debit: string, credit: string) {
    const entry = await prisma.journalEntry.create({
      data: {
        entryNumber: `${TEST_DOC_PREFIX}JB-${stamp}-${seq}`,
        companyId,
        entryDate: new Date(),
        description: `${TEST_NAME_PREFIX} สมดุลรายการ`,
        status: 'POSTED',
        postedAt: new Date(),
        createdById: userId,
        lines: {
          create: [
            {
              accountCode: '11-1101',
              debit: new Prisma.Decimal(debit),
              credit: new Prisma.Decimal(0),
            },
            {
              accountCode: '41-1101',
              debit: new Prisma.Decimal(0),
              credit: new Prisma.Decimal(credit),
            },
          ],
        },
      },
    });
    entryIds.push(entry.id);
    return entry;
  }

  it('an entry off by exactly 0.01 is unbalanced (FAIL) · an exactly balanced entry is not counted', async () => {
    const before = await checks.checkJournalBalance();

    await postedEntry(1, '1000.00', '1000.00');
    const afterBalanced = await checks.checkJournalBalance();
    expect(afterBalanced.count).toBe(before.count);

    const offBySatang = await postedEntry(2, '1000.00', '999.99');
    const after = await checks.checkJournalBalance();
    expect(after.status).toBe('FAIL');
    expect(after.count).toBe(before.count + 1);
    const row = (after.details as { id: string; diff: Prisma.Decimal }[]).find(
      (d) => d.id === offBySatang.id,
    );
    // details เรียงจากส่วนต่างมากไปน้อย สูงสุด 50 แถว — แถวของสเปคนี้อาจหลุดเพดานถ้าฐานมีแถวเพี้ยนมาก (count ยังพิสูจน์ได้)
    if (after.count <= 50) expect(new Prisma.Decimal(row!.diff).toFixed(2)).toBe('0.01');
  });
});
