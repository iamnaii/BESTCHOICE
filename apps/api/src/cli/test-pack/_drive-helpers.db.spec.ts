/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/cli/test-pack/_drive-helpers.db.spec.ts --runInBand
 *
 * Task 24 RR-M1 — ก้าวรับชำระของ test-pack ต้องข้ามทุกสัญญาที่ผู้ส่งข้อความการเงินจะยิง LINE ถึงลูกค้าจริง: ผู้ส่งอ่านแถว OTP
 * (`customer_line_links` ช่อง FINANCE ที่ยังผูก — Task 22 I-1 ง) ไม่ใช่คอลัมน์ ⇒ ลูกค้าที่มีแถว active แต่คอลัมน์ว่างต้องถูกข้ามด้วย
 */
import { LineChannelType, PrismaClient } from '@prisma/client';
import { ACTIVATION_SILENT_CUSTOMER_WHERE, MAY_RECEIVE_FINANCE_LINE_WHERE } from './_drive-helpers';
import { testDraftCustomerPhone } from './_test-customer-phone';

const prisma = new PrismaClient();
const tag = `t24d-${Date.now()}`;
const digits = String(Date.now()).slice(-8);
const ids: string[] = [];

async function customer(
  name: string,
  phonePrefix: string,
  lineIdFinance: string | null,
  exactPhone?: string,
) {
  const row = await prisma.customer.create({
    data: {
      name: `ทดสอบ ${name} ${tag}`,
      phone: exactPhone ?? `${phonePrefix}${digits}`,
      lineIdFinance,
    },
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

it('ข้ามลูกค้าที่มีแถว OTP ที่ยังผูก (แม้คอลัมน์ว่าง) และลูกค้าที่คอลัมน์ไม่ว่าง · แถวที่ยกเลิกแล้ว/ไม่มีอะไรเลย = รับชำระได้', async () => {
  const columnOnly = await customer('คอลัมน์อย่างเดียว', '09', `U${tag}-col`);
  const linkOnly = await customer('แถว OTP อย่างเดียว', '08', null);
  await prisma.customerLineLink.create({
    data: { customerId: linkOnly, lineUserId: `U${tag}-link`, channel: LineChannelType.FINANCE },
  });
  const unlinked = await customer('ยกเลิกผูกแล้ว', '07', null);
  await prisma.customerLineLink.create({
    data: {
      customerId: unlinked,
      lineUserId: `U${tag}-old`,
      channel: LineChannelType.FINANCE,
      unlinkedAt: new Date(),
    },
  });
  const none = await customer('ไม่มี LINE', '06', null);

  const skipped = await prisma.customer.findMany({
    where: { id: { in: ids }, ...MAY_RECEIVE_FINANCE_LINE_WHERE },
    select: { id: true },
  });
  const driven = await prisma.customer.findMany({
    where: { id: { in: ids }, NOT: MAY_RECEIVE_FINANCE_LINE_WHERE },
    select: { id: true },
  });

  expect(skipped.map((r) => r.id).sort()).toEqual([columnOnly, linkOnly].sort());
  expect(driven.map((r) => r.id).sort()).toEqual([unlinked, none].sort());
});

/**
 * Task 24 fix round 1 M-5 — ก้าวเปิดสัญญาส่ง "สัญญาอนุมัติแล้ว" ทาง LINE (แถว OTP) หรือ SMS (customer.phone) ⇒ เปิดเฉพาะลูกค้าที่ไม่มี LINE การเงิน
 * และเบอร์เป็นรูปโทรไม่ได้ `TEST-…` ของชุดทดสอบ
 */
it('ก้าวเปิดสัญญา: เปิดเฉพาะลูกค้าไม่มี LINE การเงิน + เบอร์โทรไม่ได้ (TEST-) · มีแถว OTP / มีค่าคอลัมน์ / เบอร์โทรได้ = ข้าม', async () => {
  const silent = await customer('เงียบ', '', null, testDraftCustomerPhone(1));
  const otp = await customer('มีแถว OTP', '', null, testDraftCustomerPhone(2));
  await prisma.customerLineLink.create({
    data: { customerId: otp, lineUserId: `U${tag}-act`, channel: LineChannelType.FINANCE },
  });
  const column = await customer('มีคอลัมน์', '', `U${tag}-act-col`, testDraftCustomerPhone(3));
  const dialable = await customer('เบอร์โทรได้', '05', null);
  // fix round 2 m-4 — ขึ้นต้น TEST- แต่ตัดอักขระแล้วเป็นเบอร์มือถือที่โทรได้ (66812345678) ⇒ ต้องไม่ผ่านด่าน
  const prefixedDialable = await customer('TEST- แต่โทรได้', '', null, 'TEST-0812345678');
  const mine = [silent, otp, column, dialable, prefixedDialable];

  const activatable = await prisma.customer.findMany({
    where: { id: { in: mine }, ...ACTIVATION_SILENT_CUSTOMER_WHERE },
    select: { id: true },
  });

  expect(activatable.map((r) => r.id)).toEqual([silent]);
});
