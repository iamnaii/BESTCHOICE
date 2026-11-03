/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/chat-engine/services/room-manager.customer-scope.db.spec.ts --runInBand
 *
 * Task 29 #3 (เจ้าของตัดสิน 31 ต.ค. 2026) — แท็บ "แชท LINE" ของแผง 360 (`GET`/`POST /staff-chat/customer/:customerId/messages` →
 * `RoomManagerService.getCustomerMessages` / `sendCustomerMessage`) ใช้ขอบเขตเดียวกับปุ่ม "ส่ง LINE" ของคิวทวงถาม (`lineSendContractScope`):
 * role ข้ามสาขาเห็นทุกลูกค้า · นอกนั้นเฉพาะลูกค้าที่มีสัญญาในสาขาของผู้ใช้ **หรือ** ผู้ใช้มีงานรายวันวันนี้ (`collectionsSessionDay`) ของสัญญาใดของลูกค้า ·
 * นอกขอบเขต = 404 (เหมือนปุ่มส่ง) ทั้งอ่านและส่ง — เดิม route นี้ไม่มีขอบเขตสาขาเลย (SALES สาขาไหนก็อ่านแชท/ส่งข้อความถึงลูกค้าทุกคนได้)
 */
import { NotFoundException } from '@nestjs/common';
import { ChatChannel, LineChannelType, MessageRole, Prisma, PrismaClient } from '@prisma/client';
import { collectionsSessionDay } from '../../collections-session/collections-session.service';
import { RoomManagerService } from './room-manager.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

type Actor = { id: string; role: string; branchId: string | null };

const prisma = new PrismaClient();
const stamp = `t29sc-${Date.now()}`;
const dec = (v: string) => new Prisma.Decimal(v);
const router = { sendStaffMessage: jest.fn().mockResolvedValue({ success: true }) };
let rooms: RoomManagerService;
let branchX = '';
let branchY = '';
let customerX = ''; // สัญญาสาขา X + ยืนยัน LINE การเงินแล้ว + มีแชท
let roomX = '';
let prospect = ''; // ไม่มีสัญญา (ผู้สนใจ) + ยืนยัน LINE แล้ว
const actors: Record<string, Actor> = {};

async function user(label: string, role: string, branchId: string | null): Promise<Actor> {
  const row = await prisma.user.create({
    data: {
      email: `${stamp}-${label}@bestchoice.test`,
      password: 'x',
      name: label,
      role: role as never,
      branchId,
    },
  });
  return { id: row.id, role, branchId };
}

/** ลูกค้าที่ยืนยัน LINE การเงินด้วย OTP แล้ว + ห้อง LINE การเงินที่มีข้อความหนึ่งข้อความ */
async function verifiedCustomer(label: string) {
  const customer = await prisma.customer.create({ data: { name: `ทดสอบ ${stamp} ${label}` } });
  const lineUserId = `U${stamp}-${label}`;
  await prisma.customerLineLink.create({
    data: { customerId: customer.id, lineUserId, channel: LineChannelType.FINANCE },
  });
  const room = await prisma.chatRoom.create({
    data: { channel: ChatChannel.LINE_FINANCE, lineUserId, customerId: customer.id },
  });
  await prisma.chatMessage.create({
    data: { roomId: room.id, role: MessageRole.CUSTOMER, text: `สวัสดี ${label}` },
  });
  return { customerId: customer.id, roomId: room.id };
}

