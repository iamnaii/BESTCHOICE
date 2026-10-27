import { ConflictException } from '@nestjs/common';
import { bangkokMidnight } from '../../../utils/date.util';
import { KioskPunchService } from '../kiosk-punch.service';
import { dbDate } from '../attendance-rules';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

/** ก้อน 10 D3 Task 4 — ตอกบัตร: แถววันจากเหตุการณ์ (IN แรก / OUT ล่าสุด / เปิดวันต่อ) + กติกานับ + รูป (สเปก §4.2 §5) */
const DAY = bangkokMidnight(2026, 9, 27);
const DB = dbDate(DAY); // ค่าที่ Prisma เก็บ/คืนสำหรับ @db.Date (เที่ยงคืน UTC ของ 27 ต.ค.)
const at = (h: number, m: number, d = DAY) => new Date(d.getTime() + (h * 60 + m) * 60_000);
const RULES = { workStart: '10:00', workEnd: '19:00', lateGraceMinutes: 15 };
const DEVICE = { id: 'dev1', branchId: 'br1', name: 'แท็บเล็ต', lastIp: '1.1.1.1' } as never;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

type Delegate = Record<string, jest.Mock>;
function harness() {
  const delegates = new Map<string, Delegate>();
  const client: Record<string, unknown> = {};
  const proxy: any = new Proxy(client, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (!delegates.has(key)) delegates.set(key, new Proxy({} as Delegate, { get(d, m: string) { if (!(m in d)) d[m] = jest.fn(async () => (m === 'findMany' ? [] : m.startsWith('find') ? null : m.endsWith('Many') ? { count: 0 } : {})); return d[m]; } }));
      return delegates.get(key);
    },
  });
  client.$queryRaw = jest.fn(async () => []);
  client.$executeRaw = jest.fn(async () => 0);
  client.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => cb(proxy));
  const settings = { getRules: jest.fn().mockResolvedValue(RULES) };
  const storage = { upload: jest.fn(async (key: string) => key), delete: jest.fn(async () => undefined) };
  const service = new KioskPunchService(proxy, settings as never, storage as never);
  const d = (k: string) => proxy[k] as Delegate;
  d('user').findUnique.mockResolvedValue({ id: 'u1', nickname: 'นุ๊ก', name: 'วรรณา ส.' });
  d('attendancePunch').create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'p-' + data.kind, ...data }));
  d('attendanceDay').create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'day1', flags: [], ...data }));
  d('attendanceDay').update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'day1', ...data }));
  return { service, d, settings, storage, raw: client.$queryRaw as jest.Mock, exec: client.$executeRaw as jest.Mock };
}

