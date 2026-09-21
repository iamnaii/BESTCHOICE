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
import { ShopCashHoldingService } from '../../shop-tenders/shop-cash-holding.service';
import { ShopCashOverviewService } from '../../shop-tenders/shop-cash-overview.service';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';

const prisma = new PrismaClient();
// AuditLog ลบไม่ได้ (immutable trigger) ⇒ ถ้าเขียนจริง ผู้ใช้ของเทสจะลบไม่ออกเพราะ FK — payload ของ audit ปักที่ unit spec แทน
const journal = new JournalAutoService(prisma as never);
const companies = new CompanyResolverService(prisma as never);
const audit = { log: async () => undefined } as never;
/** ที่เก็บไฟล์ในหน่วยความจำ — พิสูจน์ว่ารูปสลิปถูกอัปโหลด/ลบ โดยไม่แตะ S3 */
const stored = new Map<string, Buffer>();
const storage = {
  upload: async (key: string, body: Buffer) => { stored.set(key, body); return key; },
  delete: async (key: string) => { stored.delete(key); },
  getStream: async () => { throw new Error('not used'); },
} as never;
const holdings = new ShopCashHoldingService(prisma as never, audit, storage, journal, companies);
const service = new ShopCashCloseService(prisma as never, audit, journal, companies, storage, holdings);
const overview = new ShopCashOverviewService(prisma as never, service, holdings);
/** JPEG ปลอม: byte แรกถูกต้อง พอให้ผ่านด่าน magic byte */
const slip = (mimetype = 'image/jpeg') => ({ mimetype, buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]) }) as never;

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const tick = () => new Promise((resolve) => setTimeout(resolve, 8));
/** บัญชีลิ้นชักของสาขาทดสอบ — เลือกตัวที่ไฟล์พี่น้องไม่ใช้เทียบยอด */
const DRAWER = 'S11-1102';

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
    await seedShopCoa(prisma as never); // JE ตอนยืนยันรับเงินต้องมีบัญชีลิ้นชัก/ปลายทาง/เงินขาด-เกินในผัง
    const shop = await prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'SHOP', deletedAt: null } });
    // JournalAutoService posts as the system user — shared with sibling specs, so never deleted here
    if (!(await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } }))) {
      await prisma.user.create({ data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' } });
    }
    const branch = await prisma.branch.create({ data: { name: `CASHCLOSE Branch ${RUN}`, shopCashFloat: 2000, companyId: shop.id, shopCashAccountCode: DRAWER } });
    const other = await prisma.branch.create({ data: { name: `CASHCLOSE Other ${RUN}` } });
    branchId = branch.id; otherBranchId = other.id;
    await seedUser('sales', 'SALES', branchId);
    await seedUser('manager', 'BRANCH_MANAGER', branchId);
    await seedUser('owner', 'OWNER', null);
    await seedUser('otherManager', 'BRANCH_MANAGER', otherBranchId);
  });

  afterAll(async () => {
    const branches = [branchId, otherBranchId].filter(Boolean);
    const entries = await prisma.journalEntry.findMany({ where: { AND: [
      { OR: [{ metadata: { path: ['flow'], equals: 'shop-cash-close' } }, { metadata: { path: ['flow'], equals: 'shop-cash-deposit' } }] },
      { OR: branches.map((id) => ({ metadata: { path: ['branchId'], equals: id } })) }] }, select: { id: true } });
    const entryIds = entries.map((entry) => entry.id);
    await prisma.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: entryIds } } });
    await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: entryIds } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
    await prisma.shopCashDeposit.deleteMany({ where: { branchId: { in: branches } } });
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
    // หน้าจอบอกว่าตอนนี้รอใคร / สาขายังขาดอะไร: ชื่อคนที่นับได้ของสาขา (ผจก.ก่อน แล้วพนักงานขาย) · สาขาที่ยังไม่ตั้งลิ้นชักเงินสด
    expect(status.readiness).toMatchObject({ hasDrawerAccount: true, floatAmount: 2000 });
    expect(status.readiness.counters.map((row) => [row.id, row.role])).toEqual([[users.manager.id, 'BRANCH_MANAGER'], [users.sales.id, 'SALES']]);
    const other = await service.getStatus(users.owner, { branchId: otherBranchId });
    expect(other.readiness).toMatchObject({ hasDrawerAccount: false, floatAmount: 0 });
    expect(other.readiness.counters.map((row) => row.id)).toEqual([users.otherManager.id]);
    expect(status.holdings).toEqual([]);
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
    // หลักฐานว่าเงินถึงบริษัท (เจ้าของเคาะ 2026-09-21): "เจ้าของเก็บไว้" = เจ้าของต้องยืนยันเอง · นำฝากธนาคาร = ต้องมีรูปสลิป + เลขอ้างอิง
    await expect(service.confirm(users.manager, firstCloseId, { receivedAmount: 10510, destination: 'OWNER_HOLD' })).rejects.toThrow('เฉพาะเมื่อเจ้าของเป็นผู้กดยืนยันรับเงินเอง');
    await expect(service.confirm(users.owner, firstCloseId, { receivedAmount: 10510, destination: 'BANK_DEPOSIT' })).rejects.toThrow('ต้องแนบรูปสลิปฝากเงินก่อนยืนยัน');
    await expect(service.attachDepositSlip(users.sales, firstCloseId, slip())).rejects.toThrow('ต้องไม่ใช่ผู้นับ');
    await expect(service.attachDepositSlip(users.owner, firstCloseId, { mimetype: 'image/jpeg', buffer: Buffer.from('not-an-image-at-all') } as never)).rejects.toThrow('ต้องเป็นไฟล์ JPEG, PNG หรือ WEBP');
    await service.attachDepositSlip(users.owner, firstCloseId, slip());
    await service.attachDepositSlip(users.owner, firstCloseId, slip()); // แนบใหม่ = แทนรูปเดิม ไม่ทิ้งไฟล์ค้าง
    expect([...stored.keys()].filter((key) => key.startsWith(`shop-cash-close/${firstCloseId}/`))).toHaveLength(1);
    await expect(service.confirm(users.owner, firstCloseId, { receivedAmount: 10510, destination: 'BANK_DEPOSIT', depositReference: '123' })).rejects.toThrow('กรอกเลขอ้างอิงในสลิปฝากเงิน');
    const confirmed = await service.confirm(users.owner, firstCloseId, { receivedAmount: 10500, destination: 'BANK_DEPOSIT', note: 'นับรับจริงขาดไป 10 บาท', depositReference: ' 2026092120521187 ' });
    expect(confirmed).toMatchObject({ status: 'CONFIRMED', receivedAmount: 10500, receiveVariance: -10, destination: 'BANK_DEPOSIT',
      depositReference: '2026092120521187', hasDepositSlip: true, moneyState: 'REACHED' });
    expect(confirmed.confirmedBy?.id).toBe(users.owner.id);
    // ลงบัญชีใบเดียวตอนยืนยัน (คำตัดสินเจ้าของ 2026-09-21): ลิ้นชักออก 200 (นับขาด) + 10,510 (ส่งเงิน) · ธนาคารเข้า 10,500 (รับจริง) ·
    // เงินขาด-เกินบัญชี 200 + 10 (หายระหว่างทาง) — บัญชีเดียว
    expect(confirmed.journalPosted).toBe(true);
    const je = await prisma.journalEntry.findFirstOrThrow({ where: { metadata: { path: ['shopCashCloseId'], equals: firstCloseId } }, include: { lines: true } });
    expect(je.status).toBe('POSTED');
    expect((je.metadata as Record<string, unknown>).flow).toBe('shop-cash-close');
    const line = (code: string) => je.lines.filter((row) => row.accountCode === code).map((row) => [Number(row.debit), Number(row.credit)]);
    expect(line(DRAWER)).toEqual([[0, 10710]]);
    expect(line('S11-1201')).toEqual([[10500, 0]]);
    expect(line('S53-1104')).toEqual([[210, 0]]);
    expect(je.lines).toHaveLength(3);
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
    // แถบเตือนบนหน้าขายใช้เงื่อนไขเดียวกัน — เตือนอย่างเดียว ไม่ล็อกการขาย
    expect(await overview.getReminder(users.otherManager, otherBranchId)).toMatchObject({ missed: { cashIn: 8400, expectedAmount: 8400 }, canCount: true });
    expect(await overview.getReminder(users.sales, branchId)).toMatchObject({ missed: null, canCount: true });
    await expect(overview.getReminder(users.sales, otherBranchId)).rejects.toThrow('เฉพาะสาขาของตัวเอง');

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

  it('นับเกิน + เจ้าของเก็บเงิน: ลิ้นชักสุทธิ = −ยอดส่ง + ยอดเกิน · เงินเกินเป็นฝั่งเครดิตของบัญชีเดียวกัน', async () => {
    await tick();
    await tender(branchId, 'IN', 'CASH', 300);
    // เทสก่อนหน้าย้อนเวลาการนับที่ค้างไว้ ขอบรอบจึงไม่ตายตัว — อ่านยอดที่ต้องมีจากระบบแล้วนับให้เกิน 50 พอดี
    const expected = (await service.getStatus(users.sales, { branchId })).round.expectedAmount!;
    const send = expected + 50 - 2000;
    const over = await service.count(users.sales, { branchId, countedAmount: expected + 50, varianceReason: 'ลูกค้าไม่รับเงินทอน 50' });
    expect(over).toMatchObject({ expectedAmount: expected, varianceAmount: 50, sendAmount: send });
    const confirmed = await service.confirm(users.owner, over.id, { receivedAmount: send, destination: 'OWNER_HOLD' });
    expect(confirmed.journalPosted).toBe(true);
    const je = await prisma.journalEntry.findFirstOrThrow({ where: { metadata: { path: ['shopCashCloseId'], equals: over.id } }, include: { lines: true } });
    const net = (code: string) => je.lines.filter((row) => row.accountCode === code).reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0);
    expect(net(DRAWER)).toBe(50 - send); // +50 (เกิน) − ยอดส่ง ⇒ ลิ้นชักในสมุดเหลือเท่าเงินทอนตั้งต้น
    expect(net('S11-1104')).toBe(send); // เจ้าของเก็บรักษา
    expect(net('S53-1104')).toBe(-50); // เงินเกิน = เครดิต
  });

  it('สาขาที่ยังไม่ตั้งบัญชีลิ้นชัก: ยืนยันรับเงินได้ตามปกติ แต่ไม่ลงบัญชี (ไม่บล็อกการรับเงิน)', async () => {
    const counted = await service.count(users.otherManager, { branchId: otherBranchId, countedAmount: 8400 });
    expect(counted).toMatchObject({ expectedAmount: 8400, varianceAmount: 0, sendAmount: 8400 });
    const confirmed = await service.confirm(users.owner, counted.id, { receivedAmount: 8400, destination: 'BRANCH_SAFE' });
    expect(confirmed).toMatchObject({ status: 'CONFIRMED', journalPosted: false, moneyState: 'AT_BRANCH' });
    expect(await prisma.journalEntry.count({ where: { metadata: { path: ['shopCashCloseId'], equals: counted.id } } })).toBe(0);
    // ต้นทางไม่เคยลงบัญชี ⇒ นำฝากได้ตามจริง แต่ไม่ลง JE (เครดิตตู้เซฟที่ไม่เคยถูกเดบิต = ยอดติดลบ)
    await expect(holdings.createDeposit(users.owner, { branchId: otherBranchId, source: 'BRANCH_SAFE', amount: 8400, reference: 'DEP-NOJE-0001' }, slip('image/png')))
      .rejects.toThrow('JPEG, PNG หรือ WEBP'); // mimetype ไม่ตรงกับ byte แรกของไฟล์
    const recorded = await holdings.createDeposit(users.owner, { branchId: otherBranchId, source: 'BRANCH_SAFE', amount: 8400, reference: 'DEP-NOJE-0001' }, slip());
    expect(recorded).toMatchObject({ amount: 8400, journalPosted: false });
    expect((await service.getStatus(users.owner, { branchId: otherBranchId })).closes[0]).toMatchObject({ id: counted.id, moneyState: 'REACHED' });
  });

  it('ตู้เซฟสาขา = ยังไม่ถึงบริษัท จนกว่าจะบันทึกนำฝาก · ฝากบางส่วนได้ · ห้ามฝากเกินยอดค้าง · ลงบัญชีย้ายเข้าธนาคารให้เอง', async () => {
    const pending = (await service.getStatus(users.owner, { branchId })).awaitingConfirm.find((row) => row.sendAmount === 1000)!;
    const safe = await service.confirm(users.owner, pending.id, { receivedAmount: 1000, destination: 'BRANCH_SAFE' });
    expect(safe).toMatchObject({ journalPosted: true, moneyState: 'AT_BRANCH', hasDepositSlip: false });

    const before = await holdings.getHoldings(users.owner, [branchId]);
    expect(before.find((row) => row.source === 'BRANCH_SAFE')).toMatchObject({ outstanding: 1000, closeCount: 1, reachedCompany: false, canDeposit: true });
    expect(before.find((row) => row.source === 'OWNER_HOLD')).toMatchObject({ reachedCompany: true, canDeposit: true });
    // ผจก.สาขา: ฝากเงินตู้เซฟของสาขาตัวเองได้ · เงินที่เจ้าของเก็บไว้ไม่ได้ · ผจก.ต่างสาขาไม่ได้
    const asManager = await holdings.getHoldings(users.manager, [branchId]);
    expect(asManager.find((row) => row.source === 'OWNER_HOLD')).toMatchObject({ canDeposit: false });
    await expect(holdings.createDeposit(users.manager, { branchId, source: 'OWNER_HOLD', amount: 10, reference: 'DEP-0000001' }, slip())).rejects.toThrow('เฉพาะเจ้าของหรือผู้จัดการการเงิน');
    await expect(holdings.createDeposit(users.otherManager, { branchId, source: 'BRANCH_SAFE', amount: 10, reference: 'DEP-0000001' }, slip())).rejects.toThrow('ผู้จัดการสาขาของสาขานั้น');
    await expect(holdings.createDeposit(users.manager, { branchId, source: 'BRANCH_SAFE', amount: 10, reference: 'DEP-0000001' }, undefined)).rejects.toThrow('กรุณาแนบรูปสลิปฝากเงิน');

    const part = await holdings.createDeposit(users.manager, { branchId, source: 'BRANCH_SAFE', amount: 400, reference: 'DEP-0000001' }, slip());
    expect(part).toMatchObject({ amount: 400, journalPosted: true, sourceLabel: 'ตู้เซฟสาขา' });
    const je = await prisma.journalEntry.findFirstOrThrow({ where: { metadata: { path: ['shopCashDepositId'], equals: part.id } }, include: { lines: true } });
    expect((je.metadata as Record<string, unknown>).flow).toBe('shop-cash-deposit');
    expect(je.lines.map((row) => [row.accountCode, Number(row.debit), Number(row.credit)]).sort()).toEqual([['S11-1105', 0, 400], ['S11-1201', 400, 0]]);
    expect((await holdings.settledCloseIds([branchId])).has(pending.id)).toBe(false); // ฝากยังไม่ครบ = ครั้งนั้นยังอยู่ที่สาขา

    const slipsBefore = stored.size;
    await expect(holdings.createDeposit(users.manager, { branchId, source: 'BRANCH_SAFE', amount: 700, reference: 'DEP-0000002' }, slip())).rejects.toThrow('เกินเงินที่ค้างในตู้เซฟสาขา (600.00)');
    expect(stored.size).toBe(slipsBefore); // ฝากไม่ผ่าน = ไม่ทิ้งรูปค้างในที่เก็บไฟล์
    await holdings.createDeposit(users.owner, { branchId, source: 'BRANCH_SAFE', amount: 600, reference: 'DEP-0000002' }, slip());
    expect((await holdings.getHoldings(users.owner, [branchId])).find((row) => row.source === 'BRANCH_SAFE')).toBeUndefined();
    expect((await holdings.settledCloseIds([branchId])).has(pending.id)).toBe(true);
    expect((await service.getHistory(users.owner, { branchId })).deposits.map((row) => row.amount).sort()).toEqual([400, 600]);
    await expect(holdings.createDeposit(users.owner, { branchId, source: 'BRANCH_SAFE', amount: 1, reference: 'DEP-0000003' }, slip())).rejects.toThrow('ไม่มีเงินค้างในตู้เซฟสาขา');
  });

  it('หน้าสถานะปิดยอดของเจ้าของ: หนึ่งแถวต่อสาขา + แถบ 14 วัน + เงินที่ยังไม่ได้นำฝาก · ผจก.สาขาเห็นเฉพาะสาขาตัวเอง', async () => {
    const all = await overview.getOverview(users.owner, {});
    const mine = all.rows.find((row) => row.branchId === branchId)!;
    // วันนี้: ปิดยอดสองครั้ง (ฝากธนาคาร + เจ้าของเก็บ) = ถึงบริษัทแล้ว · สองวันก่อน (การนับที่เทสก่อนหน้าย้อนเวลาไป): ครั้งหนึ่งนำฝากครบแล้ว
    // อีกครั้งยังรอยืนยัน ⇒ ครั้งที่แย่ที่สุดเป็นตัวแทนของวันนั้น
    expect(mine).toMatchObject({ state: 'REACHED', closeCount: 2, canConfirm: false });
    expect(mine.close).not.toBeNull();
    expect(all.strip.dates).toHaveLength(14);
    expect(all.strip.dates.at(-1)).toBe(all.today);
    const cells = all.strip.rows.find((row) => row.branchId === branchId)!.cells;
    expect(cells).toHaveLength(14);
    expect(cells.slice(-3)).toEqual(['AWAITING_CONFIRM', 'NO_CASH', 'REACHED']);
    const twoDaysAgo = await overview.getOverview(users.owner, { date: all.strip.dates.at(-3), branchId });
    expect(twoDaysAgo.rows).toHaveLength(1);
    expect(twoDaysAgo.rows[0]).toMatchObject({ state: 'AWAITING_CONFIRM', closeCount: 2, canConfirm: true });
    expect((await overview.getOverview(users.manager, { date: all.strip.dates.at(-3) })).rows[0].canConfirm).toBe(false); // ผจก.เป็นผู้นับครั้งนั้นเอง
    // สาขาอื่น: เมื่อวานมีเงินสดแต่ไปนับวันนี้ ⇒ ช่องเมื่อวานเป็น "มีเงินสดแต่ไม่ปิดยอด" ค้างเป็นประวัติ · วันนี้ถึงบริษัทแล้ว (นำฝากครบ)
    const otherCells = all.strip.rows.find((row) => row.branchId === otherBranchId)!.cells;
    expect(otherCells.slice(-2)).toEqual(['MISSED', 'REACHED']);
    expect(all.holdings.filter((row) => row.branchId === branchId).map((row) => row.source)).toEqual(['OWNER_HOLD']);

    const scoped = await overview.getOverview(users.manager, {});
    expect(scoped.rows.map((row) => row.branchId)).toEqual([branchId]);
    await expect(overview.getOverview(users.manager, { branchId: otherBranchId })).rejects.toThrow('เฉพาะสาขาของตัวเอง');
    await expect(overview.getOverview(users.sales, {})).rejects.toThrow('เฉพาะสาขาของตัวเอง');
  });
});
