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
/**
 * harness: `$transaction(cb)` เรียก cb ด้วย client เดียวกัน · `$queryRaw` = ล็อก (คืน `locked`) และ SELECT … FOR UPDATE ·
 * `attendanceDay.findMany` แยกสองแบบ — `select.id` = ชุดที่ `lockedUpdate` จะล็อก (`toLock`) · `select.userId` = แถวที่มีอยู่ (`existing`)
 */
function harness(opts: { locked?: boolean } = {}) {
  const delegates = new Map<string, Delegate>();
  const toLock = { missingOut: [] as Array<{ id: string }>, unavailable: [] as Array<{ id: string }> };
  const existing: Array<{ userId: string }> = [];
  const client: Record<string, unknown> = {};
  const proxy: any = new Proxy(client, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (!delegates.has(key)) delegates.set(key, new Proxy({} as Delegate, { get(d, m: string) { if (!(m in d)) d[m] = jest.fn(async () => (m === 'count' ? 0 : m === 'findMany' ? [] : m.startsWith('find') ? null : m.endsWith('Many') ? { count: 0 } : {})); return d[m]; } }));
      return delegates.get(key);
    },
  });
  client.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => cb(proxy));
  client.$queryRaw = jest.fn(async (strings: TemplateStringsArray) => (strings.join('?').includes('pg_try_advisory_xact_lock') ? [{ locked: opts.locked ?? true }] : []));
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
  d('attendanceDay').findMany.mockImplementation(async (args: { where: Record<string, unknown>; select: Record<string, unknown> }) => {
    if (!args.select.id) return existing;
    return 'clockIn' in args.where && (args.where.clockIn as { not?: unknown })?.not === null ? toLock.missingOut : toLock.unavailable;
  });
  d('attendanceDay').updateMany.mockImplementation(async (args: { where: { AND: Array<{ id?: { in: string[] } }> } }) => ({ count: args.where.AND[1].id!.in.length }));
  d('attendanceDay').createMany.mockImplementation(async (args: { data: unknown[] }) => ({ count: args.data.length }));
  return { cron, d, devices, toLock, existing, client };
}

const MISSING_OUT_WHERE = { workDate: YKEY, deletedAt: null, clockIn: { not: null }, clockOut: null, NOT: { flags: { has: 'MISSING_OUT' } } };
const UNAVAILABLE_WHERE = { workDate: YKEY, branchId: 'br1', deletedAt: null, dayKind: 'WORK', clockIn: null, NOT: { flags: { has: 'DEVICE_UNAVAILABLE' } } };
const forUpdateCalls = (client: Record<string, unknown>) =>
  (client.$queryRaw as jest.Mock).mock.calls.filter(([strings]: [TemplateStringsArray]) => strings.join('?').includes('FOR UPDATE'));

