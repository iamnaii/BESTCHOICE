import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';
import { bangkokMidnight } from '../../../utils/date.util';
import { AttendanceService } from '../attendance.service';
import { dbDate } from '../attendance-rules';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

/** ก้อน 10 D3 Task 5 — หลังบ้าน: วันนี้ · รายเดือน · รูป · แก้ไข (maker≠checker) · ตารางหยุด (สเปก §6 §7 §8) */
const DAY = bangkokMidnight(2026, 9, 27);
const at = (h: number, m: number, d = DAY) => new Date(d.getTime() + (h * 60 + m) * 60_000);
const RULES = { workStart: '10:00', workEnd: '19:00', lateGraceMinutes: 15 };
const OWNER = { id: 'owner', role: 'OWNER', branchId: null };
const BM = { id: 'bm1', role: 'BRANCH_MANAGER', branchId: 'br1' };
const BM_OTHER = { id: 'bm2', role: 'BRANCH_MANAGER', branchId: 'br2' };

type Delegate = Record<string, jest.Mock>;
function harness() {
  const delegates = new Map<string, Delegate>();
  const calls: string[] = [];
  /** `root:`/`tx:` + delegate.method ตามลำดับที่เรียกจริง — ใช้ตรวจว่าอ่านใหม่ผ่าน tx หลัง FOR UPDATE */
  const where: string[] = [];
  const raw = (key: string): Delegate => {
    if (!delegates.has(key)) delegates.set(key, new Proxy({} as Delegate, { get(d, m: string) { if (!(m in d)) d[m] = jest.fn(async () => { calls.push(`${key}.${m}`); return m === 'findMany' ? [] : m.startsWith('find') ? null : m.endsWith('Many') ? { count: 0 } : {}; }); return d[m]; } }));
    return delegates.get(key)!;
  };
  const make = (label: 'root' | 'tx') => {
    const client: Record<string, unknown> = {
      $queryRaw: jest.fn(async () => { calls.push('rowlock'); where.push(`${label}:$queryRaw`); return []; }),
      $executeRaw: jest.fn(async () => { calls.push('lock'); where.push(`${label}:$executeRaw`); return 0; }),
    };
    return new Proxy(client, {
      get(target, key: string) {
        if (key in target) return target[key];
        const d = raw(key);
        return new Proxy(d, { get: (t, m: string) => (typeof t[m] === 'function' ? (...a: unknown[]) => { where.push(`${label}:${key}.${m}`); return (t[m] as jest.Mock)(...a); } : t[m]) });
      },
    }) as any;
  };
  const proxy: any = make('root');
  const txClient: any = make('tx');
  proxy.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => { calls.push('tx:start'); const out = await cb(txClient); calls.push('tx:end'); return out; });
  const audit = { log: jest.fn(async () => { calls.push('audit'); }) };
  const settings = { getRules: jest.fn().mockResolvedValue(RULES) };
  const storage = { getStream: jest.fn(async () => Readable.from(['img'])) };
  const service = new AttendanceService(proxy, audit as never, settings as never, storage as never);
  return { service, d: raw, audit, calls, where, storage, settings, tx: txClient };
}

const users = [
  { id: 'u1', nickname: 'นุ๊ก', name: 'วรรณา', role: 'SALES', branchId: 'br1', attendancePinHash: 'h' },
  { id: 'u2', nickname: 'เอก', name: 'เอกชัย', role: 'BRANCH_MANAGER', branchId: 'br1', attendancePinHash: 'h' },
  { id: 'u3', nickname: 'มิ้นท์', name: 'สุมิตรา', role: 'SALES', branchId: 'br1', attendancePinHash: 'h' },
  { id: 'u4', nickname: 'ต้น', name: 'ธนากร', role: 'SALES', branchId: 'br1', attendancePinHash: 'h' },
  { id: 'u5', nickname: 'แนน', name: 'อรทัย', role: 'SALES', branchId: 'br1', attendancePinHash: 'h' },
];
const dayRow = (o: Record<string, unknown>) => ({ id: 'd-' + o.userId, branchId: 'br1', workDate: dbDate(DAY), dayKind: 'WORK', clockIn: null, clockOut: null, clockInPunchId: null, clockOutPunchId: null, workedMinutes: 0, lateMinutes: 0, earlyLeaveMinutes: 0, otHours: 0, flags: [], note: null, correctedCount: 0, ...o });

