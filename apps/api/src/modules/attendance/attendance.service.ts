import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AttendanceDay, AttendanceDayKind, Prisma } from '@prisma/client';
import type { Readable } from 'stream';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { bangkokMidnight, daysInMonth } from '../../utils/date.util';
import { AttendanceSettingsService } from './attendance-settings.service';
import {
  cellStatusOf,
  computeDaySummary,
  dbDate,
  FLAG_DEVICE_UNAVAILABLE,
  FLAG_MISSING_OUT,
  fromDbDate,
  summarizeAttendanceMonth,
  todayStatusOf,
  workDateOf,
  workDateString,
  type CellStatus,
  type MonthSummary,
  type ScheduleRules,
  type TodayStatus,
} from './attendance-rules';

export type { CellStatus, MonthSummary, TodayStatus };
export { FLAG_DEVICE_UNAVAILABLE };
import { DEVICE_CONFLICT_FLAG } from './attendance-device.service';
import type { CorrectDayDto, SetDayKindsDto } from './dto/attendance.dto';

/**
 * หลังบ้านของการลงเวลา (ก้อน 10 D3 · สเปก §6 §7 §8)
 * - ขอบเขตสาขาทำที่ service (route `/:id` ไม่มี branchId ให้ BranchGuard): OWNER ทุกสาขา · BRANCH_MANAGER เฉพาะ `actor.branchId` (ไม่มี = fail-closed)
 * - ผจก.แก้แถว/วันหยุดของตัวเองไม่ได้ (OT คิดอัตโนมัติ คนแก้ต้องไม่ใช่คนได้ประโยชน์) · OWNER แก้ได้ทุกคน
 * - ค่าที่คำนวณใหม่ตอนแก้ใช้ `computeDaySummary` ตัวเดียวกับ kiosk/cron · ธง DEVICE_CONFLICT ล้างได้เฉพาะ `clearConflictFlag` (OWNER)
 * - AuditLog เขียนหลัง commit เสมอ
 */

export type Actor = { id: string; role: string; branchId?: string | null };
export const FLAG_CORRECTED = 'CORRECTED';
const STAFF_ROLES = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES'];

export interface TodayRow {
  userId: string;
  nickname: string;
  name: string;
  role: string;
  hasPin: boolean;
  visiting: boolean;
  dayId: string | null;
  /** สาขาของแถววัน (= สาขาที่ตอกเข้า) — ผจก.แก้ได้เฉพาะแถวที่อยู่สาขาตัวเอง */
  dayBranchId: string | null;
  dayKind: AttendanceDayKind;
  status: TodayStatus;
  clockIn: Date | null;
  clockOut: Date | null;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  otHours: number;
  flags: string[];
  clockInPunchId: string | null;
  clockOutPunchId: string | null;
  note: string | null;
}

export interface MonthCell {
  dayId: string | null;
  dayKind: AttendanceDayKind;
  status: CellStatus;
  clockIn: Date | null;
  clockOut: Date | null;
  lateMinutes: number;
  otHours: number;
  flags: string[];
  clockInPunchId: string | null;
  clockOutPunchId: string | null;
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0));

export function assertBranchScope(actor: Actor, branchId: string): void {
  if (actor.role === 'OWNER') return;
  if (actor.role === 'BRANCH_MANAGER' && actor.branchId && actor.branchId === branchId) return;
  throw new ForbiddenException('ดูได้เฉพาะสาขาของตัวเอง');
}

function parseMonth(month: string): { year: number; month0: number; from: Date; to: Date; days: string[] } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new BadRequestException('เดือนต้องเป็น YYYY-MM');
  const year = Number(m[1]);
  const month0 = Number(m[2]) - 1;
  const count = daysInMonth(year, month0);
  const days = Array.from({ length: count }, (_, i) => `${year}-${String(month0 + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`);
  return { year, month0, from: dbDate(bangkokMidnight(year, month0, 1)), to: dbDate(bangkokMidnight(year, month0 + 1, 1)), days };
}

