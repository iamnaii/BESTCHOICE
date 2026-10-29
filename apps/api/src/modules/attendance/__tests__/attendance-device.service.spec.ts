import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { hashPII } from '../../../utils/pii.util';
import { AttendanceDeviceService } from '../attendance-device.service';
import { hashToken } from '../attendance-token.util';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

/**
 * ก้อน 10 D3 Task 3 — เครื่องตอกบัตร: ลงทะเบียน · token หมุน · requestId idempotency · ชน → ล็อก+ธง+Todo · รหัสผิดล็อกเครื่อง (สเปก §4.1–§4.3)
 * prisma mock: ทุก delegate เป็น Proxy ที่สร้าง jest.fn ให้ตามชื่อ method · $transaction(cb) เรียก cb ด้วย client เดียวกัน
 */
const NOW = new Date('2026-10-27T03:00:00.000Z'); // 10:00 ไทย
const SALT = 'attendance-device-spec-salt-0123456789abcdef';
const ORIGINAL_SALT = process.env.PII_HASH_SALT;
beforeAll(() => { process.env.PII_HASH_SALT = SALT; });
afterAll(() => { if (ORIGINAL_SALT === undefined) delete process.env.PII_HASH_SALT; else process.env.PII_HASH_SALT = ORIGINAL_SALT; });

type Fn = jest.Mock;
type Delegate = Record<string, Fn>;
function harness() {
  const delegates = new Map<string, Delegate>();
  const calls: string[] = [];
  const client: Record<string, unknown> = {};
  const proxy: any = new Proxy(client, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (!delegates.has(key)) {
        delegates.set(key, new Proxy({} as Delegate, {
          get(d, method: string) {
            if (!(method in d)) d[method] = jest.fn(async () => { calls.push(`${key}.${method}`); return method === 'count' ? 0 : method === 'findMany' ? [] : method.startsWith('find') ? null : method.endsWith('Many') ? { count: 0 } : {}; });
            return d[method];
          },
        }));
      }
      return delegates.get(key);
    },
  });
  client.$executeRaw = jest.fn(async () => 0);
  client.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => { calls.push('tx:start'); const out = await cb(proxy); calls.push('tx:end'); return out; });
  client.$queryRaw = jest.fn(async () => [{ pin_fail_count: 1 }]);
  const audit = { log: jest.fn(async () => { calls.push('audit'); }) };
  const service = new AttendanceDeviceService(proxy, audit as never);
  return { service, prisma: proxy, audit, calls, d: (k: string) => proxy[k] as Delegate, queryRaw: client.$queryRaw as jest.Mock };
}

const DEVICE = { id: 'dev1', branchId: 'br1', name: 'แท็บเล็ตเคาน์เตอร์', status: 'ACTIVE', currentGeneration: 3, lastCleanHeartbeatAt: new Date('2026-10-27T01:00:00.000Z'), createdAt: new Date('2026-10-20T00:00:00.000Z'), lastIp: '1.1.1.1', pinFailCount: 0, pinLockedUntil: null, branch: { id: 'br1', name: 'ลพบุรี' } };

