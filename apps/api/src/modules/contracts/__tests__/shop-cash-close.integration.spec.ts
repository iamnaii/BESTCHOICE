/**
 * นับเงินปิดยอดลิ้นชักสาขา — วงจรจริงบน DB จริง (สเปค 2026-09-20-shop-cash-close, mockup กระดาน 7–9)
 *
 * พิสูจน์สิ่งที่ unit test (mock prisma) มองไม่เห็น: ขอบรอบจาก `shop_tenders` จริง (เงินสดเท่านั้น · รายการหลังปิดยอดไปรอบถัดไป),
 * ล็อกสาขา, ผู้นับ ≠ ผู้ยืนยัน, ตีกลับแล้วรอบถอยกลับไปขอบเดิม, และแถบเตือนของหน้าประวัติ
 *
 * อยู่ใต้ contracts/__tests__ เพราะ CI glob ครอบโฟลเดอร์นี้อยู่แล้ว (`src/modules/contracts/__tests__/*.integration.spec.ts`).
 * ล้างข้อมูลของตัวเองครบใน afterAll — ไฟล์พี่น้องในชุดเดียวกันล้างตารางแบบเหมา (`deleteMany({})`).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ShopCashCloseService, type CashCloseActor } from '../../shop-tenders/shop-cash-close.service';
import { bkkDayRange } from '../../shop-tenders/shop-tenders-report.service';
import { bangkokDateString } from '../../../utils/date.util';
import { DashboardOpsService } from '../../dashboard/services/dashboard-ops.service';

const prisma = new PrismaClient();
// AuditLog ลบไม่ได้ (immutable trigger) ⇒ ถ้าเขียนจริง ผู้ใช้ของเทสจะลบไม่ออกเพราะ FK — payload ของ audit ปักที่ unit spec แทน
const service = new ShopCashCloseService(prisma as never, { log: async () => undefined } as never);

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const tick = () => new Promise((resolve) => setTimeout(resolve, 8));

let branchId = '';
let otherBranchId = '';
const users: Record<'sales' | 'manager' | 'owner' | 'otherManager', CashCloseActor> = {} as never;
const userIds: string[] = [];

async function seedUser(key: keyof typeof users, role: string, branch: string | null) {
  const user = await prisma.user.create({
    data: { email: `cashclose-${key}-${RUN}@test.local`, password: 'x', name: `CASHCLOSE ${key}`, role: role as never, branchId: branch },
  });
  userIds.push(user.id);
  users[key] = { id: user.id, role, branchId: branch };
}

async function tender(branch: string, direction: 'IN' | 'OUT', method: 'CASH' | 'BANK_TRANSFER', amount: number, occurredAt = new Date()) {
  await prisma.shopTender.create({
    data: { branchId: branch, direction, method, amount, kind: direction === 'IN' ? 'CASH_SALE' : 'TRADE_IN_PAYOUT', actorId: users.sales.id,
      occurredAt, reference: method === 'CASH' ? null : `REF-${RUN}` },
  });
}

describe('นับเงินปิดยอด (shop cash close)', () => {
  beforeAll(async () => {
    const branch = await prisma.branch.create({ data: { name: `CASHCLOSE Branch ${RUN}`, shopCashFloat: 2000 } });
    const other = await prisma.branch.create({ data: { name: `CASHCLOSE Other ${RUN}` } });
    branchId = branch.id; otherBranchId = other.id;
    await seedUser('sales', 'SALES', branchId);
    await seedUser('manager', 'BRANCH_MANAGER', branchId);
    await seedUser('owner', 'OWNER', null);
    await seedUser('otherManager', 'BRANCH_MANAGER', otherBranchId);
  });

  afterAll(async () => {
    const branches = [branchId, otherBranchId].filter(Boolean);
    await prisma.shopCashClose.deleteMany({ where: { branchId: { in: branches } } });
    await prisma.shopTender.deleteMany({ where: { branchId: { in: branches } } });
    await prisma.todo.deleteMany({ where: { branchId: { in: branches } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.branch.deleteMany({ where: { id: { in: branches } } });
    await prisma.$disconnect();
  });

  it('ต้องมีในลิ้นชัก = เงินทอนตั้งต้น + รับเงินสด − จ่ายเงินสดออก (โอน/QR ไม่นับ)', async () => {
    await tender(branchId, 'IN', 'CASH', 16500);
    await tender(branchId, 'OUT', 'CASH', 5790);
    await tender(branchId, 'IN', 'BANK_TRANSFER', 4900);
    const status = await service.getStatus(users.sales, { branchId });
    expect(status.round).toMatchObject({ periodStart: null, floatAmount: 2000, cashIn: 16500, cashOut: 5790, expectedAmount: 12710, movementCount: 2 });
    expect(status.permissions).toMatchObject({ canCount: true, canConfirm: false });
    expect((await service.getStatus(users.owner, { branchId })).permissions).toMatchObject({ canCount: false, canConfirm: true });
  });

  it('สิทธิ์: เจ้าของนับไม่ได้ · พนักงาน/ผจก.ต่างสาขานับและดูไม่ได้', async () => {
    await expect(service.count(users.owner, { branchId, countedAmount: 12710 })).rejects.toThrow('ผู้นับเงินปิดยอดต้องเป็นพนักงานขายหรือผู้จัดการสาขา');
    await expect(service.count(users.otherManager, { branchId, countedAmount: 12710 })).rejects.toThrow('เฉพาะสาขาของตัวเอง');
    await expect(service.getStatus(users.otherManager, { branchId })).rejects.toThrow('เฉพาะสาขาของตัวเอง');
  });

  let firstCloseId = '';
  let firstCountedAt = new Date(0);
  it('ยอดไม่ตรงบังคับเหตุผล → บันทึกเป็นรอยืนยันรับเงิน · ส่งเงิน = นับได้ − เงินทอนตั้งต้น', async () => {
    await expect(service.count(users.sales, { branchId, countedAmount: 12510 })).rejects.toThrow('กรอกเหตุผลของส่วนต่างก่อนบันทึก');
    const close = await service.count(users.sales, { branchId, countedAmount: 12510, varianceReason: 'ทอนเงินลูกค้าผิด 200' });
    expect(close).toMatchObject({ status: 'PENDING_CONFIRM', attemptNo: 1, expectedAmount: 12710, countedAmount: 12510, varianceAmount: -200,
      sendAmount: 10510, varianceReason: 'ทอนเงินลูกค้าผิด 200', periodStart: null });
    expect(close.countedBy.id).toBe(users.sales.id);
    firstCloseId = close.id; firstCountedAt = close.countedAt;
    // เตือนเจ้าของทุกครั้งที่ปิดยอดมีส่วนต่าง = งานในหน้า "งานของทีม" หนึ่งใบ (เงินขาด = HIGH)
    const alarms = await prisma.todo.findMany({ where: { branchId, tags: { has: 'cash-close-variance' } } });
    expect(alarms).toHaveLength(1);
    expect(alarms[0]).toMatchObject({ priority: 'HIGH', createdById: users.sales.id });
    expect(alarms[0].title).toContain('ขาด 200.00');
    expect(alarms[0].description).toContain('ทอนเงินลูกค้าผิด 200');
  });

  it('รายการหลังปิดยอดไปรวมรอบถัดไป · ไม่มีเงินสดใหม่ = นับซ้ำไม่ได้', async () => {
    await expect(service.count(users.sales, { branchId, countedAmount: 2000 })).rejects.toThrow('ยังไม่มีรายการเงินสดใหม่ตั้งแต่ปิดยอดครั้งก่อน');
    await tick();
    await tender(branchId, 'IN', 'CASH', 890);
    const status = await service.getStatus(users.manager, { branchId });
    expect(status.round).toMatchObject({ cashIn: 890, cashOut: 0, expectedAmount: 2890, movementCount: 1 });
    expect(status.round.periodStart).toEqual(firstCountedAt);
    expect(status.closes.map((row) => row.id)).toEqual([firstCloseId]); // ยอดที่ปิดแล้วไม่เปลี่ยน
    expect(status.closes[0]).toMatchObject({ cashIn: 16500, expectedAmount: 12710 });
    expect(status.awaitingConfirm.map((row) => row.id)).toEqual([firstCloseId]);
  });

  it('ผู้ยืนยันต้องไม่ใช่ผู้นับ + ต้องมีสิทธิ์ · รับจริงไม่เท่ายอดแจ้งส่งต้องมีหมายเหตุ', async () => {
    await expect(service.confirm(users.sales, firstCloseId, { receivedAmount: 10510, destination: 'OWNER_HOLD' })).rejects.toThrow('ผู้ยืนยันรับเงินต้องเป็นเจ้าของ');
    await expect(service.confirm(users.otherManager, firstCloseId, { receivedAmount: 10510, destination: 'OWNER_HOLD' })).rejects.toThrow('ผู้ยืนยันรับเงินต้องเป็นเจ้าของ');
    await expect(service.confirm(users.owner, firstCloseId, { receivedAmount: 10500, destination: 'BANK_DEPOSIT' })).rejects.toThrow('กรอกหมายเหตุของส่วนต่างก่อนยืนยัน');
    const confirmed = await service.confirm(users.owner, firstCloseId, { receivedAmount: 10500, destination: 'BANK_DEPOSIT', note: 'นับรับจริงขาดไป 10 บาท' });
    expect(confirmed).toMatchObject({ status: 'CONFIRMED', receivedAmount: 10500, receiveVariance: -10, destination: 'BANK_DEPOSIT' });
    expect(confirmed.confirmedBy?.id).toBe(users.owner.id);
    // ส่วนต่างชั้นที่สอง (เงินหายระหว่างทาง) เตือนแยกอีกใบ
    const alarms = await prisma.todo.findMany({ where: { branchId, tags: { has: 'cash-close-variance' } }, orderBy: { createdAt: 'asc' } });
    expect(alarms).toHaveLength(2);
    expect(alarms[1].title).toContain('รับเงินปิดยอด');
    expect(alarms[1].title).toContain('ขาด 10.00');
    await expect(service.confirm(users.owner, firstCloseId, { receivedAmount: 10510, destination: 'OWNER_HOLD' })).rejects.toThrow('ยืนยันรับเงินไปแล้ว');
  });

  it('ผจก.สาขานับเอง ยืนยันเองไม่ได้ · ตีกลับ → นับใหม่เป็นครั้งที่ 2 บนขอบรอบเดิม', async () => {
    const second = await service.count(users.manager, { branchId, countedAmount: 2890 });
    expect(second).toMatchObject({ attemptNo: 1, expectedAmount: 2890, varianceAmount: 0, sendAmount: 890, varianceReason: null });
    expect(second.periodStart).toEqual(firstCountedAt);
    await expect(service.confirm(users.manager, second.id, { receivedAmount: 890, destination: 'BRANCH_SAFE' })).rejects.toThrow('ต้องไม่ใช่คนเดียวกับผู้นับ');
    await expect(service.sendBack(users.owner, second.id, { reason: 'x' })).rejects.toThrow('กรอกเหตุผลที่ตีกลับ');
    const back = await service.sendBack(users.owner, second.id, { reason: 'นับรวมธนบัตรปลอม ให้นับใหม่' });
    expect(back).toMatchObject({ status: 'SENT_BACK', sentBackReason: 'นับรวมธนบัตรปลอม ให้นับใหม่' });

    await tick();
    await tender(branchId, 'IN', 'CASH', 110);
    const recount = await service.count(users.sales, { branchId, countedAmount: 3000 });
    // รอบถอยกลับไปขอบของการปิดยอดที่ยังมีผลครั้งก่อน (ครั้งแรก) ⇒ รวม 890 ของรอบที่ถูกตีกลับ + 110 ที่เพิ่งเข้า
    expect(recount).toMatchObject({ attemptNo: 2, cashIn: 1000, expectedAmount: 3000, varianceAmount: 0, sendAmount: 1000 });
    expect(recount.periodStart).toEqual(firstCountedAt);
    // นับตรง = ไม่มีงานเตือนเพิ่ม
    expect(await prisma.todo.count({ where: { branchId, tags: { has: 'cash-close-variance' } } })).toBe(2);
  });

  it('ตีกลับได้เฉพาะการปิดยอดครั้งล่าสุด — ครั้งที่มีการปิดยอดใหม่ทับแล้วให้ยืนยันตามจริง', async () => {
    const pending = (await service.getStatus(users.owner, { branchId })).awaitingConfirm;
    expect(pending).toHaveLength(1);
    await tick();
    await tender(branchId, 'OUT', 'CASH', 500);
    const newer = await service.count(users.manager, { branchId, countedAmount: 1500 });
    expect(newer).toMatchObject({ cashIn: 0, cashOut: 500, expectedAmount: 1500, sendAmount: 0 }); // นับได้ต่ำกว่าเงินทอนตั้งต้น = ไม่มีเงินส่ง
    await expect(service.sendBack(users.owner, pending[0].id, { reason: 'ขอให้นับใหม่อีกครั้ง' })).rejects.toThrow('ตีกลับได้เฉพาะการปิดยอดครั้งล่าสุด');
  });

  it('ประวัติ + แถบเตือน: เงินขาดสะสมของเดือน (ไม่นับแถวที่ถูกตีกลับ) · สาขาที่เมื่อวานมีเงินสดแต่ยังไม่ปิดยอด · ผจก.ต่างสาขาดูไม่ได้', async () => {
    const yesterdayNoon = new Date(bkkDayRange(bangkokDateString()).start.getTime() - 12 * 60 * 60 * 1000); // 12:00 of yesterday, Bangkok time
    await tender(otherBranchId, 'IN', 'CASH', 8400, yesterdayNoon);

    const history = await service.getHistory(users.owner, {});
    const mine = history.rows.filter((row) => row.branchId === branchId);
    expect(mine.map((row) => row.status).sort()).toEqual(['CONFIRMED', 'PENDING_CONFIRM', 'PENDING_CONFIRM', 'SENT_BACK']);
    expect(history.alerts.monthShortage).toContainEqual({ branchId, branchName: `CASHCLOSE Branch ${RUN}`, count: 1, amount: 200 });
    expect(history.alerts.unclosedYesterday).toContainEqual(expect.objectContaining({ branchId: otherBranchId, cashIn: 8400 }));
    expect(history.alerts.unclosedYesterday.map((row) => row.branchId)).not.toContain(branchId);

    const scoped = await service.getHistory(users.manager, {});
    expect(scoped.branchId).toBe(branchId);
    expect(scoped.rows.every((row) => row.branchId === branchId)).toBe(true);
    await expect(service.getHistory(users.otherManager, { branchId })).rejects.toThrow('เฉพาะสาขาของตัวเอง');
    await expect(service.getHistory(users.sales, {})).rejects.toThrow('เฉพาะสาขาของตัวเอง');
  });

  it('กล่องเตือนของแดชบอร์ดใช้เงื่อนไขชุดเดียวกับแท็บประวัติ (สาขาไม่ปิดยอดเมื่อวาน · รอยืนยันรับเงินเกิน 1 วัน)', async () => {
    const dashboard = new DashboardOpsService(prisma as never);
    expect(await dashboard.computeAlerts(otherBranchId)).toContainEqual(
      expect.objectContaining({ type: 'cash_close_missed', count: 1, link: '/shop/daily-cash' }));
    expect((await dashboard.computeAlerts(branchId)).map((alert) => alert.type)).not.toContain('cash_close_awaiting');

    // ย้อนเวลาการนับที่ยังรอยืนยันไป 2 วัน = ไม่มีใครมารับเงินเกิน 1 วัน
    await prisma.shopCashClose.updateMany({ where: { branchId, status: 'PENDING_CONFIRM' }, data: { countedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) } });
    expect(await dashboard.computeAlerts(branchId)).toContainEqual(
      expect.objectContaining({ type: 'cash_close_awaiting', severity: 'critical', count: 2 }));
    expect((await service.getHistory(users.owner, { branchId })).alerts.awaitingOverOneDay).toHaveLength(2);
  });
});
