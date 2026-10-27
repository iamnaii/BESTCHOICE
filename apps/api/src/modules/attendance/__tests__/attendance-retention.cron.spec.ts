import { AttendanceRetentionCron } from '../crons/attendance-retention.cron';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

/** ก้อน 10 D3 Task 6 — cron 03:30: ลบรูปเกินอายุ · ล้างแคช requestId · เครื่องเงียบเกิน 24 ชม. (สเปก §4.4 §10) */
const NOW = new Date('2026-10-27T20:30:00.000Z'); // 03:30 ไทย 28 ต.ค.
const DAY = 24 * 3600_000;

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
  client.$executeRaw = jest.fn(async () => 0);
  const storage = { delete: jest.fn(async () => undefined) };
  const settings = { getPhotoRetentionDays: jest.fn(async () => 365) };
  const devices = { createOwnerTodo: jest.fn(async () => undefined) };
  const cron = new AttendanceRetentionCron(proxy, storage as never, settings as never, devices as never);
  return { cron, d: (k: string) => proxy[k] as Delegate, storage, devices, executeRaw: client.$executeRaw as jest.Mock };
}

describe('AttendanceRetentionCron.run', () => {
  beforeEach(() => jest.clearAllMocks());

  it('R1 photos older than the retention are deleted from storage and photoKey nulled; recent ones are kept', async () => {
    const h = harness();
    h.d('attendancePunch').findMany.mockResolvedValue([{ id: 'p-old', photoKey: 'attendance/2025/10/p-old.jpg' }]);
    const out = await h.cron.run(NOW);
    expect(h.d('attendancePunch').findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { photoKey: { not: null }, at: { lt: new Date(NOW.getTime() - 365 * DAY) } }, take: 500 }));
    expect(h.storage.delete).toHaveBeenCalledWith('attendance/2025/10/p-old.jpg');
    expect(h.d('attendancePunch').update).toHaveBeenCalledWith({ where: { id: 'p-old' }, data: { photoKey: null } });
    expect(out.photosDeleted).toBe(1);
  });

  it('R1b a storage delete failure skips that photo (key kept) and continues', async () => {
    const h = harness();
    h.d('attendancePunch').findMany.mockResolvedValue([{ id: 'a', photoKey: 'k-a' }, { id: 'b', photoKey: 'k-b' }]);
    h.storage.delete.mockRejectedValueOnce(new Error('gcs'));
    const out = await h.cron.run(NOW);
    expect(h.d('attendancePunch').update).toHaveBeenCalledTimes(1);
    expect(h.d('attendancePunch').update).toHaveBeenCalledWith({ where: { id: 'b' }, data: { photoKey: null } });
    expect(out.photosDeleted).toBe(1);
  });

  it('R2 request cache older than 1 day is deleted with one SQL statement that keeps each device\'s latest rotation reply (a tablet back after days must still recover — รีวิวรอบ 2 C4)', async () => {
    const h = harness();
    h.executeRaw.mockResolvedValue(7);
    const out = await h.cron.run(NOW);
    expect(h.executeRaw).toHaveBeenCalledTimes(1);
    const sql = (h.executeRaw.mock.calls[0][0] as string[]).join('?');
    expect(sql).toContain('current_generation');
    expect(sql).toContain('consumedGeneration');
    expect(h.d('attendanceDeviceRequest').deleteMany).not.toHaveBeenCalled();
    expect(out.requestsDeleted).toBe(7);
  });

  it('R3 an ACTIVE device silent for > 24h gets one OFFLINE event + owner Todo per day', async () => {
    const h = harness();
    h.d('attendanceDevice').findMany.mockResolvedValue([{ id: 'dev1', name: 'แท็บเล็ต', status: 'ACTIVE', lastSeenAt: new Date(NOW.getTime() - 30 * 3600_000), branch: { name: 'ลพบุรี' } }]);
    h.d('attendanceDeviceEvent').findFirst.mockResolvedValueOnce(null);
    await h.cron.run(NOW);
    expect(h.d('attendanceDevice').findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'ACTIVE', deletedAt: null, lastSeenAt: { lt: new Date(NOW.getTime() - DAY) } } }));
    expect(h.d('attendanceDeviceEvent').create).toHaveBeenCalledWith({ data: expect.objectContaining({ deviceId: 'dev1', kind: 'OFFLINE' }) });
    expect(h.devices.createOwnerTodo).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('แท็บเล็ต') }));
    // รอบถัดไปในวันเดียวกัน: มี OFFLINE event ภายใน 24 ชม. แล้ว → ไม่ซ้ำ
    h.d('attendanceDeviceEvent').findFirst.mockResolvedValueOnce({ id: 'e1' });
    await h.cron.run(NOW);
    expect(h.d('attendanceDeviceEvent').create).toHaveBeenCalledTimes(1);
  });
});
