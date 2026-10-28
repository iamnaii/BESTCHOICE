import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AttendanceDay } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { bangkokMidnight } from '../../../utils/date.util';
import { AttendanceSettingsService } from '../../attendance/attendance-settings.service';
import { cellStatusOf, dbDate, fromDbDate, summarizeAttendanceMonth, workDateOf, workDateString, type ScheduleRules } from '../../attendance/attendance-rules';
import { loadCommissionState, type UserCommissionState } from './payroll-commission-state';
import { displayRate, isAutoOtEligible, monthPayHours, payrollCutoff, systemIncomeAmount, type PayDay } from './payroll-pay';
import { resolveRoleCodes } from './role-codes';
import {
  ATTENDANCE_INCOME_SOURCES,
  SHOP_COMMISSION_ROLE,
  type CommissionItemOut,
  type ReviewDay,
  type SystemDeductionRow,
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

const ZERO = new Prisma.Decimal(0);

interface CommissionRows {
  income: SystemIncomeRow | null;
  deductions: SystemDeductionRow[];
  items: CommissionItemOut[];
  warnings: SystemWarning[];
}

/**
 * สถานะค่าคอมของคนหนึ่ง → แถว COMMISSION + หักคืน + รายการ + คำเตือน (ฟังก์ชันบริสุทธิ์ — กติกาเลือกค่าคอมอยู่ใน loadCommissionState)
 * - FINANCE (`commissionCode` null): ไม่มีแถว/รายการ — นับค่าคอมที่จ่ายได้เป็น COMMISSION_FINANCE_BLOCKED (เฉพาะ > 0) เท่านั้น
 * - หักคืนตามลำดับ [clawbackAt, id] ได้ไม่เกิน Σ ค่าคอมงวดนี้ (Decision 2 — ม.76: ไม่หักจากเงินเดือน) · ส่วนที่เหลือยกไปงวดหน้า
 * - P2-R6: ยอด 0 ไม่เป็นแถว/รายการ · CLAWBACK_CARRIED หนึ่งคำเตือนต่อบรรทัด เฉพาะเมื่อมียอดยก
 */
function commissionRows(s: UserCommissionState, commissionCode: string | null): CommissionRows {
  if (commissionCode === null) {
    return { income: null, deductions: [], items: [], warnings: s.payable.length > 0 ? [{ code: 'COMMISSION_FINANCE_BLOCKED', count: s.payable.length }] : [] };
  }
  const warnings: SystemWarning[] = s.heldElsewhere.map((g) => ({
    code: 'COMMISSION_IN_OTHER_DOCUMENT',
    count: g.commissionIds.length,
    documentId: g.documentId,
    documentNumber: g.documentNumber,
  }));

  const items: CommissionItemOut[] = s.payable.map((c) => ({
    salesCommissionId: c.id,
    kind: 'PAY',
    accountCode: commissionCode,
    amount: c.amount.toFixed(2),
    reference: c.reference,
    date: c.createdAt.toISOString(),
    reason: null,
    carriedForward: null,
  }));
  const payTotal = s.payable.reduce((sum, c) => sum.plus(c.amount), ZERO);
  const income: SystemIncomeRow | null =
    s.payable.length === 0
      ? null
      : {
          source: 'COMMISSION',
          accountCode: commissionCode,
          name: `ค่าคอมมิชชัน (${s.payable.length} รายการ)`,
          quantity: null,
          rate: null,
          multiplier: null,
          amount: payTotal.toFixed(2),
          isTaxable: true,
        };

  let room = payTotal;
  let deducted = ZERO;
  let carried = ZERO;
  const byAccount = new Map<string, { count: number; amount: Prisma.Decimal }>();
  for (const c of s.clawbacks) {
    if (c.paidAccountCode === null) {
      warnings.push({ code: 'CLAWBACK_PAID_OUTSIDE_PAYROLL', reference: c.reference });
      continue;
    }
    if (c.outstanding.lte(0)) continue; // หักครบแล้วในใบอื่น
    const take = Prisma.Decimal.min(c.outstanding, room);
    const left = c.outstanding.minus(take);
    room = room.minus(take);
    deducted = deducted.plus(take);
    carried = carried.plus(left);
    if (take.lte(0)) continue; // ยกทั้งก้อน — ไม่มีรายการ (P2-R6: รายการ 0.00 จะขวางการกลับรายการใบที่จ่าย)
    items.push({
      salesCommissionId: c.id,
      kind: 'CLAWBACK',
      accountCode: c.paidAccountCode,
      amount: take.toFixed(2),
      reference: c.reference,
      // ผู้เขียนหักคืนทุกตัวตั้ง clawbackAt (helper ของ Task 2 / cron) — createdAt กันชนิดข้อมูลเท่านั้น
      date: (c.clawbackAt ?? c.createdAt).toISOString(),
      reason: c.clawbackReason,
      carriedForward: left.gt(0) ? left.toFixed(2) : null,
    });
    const acc = byAccount.get(c.paidAccountCode) ?? { count: 0, amount: ZERO };
    byAccount.set(c.paidAccountCode, { count: acc.count + 1, amount: acc.amount.plus(take) });
  }
  if (carried.gt(0)) warnings.push({ code: 'CLAWBACK_CARRIED', deducted: deducted.toFixed(2), carried: carried.toFixed(2) });

  const deductions: SystemDeductionRow[] = [...byAccount.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([accountCode, g]) => ({ source: 'COMMISSION_CLAWBACK', accountCode, name: `หักคืนค่าคอม (${g.count} รายการ)`, amount: g.amount.toFixed(2) }));
  return { income, deductions, items, warnings };
}

/** ช่วง `@db.Date` ของเดือนงวด [วันที่ 1, วันที่ 1 เดือนถัดไป) — ใช้ร่วมกับด่านลงบัญชี (วันติดธงของเดือน) */
export function periodRange(period: string): { from: Date; to: Date } {
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
 *
 * ส่วนที่ 2 — ค่าคอม (ทุกบรรทัด SHOP ที่ผูกพนักงาน ไม่ขึ้นกับเกณฑ์ OT / ใบอื่นถือ OT / รหัสตอกบัตร — สามอย่างนั้นมีผลกับแถวลงเวลาเท่านั้น):
 * แถว COMMISSION (role `shop_payroll_commission`) + หักคืนค่าคอม + รายการ PAY/CLAWBACK จาก `loadCommissionState`
 * (กติกาจ่ายได้/หักคืนได้อยู่ที่นั่นที่เดียว) · FINANCE ไม่ดึงค่าคอม — ได้แค่คำเตือน COMMISSION_FINANCE_BLOCKED
 * - ไม่ล็อกเอง: ผู้เรียก (บันทึก/ส่ง/อนุมัติ/ลงบัญชี — Task 4) ถือ `payroll-attendance:*` และ `payroll-clawback:${userId}` แล้ว
 */
@Injectable()
export class PayrollSystemRowsService {
  constructor(private readonly attendanceSettings: AttendanceSettingsService) {}

  async compute(client: Prisma.TransactionClient | PrismaService, q: SystemRowsQuery): Promise<SystemRowsResult> {
    const { from, to } = periodRange(q.payrollPeriod);
    const shop = q.entityScope === 'SHOP';
    const prefix = shop ? 'shop_' : '';
    const otRole = `${prefix}payroll_overtime`;
    const holidayRole = `${prefix}payroll_holiday`;
    // P2-R15 — role ค่าคอมมีเฉพาะ SHOP (ขอ role ฝั่ง FINANCE = BadRequest ทุกครั้งที่บันทึกใบ FINANCE)
    const codes = await resolveRoleCodes(client, shop ? [otRole, holidayRole, SHOP_COMMISSION_ROLE] : [otRole, holidayRole]);
    const attendanceAccountCodes = [...new Set([codes[otRole], codes[holidayRole]])];
    const commissionCode = shop ? codes[SHOP_COMMISSION_ROLE] : null;

    const userIds = [...new Set(q.userIds)];
    if (userIds.length === 0) return { attendanceAccountCodes, commissionAccountCodes: commissionCode ? [commissionCode] : [], rows: [] };

    const [days, profiles, users, otherLines, commissions] = await Promise.all([
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
      loadCommissionState(client, { userIds, payrollPeriod: q.payrollPeriod, excludeDocumentId: q.excludeDocumentId, payOnly: !shop }),
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
      // R20/R23 — เดือนนี้ไม่มีวันที่ตอกเข้าเลย (ไม่มีหลักฐานการตอก) = ระบบไม่คิด OT ให้ ⇒ บอกให้กรอกเอง
      // (ไม่มีรหัส = NO_PIN · มีรหัสแต่ไม่มีวันที่ตอก เช่น สาขาไม่มีเครื่อง = NO_ATTENDANCE) · แถววางแผนอย่างเดียว
      // (วันหยุด/ลาที่ตั้งจากแท็บตารางงาน ไม่มีเวลาเข้า — ตั้งให้คนไม่มีรหัสได้) ไม่นับว่ามีข้อมูลลงเวลา
      const attendanceTracked = userDays.some((d) => d.clockIn != null);
      if (!hasPin.get(userId) && !attendanceTracked) warnings.push({ code: 'NO_PIN' });
      else if (autoOtEligible && !attendanceTracked) warnings.push({ code: 'NO_ATTENDANCE' });
      const commission = commissionRows(commissions.get(userId)!, commissionCode);
      warnings.push(...commission.warnings);
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
      // ค่าคอมอยู่นอกเงื่อนไขแถวลงเวลาข้างบน — ไม่ขึ้นกับเกณฑ์ OT / ใบอื่นถือ OT
      if (commission.income) systemIncome.push(commission.income);

      // สถานะช่องตัวเดียวกับหน้าลงเวลา · otHours ของสรุปนั้น (OT ที่เก็บไว้ทุกวัน เป็น number) ถูกแทนด้วยชั่วโมงที่ใช้คิดเงินจริง (Decimal)
      const month = summarizeAttendanceMonth(
        userDays.map((d) => ({ status: cellStatusOf(d, today), clockIn: d.clockIn, lateMinutes: d.lateMinutes, otHours: d.otHours })),
      );
      return {
        userId,
        autoOtEligible,
        attendanceTracked,
        systemIncome,
        systemDeductions: commission.deductions,
        commissionItems: commission.items,
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
          attendanceTracked,
        },
        notes: { review, warnings },
      };
    });

    const commissionAccountCodes = commissionCode
      ? [...new Set([commissionCode, ...rows.flatMap((r) => r.systemDeductions.map((d) => d.accountCode))])]
      : [];
    return { attendanceAccountCodes, commissionAccountCodes, rows };
  }
}
