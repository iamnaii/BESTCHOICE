import { ConflictException, Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Prisma } from '@prisma/client';
import type { AttendanceDay, AttendanceDevice, AttendancePunchKind } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { bangkokCalendarParts } from '../../utils/date.util';
import { AttendanceSettingsService } from './attendance-settings.service';
import { computeDaySummary, dbDate, FLAG_MISSING_OUT, fromDbDate, workDateOf } from './attendance-rules';

/**
 * ตอกบัตร (ก้อน 10 D3 · สเปก §4.2 §5)
 * - ทุกการกดเก็บเป็นเหตุการณ์ `AttendancePunch` (พร้อมรูป) · แถววัน `AttendanceDay` สรุปจากเหตุการณ์:
 *   clockIn = IN ครั้งแรก · clockOut = OUT ครั้งล่าสุด (OUT ซ้ำ = ทับ + OUT_UPDATED) · IN หลัง OUT = เปิดวันต่อ (REOPENED)
 * - OUT หลังเที่ยงคืนไทยของวันที่ IN ยังอยู่แถวเดิม (หาแถวเปิดค้างของเมื่อวาน)
 * - เวลา = เวลาเซิร์ฟเวอร์ที่ผู้เรียกส่งเข้ามา (ไม่รับจากอุปกรณ์) · กติกานับ = computeDaySummary ตัวเดียวกับ cron/การแก้ไข
 * - ตรวจ 409 ก่อนอัปโหลดรูป (รูปของคำขอที่ถูกปฏิเสธไม่ค้างใน storage) · อัปโหลดล้ม = ไม่มีรูป + ธง NO_PHOTO (ไม่บล็อกคนทำงาน) · tx ล้ม = ลบรูปที่อัปแล้ว
 * - `finalize(tx, result)` (ผู้เรียก = kiosk controller) หมุน token ของเครื่องใน tx เดียวกับแถวตอก ⇒ ตอกสำเร็จ = token หมุน · ล้ม = token เดิมยังใช้ได้
 * - OUT ข้ามเที่ยงคืนผูกแถวเมื่อวานได้เฉพาะแถวที่ IN มาไม่เกิน 18 ชม. (ลืมออกเมื่อวาน + กด OUT เย็นนี้ ≠ ทำงาน 33 ชม.)
 * - ธงสัญญาณประกอบ: NETWORK_CHANGED (IP ต่างจากคำขอก่อนของเครื่อง) · LOCATION_CHANGED (ห่างจุดตอกครั้งก่อนของเครื่องเกิน 500 ม.)
 */

export const FLAG_NO_PHOTO = 'NO_PHOTO';
export const FLAG_NETWORK_CHANGED = 'NETWORK_CHANGED';
export const FLAG_OUT_UPDATED = 'OUT_UPDATED';
export const FLAG_REOPENED = 'REOPENED';
export { FLAG_MISSING_OUT }; // ย้ายไป attendance-rules.ts (ใช้ร่วมกับสถานะช่อง)
export const FLAG_LOCATION_CHANGED = 'LOCATION_CHANGED';
/** ตอกเข้าภายใน 30 นาทีหลังเครื่องพักรับรหัส — สายอาจเพราะตอกไม่ได้ (รีวิว minor) */
export const FLAG_AFTER_PIN_LOCKOUT = 'AFTER_PIN_LOCKOUT';
const AFTER_PIN_LOCKOUT_MS = 30 * 60_000;
/** OUT ข้ามวันผูกแถวเมื่อวานได้ไม่เกินกี่ชั่วโมงนับจาก IN */
export const MAX_OPEN_SHIFT_HOURS = 18;
/** ระยะ (เมตร) จากจุดตอกครั้งก่อนของเครื่องที่ถือว่าย้ายที่ */
export const LOCATION_CHANGE_METERS = 500;
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

export type PunchOutcome = PunchResult & { nextToken?: string };
/** เรียกใน tx ของการตอก (หลังเขียนแถวแล้ว) — คืน token รุ่นถัดไปของเครื่อง */
export type PunchFinalize = (tx: Prisma.TransactionClient, result: PunchResult) => Promise<string | undefined>;

export interface PunchInput {
  device: Pick<AttendanceDevice, 'id' | 'branchId' | 'name' | 'lastIp'> & Partial<Pick<AttendanceDevice, 'pinLockedUntil'>>;
  userId: string;
  kind: AttendancePunchKind;
  photo?: { buffer: Buffer; mimeType: string };
  ip?: string;
  userAgent?: string;
  geo?: { lat: number; lng: number };
}

