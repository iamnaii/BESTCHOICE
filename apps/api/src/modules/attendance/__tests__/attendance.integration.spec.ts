import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { UnauthorizedException } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { hashPII } from '../../../utils/pii.util';
import { bangkokMidnight } from '../../../utils/date.util';
import { AttendanceDeviceService } from '../attendance-device.service';
import { AttendanceSettingsService } from '../attendance-settings.service';
import { AttendanceService } from '../attendance.service';
import { KioskPunchService } from '../kiosk-punch.service';
import { KioskPublicController } from '../kiosk-public.controller';
import { AttendanceCloseDayCron } from '../crons/attendance-close-day.cron';
import { AttendanceRetentionCron } from '../crons/attendance-retention.cron';
import { dbDate } from '../attendance-rules';

/**
 * ก้อน 10 D3 — ลงเวลาบนฐานข้อมูลจริง (สเปก §4 §5 §6 §10): ลงทะเบียน → ตอกเข้า/ออก = แถวเดียวต่อวัน · ส่งซ้ำได้ผลเดิม ·
 * token เก่าถูกใช้ซ้ำ → ล็อก+ธง+Todo · แก้ไขโดยเจ้าของมี AttendanceCorrection + AuditLog ในสาย Merkle · cron ปิดวัน · รหัสไม่ซ้ำ (unique)
 * รีวิวรอบสุดท้าย: ยิงผ่าน KioskPublicController จริง (service จริง) — รหัสผิด/ตอกซ้ำ/คำตอบหาย/แข่งกันหมุน ต้องไม่ล็อกเครื่องเอง ·
 * token ที่ถูกคัดลอก (แม้เครื่องคัดลอกส่ง heartbeat ต่อ) ต้องติดธงตั้งแต่จุดแยก · เวลาของ controller = new Date() ⇒ ตั้งด้วย vi.setSystemTime
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
const kiosk = new KioskPublicController(devices, punchService);
const retention = new AttendanceRetentionCron(prisma as never, storage as never, settings, devices);
const reqFrom = (ip: string, ua = 'vitest') => ({ headers: { 'user-agent': ua }, ip, socket: { remoteAddress: ip } }) as never;
/** เรียก endpoint ของเครื่องตอนเวลา `when` (controller ใช้ new Date()) */
async function atTime<T>(when: Date, fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(when);
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}
const punchAt = (when: Date, token: string, pin: string, kind: 'IN' | 'OUT', opts: { requestId?: string; ip?: string; photo?: boolean } = {}) =>
  atTime(when, () =>
    kiosk.punch(
      { deviceToken: token, requestId: opts.requestId ?? uuid(), pin, kind } as never,
      opts.photo ? ({ buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), mimetype: 'image/jpeg' } as never) : undefined,
      reqFrom(opts.ip ?? '10.0.0.1'),
    ),
  );
const heartbeatAt = (when: Date, token: string, opts: { requestId?: string; ip?: string } = {}) =>
  atTime(when, () => kiosk.heartbeat({ deviceToken: token, requestId: opts.requestId ?? uuid() } as never, reqFrom(opts.ip ?? '10.0.0.1')));
