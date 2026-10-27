import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AttendanceDay, AttendanceDayKind, Prisma } from '@prisma/client';
import type { Readable } from 'stream';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { bangkokMidnight, daysInMonth } from '../../utils/date.util';
import { AttendanceSettingsService } from './attendance-settings.service';
import { computeDaySummary, dbDate, fromDbDate, workDateOf, workDateString, type ScheduleRules } from './attendance-rules';
import { FLAG_MISSING_OUT } from './kiosk-punch.service';
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
export type TodayStatus = 'ON_TIME' | 'LATE' | 'NOT_IN' | 'DAY_OFF' | 'LEAVE' | 'SHOP_CLOSED' | 'MISSING_OUT';
export type CellStatus = TodayStatus | 'ABSENT' | 'UNAVAILABLE' | 'NONE';

export const FLAG_CORRECTED = 'CORRECTED';
export const FLAG_DEVICE_UNAVAILABLE = 'DEVICE_UNAVAILABLE';
const LEAVE_KINDS: AttendanceDayKind[] = ['LEAVE_SICK', 'LEAVE_PERSONAL', 'LEAVE_OTHER'];
const STAFF_ROLES = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES'];

export interface TodayRow {
  userId: string;
  nickname: string;
  name: string;
  role: string;
  hasPin: boolean;
  visiting: boolean;
  dayId: string | null;
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

export interface MonthSummary {
  workDays: number;
  lateCount: number;
  lateMinutes: number;
  absent: number;
  leave: number;
  otHours: number;
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0));

export function assertBranchScope(actor: Actor, branchId: string): void {
  if (actor.role === 'OWNER') return;
  if (actor.role === 'BRANCH_MANAGER' && actor.branchId && actor.branchId === branchId) return;
  throw new ForbiddenException('ดูได้เฉพาะสาขาของตัวเอง');
}

function todayStatusOf(day: Pick<AttendanceDay, 'dayKind' | 'clockIn' | 'lateMinutes' | 'flags'> | null | undefined): TodayStatus {
  if (!day) return 'NOT_IN';
  if (day.clockIn) {
    if (day.flags.includes(FLAG_MISSING_OUT)) return 'MISSING_OUT';
    return day.lateMinutes > 0 ? 'LATE' : 'ON_TIME';
  }
  if (day.dayKind === 'DAY_OFF') return 'DAY_OFF';
  if (day.dayKind === 'SHOP_CLOSED') return 'SHOP_CLOSED';
  if (LEAVE_KINDS.includes(day.dayKind)) return 'LEAVE';
  return 'NOT_IN';
}

function cellStatusOf(day: AttendanceDay, today: Date): CellStatus {
  const base = todayStatusOf(day);
  if (base !== 'NOT_IN') return base;
  if (day.flags.includes(FLAG_DEVICE_UNAVAILABLE)) return 'UNAVAILABLE';
  return fromDbDate(day.workDate).getTime() < today.getTime() ? 'ABSENT' : 'NONE';
}

