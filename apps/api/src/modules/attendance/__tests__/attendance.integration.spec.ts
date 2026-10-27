import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { UnauthorizedException } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { hashPII } from '../../../utils/pii.util';
import { bangkokMidnight } from '../../../utils/date.util';
import { AttendanceDeviceService } from '../attendance-device.service';
import { AttendanceSettingsService } from '../attendance-settings.service';
import { AttendanceService } from '../attendance.service';
import { KioskPunchService } from '../kiosk-punch.service';
import { AttendanceCloseDayCron } from '../crons/attendance-close-day.cron';
import { dbDate } from '../attendance-rules';

/**
 * ก้อน 10 D3 — ลงเวลาบนฐานข้อมูลจริง (สเปก §4 §5 §6 §10): ลงทะเบียน → ตอกเข้า/ออก = แถวเดียวต่อวัน · ส่งซ้ำได้ผลเดิม ·
 * token เก่าถูกใช้ซ้ำ → ล็อก+ธง+Todo · แก้ไขโดยเจ้าของมี AttendanceCorrection + AuditLog ในสาย Merkle · cron ปิดวัน · รหัสไม่ซ้ำ (unique)
 * รัน: bash tools/test-db-vitest.sh src/modules/attendance/__tests__/attendance.integration.spec.ts
 * งาน Integration บน CI ไม่ตั้ง PII_HASH_SALT (harness ในเครื่องตั้งให้) — ตั้ง fallback เองเหมือน trash.integration
 */
process.env.PII_HASH_SALT ||= 'attendance-integration-spec-salt-0123456789abcdef';
const SALT = process.env.PII_HASH_SALT;

const prisma = new PrismaClient();
const audit = new AuditService(prisma as never);
const settings = new AttendanceSettingsService(prisma as never);
const storage = { upload: async (key: string) => key, getStream: async () => { throw new Error('not used'); }, delete: async () => undefined };
const devices = new AttendanceDeviceService(prisma as never, audit);
const punchService = new KioskPunchService(prisma as never, settings, storage as never);
const attendance = new AttendanceService(prisma as never, audit, settings, storage as never);
const closeDay = new AttendanceCloseDayCron(prisma as never, devices);
const stamp = Date.now();
const DAY = bangkokMidnight(2026, 9, 27);
const at = (h: number, m: number, d = DAY) => new Date(d.getTime() + (h * 60 + m) * 60_000);
const uuid = () => crypto.randomUUID();

let ownerId: string;
let branchId: string;
let staffA: string;
let staffB: string;
let staffC: string;
let deviceToken: string;
let deviceId: string;

