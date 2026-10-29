import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, type AttendanceDayKind, type EmploymentType } from '@prisma/client';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { AuditService } from '../../audit/audit.service';
import { AccountRoleService } from '../../journal/account-role.service';
import { AttendanceSettingsService } from '../../attendance/attendance-settings.service';
import { dbDate } from '../../attendance/attendance-rules';
import { bangkokMidnight } from '../../../utils/date.util';
import { PayrollSystemRowsService } from '../payroll-system/payroll-system-rows.service';
import { resolveRoleCodes } from '../payroll-system/role-codes';
import type { SystemRowsQuery } from '../payroll-system/payroll-system.types';

/**
 * Payroll D4 ส่วนที่ 1 · Task 3 — `PayrollSystemRowsService.compute` บน Postgres จริง (migrations อย่างเดียว ไม่มี seed)
 * แถว OT / ทำงานวันหยุด / OT วันหยุด จากตารางลงเวลา · รวมทุกสาขาตาม userId · กติกาเวลางานรายสาขา ·
 * ใบอื่นถือแถวลงเวลาแล้ว · ไม่เข้าเกณฑ์ · วันที่ต้องตรวจ · ก่อนเวลาปิดงวด · role → บัญชีอ่านจาก DB ไม่ผ่าน cache
 * รัน: bash tools/test-db-vitest.sh src/modules/expense-documents/__tests__/payroll-system-rows.integration.spec.ts
 */

const prisma = new PrismaClient();
const audit = new AuditService(prisma as never);
const roles = new AccountRoleService(prisma as never, audit);
const settings = new AttendanceSettingsService(prisma as never);
const service = new PayrollSystemRowsService(settings);

const stamp = Date.now();
const PERIOD = '2026-10';
const AFTER_CUTOFF = new Date('2026-11-02T03:00:00.000Z');
const CUTOFF_ISO = '2026-11-01T11:00:00.000Z'; // 18:00 เวลาไทย วันที่ 1 พ.ย.
const RATES = { ot: '93.7500', holiday: '62.5000', holidayOt: '187.5000' }; // เงินเดือน 15,000 ÷ 240 × เท่า

const userIds: string[] = [];
const docIds: string[] = [];
let ownerId: string;
let branch1: { id: string; name: string };
let branch2: { id: string; name: string };

const bkkDay = (d: number, month0 = 9) => bangkokMidnight(2026, month0, d);
const at = (d: number, hhmm: string, month0 = 9) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(bkkDay(d, month0).getTime() + (h * 60 + m) * 60_000);
};

async function mkUser(tag: string, opts: { pin?: boolean; profile?: { employmentType: EmploymentType; baseSalary: number | null } | null } = {}) {
  const user = await prisma.user.create({
    data: {
      email: `prs-${tag}-${stamp}@test.local`,
      password: 'x',
      name: `พนักงาน ${tag}`,
      role: 'SALES',
      isActive: true,
      branchId: branch1.id,
      attendancePinHash: opts.pin === false ? null : `pin-${tag}-${stamp}`,
    },
  });
  userIds.push(user.id);
  const profile = opts.profile === undefined ? { employmentType: 'MONTHLY' as const, baseSalary: 15000 } : opts.profile;
  if (profile) await prisma.employeeProfile.create({ data: { userId: user.id, employmentType: profile.employmentType, baseSalary: profile.baseSalary } });
  return user.id;
}

async function mkDay(
  userId: string,
  branchId: string,
  d: number,
  o: { kind?: AttendanceDayKind; in?: string; out?: string; ot?: number; late?: number; flags?: string[]; month0?: number; deleted?: boolean } = {},
) {
  const month0 = o.month0 ?? 9;
  return prisma.attendanceDay.create({
    data: {
      userId,
      branchId,
      workDate: dbDate(bkkDay(d, month0)),
      dayKind: o.kind ?? 'WORK',
      clockIn: o.in ? at(d, o.in, month0) : null,
      clockOut: o.out ? at(d, o.out, month0) : null,
      otHours: o.ot ?? 0,
      lateMinutes: o.late ?? 0,
      flags: o.flags ?? [],
      deletedAt: o.deleted ? new Date() : null,
    },
  });
}

