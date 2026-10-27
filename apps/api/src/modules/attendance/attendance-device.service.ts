import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { AttendanceDevice, AttendanceDeviceEventKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { hashPII } from '../../utils/pii.util';
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
 * - ทุกคำขอหมุน token (รุ่น N → N+1) · เก็บประวัติทุกรุ่น · requestId ซ้ำ = คืนคำตอบเดิมไม่หมุน
 * - token รุ่นเก่า + requestId ใหม่ = มีคนถือ token ที่หมุนไปแล้ว → LOCKED · ติดธง DEVICE_CONFLICT ย้อนหลังตั้งแต่ heartbeat สะอาดครั้งสุดท้าย · Todo HIGH ถึงเจ้าของ
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
  /** responseJson ของคำขอเดิม (requestId ซ้ำ) — ผู้เรียกคืนค่านี้ทันทีโดยไม่ทำงานซ้ำ */
  cached?: unknown;
  /** token รุ่นถัดไปที่เครื่องต้องเก็บแทนตัวเดิม (ไม่มีเมื่อ cached) */
  nextToken?: string;
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
      await tx.attendanceRegistrationCode.update({ where: { id: code.id }, data: { usedAt: now } });
      const device = await tx.attendanceDevice.create({
        data: {
          branchId: code.branchId,
          name: input.deviceName.trim(),
          status: 'ACTIVE',
          currentGeneration: 1,
          registeredById: code.createdById,
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

  /** ตรวจ token + requestId · หมุนรุ่น · ตรวจชน — ใช้กับทุกคำขอจากเครื่อง (punch/heartbeat) */
  async authenticate(input: { deviceToken: string; requestId: string; ip?: string; userAgent?: string }, now: Date = new Date()): Promise<AuthenticatedDevice> {
    const token = await this.prisma.attendanceDeviceToken.findUnique({
      where: { tokenHash: hashToken(input.deviceToken) },
      include: { device: { include: { branch: { select: { id: true, name: true } } } } },
    });
    if (!token) throw unauthorized(DEVICE_REVOKED_CODE, 'เครื่องนี้ยังไม่ได้ลงทะเบียน หรือถูกยกเลิกแล้ว');
    const device = token.device as DeviceWithBranch;
    if (device.status === 'REVOKED' || device.deletedAt) throw unauthorized(DEVICE_REVOKED_CODE, 'เครื่องนี้ถูกยกเลิกแล้ว — ลงทะเบียนใหม่');
    if (device.status === 'LOCKED') throw unauthorized(DEVICE_LOCKED_CODE, 'เครื่องนี้ถูกล็อก — ติดต่อเจ้าของ');

    // ส่งซ้ำ (คำตอบหายระหว่างทาง): requestId เดิมของเครื่องเดิม = คืนคำตอบเดิม ไม่หมุน ไม่ถือว่าชน
    const cached = await this.prisma.attendanceDeviceRequest.findUnique({ where: { deviceId_requestId: { deviceId: device.id, requestId: input.requestId } } });
    if (cached) return { device, cached: cached.responseJson };

    if (token.generation !== device.currentGeneration) {
      await this.lockForConflict(device, token.generation, input, now);
      throw unauthorized(DEVICE_LOCKED_CODE, 'เครื่องนี้ถูกล็อก — รหัสเครื่องถูกใช้จากสองที่');
    }

    const nextToken = newRawToken();
    const nextGeneration = device.currentGeneration + 1;
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.attendanceDeviceToken.update({ where: { id: token.id }, data: { usedAt: now } });
      await tx.attendanceDeviceToken.create({ data: { deviceId: device.id, generation: nextGeneration, tokenHash: hashToken(nextToken), issuedAt: now } });
      return tx.attendanceDevice.update({
        where: { id: device.id },
        data: { currentGeneration: nextGeneration, lastSeenAt: now, lastIp: input.ip ?? null, lastUserAgent: input.userAgent ?? null },
        include: { branch: { select: { id: true, name: true } } },
      });
    });
    return { device: updated as DeviceWithBranch, nextToken };
  }

  private async lockForConflict(device: DeviceWithBranch, generationUsed: number, input: { ip?: string; userAgent?: string }, now: Date): Promise<void> {
    const since = device.lastCleanHeartbeatAt ?? device.createdAt;
    await this.prisma.$transaction(async (tx) => {
      await tx.attendanceDevice.update({ where: { id: device.id }, data: { status: 'LOCKED' } });
      await tx.attendanceDeviceEvent.create({
        data: {
          deviceId: device.id,
          kind: 'TOKEN_CONFLICT',
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
          detail: { generationUsed, currentGeneration: device.currentGeneration, since: since.toISOString(), lastIp: device.lastIp ?? null },
        },
      });
      const suspects = await tx.attendancePunch.findMany({ where: { deviceId: device.id, at: { gte: since, lte: now } }, select: { id: true } });
      const ids = suspects.map((p) => p.id);
      if (ids.length) {
        await tx.attendancePunch.updateMany({ where: { id: { in: ids } }, data: { flags: { push: DEVICE_CONFLICT_FLAG } } });
        await tx.attendanceDay.updateMany({ where: { OR: [{ clockInPunchId: { in: ids } }, { clockOutPunchId: { in: ids } }], deletedAt: null }, data: { flags: { push: DEVICE_CONFLICT_FLAG } } });
      }
    });
    await this.createOwnerTodo({
      title: `เครื่องตอกบัตร "${device.name}" ถูกใช้จากสองที่ — ล็อกแล้ว ตรวจรายการที่ติดธงก่อนปลด`,
      description:
        `สาขา ${device.branch?.name ?? device.branchId} · พบ token รุ่น ${generationUsed} ถูกใช้ซ้ำขณะรุ่นปัจจุบันคือ ${device.currentGeneration} · ${now.toISOString()}\n` +
        `รายการตอกตั้งแต่ ${since.toISOString()} ติดธง "เครื่องถูกใช้ซ้อน" ที่เมนู ลงเวลา (เจ้าของกด แก้ไข › ตรวจแล้ว ล้างธง) · ปลดล็อก/ลงทะเบียนใหม่ที่ ตั้งค่า › บริษัท & สาขา › เครื่องตอกบัตร · deviceId: ${device.id}`,
      priority: 'HIGH',
    });
  }

  /** จำคำตอบของคำขอนี้ไว้ส่งซ้ำ (responseJson = body ที่ตอบไปจริง รวมกรณี error 400/423) */
  async remember(deviceId: string, requestId: string, responseJson: unknown): Promise<void> {
    try {
      await this.prisma.attendanceDeviceRequest.create({ data: { deviceId, requestId, responseJson: responseJson as Prisma.InputJsonValue } });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') return;
      throw err;
    }
  }

  async touchCleanHeartbeat(deviceId: string, now: Date = new Date()): Promise<void> {
    await this.prisma.attendanceDevice.update({ where: { id: deviceId }, data: { lastCleanHeartbeatAt: now } });
  }

  /** รหัสตอกบัตร 6 หลัก → ผู้ใช้ · ล็อกต่อเครื่อง (ไม่ใช่ต่อคน เพราะยังไม่รู้ว่าเป็นใคร) */
  async checkPin(deviceId: string, pin: string, now: Date = new Date()): Promise<PinCheck> {
    const device = await this.prisma.attendanceDevice.findUnique({ where: { id: deviceId } });
    if (!device) throw unauthorized(DEVICE_REVOKED_CODE, 'ไม่พบเครื่อง');
    if (device.pinLockedUntil && device.pinLockedUntil.getTime() > now.getTime()) return 'LOCKED';

    const salt = process.env.PII_HASH_SALT || '';
    const user = await this.prisma.user.findFirst({ where: { attendancePinHash: hashPII(pin, salt), deletedAt: null, isActive: true }, select: { id: true } });
    if (user) {
      await this.prisma.attendanceDevice.update({ where: { id: device.id }, data: { pinFailCount: 0 } });
      return { userId: user.id };
    }

    const fails = device.pinFailCount + 1;
    if (fails >= PIN_LOCK_THRESHOLD) {
      const pinLockedUntil = new Date(now.getTime() + PIN_LOCK_MS);
      await this.prisma.attendanceDevice.update({ where: { id: device.id }, data: { pinFailCount: 0, pinLockedUntil } });
      await this.prisma.attendanceDeviceEvent.create({ data: { deviceId: device.id, kind: 'PIN_LOCKOUT', detail: { until: pinLockedUntil.toISOString() } } });
      await this.createOwnerTodo({
        title: `เครื่องตอกบัตร "${device.name}" ถูกใส่รหัสผิด ${PIN_LOCK_THRESHOLD} ครั้ง — พักรับรหัส 15 นาที`,
        description: `เวลา ${now.toISOString()} · ถ้าไม่ใช่พนักงานลืมรหัส อาจมีคนลองเดา · deviceId: ${device.id}`,
        priority: 'MEDIUM',
      });
      return 'LOCKED';
    }
    await this.prisma.attendanceDevice.update({ where: { id: device.id }, data: { pinFailCount: fails } });
    return 'INVALID';
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
