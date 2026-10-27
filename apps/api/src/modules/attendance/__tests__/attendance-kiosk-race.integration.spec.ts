import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { bangkokMidnight } from '../../../utils/date.util';
import { AttendanceDeviceService } from '../attendance-device.service';
import { AttendanceSettingsService } from '../attendance-settings.service';
import { AttendanceService } from '../attendance.service';
import { KioskPunchService } from '../kiosk-punch.service';
import { dbDate } from '../attendance-rules';

/**
 * ตอกบัตรแข่งกับการแก้ไขของเจ้าของ บน Postgres จริง สองคอนเนกชัน (รูปแบบเดียวกับ customer-phone-lock.race.db.spec.ts):
 * คอนเนกชัน "holder" ถือล็อกแถววัน (FOR UPDATE) → ปล่อยการตอก OUT ของตู้ → รอจนมันเข้าคิวรอล็อกใน pg_locks
 * (รอจนมีคำสั่งที่แตะ attendance_days ติดล็อกอยู่ — ไม่ผูกกับข้อความ SQL เฉพาะ ⇒ โค้ดเก่าก็เข้าคิวที่ UPDATE แล้วแดงที่ assert) → holder commit การแก้ไข (เข้า 10:00, CORRECTED) แล้วปล่อยล็อก
 * ⇒ ตู้ต้องอ่านแถวใหม่ใต้ล็อกและคงการแก้ไขไว้ (โค้ดเดิมทับด้วยค่าจากสำเนาที่อ่านก่อน tx: สาย 30 นาที · ไม่มี CORRECTED)
 * รัน: bash tools/test-db-vitest.sh src/modules/attendance/__tests__/attendance-kiosk-race.integration.spec.ts
 */
process.env.PII_HASH_SALT ||= 'attendance-race-spec-salt-0123456789abcdef';

const holderDb = new PrismaClient();
const kioskDb = new PrismaClient();
const monitorDb = new PrismaClient();
const stamp = Date.now();
const DAY = bangkokMidnight(2026, 10, 3);
const at = (h: number, m: number) => new Date(DAY.getTime() + (h * 60 + m) * 60_000);

let ownerId: string;
let branchId: string;
let staffId: string;
let device: Awaited<ReturnType<AttendanceDeviceService['register']>>['device'];

beforeAll(async () => {
  ownerId = (await holderDb.user.create({ data: { email: `race-owner-${stamp}@test.local`, password: 'x', name: 'เจ้าของ', role: 'OWNER', isActive: true } })).id;
  branchId = (await holderDb.branch.create({ data: { name: `สาขาแข่ง ${stamp}` } })).id;
  staffId = (await holderDb.user.create({ data: { email: `race-staff-${stamp}@test.local`, password: 'x', name: 'พนักงานแข่ง', nickname: 'แข่ง', role: 'SALES', isActive: true, branchId } })).id;
  const devices = new AttendanceDeviceService(holderDb as never, new AuditService(holderDb as never));
  const { code } = await devices.issueRegistrationCode(branchId, ownerId, at(8, 0));
  device = (await devices.register({ code, deviceName: 'แท็บเล็ตแข่ง', ip: '10.0.0.1', userAgent: 'vitest' }, at(8, 0))).device;
});

afterAll(async () => {
  await Promise.all([holderDb.$disconnect(), kioskDb.$disconnect(), monitorDb.$disconnect()]);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => Promise<boolean>, what: string, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await sleep(25);
  }
  throw new Error(`timeout waiting for ${what}`);
}