describe('KioskPunchService.punch', () => {
  beforeEach(() => jest.clearAllMocks());

  it('K1 first IN creates the day row (clockIn, branchId = device branch, clockInPunchId), status ON_TIME, photo uploaded under attendance/yyyy/mm/<punchId>.jpg', async () => {
    const h = harness();
    const res = await h.service.punch({ device: DEVICE, userId: 'u1', kind: 'IN', photo: { buffer: JPEG, mimeType: 'image/jpeg' }, ip: '1.1.1.1' }, at(10, 2));
    expect(res).toMatchObject({ nickname: 'นุ๊ก', kind: 'IN', status: 'ON_TIME', lateMinutes: 0, otHours: 0, at: at(10, 2) });
    expect(h.storage.upload).toHaveBeenCalledWith(expect.stringMatching(/^attendance\/2026\/10\/[0-9a-f-]+\.jpg$/), expect.any(Buffer), 'image/jpeg');
    expect(h.d('attendancePunch').create).toHaveBeenCalledWith({ data: expect.objectContaining({ deviceId: 'dev1', userId: 'u1', branchId: 'br1', kind: 'IN', at: at(10, 2), photoKey: expect.stringMatching(/\.jpg$/) }) });
    const punchId = h.d('attendancePunch').create.mock.calls[0][0].data.id; // service ตั้ง id เอง เพราะ key รูปใช้ id เดียวกัน
    expect(h.d('attendanceDay').create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'u1', branchId: 'br1', workDate: DB, dayKind: 'WORK', clockIn: at(10, 2), clockInPunchId: punchId, lateMinutes: 0 }) });
    expect(h.storage.upload.mock.calls[0][0]).toBe(`attendance/2026/10/${punchId}.jpg`);
  });

  it('K2 IN at 10:16 → LATE with lateMinutes 16 (rules resolved per device branch)', async () => {
    const h = harness();
    const res = await h.service.punch({ device: DEVICE, userId: 'u1', kind: 'IN' }, at(10, 16));
    expect(res).toMatchObject({ status: 'LATE', lateMinutes: 16 });
    expect(h.settings.getRules).toHaveBeenCalledWith('br1');
  });

  it('K3 IN twice while still open → 409 "ตอกเข้าแล้วเมื่อ 10:02" and no punch written', async () => {
    const h = harness();
    h.d('attendanceDay').findUnique.mockResolvedValue({ id: 'day1', userId: 'u1', branchId: 'br1', workDate: DB, dayKind: 'WORK', clockIn: at(10, 2), clockOut: null, flags: [] });
    await expect(h.service.punch({ device: DEVICE, userId: 'u1', kind: 'IN' }, at(10, 30))).rejects.toThrow('ตอกเข้าแล้วเมื่อ 10:02');
    expect(h.d('attendancePunch').create).not.toHaveBeenCalled();
  });

  it('K4 OUT without IN today → 409', async () => {
    const h = harness();
    await expect(h.service.punch({ device: DEVICE, userId: 'u1', kind: 'OUT' }, at(19, 0))).rejects.toThrow(ConflictException);
  });

  it('K5 OUT at 20:50 → OUT_OT otHours 2 with workedMinutes; a second OUT at 21:00 replaces clockOut and adds OUT_UPDATED', async () => {
    const h = harness();
    h.d('attendanceDay').findUnique.mockResolvedValue({ id: 'day1', userId: 'u1', branchId: 'br1', workDate: DB, dayKind: 'WORK', clockIn: at(10, 2), clockOut: null, flags: [] });
    const first = await h.service.punch({ device: DEVICE, userId: 'u1', kind: 'OUT' }, at(20, 50));
    expect(first).toMatchObject({ status: 'OUT_OT', otHours: 2 });
    expect(h.d('attendanceDay').update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'day1' }, data: expect.objectContaining({ clockOut: at(20, 50), clockOutPunchId: h.d('attendancePunch').create.mock.calls[0][0].data.id, otHours: 2, workedMinutes: 648 }) }));
    h.d('attendanceDay').findUnique.mockResolvedValue({ id: 'day1', userId: 'u1', branchId: 'br1', workDate: DB, dayKind: 'WORK', clockIn: at(10, 2), clockOut: at(20, 50), flags: [] });
    await h.service.punch({ device: DEVICE, userId: 'u1', kind: 'OUT' }, at(21, 0));
    expect(h.d('attendanceDay').update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ clockOut: at(21, 0), flags: expect.arrayContaining(['OUT_UPDATED']) }) }));
  });

  it('K6 no photo or a failed upload → punch stored with NO_PHOTO, no exception', async () => {
    const h = harness();
    const res = await h.service.punch({ device: DEVICE, userId: 'u1', kind: 'IN' }, at(10, 0));
    expect(res.flags).toContain('NO_PHOTO');
    h.storage.upload.mockRejectedValueOnce(new Error('gcs down'));
    const res2 = await h.service.punch({ device: DEVICE, userId: 'u1', kind: 'IN', photo: { buffer: JPEG, mimeType: 'image/jpeg' } }, at(10, 0));
    expect(res2.flags).toContain('NO_PHOTO');
    expect(h.d('attendancePunch').create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ photoKey: null, flags: expect.arrayContaining(['NO_PHOTO']) }) });
  });

  it('K7 IN after an OUT reopens the day: clockOut cleared and REOPENED flag', async () => {
    const h = harness();
    h.d('attendanceDay').findUnique.mockResolvedValue({ id: 'day1', userId: 'u1', branchId: 'br1', workDate: DB, dayKind: 'WORK', clockIn: at(10, 2), clockOut: at(13, 0), clockOutPunchId: 'p-old', flags: [] });
    const res = await h.service.punch({ device: DEVICE, userId: 'u1', kind: 'IN' }, at(14, 0));
    expect(res.kind).toBe('IN');
    expect(h.d('attendanceDay').update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ clockOut: null, clockOutPunchId: null, otHours: 0, flags: expect.arrayContaining(['REOPENED']) }) }));
  });

  it('K8 punching on a DAY_OFF row keeps dayKind and adds WORKED_ON_OFF_DAY', async () => {
    const h = harness();
    h.d('attendanceDay').findUnique.mockResolvedValue({ id: 'day1', userId: 'u1', branchId: 'br1', workDate: DB, dayKind: 'DAY_OFF', clockIn: null, clockOut: null, flags: [] });
    await h.service.punch({ device: DEVICE, userId: 'u1', kind: 'IN' }, at(10, 0));
    expect(h.d('attendanceDay').update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ dayKind: 'DAY_OFF', flags: expect.arrayContaining(['WORKED_ON_OFF_DAY']) }) }));
  });

  it('K9 IN at 23:50 and OUT at 00:20 next day land on the same (IN) day row', async () => {
    const h = harness();
    await h.service.punch({ device: DEVICE, userId: 'u1', kind: 'IN' }, at(23, 50));
    expect(h.d('attendanceDay').findUnique).toHaveBeenLastCalledWith(expect.objectContaining({ where: { userId_workDate: { userId: 'u1', workDate: DB } } }));
    h.d('attendanceDay').findUnique.mockResolvedValueOnce(null); // ไม่มีแถวของ "วันถัดไป"
    const open = { id: 'day1', userId: 'u1', branchId: 'br1', workDate: DB, dayKind: 'WORK', clockIn: at(23, 50), clockOut: null, flags: [] };
    h.d('attendanceDay').findFirst.mockResolvedValueOnce(open);
    h.d('attendanceDay').findUnique.mockResolvedValueOnce(open); // อ่านใหม่ใต้ล็อกแถว
    const res = await h.service.punch({ device: DEVICE, userId: 'u1', kind: 'OUT' }, at(24, 20));
    expect(res).toMatchObject({ kind: 'OUT', otHours: 0.5 }); // OT นับเฉพาะเวลาที่ทำจริงหลังเลิกงาน (รีวิว I7)
    // วันถัดไป 00:20 → ค้นแถวเปิดค้างของ "เมื่อวาน" = 27 ต.ค. (DAY) ตามปฏิทินไทย
    expect(h.d('attendanceDay').findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'u1', clockOut: null, workDate: DB }) }));
  });

  it('K10 ip differs from device.lastIp → NETWORK_CHANGED on the punch', async () => {
    const h = harness();
    await h.service.punch({ device: DEVICE, userId: 'u1', kind: 'IN', ip: '9.9.9.9' }, at(10, 0));
    expect(h.d('attendancePunch').create).toHaveBeenCalledWith({ data: expect.objectContaining({ flags: expect.arrayContaining(['NETWORK_CHANGED']) }) });
  });
  it('K11 OUT the next evening does not attach to yesterday\'s forgotten row (open > 18 h) → 409 "ยังไม่ได้ตอกเข้างานวันนี้" (รีวิว I3)', async () => {
    const h = harness();
    // จันทร์ลืมตอกออก (cron ติด MISSING_OUT แต่ clockOut ยังว่าง) · อังคาร 19:05 กด OUT โดยไม่ได้ IN
    const monday = { id: 'mon', userId: 'u1', branchId: 'br1', workDate: DB, dayKind: 'WORK', clockIn: at(10, 0), clockOut: null, flags: ['MISSING_OUT'] };
    // mock กรองตามเงื่อนไขเวลา IN จริง (ไม่งั้นคืนแถวโดยไม่สน where)
    h.d('attendanceDay').findFirst.mockImplementation(async ({ where }: { where: { clockIn: { gte: Date } } }) => (monday.clockIn.getTime() >= where.clockIn.gte.getTime() ? monday : null));
    const TUE = bangkokMidnight(2026, 9, 28);
    await expect(h.service.punch({ device: DEVICE, userId: 'u1', kind: 'OUT' }, at(19, 5, TUE))).rejects.toThrow('ยังไม่ได้ตอกเข้างานวันนี้');
    expect(h.d('attendanceDay').update).not.toHaveBeenCalled();
  });

  it('K12 a rejected punch uploads no photo; a failed transaction deletes the uploaded photo (รีวิว I8)', async () => {
    const h = harness();
    h.d('attendanceDay').findUnique.mockResolvedValue({ id: 'day1', userId: 'u1', branchId: 'br1', workDate: DB, dayKind: 'WORK', clockIn: at(10, 2), clockOut: null, flags: [] });
    await expect(h.service.punch({ device: DEVICE, userId: 'u1', kind: 'IN', photo: { buffer: JPEG, mimeType: 'image/jpeg' } }, at(10, 30))).rejects.toThrow(ConflictException);
    expect(h.storage.upload).not.toHaveBeenCalled();

    const h2 = harness();
    h2.d('attendancePunch').create.mockRejectedValueOnce(new Error('db down'));
    await expect(h2.service.punch({ device: DEVICE, userId: 'u1', kind: 'IN', photo: { buffer: JPEG, mimeType: 'image/jpeg' } }, at(10, 2))).rejects.toThrow('db down');
    expect(h2.storage.delete).toHaveBeenCalledWith(h2.storage.upload.mock.calls[0][0]);
  });

  it('K13 a punch more than 500 m from the device\'s previous located punch gets LOCATION_CHANGED; geo is stored (รีวิว I4)', async () => {
    const h = harness();
    h.d('attendancePunch').findFirst.mockResolvedValueOnce({ geoLat: '14.799500', geoLng: '100.653400' }); // ลพบุรี
    const res = await h.service.punch({ device: DEVICE, userId: 'u1', kind: 'IN', ip: '1.1.1.1', geo: { lat: 14.81, lng: 100.66 } }, at(10, 2)); // ~1.7 กม.
    expect(res.flags).toContain('LOCATION_CHANGED');
    expect(h.d('attendancePunch').create.mock.calls[0][0].data.flags).toContain('LOCATION_CHANGED');
    expect(h.d('attendancePunch').findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ deviceId: 'dev1', geoLat: { not: null } }) }));

    const near = harness();
    near.d('attendancePunch').findFirst.mockResolvedValueOnce({ geoLat: '14.799500', geoLng: '100.653400' });
    const ok = await near.service.punch({ device: DEVICE, userId: 'u1', kind: 'IN', geo: { lat: 14.7999, lng: 100.6538 } }, at(10, 2)); // ~60 ม.
    expect(ok.flags).not.toContain('LOCATION_CHANGED');
  });

  it('K14 the finalize hook runs inside the punch transaction with the result and its return value comes back as nextToken', async () => {
    const h = harness();
    const finalize = jest.fn(async (_tx: unknown, result: { kind: string }) => `next-for-${result.kind}`);
    const res = await h.service.punch({ device: DEVICE, userId: 'u1', kind: 'IN' }, at(10, 2), finalize);
    expect(res.nextToken).toBe('next-for-IN');
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(h.d('attendancePunch').create.mock.invocationCallOrder[0]).toBeLessThan(finalize.mock.invocationCallOrder[0]);
  });
  it('K15 an IN right after the device\'s PIN pause ended is flagged AFTER_PIN_LOCKOUT so lateness caused by the pause is visible (รีวิว minor)', async () => {
    const h = harness();
    const paused = { ...(DEVICE as object), pinLockedUntil: at(10, 20) } as never;
    const res = await h.service.punch({ device: paused, userId: 'u1', kind: 'IN' }, at(10, 25));
    expect(res.flags).toContain('AFTER_PIN_LOCKOUT');
    expect(h.d('attendancePunch').create.mock.calls[0][0].data.flags).toContain('AFTER_PIN_LOCKOUT');
    const h2 = harness();
    const old = { ...(DEVICE as object), pinLockedUntil: at(8, 0) } as never;
    const later = await h2.service.punch({ device: old, userId: 'u1', kind: 'IN' }, at(10, 25));
    expect(later.flags).not.toContain('AFTER_PIN_LOCKOUT');
  });
  it('K16 the photo type comes from the file signature, not the client: a non-JPEG upload is not stored (NO_PHOTO); a JPEG is stored as image/jpeg even if the client claimed otherwise (รีวิว minor)', async () => {
    const h = harness();
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const res = await h.service.punch({ device: DEVICE, userId: 'u1', kind: 'IN', photo: { buffer: html, mimeType: 'image/jpeg' } }, at(10, 2));
    expect(h.storage.upload).not.toHaveBeenCalled();
    expect(res.flags).toContain('NO_PHOTO');
    const h2 = harness();
    await h2.service.punch({ device: DEVICE, userId: 'u1', kind: 'IN', photo: { buffer: JPEG, mimeType: 'text/html' } }, at(10, 2));
    expect(h2.storage.upload).toHaveBeenCalledWith(expect.stringMatching(/\.jpg$/), JPEG, 'image/jpeg');
  });
  it('K17 an IN at another branch onto a row pre-set by the schedule moves the row to the punching branch (spec §9 — รีวิวรอบ 2 C10)', async () => {
    const h = harness();
    h.d('attendanceDay').findUnique.mockResolvedValue({ id: 'day1', userId: 'u1', branchId: 'br-home', workDate: DB, dayKind: 'WORK', clockIn: null, clockOut: null, flags: [] });
    await h.service.punch({ device: DEVICE, userId: 'u1', kind: 'IN' }, at(10, 2));
    expect(h.d('attendanceDay').update.mock.calls[0][0].data).toMatchObject({ clockIn: at(10, 2), branchId: 'br1' });
  });

  it('K18 NETWORK_CHANGED is also written to the day row so the chip and the review list can show it (รีวิวรอบ 2 C16)', async () => {
    const h = harness();
    const res = await h.service.punch({ device: DEVICE, userId: 'u1', kind: 'IN', ip: '9.9.9.9' }, at(10, 2));
    expect(res.flags).toContain('NETWORK_CHANGED');
    expect(h.d('attendanceDay').create.mock.calls[0][0].data.flags).toContain('NETWORK_CHANGED');
  });

  const ROW = { id: 'day1', userId: 'u1', branchId: 'br1', workDate: DB, dayKind: 'WORK', clockIn: at(10, 30), clockOut: null, flags: [] as string[], correctedCount: 0 };

  it('K13 the day is recomputed from the row re-read under the lock: a correction committed after the pre-read (clockIn 10:00, DAY_OFF→WORK, CORRECTED) survives an OUT punch; device row is locked before the day row', async () => {
    const h = harness();
    const v1 = { ...ROW, clockIn: at(10, 0), dayKind: 'DAY_OFF', flags: ['CORRECTED'], correctedCount: 1 };
    h.d('attendanceDay').findUnique.mockResolvedValueOnce(ROW).mockResolvedValueOnce(v1); // pre-read, แล้วอ่านใหม่ใต้ล็อก
    const res = await h.service.punch({ device: DEVICE, userId: 'u1', kind: 'OUT' }, at(20, 0));
    expect(res.lateMinutes).toBe(0); // 10:00 ไม่ใช่ 10:30
    const data = h.d('attendanceDay').update.mock.calls[0][0].data;
    expect(data).toMatchObject({ dayKind: 'DAY_OFF', lateMinutes: 0 });
    expect(data.flags).toEqual(expect.arrayContaining(['CORRECTED']));
    expect(h.raw).toHaveBeenCalledTimes(2); // แถวเครื่อง แล้วแถววัน
    expect(String((h.raw.mock.calls[0][0] as string[]).join(''))).toContain('attendance_devices');
    expect(String((h.raw.mock.calls[1][0] as string[]).join(''))).toContain('attendance_days');
  });

  it('K14 the 409 rules apply to the re-read state: a concurrent IN landed first → this IN is refused and its photo is deleted', async () => {
    const h = harness();
    h.d('attendanceDay').findUnique.mockResolvedValueOnce({ ...ROW, clockIn: null }).mockResolvedValueOnce({ ...ROW, clockIn: at(10, 2) });
    await expect(h.service.punch({ device: DEVICE, userId: 'u1', kind: 'IN', photo: { buffer: JPEG, mimeType: 'image/jpeg' } }, at(10, 3))).rejects.toThrow('ตอกเข้าแล้วเมื่อ 10:02');
    expect(h.d('attendanceDay').update).not.toHaveBeenCalled();
    expect(h.storage.delete).toHaveBeenCalled();
  });

  it('K15 no row yet and a concurrent insert wins the unique (user, date): savepoint rolled back, the row is locked and updated instead of a 500', async () => {
    const h = harness();
    h.d('attendanceDay').create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    h.d('attendanceDay').findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...ROW, clockIn: null, dayKind: 'DAY_OFF' }); // pre-read null · หลังชน: แถวที่อีกฝั่งสร้าง (วันหยุดที่ตั้งไว้)
    const res = await h.service.punch({ device: DEVICE, userId: 'u1', kind: 'IN' }, at(10, 0));
    expect(res.flags).toContain('WORKED_ON_OFF_DAY');
    expect(h.exec).toHaveBeenCalledTimes(2); // SAVEPOINT · ROLLBACK TO SAVEPOINT
    expect(h.d('attendanceDay').update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'day1' }, data: expect.objectContaining({ dayKind: 'DAY_OFF', clockIn: at(10, 0), branchId: 'br1' }) }));
  });

  it('K16 a non-unique error on the day insert is not swallowed', async () => {
    const h = harness();
    h.d('attendanceDay').create.mockRejectedValueOnce(new Error('db down'));
    await expect(h.service.punch({ device: DEVICE, userId: 'u1', kind: 'IN' }, at(10, 0))).rejects.toThrow('db down');
  });
});