function summarize(cells: Array<Pick<MonthCell, 'status' | 'clockIn' | 'lateMinutes' | 'otHours'>>): MonthSummary {
  return cells.reduce<MonthSummary>(
    (acc, c) => ({
      workDays: acc.workDays + (c.clockIn ? 1 : 0),
      lateCount: acc.lateCount + (c.lateMinutes > 0 ? 1 : 0),
      lateMinutes: acc.lateMinutes + c.lateMinutes,
      absent: acc.absent + (c.status === 'ABSENT' ? 1 : 0),
      leave: acc.leave + (c.status === 'LEAVE' ? 1 : 0),
      otHours: Math.round((acc.otHours + num(c.otHours)) * 10) / 10,
    }),
    { workDays: 0, lateCount: 0, lateMinutes: 0, absent: 0, leave: 0, otHours: 0 },
  );
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
        dayKind: day?.dayKind ?? 'WORK',
        status: todayStatusOf(day),
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
    const order: Record<TodayStatus, number> = { MISSING_OUT: 0, LATE: 1, NOT_IN: 2, ON_TIME: 3, LEAVE: 4, DAY_OFF: 5, SHOP_CLOSED: 6 };
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
    const staff = await this.prisma.user.findMany({
      where: { deletedAt: null, isActive: true, isSystemUser: false, role: { in: STAFF_ROLES as never }, OR: [{ branchId }, { attendanceDays: { some: { workDate: { gte: from, lt: to }, branchId, deletedAt: null } } }] },
      select: { id: true, nickname: true, name: true, role: true, branchId: true, attendancePinHash: true },
      orderBy: { name: 'asc' },
    });
    const rowsDb = await this.prisma.attendanceDay.findMany({ where: { deletedAt: null, workDate: { gte: from, lt: to }, OR: [{ branchId }, { userId: { in: staff.map((u) => u.id) } }] } });
    const grouped = new Map<string, AttendanceDay[]>();
    for (const d of rowsDb) grouped.set(d.userId, [...(grouped.get(d.userId) ?? []), d]);
    const rows = staff.map((u) => {
      const cells: Record<string, MonthCell> = {};
      for (const d of grouped.get(u.id) ?? []) cells[workDateString(fromDbDate(d.workDate))] = cellOf(d, today);
      return { userId: u.id, nickname: u.nickname || u.name, name: u.name, role: u.role, hasPin: !!u.attendancePinHash, visiting: u.branchId !== branchId, cells, summary: summarize(Object.values(cells)) };
    });
    return { month, days, rows };
  }

  async me(userId: string, month: string, now: Date = new Date()) {
    const { from, to } = parseMonth(month);
    const today = workDateOf(now);
    const rowsDb = await this.prisma.attendanceDay.findMany({ where: { userId, deletedAt: null, workDate: { gte: from, lt: to } }, orderBy: { workDate: 'desc' } });
    const rows = rowsDb.map((d) => ({ date: workDateString(fromDbDate(d.workDate)), ...cellOf(d, today), correctedCount: d.correctedCount }));
    return { month, rows, summary: summarize(rows) };
  }

  async photoStream(actor: Actor, punchId: string): Promise<{ stream: Readable; contentType: string }> {
    const punch = await this.prisma.attendancePunch.findUnique({ where: { id: punchId }, select: { id: true, branchId: true, photoKey: true } });
    if (!punch) throw new NotFoundException('ไม่พบรายการตอกบัตร');
    assertBranchScope(actor, punch.branchId);
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

    const clockIn = dto.clockIn !== undefined ? new Date(dto.clockIn) : day.clockIn;
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
        data: { clockIn, clockOut, dayKind, workedMinutes: summary.workedMinutes, lateMinutes: summary.lateMinutes, earlyLeaveMinutes: summary.earlyLeaveMinutes, otHours: summary.otHours, flags, correctedCount: day.correctedCount + 1 },
      });
      await tx.attendanceCorrection.create({ data: { dayId: day.id, changedById: actor.id, reason, before: before as Prisma.InputJsonValue, after: after as Prisma.InputJsonValue } });
      return row;
    });
    await this.audit.log({ userId: actor.id, action: 'ATTENDANCE_CORRECTED', entity: 'attendance_day', entityId: day.id, oldValue: before, newValue: { ...after, reason, targetUserId: day.userId } });
    return updated;
  }

  async setDayKinds(actor: Actor, dto: SetDayKindsDto): Promise<{ updated: number }> {
    assertBranchScope(actor, dto.branchId);
    if (actor.role !== 'OWNER' && dto.entries.some((e) => e.userId === actor.id)) throw new ForbiddenException('กำหนดวันหยุด/ลาของตัวเองไม่ได้ ให้เจ้าของทำ');
    const parsed = dto.entries.map((e) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.date);
      if (!m) throw new BadRequestException(`วันที่ไม่ถูกต้อง: ${e.date}`);
      return { ...e, workDate: dbDate(bangkokMidnight(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) };
    });
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

  async clearConflictFlag(actor: Actor, dayId: string): Promise<AttendanceDay> {
    if (actor.role !== 'OWNER') throw new ForbiddenException('เฉพาะเจ้าของปิดธงเครื่องถูกใช้ซ้อนได้');
    const day = await this.prisma.attendanceDay.findUnique({ where: { id: dayId } });
    if (!day || day.deletedAt) throw new NotFoundException('ไม่พบแถววันทำงาน');
    const updated = await this.prisma.attendanceDay.update({ where: { id: day.id }, data: { flags: day.flags.filter((f) => f !== DEVICE_CONFLICT_FLAG) } });
    await this.audit.log({ userId: actor.id, action: 'ATTENDANCE_CONFLICT_CLEARED', entity: 'attendance_day', entityId: day.id, oldValue: { flags: day.flags }, newValue: { flags: updated.flags } });
    return updated;
  }
}
