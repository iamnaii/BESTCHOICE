import { bangkokMidnight } from '../../../utils/date.util';
import { dbDate } from '../attendance-rules';
import { AttendanceCloseDayCron } from '../crons/attendance-close-day.cron';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

/** ก้อน 10 D3 Task 6 — cron 00:05: ปิดวันที่ลืมตอกออก · ขาด (เฉพาะคนมีรหัส) · สาขาไม่มีการตอกเลย = DEVICE_UNAVAILABLE ไม่นับขาด (สเปก §5 §10) */
const Y = bangkokMidnight(2026, 9, 26); // วันเป้าหมาย = เมื่อวาน (26 ต.ค.) เมื่อรัน 27 ต.ค. 00:05
const RUN_AT = new Date(bangkokMidnight(2026, 9, 27).getTime() + 5 * 60_000);
const YKEY = dbDate(Y);
const at = (h: number, m: number, d = Y) => new Date(d.getTime() + (h * 60 + m) * 60_000);

type Delegate = Record<string, jest.Mock>;
function harness() {
  const delegates = new Map<string, Delegate>();
  const client: Record<string, unknown> = {};
  const proxy: any = new Proxy(client, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (!delegates.has(key)) delegates.set(key, new Proxy({} as Delegate, { get(d, m: string) { if (!(m in d)) d[m] = jest.fn(async () => (m === 'count' ? 0 : m === 'findMany' ? [] : m.startsWith('find') ? null : m.endsWith('Many') ? { count: 0 } : {})); return d[m]; } }));
      return delegates.get(key);
    },
  });
  const devices = { createOwnerTodo: jest.fn(async () => undefined) };
  const cron = new AttendanceCloseDayCron(proxy, devices as never);
  const d = (k: string) => proxy[k] as Delegate;
  d('branch').findMany.mockResolvedValue([{ id: 'br1', name: 'ลพบุรี' }]);
  d('attendanceDevice').count.mockResolvedValue(1); // สาขามีเครื่องตอกบัตรแล้ว
  d('user').findMany.mockResolvedValue([
    { id: 'u1', branchId: 'br1', attendancePinHash: 'h' },
    { id: 'u2', branchId: 'br1', attendancePinHash: 'h' },
    { id: 'u3', branchId: 'br1', attendancePinHash: null }, // ยังไม่เริ่มใช้ระบบ
  ]);
  return { cron, d, devices };
}