async function contract(
  label: string,
  customerId: string,
  branchId: string,
  salespersonId: string,
) {
  const product = await prisma.product.create({
    data: {
      name: `spec ${label}`,
      brand: 'Apple',
      model: 'iPhone 15',
      category: 'PHONE_NEW',
      costPrice: dec('20000.00'),
      branchId,
      imeiSerial: `${stamp}-${label}`,
    },
  });
  return (
    await prisma.contract.create({
      data: {
        contractNumber: `${stamp}-${label}`,
        customerId,
        productId: product.id,
        branchId,
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

const read = (customerId: string, actor: Actor) => rooms.getCustomerMessages(customerId, actor, 10);
const send = (customerId: string, actor: Actor) =>
  rooms.sendCustomerMessage(customerId, actor, 'กรุณาชำระค่างวด');

async function expectInScope(customerId: string, roomId: string, actor: Actor) {
  await expect(read(customerId, actor)).resolves.toMatchObject({ roomId });
  await expect(send(customerId, actor)).resolves.toMatchObject({ room: { id: roomId } });
  expect(router.sendStaffMessage).toHaveBeenCalledWith(
    expect.objectContaining({ roomId, staffId: actor.id }),
  );
}

async function expectOutOfScope(customerId: string, actor: Actor) {
  await expect(read(customerId, actor)).rejects.toThrow(NotFoundException);
  await expect(send(customerId, actor)).rejects.toThrow(NotFoundException);
  expect(router.sendStaffMessage).not.toHaveBeenCalled();
}

beforeAll(async () => {
  const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://unset/unset').pathname.slice(1);
  if (!/^test_db$|_test$/.test(dbName)) {
    throw new Error(`สเปคนี้เขียนแถวจริง — ต้องรันกับฐานทดสอบ แต่ได้ "${dbName}"`);
  }
  branchX = (await prisma.branch.create({ data: { name: `${stamp} X` } })).id;
  branchY = (await prisma.branch.create({ data: { name: `${stamp} Y` } })).id;
  actors.owner = await user('owner', 'OWNER', null);
  actors.financeManager = await user('fm', 'FINANCE_MANAGER', branchY);
  actors.accountant = await user('acc', 'ACCOUNTANT', null);
  actors.managerX = await user('bm-x', 'BRANCH_MANAGER', branchX);
  actors.salesX = await user('sales-x', 'SALES', branchX);
  actors.salesY = await user('sales-y', 'SALES', branchY);
  actors.managerY = await user('bm-y', 'BRANCH_MANAGER', branchY);
  actors.salesYToday = await user('sales-y-today', 'SALES', branchY);
  actors.salesYYesterday = await user('sales-y-yesterday', 'SALES', branchY);
  actors.salesYDeleted = await user('sales-y-deleted', 'SALES', branchY);
  actors.salesNoBranchToday = await user('sales-none-today', 'SALES', null);
  actors.salesNoBranch = await user('sales-none', 'SALES', null);

  ({ customerId: customerX, roomId: roomX } = await verifiedCustomer('x'));
  // งานรายวัน unique ต่อ (วัน, สัญญา) ⇒ ลูกค้า X มีสามสัญญาในสาขา X — งานของสัญญาใดของลูกค้าก็ให้สิทธิ์
  const contractX1 = await contract('x1', customerX, branchX, actors.owner.id);
  const contractX2 = await contract('x2', customerX, branchX, actors.owner.id);
  const contractX3 = await contract('x3', customerX, branchX, actors.owner.id);
  // สัญญาที่ถูกลบในสาขา Y ไม่ให้สิทธิ์ SALES/BM สาขา Y
  const deletedY = await contract('deleted-y', customerX, branchY, actors.owner.id);
  await prisma.contract.update({ where: { id: deletedY }, data: { deletedAt: new Date() } });
  const today = collectionsSessionDay();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  await assign(contractX1, actors.salesYToday.id, today);
  await assign(contractX1, actors.salesYYesterday.id, yesterday);
  await assign(contractX2, actors.salesYDeleted.id, today, new Date());
  await assign(contractX3, actors.salesNoBranchToday.id, today);
  ({ customerId: prospect } = await verifiedCustomer('prospect'));

  rooms = new RoomManagerService(prisma as never, {} as never, undefined, router as never);
});

beforeEach(() => router.sendStaffMessage.mockClear());

// แถวทดสอบทิ้งไว้ในฐานทดสอบ (สัญญา/งานรายวันมี FK หลายชั้น — ฐานถูก drop หลังรัน)
afterAll(async () => prisma.$disconnect());

describe('แท็บ "แชท LINE" ของแผง 360 ใช้ขอบเขตเดียวกับปุ่มส่ง LINE (Task 29 #3)', () => {
  it('BM / SALES สาขาเดียวกับสัญญาของลูกค้า → อ่านประวัติ + ส่งได้', async () => {
    await expectInScope(customerX, roomX, actors.managerX);
    router.sendStaffMessage.mockClear();
    await expectInScope(customerX, roomX, actors.salesX);
  });

  it('SALES / BM สาขาอื่นที่ไม่มีงานของสัญญาลูกค้า → อ่านและส่ง 404 (ไม่ส่ง) · สัญญาที่ถูกลบในสาขาเขาไม่นับ', async () => {
    await expectOutOfScope(customerX, actors.salesY);
    await expectOutOfScope(customerX, actors.managerY);
  });

  it('SALES สาขาอื่นที่มีงานรายวัน "วันนี้" ของสัญญาลูกค้า → อ่าน + ส่งได้ (โหมดโฟกัสจ่ายงานข้ามสาขาได้)', async () => {
    await expectInScope(customerX, roomX, actors.salesYToday);
  });

  it('งานของเมื่อวาน / งานที่ถูกลบ ไม่นับ → 404', async () => {
    await expectOutOfScope(customerX, actors.salesYYesterday);
    await expectOutOfScope(customerX, actors.salesYDeleted);
  });

  it('SALES ไม่มีสาขา: มีงานวันนี้ → ได้ · ไม่มีงาน → 404 (fail closed)', async () => {
    await expectInScope(customerX, roomX, actors.salesNoBranchToday);
    router.sendStaffMessage.mockClear();
    await expectOutOfScope(customerX, actors.salesNoBranch);
  });

  it('role ข้ามสาขา (OWNER · FINANCE_MANAGER · ACCOUNTANT) → อ่าน + ส่งได้ทุกลูกค้า รวมผู้สนใจที่ไม่มีสัญญา', async () => {
    for (const actor of [actors.owner, actors.financeManager, actors.accountant]) {
      router.sendStaffMessage.mockClear();
      await expectInScope(customerX, roomX, actor);
    }
    const prospectRoom = (
      await prisma.chatRoom.findFirstOrThrow({ where: { customerId: prospect } })
    ).id;
    router.sendStaffMessage.mockClear();
    await expectInScope(prospect, prospectRoom, actors.owner);
  });

  it('ลูกค้าที่ไม่มีสัญญา (ผู้สนใจ) → BM/SALES ไม่มีขอบเขต → 404', async () => {
    await expectOutOfScope(prospect, actors.managerX);
    await expectOutOfScope(prospect, actors.salesX);
  });

  it('ไม่มีลูกค้านี้ → 404 แม้ role ข้ามสาขา', async () => {
    await expectOutOfScope('00000000-0000-4000-8000-000000000000', actors.owner);
  });
});
