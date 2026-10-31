/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/overdue/bulk.service.assigned-scope.db.spec.ts --runInBand
 *
 * Task 24 fix round 2 I-R1 — โหมดโฟกัส (`GET /collections/session/mine`) แสดงงานรายวันที่ระบบจ่าย**ข้ามสาขาได้โดยตั้งใจ** (round-robin ·
 * เติมขั้นต่ำจาก pool · ความสัมพันธ์เดิม · หยิบจาก pool) ⇒ ด่านสาขาของ `send-line-adhoc` / `bulk/send-line` (fix round 1 M-3) ต้องยอมสัญญาที่ผู้ส่ง
 * มีงานรายวันวันนี้ (นิยาม "วันนี้" เดียวกับหน้าจอ — `collectionsSessionDay`) นอกเหนือจากสาขาตัวเอง · ไม่มีงาน + ต่างสาขา = 404 ตามเดิม
 */
import { NotFoundException } from '@nestjs/common';
import { LineChannelType, Prisma, PrismaClient } from '@prisma/client';
import { collectionsSessionDay } from '../collections-session/collections-session.service';
import { OverdueBulkService } from './bulk.service';

const prisma = new PrismaClient();
const stamp = `t24ir1-${Date.now()}`;
const dec = (v: string) => new Prisma.Decimal(v);
const notifications = { send: jest.fn().mockResolvedValue({ status: 'SENT' }) };
let service: OverdueBulkService;
let branchX = '';
let branchY = '';
let salesY = '';
let salesNoBranch = '';
let assigned = '';
let unassigned = '';
let assignedYesterday = '';
let assignedDeleted = '';

async function user(label: string, role: 'OWNER' | 'SALES', branchId: string | null) {
  return (
    await prisma.user.create({
      data: {
        email: `${stamp}-${label}@bestchoice.test`,
        password: 'x',
        name: label,
        role,
        branchId,
      },
    })
  ).id;
}

async function contract(label: string, salespersonId: string) {
  const customer = await prisma.customer.create({ data: { name: `ทดสอบ ${stamp} ${label}` } });
  await prisma.customerLineLink.create({
    data: {
      customerId: customer.id,
      lineUserId: `U${stamp}-${label}`,
      channel: LineChannelType.FINANCE,
    },
  });
  const product = await prisma.product.create({
    data: {
      name: `spec ${label}`,
      brand: 'Apple',
      model: 'iPhone 15',
      category: 'PHONE_NEW',
      costPrice: dec('20000.00'),
      branchId: branchX,
      imeiSerial: `${stamp}-${label}`,
    },
  });
  return (
    await prisma.contract.create({
      data: {
        contractNumber: `${stamp}-${label}`,
        customerId: customer.id,
        productId: product.id,
        branchId: branchX,
        salespersonId,
        planType: 'STORE_WITH_INTEREST',
        sellingPrice: dec('30000.00'),
        downPayment: dec('5000.00'),
        interestRate: dec('0.0500'),
        totalMonths: 12,
        interestTotal: dec('15000.00'),
        financedAmount: dec('25000.00'),
        monthlyPayment: dec('3333.33'),
        status: 'OVERDUE',
      },
    })
  ).id;
}

async function assign(contractId: string, collectorId: string, date: Date, deletedAt?: Date) {
  await prisma.dailyAssignment.create({
    data: { contractId, collectorId, date, source: 'AUTO_ROUNDROBIN', deletedAt },
  });
}

beforeAll(async () => {
  const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://unset/unset').pathname.slice(1);
  if (!/^test_db$|_test$/.test(dbName)) {
    throw new Error(`สเปคนี้เขียนแถวจริง — ต้องรันกับฐานทดสอบ แต่ได้ "${dbName}"`);
  }
  branchX = (await prisma.branch.create({ data: { name: `${stamp} X` } })).id;
  branchY = (await prisma.branch.create({ data: { name: `${stamp} Y` } })).id;
  const owner = await user('owner', 'OWNER', null);
  salesY = await user('sales-y', 'SALES', branchY);
  salesNoBranch = await user('sales-none', 'SALES', null);
  assigned = await contract('assigned', owner);
  unassigned = await contract('unassigned', owner);
  assignedYesterday = await contract('yesterday', owner);
  assignedDeleted = await contract('deleted', owner);
  const today = collectionsSessionDay();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  await assign(assigned, salesY, today);
  await assign(assignedYesterday, salesY, yesterday);
  await assign(assignedDeleted, salesY, today, new Date());
  service = new OverdueBulkService(prisma as never, {} as never, notifications as never);
});

beforeEach(() => notifications.send.mockClear());

// แถวทดสอบทิ้งไว้ในฐานทดสอบ (audit log ของการส่งเป็น immutable — ฐานถูก drop หลังรัน)
afterAll(async () => prisma.$disconnect());

const msg = { customMessage: 'กรุณาชำระค่างวดที่ค้าง' };

describe('ส่ง LINE จากคิวทวงถาม: สาขาตัวเอง หรือ มีงานรายวันวันนี้ (Task 24 fix round 2 I-R1)', () => {
  it('SALES สาขา Y ได้งานวันนี้ของสัญญาสาขา X → ส่งได้', async () => {
    await expect(
      service.sendLineAdhoc(assigned, msg, { id: salesY, role: 'SALES', branchId: branchY }),
    ).resolves.toEqual({ sent: 1, failed: 0, total: 1 });
    expect(notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: `U${stamp}-assigned`, channelKey: 'line-finance' }),
    );
  });

  it('SALES สาขา Y ไม่มีงานของสัญญาสาขา X → 404 ไม่ส่ง', async () => {
    await expect(
      service.sendLineAdhoc(unassigned, msg, { id: salesY, role: 'SALES', branchId: branchY }),
    ).rejects.toThrow(NotFoundException);
    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('งานของเมื่อวาน / งานที่ถูกลบ ไม่นับ → 404', async () => {
    for (const id of [assignedYesterday, assignedDeleted]) {
      await expect(
        service.sendLineAdhoc(id, msg, { id: salesY, role: 'SALES', branchId: branchY }),
      ).rejects.toThrow(NotFoundException);
    }
    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('SALES ไม่มีสาขาแต่มีงานวันนี้ → ส่งได้ · ไม่มีงาน → 404', async () => {
    await assign(unassigned, salesNoBranch, collectionsSessionDay());
    await expect(
      service.sendLineAdhoc(unassigned, msg, { id: salesNoBranch, role: 'SALES', branchId: null }),
    ).resolves.toEqual({ sent: 1, failed: 0, total: 1 });
    await expect(
      service.sendLineAdhoc(assigned, msg, { id: salesNoBranch, role: 'SALES', branchId: null }),
    ).rejects.toThrow(NotFoundException);
  });

  it('ส่งรวด (bulk) ใช้ด่านเดียวกัน — โหลด/ส่ง/นับเฉพาะสัญญาที่อยู่ในขอบเขต', async () => {
    await expect(
      service.bulkSendLine(
        { contractIds: [assigned, assignedYesterday], ...msg },
        { id: salesY, role: 'SALES', branchId: branchY },
      ),
    ).resolves.toEqual({ sent: 1, failed: 0, total: 1 });
  });
});