async function newDevice(name: string, when: Date): Promise<{ token: string; id: string }> {
  const { code } = await devices.issueRegistrationCode(branchId, ownerId, when);
  const reg = await devices.register({ code, deviceName: name, ip: '10.0.0.1', userAgent: 'vitest' }, when);
  return { token: reg.deviceToken, id: reg.device.id };
}
const statusOf = async (id: string) => (await prisma.attendanceDevice.findUniqueOrThrow({ where: { id } })).status;
afterEach(() => vi.useRealTimers());
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
  it('I1 register → punch IN → punch OUT through the kiosk controller: one AttendanceDay, token rotated per successful request, photo key set, NETWORK_CHANGED on a new IP', async () => {
    const dev = await newDevice('แท็บเล็ตทดสอบ', at(9, 0));
    deviceToken = dev.token;
    deviceId = dev.id;

    const inRes = await punchAt(at(10, 2), deviceToken, '111111', 'IN', { photo: true });
    expect(inRes.result).toMatchObject({ kind: 'IN', status: 'ON_TIME', lateMinutes: 0 });
    expect(inRes.nextDeviceToken).toBeTruthy();
    deviceToken = inRes.nextDeviceToken!;

    const outRes = await punchAt(at(20, 30), deviceToken, '111111', 'OUT', { ip: '10.0.0.2' });
    expect(outRes.result).toMatchObject({ kind: 'OUT', status: 'OUT_OT', otHours: 1.5 });
    deviceToken = outRes.nextDeviceToken!;

    const days = await prisma.attendanceDay.findMany({ where: { userId: staffA } });
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ branchId, dayKind: 'WORK', lateMinutes: 0, workedMinutes: 628 });
    expect(Number(days[0].otHours)).toBe(1.5);
    expect(days[0].workDate.toISOString()).toBe(dbDate(DAY).toISOString()); // @db.Date เก็บวันไทย 27 ต.ค. ไม่เลื่อนเป็น 26
    const punches = await prisma.attendancePunch.findMany({ where: { userId: staffA }, orderBy: { at: 'asc' } });
    expect(punches.map((p) => p.kind)).toEqual(['IN', 'OUT']);
    expect(punches[0].photoKey).toMatch(/^attendance\/2026\/10\/.+\.jpg$/);
    expect(punches[1].flags).toEqual(expect.arrayContaining(['NO_PHOTO', 'NETWORK_CHANGED'])); // รีวิว I4: เดิม authenticate อัป lastIp ก่อนเทียบ ⇒ ไม่เคยติด
    expect(punches[0].flags).not.toContain('NETWORK_CHANGED');
    expect((await prisma.attendanceDevice.findUniqueOrThrow({ where: { id: deviceId } })).currentGeneration).toBe(3);
    // คำตอบที่จำไว้ไม่มี token ดิบ (เก็บเฉพาะ hash)
    const cached = await prisma.attendanceDeviceRequest.findMany({ where: { deviceId } });
    expect(JSON.stringify(cached)).not.toContain(deviceToken);
  });

  it('I2 a lost punch response: resending the same requestId with the consumed token returns the same result and a working re-keyed token, no second punch, no lock (รีวิว C3)', async () => {
    const D2 = bangkokMidnight(2026, 9, 28);
    const dev = await newDevice('เครื่อง I2', at(9, 0, D2));
    const requestId = uuid();
    const first = await punchAt(at(10, 0, D2), dev.token, '222222', 'IN', { requestId }); // คำตอบนี้ "หายระหว่างทาง"
    const replay = await punchAt(at(10, 1, D2), dev.token, '222222', 'IN', { requestId });
    expect(replay.result).toEqual(first.result);
    expect(replay.nextDeviceToken).toBeTruthy();
    expect(replay.nextDeviceToken).not.toBe(first.nextDeviceToken);
    expect(await prisma.attendancePunch.count({ where: { deviceId: dev.id } })).toBe(1);
    const hb = await heartbeatAt(at(10, 5, D2), replay.nextDeviceToken!);
    expect(hb.device.status).toBe('ACTIVE');
    expect(await statusOf(dev.id)).toBe('ACTIVE');
  });

  it('I2b a wrong PIN, a locked-out PIN and a double-tapped IN all leave the device token valid: the next request with the same token succeeds (รีวิว C1/C2)', async () => {
    const D3 = bangkokMidnight(2026, 9, 29);
    const dev = await newDevice('เครื่อง I2b', at(9, 0, D3));
    const wrong = await punchAt(at(10, 0, D3), dev.token, '999999', 'IN').catch((e) => e);
    expect(wrong.getResponse()).toMatchObject({ code: 'PIN_INVALID' });
    const ok = await punchAt(at(10, 1, D3), dev.token, '111111', 'IN'); // token เดิม + requestId ใหม่ — เดิมเครื่องล็อกตรงนี้
    expect(ok.result.kind).toBe('IN');
    const twice = await punchAt(at(10, 2, D3), ok.nextDeviceToken!, '111111', 'IN').catch((e) => e);
    expect(twice.getStatus()).toBe(409);
    const hb = await heartbeatAt(at(10, 12, D3), ok.nextDeviceToken!); // token เดิมยังใช้ได้หลัง 409
    expect(hb.nextDeviceToken).toBeTruthy();
    expect(await statusOf(dev.id)).toBe('ACTIVE');
    expect(await prisma.attendanceDeviceEvent.count({ where: { deviceId: dev.id, kind: 'TOKEN_CONFLICT' } })).toBe(0);
  });

  it('I2c two requests that authenticated with the same token race: the loser gets 409 REQUEST_BUSY, the device is not locked (รีวิว I5)', async () => {
    const D4 = bangkokMidnight(2026, 9, 30);
    const dev = await newDevice('เครื่อง I2c', at(9, 0, D4));
    const a = await devices.authenticate({ deviceToken: dev.token, requestId: uuid() }, at(10, 0, D4));
    const b = await devices.authenticate({ deviceToken: dev.token, requestId: uuid() }, at(10, 0, D4));
    const first = await devices.heartbeat(a, { requestId: uuid(), now: at(10, 0, D4) }, () => ({}));
    expect(first.nextToken).toBeTruthy();
    const err = await devices.heartbeat(b, { requestId: uuid(), now: at(10, 0, D4) }, () => ({})).catch((e) => e);
    expect(err.getResponse()).toMatchObject({ code: 'REQUEST_BUSY' });
    expect(await statusOf(dev.id)).toBe('ACTIVE');
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
    const b = await punchAt(at(10, 5), deviceToken, '222222', 'IN');
    deviceToken = b.nextDeviceToken!;
    const out = await closeDay.run(new Date(bangkokMidnight(2026, 9, 28).getTime() + 5 * 60_000));
    expect(out.targetDate).toBe('2026-10-27');
    const bDay = await prisma.attendanceDay.findFirstOrThrow({ where: { userId: staffB, workDate: dbDate(DAY) } });
    expect(bDay.flags).toContain('MISSING_OUT');
    expect(Number(bDay.otHours)).toBe(0);
    const c = await prisma.attendanceDay.findFirst({ where: { userId: staffC, workDate: dbDate(DAY) } });
    expect(c).toMatchObject({ dayKind: 'WORK', clockIn: null, flags: [] });
    expect(out.absent).toBeGreaterThanOrEqual(1);
    const again = await closeDay.run(new Date(bangkokMidnight(2026, 9, 28).getTime() + 5 * 60_000));
    expect(again.absent).toBe(0);
  });

  it('I5b a second instance at 00:05 (the close-day advisory lock is held elsewhere) skips the run: nothing is written', async () => {
    const runAt = new Date(bangkokMidnight(2026, 9, 29).getTime() + 5 * 60_000); // เป้าหมาย 28 ต.ค.
    const target = dbDate(bangkokMidnight(2026, 9, 28));
    const before = await prisma.attendanceDay.count({ where: { workDate: target } });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${AttendanceCloseDayCron.LOCK_KEY}))`;
      const out = await closeDay.run(runAt);
      expect(out).toMatchObject({ skipped: true, closed: 0, absent: 0 });
    });
    expect(await prisma.attendanceDay.count({ where: { workDate: target } })).toBe(before);
    // ปล่อยล็อกแล้ว — รอบถัดไปทำงานตามปกติ และรันซ้ำไม่สร้างแถวซ้ำ
    const first = await closeDay.run(runAt);
    expect(first.skipped).toBeUndefined();
    const again = await closeDay.run(runAt);
    expect(again.absent).toBe(0);
    const perUser = await prisma.attendanceDay.groupBy({ by: ['userId'], where: { workDate: target }, _count: { _all: true } });
    expect(perUser.every((g) => g._count._all === 1)).toBe(true);
  });

  it('I6 attendancePinHash is unique company-wide: a second user cannot take the same pin', async () => {
    await expect(prisma.user.update({ where: { id: staffC }, data: { attendancePinHash: hashPII('111111', SALT) } })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('I7 wrong PINs count only inside a 15-minute window (real SQL): 4 wrong, a pause of 16 minutes, then 4 more do not lock; the 5th inside the window does — one PIN_LOCKOUT event (รีวิว minor)', async () => {
    const D6 = bangkokMidnight(2026, 10, 2);
    const dev = await newDevice('เครื่อง I7', at(8, 0, D6));
    const t = (m: number) => new Date(at(9, 0, D6).getTime() + m * 60_000);
    for (const m of [0, 1, 2, 3]) expect(await devices.checkPin(dev.id, '000000', t(m))).toBe('INVALID');
    for (const m of [20, 21, 22, 23]) expect(await devices.checkPin(dev.id, '000000', t(m))).toBe('INVALID'); // ครั้งแรกหลังเว้น 17 นาที นับใหม่เป็น 1
    expect(await devices.checkPin(dev.id, '000000', t(24))).toBe('LOCKED');
    expect(await devices.checkPin(dev.id, '111111', t(30))).toBe('LOCKED'); // รหัสถูกก็ยังพักอยู่
    expect(await prisma.attendanceDeviceEvent.count({ where: { deviceId: dev.id, kind: 'PIN_LOCKOUT' } })).toBe(1);
    expect(await devices.checkPin(dev.id, '111111', t(40))).toEqual({ userId: staffA }); // พ้น 15 นาที
  });

  it('I8 retention keeps each device\'s latest rotation reply: a tablet back days later with its last reply lost still recovers instead of locking (รีวิวรอบ 2 C4)', async () => {
    const D7 = bangkokMidnight(2026, 10, 3);
    const dev = await newDevice('เครื่อง I8', at(8, 0, D7));
    const hb1 = await heartbeatAt(at(9, 0, D7), dev.token);
    const lostRequestId = uuid();
    await heartbeatAt(at(9, 10, D7), hb1.nextDeviceToken!, { requestId: lostRequestId }); // คำตอบนี้หาย
    await prisma.attendanceDeviceRequest.updateMany({ where: { deviceId: dev.id }, data: { createdAt: new Date(at(9, 0, D7).getTime() - 3 * 24 * 3600_000) } });
    const out = await retention.run(new Date(at(9, 30, D7).getTime() + 3 * 24 * 3600_000));
    expect(out.requestsDeleted).toBeGreaterThanOrEqual(1);
    const left = await prisma.attendanceDeviceRequest.findMany({ where: { deviceId: dev.id } });
    expect(left.map((r) => r.requestId)).toEqual([lostRequestId]);
    // สามวันต่อมา แท็บเล็ตกู้คำขอที่ค้างด้วย token ก่อนหน้า + requestId เดิม → ได้ token ใหม่ ไม่ล็อก
    const recovered = await heartbeatAt(at(9, 40, D7), hb1.nextDeviceToken!, { requestId: lostRequestId });
    expect(recovered.nextDeviceToken).toBeTruthy();
    expect(await statusOf(dev.id)).toBe('ACTIVE');
  });

  it('I3 a copied token used while the tablet is off — even with the copier\'s heartbeats in between — locks the device on the real tablet\'s return and flags the copier\'s punches and days from the fork (รีวิว C4)', async () => {
    const D5 = bangkokMidnight(2026, 9, 31);
    const dev = await newDevice('แท็บเล็ตคัดลอก', at(8, 0, D5));
    const copied = dev.token; // คัดลอก localStorage ตอนแท็บเล็ตปิด
    const c1 = await heartbeatAt(at(9, 30, D5), copied, { ip: '203.0.113.9' }); // เครื่องคัดลอกเปิด /kiosk
    const c2 = await punchAt(at(9, 31, D5), c1.nextDeviceToken!, '333333', 'IN', { ip: '203.0.113.9' }); // ตอกแทนจากบ้าน
    const c3 = await heartbeatAt(at(9, 40, D5), c2.nextDeviceToken!, { ip: '203.0.113.9' });
    await heartbeatAt(at(9, 50, D5), c3.nextDeviceToken!, { ip: '203.0.113.9' }); // lastCleanHeartbeatAt เลื่อนไป 09:50
    // แท็บเล็ตจริงเปิด 10:00 ด้วย token เดิม
    const err = await heartbeatAt(at(10, 0, D5), copied).catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.getResponse()).toMatchObject({ code: 'DEVICE_LOCKED' });
    expect(await statusOf(dev.id)).toBe('LOCKED');
    const flagged = await prisma.attendancePunch.findMany({ where: { deviceId: dev.id, flags: { has: 'DEVICE_CONFLICT' } } });
    expect(flagged.map((p) => p.userId)).toEqual([staffC]); // การตอก 09:31 ติดธง (เดิมหลุดเพราะย้อนแค่ถึง heartbeat 09:50)
    const day = await prisma.attendanceDay.findFirstOrThrow({ where: { userId: staffC, workDate: dbDate(D5) } });
    expect(day.flags).toContain('DEVICE_CONFLICT');
    expect(day.flags.filter((f) => f === 'DEVICE_CONFLICT')).toHaveLength(1);
    const todo = await prisma.todo.findFirst({ where: { title: { contains: 'แท็บเล็ตคัดลอก' }, tags: { has: 'attendance' } } });
    expect(todo?.priority).toBe('HIGH');
    // เครื่องที่ล็อกแล้วใช้ token ล่าสุดของฝั่งคัดลอกก็ไม่ได้
    const e2 = await devices.authenticate({ deviceToken: c3.nextDeviceToken!, requestId: uuid() }, at(10, 1, D5)).catch((e) => e);
    expect(e2.getResponse()).toMatchObject({ code: 'DEVICE_LOCKED' });
  });

  it('I9 a POSTED October payroll locks October attendance (correctDay → 409 ATTENDANCE_PAID) but not conflict-flag clearing or a 2 Nov kiosk punch; a VOIDED payroll unlocks it', async () => {
    const doc = await prisma.expenseDocument.create({
      data: {
        number: `PR-I9-${stamp}`,
        documentType: 'PAYROLL',
        status: 'POSTED',
        branchId,
        documentDate: at(12, 0, bangkokMidnight(2026, 10, 1)),
        subtotal: 0,
        totalAmount: 0,
        createdById: ownerId,
        payroll: { create: { payrollPeriod: '2026-10', lines: { create: [{ userId: staffA, employeeName: 'พนักงาน A', baseSalary: 0, netPaid: 0 }, { userId: staffC, employeeName: 'พนักงาน C', baseSalary: 0, netPaid: 0 }] } } },
      },
    });
    const owner = { id: ownerId, role: 'OWNER' };
    const day = await prisma.attendanceDay.findFirstOrThrow({ where: { userId: staffA, workDate: dbDate(DAY) } });
    const err = await attendance.correctDay(owner, day.id, { clockOut: at(21, 0).toISOString(), reason: 'ตรวจกล้องแล้ว ออกสามทุ่มจริง' }).catch((e) => e);
    expect(err.getStatus()).toBe(409);
    expect(err.getResponse()).toMatchObject({ code: 'ATTENDANCE_PAID', documentNumber: `PR-I9-${stamp}` });
    expect((await prisma.attendanceDay.findUniqueOrThrow({ where: { id: day.id } })).clockOut).toEqual(day.clockOut);
    const setErr = await attendance.setDayKinds(owner, { branchId, entries: [{ userId: staffA, date: '2026-10-30', dayKind: 'DAY_OFF' }] }, at(8, 0, bangkokMidnight(2026, 9, 1))).catch((e) => e);
    expect(setErr.getResponse()).toMatchObject({ code: 'ATTENDANCE_PAID' });
    // เดือนถัดไปยังตอกได้ (ตอก 2 พ.ย.) และธงเครื่องซ้อนของวันในเดือนที่จ่ายแล้วยังล้างได้
    const dev = await newDevice('แท็บเล็ตหลังจ่ายเงินเดือน', at(8, 0, bangkokMidnight(2026, 10, 2)));
    const punched = await punchAt(at(10, 1, bangkokMidnight(2026, 10, 2)), dev.token, '111111', 'IN');
    expect(punched.result).toMatchObject({ kind: 'IN', status: 'ON_TIME' });
    const flagged = await prisma.attendanceDay.findFirstOrThrow({ where: { userId: staffC, flags: { has: 'DEVICE_CONFLICT' } } });
    expect((await attendance.clearConflictFlag(owner, flagged.id)).flags).not.toContain('DEVICE_CONFLICT');
    // ใบ VOIDED ปลดล็อกเอง
    await prisma.expenseDocument.update({ where: { id: doc.id }, data: { status: 'VOIDED' } });
    await expect(attendance.correctDay(owner, day.id, { clockOut: at(21, 0).toISOString(), reason: 'ตรวจกล้องแล้ว ออกสามทุ่มจริง' })).resolves.toMatchObject({ id: day.id });
  });
});
