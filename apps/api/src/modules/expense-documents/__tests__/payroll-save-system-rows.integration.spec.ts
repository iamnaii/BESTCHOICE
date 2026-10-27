import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Prisma, PrismaClient, type AttendanceDayKind, type EmploymentType, type UserRole } from '@prisma/client';
import { BadRequestException, ForbiddenException, HttpException } from '@nestjs/common';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { AuditService } from '../../audit/audit.service';
import { AttendanceSettingsService } from '../../attendance/attendance-settings.service';
import { dbDate } from '../../attendance/attendance-rules';
import { bangkokMidnight } from '../../../utils/date.util';
import { SsoConfigService } from '../../sso-config/sso-config.service';
import { TrashService } from '../../trash/trash.service';
import { ExpenseDocumentCreateService } from '../services/expense-document-create.service';
import { ExpenseDocumentQueryService } from '../services/expense-document-query.service';
import { LineAggregatorService } from '../services/line-aggregator.service';
import { StatusTransitionService } from '../services/status-transition.service';
import { PayrollCustomService } from '../services/payroll-custom.service';
import { PettyCashService } from '../services/petty-cash.service';
import { ExpenseTemplatesService } from '../expense-templates.service';
import { PayrollSystemRowsService } from '../payroll-system/payroll-system-rows.service';

/**
 * Payroll D4 ส่วนที่ 1 · Task 4 — ทางบันทึกใบเงินเดือนเป็นเจ้าของแถวระบบ (Postgres จริง · migrations อย่างเดียว ไม่มี seed)
 * สร้าง/แก้/สร้างจากแม่แบบ → server คิดแถว OT/ทำงานวันหยุดจากการลงเวลาให้ทุกบรรทัดที่ผูกพนักงาน (client ไม่ส่งแถวระบบ) ·
 * netPaid/netPayment รวม OT · totalAmount = ยอดก่อนหัก · OT กรอกเองซ้ำ = 400 · ผจก.สาขาใส่ได้เฉพาะพนักงานสาขาตัวเอง ·
 * แก้ใบรออนุมัติ/อนุมัติแล้ว = ส่งกลับเป็นร่าง · ลาออกวันสุดท้ายของงวดยังอยู่ได้ · กู้ใบเงินเดือนจากถังขยะไม่ได้ ·
 * meta คืนรหัสบัญชีของแถวลงเวลา
 * งวดที่ใช้เป็นงวดที่ผ่านเวลาปิดงวดแล้ว (ก.ย. 2569 — ปิด 1 ต.ค. 18:00) ⇒ ไม่มีคำเตือน "ยังไม่ถึงเวลาปิดงวด" ไม่ว่ารันวันไหน
 * รัน: bash tools/test-db-vitest.sh src/modules/expense-documents/__tests__/payroll-save-system-rows.integration.spec.ts
 */

const prisma = new PrismaClient();
const audit = new AuditService(prisma as never);
const payrollCustom = new PayrollCustomService(prisma as never);
const systemRows = new PayrollSystemRowsService(new AttendanceSettingsService(prisma as never));
const stamp = Date.now();
let seq = 0;
const docNumber = { next: async () => `PR-SAVE-${stamp}-${++seq}` } as never;
const creator = new ExpenseDocumentCreateService(
  prisma as never,
  docNumber,
  new LineAggregatorService(),
  new StatusTransitionService(),
  new SsoConfigService(prisma as never),
  payrollCustom,
  new PettyCashService(prisma as never),
  systemRows,
);
const query = new ExpenseDocumentQueryService(prisma as never, undefined as never);
const templates = new ExpenseTemplatesService(prisma as never, { createPayroll: (dto: never, user: never) => creator.createPayroll(dto, user) } as never);
const trash = new TrashService(prisma as never, audit, { get: () => undefined } as never);

const PERIOD = '2026-09';
const MONTH0 = 8;
const RATES = { ot: '93.7500', holiday: '62.5000', holidayOt: '187.5000' }; // 15,000 ÷ 240 × เท่า

const userIds: string[] = [];
const branchIds: string[] = [];
let ownerId: string;
let homeBranch: string;
const OWNER = () => ({ id: ownerId, branchId: null, role: 'OWNER' });