/** ลายเซ็นไฟล์ JPEG (FF D8 FF) */
const isJpeg = (b: Buffer) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** ระยะทางบนผิวโลก (เมตร) — haversine */
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
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

  async punch(input: PunchInput, now: Date = new Date(), finalize?: PunchFinalize): Promise<PunchOutcome> {
    const { device, userId, kind } = input;
    const punchId = randomUUID();
    const punchFlags: string[] = [];
    if (input.ip && device.lastIp && input.ip !== device.lastIp) punchFlags.push(FLAG_NETWORK_CHANGED);

    const rules = await this.settings.getRules(device.branchId);
    const [user, day] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, nickname: true, name: true } }),
      this.findTargetDay(userId, kind, now),
    ]);
    const nickname = user?.nickname || user?.name || '';

    if (kind === 'IN' && day?.clockIn && !day.clockOut) throw new ConflictException(`ตอกเข้าแล้วเมื่อ ${hhmm(day.clockIn)}`);
    if (kind === 'OUT' && !day?.clockIn) throw new ConflictException('ยังไม่ได้ตอกเข้างานวันนี้');

    if (input.geo && (await this.movedFromLastLocation(device.id, input.geo))) punchFlags.push(FLAG_LOCATION_CHANGED);
    const pauseEnded = device.pinLockedUntil ? now.getTime() - device.pinLockedUntil.getTime() : null;
    if (kind === 'IN' && pauseEnded !== null && pauseEnded >= 0 && pauseEnded <= AFTER_PIN_LOCKOUT_MS) punchFlags.push(FLAG_AFTER_PIN_LOCKOUT);
    const photoKey = await this.uploadPhoto(punchId, input.photo, now);
    if (!photoKey) punchFlags.push(FLAG_NO_PHOTO);

    const workDate = day ? fromDbDate(day.workDate) : workDateOf(now); // เที่ยงคืนไทย สำหรับคำนวณ
    const dayKind = day?.dayKind ?? 'WORK';
    const nextClockIn = kind === 'IN' ? (day?.clockIn && day.clockOut ? day.clockIn : now) : day!.clockIn;
    const nextClockOut = kind === 'OUT' ? now : null;
    const summary = computeDaySummary({ workDate, dayKind, clockIn: nextClockIn, clockOut: nextClockOut, rules });

    const eventFlags = new Set((day?.flags ?? []).filter((f) => !RECOMPUTED_FLAGS.has(f) && f !== FLAG_MISSING_OUT));
    if (kind === 'IN' && day?.clockOut) eventFlags.add(FLAG_REOPENED);
    if (kind === 'OUT' && day?.clockOut) eventFlags.add(FLAG_OUT_UPDATED);
    if (!photoKey) eventFlags.add(FLAG_NO_PHOTO);
    if (punchFlags.includes(FLAG_LOCATION_CHANGED)) eventFlags.add(FLAG_LOCATION_CHANGED);
    if (punchFlags.includes(FLAG_NETWORK_CHANGED)) eventFlags.add(FLAG_NETWORK_CHANGED);
    if (punchFlags.includes(FLAG_AFTER_PIN_LOCKOUT)) eventFlags.add(FLAG_AFTER_PIN_LOCKOUT);
    const dayFlags = [...eventFlags, ...summary.flags];
    const status: PunchStatus = kind === 'IN' ? (summary.lateMinutes > 0 ? 'LATE' : 'ON_TIME') : summary.otHours > 0 ? 'OUT_OT' : 'OUT';
    const result: PunchResult = { nickname, kind, at: now, status, lateMinutes: summary.lateMinutes, otHours: summary.otHours, flags: dayFlags };

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.writePunch(tx, { input, punchId, now, photoKey, punchFlags, day, workDate, dayKind, summary, dayFlags });
        const nextToken = finalize ? await finalize(tx, result) : undefined;
        return { ...result, nextToken };
      });
    } catch (err) {
      if (photoKey) await this.deletePhoto(photoKey);
      throw err;
    }
  }

  private async writePunch(
    tx: Prisma.TransactionClient,
    w: {
      input: PunchInput;
      punchId: string;
      now: Date;
      photoKey: string | null;
      punchFlags: string[];
      day: AttendanceDay | null;
      workDate: Date;
      dayKind: AttendanceDay['dayKind'];
      summary: ReturnType<typeof computeDaySummary>;
      dayFlags: string[];
    },
  ): Promise<void> {
    const { input, punchId, now, photoKey, punchFlags, day, workDate, dayKind, summary, dayFlags } = w;
    const { device, userId, kind } = input;
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
      await tx.attendanceDay.create({
        data: { userId, branchId: device.branchId, workDate: dbDate(workDate), dayKind, clockIn: now, clockInPunchId: punch.id, clockOut: null, clockOutPunchId: null, ...computed },
      });
      return;
    }
    // ใช้ฟิลด์ตรง (clockInPunchId/clockOutPunchId) แทน relation API — ตรงสัญญาในแผนและอ่านง่ายในเทส
    const data: Prisma.AttendanceDayUncheckedUpdateInput = { ...computed, dayKind };
    if (kind === 'IN') {
      if (day.clockOut) { data.clockOut = null; data.clockOutPunchId = null; }
      // แถวที่ตั้งไว้ล่วงหน้า (ยังไม่มี IN) ย้ายไปสาขาที่ตอกจริง (สเปก §9 · รีวิวรอบ 2 C10)
      if (!day.clockIn) { data.clockIn = now; data.clockInPunchId = punch.id; data.branchId = device.branchId; }
    } else {
      data.clockOut = now;
      data.clockOutPunchId = punch.id;
    }
    await tx.attendanceDay.update({ where: { id: day.id }, data });
  }

  /** ห่างจากจุดตอกครั้งก่อน (ที่มีพิกัด) ของเครื่องนี้เกิน LOCATION_CHANGE_METERS */
  private async movedFromLastLocation(deviceId: string, geo: { lat: number; lng: number }): Promise<boolean> {
    const last = await this.prisma.attendancePunch.findFirst({ where: { deviceId, geoLat: { not: null }, geoLng: { not: null } }, orderBy: { at: 'desc' }, select: { geoLat: true, geoLng: true } });
    if (!last?.geoLat || !last.geoLng) return false;
    return distanceMeters(Number(last.geoLat), Number(last.geoLng), geo.lat, geo.lng) > LOCATION_CHANGE_METERS;
  }

  private async deletePhoto(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (err) {
      this.logger.warn(`[attendance] could not delete photo ${key} after a failed punch: ${(err as Error).message}`);
      Sentry.captureException(err, { tags: { subsystem: 'attendance', action: 'photo-cleanup' }, extra: { key } });
    }
  }

  /** IN = แถวของวันนี้ · OUT = แถวของวันนี้ ถ้าไม่มี/ยังไม่ IN ให้หาแถวเปิดค้างของเมื่อวาน (ข้ามเที่ยงคืน) */
  private async findTargetDay(userId: string, kind: AttendancePunchKind, now: Date): Promise<AttendanceDay | null> {
    const today = workDateOf(now);
    const todayRow = await this.prisma.attendanceDay.findUnique({ where: { userId_workDate: { userId, workDate: dbDate(today) } } });
    if (kind === 'IN' || (todayRow && todayRow.clockIn)) return todayRow;
    const yesterday = workDateOf(new Date(today.getTime() - 60_000)); // เที่ยงคืนไทยของเมื่อวาน
    const earliestIn = new Date(now.getTime() - MAX_OPEN_SHIFT_HOURS * 3600_000);
    const open = await this.prisma.attendanceDay.findFirst({ where: { userId, workDate: dbDate(yesterday), clockOut: null, clockIn: { not: null, gte: earliestIn }, deletedAt: null } });
    return open ?? todayRow;
  }

  private async uploadPhoto(punchId: string, photo: PunchInput['photo'], now: Date): Promise<string | null> {
    if (!photo?.buffer?.length) return null;
    // ชนิดไฟล์ตัดสินจากลายเซ็นไฟล์ ไม่เชื่อ mimetype ที่เครื่องส่งมา — เครื่องตอกบัตรถ่ายเป็น JPEG เสมอ (รีวิว minor)
    if (!isJpeg(photo.buffer)) {
      this.logger.warn(`[attendance] punch ${punchId}: photo is not a JPEG — stored without a photo`);
      return null;
    }
    const { year, month } = bangkokCalendarParts(now);
    const key = `attendance/${year}/${String(month + 1).padStart(2, '0')}/${punchId}.jpg`;
    try {
      await this.storage.upload(key, photo.buffer, 'image/jpeg');
      return key;
    } catch (err) {
      this.logger.warn(`[attendance] photo upload failed for punch ${punchId}: ${(err as Error).message}`);
      Sentry.captureException(err, { tags: { subsystem: 'attendance', action: 'photo-upload' } });
      return null;
    }
  }
}
