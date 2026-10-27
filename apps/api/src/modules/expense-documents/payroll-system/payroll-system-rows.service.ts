import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AttendanceDay } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { bangkokMidnight } from '../../../utils/date.util';
import { AttendanceSettingsService } from '../../attendance/attendance-settings.service';
import { cellStatusOf, dbDate, fromDbDate, summarizeAttendanceMonth, workDateOf, workDateString, type ScheduleRules } from '../../attendance/attendance-rules';
import { displayRate, isAutoOtEligible, monthPayHours, payrollCutoff, systemIncomeAmount, type PayDay } from './payroll-pay';
import { resolveRoleCodes } from './role-codes';
import {
  ATTENDANCE_INCOME_SOURCES,
  type ReviewDay,
  type SystemIncomeRow,
  type SystemRowsForUser,
  type SystemRowsQuery,
  type SystemRowsResult,
  type SystemWarning,
} from './payroll-system.types';

/** ธงของแถววันที่ต้องให้คนตรวจก่อนจ่าย (ลำดับนี้คือลำดับที่แสดง) */
const REVIEW_FLAGS = ['DEVICE_CONFLICT', 'MISSING_OUT', 'DEVICE_UNAVAILABLE', 'AFTER_PIN_LOCKOUT', 'LOCATION_CHANGED', 'NETWORK_CHANGED', 'CORRECTED'] as const;
const BLOCKING_FLAG = 'DEVICE_CONFLICT';

const MULTIPLIER = { ot: new Prisma.Decimal('1.5'), holiday: new Prisma.Decimal(1), holidayOt: new Prisma.Decimal(3) };
const ROW_NAME = { ot: 'OT วันทำงาน (1.5 เท่า)', holiday: 'ทำงานวันหยุด (1 เท่า)', holidayOt: 'OT วันหยุด (3 เท่า)' };

type DayRow = Pick<AttendanceDay, 'id' | 'userId' | 'branchId' | 'workDate' | 'dayKind' | 'clockIn' | 'clockOut' | 'otHours' | 'lateMinutes' | 'flags'>;

function periodRange(period: string): { from: Date; to: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  const year = m ? Number(m[1]) : NaN;
  const month = m ? Number(m[2]) : NaN;
  if (!m || month < 1 || month > 12) throw new BadRequestException('งวดเงินเดือนต้องเป็น YYYY-MM');
  return { from: dbDate(bangkokMidnight(year, month - 1, 1)), to: dbDate(bangkokMidnight(year, month, 1)) };
}

/**
 * Payroll D4 ส่วนที่ 1 — แถวรายได้ที่ระบบคิดจากการลงเวลา (OT วันทำงาน / ทำงานวันหยุด / OT วันหยุด) ต่อคนต่อเดือน
 * - แถวลงเวลาของคนนั้น **ทุกสาขา** ในเดือนของงวด (`deletedAt: null`) · กติกาเวลางานของแต่ละวันจากสาขาของวันนั้น
 * - ฐาน = เงินเดือนทะเบียน (`EmployeeProfile.baseSalary`) ÷ 240 · ยอดปัดครั้งเดียวต่อแถว (payroll-pay.ts)
 * - ไม่คิดแถว (แต่ยังส่งชั่วโมง/คำเตือน) เมื่อ: ใบเงินเดือนอื่นที่ยังมีผลของงวดเดียวกันถือแถวลงเวลาของคนนี้แล้ว ·
 *   ไม่ใช่รายเดือน/ไม่มีเงินเดือนในทะเบียน
 * - role → บัญชีอ่านจาก `account_role_map` ผ่าน client ที่ส่งมา (ไม่ผ่าน cache ต่อ instance)
 */
@Injectable()
export class PayrollSystemRowsService {
  constructor(private readonly attendanceSettings: AttendanceSettingsService) {}