const bkkDay = (d: number) => bangkokMidnight(2026, MONTH0, d);
const at = (d: number, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(bkkDay(d).getTime() + (h * 60 + m) * 60_000);
};

async function mkBranch(tag: string) {
  const b = await prisma.branch.create({ data: { name: `สาขา SAVE-${tag} ${stamp}`, workStart: '10:00', workEnd: '19:00' }, select: { id: true } });
  branchIds.push(b.id);
  return b.id;
}

async function mkUser(
  tag: string,
  o: { role?: UserRole; branchId?: string | null; profile?: { employmentType: EmploymentType; baseSalary: number | null } | null; resignedDate?: Date } = {},
) {
  const user = await prisma.user.create({
    data: {
      email: `save-${tag}-${stamp}@test.local`,
      password: 'x',
      name: `พนักงาน ${tag}`,
      role: o.role ?? 'SALES',
      isActive: true,
      branchId: o.branchId === undefined ? homeBranch : o.branchId,
      attendancePinHash: `pin-${tag}-${stamp}`,
    },
  });
  userIds.push(user.id);
  const profile = o.profile === undefined ? { employmentType: 'MONTHLY' as const, baseSalary: 15000 } : o.profile;
  if (profile) {
    await prisma.employeeProfile.create({
      data: { userId: user.id, employmentType: profile.employmentType, baseSalary: profile.baseSalary, resignedDate: o.resignedDate ?? null },
    });
  }
  return user.id;
}

async function mkDay(
  userId: string,
  d: number,
  o: { kind?: AttendanceDayKind; in?: string; out?: string; ot?: number; late?: number; flags?: string[]; deleted?: boolean; branchId?: string } = {},
) {
  return prisma.attendanceDay.create({
    data: {
      userId,
      branchId: o.branchId ?? homeBranch,
      workDate: dbDate(bkkDay(d)),
      dayKind: o.kind ?? 'WORK',
      clockIn: o.in ? at(d, o.in) : null,
      clockOut: o.out ? at(d, o.out) : null,
      otHours: o.ot ?? 0,
      lateMinutes: o.late ?? 0,
      flags: o.flags ?? [],
      deletedAt: o.deleted ? new Date() : null,
    },
  });
}

/** วันทำงานที่มี OT (เก็บไว้ตอนตอก) — ชั่วโมง OT วันทำงานรวมจากค่านี้ */
const otDay = (userId: string, d: number, ot: number) => mkDay(userId, d, { in: '10:00', out: '20:30', ot });

const dto = (branchId: string, lines: unknown[], extra: Record<string, unknown> = {}) => ({
  branchId,
  documentDate: '2026-09-30',
  payrollPeriod: PERIOD,
  entityScope: 'SHOP',
  depositAccountCode: 'S11-1202',
  lines,
  ...extra,
});
const updateDto = (lines: unknown[]) => {
  const rest: Record<string, unknown> = dto('-', lines);
  delete rest.branchId; // UpdatePayrollDto ไม่มี branchId (ย้ายสาขาด้วยการแก้ไขไม่ได้)
  return rest;
};

/** เงินเทียบเป็น Decimal.toFixed(2) เสมอ (global constraint) */
const money = (v: Prisma.Decimal | string | number | null | undefined) => (v == null ? null : new Prisma.Decimal(v.toString()).toFixed(2));
const fixed = (v: unknown, dp: number) => (v == null ? null : new Prisma.Decimal(String(v)).toFixed(dp));

type Income = { source: string; accountCode: string; name: string; amount: Prisma.Decimal; quantity: unknown; rate: unknown; multiplier: unknown; isTaxable: boolean };
type IncomeView = { source: string; accountCode: string; name: string; amount: string; quantity: string | null; rate: string | null; multiplier: string | null; isTaxable: boolean };
/** ลำดับแถวรายได้ในบรรทัดเดียวไม่ใช่สัญญา (createdAt เท่ากันใน tx เดียว) — เรียงตาม source+name ก่อนเทียบ */
const sorted = (rows: IncomeView[]) => [...rows].sort((a, b) => `${a.source}|${a.name}`.localeCompare(`${b.source}|${b.name}`));
const incomeView = (rows: Income[]): IncomeView[] =>
  sorted(
    rows.map((r) => ({
      source: r.source,
      accountCode: r.accountCode,
      name: r.name,
      amount: money(r.amount)!,
      quantity: fixed(r.quantity, 1),
      rate: fixed(r.rate, 4),
      multiplier: fixed(r.multiplier, 1),
      isTaxable: r.isTaxable,
    })),
  );
