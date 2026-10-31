/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/customers/services/customer-write.finance-line-unlink.db.spec.ts --runInBand
 *
 * Task 27 — ปุ่ม "ยกเลิกการผูก" LINE น้องเบส (การเงิน) ในฟอร์มแก้ไขลูกค้า → `POST /customers/:id/finance-line/unlink`
 * (`CustomerWriteService.unlinkFinanceLineByStaff`). ต่างจากทาง PATCH `lineIdFinance: null` ที่ตัดสินด้วยคอลัมน์ (คอลัมน์ว่าง = ไม่แตะ)
 * ทางนี้ปิด**แถว OTP ที่ยังผูก**แม้คอลัมน์ว่าง (ผ่าน `unlinkFinanceLine({ customerId })` ตัวเดิม) + ล้าง `chat_rooms.verified_at`
 * (helper ของ Task 24) + เขียน audit `CUSTOMER_FINANCE_LINE_UNLINKED` (Task 22 รายงานว่าทางพนักงานไม่มี audit เฉพาะ)
 */
import { NotFoundException } from '@nestjs/common';
import { ChatChannel, LineChannelType, PrismaClient } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { CustomerQueryService } from './customer-query.service';
import { CustomerWriteService } from './customer-write.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const prisma = new PrismaClient();
const tag = `t27u-${Date.now()}`;
const digits = String(Date.now()).slice(-7);
const customerIds: string[] = [];
const line = (name: string) => `U${tag}-${name}`;
let service: CustomerWriteService;
let query: CustomerQueryService;
let staffId = '';

async function customer(name: string, phoneSuffix: string, lineIdFinance: string | null = null) {
  const row = await prisma.customer.create({
    data: { name: `ทดสอบ ${name} ${tag}`, phone: `08${phoneSuffix}${digits}`, lineIdFinance },
  });
  customerIds.push(row.id);
  return row;
}

async function link(customerId: string, lineUserId: string) {
  await prisma.customerLineLink.create({
    data: { customerId, lineUserId, channel: LineChannelType.FINANCE },
  });
}

async function room(lineUserId: string, customerId: string) {
  const row = await prisma.chatRoom.create({
    data: { lineUserId, channel: ChatChannel.LINE_FINANCE, customerId, verifiedAt: new Date() },
  });
  return row.id;
}

const audits = (customerId: string) =>
  prisma.auditLog.findMany({
    where: { entity: 'customer', entityId: customerId, action: 'CUSTOMER_FINANCE_LINE_UNLINKED' },
  });

beforeAll(async () => {
  const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://unset/unset').pathname.slice(1);
  if (!/^test_db$|_test$/.test(dbName)) {
    throw new Error(`สเปคนี้เขียน/ลบแถวจริง — ต้องรันกับฐานทดสอบ แต่ได้ "${dbName}"`);
  }
  // audit_logs ลบไม่ได้ (trigger) ⇒ ผู้ใช้ของแถว audit อยู่ต่อในฐานทดสอบ (ฐานถูก drop หลังรัน)
  const staff = await prisma.user.create({
    data: {
      email: `${tag}@test.local`,
      password: 'x',
      name: `พนักงาน ${tag}`,
      role: 'BRANCH_MANAGER',
    },
  });
  staffId = staff.id;
  query = new CustomerQueryService(prisma as never, {} as never, {} as never, {} as never);
  service = new CustomerWriteService(
    prisma as never,
    {} as never,
    query,
    undefined,
    new AuditService(prisma as never),
  );
});

afterAll(async () => {
  await prisma.chatRoom.deleteMany({ where: { lineUserId: { startsWith: `U${tag}` } } });
  await prisma.customerLineLink.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  await prisma.$disconnect();
});

