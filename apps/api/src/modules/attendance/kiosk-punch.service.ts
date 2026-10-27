import { ConflictException, Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Prisma } from '@prisma/client';
import type { AttendanceDay, AttendanceDevice, AttendancePunchKind } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { bangkokCalendarParts } from '../../utils/date.util';
import { AttendanceSettingsService } from './attendance-settings.service';
import { computeDaySummary, dbDate, fromDbDate, workDateOf } from './attendance-rules';

/**
 * ตอกบัตร (ก้อน 10 D3 · สเปก §4.2 §5)
 * - ทุกการกดเก็บเป็นเหตุการณ์ `AttendancePunch` (พร้อมรูป) · แถววัน `AttendanceDay` สรุปจากเหตุการณ์:
 *   clockIn = IN ครั้งแรก · clockOut = OUT ครั้งล่าสุด (OUT ซ้ำ = ทับ + OUT_UPDATED) · IN หลัง OUT = เปิดวันต่อ (REOPENED)
 * - OUT หลังเที่ยงคืนไทยของวันที่ IN ยังอยู่แถวเดิม (หาแถวเปิดค้างของเมื่อวาน)
 * - เวลา = เวลาเซิร์ฟเวอร์ที่ผู้เรียกส่งเข้ามา (ไม่รับจากอุปกรณ์) · กติกานับ = computeDaySummary ตัวเดียวกับ cron/การแก้ไข
 * - รูปอัปโหลดก่อน tx · ล้มเหลว = ไม่มีรูป + ธง NO_PHOTO (ไม่บล็อกคนทำงาน)
 */

export const FLAG_NO_PHOTO = 'NO_PHOTO';
export const FLAG_NETWORK_CHANGED = 'NETWORK_CHANGED';
export const FLAG_OUT_UPDATED = 'OUT_UPDATED';
export const FLAG_REOPENED = 'REOPENED';
export const FLAG_MISSING_OUT = 'MISSING_OUT';
/** ธงที่ computeDaySummary คำนวณใหม่ทุกครั้ง (ลบก่อนรวม) — ที่เหลือเป็นธงเหตุการณ์ คงไว้ */
const RECOMPUTED_FLAGS = new Set(['WORKED_ON_OFF_DAY']);

export type PunchStatus = 'ON_TIME' | 'LATE' | 'OUT' | 'OUT_OT';

export interface PunchResult {
  nickname: string;
  kind: AttendancePunchKind;
  at: Date;
  status: PunchStatus;
  lateMinutes: number;
  otHours: number;
  flags: string[];
}

export interface PunchInput {
  device: Pick<AttendanceDevice, 'id' | 'branchId' | 'name' | 'lastIp'>;
  userId: string;
  kind: AttendancePunchKind;
  photo?: { buffer: Buffer; mimeType: string };
  ip?: string;
  userAgent?: string;
  geo?: { lat: number; lng: number };
}

const hhmm = (d: Date) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  return `${parts.find((p) => p.type === 'hour')?.value}:${parts.find((p) => p.type === 'minute')?.value}`;
};

@Injectable()
export class KioskPunchService {
  private readonly logger = new Logger(KioskPunchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AttendanceSettingsService,
    private readonly storage: StorageService,
  ) {}

