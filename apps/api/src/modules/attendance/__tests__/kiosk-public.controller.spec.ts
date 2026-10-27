import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { BadRequestException, HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { KioskPublicController } from '../kiosk-public.controller';
import { HeartbeatKioskDto, PunchKioskDto, RegisterKioskDto } from '../dto/kiosk.dto';

/** ก้อน 10 D3 Task 4 — endpoints สาธารณะของเครื่องตอกบัตร: ลำดับ authenticate → checkPin → punch → remember · รหัสผิดไม่บอกชื่อ · manifest = public (สเปก §8) */
const NOW_RE = /^\d{4}-\d{2}-\d{2}T/;
const req = { headers: { 'user-agent': 'kiosk-ua' }, ip: '1.1.1.1', socket: { remoteAddress: '1.1.1.1' } } as never;

function harness() {
  const calls: string[] = [];
  const devices = {
    authenticate: jest.fn(async () => { calls.push('authenticate'); return { device: { id: 'dev1', branchId: 'br1', name: 'แท็บเล็ต', status: 'ACTIVE', branch: { id: 'br1', name: 'ลพบุรี' } }, nextToken: 'next-token' }; }),
    checkPin: jest.fn(async () => { calls.push('checkPin'); return { userId: 'u1' }; }),
    remember: jest.fn(async () => { calls.push('remember'); }),
    touchCleanHeartbeat: jest.fn(async () => { calls.push('heartbeat'); }),
    register: jest.fn(async () => ({ deviceToken: 'tok', device: { id: 'dev1', branchId: 'br1', branchName: 'ลพบุรี', name: 'แท็บเล็ต' } })),
  };
  const punch = { punch: jest.fn(async () => { calls.push('punch'); return { nickname: 'นุ๊ก', kind: 'IN', at: new Date(), status: 'ON_TIME', lateMinutes: 0, otHours: 0, flags: [] }; }) };
  const controller = new KioskPublicController(devices as never, punch as never);
  return { controller, devices, punch, calls };
}

describe('KioskPublicController', () => {
  it('KC1 punch: authenticate → checkPin → punch → remember, response carries nextDeviceToken + serverTime + result', async () => {
    const h = harness();
    const dto = plainToInstance(PunchKioskDto, { deviceToken: 'tok', requestId: '11111111-1111-4111-8111-111111111111', pin: '123456', kind: 'IN' });
    const res = await h.controller.punch(dto, undefined, req);
    expect(h.calls).toEqual(['authenticate', 'checkPin', 'punch', 'remember']);
    expect(res).toMatchObject({ nextDeviceToken: 'next-token', result: { nickname: 'นุ๊ก', status: 'ON_TIME' } });
    expect(res.serverTime).toMatch(NOW_RE);
    expect(h.devices.authenticate).toHaveBeenCalledWith(expect.objectContaining({ deviceToken: 'tok', requestId: '11111111-1111-4111-8111-111111111111', userAgent: 'kiosk-ua' }), expect.any(Date));
    expect(h.devices.remember).toHaveBeenCalledWith('dev1', '11111111-1111-4111-8111-111111111111', expect.objectContaining({ nextDeviceToken: 'next-token' }));
  });

  it('KC2 a cached requestId returns the cached body and never reaches checkPin/punch', async () => {
    const h = harness();
    h.devices.authenticate.mockResolvedValueOnce({ device: { id: 'dev1' }, cached: { nextDeviceToken: 'old-next', serverTime: 'x', result: { status: 'LATE' } } } as never);
    const res = await h.controller.punch(plainToInstance(PunchKioskDto, { deviceToken: 'tok', requestId: '11111111-1111-4111-8111-111111111111', pin: '123456', kind: 'IN' }), undefined, req);
    expect(res).toEqual({ nextDeviceToken: 'old-next', serverTime: 'x', result: { status: 'LATE' } });
    expect(h.devices.checkPin).not.toHaveBeenCalled();
    expect(h.punch.punch).not.toHaveBeenCalled();
  });

  it('KC3 PIN LOCKED → 423 { code: PIN_LOCKED }; the device token still rotates (remember is called)', async () => {
    const h = harness();
    h.devices.checkPin.mockResolvedValueOnce('LOCKED' as never);
    const err = await h.controller.punch(plainToInstance(PunchKioskDto, { deviceToken: 'tok', requestId: '11111111-1111-4111-8111-111111111111', pin: '000000', kind: 'IN' }), undefined, req).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(423);
    expect(err.getResponse()).toMatchObject({ code: 'PIN_LOCKED', nextDeviceToken: 'next-token' });
  });

  it('KC4 INVALID pin → 400 with a generic Thai message that names nobody, and the next token is still delivered', async () => {
    const h = harness();
    h.devices.checkPin.mockResolvedValueOnce('INVALID' as never);
    const err = await h.controller.punch(plainToInstance(PunchKioskDto, { deviceToken: 'tok', requestId: '11111111-1111-4111-8111-111111111111', pin: '000000', kind: 'IN' }), undefined, req).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ code: 'PIN_INVALID', message: 'รหัสไม่ถูกต้อง', nextDeviceToken: 'next-token' });
    expect(JSON.stringify(err.getResponse())).not.toContain('นุ๊ก');
  });

  it('KC5 DTO validation: code 8 chars · deviceName ≤ 60 · pin 6 digits · kind IN|OUT · requestId uuid', async () => {
    expect(await validate(plainToInstance(RegisterKioskDto, { code: 'ABCDEFGH', deviceName: 'แท็บเล็ต' }))).toEqual([]);
    expect((await validate(plainToInstance(RegisterKioskDto, { code: 'ABC', deviceName: 'x' }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(RegisterKioskDto, { code: 'ABCDEFGH', deviceName: 'x'.repeat(61) }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(PunchKioskDto, { deviceToken: 't', requestId: 'not-uuid', pin: '12345', kind: 'IN' }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(PunchKioskDto, { deviceToken: 't', requestId: '11111111-1111-4111-8111-111111111111', pin: '123456', kind: 'SIDEWAYS' }))).length).toBeGreaterThan(0);
    expect(await validate(plainToInstance(HeartbeatKioskDto, { deviceToken: 't', requestId: '11111111-1111-4111-8111-111111111111' }))).toEqual([]);
  });

  it('KC6 heartbeat rotates the token and marks a clean heartbeat', async () => {
    const h = harness();
    const res = await h.controller.heartbeat(plainToInstance(HeartbeatKioskDto, { deviceToken: 'tok', requestId: '11111111-1111-4111-8111-111111111111' }), req);
    expect(res).toMatchObject({ nextDeviceToken: 'next-token', device: { status: 'ACTIVE', branchName: 'ลพบุรี', name: 'แท็บเล็ต' } });
    expect(h.devices.touchCleanHeartbeat).toHaveBeenCalledWith('dev1', expect.any(Date));
    expect(h.devices.remember).toHaveBeenCalled();
  });

  it('KC7 the access manifest classifies the three kiosk routes as public', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../employee-access/access-policy.manifest.json'), 'utf8'));
    for (const key of ['KioskPublicController.register', 'KioskPublicController.heartbeat', 'KioskPublicController.punch']) {
      expect(manifest[key]).toMatchObject({ classification: 'public', permission: null });
    }
  });
});
