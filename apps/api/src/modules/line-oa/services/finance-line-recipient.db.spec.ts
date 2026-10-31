/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/line-oa/services/finance-line-recipient.db.spec.ts --runInBand
 *
 * Task 22 fix round 1 I-1 (ง) — ปลายทางข้อความการเงินทาง LINE บน Postgres จริง: `FINANCE_LINE_RECIPIENT_SELECT` +
 * `financeLineRecipient` ให้ U-id ของแถว OTP ที่ยังผูกของลูกค้าคนนั้นเท่านั้น — คอลัมน์ `line_id_finance` ที่ค้าง/พนักงานพิมพ์ไม่ถูกใช้
 */
import { LineChannelType, PrismaClient } from '@prisma/client';
import { FINANCE_LINE_RECIPIENT_SELECT, financeLineRecipient } from './otp-verified-customer';

const prisma = new PrismaClient();
const tag = `t22r-${Date.now()}`;
const digits = String(Date.now()).slice(-8);
const ids: string[] = [];

async function customer(name: string, phonePrefix: string, lineIdFinance: string | null) {
  const row = await prisma.customer.create({
    data: { name: `ทดสอบ ${name} ${tag}`, phone: `${phonePrefix}${digits}`, lineIdFinance },
  });
  ids.push(row.id);
  return row.id;
}

beforeAll(async () => {
  const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://unset/unset').pathname.slice(1);
  if (!/^test_db$|_test$/.test(dbName)) {
    throw new Error(`สเปคนี้เขียน/ลบแถวจริง — ต้องรันกับฐานทดสอบ แต่ได้ "${dbName}"`);
  }
});

afterAll(async () => {
  await prisma.customerLineLink.deleteMany({ where: { customerId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

it('ปลายทาง = แถว OTP ที่ยังผูกของลูกค้าคนนั้น · คอลัมน์ค้าง/แถวที่ยกเลิกแล้ว = ไม่ส่ง', async () => {
  const verified = await customer('ยืนยันแล้ว', '09', `U${tag}-a`);
  await prisma.customerLineLink.create({
    data: { customerId: verified, lineUserId: `U${tag}-a`, channel: LineChannelType.FINANCE },
  });
  const typed = await customer('พนักงานพิมพ์', '08', `U${tag}-a`); // ค่าซ้ำของ LINE ที่ยืนยันกับคนอื่น
  const unlinked = await customer('ยกเลิกผูกแล้ว', '07', `U${tag}-c`);
  await prisma.customerLineLink.create({
    data: {
      customerId: unlinked,
      lineUserId: `U${tag}-c`,
      channel: LineChannelType.FINANCE,
      unlinkedAt: new Date(),
    },
  });
  const drifted = await customer('คอลัมน์ไม่ตรงแถว', '06', `U${tag}-old`);
  await prisma.customerLineLink.create({
    data: { customerId: drifted, lineUserId: `U${tag}-d`, channel: LineChannelType.FINANCE },
  });

  const rows = await prisma.customer.findMany({
    where: { id: { in: ids } },
    select: { id: true, ...FINANCE_LINE_RECIPIENT_SELECT },
  });
  const recipient = new Map(rows.map((r) => [r.id, financeLineRecipient(r)]));

  expect(recipient.get(verified)).toBe(`U${tag}-a`);
  expect(recipient.get(typed)).toBeNull();
  expect(recipient.get(unlinked)).toBeNull();
  expect(recipient.get(drifted)).toBe(`U${tag}-d`);
});