  async compute(client: Prisma.TransactionClient | PrismaService, q: SystemRowsQuery): Promise<SystemRowsResult> {
    const { from, to } = periodRange(q.payrollPeriod);
    const prefix = q.entityScope === 'SHOP' ? 'shop_' : '';
    const otRole = `${prefix}payroll_overtime`;
    const holidayRole = `${prefix}payroll_holiday`;
    const codes = await resolveRoleCodes(client, [otRole, holidayRole]);
    const attendanceAccountCodes = [...new Set([codes[otRole], codes[holidayRole]])];

    const userIds = [...new Set(q.userIds)];
    if (userIds.length === 0) return { attendanceAccountCodes, rows: [] };

    const [days, profiles, users, otherLines] = await Promise.all([
      client.attendanceDay.findMany({
        where: { userId: { in: userIds }, deletedAt: null, workDate: { gte: from, lt: to } },
        select: { id: true, userId: true, branchId: true, workDate: true, dayKind: true, clockIn: true, clockOut: true, otHours: true, lateMinutes: true, flags: true },
        orderBy: [{ workDate: 'asc' }],
      }),
      client.employeeProfile.findMany({
        where: { userId: { in: userIds }, deletedAt: null },
        select: { userId: true, employmentType: true, baseSalary: true },
      }),
      client.user.findMany({ where: { id: { in: userIds } }, select: { id: true, attendancePinHash: true } }),
      client.payrollLine.findMany({
        where: {
          userId: { in: userIds },
          customIncome: { some: { source: { in: [...ATTENDANCE_INCOME_SOURCES] } } },
          payroll: {
            payrollPeriod: q.payrollPeriod,
            document: {
              documentType: 'PAYROLL',
              deletedAt: null,
              status: { not: 'VOIDED' },
              ...(q.excludeDocumentId ? { id: { not: q.excludeDocumentId } } : {}),
            },
          },
        },
        select: { userId: true, payroll: { select: { document: { select: { id: true, number: true, status: true, branch: { select: { name: true } } } } } } },
        orderBy: { payroll: { document: { number: 'asc' } } },
      }),
    ]);

    const branchIds = [...new Set(days.map((d) => d.branchId))];
    const rules = new Map(await Promise.all(branchIds.map(async (b) => [b, await this.attendanceSettings.getRules(b)] as const)));
    const rulesFor = (branchId: string): ScheduleRules => {
      const r = rules.get(branchId);
      if (!r) throw new Error(`attendance rules not loaded for branch ${branchId}`);
      return r;
    };

    const daysByUser = new Map<string, DayRow[]>();
    for (const d of days) daysByUser.set(d.userId, [...(daysByUser.get(d.userId) ?? []), d]);
    const profileByUser = new Map(profiles.map((p) => [p.userId, p]));
    const hasPin = new Map(users.map((u) => [u.id, !!u.attendancePinHash]));
    const otherDocsByUser = new Map<string, SystemWarning[]>();
    for (const line of otherLines) {
      if (!line.userId) continue;
      const doc = line.payroll.document;
      otherDocsByUser.set(line.userId, [
        ...(otherDocsByUser.get(line.userId) ?? []),
        { code: 'IN_OTHER_DOCUMENT', documentId: doc.id, documentNumber: doc.number, branchName: doc.branch.name, status: doc.status },
      ]);
    }

    const cutoff = payrollCutoff(q.payrollPeriod);
    const today = workDateOf(q.now);

    const rows = userIds.map((userId): SystemRowsForUser => {
      const userDays = daysByUser.get(userId) ?? [];
      const payDays: PayDay[] = userDays.map((d) => ({
        workDate: fromDbDate(d.workDate), // เที่ยงคืนไทย — ไม่ใช่ค่า DATE ดิบ (เที่ยงคืน UTC) ซึ่งเลื่อนช่วงเวลางาน 7 ชม.
        branchId: d.branchId,
        dayKind: d.dayKind,
        clockIn: d.clockIn,
        clockOut: d.clockOut,
        otHours: d.otHours,
        lateMinutes: d.lateMinutes,
        flags: d.flags,
      }));
      const hours = monthPayHours(payDays, rulesFor);

      const review: ReviewDay[] = [];
      for (const d of userDays) {
        const flags = REVIEW_FLAGS.filter((f) => d.flags.includes(f));
        if (flags.length === 0) continue;
        review.push({ dayId: d.id, date: workDateString(fromDbDate(d.workDate)), branchId: d.branchId, flags, blocking: flags.includes(BLOCKING_FLAG) });
      }

      const profile = profileByUser.get(userId) ?? null;
      const autoOtEligible = isAutoOtEligible(profile);
      const otherDocs = otherDocsByUser.get(userId) ?? [];
      const warnings: SystemWarning[] = [...otherDocs];
      // R5: เตือนเฉพาะเมื่อมีชั่วโมงให้กรอกเอง (OT วันทำงาน + OT วันหยุด + ทำงานวันหยุด > 0) · payload คง OT วันทำงาน + OT วันหยุด
      if (!autoOtEligible && hours.otHours.add(hours.holidayOtHours).add(hours.holidayHours).gt(0)) {
        warnings.push({ code: 'NOT_MONTHLY_OR_NO_BASE', otHours: hours.otHours.add(hours.holidayOtHours).toFixed(1) });
      }
      if (!hasPin.get(userId) && userDays.length === 0) warnings.push({ code: 'NO_PIN' });
      if (q.now.getTime() < cutoff.getTime()) warnings.push({ code: 'NOT_YET_CLOSABLE', closableAt: cutoff.toISOString() });

      const systemIncome: SystemIncomeRow[] = [];
      const base = autoOtEligible ? profile?.baseSalary ?? null : null;
      if (base && otherDocs.length === 0) {
        const push = (source: SystemIncomeRow['source'], kind: keyof typeof MULTIPLIER, h: Prisma.Decimal, accountCode: string) => {
          if (h.lte(0)) return;
          const multiplier = MULTIPLIER[kind];
          systemIncome.push({
            source,
            accountCode,
            name: ROW_NAME[kind],
            quantity: h.toFixed(1),
            rate: displayRate(base, multiplier).toFixed(4),
            multiplier: multiplier.toFixed(1),
            amount: systemIncomeAmount(base, multiplier, h).toFixed(2),
            isTaxable: true,
          });
        };
        push('ATTENDANCE_OT', 'ot', hours.otHours, codes[otRole]);
        push('ATTENDANCE_HOLIDAY', 'holiday', hours.holidayHours, codes[holidayRole]);
        push('ATTENDANCE_HOLIDAY_OT', 'holidayOt', hours.holidayOtHours, codes[holidayRole]);
      }

      // สถานะช่องตัวเดียวกับหน้าลงเวลา · otHours ของสรุปนั้น (OT ที่เก็บไว้ทุกวัน เป็น number) ถูกแทนด้วยชั่วโมงที่ใช้คิดเงินจริง (Decimal)
      const month = summarizeAttendanceMonth(
        userDays.map((d) => ({ status: cellStatusOf(d, today), clockIn: d.clockIn, lateMinutes: d.lateMinutes, otHours: d.otHours })),
      );
      return {
        userId,
        autoOtEligible,
        systemIncome,
        attendanceSummary: {
          workDays: month.workDays,
          lateCount: month.lateCount,
          lateMinutes: month.lateMinutes,
          absent: month.absent,
          leave: month.leave,
          otHours: hours.otHours.toFixed(1),
          holidayHours: hours.holidayHours.toFixed(1),
          holidayOtHours: hours.holidayOtHours.toFixed(1),
          holidayWorkedDays: hours.holidayWorkedDays,
          reviewCount: review.length,
          autoOtEligible,
        },
        notes: { review, warnings },
      };
    });

    return { attendanceAccountCodes, rows };
  }
}