describe('AttendanceService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('S1 today: statuses ON_TIME/LATE/NOT_IN/DAY_OFF/MISSING_OUT + kpi counts', async () => {
    const h = harness();
    h.d('user').findMany.mockResolvedValue(users);
    h.d('attendanceDay').findMany.mockResolvedValue([
      dayRow({ userId: 'u1', clockIn: at(10, 2) }),
      dayRow({ userId: 'u2', clockIn: at(10, 16), lateMinutes: 16 }),
      dayRow({ userId: 'u4', dayKind: 'DAY_OFF' }),
      dayRow({ userId: 'u5', clockIn: at(10, 1), flags: ['MISSING_OUT'] }),
    ]);
    const out = await h.service.today(OWNER, 'br1', at(14, 0));
    expect(out.rows.map((r) => [r.userId, r.status])).toEqual(expect.arrayContaining([['u1', 'ON_TIME'], ['u2', 'LATE'], ['u3', 'NOT_IN'], ['u4', 'DAY_OFF'], ['u5', 'MISSING_OUT']]));
    expect(out.kpi).toEqual({ staff: 5, present: 3, onTime: 2, late: 1, absentSoFar: 1, off: 1, leave: 0, flagged: 1 });
    expect(out.rules).toEqual(RULES);
    expect(out.date).toBe('2026-10-27');
  });

  it('S2 today includes a visiting employee whose home branch is elsewhere but who has a day row at this branch', async () => {
    const h = harness();
    h.d('user').findMany.mockResolvedValue([...users, { id: 'u9', nickname: 'บิว', name: 'ปิยะ', role: 'SALES', branchId: 'br2', attendancePinHash: 'h' }]);
    h.d('attendanceDay').findMany.mockResolvedValue([dayRow({ userId: 'u9', clockIn: at(9, 55) })]);
    const out = await h.service.today(OWNER, 'br1', at(14, 0));
    expect(h.d('user').findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: [{ branchId: 'br1' }, { attendanceDays: { some: { workDate: dbDate(DAY), branchId: 'br1', deletedAt: null } } }] }) }));
    expect(out.rows.find((r) => r.userId === 'u9')).toMatchObject({ status: 'ON_TIME', visiting: true });
  });

  it('S3 month: per-day cells + summary (workDays, late count/minutes, absent = past WORK rows without clockIn, leave, OT sum)', async () => {
    const h = harness();
    h.d('user').findMany.mockResolvedValue([users[0]]);
    h.d('attendanceDay').findMany.mockResolvedValue([
      dayRow({ userId: 'u1', workDate: dbDate(bangkokMidnight(2026, 9, 20)), clockIn: at(10, 0, bangkokMidnight(2026, 9, 20)), clockOut: at(20, 50, bangkokMidnight(2026, 9, 20)), otHours: 2 }),
      dayRow({ userId: 'u1', workDate: dbDate(bangkokMidnight(2026, 9, 21)), clockIn: at(10, 20, bangkokMidnight(2026, 9, 21)), lateMinutes: 20, otHours: 0.5 }),
      dayRow({ userId: 'u1', workDate: dbDate(bangkokMidnight(2026, 9, 22)), dayKind: 'DAY_OFF' }),
      dayRow({ userId: 'u1', workDate: dbDate(bangkokMidnight(2026, 9, 23)), dayKind: 'LEAVE_SICK' }),
      dayRow({ userId: 'u1', workDate: dbDate(bangkokMidnight(2026, 9, 24)) }), // WORK ไม่มีเวลา ในอดีต = ขาด
      dayRow({ userId: 'u1', workDate: dbDate(bangkokMidnight(2026, 9, 30)) }), // อนาคต ไม่นับขาด
    ]);
    const out = await h.service.month(OWNER, 'br1', '2026-10', at(14, 0));
    expect(out.days.length).toBe(31);
    const row = out.rows[0];
    expect(row.summary).toEqual({ workDays: 2, lateCount: 1, lateMinutes: 20, absent: 1, leave: 1, otHours: 2.5 });
    expect(row.cells['2026-10-20']).toMatchObject({ status: 'ON_TIME', otHours: 2 });
    expect(row.cells['2026-10-21']).toMatchObject({ status: 'LATE', lateMinutes: 20 });
    expect(row.cells['2026-10-24']).toMatchObject({ status: 'ABSENT' });
    expect(row.cells['2026-10-30']).toMatchObject({ status: 'NONE' });
  });

  it('S4 branch scope: BM of another branch → 403 · BM without branchId → 403 · SALES → 403 · BM of this branch passes', async () => {
    const h = harness();
    await expect(h.service.today(BM_OTHER, 'br1')).rejects.toThrow(ForbiddenException);
    await expect(h.service.today({ id: 'bm0', role: 'BRANCH_MANAGER', branchId: null }, 'br1')).rejects.toThrow(ForbiddenException);
    await expect(h.service.today({ id: 's', role: 'SALES', branchId: 'br1' }, 'br1')).rejects.toThrow(ForbiddenException);
    await expect(h.service.today(BM, 'br1')).resolves.toBeDefined();
  });

  it('S5 correctDay recomputes with the branch rules, strips MISSING_OUT, adds CORRECTED, writes AttendanceCorrection in the tx and audits after commit', async () => {
    const h = harness();
    h.d('attendanceDay').findUnique.mockResolvedValue(dayRow({ userId: 'u5', clockIn: at(10, 1), clockOut: null, flags: ['MISSING_OUT', 'NO_PHOTO'] }));
    h.d('attendanceDay').update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => dayRow({ userId: 'u5', ...data }));
    const out = await h.service.correctDay(BM, 'd-u5', { clockOut: at(20, 30).toISOString(), reason: 'ลืมตอกออก มีลูกค้าทำสัญญาถึงสองทุ่มครึ่ง' });
    expect(out).toMatchObject({ clockOut: at(20, 30), otHours: 1.5, workedMinutes: 629, correctedCount: 1 });
    expect(out.flags).toEqual(expect.arrayContaining(['CORRECTED', 'NO_PHOTO']));
    expect(out.flags).not.toContain('MISSING_OUT');
    expect(h.d('attendanceCorrection').create).toHaveBeenCalledWith({ data: expect.objectContaining({ dayId: 'd-u5', changedById: 'bm1', reason: expect.stringContaining('ลืมตอกออก'), before: expect.objectContaining({ clockOut: null }), after: expect.objectContaining({ otHours: 1.5 }) }) });
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ userId: 'bm1', action: 'ATTENDANCE_CORRECTED', entity: 'attendance_day', entityId: 'd-u5', newValue: expect.objectContaining({ reason: expect.any(String) }) }));
    expect(h.calls.indexOf('audit')).toBeGreaterThan(h.calls.lastIndexOf('tx:end'));
    expect(h.calls.indexOf('attendanceCorrection.create')).toBeGreaterThan(h.calls.indexOf('tx:start'));
  });

  it('S6 correctDay with a reason shorter than 10 chars → 400 and nothing written', async () => {
    const h = harness();
    h.d('attendanceDay').findUnique.mockResolvedValue(dayRow({ userId: 'u5', clockIn: at(10, 1) }));
    await expect(h.service.correctDay(OWNER, 'd-u5', { clockOut: at(19, 0).toISOString(), reason: 'สั้นไป' })).rejects.toThrow(BadRequestException);
    expect(h.d('attendanceDay').update).not.toHaveBeenCalled();
  });

  it('S7 setDayKinds upserts per (user, date) without touching existing clock times', async () => {
    const h = harness();
    h.d('user').findMany.mockResolvedValue([{ id: 'u1', branchId: 'br1' }, { id: 'u3', branchId: 'br1' }]);
    await h.service.setDayKinds(BM, { branchId: 'br1', entries: [{ userId: 'u1', date: '2026-10-29', dayKind: 'DAY_OFF' }, { userId: 'u3', date: '2026-10-28', dayKind: 'LEAVE_SICK' }] }, at(14, 0));
    expect(h.d('attendanceDay').upsert).toHaveBeenCalledWith({
      where: { userId_workDate: { userId: 'u1', workDate: dbDate(bangkokMidnight(2026, 9, 29)) } },
      create: { userId: 'u1', branchId: 'br1', workDate: dbDate(bangkokMidnight(2026, 9, 29)), dayKind: 'DAY_OFF' },
      update: { dayKind: 'DAY_OFF' },
    });
    expect(h.d('attendanceDay').upsert).toHaveBeenCalledTimes(2);
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ATTENDANCE_DAY_KINDS_SET', userId: 'bm1' }));
  });

  it('S8 a branch manager cannot correct their own row or set their own day-off (403); OWNER can', async () => {
    const h = harness();
    h.d('attendanceDay').findUnique.mockResolvedValue(dayRow({ userId: 'bm1', clockIn: at(10, 1) }));
    await expect(h.service.correctDay(BM, 'd-bm1', { clockOut: at(20, 0).toISOString(), reason: 'ลืมตอกออกเพราะปิดร้านช้า' })).rejects.toThrow(ForbiddenException);
    await expect(h.service.setDayKinds(BM, { branchId: 'br1', entries: [{ userId: 'bm1', date: '2026-10-29', dayKind: 'DAY_OFF' }] })).rejects.toThrow(ForbiddenException);
    h.d('attendanceDay').update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => dayRow({ userId: 'bm1', ...data }));
    await expect(h.service.correctDay(OWNER, 'd-bm1', { clockOut: at(20, 0).toISOString(), reason: 'ลืมตอกออกเพราะปิดร้านช้า' })).resolves.toBeDefined();
  });

  it('S9 correctDay never removes DEVICE_CONFLICT; clearConflictFlag (OWNER only) does, with audit', async () => {
    const h = harness();
    h.d('attendanceDay').findUnique.mockResolvedValue(dayRow({ userId: 'u1', clockIn: at(10, 1), flags: ['DEVICE_CONFLICT'] }));
    h.d('attendanceDay').update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => dayRow({ userId: 'u1', ...data }));
    const out = await h.service.correctDay(OWNER, 'd-u1', { clockOut: at(19, 0).toISOString(), reason: 'ตรวจกับกล้องวงจรปิดแล้ว' });
    expect(out.flags).toContain('DEVICE_CONFLICT');
    await expect(h.service.clearConflictFlag(BM, 'd-u1')).rejects.toThrow(ForbiddenException);
    await h.service.clearConflictFlag(OWNER, 'd-u1');
    expect(h.d('attendanceDay').update).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: 'd-u1' }, data: { flags: [] } }));
    expect(h.audit.log).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'ATTENDANCE_CONFLICT_CLEARED', userId: 'owner' }));
  });

  it('S10 photoStream checks branch scope through the punch and streams the stored key', async () => {
    const h = harness();
    h.d('attendancePunch').findUnique.mockResolvedValue({ id: 'p1', branchId: 'br1', photoKey: 'attendance/2026/10/p1.jpg' });
    await expect(h.service.photoStream(BM_OTHER, 'p1')).rejects.toThrow(ForbiddenException);
    const out = await h.service.photoStream(BM, 'p1');
    expect(h.storage.getStream).toHaveBeenCalledWith('attendance/2026/10/p1.jpg');
    expect(out.contentType).toBe('image/jpeg');
    h.d('attendancePunch').findUnique.mockResolvedValue({ id: 'p2', branchId: 'br1', photoKey: null });
    await expect(h.service.photoStream(OWNER, 'p2')).rejects.toThrow(/ไม่มีรูป/);
  });

  it('S11 me returns only the caller rows for the month, no kpi', async () => {
    const h = harness();
    h.d('attendanceDay').findMany.mockResolvedValue([dayRow({ userId: 'u1', workDate: dbDate(bangkokMidnight(2026, 9, 20)), clockIn: at(10, 0, bangkokMidnight(2026, 9, 20)), clockOut: at(19, 0, bangkokMidnight(2026, 9, 20)) })]);
    const out = await h.service.me('u1', '2026-10', at(14, 0));
    expect(h.d('attendanceDay').findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'u1', deletedAt: null }) }));
    expect(out.rows[0]).toMatchObject({ date: '2026-10-20', status: 'ON_TIME' });
    expect(out.summary).toEqual({ workDays: 1, lateCount: 0, lateMinutes: 0, absent: 0, leave: 0, otHours: 0 });
  });
  it('S12 setDayKinds by a branch manager only covers their own branch\'s staff and rows: another branch\'s employee or a visiting row elsewhere → 403; OWNER may (รีวิว I2)', async () => {
    const h = harness();
    h.d('user').findMany.mockResolvedValue([{ id: 'u9', branchId: 'br2' }]);
    await expect(h.service.setDayKinds(BM, { branchId: 'br1', entries: [{ userId: 'u9', date: '2026-10-29', dayKind: 'LEAVE_SICK' }] }, at(14, 0))).rejects.toThrow(ForbiddenException);
    h.d('user').findMany.mockResolvedValue([{ id: 'u1', branchId: 'br1' }]);
    h.d('attendanceDay').findMany.mockResolvedValue([dayRow({ userId: 'u1', branchId: 'br2', workDate: dbDate(bangkokMidnight(2026, 9, 29)) })]);
    await expect(h.service.setDayKinds(BM, { branchId: 'br1', entries: [{ userId: 'u1', date: '2026-10-29', dayKind: 'DAY_OFF' }] }, at(14, 0))).rejects.toThrow(ForbiddenException);
    expect(h.d('attendanceDay').upsert).not.toHaveBeenCalled();
    h.d('user').findMany.mockResolvedValue([{ id: 'u9', branchId: 'br2' }]);
    h.d('attendanceDay').findMany.mockResolvedValue([]);
    await h.service.setDayKinds(OWNER, { branchId: 'br1', entries: [{ userId: 'u9', date: '2026-10-29', dayKind: 'LEAVE_SICK' }] }, at(14, 0));
    expect(h.d('attendanceDay').upsert).toHaveBeenCalledTimes(1);
  });

  it('S13 setDayKinds refuses past dates for everyone — after-the-fact leave goes through the reasoned correction (spec §6) — with a message pointing at that dialog (รีวิว I2)', async () => {
    const h = harness();
    h.d('user').findMany.mockResolvedValue([{ id: 'u1', branchId: 'br1' }]);
    const err = await h.service.setDayKinds(OWNER, { branchId: 'br1', entries: [{ userId: 'u1', date: '2026-10-26', dayKind: 'LEAVE_SICK' }] }, at(14, 0)).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain('แก้ไข');
    expect(h.d('attendanceDay').upsert).not.toHaveBeenCalled();
    // วันนี้ยังกำหนดได้
    await h.service.setDayKinds(OWNER, { branchId: 'br1', entries: [{ userId: 'u1', date: '2026-10-27', dayKind: 'LEAVE_SICK' }] }, at(14, 0));
    expect(h.d('attendanceDay').upsert).toHaveBeenCalledTimes(1);
  });

  it('S14 correctDay can clear a clock-in (null) together with the clock-out — the day becomes "not present" with punch links cleared; clearing IN while keeping OUT → 400 (รีวิว I9)', async () => {
    const h = harness();
    h.d('attendanceDay').findUnique.mockResolvedValue(dayRow({ userId: 'u1', clockIn: at(10, 2), clockOut: at(19, 0), clockInPunchId: 'p-in', clockOutPunchId: 'p-out', flags: ['DEVICE_CONFLICT'] }));
    h.d('attendanceDay').update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'd-u1', ...data }));
    await h.service.correctDay(OWNER, 'd-u1', { clockIn: null, clockOut: null, reason: 'ตรวจรูปแล้ว ไม่ใช่ตัวพนักงาน ตอกแทนกัน' } as never);
    const data = h.d('attendanceDay').update.mock.calls[0][0].data;
    expect(data).toMatchObject({ clockIn: null, clockOut: null, clockInPunchId: null, clockOutPunchId: null, workedMinutes: 0, lateMinutes: 0, otHours: 0 });
    expect(data.flags).toEqual(expect.arrayContaining(['DEVICE_CONFLICT', 'CORRECTED'])); // ธงชนยังอยู่ ล้างได้เฉพาะ clearConflictFlag
    await expect(h.service.correctDay(OWNER, 'd-u1', { clockIn: null, reason: 'ตรวจรูปแล้ว ไม่ใช่ตัวพนักงาน ตอกแทนกัน' } as never)).rejects.toThrow('มีเวลาออกต้องมีเวลาเข้า');
  });
  it('S15 today: branch staff without an attendance PIN show NO_PIN (not "not yet arrived") and are not counted in absentSoFar (รีวิว minor)', async () => {
    const h = harness();
    h.d('user').findMany.mockResolvedValue([users[0], { ...users[2], attendancePinHash: null }]);
    h.d('attendanceDay').findMany.mockResolvedValue([dayRow({ userId: 'u1', clockIn: at(10, 2) })]);
    const out = await h.service.today(OWNER, 'br1', at(14, 0));
    expect(out.rows.find((r) => r.userId === 'u3')?.status).toBe('NO_PIN');
    expect(out.kpi.absentSoFar).toBe(0);
  });

  it('S16 month: a visiting employee contributes only the rows worked at this branch; home staff keep all their rows (รีวิว minor)', async () => {
    const h = harness();
    h.d('user').findMany.mockResolvedValue([users[0], { id: 'u9', nickname: 'บิว', name: 'บิว', role: 'SALES', branchId: 'br2', attendancePinHash: 'h' }]);
    await h.service.month(BM, 'br1', '2026-10', at(14, 0));
    const where = h.d('attendanceDay').findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ branchId: 'br1' }, { userId: { in: ['u1'] } }]);
  });

  it('S17 photo: a branch manager can open the photo of their own employee who punched at another branch; another branch\'s employee there stays 403 (รีวิว minor)', async () => {
    const h = harness();
    h.d('attendancePunch').findUnique.mockResolvedValue({ id: 'p1', branchId: 'br2', photoKey: 'k.jpg', user: { branchId: 'br1' } });
    await expect(h.service.photoStream(BM, 'p1')).resolves.toMatchObject({ contentType: 'image/jpeg' });
    h.d('attendancePunch').findUnique.mockResolvedValue({ id: 'p2', branchId: 'br2', photoKey: 'k.jpg', user: { branchId: 'br2' } });
    await expect(h.service.photoStream(BM, 'p2')).rejects.toThrow(ForbiddenException);
  });

  it('S18 setDayKinds refuses a row that already has a clock-in (changing its kind changes pay) — the message points at แก้ไข with a reason (รีวิวรอบ 2 C6)', async () => {
    const h = harness();
    h.d('user').findMany.mockResolvedValue([{ id: 'u1', branchId: 'br1' }]);
    h.d('attendanceDay').findUnique.mockResolvedValue(dayRow({ userId: 'u1', clockIn: at(10, 30), lateMinutes: 30 }));
    const err = await h.service.setDayKinds(BM, { branchId: 'br1', entries: [{ userId: 'u1', date: '2026-10-27', dayKind: 'DAY_OFF' }] }, at(14, 0)).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain('แก้ไข');
    expect(h.d('attendanceDay').update).not.toHaveBeenCalled();
    expect(h.d('attendanceDay').upsert).not.toHaveBeenCalled();
  });
  it('S19 month keeps staff who were deactivated or left during the month when they have rows in it — their OT/late/absent stay in the export (รีวิวรอบ 2 C8)', async () => {
    const h = harness();
    await h.service.month(OWNER, 'br1', '2026-10', at(14, 0));
    const where = h.d('user').findMany.mock.calls[0][0].where;
    const inMonth = { gte: dbDate(bangkokMidnight(2026, 9, 1)), lt: dbDate(bangkokMidnight(2026, 10, 1)) };
    expect(where.OR).toEqual(expect.arrayContaining([
      { branchId: 'br1', deletedAt: null, isActive: true },
      { attendanceDays: { some: { workDate: inMonth, branchId: 'br1', deletedAt: null } } },
      { branchId: 'br1', attendanceDays: { some: { workDate: inMonth, deletedAt: null } } },
    ]));
    expect(where).not.toHaveProperty('isActive');
    expect(where).not.toHaveProperty('deletedAt');
  });

  it('S20 today rows carry the day row\'s branch so the page can tell a home employee who punched at another branch (รีวิวรอบ 2 C9)', async () => {
    const h = harness();
    h.d('user').findMany.mockResolvedValue([users[0]]);
    h.d('attendanceDay').findMany.mockResolvedValue([dayRow({ userId: 'u1', branchId: 'br2', clockIn: at(10, 2) })]);
    const out = await h.service.today(OWNER, 'br1', at(14, 0));
    expect(out.rows[0]).toMatchObject({ userId: 'u1', dayBranchId: 'br2' });
  });

  const PAID = { payroll: { document: { number: 'PR-2026-0042' } }, userId: 'u5' };

  it('S21 correctDay on a paid month → 409 ATTENDANCE_PAID with the payroll number; the attendance lock is taken first and nothing is written or audited', async () => {
    const h = harness();
    h.d('attendanceDay').findUnique.mockResolvedValue(dayRow({ userId: 'u5', clockIn: at(10, 1) }));
    h.d('payrollLine').findFirst.mockResolvedValue(PAID);
    const err = await h.service.correctDay(OWNER, 'd-u5', { clockOut: at(20, 0).toISOString(), reason: 'ลืมตอกออก มีลูกค้าทำสัญญา' }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ code: 'ATTENDANCE_PAID', documentNumber: 'PR-2026-0042', message: expect.stringContaining('เดือนนี้จ่ายเงินเดือนแล้ว (ใบ PR-2026-0042)') });
    expect(h.calls.indexOf('lock')).toBeGreaterThan(h.calls.indexOf('tx:start'));
    expect(h.d('payrollLine').findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'u5', payroll: { payrollPeriod: '2026-10', document: { documentType: 'PAYROLL', status: 'POSTED', deletedAt: null } } }) }));
    expect(h.d('attendanceDay').update).not.toHaveBeenCalled();
    expect(h.d('attendanceCorrection').create).not.toHaveBeenCalled();
    expect(h.audit.log).not.toHaveBeenCalled();
  });

  it('S22 setDayKinds with one paid (user, month) pair → 409 and nothing written; locks are per distinct user+period, sorted', async () => {
    const h = harness();
    h.d('user').findMany.mockResolvedValue([{ id: 'u1', branchId: 'br1' }, { id: 'u3', branchId: 'br1' }]);
    h.d('payrollLine').findFirst.mockImplementation(async ({ where }: { where: { userId: string } }) => (where.userId === 'u3' ? { ...PAID, userId: 'u3' } : null));
    const err = await h.service.setDayKinds(OWNER, { branchId: 'br1', entries: [{ userId: 'u3', date: '2026-10-29', dayKind: 'DAY_OFF' }, { userId: 'u1', date: '2026-10-29', dayKind: 'DAY_OFF' }, { userId: 'u1', date: '2026-10-30', dayKind: 'DAY_OFF' }] }, at(14, 0)).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ code: 'ATTENDANCE_PAID', documentNumber: 'PR-2026-0042' });
    expect(h.calls.filter((c) => c === 'lock')).toHaveLength(2);
    expect(h.d('attendanceDay').upsert).not.toHaveBeenCalled();
    expect(h.audit.log).not.toHaveBeenCalled();
  });

  it('S23 clearConflictFlag still works on a paid month (flags do not change pay) and never asks the payroll tables', async () => {
    const h = harness();
    h.d('attendanceDay').findUnique.mockResolvedValue(dayRow({ userId: 'u5', clockIn: at(10, 1), flags: ['DEVICE_CONFLICT'] }));
    h.d('attendanceDay').update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => dayRow({ userId: 'u5', ...data }));
    h.d('payrollLine').findFirst.mockResolvedValue(PAID);
    await expect(h.service.clearConflictFlag(OWNER, 'd-u5')).resolves.toMatchObject({ flags: [] });
    expect(h.d('payrollLine').findFirst).not.toHaveBeenCalled();
  });

  it('S24 an unpaid month is unchanged: correctDay and setDayKinds succeed, each user+period locked once', async () => {
    const h = harness();
    h.d('attendanceDay').findUnique.mockResolvedValue(dayRow({ userId: 'u5', clockIn: at(10, 1) }));
    h.d('attendanceDay').update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => dayRow({ userId: 'u5', ...data }));
    await expect(h.service.correctDay(OWNER, 'd-u5', { clockOut: at(20, 0).toISOString(), reason: 'ลืมตอกออก มีลูกค้าทำสัญญา' })).resolves.toBeDefined();
    expect(h.calls.filter((c) => c === 'lock')).toHaveLength(1);
    h.d('attendanceDay').findUnique.mockResolvedValue(null);
    await expect(h.service.setDayKinds(OWNER, { branchId: 'br1', entries: [{ userId: 'u1', date: '2026-10-29', dayKind: 'DAY_OFF' }] }, at(14, 0))).resolves.toEqual({ updated: 1 });
  });

  it('S25 month() and today() rows carry paidDocumentNumber for people with a POSTED payroll that month (null otherwise)', async () => {
    const h = harness();
    h.d('user').findMany.mockResolvedValue(users.slice(0, 2));
    h.d('payrollLine').findMany.mockResolvedValue([{ userId: 'u1', payroll: { document: { number: 'PR-2026-0042' } } }]);
    const month = await h.service.month(BM, 'br1', '2026-10', at(12, 0));
    expect(month.rows.map((r: { userId: string; paidDocumentNumber: string | null }) => [r.userId, r.paidDocumentNumber])).toEqual([['u1', 'PR-2026-0042'], ['u2', null]]);
    expect(h.d('payrollLine').findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: { in: ['u1', 'u2'] }, payroll: { payrollPeriod: '2026-10', document: { documentType: 'PAYROLL', status: 'POSTED', deletedAt: null } } }) }));
    const today = await h.service.today(BM, 'br1', at(12, 0));
    expect(today.rows.find((r) => r.userId === 'u1')?.paidDocumentNumber).toBe('PR-2026-0042');
    expect(today.rows.find((r) => r.userId === 'u2')?.paidDocumentNumber).toBeNull();
  });

  it('S26 correctDay builds everything from the row re-read under the lock: a concurrent clockOut 20:00 survives a clockIn-only correction; before = fresh row, correctedCount = fresh+1', async () => {
    const h = harness();
    const v0 = dayRow({ userId: 'u5', clockIn: at(10, 5), clockOut: null, correctedCount: 0 });
    const v1 = dayRow({ userId: 'u5', clockIn: at(10, 5), clockOut: at(20, 0), correctedCount: 1, flags: ['CORRECTED'] });
    h.d('attendanceDay').findUnique.mockResolvedValueOnce(v0).mockResolvedValueOnce(v1);
    h.d('attendanceDay').update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => dayRow({ userId: 'u5', ...data }));
    await h.service.correctDay(OWNER, 'd-u5', { clockIn: at(10, 0).toISOString(), reason: 'แก้เวลาเข้างานตามกล้องวงจรปิด' });
    const data = h.d('attendanceDay').update.mock.calls[0][0].data;
    expect(data).toMatchObject({ clockIn: at(10, 0), clockOut: at(20, 0), correctedCount: 2, otHours: 1 });
    expect(h.d('attendanceCorrection').create.mock.calls[0][0].data.before).toMatchObject({ clockOut: at(20, 0) });
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ oldValue: expect.objectContaining({ clockOut: at(20, 0) }) }));
    expect(h.calls.indexOf('rowlock')).toBeGreaterThan(h.calls.indexOf('lock'));
    // อ่านใหม่ต้องผ่าน tx หลัง FOR UPDATE (ไม่ใช่ this.prisma) · กติกาอ่านผ่าน tx เดียวกัน (item 5)
    const reads = h.where.filter((w) => w.endsWith('attendanceDay.findUnique'));
    expect(reads).toEqual(['root:attendanceDay.findUnique', 'tx:attendanceDay.findUnique']);
    expect(h.where.indexOf('tx:$queryRaw')).toBeLessThan(h.where.indexOf('tx:attendanceDay.findUnique'));
    expect(h.settings.getRules.mock.calls[0][0]).toBe('br1');
    expect(h.settings.getRules.mock.calls[0][1]).toBe(h.tx);
  });

  it('S27 correctDay: the row soft-deleted between the pre-read and the lock → 404 and nothing written', async () => {
    const h = harness();
    h.d('attendanceDay').findUnique.mockResolvedValueOnce(dayRow({ userId: 'u5', clockIn: at(10, 5) })).mockResolvedValueOnce(dayRow({ userId: 'u5', clockIn: at(10, 5), deletedAt: new Date() }));
    await expect(h.service.correctDay(OWNER, 'd-u5', { clockOut: at(20, 0).toISOString(), reason: 'ลืมตอกออก มีลูกค้าทำสัญญา' })).rejects.toThrow(NotFoundException);
    expect(h.d('attendanceDay').update).not.toHaveBeenCalled();
  });

  it('S28 setDayKinds checks "already clocked in" after the lock: a kiosk IN landing in between → 400 and nothing written', async () => {
    const h = harness();
    h.d('user').findMany.mockResolvedValue([{ id: 'u1', branchId: 'br1' }]);
    h.d('attendanceDay').findUnique.mockResolvedValue({ clockIn: at(10, 1), deletedAt: null });
    await expect(h.service.setDayKinds(OWNER, { branchId: 'br1', entries: [{ userId: 'u1', date: '2026-10-29', dayKind: 'DAY_OFF' }] }, at(14, 0))).rejects.toThrow(BadRequestException);
    expect(h.calls).toContain('lock');
    expect(h.d('attendanceDay').findUnique).toHaveBeenCalledTimes(1);
    expect(h.d('attendanceDay').upsert).not.toHaveBeenCalled();
  });

  it('S29 setDayKinds row-locks the existing target rows in (user, date) order after the advisory locks and before the clocked-in check', async () => {
    const h = harness();
    h.d('user').findMany.mockResolvedValue([{ id: 'u1', branchId: 'br1' }, { id: 'u3', branchId: 'br1' }]);
    await h.service.setDayKinds(OWNER, { branchId: 'br1', entries: [{ userId: 'u3', date: '2026-10-29', dayKind: 'DAY_OFF' }, { userId: 'u1', date: '2026-10-30', dayKind: 'DAY_OFF' }, { userId: 'u1', date: '2026-10-29', dayKind: 'DAY_OFF' }] }, at(14, 0));
    const rowLock = h.tx.$queryRaw as jest.Mock;
    expect(rowLock).toHaveBeenCalledTimes(1);
    const sql = rowLock.mock.calls[0][0];
    expect(sql.sql).toContain('ORDER BY user_id, work_date FOR UPDATE');
    expect(sql.values).toEqual(['u1', dbDate(bangkokMidnight(2026, 9, 29)), 'u1', dbDate(bangkokMidnight(2026, 9, 30)), 'u3', dbDate(bangkokMidnight(2026, 9, 29))]);
    const order = h.where.filter((w) => w.startsWith('tx:'));
    expect(order.indexOf('tx:$executeRaw')).toBeLessThan(order.indexOf('tx:$queryRaw'));
    expect(order.indexOf('tx:$queryRaw')).toBeLessThan(order.indexOf('tx:attendanceDay.findUnique'));
  });

  it('S30 clearConflictFlag locks the row and filters the flags of the row re-read in the tx: CORRECTED added after the owner opened the dialog survives; a row deleted meanwhile → 404', async () => {
    const h = harness();
    h.d('attendanceDay').findUnique
      .mockResolvedValueOnce(dayRow({ userId: 'u1', flags: ['DEVICE_CONFLICT'] }))
      .mockResolvedValueOnce(dayRow({ userId: 'u1', flags: ['DEVICE_CONFLICT', 'CORRECTED'] }));
    h.d('attendanceDay').update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => dayRow({ userId: 'u1', ...data }));
    const out = await h.service.clearConflictFlag(OWNER, 'd-u1');
    expect(out.flags).toEqual(['CORRECTED']);
    expect(h.where.indexOf('tx:$queryRaw')).toBeLessThan(h.where.lastIndexOf('tx:attendanceDay.findUnique'));
    expect(h.where).not.toContain('root:attendanceDay.update');
    const h2 = harness();
    h2.d('attendanceDay').findUnique.mockResolvedValueOnce(dayRow({ userId: 'u1', flags: ['DEVICE_CONFLICT'] })).mockResolvedValueOnce(dayRow({ userId: 'u1', deletedAt: new Date() }));
    await expect(h2.service.clearConflictFlag(OWNER, 'd-u1')).rejects.toThrow(NotFoundException);
    expect(h2.d('attendanceDay').update).not.toHaveBeenCalled();
  });

  it('S31 correctDay re-checks branch scope against the re-read row: a kiosk IN moved the pre-scheduled row to another branch → 403 and nothing written', async () => {
    const h = harness();
    h.d('attendanceDay').findUnique.mockResolvedValueOnce(dayRow({ userId: 'u5', branchId: 'br1', clockIn: null })).mockResolvedValueOnce(dayRow({ userId: 'u5', branchId: 'br2', clockIn: at(10, 1) }));
    await expect(h.service.correctDay(BM, 'd-u5', { clockOut: at(20, 0).toISOString(), reason: 'ลืมตอกออก มีลูกค้าทำสัญญา' })).rejects.toThrow(ForbiddenException);
    expect(h.d('attendanceDay').update).not.toHaveBeenCalled();
    expect(h.d('attendanceCorrection').create).not.toHaveBeenCalled();
  });

  it('S32 the branch rules follow the re-read row\'s branch (cur.branchId) and are read through the tx', async () => {
    const h = harness();
    h.d('attendanceDay').findUnique.mockResolvedValueOnce(dayRow({ userId: 'u5', branchId: 'br1', clockIn: null })).mockResolvedValueOnce(dayRow({ userId: 'u5', branchId: 'br2', clockIn: at(10, 1) }));
    h.d('attendanceDay').update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => dayRow({ userId: 'u5', ...data }));
    await h.service.correctDay(OWNER, 'd-u5', { clockOut: at(20, 0).toISOString(), reason: 'ลืมตอกออก มีลูกค้าทำสัญญา' });
    expect(h.settings.getRules.mock.calls[0][0]).toBe('br2');
    expect(h.settings.getRules.mock.calls[0][1]).toBe(h.tx);
  });
});
