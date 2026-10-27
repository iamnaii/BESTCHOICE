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
  client.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => { calls.push('tx:start'); const out = await cb(proxy); calls.push('tx:end'); return out; });
  const audit = { log: jest.fn(async () => { calls.push('audit'); }) };
  const service = new AttendanceDeviceService(proxy, audit as never);
  return { service, prisma: proxy, audit, calls, d: (k: string) => proxy[k] as Delegate };
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
    const out = await h.service.register({ code: 'ABCDEFGH', deviceName: 'แท็บเล็ตเคาน์เตอร์', ip: '1.1.1.1', userAgent: 'ua' }, NOW);
    expect(out.deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(out.device).toEqual({ id: 'dev1', branchId: 'br1', branchName: 'ลพบุรี', name: 'แท็บเล็ตเคาน์เตอร์' });
    expect(h.d('attendanceDevice').create).toHaveBeenCalledWith({ data: expect.objectContaining({ branchId: 'br1', name: 'แท็บเล็ตเคาน์เตอร์', status: 'ACTIVE', currentGeneration: 1, registeredById: 'owner', lastIp: '1.1.1.1' }) });
    expect(h.d('attendanceDeviceToken').create).toHaveBeenCalledWith({ data: expect.objectContaining({ deviceId: 'dev1', generation: 1, tokenHash: hashToken(out.deviceToken) }) });
    expect(h.d('attendanceDeviceEvent').create).toHaveBeenCalledWith({ data: expect.objectContaining({ deviceId: 'dev1', kind: 'REGISTERED' }) });
    expect(h.d('attendanceRegistrationCode').update).toHaveBeenCalledWith({ where: { id: 'code1' }, data: { usedAt: NOW } });
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

  it('TD3 authenticate with the current-generation token rotates: old token usedAt, new token gen N+1, device.currentGeneration N+1, nextToken returned', async () => {
    const h = harness();
    h.d('attendanceDeviceToken').findUnique.mockResolvedValue({ id: 't3', deviceId: 'dev1', generation: 3, usedAt: null, device: DEVICE });
    h.d('attendanceDevice').update.mockResolvedValue({ ...DEVICE, currentGeneration: 4 });
    const out = await h.service.authenticate({ deviceToken: 'raw-gen3', requestId: 'r1', ip: '1.1.1.1', userAgent: 'ua' }, NOW);
    expect(out.cached).toBeUndefined();
    expect(out.nextToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(out.device.currentGeneration).toBe(4);
    expect(h.d('attendanceDeviceToken').findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: hashToken('raw-gen3') } }));
    expect(h.d('attendanceDeviceToken').update).toHaveBeenCalledWith({ where: { id: 't3' }, data: { usedAt: NOW } });
    expect(h.d('attendanceDeviceToken').create).toHaveBeenCalledWith({ data: expect.objectContaining({ deviceId: 'dev1', generation: 4, tokenHash: hashToken(out.nextToken!) }) });
    expect(h.d('attendanceDevice').update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'dev1' }, data: expect.objectContaining({ currentGeneration: 4, lastSeenAt: NOW, lastIp: '1.1.1.1', lastUserAgent: 'ua' }) }));
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

  it('TD6 replaying the same requestId with the previous token returns the cached response, no rotation, no conflict', async () => {
    const h = harness();
    h.d('attendanceDeviceToken').findUnique.mockResolvedValue({ id: 't2', deviceId: 'dev1', generation: 2, usedAt: NOW, device: DEVICE });
    h.d('attendanceDeviceRequest').findUnique.mockResolvedValue({ deviceId: 'dev1', requestId: 'r-old', responseJson: { result: 'same' }, createdAt: NOW });
    const out = await h.service.authenticate({ deviceToken: 'raw-gen2', requestId: 'r-old' }, NOW);
    expect(out.cached).toEqual({ result: 'same' });
    expect(out.nextToken).toBeUndefined();
    expect(h.d('attendanceDeviceToken').create).not.toHaveBeenCalled();
    expect(h.d('attendanceDevice').update).not.toHaveBeenCalled();
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

  it('TD8 a conflict flags every punch and day since lastCleanHeartbeatAt with DEVICE_CONFLICT and creates one HIGH owner Todo via the system user (after the tx)', async () => {
    const h = harness();
    h.d('attendanceDeviceToken').findUnique.mockResolvedValue({ id: 't2', deviceId: 'dev1', generation: 2, usedAt: NOW, device: DEVICE });
    h.d('attendancePunch').findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
    h.d('user').findFirst.mockResolvedValue({ id: 'sys' });
    h.d('todo').findFirst.mockResolvedValue(null);
    await h.service.authenticate({ deviceToken: 'raw-gen2', requestId: 'r-new' }, NOW).catch(() => undefined);
    expect(h.d('attendancePunch').findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ deviceId: 'dev1', at: { gte: DEVICE.lastCleanHeartbeatAt, lte: NOW } }) }));
    expect(h.d('attendancePunch').updateMany).toHaveBeenCalledWith({ where: { id: { in: ['p1', 'p2'] } }, data: { flags: { push: 'DEVICE_CONFLICT' } } });
    expect(h.d('attendanceDay').updateMany).toHaveBeenCalledWith({ where: { OR: [{ clockInPunchId: { in: ['p1', 'p2'] } }, { clockOutPunchId: { in: ['p1', 'p2'] } }], deletedAt: null }, data: { flags: { push: 'DEVICE_CONFLICT' } } });
    expect(h.d('todo').create).toHaveBeenCalledWith({ data: expect.objectContaining({ priority: 'HIGH', createdById: 'sys', title: expect.stringContaining('แท็บเล็ตเคาน์เตอร์') }) });
    // ข้อความชี้เมนูที่มีจริง (ไม่มีหมวด "บุคลากร" · หมวดตั้งค่าชื่อ "บริษัท & สาขา")
    expect(h.d('todo').create.mock.calls[0][0].data.description).toEqual(expect.stringContaining('ตั้งค่า › บริษัท & สาขา › เครื่องตอกบัตร'));
    expect(h.d('todo').create.mock.calls[0][0].data.description).not.toContain('บุคลากร');
    expect(h.calls.indexOf('todo.create')).toBeGreaterThan(h.calls.lastIndexOf('tx:end'));
  });

  it('TD9 checkPin: 4 wrong → INVALID (pinFailCount 4); the 5th wrong → LOCKED until now+15min, PIN_LOCKOUT event, counter reset', async () => {
    const h = harness();
    h.d('user').findFirst.mockResolvedValue(null);
    h.d('attendanceDevice').findUnique.mockResolvedValue({ ...DEVICE, pinFailCount: 3 });
    expect(await h.service.checkPin('dev1', '000000', NOW)).toBe('INVALID');
    expect(h.d('attendanceDevice').update).toHaveBeenCalledWith({ where: { id: 'dev1' }, data: { pinFailCount: 4 } });
    h.d('attendanceDevice').findUnique.mockResolvedValue({ ...DEVICE, pinFailCount: 4 });
    h.d('user').findFirst.mockResolvedValue({ id: 'sys' }); // system user for the Todo; pin lookup mocked separately below
    h.d('user').findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => ('isSystemUser' in where ? { id: 'sys' } : null));
    expect(await h.service.checkPin('dev1', '000000', NOW)).toBe('LOCKED');
    expect(h.d('attendanceDevice').update).toHaveBeenCalledWith({ where: { id: 'dev1' }, data: { pinFailCount: 0, pinLockedUntil: new Date(NOW.getTime() + 15 * 60_000) } });
    expect(h.d('attendanceDeviceEvent').create).toHaveBeenCalledWith({ data: expect.objectContaining({ deviceId: 'dev1', kind: 'PIN_LOCKOUT' }) });
  });

  it('TD10 checkPin: a correct pin is looked up by hashPII(pin, salt) among active users, resets the counter and returns the userId', async () => {
    const h = harness();
    h.d('attendanceDevice').findUnique.mockResolvedValue({ ...DEVICE, pinFailCount: 2 });
    h.d('user').findFirst.mockResolvedValue({ id: 'u7', nickname: 'นุ๊ก' });
    expect(await h.service.checkPin('dev1', '123456', NOW)).toEqual({ userId: 'u7' });
    expect(h.d('user').findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { attendancePinHash: hashPII('123456', SALT), deletedAt: null, isActive: true } }));
    expect(h.d('attendanceDevice').update).toHaveBeenCalledWith({ where: { id: 'dev1' }, data: { pinFailCount: 0 } });
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

  it('TD13 remember stores the response per (device, requestId) and ignores a duplicate (P2002)', async () => {
    const h = harness();
    await h.service.remember('dev1', 'r1', { ok: true });
    expect(h.d('attendanceDeviceRequest').create).toHaveBeenCalledWith({ data: { deviceId: 'dev1', requestId: 'r1', responseJson: { ok: true } } });
    h.d('attendanceDeviceRequest').create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    await expect(h.service.remember('dev1', 'r1', { ok: true })).resolves.toBeUndefined();
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
});
