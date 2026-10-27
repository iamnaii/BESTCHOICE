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
  client.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => cb(proxy));
  const settings = { getRules: jest.fn().mockResolvedValue(RULES) };
  const storage = { upload: jest.fn(async (key: string) => key) };
  const service = new KioskPunchService(proxy, settings as never, storage as never);
  const d = (k: string) => proxy[k] as Delegate;
  d('user').findUnique.mockResolvedValue({ id: 'u1', nickname: 'นุ๊ก', name: 'วรรณา ส.' });
  d('attendancePunch').create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'p-' + data.kind, ...data }));
  d('attendanceDay').create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'day1', flags: [], ...data }));
  d('attendanceDay').update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'day1', ...data }));
  return { service, d, settings, storage };
}

describe('KioskPunchService.punch', () => {
  beforeEach(() => jest.clearAllMocks());

  it('K1 first IN creates the day row (clockIn, branchId = device branch, clockInPunchId), status ON_TIME, photo uploaded under attendance/yyyy/mm/<punchId>.jpg', async () => {
    const h = harness();
    const res = await h.service.punch({ device: DEVICE, userId: 'u1', kind: 'IN', photo: { buffer: Buffer.from('x'), mimeType: 'image/jpeg' }, ip: '1.1.1.1' }, at(10, 2));
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
    const res2 = await h.service.punch({ device: DEVICE, userId: 'u1', kind: 'IN', photo: { buffer: Buffer.from('x'), mimeType: 'image/jpeg' } }, at(10, 0));
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
    h.d('attendanceDay').findFirst.mockResolvedValueOnce({ id: 'day1', userId: 'u1', branchId: 'br1', workDate: DB, dayKind: 'WORK', clockIn: at(23, 50), clockOut: null, flags: [] });
    const res = await h.service.punch({ device: DEVICE, userId: 'u1', kind: 'OUT' }, at(24, 20));
    expect(res).toMatchObject({ kind: 'OUT', otHours: 5.5 });
    // วันถัดไป 00:20 → ค้นแถวเปิดค้างของ "เมื่อวาน" = 27 ต.ค. (DAY) ตามปฏิทินไทย
    expect(h.d('attendanceDay').findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'u1', clockOut: null, workDate: DB }) }));
  });

  it('K10 ip differs from device.lastIp → NETWORK_CHANGED on the punch', async () => {
    const h = harness();
    await h.service.punch({ device: DEVICE, userId: 'u1', kind: 'IN', ip: '9.9.9.9' }, at(10, 0));
    expect(h.d('attendancePunch').create).toHaveBeenCalledWith({ data: expect.objectContaining({ flags: expect.arrayContaining(['NETWORK_CHANGED']) }) });
  });
});