const cellOf = (day: AttendanceDay, today: Date): MonthCell => ({
  dayId: day.id,
  dayKind: day.dayKind,
  status: cellStatusOf(day, today),
  clockIn: day.clockIn,
  clockOut: day.clockOut,
  lateMinutes: day.lateMinutes,
  otHours: num(day.otHours),
  flags: day.flags,
  clockInPunchId: day.clockInPunchId,
  clockOutPunchId: day.clockOutPunchId,
});

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: AttendanceSettingsService,
    private readonly storage: StorageService,
  ) {}

  async today(actor: Actor, branchId: string, date: Date = new Date()): Promise<{ date: string; rules: ScheduleRules; rows: TodayRow[]; kpi: Record<string, number> }> {
    assertBranchScope(actor, branchId);
    const workDate = workDateOf(date);
    const key = dbDate(workDate);
    const [rules, staff] = await Promise.all([
      this.settings.getRules(branchId),
      this.prisma.user.findMany({
        where: { deletedAt: null, isActive: true, isSystemUser: false, role: { in: STAFF_ROLES as never }, OR: [{ branchId }, { attendanceDays: { some: { workDate: key, branchId, deletedAt: null } } }] },
        select: { id: true, nickname: true, name: true, role: true, branchId: true, attendancePinHash: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    const days = await this.prisma.attendanceDay.findMany({ where: { workDate: key, deletedAt: null, userId: { in: staff.map((u) => u.id) } } });
    const byUser = new Map(days.map((d) => [d.userId, d]));
    const rows: TodayRow[] = staff.map((u) => {
      const day = byUser.get(u.id) ?? null;
      return {
        userId: u.id,
        nickname: u.nickname || u.name,
        name: u.name,
        role: u.role,
        hasPin: !!u.attendancePinHash,
        visiting: u.branchId !== branchId,
        dayId: day?.id ?? null,
        dayBranchId: day?.branchId ?? null,
        dayKind: day?.dayKind ?? 'WORK',
        // ยังไม่มีรหัสตอกบัตร = ยังไม่เริ่มใช้ระบบ ไม่ใช่ "ยังไม่มา" (รีวิว minor)
        status: !day && !u.attendancePinHash ? 'NO_PIN' : todayStatusOf(day),
        clockIn: day?.clockIn ?? null,
        clockOut: day?.clockOut ?? null,
        lateMinutes: day?.lateMinutes ?? 0,
        earlyLeaveMinutes: day?.earlyLeaveMinutes ?? 0,
        otHours: num(day?.otHours),
        flags: day?.flags ?? [],
        clockInPunchId: day?.clockInPunchId ?? null,
        clockOutPunchId: day?.clockOutPunchId ?? null,
        note: day?.note ?? null,
      };
    });
    const order: Record<TodayStatus, number> = { MISSING_OUT: 0, LATE: 1, NOT_IN: 2, ON_TIME: 3, LEAVE: 4, DAY_OFF: 5, SHOP_CLOSED: 6, NO_PIN: 7 };
    rows.sort((a, b) => order[a.status] - order[b.status] || a.nickname.localeCompare(b.nickname, 'th'));
    const present = rows.filter((r) => r.clockIn);
    const kpi = {
      staff: rows.length,
      present: present.length,
      onTime: present.filter((r) => r.lateMinutes === 0).length,
      late: rows.filter((r) => r.status === 'LATE').length,
      absentSoFar: rows.filter((r) => r.status === 'NOT_IN').length,
      off: rows.filter((r) => r.status === 'DAY_OFF' || r.status === 'SHOP_CLOSED').length,
      leave: rows.filter((r) => r.status === 'LEAVE').length,
      flagged: rows.filter((r) => r.flags.length > 0).length,
    };
    return { date: workDateString(workDate), rules, rows, kpi };
  }

  async month(actor: Actor, branchId: string, month: string, now: Date = new Date()) {
    assertBranchScope(actor, branchId);
    const { from, to, days } = parseMonth(month);
    const today = workDateOf(now);
    // คนที่ออก/ถูกปิดใช้ระหว่างเดือนยังต้องอยู่ ถ้ามีแถวในเดือนนี้ (OT/สาย/ขาดใช้คิดเงินเดือนงวดสุดท้าย — รีวิวรอบ 2 C8)
    const inMonth = { gte: from, lt: to };
    const staff = await this.prisma.user.findMany({
      where: {
        isSystemUser: false,
        role: { in: STAFF_ROLES as never },
        OR: [
          { branchId, deletedAt: null, isActive: true },
          { attendanceDays: { some: { workDate: inMonth, branchId, deletedAt: null } } },
          { branchId, attendanceDays: { some: { workDate: inMonth, deletedAt: null } } },
        ],
      },
      select: { id: true, nickname: true, name: true, role: true, branchId: true, attendancePinHash: true },
      orderBy: { name: 'asc' },
    });
    // พนักงานของสาขานี้: ทุกแถวของเดือน (รวมวันที่ไปช่วยสาขาอื่น) · คนสาขาอื่นที่มาช่วย: เฉพาะแถวที่สาขานี้ (รีวิว minor)
    const homeIds = staff.filter((u) => u.branchId === branchId).map((u) => u.id);
    const rowsDb = await this.prisma.attendanceDay.findMany({ where: { deletedAt: null, workDate: { gte: from, lt: to }, OR: [{ branchId }, { userId: { in: homeIds } }] } });
    const grouped = new Map<string, AttendanceDay[]>();
    for (const d of rowsDb) grouped.set(d.userId, [...(grouped.get(d.userId) ?? []), d]);
    const rows = staff.map((u) => {
      const cells: Record<string, MonthCell> = {};
      for (const d of grouped.get(u.id) ?? []) cells[workDateString(fromDbDate(d.workDate))] = cellOf(d, today);
      return { userId: u.id, nickname: u.nickname || u.name, name: u.name, role: u.role, hasPin: !!u.attendancePinHash, visiting: u.branchId !== branchId, cells, summary: summarizeAttendanceMonth(Object.values(cells)) };
    });
    return { month, days, rows };
  }

  async me(userId: string, month: string, now: Date = new Date()) {
    const { from, to } = parseMonth(month);
    const today = workDateOf(now);
    const rowsDb = await this.prisma.attendanceDay.findMany({ where: { userId, deletedAt: null, workDate: { gte: from, lt: to } }, orderBy: { workDate: 'desc' } });
    const rows = rowsDb.map((d) => ({ date: workDateString(fromDbDate(d.workDate)), ...cellOf(d, today), correctedCount: d.correctedCount }));
    return { month, rows, summary: summarizeAttendanceMonth(rows) };
  }

  async photoStream(actor: Actor, punchId: string): Promise<{ stream: Readable; contentType: string }> {
    const punch = await this.prisma.attendancePunch.findUnique({ where: { id: punchId }, select: { id: true, branchId: true, photoKey: true, user: { select: { branchId: true } } } });
    if (!punch) throw new NotFoundException('ไม่พบรายการตอกบัตร');
    // ผจก.เปิดรูปได้ทั้งการตอกที่สาขาตัวเอง และการตอกของพนักงานสาขาตัวเองที่ไปช่วยสาขาอื่น (รีวิว minor)
    const homeBranchId = punch.user?.branchId ?? null;
    if (!(actor.role === 'BRANCH_MANAGER' && actor.branchId && homeBranchId === actor.branchId)) assertBranchScope(actor, punch.branchId);
    if (!punch.photoKey) throw new NotFoundException('ไม่มีรูปสำหรับรายการนี้ (ถ่ายไม่ได้ตอนตอก หรือถูกลบตามอายุเก็บ)');
    const stream = await this.storage.getStream(punch.photoKey);
    return { stream, contentType: 'image/jpeg' };
  }

  async correctDay(actor: Actor, dayId: string, dto: CorrectDayDto): Promise<AttendanceDay> {
    const day = await this.prisma.attendanceDay.findUnique({ where: { id: dayId } });
    if (!day || day.deletedAt) throw new NotFoundException('ไม่พบแถววันทำงาน');
    assertBranchScope(actor, day.branchId);
    if (day.userId === actor.id && actor.role !== 'OWNER') throw new ForbiddenException('แก้เวลาของตัวเองไม่ได้ ให้เจ้าของแก้');
    const reason = (dto.reason ?? '').trim();
    if (reason.length < 10) throw new BadRequestException('เหตุผลต้องยาวอย่างน้อย 10 ตัวอักษร');

    // null = ล้างเวลา (เช่น ตรวจรูปแล้วพบว่าตอกแทนกัน → ถือว่าไม่มา) · undefined = ไม่แตะ (รีวิว I9: เดิม new Date(null) = 1970)
    const clockIn = dto.clockIn === undefined ? day.clockIn : dto.clockIn === null ? null : new Date(dto.clockIn);
    const clockOut = dto.clockOut === undefined ? day.clockOut : dto.clockOut === null ? null : new Date(dto.clockOut);
    const dayKind = dto.dayKind ?? day.dayKind;
    if (clockIn && Number.isNaN(clockIn.getTime())) throw new BadRequestException('เวลาเข้างานไม่ถูกต้อง');
    if (clockOut && Number.isNaN(clockOut.getTime())) throw new BadRequestException('เวลาออกงานไม่ถูกต้อง');
    if (clockIn && clockOut && clockOut.getTime() <= clockIn.getTime()) throw new BadRequestException('เวลาออกต้องหลังเวลาเข้า');
    if (!clockIn && clockOut) throw new BadRequestException('มีเวลาออกต้องมีเวลาเข้า');

    const rules = await this.settings.getRules(day.branchId);
    const summary = computeDaySummary({ workDate: fromDbDate(day.workDate), dayKind, clockIn, clockOut, rules });
    const kept = day.flags.filter((f) => f !== FLAG_MISSING_OUT && f !== 'WORKED_ON_OFF_DAY');
    const flags = Array.from(new Set([...kept, ...summary.flags, FLAG_CORRECTED]));
    if (!clockOut && clockIn && day.flags.includes(FLAG_MISSING_OUT)) flags.push(FLAG_MISSING_OUT);
    const before = { clockIn: day.clockIn, clockOut: day.clockOut, dayKind: day.dayKind, lateMinutes: day.lateMinutes, otHours: num(day.otHours), flags: day.flags };
    const after = { clockIn, clockOut, dayKind, lateMinutes: summary.lateMinutes, otHours: summary.otHours, workedMinutes: summary.workedMinutes, earlyLeaveMinutes: summary.earlyLeaveMinutes, flags };

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.attendanceDay.update({
        where: { id: day.id },
        data: {
          clockIn,
          clockOut,
          // ล้างเวลา = ไม่มีการตอกที่เป็นหลักฐานของเวลานั้นอีก
          ...(clockIn === null ? { clockInPunchId: null } : {}),
          ...(clockOut === null ? { clockOutPunchId: null } : {}),
          dayKind,
          workedMinutes: summary.workedMinutes,
          lateMinutes: summary.lateMinutes,
          earlyLeaveMinutes: summary.earlyLeaveMinutes,
          otHours: summary.otHours,
          flags,
          correctedCount: day.correctedCount + 1,
        },
      });
      await tx.attendanceCorrection.create({ data: { dayId: day.id, changedById: actor.id, reason, before: before as Prisma.InputJsonValue, after: after as Prisma.InputJsonValue } });
      return row;
    });
    await this.audit.log({ userId: actor.id, action: 'ATTENDANCE_CORRECTED', entity: 'attendance_day', entityId: day.id, oldValue: before, newValue: { ...after, reason, targetUserId: day.userId } });
    return updated;
  }

  async setDayKinds(actor: Actor, dto: SetDayKindsDto, now: Date = new Date()): Promise<{ updated: number }> {
    assertBranchScope(actor, dto.branchId);
    if (actor.role !== 'OWNER' && dto.entries.some((e) => e.userId === actor.id)) throw new ForbiddenException('กำหนดวันหยุด/ลาของตัวเองไม่ได้ ให้เจ้าของทำ');
    const today = workDateOf(now);
    const parsed = dto.entries.map((e) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.date);
      if (!m) throw new BadRequestException(`วันที่ไม่ถูกต้อง: ${e.date}`);
      const midnight = bangkokMidnight(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      // ตารางหยุด/ลาเป็นการวางแผนล่วงหน้า · ย้อนหลังต้องมีเหตุผล (สเปก §6) ⇒ ใช้ปุ่มแก้ไขรายวัน (รีวิว I2)
      if (midnight.getTime() < today.getTime()) throw new BadRequestException(`วันที่ ${e.date} ผ่านไปแล้ว — บันทึกลา/หยุดย้อนหลังที่แท็บ วันนี้ (เลือกวันที่) › แก้ไข พร้อมเหตุผล`);
      return { ...e, workDate: dbDate(midnight) };
    });
    if (actor.role !== 'OWNER') await this.assertEntriesInBranch(dto.branchId, parsed);
    // วันที่ตอกเข้าแล้ว: เปลี่ยนประเภทวันกระทบสาย/OT = เป็นการแก้ไขที่ต้องมีเหตุผลและประวัติ (สเปก §6 · รีวิวรอบ 2 C6)
    for (const e of parsed) {
      const existing = await this.prisma.attendanceDay.findUnique({ where: { userId_workDate: { userId: e.userId, workDate: e.workDate } }, select: { clockIn: true, deletedAt: true } });
      if (existing?.clockIn && !existing.deletedAt) throw new BadRequestException(`วันที่ ${e.date} พนักงานตอกเข้าแล้ว — เปลี่ยนประเภทวันที่แท็บ วันนี้ › แก้ไข พร้อมเหตุผล`);
    }
    await this.prisma.$transaction(async (tx) => {
      for (const e of parsed) {
        await tx.attendanceDay.upsert({
          where: { userId_workDate: { userId: e.userId, workDate: e.workDate } },
          create: { userId: e.userId, branchId: dto.branchId, workDate: e.workDate, dayKind: e.dayKind },
          update: { dayKind: e.dayKind },
        });
      }
    });
    await this.audit.log({ userId: actor.id, action: 'ATTENDANCE_DAY_KINDS_SET', entity: 'attendance_day', entityId: dto.branchId, newValue: { branchId: dto.branchId, entries: dto.entries } });
    return { updated: parsed.length };
  }

  /** ผจก.กำหนดวันได้เฉพาะพนักงานของสาขาตัวเอง และแถววันที่อยู่สาขานี้ (รีวิว I2 · security.md: service คุมขอบเขตสาขาเอง) */
  private async assertEntriesInBranch(branchId: string, entries: Array<{ userId: string; workDate: Date }>): Promise<void> {
    const userIds = [...new Set(entries.map((e) => e.userId))];
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, branchId: true } });
    const home = new Map(users.map((u) => [u.id, u.branchId]));
    if (userIds.some((id) => home.get(id) !== branchId)) throw new ForbiddenException('กำหนดวันหยุด/ลาได้เฉพาะพนักงานของสาขาตัวเอง');
    const rows = await this.prisma.attendanceDay.findMany({
      where: { deletedAt: null, OR: entries.map((e) => ({ userId: e.userId, workDate: e.workDate })) },
      select: { userId: true, branchId: true },
    });
    if (rows.some((r) => r.branchId !== branchId)) throw new ForbiddenException('วันนั้นพนักงานลงเวลาที่สาขาอื่น — ให้ผู้จัดการสาขานั้นหรือเจ้าของแก้');
  }

  async clearConflictFlag(actor: Actor, dayId: string): Promise<AttendanceDay> {
    if (actor.role !== 'OWNER') throw new ForbiddenException('เฉพาะเจ้าของปิดธงเครื่องถูกใช้ซ้อนได้');
    const day = await this.prisma.attendanceDay.findUnique({ where: { id: dayId } });
    if (!day || day.deletedAt) throw new NotFoundException('ไม่พบแถววันทำงาน');
    const updated = await this.prisma.attendanceDay.update({ where: { id: day.id }, data: { flags: day.flags.filter((f) => f !== DEVICE_CONFLICT_FLAG) } });
    await this.audit.log({ userId: actor.id, action: 'ATTENDANCE_CONFLICT_CLEARED', entity: 'attendance_day', entityId: day.id, oldValue: { flags: day.flags }, newValue: { flags: updated.flags } });
    return updated;
  }
}
