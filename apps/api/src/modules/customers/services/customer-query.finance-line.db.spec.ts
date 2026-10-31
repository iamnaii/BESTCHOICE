/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/customers/services/customer-query.finance-line.db.spec.ts --runInBand
 *
 * Task 27 — ฟอร์มแก้ไขลูกค้า (หน้าลูกค้า › แก้ไข · หน้าสัญญา › แก้ไขข้อมูลลูกค้า) แสดงสถานะ "LINE น้องเบส (การเงิน)" จาก
 * `GET /customers/:id` (+ `/:id/detail` ที่ต่อจาก findOne) → `financeLine: { verified, linkedAt }` คิดจากแถว
 * `customer_line_links` ช่อง FINANCE ที่ยังผูก (`ACTIVE_FINANCE_LINK_WHERE` ตัวเดิม) — คอลัมน์ `line_id_finance` ไม่ใช่เกณฑ์ ·
 * ไม่ส่ง U-id ของแถวออกไป
 */
import { LineChannelType, PrismaClient } from '@prisma/client';
import { CustomerQueryService } from './customer-query.service';

const prisma = new PrismaClient();
const tag = `t27q-${Date.now()}`;
const digits = String(Date.now()).slice(-7);
const customerIds: string[] = [];
const line = (name: string) => `U${tag}-${name}`;
let query: CustomerQueryService;

async function customer(name: string, phoneSuffix: string, lineIdFinance: string | null = null) {
  const row = await prisma.customer.create({
    data: { name: `ทดสอบ ${name} ${tag}`, phone: `09${phoneSuffix}${digits}`, lineIdFinance },
  });
  customerIds.push(row.id);
  return row;
}

async function link(
  customerId: string,
  lineUserId: string,
  extra: { linkedAt?: Date; unlinkedAt?: Date; deletedAt?: Date } = {},
) {
  await prisma.customerLineLink.create({
    data: { customerId, lineUserId, channel: LineChannelType.FINANCE, ...extra },
  });
}

beforeAll(() => {
  const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://unset/unset').pathname.slice(1);
  if (!/^test_db$|_test$/.test(dbName)) {
    throw new Error(`สเปคนี้เขียน/ลบแถวจริง — ต้องรันกับฐานทดสอบ แต่ได้ "${dbName}"`);
  }
  query = new CustomerQueryService(prisma as never, {} as never, {} as never, {} as never);
});

afterAll(async () => {
  await prisma.customerLineLink.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  await prisma.$disconnect();
});

describe('GET /customers/:id → financeLine (Task 27)', () => {
  it('แถว OTP ที่ยังผูก → verified + วันที่ผูก · ไม่ส่ง U-id ของแถว', async () => {
    const c = await customer('ผูกแล้ว', '1');
    const at = new Date('2026-10-30T03:15:00.000Z');
    await link(c.id, line('active'), { linkedAt: at });

    const out = await query.findOne(c.id);

    expect(out.financeLine).toEqual({ verified: true, linkedAt: at.toISOString() });
    expect(out).not.toHaveProperty('lineLinks');
    expect(JSON.stringify(out)).not.toContain(line('active'));
  });

  it('แถวที่ยกเลิกผูกแล้ว (unlinkedAt) → verified false · linkedAt null', async () => {
    const c = await customer('ยกเลิกแล้ว', '2');
    await link(c.id, line('closed'), { unlinkedAt: new Date() });

    expect((await query.findOne(c.id)).financeLine).toEqual({ verified: false, linkedAt: null });
  });

  it('แถวที่ถูกลบ (deletedAt) → verified false', async () => {
    const c = await customer('แถวถูกลบ', '3');
    await link(c.id, line('deleted'), { deletedAt: new Date() });

    expect((await query.findOne(c.id)).financeLine).toEqual({ verified: false, linkedAt: null });
  });

  it('คอลัมน์ line_id_finance ค้าง (พนักงาน/นำเข้าเขียนก่อน Task 22) แต่ไม่มีแถว OTP → verified false', async () => {
    const c = await customer('คอลัมน์ค้าง', '4', line('typed'));

    const out = await query.findOne(c.id);

    expect(out.financeLine).toEqual({ verified: false, linkedAt: null });
  });

  it('แถวของลูกค้าคนอื่นไม่นับ (LINE เดียวกันที่พิมพ์ไว้ในคอลัมน์ของคนนี้) → verified false', async () => {
    const owner = await customer('เจ้าของ LINE', '5');
    await link(owner.id, line('owned'));
    const other = await customer('พิมพ์ LINE คนอื่น', '6', line('owned'));

    expect((await query.findOne(other.id)).financeLine).toEqual({
      verified: false,
      linkedAt: null,
    });
    expect((await query.findOne(owner.id)).financeLine.verified).toBe(true);
  });
});