const query = (ids: string[], extra: Partial<SystemRowsQuery> = {}): SystemRowsQuery => ({
  branchId: branch1.id,
  entityScope: 'SHOP',
  payrollPeriod: PERIOD,
  userIds: ids,
  now: AFTER_CUTOFF,
  ...extra,
});
const computeOne = async (userId: string, extra: Partial<SystemRowsQuery> = {}) => {
  const res = await service.compute(prisma as never, query([userId], extra));
  expect(res.rows).toHaveLength(1);
  return res.rows[0];
};
const otRow = (hours: string, amount: string, accountCode = 'S52-1202') => ({
  source: 'ATTENDANCE_OT', accountCode, name: 'OT วันทำงาน (1.5 เท่า)', quantity: hours, rate: RATES.ot, multiplier: '1.5', amount, isTaxable: true,
});
const holidayRow = (hours: string, amount: string, accountCode = 'S52-1202') => ({
  source: 'ATTENDANCE_HOLIDAY', accountCode, name: 'ทำงานวันหยุด (1 เท่า)', quantity: hours, rate: RATES.holiday, multiplier: '1.0', amount, isTaxable: true,
});
const holidayOtRow = (hours: string, amount: string, accountCode = 'S52-1202') => ({
  source: 'ATTENDANCE_HOLIDAY_OT', accountCode, name: 'OT วันหยุด (3 เท่า)', quantity: hours, rate: RATES.holidayOt, multiplier: '3.0', amount, isTaxable: true,
});

async function mkPayrollDoc(tag: string, userId: string, o: { branchId: string; period?: string; source?: 'ATTENDANCE_OT' | 'MANUAL' }) {
  const doc = await prisma.expenseDocument.create({
    data: {
      number: `PR-PRS-${tag}-${stamp}`,
      documentType: 'PAYROLL',
      branchId: o.branchId,
      documentDate: new Date('2026-10-31T00:00:00.000Z'),
      subtotal: 15000,
      totalAmount: 15140.63,
      netPayment: 15140.63,
      status: 'DRAFT',
      createdById: ownerId,
      payroll: {
        create: {
          payrollPeriod: o.period ?? PERIOD,
          entityScope: 'SHOP',
          lines: {
            create: [
              {
                userId,
                employeeName: `พนักงาน ${tag}`,
                baseSalary: 15000,
                netPaid: 15140.63,
                customIncome: {
                  create: [
                    o.source === 'MANUAL'
                      ? { accountCode: 'S52-1204', name: 'โบนัส', amount: 140.63, source: 'MANUAL' }
                      : { accountCode: 'S52-1202', name: 'OT วันทำงาน (1.5 เท่า)', amount: 140.63, source: 'ATTENDANCE_OT', quantity: 1.5, rate: 93.75, multiplier: 1.5 },
                  ],
                },
              },
            ],
          },
        },
      },
    },
  });
  docIds.push(doc.id);
  return doc;
}

beforeAll(async () => {
  await seedFinanceCoa(prisma);
  await seedShopCoa(prisma);
  await roles.onModuleInit();
  ownerId = (await prisma.user.create({ data: { email: `prs-owner-${stamp}@test.local`, password: 'x', name: 'เจ้าของ PRS', role: 'OWNER', isActive: true } })).id;
  userIds.push(ownerId);
  // ตั้งเวลางานรายสาขาไว้ชัด ⇒ ไม่ขึ้นกับ SystemConfig ที่ spec อื่นในชุด CI อาจตั้งไว้
  branch1 = await prisma.branch.create({ data: { name: `สาขา PRS-1 ${stamp}`, workStart: '10:00', workEnd: '19:00' }, select: { id: true, name: true } });
  branch2 = await prisma.branch.create({ data: { name: `สาขา PRS-2 ${stamp}`, workStart: '10:00', workEnd: '20:00' }, select: { id: true, name: true } });
}, 120_000);

afterAll(async () => {
  if (docIds.length > 0) await prisma.expenseDocument.deleteMany({ where: { id: { in: docIds } } }); // cascade → payroll_details → lines → income
  await prisma.attendanceDay.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.employeeProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where: { id: { in: [branch1?.id, branch2?.id].filter(Boolean) } } });
  await prisma.$disconnect();
}, 120_000);

