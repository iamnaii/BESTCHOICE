import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Prisma } from '@prisma/client';
import type { AttendanceDevice, AttendanceDeviceEventKind } from '@prisma/client';
import { KioskBusyException } from './kiosk-errors';
import { dbDate, workDateOf } from './attendance-rules';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { hashPII } from '../../utils/pii.util';
import { findPaidPayroll, periodOfWorkDate } from './attendance-payroll-lock';
import {
  PIN_LOCK_MS,
  PIN_LOCK_THRESHOLD,
  REGISTRATION_TTL_MS,
  hashToken,
  newRawToken,
  newRegistrationCode,
  normalizeRegistrationCode,
} from './attendance-token.util';

/**
 * เครื่องตอกบัตรประจำสาขา (ก้อน 10 D3 · สเปก §4.1 §4.3)
 * - ลงทะเบียนด้วยรหัส 8 ตัว (ใช้ครั้งเดียว 10 นาที) → device ACTIVE รุ่น 1 + token
 * - token หมุน (รุ่น N → N+1) **เฉพาะเมื่องานสำเร็จ** ใน tx เดียวกับงาน + จำคำตอบ (`commitRotation`) ⇒ งานล้ม/รหัสผิด/409 = token เดิมยังใช้ได้
 *   (รีวิว C1/C2: เดิมหมุนก่อนทำงาน งานล้มแล้วเครื่องไม่ได้ token ใหม่ → คำขอถัดไปถูกนับว่าชน → ล็อกเอง)
 * - requestId ซ้ำ = คืนคำตอบเดิม · คำตอบสำเร็จที่หาย: ส่งซ้ำด้วย token ที่ใช้ไปแล้ว + requestId เดิม → ออก token รุ่นถัดไปใหม่ (re-key) ไม่ถือว่าชน
 *   (คำตอบที่จำไว้ไม่มี token ดิบ — เก็บเฉพาะ hash ตามสเปก)
 * - token รุ่นเก่า + requestId อื่น = มีคนถือ token ที่หมุนไปแล้ว → LOCKED · ติดธง DEVICE_CONFLICT ย้อนถึง "จุดแยก" = เวลาที่ token รุ่นนั้นถูกใช้
 *   (รีวิว C4: เดิมย้อนถึง heartbeat สะอาดล่าสุด ซึ่ง heartbeat ของเครื่องที่คัดลอกเลื่อนไปได้) · Todo HIGH ถึงเจ้าของ
 * - สองคำขอแข่งกันหมุนรุ่นเดียวกัน → ผู้แพ้ได้ 409 REQUEST_BUSY (ลองใหม่) ไม่ใช่ล็อก (รีวิว I5)
 * - รหัสตอกบัตรผิด 5 ครั้ง → เครื่องพักรับรหัส 15 นาที
 * - ไม่ลอก grace 10 วินาทีของ auth (แบบนั้นออกคู่ใหม่ซ้อนและทำเครื่องจริงล็อก) — ใช้ requestId idempotency แทน
 */

export const DEVICE_CONFLICT_FLAG = 'DEVICE_CONFLICT';
export const ATTENDANCE_TODO_TAG = 'attendance';
export const DEVICE_REVOKED_CODE = 'DEVICE_REVOKED';
export const DEVICE_LOCKED_CODE = 'DEVICE_LOCKED';

export type DeviceWithBranch = AttendanceDevice & { branch?: { id: string; name: string } | null };

export interface AuthenticatedDevice {
  device: DeviceWithBranch;
  /** token ที่เครื่องส่งมา (รุ่นปัจจุบัน) — `commitRotation` ใช้หมุน */
  token: { id: string; generation: number; usedAt: Date | null };
  /** คำขอนี้เคยตอบแล้ว (requestId ซ้ำ) — ผู้เรียกตอบค่านี้ทันทีโดยไม่ทำงานซ้ำ (status ≥ 400 = โยนเป็น error เดิม) */
  replay?: { status: number; body: Record<string, unknown> };
}