const manualRow = (source: 'MANUAL' | 'ADJUSTMENT', accountCode: string, name: string, amount: string): IncomeView => ({
  source, accountCode, name, amount, quantity: null, rate: null, multiplier: null, isTaxable: true,
});
const sys = (source: string, name: string, quantity: string, rate: string, multiplier: string, amount: string): IncomeView => ({
  source, accountCode: 'S52-1202', name, amount, quantity, rate, multiplier, isTaxable: true,
});
const otRow = (h: string, amount: string) => sys('ATTENDANCE_OT', 'OT วันทำงาน (1.5 เท่า)', h, RATES.ot, '1.5', amount);
const holidayRow = (h: string, amount: string) => sys('ATTENDANCE_HOLIDAY', 'ทำงานวันหยุด (1 เท่า)', h, RATES.holiday, '1.0', amount);
const holidayOtRow = (h: string, amount: string) => sys('ATTENDANCE_HOLIDAY_OT', 'OT วันหยุด (3 เท่า)', h, RATES.holidayOt, '3.0', amount);

async function expectHttp(p: Promise<unknown>, ctor: new (...args: never[]) => HttpException, code: string | null, message: string | RegExp) {
  const err = await p.then(
    () => { throw new Error('expected the call to be rejected'); },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ctor);
  const body = (err as HttpException).getResponse() as { code?: string; message?: string } | string;
  const msg = typeof body === 'string' ? body : body.message;
  if (code) expect(typeof body === 'string' ? undefined : body.code).toBe(code);
  if (typeof message === 'string') expect(msg).toBe(message);
  else expect(msg).toMatch(message);
}

