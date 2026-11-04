/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npm test --workspace=apps/api -- src/modules/line-oa/payment-links/payment-link-purpose-backfill.db.spec.ts
 *
 * Task 39 รีวิว m-1 — migration `20261111000000_payment_link_purpose` ตั้ง `purpose` ให้ลิงก์ `/pay/:token` ที่ยังจ่ายได้ตอน deploy ด้วยเกณฑ์
 * เดียวกับหน้าเว็บที่ deploy อยู่ (ยอด ≤ ค่างวด + ค่าปรับของงวดที่ผูก + 0.5 = งวดเดียว → INSTALLMENT · ที่เหลือ = PAYOFF — ผู้สร้างลิงก์ที่ยอด
 * ไม่ใช่ของงวดเดียวบน main มีแค่ลิงก์ปิดยอด) ⇒ ลิงก์ที่ค้างตอน deploy ทำงานเหมือนเดิม · แถวที่ใช้ไม่ได้แล้วคง null
 *
 * รันคำสั่ง UPDATE ของ migration จริง (อ่านจากไฟล์) ในธุรกรรมที่ ROLLBACK — ไม่แตะแถวของสเปคอื่นบนฐานเดียวกัน
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { PaymentLinkPurpose, PrismaClient } from '@prisma/client';
import {
  assertTestDatabase,
  createFinanceFixtureBase,
  createInstallmentFixture,
  dueDateBkk,
  realBangkokDate,
} from '../../notifications/__tests__/finance-line-fixtures';

const prisma = new PrismaClient();
const stamp = `t39b-${Date.now()}`;
const MIGRATION = join(
  __dirname,
  '../../../../prisma/migrations/20261111000000_payment_link_purpose/migration.sql',
);

/** คำสั่ง backfill ของ migration (ตั้งแต่ UPDATE ถึงท้ายไฟล์) */
function backfillSql(): string {
  const sql = readFileSync(MIGRATION, 'utf8');
  return sql.slice(sql.indexOf('UPDATE "payment_links"')).trim().replace(/;$/, '');
}

const hex = (seed: string) => Buffer.from(`${stamp}-${seed}`).toString('hex').padEnd(64, '0').slice(0, 64);

afterAll(() => prisma.$disconnect());

it('ลิงก์ที่ยังจ่ายได้ = เกณฑ์ของหน้าเว็บเดิม · แถวที่ใช้ไม่ได้/แถวติดตามคง null', async () => {
  assertTestDatabase();
  const base = await createFinanceFixtureBase(prisma, stamp);
  // งวด 1 ค่างวด 1,515.83 + ค่าปรับ 100 ⇒ เส้นแบ่ง 1,616.33
  const f = await createInstallmentFixture(prisma, base, {
    label: 'backfill',
    dueDate: dueDateBkk(realBangkokDate(), -10),
    paymentStatus: 'OVERDUE',
    contractStatus: 'DEFAULT',
    lateFee: '100.00',
  });
  const soon = new Date(Date.now() + 60 * 60 * 1000);
  const rows: [string, Record<string, unknown>, PaymentLinkPurpose | null][] = [
    ['งวดเดียว 1,615.83', { amount: '1615.83' }, 'INSTALLMENT'],
    ['ขอบพอดี 1,616.33', { amount: '1616.33' }, 'INSTALLMENT'],
    ['เกินขอบ 1,616.34', { amount: '1616.34' }, 'PAYOFF'],
    ['ยอดปิด 15,189.98', { amount: '15189.98' }, 'PAYOFF'],
    ['หมดอายุแล้ว', { amount: '1615.83', expiresAt: new Date(Date.now() - 1000) }, null],
    ['ใช้แล้ว', { amount: '1615.83', status: 'USED' }, null],
    ['ถูกลบ', { amount: '1615.83', deletedAt: new Date() }, null],
    ['แถวติดตาม intent (เลข 12 หลัก)', { amount: '1615.83', token: String(Date.now()).slice(-12) }, null],
  ];
  const ids: Record<string, string> = {};
  for (const [label, data] of rows) {
    const link = await prisma.paymentLink.create({
      data: {
        token: hex(label),
        contractId: f.contractId,
        paymentId: f.paymentId,
        status: 'ACTIVE',
        expiresAt: soon,
        ...data,
      } as never,
    });
    ids[label] = link.id;
  }

  const ROLLBACK = new Error('rollback');
  let after: Record<string, PaymentLinkPurpose | null> = {};
  await prisma
    .$transaction(async (tx) => {
      await tx.$executeRawUnsafe(backfillSql());
      const found = await tx.paymentLink.findMany({
        where: { id: { in: Object.values(ids) } },
        select: { id: true, purpose: true },
      });
      after = Object.fromEntries(
        Object.entries(ids).map(([label, id]) => [label, found.find((l) => l.id === id)!.purpose]),
      );
      throw ROLLBACK;
    })
    .catch((err) => {
      if (err !== ROLLBACK) throw err;
    });

  expect(after).toEqual(Object.fromEntries(rows.map(([label, , purpose]) => [label, purpose])));
  // ROLLBACK จริง — แถวยังเป็น null
  expect(
    await prisma.paymentLink.count({ where: { id: { in: Object.values(ids) }, purpose: { not: null } } }),
  ).toBe(0);
}, 60_000);