describe('AttendanceCloseDayCron.run', () => {
  beforeEach(() => jest.clearAllMocks());

  it('C1 open rows of yesterday get MISSING_OUT with otHours/workedMinutes 0 — rows locked in (user_id, work_date) order first, the same condition re-applied on update', async () => {
    const h = harness();
    h.toLock.missingOut.push({ id: 'd1' }, { id: 'd2' });
    h.d('attendancePunch').count.mockResolvedValue(5);
    h.existing.push({ userId: 'u1' }, { userId: 'u2' });
    const out = await h.cron.run(RUN_AT);
    expect(h.d('attendanceDay').findMany).toHaveBeenCalledWith({ where: MISSING_OUT_WHERE, select: { id: true }, orderBy: [{ userId: 'asc' }, { workDate: 'asc' }] });
    const [strings] = forUpdateCalls(h.client)[0];
    expect(strings.join('?')).toContain('ORDER BY user_id, work_date FOR UPDATE');
    expect(h.d('attendanceDay').updateMany).toHaveBeenCalledWith({
      where: { AND: [MISSING_OUT_WHERE, { id: { in: ['d1', 'd2'] } }] },
      data: { flags: { push: 'MISSING_OUT' }, otHours: 0, workedMinutes: 0 },
    });
    expect(out.closed).toBe(2);
  });

  it('C2 the target day is the Thai calendar day before the run (a 23:50 IN of yesterday is closed; today is never touched)', async () => {
    const h = harness();
    await h.cron.run(RUN_AT);
    const where = h.d('attendanceDay').findMany.mock.calls[0][0].where;
    expect(where.workDate).toEqual(YKEY);
    expect(where.workDate).not.toEqual(dbDate(bangkokMidnight(2026, 9, 27)));
    // รันเวลา 02:00Z 27 ต.ค. (09:00 ไทย) ก็ยังชี้ 26 ต.ค.
    h.d('attendanceDay').findMany.mockClear();
    await h.cron.run(new Date('2026-10-27T02:00:00.000Z'));
    expect(h.d('attendanceDay').findMany.mock.calls[0][0].where.workDate).toEqual(YKEY);
  });

  it('C3 a branch with zero punches yesterday → no absences; DEVICE_UNAVAILABLE rows for PIN-holders without a row (createMany skipDuplicates) + one owner Todo', async () => {
    const h = harness();
    h.d('attendancePunch').count.mockResolvedValue(0);
    h.existing.push({ userId: 'u2' }); // u2 มีแถวแล้ว (เช่น วันหยุด)
    const out = await h.cron.run(RUN_AT);
    expect(h.d('attendanceDay').createMany).toHaveBeenCalledTimes(1);
    expect(h.d('attendanceDay').createMany).toHaveBeenCalledWith({
      data: [{ userId: 'u1', branchId: 'br1', workDate: YKEY, dayKind: 'WORK', flags: ['DEVICE_UNAVAILABLE'] }],
      skipDuplicates: true,
    });
    expect(h.devices.createOwnerTodo).toHaveBeenCalledWith(expect.objectContaining({ priority: 'MEDIUM', title: expect.stringContaining('ลพบุรี') }));
    expect(out).toMatchObject({ absent: 0, unavailableBranches: ['br1'] });
  });

  it('C4 a branch with punches → PIN-holders without a row get a WORK row with no times (= absent); users without a PIN and existing rows are untouched', async () => {
    const h = harness();
    h.d('attendancePunch').count.mockResolvedValue(3);
    h.existing.push({ userId: 'u2' });
    const out = await h.cron.run(RUN_AT);
    expect(h.d('attendanceDay').createMany).toHaveBeenCalledWith({
      data: [{ userId: 'u1', branchId: 'br1', workDate: YKEY, dayKind: 'WORK', flags: [] }],
      skipDuplicates: true,
    });
    expect(h.d('attendanceDay').update).not.toHaveBeenCalled();
    expect(h.devices.createOwnerTodo).not.toHaveBeenCalled();
    expect(out.absent).toBe(1);
  });

  it('C5 a second run is a no-op (rows exist, flag already set)', async () => {
    const h = harness();
    h.d('attendancePunch').count.mockResolvedValue(3);
    h.existing.push({ userId: 'u1' }, { userId: 'u2' });
    const out = await h.cron.run(RUN_AT);
    expect(h.d('attendanceDay').createMany).not.toHaveBeenCalled();
    expect(h.d('attendanceDay').updateMany).not.toHaveBeenCalled();
    expect(out).toMatchObject({ closed: 0, absent: 0, unavailableBranches: [] });
  });

  it('C5b another instance created the absence row first → skipDuplicates inserts 0 and nothing is counted (no P2002)', async () => {
    const h = harness();
    h.d('attendancePunch').count.mockResolvedValue(3);
    h.existing.push({ userId: 'u2' });
    h.d('attendanceDay').createMany.mockResolvedValueOnce({ count: 0 });
    const out = await h.cron.run(RUN_AT);
    expect(out.absent).toBe(0);
  });

  it('C6 a thrown error is captured (Sentry) and never propagates', async () => {
    const h = harness();
    h.d('attendanceDay').findMany.mockRejectedValueOnce(new Error('db down'));
    await expect(h.cron.run(RUN_AT)).resolves.toMatchObject({ closed: 0 });
  });
  it('C9 a branch that had no attendance device yet that day is skipped: no absence rows, no "device unavailable" Todo (รีวิว minor)', async () => {
    const h = harness();
    h.d('attendanceDevice').count.mockResolvedValue(0);
    h.d('attendancePunch').count.mockResolvedValue(0);
    const out = await h.cron.run(RUN_AT);
    expect(h.d('attendanceDevice').count).toHaveBeenCalledWith({ where: { branchId: 'br1', deletedAt: null, createdAt: { lt: new Date(Y.getTime() + 24 * 3600_000) } } });
    expect(h.d('attendanceDay').createMany).not.toHaveBeenCalled();
    expect(h.devices.createOwnerTodo).not.toHaveBeenCalled();
    expect(out.unavailableBranches).toEqual([]);
  });
  it('C10 on a day with no punches at the branch, staff who already had a WORK row (pre-set by the schedule) get DEVICE_UNAVAILABLE too, not ABSENT (รีวิวรอบ 2 C7)', async () => {
    const h = harness();
    h.d('attendancePunch').count.mockResolvedValue(0);
    h.existing.push({ userId: 'u1' }, { userId: 'u2' }); // ทุกคนมีแถวแล้ว (ตั้งจากตาราง)
    h.toLock.unavailable.push({ id: 'w1' }, { id: 'w2' });
    const out = await h.cron.run(RUN_AT);
    expect(h.d('attendanceDay').updateMany).toHaveBeenCalledWith({
      where: { AND: [UNAVAILABLE_WHERE, { id: { in: ['w1', 'w2'] } }] },
      data: { flags: { push: 'DEVICE_UNAVAILABLE' } },
    });
    expect(out.unavailableBranches).toEqual(['br1']);
    expect(h.devices.createOwnerTodo).toHaveBeenCalledTimes(1);
  });
  it('C11 another instance holds the close-day lock → this run is skipped: no reads, no writes, no Todo', async () => {
    const h = harness({ locked: false });
    h.d('attendancePunch').count.mockResolvedValue(0);
    const out = await h.cron.run(RUN_AT);
    expect(out).toMatchObject({ skipped: true, closed: 0, absent: 0, unavailableBranches: [] });
    expect(h.d('branch').findMany).not.toHaveBeenCalled();
    expect(h.d('attendanceDay').createMany).not.toHaveBeenCalled();
    expect(h.devices.createOwnerTodo).not.toHaveBeenCalled();
  });
  it('C12 a re-run on a no-punch day where every row is already created/flagged sends no second owner Todo', async () => {
    const h = harness();
    h.d('attendancePunch').count.mockResolvedValue(0);
    h.existing.push({ userId: 'u1' }, { userId: 'u2' }); // ไม่มีแถวต้องสร้าง · ไม่มีแถวต้องติดธง (toLock.unavailable ว่าง)
    const out = await h.cron.run(RUN_AT);
    expect(out.unavailableBranches).toEqual(['br1']);
    expect(h.devices.createOwnerTodo).not.toHaveBeenCalled();
  });
});