  async punch(input: PunchInput, now: Date = new Date()): Promise<PunchResult> {
    const { device, userId, kind } = input;
    const punchId = randomUUID();
    const punchFlags: string[] = [];
    if (input.ip && device.lastIp && input.ip !== device.lastIp) punchFlags.push(FLAG_NETWORK_CHANGED);

    const photoKey = await this.uploadPhoto(punchId, input.photo, now);
    if (!photoKey) punchFlags.push(FLAG_NO_PHOTO);

    const rules = await this.settings.getRules(device.branchId);
    const [user, day] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, nickname: true, name: true } }),
      this.findTargetDay(userId, kind, now),
    ]);
    const nickname = user?.nickname || user?.name || '';

    if (kind === 'IN' && day?.clockIn && !day.clockOut) throw new ConflictException(`ตอกเข้าแล้วเมื่อ ${hhmm(day.clockIn)}`);
    if (kind === 'OUT' && !day?.clockIn) throw new ConflictException('ยังไม่ได้ตอกเข้างานวันนี้');

    const workDate = day ? fromDbDate(day.workDate) : workDateOf(now); // เที่ยงคืนไทย สำหรับคำนวณ
    const dayKind = day?.dayKind ?? 'WORK';
    const nextClockIn = kind === 'IN' ? (day?.clockIn && day.clockOut ? day.clockIn : now) : day!.clockIn;
    const nextClockOut = kind === 'OUT' ? now : null;
    const summary = computeDaySummary({ workDate, dayKind, clockIn: nextClockIn, clockOut: nextClockOut, rules });

    const eventFlags = new Set((day?.flags ?? []).filter((f) => !RECOMPUTED_FLAGS.has(f) && f !== FLAG_MISSING_OUT));
    if (kind === 'IN' && day?.clockOut) eventFlags.add(FLAG_REOPENED);
    if (kind === 'OUT' && day?.clockOut) eventFlags.add(FLAG_OUT_UPDATED);
    if (!photoKey) eventFlags.add(FLAG_NO_PHOTO);
    const dayFlags = [...eventFlags, ...summary.flags];

    const saved = await this.prisma.$transaction(async (tx) => {
      const punch = await tx.attendancePunch.create({
        data: {
          id: punchId,
          deviceId: device.id,
          userId,
          branchId: device.branchId,
          kind,
          at: now,
          photoKey,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
          geoLat: input.geo ? new Prisma.Decimal(input.geo.lat) : null,
          geoLng: input.geo ? new Prisma.Decimal(input.geo.lng) : null,
          flags: punchFlags,
        },
      });
      const computed = {
        workedMinutes: summary.workedMinutes,
        lateMinutes: summary.lateMinutes,
        earlyLeaveMinutes: summary.earlyLeaveMinutes,
        otHours: summary.otHours,
        flags: dayFlags,
      };
      if (!day) {
        return tx.attendanceDay.create({
          data: { userId, branchId: device.branchId, workDate: dbDate(workDate), dayKind, clockIn: now, clockInPunchId: punch.id, clockOut: null, clockOutPunchId: null, ...computed },
        });
      }
      // ใช้ฟิลด์ตรง (clockInPunchId/clockOutPunchId) แทน relation API — ตรงสัญญาในแผนและอ่านง่ายในเทส
      const data: Prisma.AttendanceDayUncheckedUpdateInput = { ...computed, dayKind };
      if (kind === 'IN') {
        if (day.clockOut) { data.clockOut = null; data.clockOutPunchId = null; }
        if (!day.clockIn) { data.clockIn = now; data.clockInPunchId = punch.id; }
      } else {
        data.clockOut = now;
        data.clockOutPunchId = punch.id;
      }
      return tx.attendanceDay.update({ where: { id: day.id }, data });
    });

    const status: PunchStatus = kind === 'IN' ? (summary.lateMinutes > 0 ? 'LATE' : 'ON_TIME') : summary.otHours > 0 ? 'OUT_OT' : 'OUT';
    return { nickname, kind, at: now, status, lateMinutes: summary.lateMinutes, otHours: summary.otHours, flags: saved.flags ?? dayFlags };
  }

  /** IN = แถวของวันนี้ · OUT = แถวของวันนี้ ถ้าไม่มี/ยังไม่ IN ให้หาแถวเปิดค้างของเมื่อวาน (ข้ามเที่ยงคืน) */
  private async findTargetDay(userId: string, kind: AttendancePunchKind, now: Date): Promise<AttendanceDay | null> {
    const today = workDateOf(now);
    const todayRow = await this.prisma.attendanceDay.findUnique({ where: { userId_workDate: { userId, workDate: dbDate(today) } } });
    if (kind === 'IN' || (todayRow && todayRow.clockIn)) return todayRow;
    const yesterday = workDateOf(new Date(today.getTime() - 60_000)); // เที่ยงคืนไทยของเมื่อวาน
    const open = await this.prisma.attendanceDay.findFirst({ where: { userId, workDate: dbDate(yesterday), clockOut: null, clockIn: { not: null }, deletedAt: null } });
    return open ?? todayRow;
  }

  private async uploadPhoto(punchId: string, photo: PunchInput['photo'], now: Date): Promise<string | null> {
    if (!photo?.buffer?.length) return null;
    const { year, month } = bangkokCalendarParts(now);
    const key = `attendance/${year}/${String(month + 1).padStart(2, '0')}/${punchId}.jpg`;
    try {
      await this.storage.upload(key, photo.buffer, photo.mimeType || 'image/jpeg');
      return key;
    } catch (err) {
      this.logger.warn(`[attendance] photo upload failed for punch ${punchId}: ${(err as Error).message}`);
      Sentry.captureException(err, { tags: { subsystem: 'attendance', action: 'photo-upload' } });
      return null;
    }
  }
}
