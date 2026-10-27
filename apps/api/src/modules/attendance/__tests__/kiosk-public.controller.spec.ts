import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { BadRequestException, HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { KioskPublicController } from '../kiosk-public.controller';
import { HeartbeatKioskDto, PunchKioskDto, RegisterKioskDto } from '../dto/kiosk.dto';
import { KioskExceptionFilter } from '../kiosk-errors';

/** ก้อน 10 D3 Task 4 + รีวิว — endpoints สาธารณะของเครื่องตอกบัตร: authenticate → checkPin → punch (หมุน token ใน tx เดียวกับแถวตอก) · รหัสผิดไม่บอกชื่อ · manifest = public (สเปก §8) */
const NOW_RE = /^\d{4}-\d{2}-\d{2}T/;
const req = { headers: { 'user-agent': 'kiosk-ua' }, ip: '1.1.1.1', socket: { remoteAddress: '1.1.1.1' } } as never;

const RID = '11111111-1111-4111-8111-111111111111';
const DEVICE = { id: 'dev1', branchId: 'br1', name: 'แท็บเล็ต', status: 'ACTIVE', lastIp: '1.1.1.1', branch: { id: 'br1', name: 'ลพบุรี' } };

function harness() {
  const calls: string[] = [];
  const auth = { device: DEVICE, token: { id: 't3', generation: 3, usedAt: null } };
  const devices = {
    authenticate: jest.fn(async (): Promise<Record<string, unknown>> => { calls.push('authenticate'); return auth; }),
    checkPin: jest.fn(async (): Promise<unknown> => { calls.push('checkPin'); return { userId: 'u1' }; }),
    commitRotation: jest.fn(async () => { calls.push('commitRotation'); return 'next-token'; }),
    rememberError: jest.fn(async () => { calls.push('rememberError'); }),
    heartbeat: jest.fn(async (_a: unknown, _c: unknown, build: (d: typeof DEVICE) => Record<string, unknown>) => { calls.push('heartbeat'); return { body: build(DEVICE), nextToken: 'next-hb' }; }),
    register: jest.fn(async () => ({ deviceToken: 'tok', device: { id: 'dev1', branchId: 'br1', branchName: 'ลพบุรี', name: 'แท็บเล็ต' } })),
  };
  const punch = {
    punch: jest.fn(async (_input: unknown, now: Date, finalize: (tx: unknown, r: Record<string, unknown>) => Promise<string>) => {
      calls.push('punch');
      const result = { nickname: 'นุ๊ก', kind: 'IN', at: now, status: 'ON_TIME', lateMinutes: 0, otHours: 0, flags: [] };
      const nextToken = await finalize({ tx: true }, result);
      return { ...result, nextToken };
    }),
  };
  const controller = new KioskPublicController(devices as never, punch as never);
  return { controller, devices, punch, calls, auth };
}

const punchDto = (pin = '123456') => plainToInstance(PunchKioskDto, { deviceToken: 'tok', requestId: RID, pin, kind: 'IN' });

describe('KioskPublicController', () => {
  it('KC1 punch: authenticate → checkPin → punch, and the token rotates INSIDE the punch transaction (commitRotation via finalize) with a body that carries no raw token', async () => {
    const h = harness();
    const res = await h.controller.punch(punchDto(), undefined, req);
    expect(h.calls).toEqual(['authenticate', 'checkPin', 'punch', 'commitRotation']);
    expect(res).toMatchObject({ nextDeviceToken: 'next-token', result: { nickname: 'นุ๊ก', status: 'ON_TIME' } });
    expect(res.serverTime).toMatch(NOW_RE);
    expect(h.devices.authenticate).toHaveBeenCalledWith(expect.objectContaining({ deviceToken: 'tok', requestId: RID, userAgent: 'kiosk-ua' }), expect.any(Date));
    const [tx, auth, ctx, body] = (h.devices.commitRotation.mock.calls[0] as unknown) as [unknown, unknown, Record<string, unknown>, Record<string, unknown>];
    expect(tx).toEqual({ tx: true });
    expect(auth).toBe(h.auth);
    expect(ctx).toMatchObject({ requestId: RID, userAgent: 'kiosk-ua' });
    expect(body).toMatchObject({ serverTime: expect.stringMatching(NOW_RE), result: { status: 'ON_TIME', at: expect.stringMatching(NOW_RE) } });
    expect(body).not.toHaveProperty('nextDeviceToken');
  });

  it('KC2 a replayed requestId returns the cached success body; a cached error is re-thrown with its status — neither reaches checkPin/punch', async () => {
    const h = harness();
    h.devices.authenticate.mockResolvedValueOnce({ ...h.auth, replay: { status: 200, body: { nextDeviceToken: 'rekeyed', serverTime: 'x', result: { status: 'LATE' } } } });
    expect(await h.controller.punch(punchDto(), undefined, req)).toEqual({ nextDeviceToken: 'rekeyed', serverTime: 'x', result: { status: 'LATE' } });
    h.devices.authenticate.mockResolvedValueOnce({ ...h.auth, replay: { status: 400, body: { code: 'PIN_INVALID', message: 'รหัสไม่ถูกต้อง' } } });
    const err = await h.controller.punch(punchDto(), undefined, req).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(400);
    expect(err.getResponse()).toMatchObject({ code: 'PIN_INVALID' });
    expect(h.devices.checkPin).not.toHaveBeenCalled();
    expect(h.punch.punch).not.toHaveBeenCalled();
  });

  it('KC3 PIN LOCKED → 423 { code: PIN_LOCKED }, cached as an error reply, and the token does NOT rotate (รีวิว C1)', async () => {
    const h = harness();
    h.devices.checkPin.mockResolvedValueOnce('LOCKED');
    const err = await h.controller.punch(punchDto('000000'), undefined, req).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(423);
    expect(err.getResponse()).toMatchObject({ code: 'PIN_LOCKED' });
    expect(h.devices.rememberError).toHaveBeenCalledWith('dev1', RID, 423, expect.objectContaining({ code: 'PIN_LOCKED' }));
    expect(h.devices.commitRotation).not.toHaveBeenCalled();
  });

  it('KC4 INVALID pin → 400 with a generic Thai message that names nobody; cached; no rotation', async () => {
    const h = harness();
    h.devices.checkPin.mockResolvedValueOnce('INVALID');
    const err = await h.controller.punch(punchDto('000000'), undefined, req).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ code: 'PIN_INVALID', message: 'รหัสไม่ถูกต้อง' });
    expect(JSON.stringify(err.getResponse())).not.toContain('นุ๊ก');
    expect(h.devices.rememberError).toHaveBeenCalledWith('dev1', RID, 400, expect.objectContaining({ code: 'PIN_INVALID' }));
    expect(h.devices.commitRotation).not.toHaveBeenCalled();
  });

  it('KC4b a write race (P2002) inside the punch becomes 409 REQUEST_BUSY so the tablet retries the same request (รีวิว I5)', async () => {
    const h = harness();
    h.punch.punch.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    const err = await h.controller.punch(punchDto(), undefined, req).catch((e) => e);
    expect(err.getStatus()).toBe(409);
    expect(err.getResponse()).toMatchObject({ code: 'REQUEST_BUSY' });
  });

  it('KC5 DTO validation: code 8 chars · deviceName ≤ 60 · pin 6 digits · kind IN|OUT · requestId uuid', async () => {
    expect(await validate(plainToInstance(RegisterKioskDto, { code: 'ABCDEFGH', deviceName: 'แท็บเล็ต' }))).toEqual([]);
    expect((await validate(plainToInstance(RegisterKioskDto, { code: 'ABC', deviceName: 'x' }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(RegisterKioskDto, { code: 'ABCDEFGH', deviceName: 'x'.repeat(61) }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(PunchKioskDto, { deviceToken: 't', requestId: 'not-uuid', pin: '12345', kind: 'IN' }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(PunchKioskDto, { deviceToken: 't', requestId: '11111111-1111-4111-8111-111111111111', pin: '123456', kind: 'SIDEWAYS' }))).length).toBeGreaterThan(0);
    expect(await validate(plainToInstance(HeartbeatKioskDto, { deviceToken: 't', requestId: '11111111-1111-4111-8111-111111111111' }))).toEqual([]);
    expect((await validate(plainToInstance(HeartbeatKioskDto, { deviceToken: 'x'.repeat(201), requestId: '11111111-1111-4111-8111-111111111111' }))).length).toBeGreaterThan(0);
    // พิกัดต้องอยู่ในช่วงจริง (เกินช่วงเคยทำให้ Decimal(9,6) ล้นเป็น 500)
    const geo = (geoLat: string, geoLng: string) => plainToInstance(PunchKioskDto, { deviceToken: 't', requestId: '11111111-1111-4111-8111-111111111111', pin: '123456', kind: 'IN', geoLat, geoLng });
    expect(await validate(geo('14.7995', '100.6534'))).toEqual([]);
    expect((await validate(geo('91', '100.6'))).length).toBeGreaterThan(0);
    expect((await validate(geo('14.7', '181'))).length).toBeGreaterThan(0);
  });

  it('KC6 heartbeat rotates (via devices.heartbeat — one tx with the clean-heartbeat mark) and returns the next token with device info', async () => {
    const h = harness();
    const res = await h.controller.heartbeat(plainToInstance(HeartbeatKioskDto, { deviceToken: 'tok', requestId: RID }), req);
    expect(res).toMatchObject({ nextDeviceToken: 'next-hb', device: { status: 'ACTIVE', branchName: 'ลพบุรี', name: 'แท็บเล็ต' } });
    expect(h.devices.heartbeat).toHaveBeenCalledWith(h.auth, expect.objectContaining({ requestId: RID }), expect.any(Function));
  });

  it('KC6b the controller answers errors through its own KioskExceptionFilter (the app filter drops `code`)', () => {
    const filters = Reflect.getMetadata('__exceptionFilters__', KioskPublicController) as unknown[];
    expect(filters).toEqual(expect.arrayContaining([expect.any(KioskExceptionFilter)]));
  });

  it('KC7 the access manifest classifies the three kiosk routes as public', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../employee-access/access-policy.manifest.json'), 'utf8'));
    for (const key of ['KioskPublicController.register', 'KioskPublicController.heartbeat', 'KioskPublicController.punch']) {
      expect(manifest[key]).toMatchObject({ classification: 'public', permission: null });
    }
  });
});