describe('PayrollSystemRowsService.compute (Postgres)', () => {
  it('(a) salary 15,000: weekday OT 6.5 h rounded once = 609.38 · DAY_OFF 10:00–21:00 = holiday 8 h 500.00 + holiday OT 2 h 375.00 · period bounds and soft-deleted days respected · summary snapshot', async () => {
    const u = await mkUser('a');
    await mkDay(u, branch1.id, 1, { in: '10:00', out: '20:30', ot: 1.5 });
    await mkDay(u, branch1.id, 2, { in: '10:20', out: '20:30', ot: 1.5, late: 20 });
    await mkDay(u, branch1.id, 3); // WORK ไม่มีตอก = ขาด
    await mkDay(u, branch1.id, 4, { kind: 'DAY_OFF', in: '10:00', out: '21:00', ot: 0 }); // OT วันหยุดคิดใหม่จากกติกา ไม่ใช้ค่าที่เก็บ
    await mkDay(u, branch1.id, 5, { in: '10:00', out: '20:30', ot: 1.5 });
    await mkDay(u, branch1.id, 6, { in: '10:00', out: '20:30', ot: 1.5 });
    await mkDay(u, branch1.id, 7, { in: '10:00', out: '19:30', ot: 0.5 });
    await mkDay(u, branch1.id, 8, { kind: 'LEAVE_SICK' });
    await mkDay(u, branch1.id, 9, { in: '10:00', out: '22:00', ot: 3, deleted: true });
    await mkDay(u, branch1.id, 30, { in: '10:00', out: '22:00', ot: 3, month0: 8 }); // 30 ก.ย. — นอกงวด
    await mkDay(u, branch1.id, 1, { in: '10:00', out: '22:00', ot: 3, month0: 10 }); // 1 พ.ย. — นอกงวด

    const res = await service.compute(prisma as never, query([u]));
    expect(res.attendanceAccountCodes).toEqual(['S52-1202']);
    expect(res.rows).toEqual([
      {
        userId: u,
        autoOtEligible: true,
        attendanceTracked: true,
        systemIncome: [otRow('6.5', '609.38'), holidayRow('8.0', '500.00'), holidayOtRow('2.0', '375.00')],
        attendanceSummary: {
          workDays: 6,
          lateCount: 1,
          lateMinutes: 20,
          absent: 1,
          leave: 1,
          otHours: '6.5',
          holidayHours: '8.0',
          holidayOtHours: '2.0',
          holidayWorkedDays: 1,
          reviewCount: 0,
          autoOtEligible: true,
          attendanceTracked: true,
        },
        notes: { review: [], warnings: [] },
      },
    ]);
  });

  it('(R4) holiday hours use the Bangkok work window: DAY_OFF 10:00–21:00 → holiday 8 h, OT 2 h (the raw UTC DATE would give 4 h / 0 h)', async () => {
    const u = await mkUser('r4');
    await mkDay(u, branch1.id, 18, { kind: 'DAY_OFF', in: '10:00', out: '21:00', ot: 2 });
    const row = await computeOne(u);
    expect(row.attendanceSummary).toMatchObject({ holidayHours: '8.0', holidayOtHours: '2.0', holidayWorkedDays: 1 });
    expect(row.systemIncome).toEqual([holidayRow('8.0', '500.00'), holidayOtRow('2.0', '375.00')]);
  });

  it('(b) days at two branches all count (LEAVE_* with a punch = weekday OT; SHOP_CLOSED = holiday) and each holiday uses its own branch rules; batched users keep request order', async () => {
    const u = await mkUser('b');
    const other = await mkUser('b-other');
    await mkDay(u, branch1.id, 1, { in: '10:00', out: '20:30', ot: 1.5 });
    await mkDay(u, branch2.id, 2, { in: '10:00', out: '21:00', ot: 1 });
    await mkDay(u, branch2.id, 3, { kind: 'LEAVE_PERSONAL', in: '10:00', out: '20:30', ot: 0.5 });
    await mkDay(u, branch2.id, 4, { kind: 'DAY_OFF', in: '10:00', out: '21:00' }); // สาขา 2 เลิก 20:00 → 9 ชม. ชนเพดาน 8 · OT 1
    await mkDay(u, branch1.id, 11, { kind: 'SHOP_CLOSED', in: '13:00', out: '21:00' }); // สาขา 1 เลิก 19:00 → 6 − พัก 1 = 5 · OT 2
    await mkDay(other, branch1.id, 1, { in: '10:00', out: '20:30', ot: 1.5 });

    const res = await service.compute(prisma as never, query([u, other, u], { branchId: branch2.id }));
    expect(res.rows.map((r) => r.userId)).toEqual([u, other]);
    expect(res.rows[0].systemIncome).toEqual([otRow('3.0', '281.25'), holidayRow('13.0', '812.50'), holidayOtRow('3.0', '562.50')]);
    expect(res.rows[0].attendanceSummary).toMatchObject({ workDays: 5, otHours: '3.0', holidayHours: '13.0', holidayOtHours: '3.0', holidayWorkedDays: 2 });
    expect(res.rows[1].systemIncome).toEqual([otRow('1.5', '140.63')]);
  });

  it('(c) DAILY employee → no attendance rows + NOT_MONTHLY_OR_NO_BASE with weekday + holiday OT hours', async () => {
    const u = await mkUser('c', { profile: { employmentType: 'DAILY', baseSalary: 15000 } });
    await mkDay(u, branch1.id, 1, { in: '10:00', out: '20:30', ot: 1.5 });
    await mkDay(u, branch1.id, 4, { kind: 'DAY_OFF', in: '10:00', out: '21:00' });
    const row = await computeOne(u);
    expect(row.autoOtEligible).toBe(false);
    expect(row.systemIncome).toEqual([]);
    expect(row.notes.warnings).toEqual([{ code: 'NOT_MONTHLY_OR_NO_BASE', otHours: '3.5' }]);
    expect(row.attendanceSummary).toMatchObject({ otHours: '1.5', holidayHours: '8.0', holidayOtHours: '2.0', autoOtEligible: false });
  });

  it('(R5) ineligible with no OT and no holiday work → no NOT_MONTHLY_OR_NO_BASE; holiday work alone still warns (payload = weekday + holiday OT)', async () => {
    const plain = await mkUser('r5-plain', { profile: { employmentType: 'DAILY', baseSalary: 15000 } });
    const noRows = await mkUser('r5-norows', { profile: { employmentType: 'CONTRACT', baseSalary: 15000 } });
    const holidayOnly = await mkUser('r5-holiday', { profile: { employmentType: 'DAILY', baseSalary: 15000 } });
    await mkDay(plain, branch1.id, 1, { in: '10:00', out: '19:00' });
    await mkDay(plain, branch1.id, 2, { in: '10:00', out: '19:10' }); // ไม่ถึง 15 นาที = ไม่มี OT
    await mkDay(holidayOnly, branch1.id, 4, { kind: 'DAY_OFF', in: '10:00', out: '17:00' }); // ทำงานวันหยุด 6 ชม. · OT 0
    const res = await service.compute(prisma as never, query([plain, noRows, holidayOnly]));
    expect(res.rows[0].notes.warnings).toEqual([]);
    expect(res.rows[1].notes.warnings).toEqual([]);
    expect(res.rows[2].notes.warnings).toEqual([{ code: 'NOT_MONTHLY_OR_NO_BASE', otHours: '0.0' }]);
    expect(res.rows[2].attendanceSummary).toMatchObject({ holidayHours: '6.0', holidayOtHours: '0.0', autoOtEligible: false });
    for (const row of res.rows) expect(row.systemIncome).toEqual([]);
  });

  it('(l) registry salary 0, null, or no profile → NOT_MONTHLY_OR_NO_BASE', async () => {
    const zero = await mkUser('l-zero', { profile: { employmentType: 'MONTHLY', baseSalary: 0 } });
    const none = await mkUser('l-null', { profile: { employmentType: 'MONTHLY', baseSalary: null } });
    const noProfile = await mkUser('l-noprofile', { profile: null });
    for (const u of [zero, none, noProfile]) await mkDay(u, branch1.id, 1, { in: '10:00', out: '20:30', ot: 1.5 });
    const res = await service.compute(prisma as never, query([zero, none, noProfile]));
    for (const row of res.rows) {
      expect(row.autoOtEligible).toBe(false);
      expect(row.systemIncome).toEqual([]);
      expect(row.notes.warnings).toEqual([{ code: 'NOT_MONTHLY_OR_NO_BASE', otHours: '1.5' }]);
    }
  });

  it('(h) review lists days with review flags (only those flags); DEVICE_CONFLICT is blocking; rows are still computed', async () => {
    const u = await mkUser('h');
    const conflict = await mkDay(u, branch1.id, 3, { in: '10:00', out: '20:30', ot: 1.5, flags: ['NO_PHOTO', 'DEVICE_CONFLICT'] });
    const corrected = await mkDay(u, branch2.id, 8, { kind: 'DAY_OFF', in: '10:00', out: '18:00', flags: ['WORKED_ON_OFF_DAY', 'CORRECTED'] });
    await mkDay(u, branch1.id, 9, { in: '10:00', out: '19:00', flags: ['NO_PHOTO', 'OUT_UPDATED'] });
    const missingOut = await mkDay(u, branch1.id, 10, { in: '10:00', flags: ['MISSING_OUT', 'NETWORK_CHANGED'] });
    const row = await computeOne(u);
    expect(row.notes.review).toEqual([
      { dayId: conflict.id, date: '2026-10-03', branchId: branch1.id, flags: ['DEVICE_CONFLICT'], blocking: true },
      { dayId: corrected.id, date: '2026-10-08', branchId: branch2.id, flags: ['CORRECTED'], blocking: false },
      { dayId: missingOut.id, date: '2026-10-10', branchId: branch1.id, flags: ['MISSING_OUT', 'NETWORK_CHANGED'], blocking: false },
    ]);
    expect(row.attendanceSummary.reviewCount).toBe(3);
    expect(row.systemIncome.map((r) => r.source)).toEqual(['ATTENDANCE_OT', 'ATTENDANCE_HOLIDAY']);
  });

  it('(i) before the cutoff → NOT_YET_CLOSABLE with closableAt; from the cutoff on → no warning', async () => {
    const u = await mkUser('i');
    await mkDay(u, branch1.id, 1, { in: '10:00', out: '20:30', ot: 1.5 });
    const before = await computeOne(u, { now: new Date('2026-11-01T10:59:59.999Z') });
    expect(before.notes.warnings).toEqual([{ code: 'NOT_YET_CLOSABLE', closableAt: CUTOFF_ISO }]);
    expect(before.systemIncome).toEqual([otRow('1.5', '140.63')]);
    const atCutoff = await computeOne(u, { now: new Date(CUTOFF_ISO) });
    expect(atCutoff.notes.warnings).toEqual([]);
  });

  it('NO_PIN only when the user has no PIN and no attendance rows in the period · R20: NO_ATTENDANCE for an auto-OT user with a PIN and no rows · attendanceTracked = has rows', async () => {
    const noPinNoRows = await mkUser('pin-none', { pin: false });
    const noPinWithRows = await mkUser('pin-rows', { pin: false });
    await mkDay(noPinWithRows, branch1.id, 1, { in: '10:00', out: '19:00' });
    const pinNoRows = await mkUser('pin-no-device');
    const dailyPinNoRows = await mkUser('pin-daily', { profile: { employmentType: 'DAILY', baseSalary: null } });
    const deletedOnly = await mkUser('pin-deleted-day');
    await mkDay(deletedOnly, branch1.id, 2, { in: '10:00', out: '20:30', ot: 1.5, deleted: true });
    const res = await service.compute(prisma as never, query([noPinNoRows, noPinWithRows, pinNoRows, dailyPinNoRows, deletedOnly]));
    expect(res.rows.map((r) => [r.notes.warnings, r.attendanceTracked, r.attendanceSummary.attendanceTracked, r.autoOtEligible])).toEqual([
      [[{ code: 'NO_PIN' }], false, false, true],
      [[], true, true, true],
      [[{ code: 'NO_ATTENDANCE' }], false, false, true],
      [[], false, false, false], // รายวัน: ระบบไม่คิด OT ให้อยู่แล้ว ไม่มีชั่วโมงให้เตือน
      [[{ code: 'NO_ATTENDANCE' }], false, false, true], // แถวที่ถูกลบไม่นับ (ชุดวันเดียวกับที่ใช้คิดชั่วโมง)
    ]);
    expect(res.rows[0].systemIncome).toEqual([]);
    expect(res.rows[2].systemIncome).toEqual([]);
  });

  it('(k) document A (branch 1) holds U attendance rows → compute for branch 2 gets none + IN_OTHER_DOCUMENT; excluded / VOIDED / soft-deleted A, a MANUAL-only document and another period do not block', async () => {
    const u = await mkUser('k');
    await mkDay(u, branch1.id, 1, { in: '10:00', out: '20:30', ot: 1.5 });
    const docA = await mkPayrollDoc('k-A', u, { branchId: branch1.id });
    await mkPayrollDoc('k-manual', u, { branchId: branch2.id, source: 'MANUAL' });
    await mkPayrollDoc('k-sep', u, { branchId: branch1.id, period: '2026-09' });

    const blocked = await computeOne(u, { branchId: branch2.id });
    expect(blocked.systemIncome).toEqual([]);
    expect(blocked.notes.warnings).toEqual([
      { code: 'IN_OTHER_DOCUMENT', documentId: docA.id, documentNumber: docA.number, branchName: branch1.name, status: 'DRAFT' },
    ]);
    expect(blocked.attendanceSummary.otHours).toBe('1.5');

    const self = await computeOne(u, { excludeDocumentId: docA.id });
    expect(self.systemIncome).toEqual([otRow('1.5', '140.63')]);
    expect(self.notes.warnings).toEqual([]);

    await prisma.expenseDocument.update({ where: { id: docA.id }, data: { status: 'VOIDED' } });
    expect((await computeOne(u, { branchId: branch2.id })).systemIncome).toEqual([otRow('1.5', '140.63')]);

    await prisma.expenseDocument.update({ where: { id: docA.id }, data: { status: 'DRAFT', deletedAt: new Date() } });
    expect((await computeOne(u, { branchId: branch2.id })).systemIncome).toEqual([otRow('1.5', '140.63')]);
  });

  it('(m) account_role_map changed in the DB without invalidate() → compute uses the new code (AccountRoleService cache still has the old one)', async () => {
    const u = await mkUser('m');
    await mkDay(u, branch1.id, 1, { in: '10:00', out: '20:30', ot: 1.5 });
    await mkDay(u, branch1.id, 4, { kind: 'DAY_OFF', in: '10:00', out: '21:00' });
    const row = await prisma.accountRoleMap.findFirstOrThrow({ where: { role: 'shop_payroll_overtime', accountCode: 'S52-1202', isActive: true } });
    await prisma.accountRoleMap.update({ where: { id: row.id }, data: { accountCode: 'S52-1204' } });
    try {
      const res = await service.compute(prisma as never, query([u]));
      expect(roles.code('shop_payroll_overtime')).toBe('S52-1202'); // cache ต่อ instance ยังเป็นค่าเก่า
      expect(res.attendanceAccountCodes).toEqual(['S52-1204', 'S52-1202']);
      expect(res.rows[0].systemIncome).toEqual([otRow('1.5', '140.63', 'S52-1204'), holidayRow('8.0', '500.00'), holidayOtRow('2.0', '375.00')]);
    } finally {
      await prisma.accountRoleMap.update({ where: { id: row.id }, data: { accountCode: 'S52-1202' } });
    }
  });

  it('FINANCE scope resolves payroll_overtime / payroll_holiday (53-1103)', async () => {
    const u = await mkUser('fin');
    await mkDay(u, branch1.id, 1, { in: '10:00', out: '20:30', ot: 1.5 });
    await mkDay(u, branch1.id, 4, { kind: 'DAY_OFF', in: '10:00', out: '21:00' });
    const res = await service.compute(prisma as never, query([u], { entityScope: 'FINANCE' }));
    expect(res.attendanceAccountCodes).toEqual(['53-1103']);
    expect(res.rows[0].systemIncome.map((r) => r.accountCode)).toEqual(['53-1103', '53-1103', '53-1103']);
  });

  it('resolveRoleCodes: lowest priority among active rows wins (inactive ignored); a missing role throws naming it', async () => {
    const role = `prs_test_role_${stamp}`;
    await prisma.accountRoleMap.createMany({
      data: [
        { role, accountCode: 'S52-1204', priority: 2, isActive: true },
        { role, accountCode: 'S52-1202', priority: 1, isActive: true },
        { role, accountCode: 'S52-1201', priority: 0, isActive: false },
      ],
    });
    try {
      expect(await resolveRoleCodes(prisma as never, [role, 'shop_payroll_holiday'])).toEqual({ [role]: 'S52-1202', shop_payroll_holiday: 'S52-1202' });
      await expect(resolveRoleCodes(prisma as never, [role, 'prs_missing_role'])).rejects.toThrow(/prs_missing_role/);
    } finally {
      await prisma.accountRoleMap.deleteMany({ where: { role } });
    }
  });
});