describe('AttendanceDeviceService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('TD0 issueRegistrationCode stores only the hash with a 10-minute expiry and returns the plain code', async () => {
    const h = harness();
    const out = await h.service.issueRegistrationCode('br1', 'owner', NOW);
    expect(out.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    expect(out.expiresAt.getTime()).toBe(NOW.getTime() + 10 * 60_000);
    expect(h.d('attendanceRegistrationCode').create).toHaveBeenCalledWith({ data: expect.objectContaining({ branchId: 'br1', codeHash: hashToken(out.code), createdById: 'owner', expiresAt: out.expiresAt }) });
    expect(JSON.stringify(h.d('attendanceRegistrationCode').create.mock.calls[0])).not.toContain(out.code);
  });

  it('TD1 register with a valid unused code creates an ACTIVE device at generation 1, its token, a REGISTERED event, and marks the code used', async () => {
    const h = harness();
    h.d('attendanceRegistrationCode').findUnique.mockResolvedValue({ id: 'code1', branchId: 'br1', createdById: 'owner', expiresAt: new Date(NOW.getTime() + 60_000), usedAt: null, branch: { id: 'br1', name: 'ลพบุรี' } });
    h.d('attendanceDevice').create.mockImplementation(async () => { h.calls.push('attendanceDevice.create'); return { ...DEVICE, currentGeneration: 1 }; });
    h.d('attendanceRegistrationCode').updateMany.mockResolvedValue({ count: 1 });
    const out = await h.service.register({ code: 'ABCDEFGH', deviceName: 'แท็บเล็ตเคาน์เตอร์', ip: '1.1.1.1', userAgent: 'ua' }, NOW);
    expect(out.deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(out.device).toEqual({ id: 'dev1', branchId: 'br1', branchName: 'ลพบุรี', name: 'แท็บเล็ตเคาน์เตอร์' });
    expect(h.d('attendanceDevice').create).toHaveBeenCalledWith({ data: expect.objectContaining({ branchId: 'br1', name: 'แท็บเล็ตเคาน์เตอร์', status: 'ACTIVE', currentGeneration: 1, registeredById: 'owner', lastIp: '1.1.1.1' }) });
    expect(h.d('attendanceDeviceToken').create).toHaveBeenCalledWith({ data: expect.objectContaining({ deviceId: 'dev1', generation: 1, tokenHash: hashToken(out.deviceToken) }) });
    expect(h.d('attendanceDeviceEvent').create).toHaveBeenCalledWith({ data: expect.objectContaining({ deviceId: 'dev1', kind: 'REGISTERED' }) });
    expect(h.d('attendanceRegistrationCode').updateMany).toHaveBeenCalledWith({ where: { id: 'code1', usedAt: null }, data: { usedAt: NOW } });
    expect(h.calls.indexOf('tx:start')).toBeLessThan(h.calls.indexOf('attendanceDevice.create'));
  });

  it('TD2 register with an expired, used or unknown code → 400 Thai and nothing written', async () => {
    const h = harness();
    h.d('attendanceRegistrationCode').findUnique.mockResolvedValueOnce({ id: 'c', branchId: 'br1', createdById: 'o', expiresAt: new Date(NOW.getTime() - 1), usedAt: null, branch: { id: 'br1', name: 'x' } });
    await expect(h.service.register({ code: 'ABCDEFGH', deviceName: 'x' }, NOW)).rejects.toThrow(BadRequestException);
    h.d('attendanceRegistrationCode').findUnique.mockResolvedValueOnce({ id: 'c', branchId: 'br1', createdById: 'o', expiresAt: new Date(NOW.getTime() + 1), usedAt: NOW, branch: { id: 'br1', name: 'x' } });
    await expect(h.service.register({ code: 'ABCDEFGH', deviceName: 'x' }, NOW)).rejects.toThrow('รหัสลงทะเบียนไม่ถูกต้องหรือหมดอายุ');
    h.d('attendanceRegistrationCode').findUnique.mockResolvedValueOnce(null);
    await expect(h.service.register({ code: 'ZZZZZZZZ', deviceName: 'x' }, NOW)).rejects.toThrow(BadRequestException);
    expect(h.d('attendanceDevice').create).not.toHaveBeenCalled();
  });

  it('TD2b two registrations racing on the same code: the one that loses the used-at claim gets 400 and creates no device (รีวิว minor)', async () => {
    const h = harness();
    h.d('attendanceRegistrationCode').findUnique.mockResolvedValue({ id: 'code1', branchId: 'br1', createdById: 'owner', expiresAt: new Date(NOW.getTime() + 60_000), usedAt: null, branch: { id: 'br1', name: 'ลพบุรี' } });
    h.d('attendanceRegistrationCode').updateMany.mockResolvedValue({ count: 0 }); // อีกคำขอใช้รหัสไปแล้วระหว่างนั้น
    await expect(h.service.register({ code: 'ABCDEFGH', deviceName: 'x' }, NOW)).rejects.toThrow('รหัสลงทะเบียนไม่ถูกต้องหรือหมดอายุ');
    expect(h.d('attendanceDevice').create).not.toHaveBeenCalled();
  });

  it('TD3 authenticate with the current-generation token does NOT rotate (rotation happens only when the operation commits — รีวิว C1/C2)', async () => {
    const h = harness();
    h.d('attendanceDeviceToken').findUnique.mockResolvedValue({ id: 't3', deviceId: 'dev1', generation: 3, usedAt: null, device: DEVICE });
    const out = await h.service.authenticate({ deviceToken: 'raw-gen3', requestId: 'r1', ip: '1.1.1.1', userAgent: 'ua' }, NOW);
    expect(out.replay).toBeUndefined();
    expect(out.token).toMatchObject({ id: 't3', generation: 3 });
    expect(out.device.currentGeneration).toBe(3);
    expect(h.d('attendanceDeviceToken').findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: hashToken('raw-gen3') } }));
    expect(h.d('attendanceDeviceToken').create).not.toHaveBeenCalled();
    expect(h.d('attendanceDevice').update).not.toHaveBeenCalled();
    expect(h.d('attendanceDevice').updateMany).not.toHaveBeenCalled();
  });

  it('TD3b commitRotation (inside the caller tx): optimistic generation bump, old token used, new token N+1, response cached with consumedGeneration — returns the new raw token', async () => {
    const h = harness();
    h.d('attendanceDevice').updateMany.mockResolvedValue({ count: 1 });
    const auth = { device: DEVICE as never, token: { id: 't3', generation: 3, usedAt: null } };
    const next = await h.service.commitRotation(h.prisma, auth, { requestId: 'r1', ip: '1.1.1.1', userAgent: 'ua', now: NOW }, { serverTime: 'x' });
    expect(next).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(h.d('attendanceDevice').updateMany).toHaveBeenCalledWith({ where: { id: 'dev1', currentGeneration: 3, status: 'ACTIVE', deletedAt: null }, data: { currentGeneration: 4, lastSeenAt: NOW, lastIp: '1.1.1.1', lastUserAgent: 'ua' } });
    expect(h.d('attendanceDeviceToken').update).toHaveBeenCalledWith({ where: { id: 't3' }, data: { usedAt: NOW } });
    expect(h.d('attendanceDeviceToken').create).toHaveBeenCalledWith({ data: expect.objectContaining({ deviceId: 'dev1', generation: 4, tokenHash: hashToken(next) }) });
    expect(h.d('attendanceDeviceRequest').create).toHaveBeenCalledWith({ data: { deviceId: 'dev1', requestId: 'r1', responseJson: { status: 200, body: { serverTime: 'x' }, consumedGeneration: 3 } } });
    // คำตอบที่จำไว้ไม่มี token ดิบ (สเปก: เก็บเฉพาะ hash)
    expect(JSON.stringify(h.d('attendanceDeviceRequest').create.mock.calls[0])).not.toContain(next);
  });

  it('TD3c commitRotation when another request already moved the generation → 409 REQUEST_BUSY (retryable), never a conflict lock (รีวิว I5)', async () => {
    const h = harness();
    h.d('attendanceDevice').updateMany.mockResolvedValue({ count: 0 });
    const auth = { device: DEVICE as never, token: { id: 't3', generation: 3, usedAt: null } };
    const err = await h.service.commitRotation(h.prisma, auth, { requestId: 'r1', now: NOW }, {}).catch((e) => e);
    expect(err.getStatus()).toBe(409);
    expect(err.getResponse()).toMatchObject({ code: 'REQUEST_BUSY' });
    expect(h.d('attendanceDeviceToken').create).not.toHaveBeenCalled();
    expect(h.d('attendanceDevice').update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'LOCKED' }) }));
  });

  it('TD4 authenticate with an unknown token → 401 { code: DEVICE_REVOKED }', async () => {
    const h = harness();
    const err = await h.service.authenticate({ deviceToken: 'nope', requestId: 'r1' }, NOW).catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.getResponse()).toMatchObject({ code: 'DEVICE_REVOKED' });
  });

  it('TD5 authenticate on a REVOKED or LOCKED device → 401 with that code and no rotation', async () => {
    const h = harness();
    h.d('attendanceDeviceToken').findUnique.mockResolvedValueOnce({ id: 't', deviceId: 'dev1', generation: 3, device: { ...DEVICE, status: 'REVOKED' } });
    const e1 = await h.service.authenticate({ deviceToken: 'x', requestId: 'r' }, NOW).catch((e) => e);
    expect(e1.getResponse()).toMatchObject({ code: 'DEVICE_REVOKED' });
    h.d('attendanceDeviceToken').findUnique.mockResolvedValueOnce({ id: 't', deviceId: 'dev1', generation: 3, device: { ...DEVICE, status: 'LOCKED' } });
    const e2 = await h.service.authenticate({ deviceToken: 'x', requestId: 'r' }, NOW).catch((e) => e);
    expect(e2.getResponse()).toMatchObject({ code: 'DEVICE_LOCKED' });
    expect(h.d('attendanceDeviceToken').create).not.toHaveBeenCalled();
  });

  it('TD6 a lost response replayed (same requestId + the token it consumed) returns the cached body with a re-keyed successor token, no lock (รีวิว C3)', async () => {
    const h = harness();
    h.d('attendanceDeviceToken').findUnique.mockResolvedValue({ id: 't2', deviceId: 'dev1', generation: 2, usedAt: NOW, device: DEVICE });
    h.d('attendanceDeviceRequest').findUnique.mockResolvedValue({ deviceId: 'dev1', requestId: 'r-old', responseJson: { status: 200, body: { result: 'same' }, consumedGeneration: 2 }, createdAt: NOW });
    h.d('attendanceDeviceToken').updateMany.mockResolvedValue({ count: 1 });
    const out = await h.service.authenticate({ deviceToken: 'raw-gen2', requestId: 'r-old' }, NOW);
    expect(out.replay?.status).toBe(200);
    expect(out.replay?.body).toMatchObject({ result: 'same', nextDeviceToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    const rekey = h.d('attendanceDeviceToken').updateMany.mock.calls[0][0];
    expect(rekey).toEqual({ where: { deviceId: 'dev1', generation: 3, usedAt: null }, data: { tokenHash: hashToken(out.replay!.body.nextDeviceToken as string) } });
    expect(h.d('attendanceDevice').update).not.toHaveBeenCalled();
  });

  it('TD6b replay with the successor token already in hand returns the cached body without a token; an error replay returns its status', async () => {
    const h = harness();
    h.d('attendanceDeviceToken').findUnique.mockResolvedValue({ id: 't3', deviceId: 'dev1', generation: 3, usedAt: null, device: DEVICE });
    h.d('attendanceDeviceRequest').findUnique.mockResolvedValueOnce({ deviceId: 'dev1', requestId: 'r-old', responseJson: { status: 200, body: { result: 'same' }, consumedGeneration: 2 } });
    const a = await h.service.authenticate({ deviceToken: 'raw-gen3', requestId: 'r-old' }, NOW);
    expect(a.replay).toEqual({ status: 200, body: { result: 'same' } });
    h.d('attendanceDeviceRequest').findUnique.mockResolvedValueOnce({ deviceId: 'dev1', requestId: 'r-pin', responseJson: { status: 400, body: { code: 'PIN_INVALID', message: 'รหัสไม่ถูกต้อง' }, consumedGeneration: null } });
    const b = await h.service.authenticate({ deviceToken: 'raw-gen3', requestId: 'r-pin' }, NOW);
    expect(b.replay).toEqual({ status: 400, body: { code: 'PIN_INVALID', message: 'รหัสไม่ถูกต้อง' } });
    expect(h.d('attendanceDeviceToken').updateMany).not.toHaveBeenCalled();
  });

  it('TD6c a replay whose chain already moved past its successor is a copied token → LOCKED', async () => {
    const h = harness();
    h.d('attendanceDeviceToken').findUnique.mockResolvedValue({ id: 't2', deviceId: 'dev1', generation: 2, usedAt: NOW, device: { ...DEVICE, currentGeneration: 4 } });
    h.d('attendanceDeviceRequest').findUnique.mockResolvedValue({ deviceId: 'dev1', requestId: 'r-old', responseJson: { status: 200, body: {}, consumedGeneration: 2 } });
    const err = await h.service.authenticate({ deviceToken: 'raw-gen2', requestId: 'r-old' }, NOW).catch((e) => e);
    expect(err.getResponse()).toMatchObject({ code: 'DEVICE_LOCKED' });
    expect(h.d('attendanceDevice').update).toHaveBeenCalledWith({ where: { id: 'dev1' }, data: { status: 'LOCKED' } });
  });

  it('TD7 an old-generation token with a new requestId → device LOCKED + TOKEN_CONFLICT event + 401 DEVICE_LOCKED', async () => {
    const h = harness();
    h.d('attendanceDeviceToken').findUnique.mockResolvedValue({ id: 't2', deviceId: 'dev1', generation: 2, usedAt: NOW, device: DEVICE });
    h.d('user').findFirst.mockResolvedValue({ id: 'sys' });
    const err = await h.service.authenticate({ deviceToken: 'raw-gen2', requestId: 'r-new', ip: '9.9.9.9', userAgent: 'other' }, NOW).catch((e) => e);
    expect(err.getResponse()).toMatchObject({ code: 'DEVICE_LOCKED' });
    expect(h.d('attendanceDevice').update).toHaveBeenCalledWith({ where: { id: 'dev1' }, data: expect.objectContaining({ status: 'LOCKED' }) });
    expect(h.d('attendanceDeviceEvent').create).toHaveBeenCalledWith({ data: expect.objectContaining({ deviceId: 'dev1', kind: 'TOKEN_CONFLICT', ip: '9.9.9.9', userAgent: 'other', detail: expect.objectContaining({ generationUsed: 2, currentGeneration: 3 }) }) });
    expect(h.d('attendanceDeviceToken').create).not.toHaveBeenCalled();
  });

  it('TD8 a conflict flags every punch since the stale token was superseded (fork point — not lastCleanHeartbeatAt, which a copier\'s heartbeats move) and their day rows by (user, work date); one HIGH owner Todo after the tx (รีวิว C4)', async () => {
    const h = harness();
    const fork = new Date('2026-10-27T00:30:00.000Z'); // token รุ่น 2 ถูกใช้ (หมุนไปรุ่น 3) ตอน 07:30 ไทย — ก่อน heartbeat สะอาดล่าสุด 08:00
    h.d('attendanceDeviceToken').findUnique.mockResolvedValue({ id: 't2', deviceId: 'dev1', generation: 2, usedAt: fork, device: DEVICE });
    h.d('attendancePunch').findMany.mockResolvedValue([{ id: 'p1', userId: 'u1', at: new Date('2026-10-27T00:31:00.000Z') }, { id: 'p2', userId: 'u2', at: new Date('2026-10-27T02:00:00.000Z') }]);
    h.d('user').findFirst.mockResolvedValue({ id: 'sys' });
    h.d('todo').findFirst.mockResolvedValue(null);
    await h.service.authenticate({ deviceToken: 'raw-gen2', requestId: 'r-new' }, NOW).catch(() => undefined);
    expect(h.d('attendancePunch').findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ deviceId: 'dev1', at: { gte: fork, lte: NOW } }) }));
    expect(h.d('attendancePunch').updateMany).toHaveBeenCalledWith({ where: { id: { in: ['p1', 'p2'] }, NOT: { flags: { has: 'DEVICE_CONFLICT' } } }, data: { flags: { push: 'DEVICE_CONFLICT' } } });
    const dayWhere = h.d('attendanceDay').updateMany.mock.calls[0][0].where;
    expect(dayWhere.OR).toEqual(expect.arrayContaining([
      { clockInPunchId: { in: ['p1', 'p2'] } },
      { clockOutPunchId: { in: ['p1', 'p2'] } },
      { userId: 'u1', workDate: new Date('2026-10-27T00:00:00.000Z') },
      { userId: 'u2', workDate: new Date('2026-10-27T00:00:00.000Z') },
    ]));
    expect(dayWhere).toMatchObject({ deletedAt: null, NOT: { flags: { has: 'DEVICE_CONFLICT' } } });
    expect(h.d('todo').create).toHaveBeenCalledWith({ data: expect.objectContaining({ priority: 'HIGH', createdById: 'sys', title: expect.stringContaining('แท็บเล็ตเคาน์เตอร์') }) });
    // ข้อความชี้เมนูที่มีจริง (ไม่มีหมวด "บุคลากร" · หมวดตั้งค่าชื่อ "บริษัท & สาขา")
    expect(h.d('todo').create.mock.calls[0][0].data.description).toEqual(expect.stringContaining('ตั้งค่า › บริษัท & สาขา › เครื่องตอกบัตร'));
    expect(h.d('todo').create.mock.calls[0][0].data.description).not.toContain('บุคลากร');
    expect(h.calls.indexOf('todo.create')).toBeGreaterThan(h.calls.lastIndexOf('tx:end'));
  });

  it('TD8c the conflict locks the day rows it will flag in (user_id, work_date) order before the atomic flag push', async () => {
    const h = harness();
    const fork = new Date('2026-10-27T00:30:00.000Z');
    h.d('attendanceDeviceToken').findUnique.mockResolvedValue({ id: 't2', deviceId: 'dev1', generation: 2, usedAt: fork, device: DEVICE });
    h.d('attendancePunch').findMany.mockResolvedValue([{ id: 'p1', userId: 'u1', at: new Date('2026-10-27T00:31:00.000Z') }]);
    h.d('user').findFirst.mockResolvedValue({ id: 'sys' });
    h.d('todo').findFirst.mockResolvedValue(null);
    await h.service.authenticate({ deviceToken: 'raw-gen2', requestId: 'r-new' }, NOW).catch(() => undefined);
    const lockCall = h.queryRaw.mock.calls.find((c) => String((c[0] as { sql?: string })?.sql ?? '').includes('attendance_days'));
    expect(lockCall).toBeDefined();
    expect((lockCall![0] as { sql: string }).sql).toContain('ORDER BY user_id, work_date FOR UPDATE');
    expect(h.calls.indexOf('attendanceDay.updateMany')).toBeGreaterThan(-1);
  });

  it('TD8b a conflict that flags a day in a month already paid adds the paid-month line with the payroll number to the owner Todo', async () => {
    const h = harness();
    const fork = new Date('2026-10-27T00:30:00.000Z');
    h.d('attendanceDeviceToken').findUnique.mockResolvedValue({ id: 't2', deviceId: 'dev1', generation: 2, usedAt: fork, device: DEVICE });
    h.d('attendancePunch').findMany.mockResolvedValue([{ id: 'p1', userId: 'u1', at: new Date('2026-10-27T00:31:00.000Z') }]);
    h.d('user').findFirst.mockResolvedValue({ id: 'sys' });
    h.d('todo').findFirst.mockResolvedValue(null);
    h.d('payrollLine').findFirst.mockResolvedValue({ payroll: { document: { number: 'PR-2026-0042' } } });
    await h.service.authenticate({ deviceToken: 'raw-gen2', requestId: 'r-new' }, NOW).catch(() => undefined);
    expect(h.d('todo').create.mock.calls[0][0].data.description).toEqual(expect.stringContaining('วันที่ติดธงอยู่ในเดือนที่จ่ายเงินเดือนแล้ว (ใบ PR-2026-0042) — ถ้าตอกแทนกันจริง ให้ใส่รายการหักในใบเงินเดือนงวดถัดไป'));
  });

  it('TD9 checkPin: a wrong PIN bumps the counter atomically in SQL (failures inside a 15-minute window); the 5th → LOCKED until now+15min with one PIN_LOCKOUT event (รีวิว minor)', async () => {
    const h = harness();
    h.d('user').findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => ('isSystemUser' in where ? { id: 'sys' } : null));
    h.d('attendanceDevice').findUnique.mockResolvedValue({ ...DEVICE });
    h.queryRaw.mockResolvedValueOnce([{ pin_fail_count: 4 }]);
    expect(await h.service.checkPin('dev1', '000000', NOW)).toBe('INVALID');
    expect(h.queryRaw).toHaveBeenCalledTimes(1);
    expect(h.d('attendanceDevice').update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ pinFailCount: expect.any(Number) }) }));
    h.queryRaw.mockResolvedValueOnce([{ pin_fail_count: 5 }]);
    h.d('attendanceDevice').updateMany.mockResolvedValueOnce({ count: 1 });
    expect(await h.service.checkPin('dev1', '000000', NOW)).toBe('LOCKED');
    expect(h.d('attendanceDevice').updateMany).toHaveBeenCalledWith({
      where: { id: 'dev1', OR: [{ pinLockedUntil: null }, { pinLockedUntil: { lte: NOW } }] },
      data: { pinFailCount: 0, pinLastFailAt: null, pinLockedUntil: new Date(NOW.getTime() + 15 * 60_000) },
    });
    expect(h.d('attendanceDeviceEvent').create).toHaveBeenCalledWith({ data: expect.objectContaining({ deviceId: 'dev1', kind: 'PIN_LOCKOUT' }) });
    // คำขอที่แข่งกันข้ามเกณฑ์พร้อมกัน: ล็อกครั้งเดียว เหตุการณ์เดียว
    h.queryRaw.mockResolvedValueOnce([{ pin_fail_count: 6 }]);
    h.d('attendanceDevice').updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await h.service.checkPin('dev1', '000000', NOW)).toBe('LOCKED');
    expect(h.d('attendanceDeviceEvent').create).toHaveBeenCalledTimes(1);
  });

  it('TD10 checkPin: a correct pin is looked up by hashPII(pin, salt) among active users, resets the counter and returns the userId', async () => {
    const h = harness();
    h.d('attendanceDevice').findUnique.mockResolvedValue({ ...DEVICE, pinFailCount: 2 });
    h.d('user').findFirst.mockResolvedValue({ id: 'u7', nickname: 'นุ๊ก' });
    expect(await h.service.checkPin('dev1', '123456', NOW)).toEqual({ userId: 'u7' });
    expect(h.d('user').findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { attendancePinHash: hashPII('123456', SALT), deletedAt: null, isActive: true } }));
    expect(h.d('attendanceDevice').update).toHaveBeenCalledWith({ where: { id: 'dev1' }, data: { pinFailCount: 0, pinLastFailAt: null } });
  });

  it('TD11 checkPin while pinLockedUntil is in the future → LOCKED without touching counters or looking up users', async () => {
    const h = harness();
    h.d('attendanceDevice').findUnique.mockResolvedValue({ ...DEVICE, pinLockedUntil: new Date(NOW.getTime() + 60_000) });
    expect(await h.service.checkPin('dev1', '123456', NOW)).toBe('LOCKED');
    expect(h.d('user').findFirst).not.toHaveBeenCalled();
    expect(h.d('attendanceDevice').update).not.toHaveBeenCalled();
  });

  it('TD12 no system user → the Todo is skipped with a Sentry warning, the conflict still locks the device', async () => {
    const h = harness();
    h.d('attendanceDeviceToken').findUnique.mockResolvedValue({ id: 't2', deviceId: 'dev1', generation: 2, usedAt: NOW, device: DEVICE });
    h.d('user').findFirst.mockResolvedValue(null);
    await h.service.authenticate({ deviceToken: 'raw-gen2', requestId: 'r-new' }, NOW).catch(() => undefined);
    expect(h.d('attendanceDevice').update).toHaveBeenCalledWith({ where: { id: 'dev1' }, data: expect.objectContaining({ status: 'LOCKED' }) });
    expect(h.d('todo').create).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalled();
  });

  it('TD13 rememberError stores an error reply per (device, requestId) with no consumed generation and ignores a duplicate (P2002)', async () => {
    const h = harness();
    await h.service.rememberError('dev1', 'r1', 400, { code: 'PIN_INVALID', message: 'รหัสไม่ถูกต้อง' });
    expect(h.d('attendanceDeviceRequest').create).toHaveBeenCalledWith({ data: { deviceId: 'dev1', requestId: 'r1', responseJson: { status: 400, body: { code: 'PIN_INVALID', message: 'รหัสไม่ถูกต้อง' }, consumedGeneration: null } } });
    h.d('attendanceDeviceRequest').create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    await expect(h.service.rememberError('dev1', 'r1', 400, {})).resolves.toBeUndefined();
  });

  it('TD13b heartbeat touches lastCleanHeartbeatAt and rotates in one transaction, returning the body and the next token', async () => {
    const h = harness();
    h.d('attendanceDevice').updateMany.mockResolvedValue({ count: 1 });
    const auth = { device: DEVICE as never, token: { id: 't3', generation: 3, usedAt: null } };
    const out = await h.service.heartbeat(auth, { requestId: 'r-hb', now: NOW }, (d) => ({ device: { name: d.name } }));
    expect(out.body).toEqual({ device: { name: 'แท็บเล็ตเคาน์เตอร์' } });
    expect(out.nextToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(h.d('attendanceDevice').update).toHaveBeenCalledWith({ where: { id: 'dev1' }, data: { lastCleanHeartbeatAt: NOW } });
    const start = h.calls.indexOf('tx:start');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(h.calls.indexOf('attendanceDeviceRequest.create')).toBeGreaterThan(start);
    expect(h.calls.indexOf('attendanceDeviceRequest.create')).toBeLessThan(h.calls.indexOf('tx:end'));
  });

  it('TD14 revoke/unlock set REVOKED with the matching event and audit after the tx; unlock only applies to LOCKED devices', async () => {
    const h = harness();
    h.d('attendanceDevice').findUnique.mockResolvedValueOnce({ ...DEVICE, status: 'ACTIVE' });
    await h.service.revoke('dev1', 'owner');
    expect(h.d('attendanceDevice').update).toHaveBeenCalledWith({ where: { id: 'dev1' }, data: { status: 'REVOKED' } });
    expect(h.d('attendanceDeviceEvent').create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: 'REVOKED' }) });
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ATTENDANCE_DEVICE_REVOKED', entity: 'attendance_device', entityId: 'dev1', userId: 'owner' }));
    h.d('attendanceDevice').findUnique.mockResolvedValueOnce({ ...DEVICE, status: 'ACTIVE' });
    await expect(h.service.unlock('dev1', 'owner')).rejects.toThrow(BadRequestException);
    h.d('attendanceDevice').findUnique.mockResolvedValueOnce({ ...DEVICE, status: 'LOCKED' });
    await h.service.unlock('dev1', 'owner');
    expect(h.d('attendanceDeviceEvent').create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: 'UNLOCKED' }) });
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ATTENDANCE_DEVICE_UNLOCKED' }));
  });
  it('TD15 replayIfCached: when a business 409 races a slow first attempt that has since committed, the cached reply is replayed with a re-keyed token (รีวิวรอบ 2 C17)', async () => {
    const h = harness();
    h.d('attendanceDevice').findUnique.mockResolvedValue({ ...DEVICE, currentGeneration: 4 });
    h.d('attendanceDeviceRequest').findUnique.mockResolvedValue({ deviceId: 'dev1', requestId: 'r1', responseJson: { status: 200, body: { result: 'first' }, consumedGeneration: 3 } });
    h.d('attendanceDeviceToken').updateMany.mockResolvedValue({ count: 1 });
    const auth = { device: DEVICE as never, token: { id: 't3', generation: 3, usedAt: null } };
    const replay = await h.service.replayIfCached(auth, 'r1');
    expect(replay).toMatchObject({ status: 200, body: { result: 'first', nextDeviceToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) } });
    h.d('attendanceDeviceRequest').findUnique.mockResolvedValue(null);
    expect(await h.service.replayIfCached(auth, 'r2')).toBeNull();
  });
});