beforeAll(async () => {
  ownerId = (await prisma.user.create({ data: { email: `att-owner-${stamp}@test.local`, password: 'x', name: 'เจ้าของลงเวลา', role: 'OWNER', isActive: true } })).id;
  await prisma.user.create({ data: { email: `att-system-${stamp}@test.local`, password: 'x', name: 'ระบบ', role: 'OWNER', isActive: true, isSystemUser: true } });
  branchId = (await prisma.branch.create({ data: { name: `สาขาลงเวลา ${stamp}` } })).id;
  const mk = async (tag: string, pin: string | null) =>
    (await prisma.user.create({ data: { email: `att-${tag}-${stamp}@test.local`, password: 'x', name: `พนักงาน ${tag}`, nickname: tag, role: 'SALES', isActive: true, branchId, attendancePinHash: pin ? hashPII(pin, SALT) : null } })).id;
  staffA = await mk('A', '111111');
  staffB = await mk('B', '222222');
  staffC = await mk('C', '333333');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('attendance บน Postgres จริง', () => {
  it('I1 register → punch IN → punch OUT: one AttendanceDay, token rotated per request, photo key set', async () => {
    const { code } = await devices.issueRegistrationCode(branchId, ownerId, at(9, 0));
    const reg = await devices.register({ code, deviceName: 'แท็บเล็ตทดสอบ', ip: '10.0.0.1', userAgent: 'vitest' }, at(9, 1));
    deviceToken = reg.deviceToken;
    deviceId = reg.device.id;

    const a1 = await devices.authenticate({ deviceToken, requestId: uuid(), ip: '10.0.0.1' }, at(10, 2));
    expect(a1.nextToken).toBeTruthy();
    expect(await devices.checkPin(deviceId, '111111', at(10, 2))).toEqual({ userId: staffA });
    const inRes = await punchService.punch({ device: a1.device, userId: staffA, kind: 'IN', photo: { buffer: Buffer.from('jpg'), mimeType: 'image/jpeg' }, ip: '10.0.0.1' }, at(10, 2));
    expect(inRes).toMatchObject({ kind: 'IN', status: 'ON_TIME', lateMinutes: 0 });
    deviceToken = a1.nextToken!;

    const a2 = await devices.authenticate({ deviceToken, requestId: uuid(), ip: '10.0.0.1' }, at(20, 30));
    const outRes = await punchService.punch({ device: a2.device, userId: staffA, kind: 'OUT', ip: '10.0.0.1' }, at(20, 30));
    expect(outRes).toMatchObject({ kind: 'OUT', status: 'OUT_OT', otHours: 1.5 });
    deviceToken = a2.nextToken!;

    const days = await prisma.attendanceDay.findMany({ where: { userId: staffA } });
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ branchId, dayKind: 'WORK', lateMinutes: 0, workedMinutes: 628 });
    expect(Number(days[0].otHours)).toBe(1.5);
    expect(days[0].workDate.toISOString()).toBe(dbDate(DAY).toISOString()); // @db.Date เก็บวันไทย 27 ต.ค. ไม่เลื่อนเป็น 26
    const punches = await prisma.attendancePunch.findMany({ where: { userId: staffA }, orderBy: { at: 'asc' } });
    expect(punches.map((p) => p.kind)).toEqual(['IN', 'OUT']);
    expect(punches[0].photoKey).toMatch(/^attendance\/2026\/10\/.+\.jpg$/);
    expect(punches[1].flags).toContain('NO_PHOTO');
    const device = await prisma.attendanceDevice.findUnique({ where: { id: deviceId } });
    expect(device?.currentGeneration).toBe(3);
  });

  it('I2 replaying the same requestId with the already-used token returns the cached response and creates no second punch', async () => {
    const requestId = uuid();
    const first = await devices.authenticate({ deviceToken, requestId, ip: '10.0.0.1' }, at(20, 31));
    await devices.remember(deviceId, requestId, { echo: 'first' });
    const replay = await devices.authenticate({ deviceToken, requestId, ip: '10.0.0.1' }, at(20, 32)); // token เดิม (ถูกหมุนไปแล้ว) + requestId เดิม
    expect(replay.cached).toEqual({ echo: 'first' });
    expect(replay.nextToken).toBeUndefined();
    const device = await prisma.attendanceDevice.findUnique({ where: { id: deviceId } });
    expect(device?.status).toBe('ACTIVE');
    deviceToken = first.nextToken!;
  });

  it('I4 correctDay by OWNER writes AttendanceCorrection and an AuditLog row inside the Merkle chain', async () => {
    const day = await prisma.attendanceDay.findFirstOrThrow({ where: { userId: staffA } });
    const updated = await attendance.correctDay({ id: ownerId, role: 'OWNER' }, day.id, { clockOut: at(19, 0).toISOString(), reason: 'ลูกค้ารายสุดท้ายออกตอนหนึ่งทุ่ม ตรวจกับกล้องแล้ว' });
    expect(Number(updated.otHours)).toBe(0);
    expect(updated.flags).toContain('CORRECTED');
    expect(updated.correctedCount).toBe(1);
    const correction = await prisma.attendanceCorrection.findFirst({ where: { dayId: day.id } });
    expect(correction?.changedById).toBe(ownerId);
    const log = await prisma.auditLog.findFirst({ where: { action: 'ATTENDANCE_CORRECTED', entityId: day.id }, orderBy: { createdAt: 'desc' } });
    expect(log).not.toBeNull();
    expect(log?.rowHash).toBeTruthy();
    expect(log?.sequenceNumber).not.toBeNull();
    expect(JSON.stringify(log?.newValue)).toContain('ตรวจกับกล้อง');
  });

  it('I5 close-day cron marks a forgotten clock-out MISSING_OUT and creates an absence row for a PIN-holder with no punches', async () => {
    const a = await devices.authenticate({ deviceToken, requestId: uuid(), ip: '10.0.0.1' }, at(10, 5));
    await punchService.punch({ device: a.device, userId: staffB, kind: 'IN', ip: '10.0.0.1' }, at(10, 5));
    deviceToken = a.nextToken!;
    const out = await closeDay.run(new Date(bangkokMidnight(2026, 9, 28).getTime() + 5 * 60_000));
    expect(out.targetDate).toBe('2026-10-27');
    const b = await prisma.attendanceDay.findFirstOrThrow({ where: { userId: staffB } });
    expect(b.flags).toContain('MISSING_OUT');
    expect(Number(b.otHours)).toBe(0);
    const c = await prisma.attendanceDay.findFirst({ where: { userId: staffC } });
    expect(c).toMatchObject({ dayKind: 'WORK', clockIn: null, flags: [] });
    expect(out.absent).toBeGreaterThanOrEqual(1);
    const again = await closeDay.run(new Date(bangkokMidnight(2026, 9, 28).getTime() + 5 * 60_000));
    expect(again.absent).toBe(0);
  });

  it('I6 attendancePinHash is unique company-wide: a second user cannot take the same pin', async () => {
    await expect(prisma.user.update({ where: { id: staffC }, data: { attendancePinHash: hashPII('111111', SALT) } })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('I3 reusing a previous-generation token with a new requestId locks the device, flags the earlier punches DEVICE_CONFLICT and creates an owner Todo', async () => {
    const before = await prisma.attendanceDevice.findUniqueOrThrow({ where: { id: deviceId } });
    const stale = (await prisma.attendanceDeviceToken.findFirst({ where: { deviceId, generation: before.currentGeneration - 1 } }))!;
    expect(stale.usedAt).not.toBeNull();
    // เราไม่มี raw ของรุ่นเก่า (เก็บแค่ hash) — ใช้ตัวแปร deviceToken ก่อนหมุนล่าสุดแทน: ขอหมุนอีกรอบแล้วใช้ตัวเก่า
    const latest = await devices.authenticate({ deviceToken, requestId: uuid(), ip: '10.0.0.1' }, at(21, 0));
    const oldToken = deviceToken;
    deviceToken = latest.nextToken!;
    const err = await devices.authenticate({ deviceToken: oldToken, requestId: uuid(), ip: '203.0.113.9', userAgent: 'someone-else' }, at(21, 5)).catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.getResponse()).toMatchObject({ code: 'DEVICE_LOCKED' });
    const device = await prisma.attendanceDevice.findUniqueOrThrow({ where: { id: deviceId } });
    expect(device.status).toBe('LOCKED');
    const events = await prisma.attendanceDeviceEvent.findMany({ where: { deviceId, kind: 'TOKEN_CONFLICT' } });
    expect(events).toHaveLength(1);
    const flagged = await prisma.attendancePunch.findMany({ where: { deviceId, flags: { has: 'DEVICE_CONFLICT' } } });
    expect(flagged.length).toBeGreaterThanOrEqual(3); // IN/OUT ของ A + IN ของ B ตั้งแต่ heartbeat สะอาดครั้งสุดท้าย (ตอนลงทะเบียน)
    const day = await prisma.attendanceDay.findFirstOrThrow({ where: { userId: staffA } });
    expect(day.flags).toContain('DEVICE_CONFLICT');
    const todo = await prisma.todo.findFirst({ where: { title: { contains: 'แท็บเล็ตทดสอบ' }, tags: { has: 'attendance' } } });
    expect(todo?.priority).toBe('HIGH');
    // เครื่องที่ล็อกแล้วใช้ token ปัจจุบันก็ไม่ได้อีก
    const e2 = await devices.authenticate({ deviceToken, requestId: uuid() }, at(21, 6)).catch((e) => e);
    expect(e2.getResponse()).toMatchObject({ code: 'DEVICE_LOCKED' });
  });
});