describe('POST /customers/:id/finance-line/unlink (Task 27)', () => {
  it('แถว OTP ที่ยังผูก + คอลัมน์ว่าง → ปิดแถว · ล้าง verified_at · สถานะเป็นยังไม่ผูก · audit ไม่มี U-id', async () => {
    const c = await customer('คอลัมน์ว่าง', '1');
    await link(c.id, line('1'));
    const roomId = await room(line('1'), c.id);
    expect((await query.findOne(c.id)).financeLine.verified).toBe(true);

    const out = await service.unlinkFinanceLineByStaff(c.id, {
      id: staffId,
      role: 'BRANCH_MANAGER',
    });

    expect(out).toEqual({
      id: c.id,
      unlinked: true,
      financeLine: { verified: false, linkedAt: null },
    });
    const row = await prisma.customerLineLink.findFirstOrThrow({ where: { customerId: c.id } });
    expect(row.unlinkedAt).toBeInstanceOf(Date);
    expect(
      (await prisma.chatRoom.findUniqueOrThrow({ where: { id: roomId } })).verifiedAt,
    ).toBeNull();
    expect((await query.findOne(c.id)).financeLine).toEqual({ verified: false, linkedAt: null });

    const [audit, ...rest] = await audits(c.id);
    expect(rest).toHaveLength(0);
    expect(audit.userId).toBe(staffId);
    expect(audit.rowHash).toEqual(expect.any(String)); // อยู่ใน Merkle chain (เขียนหลัง commit)
    expect(audit.oldValue).toMatchObject({
      financeLine: { verified: true, linkedAt: row.linkedAt.toISOString() },
      lineIdFinanceColumnSet: false,
    });
    expect(audit.newValue).toEqual({ financeLine: { verified: false, linkedAt: null } });
    expect(JSON.stringify([audit.oldValue, audit.newValue])).not.toContain(line('1'));
  });

  it('แถว OTP + คอลัมน์มีค่า → ล้างทั้งคู่', async () => {
    const c = await customer('คอลัมน์มีค่า', '2', line('2'));
    await link(c.id, line('2'));

    await service.unlinkFinanceLineByStaff(c.id, { id: staffId, role: 'OWNER' });

    expect(
      (await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).lineIdFinance,
    ).toBeNull();
    expect(
      await prisma.customerLineLink.count({ where: { customerId: c.id, unlinkedAt: null } }),
    ).toBe(0);
    expect(await audits(c.id)).toHaveLength(1);
  });

  it('คอลัมน์ค้างไม่มีแถว OTP → ล้างคอลัมน์ (ทางกวาดค่าเก่าก่อน 1 ธ.ค.) + audit', async () => {
    const c = await customer('คอลัมน์ค้าง', '3', line('3-typed'));

    const out = await service.unlinkFinanceLineByStaff(c.id, { id: staffId, role: 'OWNER' });

    expect(out.unlinked).toBe(true);
    expect(
      (await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).lineIdFinance,
    ).toBeNull();
    const [audit] = await audits(c.id);
    expect(audit.oldValue).toMatchObject({
      financeLine: { verified: false, linkedAt: null },
      lineIdFinanceColumnSet: true,
    });
  });

  it('ไม่มีอะไรให้ยกเลิก (กดซ้ำ/หน้าจอค้าง) → สำเร็จแบบไม่แตะอะไร ไม่เขียน audit', async () => {
    const c = await customer('ไม่เคยผูก', '4');

    const out = await service.unlinkFinanceLineByStaff(c.id, { id: staffId, role: 'OWNER' });

    expect(out).toEqual({
      id: c.id,
      unlinked: false,
      financeLine: { verified: false, linkedAt: null },
    });
    expect(await audits(c.id)).toHaveLength(0);
  });

  it('ไม่แตะแถว/ห้องของลูกค้าคนอื่น (แม้คอลัมน์ของคนนี้พิมพ์ LINE ของเขาไว้)', async () => {
    const owner = await customer('เจ้าของ LINE', '5');
    await link(owner.id, line('5'));
    const ownerRoom = await room(line('5'), owner.id);
    const typed = await customer('พิมพ์ LINE คนอื่น', '6', line('5'));

    await service.unlinkFinanceLineByStaff(typed.id, { id: staffId, role: 'OWNER' });

    expect((await query.findOne(owner.id)).financeLine.verified).toBe(true);
    expect(
      (await prisma.chatRoom.findUniqueOrThrow({ where: { id: ownerRoom } })).verifiedAt,
    ).toBeInstanceOf(Date);
  });

  it('ลูกค้าที่ถูกลบ / ไม่มี → 404 ไม่แตะแถว', async () => {
    const c = await customer('ถูกลบ', '7');
    await link(c.id, line('7'));
    await prisma.customer.update({ where: { id: c.id }, data: { deletedAt: new Date() } });

    await expect(
      service.unlinkFinanceLineByStaff(c.id, { id: staffId, role: 'OWNER' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.unlinkFinanceLineByStaff('00000000-0000-4000-8000-000000000000', {
        id: staffId,
        role: 'OWNER',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(
      await prisma.customerLineLink.count({ where: { customerId: c.id, unlinkedAt: null } }),
    ).toBe(1);
  });
});