const docIdsOf = async () =>
  (await prisma.expenseDocument.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((d) => d.id);

beforeAll(async () => {
  await seedFinanceCoa(prisma);
  await seedShopCoa(prisma);
  ownerId = (await prisma.user.create({ data: { email: `save-owner-${stamp}@test.local`, password: 'x', name: 'เจ้าของ SAVE', role: 'OWNER', isActive: true } })).id;
  userIds.push(ownerId);
  homeBranch = await mkBranch('home');
}, 120_000);

afterAll(async () => {
  const ids = await docIdsOf();
  if (ids.length > 0) {
    await prisma.expenseDocument.deleteMany({ where: { id: { in: ids } } }); // cascade → details → lines → rows
  }
  await prisma.expenseTemplate.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.attendanceDay.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.employeeProfile.deleteMany({ where: { userId: { in: userIds } } });
  // เจ้าของถือแถว AuditLog (SENT_BACK_TO_DRAFT — ตาราง audit ลบไม่ได้) ⇒ คงไว้ในฐานชั่วคราว
  await prisma.user.deleteMany({ where: { id: { in: userIds.filter((id) => id !== ownerId) } } });
  await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
  await prisma.$disconnect();
}, 120_000);

describe('Payroll save path owns attendance system rows (Postgres)', () => {
  it('create: linked line gets the Task 3 (a) rows + notes + systemPulledAt without any client flag · netPaid/netPayment include OT · free-text line gets none · totalAmount = gross', async () => {
    const branchId = await mkBranch('create');
    const u = await mkUser('a');
    await mkDay(u, 1, { in: '10:00', out: '20:30', ot: 1.5 });
    await mkDay(u, 2, { in: '10:20', out: '20:30', ot: 1.5, late: 20 });
    await mkDay(u, 3); // WORK ไม่มีตอก = ขาด
    await mkDay(u, 4, { kind: 'DAY_OFF', in: '10:00', out: '21:00', ot: 0 });
    await mkDay(u, 5, { in: '10:00', out: '20:30', ot: 1.5 });
    await mkDay(u, 6, { in: '10:00', out: '20:30', ot: 1.5 });
    await mkDay(u, 7, { in: '10:00', out: '19:30', ot: 0.5 });
    await mkDay(u, 8, { kind: 'LEAVE_SICK' });
    await mkDay(u, 9, { in: '10:00', out: '22:00', ot: 3, deleted: true });
    const flagged = await mkDay(u, 10, { in: '10:00', out: '19:00', ot: 0, flags: ['CORRECTED'] });

    const before = Date.now();
    const doc = await creator.createPayroll(
      dto(branchId, [
        { userId: u, baseSalary: 15000, ssoEmployee: 750 },
        { employeeName: 'ลูกจ้าง ไม่ผูกทะเบียน', baseSalary: 9000 },
      ]) as never,
      OWNER(),
    );
    const after = Date.now();

    const [linked, free] = doc.payroll!.lines;
    expect(incomeView(linked.customIncome as never)).toEqual(sorted([otRow('6.5', '609.38'), holidayRow('8.0', '500.00'), holidayOtRow('2.0', '375.00')]));
    expect(money(linked.netPaid)).toBe('15734.38'); // 15,000 + 1,484.38 − 750
    expect(linked.lineNo).toBe(1);
    expect(linked.systemPulledAt).not.toBeNull();
    expect(linked.systemPulledAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(linked.systemPulledAt!.getTime()).toBeLessThanOrEqual(after);
    const expected = await systemRows.compute(prisma as never, { branchId, entityScope: 'SHOP', payrollPeriod: PERIOD, userIds: [u], excludeDocumentId: doc.id, now: new Date() });
    expect(linked.attendanceSummary).toEqual(expected.rows[0].attendanceSummary);
    expect(linked.attendanceSummary).toMatchObject({ otHours: '6.5', holidayHours: '8.0', holidayOtHours: '2.0', autoOtEligible: true, reviewCount: 1 });
    expect(linked.systemNotes).toEqual({
      review: [{ dayId: flagged.id, date: '2026-09-10', branchId: homeBranch, flags: ['CORRECTED'], blocking: false }],
      warnings: [],
    });

    expect(free.customIncome).toEqual([]);
    expect(money(free.netPaid)).toBe('9000.00');
    expect(free.lineNo).toBe(2);
    expect(free.systemPulledAt).toBeNull();
    expect(free.attendanceSummary).toBeNull();
    expect(free.systemNotes).toBeNull();

    expect(money(doc.subtotal)).toBe('24000.00');
    expect(money(doc.totalAmount)).toBe('25484.38'); // ฐาน + รายได้พิเศษทั้งหมด (ก่อนหัก)
    expect(money(doc.netPayment)).toBe('24734.38');

    // ที่เก็บจริงในฐานข้อมูล (findOne) ตรงกับที่คืน
    const stored = await query.findOne(doc.id, 'OWNER', null);
    const storedLines = (stored as unknown as { payroll: { lines: Array<{ employeeName: string; customIncome: Income[] }> } }).payroll.lines;
    expect(storedLines.map((l) => l.employeeName)).toEqual(['พนักงาน a', 'ลูกจ้าง ไม่ผูกทะเบียน']);
    expect(incomeView(storedLines[0].customIncome)).toEqual(incomeView(linked.customIncome as never));
  });

  it('manual OT on an eligible line → 400 MANUAL_OT_DUPLICATE · same row ticked isAdjustment → accepted as ADJUSTMENT · on a DAILY line → accepted as MANUAL', async () => {
    const u = await mkUser('dup');
    await otDay(u, 1, 1.5);
    const daily = await mkUser('daily', { profile: { employmentType: 'DAILY', baseSalary: null } });
    await otDay(daily, 1, 1.5);
    const manualOt = { accountCode: 'S52-1202', name: 'OT เดือนก่อน', amount: 500 };

    const b1 = await mkBranch('dup');
    await expectHttp(
      creator.createPayroll(dto(b1, [{ userId: u, baseSalary: 15000, customIncome: [manualOt] }]) as never, OWNER()),
      BadRequestException,
      'MANUAL_OT_DUPLICATE',
      'พนักงาน dup มีแถว OT ที่กรอกเองซ้ำกับ OT จากระบบลงเวลา — ลบแถวนั้น หรือติ๊ก "รายการปรับปรุงงวดก่อน" ถ้าเป็นการแก้ OT ของเดือนก่อน',
    );
    expect(await prisma.expenseDocument.count({ where: { branchId: b1 } })).toBe(0);

    const adj = await creator.createPayroll(dto(b1, [{ userId: u, baseSalary: 15000, customIncome: [{ ...manualOt, isAdjustment: true }] }]) as never, OWNER());
    const adjLine = adj.payroll!.lines[0];
    expect(incomeView(adjLine.customIncome as never)).toEqual(sorted([manualRow('ADJUSTMENT', 'S52-1202', 'OT เดือนก่อน', '500.00'), otRow('1.5', '140.63')]));
    expect(money(adjLine.netPaid)).toBe('15640.63');

    const b2 = await mkBranch('daily');
    const d = await creator.createPayroll(dto(b2, [{ userId: daily, baseSalary: 12000, customIncome: [manualOt] }]) as never, OWNER());
    const dLine = d.payroll!.lines[0];
    expect(incomeView(dLine.customIncome as never)).toEqual([manualRow('MANUAL', 'S52-1202', 'OT เดือนก่อน', '500.00')]);
    expect(dLine.attendanceSummary).toMatchObject({ autoOtEligible: false, otHours: '1.5' });
    expect(dLine.systemNotes).toEqual({ review: [], warnings: [{ code: 'NOT_MONTHLY_OR_NO_BASE', otHours: '1.5' }] });
  });

  it('V18 runs on the merged line: base 9,000 + system OT 1,996.88 covers a 10,000 deduction · 11,000 still rejected', async () => {
    const u = await mkUser('v18', { profile: { employmentType: 'MONTHLY', baseSalary: 9000 } });
    for (let d = 1; d <= 10; d++) await otDay(u, d, 3.5);
    await otDay(u, 11, 0.5); // รวม 35.5 ชม. × 9,000 × 1.5 ÷ 240 = 1,996.875 → 1,996.88
    const deduction = (amount: number) => [{ accountCode: 'S21-1103', name: 'หักคืนเงินยืม', amount }];

    const b = await mkBranch('v18');
    // เกินแม้รวม OT แล้ว → ยังปฏิเสธ (ไม่มีใบเกิดขึ้น ⇒ ไม่มีใบอื่นถือ OT ของคนนี้ก่อนเคสถัดไป)
    await expectHttp(
      creator.createPayroll(dto(b, [{ userId: u, baseSalary: 9000, customDeduction: deduction(11000) }]) as never, OWNER()),
      BadRequestException,
      null,
      /^V18: ผลรวมรายการหัก \(11000\.00 ฿\) ของพนักงาน "พนักงาน v18" เกินรายได้รวมก่อนหัก \(10996\.88 ฿/,
    );
    const ok = await creator.createPayroll(dto(b, [{ userId: u, baseSalary: 9000, customDeduction: deduction(10000) }]) as never, OWNER());
    const line = ok.payroll!.lines[0];
    expect(incomeView(line.customIncome as never)).toEqual([sys('ATTENDANCE_OT', 'OT วันทำงาน (1.5 เท่า)', '35.5', '56.2500', '1.5', '1996.88')]);
    expect(money(line.netPaid)).toBe('996.88');
    expect(money(ok.netPayment)).toBe('996.88');
    expect(money(ok.totalAmount)).toBe('10996.88');
  });

  it('update replaces the system rows (recomputed from current attendance) and keeps manual rows as sent', async () => {
    const u = await mkUser('upd');
    await otDay(u, 1, 1.5);
    const b = await mkBranch('upd');
    const bonus = { accountCode: 'S52-1204', name: 'โบนัส', amount: 1000 };
    const doc = await creator.createPayroll(dto(b, [{ userId: u, baseSalary: 15000, customIncome: [bonus] }]) as never, OWNER());
    expect(incomeView(doc.payroll!.lines[0].customIncome as never)).toEqual(sorted([manualRow('MANUAL', 'S52-1204', 'โบนัส', '1000.00'), otRow('1.5', '140.63')]));

    await otDay(u, 2, 2); // ผู้จัดการแก้เวลา/ตอกเพิ่มหลังบันทึก
    const updated = await creator.updatePayroll(doc.id, updateDto([{ userId: u, baseSalary: 15000, customIncome: [bonus] }]) as never, OWNER());
    const line = updated.payroll!.lines[0];
    expect(incomeView(line.customIncome as never)).toEqual(sorted([manualRow('MANUAL', 'S52-1204', 'โบนัส', '1000.00'), otRow('3.5', '328.13')]));
    expect(money(line.netPaid)).toBe('16328.13');
    expect(money(updated.netPayment)).toBe('16328.13');
    expect(money(updated.totalAmount)).toBe('16328.13');
    expect(await prisma.payrollCustomIncome.count({ where: { payrollLine: { payroll: { documentId: doc.id } }, source: 'ATTENDANCE_OT' } })).toBe(1);
  });

  it('lines come back in payload order (create response and findOne)', async () => {
    const u = await mkUser('order');
    const b = await mkBranch('order');
    const doc = await creator.createPayroll(
      dto(b, [
        { employeeName: 'ฮ คนสุดท้ายตามตัวอักษร', baseSalary: 5000 },
        { userId: u, baseSalary: 15000 },
        { employeeName: 'ก คนแรกตามตัวอักษร', baseSalary: 6000 },
      ]) as never,
      OWNER(),
    );
    const order = ['ฮ คนสุดท้ายตามตัวอักษร', 'พนักงาน order', 'ก คนแรกตามตัวอักษร'];
    expect(doc.payroll!.lines.map((l) => [l.lineNo, l.employeeName])).toEqual(order.map((n, i) => [i + 1, n]));
    const stored = (await query.findOne(doc.id, 'OWNER', null)) as unknown as { payroll: { lines: Array<{ employeeName: string }> } };
    expect(stored.payroll.lines.map((l) => l.employeeName)).toEqual(order);
  });

  it('a branch manager cannot put another branch\'s employee on the payroll → 403 NOT_IN_BRANCH · own-branch employee is fine', async () => {
    const b = await mkBranch('bm');
    const other = await mkBranch('bm-other');
    const bm = await mkUser('bm-actor', { role: 'BRANCH_MANAGER', branchId: b, profile: null });
    const outsider = await mkUser('outsider', { branchId: other });
    const insider = await mkUser('insider', { branchId: b });
    const bmUser = { id: bm, branchId: b, role: 'BRANCH_MANAGER' };

    await expectHttp(
      creator.createPayroll(dto(b, [{ userId: insider, baseSalary: 15000 }, { userId: outsider, baseSalary: 15000 }]) as never, bmUser),
      ForbiddenException,
      'NOT_IN_BRANCH',
      'พนักงาน outsider ไม่ใช่พนักงานของสาขานี้ — ให้เจ้าของหรือฝ่ายบัญชีทำใบเงินเดือนนี้',
    );
    const ok = await creator.createPayroll(dto(b, [{ userId: insider, baseSalary: 15000 }]) as never, bmUser);
    expect(ok.payroll!.lines).toHaveLength(1);
    // แก้ใบเดิมแล้วเพิ่มคนนอกสาขา — ด่านเดียวกัน
    await expectHttp(
      creator.updatePayroll(ok.id, updateDto([{ userId: insider, baseSalary: 15000 }, { userId: outsider, baseSalary: 15000 }]) as never, bmUser),
      ForbiddenException,
      'NOT_IN_BRANCH',
      /^พนักงาน outsider ไม่ใช่พนักงานของสาขานี้/,
    );
  });

  it('editing a PENDING_APPROVAL / APPROVED payroll sends it back to DRAFT (approvedById cleared) with a SENT_BACK_TO_DRAFT audit row · POSTED still refused', async () => {
    const u = await mkUser('sendback');
    const lines = [{ userId: u, baseSalary: 15000 }];
    for (const from of ['PENDING_APPROVAL', 'APPROVED'] as const) {
      const b = await mkBranch(`sendback-${from}`);
      const doc = await creator.createPayroll(dto(b, lines) as never, OWNER());
      await prisma.expenseDocument.update({ where: { id: doc.id }, data: { status: from, approvedById: from === 'APPROVED' ? ownerId : null } });

      const updated = await creator.updatePayroll(doc.id, updateDto(lines) as never, OWNER());
      expect(updated.status).toBe('DRAFT');
      expect(updated.approvedById).toBeNull();
      const row = await prisma.auditLog.findFirst({ where: { action: 'SENT_BACK_TO_DRAFT', entityId: doc.id } });
      expect(row).toMatchObject({ entity: 'expense_document', userId: ownerId, oldValue: { status: from }, newValue: { status: 'DRAFT', documentNumber: doc.number } });
    }

    const b = await mkBranch('sendback-posted');
    const posted = await creator.createPayroll(dto(b, lines) as never, OWNER());
    await prisma.expenseDocument.update({ where: { id: posted.id }, data: { status: 'POSTED' } });
    await expect(creator.updatePayroll(posted.id, updateDto(lines) as never, OWNER())).rejects.toThrow(BadRequestException);
    expect(await prisma.auditLog.count({ where: { action: 'SENT_BACK_TO_DRAFT', entityId: posted.id } })).toBe(0);
  });

  it('an employee who resigned on the last day of the period stays payable · resigned before the period start is rejected', async () => {
    const lastDay = await mkUser('resign-last', { resignedDate: new Date('2026-09-30') });
    const before = await mkUser('resign-before', { resignedDate: new Date('2026-08-31') });
    const b = await mkBranch('resign');
    const ok = await creator.createPayroll(dto(b, [{ userId: lastDay, baseSalary: 15000 }]) as never, OWNER());
    expect(ok.payroll!.lines[0].userId).toBe(lastDay);

    const b2 = await mkBranch('resign-2');
    await expectHttp(
      creator.createPayroll(dto(b2, [{ userId: before, baseSalary: 15000 }]) as never, OWNER()),
      BadRequestException,
      null,
      /ไม่อยู่ในทะเบียนพนักงาน หรือลาออก/,
    );
  });

  it('a payroll instantiated from a template gets the system rows too', async () => {
    const u = await mkUser('tpl');
    await otDay(u, 3, 1.5);
    const b = await mkBranch('tpl');
    const tpl = await prisma.expenseTemplate.create({
      data: {
        name: `เงินเดือนประจำ ${stamp}`,
        documentType: 'PAYROLL',
        branchId: b,
        createdById: ownerId,
        prefilledData: { entityScope: 'SHOP', depositAccountCode: 'S11-1202', lines: [{ userId: u, baseSalary: 15000 }] },
      },
    });
    const doc = (await templates.instantiate(tpl.id, OWNER(), { documentDate: new Date('2026-09-15T05:00:00.000Z') })) as Awaited<ReturnType<typeof creator.createPayroll>>;
    expect(doc.payroll!.payrollPeriod).toBe(PERIOD);
    expect(incomeView(doc.payroll!.lines[0].customIncome as never)).toEqual([otRow('1.5', '140.63')]);
    expect(doc.payroll!.lines[0].systemPulledAt).not.toBeNull();
  });

  it('a soft-deleted PAYROLL cannot be restored from the trash bin', async () => {
    const b = await mkBranch('trash');
    const doc = await creator.createPayroll(dto(b, [{ employeeName: 'ลูกจ้าง ถังขยะ', baseSalary: 5000 }]) as never, OWNER());
    await prisma.expenseDocument.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });
    await expectHttp(
      trash.restore('expense_document', doc.id, { id: ownerId }),
      BadRequestException,
      null,
      'กู้คืนใบเงินเดือนไม่ได้ — ให้สร้างใบใหม่ที่หน้ารายจ่าย › สร้างเอกสารใหม่ › เงินเดือน (PR)',
    );
    expect((await prisma.expenseDocument.findUniqueOrThrow({ where: { id: doc.id } })).deletedAt).not.toBeNull();
  });

  it('GET payroll/meta returns the attendance account codes read from account_role_map', async () => {
    expect((await creator.getPayrollMeta('SHOP')).attendanceAccountCodes).toEqual(['S52-1202']);
    expect((await creator.getPayrollMeta('FINANCE')).attendanceAccountCodes).toEqual(['53-1103']);
  });
});