export interface RotationContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
  now: Date;
}

/** แถว `AttendanceDeviceRequest.responseJson` */
interface CachedReply {
  status: number;
  body: Record<string, unknown>;
  /** รุ่นของ token ที่คำขอนี้ใช้หมุน (null = คำตอบ error ที่ไม่ได้หมุน) */
  consumedGeneration: number | null;
}

function parseCachedReply(json: unknown): CachedReply {
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  if ('status' in o && 'body' in o) {
    return {
      status: Number(o.status) || 200,
      body: (o.body && typeof o.body === 'object' ? o.body : {}) as Record<string, unknown>,
      consumedGeneration: typeof o.consumedGeneration === 'number' ? o.consumedGeneration : null,
    };
  }
  return { status: 200, body: o, consumedGeneration: null }; // แถวรูปเดิมก่อนรีวิว (มีเฉพาะฐาน dev)
}

export type PinCheck = { userId: string } | 'LOCKED' | 'INVALID';

const unauthorized = (code: string, message: string) => new UnauthorizedException({ code, message });

@Injectable()
export class AttendanceDeviceService {
  private readonly logger = new Logger(AttendanceDeviceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async issueRegistrationCode(branchId: string, actorId: string, now: Date = new Date()): Promise<{ code: string; expiresAt: Date }> {
    const code = newRegistrationCode();
    const expiresAt = new Date(now.getTime() + REGISTRATION_TTL_MS);
    await this.prisma.attendanceRegistrationCode.create({ data: { branchId, codeHash: hashToken(code), expiresAt, createdById: actorId } });
    return { code, expiresAt };
  }

  async register(
    input: { code: string; deviceName: string; ip?: string; userAgent?: string },
    now: Date = new Date(),
  ): Promise<{ deviceToken: string; device: { id: string; branchId: string; branchName: string; name: string } }> {
    const code = await this.prisma.attendanceRegistrationCode.findUnique({
      where: { codeHash: hashToken(normalizeRegistrationCode(input.code)) },
      include: { branch: { select: { id: true, name: true } } },
    });
    if (!code || code.usedAt || code.expiresAt.getTime() <= now.getTime()) {
      throw new BadRequestException('รหัสลงทะเบียนไม่ถูกต้องหรือหมดอายุ');
    }
    const raw = newRawToken();
    const created = await this.prisma.$transaction(async (tx) => {
      // อ้างสิทธิ์รหัสแบบมีเงื่อนไข — สองเครื่องกรอกรหัสเดียวกันพร้อมกัน ได้เครื่องเดียว
      const claimed = await tx.attendanceRegistrationCode.updateMany({ where: { id: code.id, usedAt: null }, data: { usedAt: now } });
      if (claimed.count !== 1) throw new BadRequestException('รหัสลงทะเบียนไม่ถูกต้องหรือหมดอายุ');
      const device = await tx.attendanceDevice.create({
        data: {
          branchId: code.branchId,
          name: input.deviceName.trim(),
          status: 'ACTIVE',
          currentGeneration: 1,
          registeredById: code.createdById,
          createdAt: now,
          lastSeenAt: now,
          lastCleanHeartbeatAt: now,
          lastIp: input.ip ?? null,
          lastUserAgent: input.userAgent ?? null,
        },
      });
      await tx.attendanceDeviceToken.create({ data: { deviceId: device.id, generation: 1, tokenHash: hashToken(raw), issuedAt: now } });
      await tx.attendanceDeviceEvent.create({ data: { deviceId: device.id, kind: 'REGISTERED', ip: input.ip ?? null, userAgent: input.userAgent ?? null, detail: { deviceName: input.deviceName } } });
      return device;
    });
    return { deviceToken: raw, device: { id: created.id, branchId: created.branchId, branchName: code.branch.name, name: created.name } };
  }

  /** ตรวจ token + requestId · ตรวจชน — ใช้กับทุกคำขอจากเครื่อง (punch/heartbeat) · ไม่หมุน (หมุนตอน `commitRotation`) */
  async authenticate(input: { deviceToken: string; requestId: string; ip?: string; userAgent?: string }, now: Date = new Date()): Promise<AuthenticatedDevice> {
    const row = await this.prisma.attendanceDeviceToken.findUnique({
      where: { tokenHash: hashToken(input.deviceToken) },
      include: { device: { include: { branch: { select: { id: true, name: true } } } } },
    });
    if (!row) throw unauthorized(DEVICE_REVOKED_CODE, 'เครื่องนี้ยังไม่ได้ลงทะเบียน หรือถูกยกเลิกแล้ว');
    const device = row.device as DeviceWithBranch;
    const token = { id: row.id, generation: row.generation, usedAt: row.usedAt ?? null };
    if (device.status === 'REVOKED' || device.deletedAt) throw unauthorized(DEVICE_REVOKED_CODE, 'เครื่องนี้ถูกยกเลิกแล้ว — ลงทะเบียนใหม่');
    if (device.status === 'LOCKED') throw unauthorized(DEVICE_LOCKED_CODE, 'เครื่องนี้ถูกล็อก — ติดต่อเจ้าของ');

    const cached = await this.prisma.attendanceDeviceRequest.findUnique({ where: { deviceId_requestId: { deviceId: device.id, requestId: input.requestId } } });
    if (cached) {
      const replay = await this.replayFor(device, token, parseCachedReply(cached.responseJson));
      if (replay) return { device, token, replay };
      // ห่วงโซ่หมุนต่อไปแล้ว แต่มีคนส่งคำขอเก่าด้วย token เก่า = token ถูกคัดลอก
    } else if (token.generation === device.currentGeneration) {
      return { device, token };
    }
    await this.lockForConflict(device, token, input, now);
    throw unauthorized(DEVICE_LOCKED_CODE, 'เครื่องนี้ถูกล็อก — รหัสเครื่องถูกใช้จากสองที่');
  }

  /**
   * งานถูกปฏิเสธ (เช่น 409 ตอกเข้าแล้ว) ขณะที่คำขอเดียวกันครั้งแรกเพิ่ง commit ไป: ส่งคำตอบของครั้งแรกแทน
   * ไม่งั้นเครื่องค้าง token เก่าแล้วคำขอถัดไปถูกนับว่าชน (รีวิวรอบ 2 C17)
   */
  async replayIfCached(auth: Pick<AuthenticatedDevice, 'device' | 'token'>, requestId: string): Promise<{ status: number; body: Record<string, unknown> } | null> {
    const cached = await this.prisma.attendanceDeviceRequest.findUnique({ where: { deviceId_requestId: { deviceId: auth.device.id, requestId } } });
    if (!cached) return null;
    const device = (await this.prisma.attendanceDevice.findUnique({ where: { id: auth.device.id } })) ?? auth.device;
    return this.replayFor(device as DeviceWithBranch, auth.token, parseCachedReply(cached.responseJson));
  }

  private async replayFor(device: Pick<AttendanceDevice, 'id' | 'currentGeneration'>, token: { generation: number }, reply: CachedReply): Promise<{ status: number; body: Record<string, unknown> } | null> {
    if (reply.consumedGeneration === null) return { status: reply.status, body: reply.body };
    if (token.generation === device.currentGeneration) return { status: reply.status, body: reply.body }; // เครื่องได้ token รุ่นถัดไปแล้ว
    if (token.generation === reply.consumedGeneration && device.currentGeneration === reply.consumedGeneration + 1) {
      const nextToken = await this.rekeyGeneration(device.id, device.currentGeneration);
      return { status: reply.status, body: { ...reply.body, nextDeviceToken: nextToken } };
    }
    return null;
  }

  /**
   * หมุน token ใน tx ของงานที่สำเร็จ + จำคำตอบ (ไม่มี token ดิบ) — คืน token รุ่นถัดไป
   * รุ่นถูกหมุนไปแล้วโดยคำขออื่น (แข่งกัน) → 409 REQUEST_BUSY ให้เครื่องลองใหม่ด้วยคำขอเดิม
   */
  async commitRotation(tx: Prisma.TransactionClient, auth: Pick<AuthenticatedDevice, 'device' | 'token'>, ctx: RotationContext, body: Record<string, unknown>): Promise<string> {
    const current = auth.token.generation;
    const moved = await tx.attendanceDevice.updateMany({
      where: { id: auth.device.id, currentGeneration: current, status: 'ACTIVE', deletedAt: null },
      data: { currentGeneration: current + 1, lastSeenAt: ctx.now, lastIp: ctx.ip ?? null, lastUserAgent: ctx.userAgent ?? null },
    });
    if (moved.count !== 1) throw new KioskBusyException();
    await tx.attendanceDeviceToken.update({ where: { id: auth.token.id }, data: { usedAt: ctx.now } });
    const nextToken = newRawToken();
    await tx.attendanceDeviceToken.create({ data: { deviceId: auth.device.id, generation: current + 1, tokenHash: hashToken(nextToken), issuedAt: ctx.now } });
    const reply: CachedReply = { status: 200, body, consumedGeneration: current };
    await tx.attendanceDeviceRequest.create({ data: { deviceId: auth.device.id, requestId: ctx.requestId, responseJson: reply as unknown as Prisma.InputJsonValue } });
    return nextToken;
  }

  /** heartbeat สำเร็จ = เวลาติดต่อสะอาดล่าสุด + หมุน token ใน tx เดียวกัน */
  async heartbeat<T extends Record<string, unknown>>(auth: Pick<AuthenticatedDevice, 'device' | 'token'>, ctx: RotationContext, buildBody: (device: DeviceWithBranch) => T): Promise<{ body: T; nextToken: string }> {
    const body = buildBody(auth.device);
    const nextToken = await this.prisma.$transaction(async (tx) => {
      await tx.attendanceDevice.update({ where: { id: auth.device.id }, data: { lastCleanHeartbeatAt: ctx.now } });
      return this.commitRotation(tx, auth, ctx, body);
    });
    return { body, nextToken };
  }

  /** จำคำตอบ error (รหัสผิด/พักรหัส) ไว้ส่งซ้ำได้ผลเดิม โดยไม่นับรหัสผิดซ้ำ — ไม่หมุน token · best effort */
  async rememberError(deviceId: string, requestId: string, status: number, body: Record<string, unknown>): Promise<void> {
    const reply: CachedReply = { status, body, consumedGeneration: null };
    try {
      await this.prisma.attendanceDeviceRequest.create({ data: { deviceId, requestId, responseJson: reply as unknown as Prisma.InputJsonValue } });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') return;
      this.logger.warn(`[attendance] could not cache kiosk error reply: ${(err as Error).message}`);
    }
  }

  /** คำตอบสำเร็จหาย: ออก token ใหม่ให้รุ่นที่เครื่องยังไม่เคยได้รับ (ยังไม่ถูกใช้) */
  private async rekeyGeneration(deviceId: string, generation: number): Promise<string> {
    const nextToken = newRawToken();
    const rekeyed = await this.prisma.attendanceDeviceToken.updateMany({ where: { deviceId, generation, usedAt: null }, data: { tokenHash: hashToken(nextToken) } });
    if (rekeyed.count !== 1) throw new KioskBusyException();
    return nextToken;
  }

  private async lockForConflict(device: DeviceWithBranch, staleToken: { generation: number; usedAt: Date | null }, input: { ip?: string; userAgent?: string }, now: Date): Promise<void> {
    // จุดแยก = เวลาที่ token รุ่นที่ถูกนำมาใช้ซ้ำถูกใช้ไปครั้งแรก (หลังจากนั้นมีสองฝั่งถือห่วงโซ่)
    const since = staleToken.usedAt ?? device.lastCleanHeartbeatAt ?? device.createdAt;
    const flaggedPairs: Array<{ userId: string; workDate: Date }> = [];
    await this.prisma.$transaction(async (tx) => {
      // ลำดับล็อก: แถวเครื่อง → แถววัน (เรียง user_id, work_date) — เหมือน tx ตอกบัตรของ kiosk-punch/setDayKinds ⇒ ไม่ deadlock
      await tx.attendanceDevice.update({ where: { id: device.id }, data: { status: 'LOCKED' } });
      await tx.attendanceDeviceEvent.create({
        data: {
          deviceId: device.id,
          kind: 'TOKEN_CONFLICT',
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
          detail: { generationUsed: staleToken.generation, currentGeneration: device.currentGeneration, since: since.toISOString(), lastIp: device.lastIp ?? null },
        },
      });
      const suspects = await tx.attendancePunch.findMany({ where: { deviceId: device.id, at: { gte: since, lte: now } }, select: { id: true, userId: true, at: true } });
      const ids = suspects.map((p) => p.id);
      if (ids.length) {
        const notFlagged = { NOT: { flags: { has: DEVICE_CONFLICT_FLAG } } };
        await tx.attendancePunch.updateMany({ where: { id: { in: ids }, ...notFlagged }, data: { flags: { push: DEVICE_CONFLICT_FLAG } } });
        // แถววันอ้างแค่ IN แรก/OUT ล่าสุด ⇒ ตามด้วย (คน, วัน) ของทุกการกดที่สงสัย (เช่น IN หลัง OUT ที่เปิดวันต่อ)
        const pairs = new Map<string, { userId: string; workDate: Date }>();
        for (const p of suspects) {
          const workDate = dbDate(workDateOf(p.at));
          pairs.set(`${p.userId}:${workDate.toISOString()}`, { userId: p.userId, workDate });
        }
        flaggedPairs.push(...pairs.values());
        // ล็อกแถววันที่จะติดธงเรียง (user_id, work_date) ก่อน — setDayKinds ล็อกลำดับเดียวกัน ⇒ ไม่ deadlock (40P01)
        await tx.$queryRaw(Prisma.sql`SELECT id FROM attendance_days WHERE deleted_at IS NULL AND (clock_in_punch_id IN (${Prisma.join(ids)}) OR clock_out_punch_id IN (${Prisma.join(ids)}) OR (user_id, work_date) IN (${Prisma.join([...pairs.values()].map((p) => Prisma.sql`(${p.userId}, ${p.workDate}::date)`))})) ORDER BY user_id, work_date FOR UPDATE`);
        await tx.attendanceDay.updateMany({
          where: { OR: [{ clockInPunchId: { in: ids } }, { clockOutPunchId: { in: ids } }, ...pairs.values()], deletedAt: null, ...notFlagged },
          data: { flags: { push: DEVICE_CONFLICT_FLAG } },
        });
      }
    });
    const paidLines = await this.paidMonthTodoLines(flaggedPairs);
    await this.createOwnerTodo({
      title: `เครื่องตอกบัตร "${device.name}" ถูกใช้จากสองที่ — ล็อกแล้ว ตรวจรายการที่ติดธงก่อนปลด`,
      description:
        `สาขา ${device.branch?.name ?? device.branchId} · พบ token รุ่น ${staleToken.generation} ถูกใช้ซ้ำขณะรุ่นปัจจุบันคือ ${device.currentGeneration} · ${now.toISOString()}\n` +
        `รายการตอกตั้งแต่ ${since.toISOString()} ติดธง "เครื่องถูกใช้ซ้อน" ที่เมนู ลงเวลา (เจ้าของกด แก้ไข › ตรวจแล้ว ล้างธง) · ปลดล็อก/ลงทะเบียนใหม่ที่ ตั้งค่า › บริษัท & สาขา › เครื่องตอกบัตร · deviceId: ${device.id}` +
        paidLines,
      priority: 'HIGH',
    });
  }

  /** วันที่ติดธงที่อยู่ในเดือนซึ่งจ่ายเงินเดือนแล้ว → บรรทัดต่อท้าย Todo เจ้าของ (ล้มเหลวไม่ขวางการล็อกเครื่อง) */
  private async paidMonthTodoLines(pairs: Array<{ userId: string; workDate: Date }>): Promise<string> {
    try {
      const numbers = new Set<string>();
      const seen = new Set<string>();
      for (const p of pairs) {
        const period = periodOfWorkDate(p.workDate);
        if (seen.has(`${p.userId}:${period}`)) continue;
        seen.add(`${p.userId}:${period}`);
        const paid = await findPaidPayroll(this.prisma, p.userId, period);
        if (paid) numbers.add(paid.number);
      }
      return [...numbers].sort().map((n) => `\nวันที่ติดธงอยู่ในเดือนที่จ่ายเงินเดือนแล้ว (ใบ ${n}) — ถ้าตอกแทนกันจริง ให้ใส่รายการหักในใบเงินเดือนงวดถัดไป`).join('');
    } catch (err) {
      this.logger.warn(`[attendance] paid-month lookup for the conflict Todo failed: ${(err as Error).message}`);
      return '';
    }
  }

  /**
   * รหัสตอกบัตร 6 หลัก → ผู้ใช้ · ล็อกต่อเครื่อง (ไม่ใช่ต่อคน เพราะยังไม่รู้ว่าเป็นใคร)
   * ผิด 5 ครั้งภายใน 15 นาที → พักรับรหัส 15 นาที · ตัวนับเพิ่มใน SQL คำสั่งเดียว (คำขอพร้อมกันนับครบทุกครั้ง)
   */
  async checkPin(deviceId: string, pin: string, now: Date = new Date()): Promise<PinCheck> {
    const device = await this.prisma.attendanceDevice.findUnique({ where: { id: deviceId } });
    if (!device) throw unauthorized(DEVICE_REVOKED_CODE, 'ไม่พบเครื่อง');
    if (device.pinLockedUntil && device.pinLockedUntil.getTime() > now.getTime()) return 'LOCKED';

    const salt = process.env.PII_HASH_SALT || '';
    const user = await this.prisma.user.findFirst({ where: { attendancePinHash: hashPII(pin, salt), deletedAt: null, isActive: true }, select: { id: true } });
    if (user) {
      await this.prisma.attendanceDevice.update({ where: { id: device.id }, data: { pinFailCount: 0, pinLastFailAt: null } });
      return { userId: user.id };
    }

    const windowStart = new Date(now.getTime() - PIN_LOCK_MS);
    const rows = await this.prisma.$queryRaw<Array<{ pin_fail_count: number }>>`
      UPDATE "attendance_devices"
         SET "pin_fail_count" = CASE WHEN "pin_last_fail_at" IS NULL OR "pin_last_fail_at" < ${windowStart} THEN 1 ELSE "pin_fail_count" + 1 END,
             "pin_last_fail_at" = ${now}
       WHERE "id" = ${device.id}
   RETURNING "pin_fail_count"`;
    const fails = Number(rows[0]?.pin_fail_count ?? 1);
    if (fails < PIN_LOCK_THRESHOLD) return 'INVALID';

    const pinLockedUntil = new Date(now.getTime() + PIN_LOCK_MS);
    const locked = await this.prisma.attendanceDevice.updateMany({
      where: { id: device.id, OR: [{ pinLockedUntil: null }, { pinLockedUntil: { lte: now } }] },
      data: { pinFailCount: 0, pinLastFailAt: null, pinLockedUntil },
    });
    if (locked.count === 1) {
      await this.prisma.attendanceDeviceEvent.create({ data: { deviceId: device.id, kind: 'PIN_LOCKOUT', detail: { until: pinLockedUntil.toISOString() } } });
      await this.createOwnerTodo({
        title: `เครื่องตอกบัตร "${device.name}" ถูกใส่รหัสผิด ${PIN_LOCK_THRESHOLD} ครั้ง — พักรับรหัส 15 นาที`,
        description: `เวลา ${now.toISOString()} · ถ้าไม่ใช่พนักงานลืมรหัส อาจมีคนลองเดา · การตอกเข้าหลังพักรหัสติดธง "หลังพักรหัส" ให้ตรวจก่อนนับสาย · deviceId: ${device.id}`,
        priority: 'MEDIUM',
      });
    }
    return 'LOCKED';
  }

  async revoke(deviceId: string, actorId: string): Promise<void> {
    await this.closeDevice(deviceId, actorId, 'REVOKED', 'ATTENDANCE_DEVICE_REVOKED', () => true);
  }

  /** เจ้าของตรวจเคสชนแล้วปิด — เครื่องต้องลงทะเบียนใหม่ (ได้แถว device ใหม่) */
  async unlock(deviceId: string, actorId: string): Promise<void> {
    await this.closeDevice(deviceId, actorId, 'UNLOCKED', 'ATTENDANCE_DEVICE_UNLOCKED', (d) => d.status === 'LOCKED');
  }

  private async closeDevice(deviceId: string, actorId: string, event: AttendanceDeviceEventKind, action: string, allowed: (d: AttendanceDevice) => boolean): Promise<void> {
    const device = await this.prisma.attendanceDevice.findUnique({ where: { id: deviceId } });
    if (!device || device.deletedAt) throw new NotFoundException('ไม่พบเครื่องตอกบัตร');
    if (!allowed(device)) throw new BadRequestException('ปลดล็อกได้เฉพาะเครื่องที่ถูกล็อก');
    await this.prisma.$transaction(async (tx) => {
      await tx.attendanceDevice.update({ where: { id: device.id }, data: { status: 'REVOKED' } });
      await tx.attendanceDeviceEvent.create({ data: { deviceId: device.id, kind: event, detail: { actorId } } });
    });
    await this.audit.log({ userId: actorId, action, entity: 'attendance_device', entityId: device.id, oldValue: { status: device.status }, newValue: { status: 'REVOKED', event } });
  }

  async listDevices() {
    const rows = await this.prisma.attendanceDevice.findMany({
      where: { deletedAt: null },
      include: { branch: { select: { id: true, name: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map((d) => ({
      id: d.id,
      name: d.name,
      branchId: d.branchId,
      branchName: d.branch?.name ?? '',
      status: d.status,
      lastSeenAt: d.lastSeenAt,
      lastIp: d.lastIp,
      lastUserAgent: d.lastUserAgent,
      pinLockedUntil: d.pinLockedUntil,
      createdAt: d.createdAt,
    }));
  }

  async listEvents(deviceId: string, take = 50) {
    return this.prisma.attendanceDeviceEvent.findMany({ where: { deviceId }, orderBy: { createdAt: 'desc' }, take });
  }

  /** Todo ถึงเจ้าของในนามผู้ใช้ระบบ (Todo.createdById บังคับ) · ไม่มีผู้ใช้ระบบ = Sentry warning แล้วข้าม · กันซ้ำด้วยชื่อเรื่องที่ยังไม่ DONE */
  async createOwnerTodo(todo: { title: string; description: string; priority: 'LOW' | 'MEDIUM' | 'HIGH' }): Promise<void> {
    try {
      const systemUser = await this.prisma.user.findFirst({ where: { isSystemUser: true, deletedAt: null }, select: { id: true } });
      if (!systemUser) {
        this.logger.warn(`[attendance] SYSTEM user missing — Todo skipped: ${todo.title}`);
        Sentry.captureMessage('attendance: SYSTEM user missing — owner Todo skipped', { level: 'warning', tags: { subsystem: 'attendance' }, extra: { title: todo.title } });
        return;
      }
      const open = await this.prisma.todo.findFirst({ where: { title: todo.title, status: { not: 'DONE' } }, select: { id: true } });
      if (open) return;
      await this.prisma.todo.create({ data: { title: todo.title, description: todo.description, priority: todo.priority, tags: [ATTENDANCE_TODO_TAG], createdById: systemUser.id } });
    } catch (err) {
      this.logger.error(`[attendance] Todo failed: ${(err as Error).message}`);
      Sentry.captureException(err, { tags: { subsystem: 'attendance', action: 'owner-todo' } });
    }
  }
}