describe('AttendanceCloseDayCron.run', () => {
  beforeEach(() => jest.clearAllMocks());

  it('C1 open rows of yesterday get MISSING_OUT with otHours/workedMinutes 0 (only once)', async () => {
    const h = harness();
    h.d('attendanceDay').updateMany.mockResolvedValueOnce({ count: 2 });
    h.d('attendancePunch').count.mockResolvedValue(5);
    h.d('attendanceDay').findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);
    const out = await h.cron.run(RUN_AT);
    expect(h.d('attendanceDay').updateMany).toHaveBeenCalledWith({
      where: { workDate: YKEY, deletedAt: null, clockIn: { not: null }, clockOut: null, NOT: { flags: { has: 'MISSING_OUT' } } },
      data: { flags: { push: 'MISSING_OUT' }, otHours: 0, workedMinutes: 0 },
    });
    expect(out.closed).toBe(2);
  });

  it('C2 the target day is the Thai calendar day before the run (a 23:50 IN of yesterday is closed; today is never touched)', async () => {
    const h = harness();
    await h.cron.run(RUN_AT);
    const where = h.d('attendanceDay').updateMany.mock.calls[0][0].where;
    expect(where.workDate).toEqual(YKEY);
    expect(where.workDate).not.toEqual(dbDate(bangkokMidnight(2026, 9, 27)));
    // รันเวลา 02:00Z 27 ต.ค. (09:00 ไทย) ก็ยังชี้ 26 ต.ค.
    await h.cron.run(new Date('2026-10-27T02:00:00.000Z'));
    expect(h.d('attendanceDay').updateMany.mock.calls[1][0].where.workDate).toEqual(YKEY);
  });

  it('C3 a branch with zero punches yesterday → no absences; DEVICE_UNAVAILABLE rows for PIN-holders without a row + one owner Todo', async () => {
    const h = harness();
    h.d('attendancePunch').count.mockResolvedValue(0);
    h.d('attendanceDay').findMany.mockResolvedValue([{ userId: 'u2' }]); // u2 มีแถวแล้ว (เช่น วันหยุด)
    const out = await h.cron.run(RUN_AT);
    expect(h.d('attendanceDay').create).toHaveBeenCalledTimes(1);
    expect(h.d('attendanceDay').create).toHaveBeenCalledWith({ data: { userId: 'u1', branchId: 'br1', workDate: YKEY, dayKind: 'WORK', flags: ['DEVICE_UNAVAILABLE'] } });
    expect(h.devices.createOwnerTodo).toHaveBeenCalledWith(expect.objectContaining({ priority: 'MEDIUM', title: expect.stringContaining('ลพบุรี') }));
    expect(out).toMatchObject({ absent: 0, unavailableBranches: ['br1'] });
  });

  it('C4 a branch with punches → PIN-holders without a row get a WORK row with no times (= absent); users without a PIN and existing rows are untouched', async () => {
    const h = harness();
    h.d('attendancePunch').count.mockResolvedValue(3);
    h.d('attendanceDay').findMany.mockResolvedValue([{ userId: 'u2' }]);
    const out = await h.cron.run(RUN_AT);
    expect(h.d('attendanceDay').create).toHaveBeenCalledTimes(1);
    expect(h.d('attendanceDay').create).toHaveBeenCalledWith({ data: { userId: 'u1', branchId: 'br1', workDate: YKEY, dayKind: 'WORK', flags: [] } });
    expect(h.d('attendanceDay').update).not.toHaveBeenCalled();
    expect(h.devices.createOwnerTodo).not.toHaveBeenCalled();
    expect(out.absent).toBe(1);
  });

  it('C5 a second run is a no-op (rows exist, flag already set)', async () => {
    const h = harness();
    h.d('attendancePunch').count.mockResolvedValue(3);
    h.d('attendanceDay').findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);
    const out = await h.cron.run(RUN_AT);
    expect(h.d('attendanceDay').create).not.toHaveBeenCalled();
    expect(out).toMatchObject({ closed: 0, absent: 0, unavailableBranches: [] });
  });

  it('C6 a thrown error is captured (Sentry) and never propagates', async () => {
    const h = harness();
    h.d('attendanceDay').updateMany.mockRejectedValueOnce(new Error('db down'));
    await expect(h.cron.run(RUN_AT)).resolves.toMatchObject({ closed: 0 });
  });
  it('C9 a branch that had no attendance device yet that day is skipped: no absence rows, no "device unavailable" Todo (รีวิว minor)', async () => {
    const h = harness();
    h.d('attendanceDevice').count.mockResolvedValue(0);
    h.d('attendancePunch').count.mockResolvedValue(0);
    const out = await h.cron.run(RUN_AT);
    expect(h.d('attendanceDevice').count).toHaveBeenCalledWith({ where: { branchId: 'br1', deletedAt: null, createdAt: { lt: new Date(Y.getTime() + 24 * 3600_000) } } });
    expect(h.d('attendanceDay').create).not.toHaveBeenCalled();
    expect(h.devices.createOwnerTodo).not.toHaveBeenCalled();
    expect(out.unavailableBranches).toEqual([]);
  });
  it('C10 on a day with no punches at the branch, staff who already had a WORK row (pre-set by the schedule) get DEVICE_UNAVAILABLE too, not ABSENT (รีวิวรอบ 2 C7)', async () => {
    const h = harness();
    h.d('attendancePunch').count.mockResolvedValue(0);
    h.d('attendanceDay').findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]); // ทุกคนมีแถวแล้ว (ตั้งจากตาราง)
    h.d('attendanceDay').updateMany.mockResolvedValue({ count: 2 });
    const out = await h.cron.run(RUN_AT);
    expect(h.d('attendanceDay').updateMany).toHaveBeenCalledWith({
      where: { workDate: YKEY, branchId: 'br1', deletedAt: null, dayKind: 'WORK', clockIn: null, NOT: { flags: { has: 'DEVICE_UNAVAILABLE' } } },
      data: { flags: { push: 'DEVICE_UNAVAILABLE' } },
    });
    expect(out.unavailableBranches).toEqual(['br1']);
    expect(h.devices.createOwnerTodo).toHaveBeenCalledTimes(1);
  });
});