describe('ตอกบัตร vs การแก้ไข — สองคอนเนกชัน (real DB)', () => {
  it('R1 a correction committed while the kiosk OUT is queued on the day-row lock survives: the punch recomputes from the re-read row', async () => {
    const day = await holderDb.attendanceDay.create({ data: { userId: staffId, branchId, workDate: dbDate(DAY), dayKind: 'WORK', clockIn: at(10, 30), lateMinutes: 30, flags: [] } });
    let release!: () => void;
    const released = new Promise<void>((r) => { release = r; });
    let locked!: () => void;
    const hasLock = new Promise<void>((r) => { locked = r; });

    const holder = holderDb.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM attendance_days WHERE id = ${day.id} FOR UPDATE`;
      locked();
      await released;
      // = correctDay ที่ commit คั่น: เข้า 10:00 (ไม่สาย) + CORRECTED
      await tx.attendanceDay.update({ where: { id: day.id }, data: { clockIn: at(10, 0), lateMinutes: 0, flags: ['CORRECTED'], correctedCount: 1 } });
    }, { timeout: 30_000, maxWait: 10_000 });
    await hasLock;

    const settings = new AttendanceSettingsService(kioskDb as never);
    const storage = { upload: async (k: string) => k, delete: async () => undefined };
    const kiosk = new KioskPunchService(kioskDb as never, settings, storage as never);
    const punch = kiosk.punch({ device: { id: device.id, branchId, name: device.name, lastIp: null }, userId: staffId, kind: 'OUT' }, at(20, 0));

    // รอจนตู้เข้าคิวรอล็อกแถววันจริง (อ่านแถวเก่าไปแล้ว)
    await waitFor(async () => {
      const rows = await monitorDb.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE '%attendance_days%'`;
      return Number(rows[0].n) > 0;
    }, 'the kiosk punch to queue on a lock over attendance_days');
    release();
    await holder;
    const res = await punch;

    const after = await holderDb.attendanceDay.findUniqueOrThrow({ where: { id: day.id } });
    expect(after.flags).toContain('CORRECTED');
    expect(after.correctedCount).toBe(1);
    expect(after.clockIn).toEqual(at(10, 0));
    expect(after.lateMinutes).toBe(0); // คำนวณจาก 10:00 ที่แก้แล้ว ไม่ใช่ 10:30 ของสำเนาเก่า
    expect(after.clockOut).toEqual(at(20, 0));
    expect(res.lateMinutes).toBe(0);
  });

  it('R2 setDayKinds on a key with no row: a kiosk-style clocked-in INSERT in flight wins the unique slot → setDayKinds is refused (clocked in) and the day keeps WORK', async () => {
    const D2 = bangkokMidnight(2026, 10, 10);
    const key = dbDate(D2);
    let release!: () => void;
    const released = new Promise<void>((r) => { release = r; });
    let inserted!: () => void;
    const hasSlot = new Promise<void>((r) => { inserted = r; });
    // holder = ตู้ที่ INSERT แถว WORK ที่ตอกเข้าแล้วใน tx ที่ยังไม่ commit (ถือ unique slot ของคีย์นี้)
    const holder = holderDb.$transaction(async (tx) => {
      await tx.attendanceDay.create({ data: { userId: staffId, branchId, workDate: key, dayKind: 'WORK', clockIn: new Date(D2.getTime() + 10 * 3600_000) } });
      inserted();
      await released;
    }, { timeout: 30_000, maxWait: 10_000 });
    await hasSlot;

    const svc = new AttendanceService(kioskDb as never, new AuditService(kioskDb as never), new AttendanceSettingsService(kioskDb as never), {} as never);
    const call = svc.setDayKinds({ id: ownerId, role: 'OWNER' }, { branchId, entries: [{ userId: staffId, date: '2026-11-10', dayKind: 'DAY_OFF' }] }, at(8, 0)).then(() => 'resolved', (e) => e);
    await waitFor(async () => {
      const rows = await monitorDb.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE '%attendance_days%'`;
      return Number(rows[0].n) > 0;
    }, 'setDayKinds to queue behind the in-flight insert');
    release();
    await holder;
    const outcome = await call;
    expect(outcome).not.toBe('resolved');
    expect((outcome as { getStatus(): number }).getStatus()).toBe(400);
    const row = await holderDb.attendanceDay.findUniqueOrThrow({ where: { userId_workDate: { userId: staffId, workDate: key } } });
    expect(row.dayKind).toBe('WORK');
    expect(row.clockIn).not.toBeNull();
  });
});
