import { Test } from '@nestjs/testing';
import { INestApplication, UnauthorizedException } from '@nestjs/common';
import request from 'supertest';
import { configureApp } from '../../../app.setup';
import { KioskPublicController } from '../kiosk-public.controller';
import { AttendanceDeviceService } from '../attendance-device.service';
import { KioskPunchService } from '../kiosk-punch.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

/**
 * ก้อน 10 D3 รีวิว C1 — สิ่งที่แท็บเล็ตได้รับจริงผ่าน HTTP (global pipe · filter · envelope ของ configureApp)
 * unit spec เรียก method ตรง จึงไม่เห็นว่า SentryExceptionFilter ตัด `code` ทิ้ง — เทสนี้ยิงผ่าน layer จริง
 */
const RID = '11111111-1111-4111-8111-111111111111';
const DEVICE = { id: 'dev1', branchId: 'br1', name: 'แท็บเล็ต', status: 'ACTIVE', lastIp: '1.1.1.1', branch: { id: 'br1', name: 'ลพบุรี' } };
const auth = { device: DEVICE, token: { id: 't3', generation: 3, usedAt: null } };

describe('Kiosk endpoints over HTTP', () => {
  let app: INestApplication;
  const devices = {
    authenticate: jest.fn(),
    checkPin: jest.fn(),
    commitRotation: jest.fn(async () => 'next-token'),
    rememberError: jest.fn(async () => undefined),
    heartbeat: jest.fn(),
    register: jest.fn(),
  };
  const punch = { punch: jest.fn() };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [KioskPublicController],
      providers: [
        { provide: AttendanceDeviceService, useValue: devices },
        { provide: KioskPunchService, useValue: punch },
      ],
    }).compile();
    app = mod.createNestApplication();
    configureApp(app, { swagger: false });
    await app.init();
  });
  afterAll(async () => app?.close());
  beforeEach(() => {
    jest.clearAllMocks();
    devices.authenticate.mockResolvedValue(auth);
    devices.checkPin.mockResolvedValue({ userId: 'u1' });
  });

  const post = (fields: Record<string, string>) => {
    const r = request(app.getHttpServer()).post('/api/kiosk/punch');
    for (const [k, v] of Object.entries(fields)) r.field(k, v);
    return r;
  };
  const valid = { deviceToken: 'tok', requestId: RID, pin: '123456', kind: 'IN' };

  it('H1 wrong PIN → 400 with code PIN_INVALID reaching the tablet', async () => {
    devices.checkPin.mockResolvedValueOnce('INVALID');
    const res = await post({ ...valid, pin: '000000' }).expect(400);
    expect(res.body).toMatchObject({ statusCode: 400, code: 'PIN_INVALID', message: 'รหัสไม่ถูกต้อง' });
  });

  it('H2 a locked device → 401 with code DEVICE_LOCKED (the tablet shows the blocked screen)', async () => {
    devices.authenticate.mockRejectedValueOnce(new UnauthorizedException({ code: 'DEVICE_LOCKED', message: 'เครื่องนี้ถูกล็อก — ติดต่อเจ้าของ' }));
    const res = await post(valid).expect(401);
    expect(res.body).toMatchObject({ code: 'DEVICE_LOCKED', message: 'เครื่องนี้ถูกล็อก — ติดต่อเจ้าของ' });
  });

  it('H3 success → 200 envelope with the next token and result', async () => {
    punch.punch.mockImplementationOnce(async (_i: unknown, now: Date, finalize: (tx: unknown, r: Record<string, unknown>) => Promise<string>) => {
      const result = { nickname: 'นุ๊ก', kind: 'IN', at: now, status: 'ON_TIME', lateMinutes: 0, otHours: 0, flags: [] };
      return { ...result, nextToken: await finalize({}, result) };
    });
    const res = await post(valid).expect(201);
    expect(res.body).toMatchObject({ success: true, data: { nextDeviceToken: 'next-token', result: { nickname: 'นุ๊ก', status: 'ON_TIME' } } });
  });

  it('H4 an unexpected error → 500 code SERVER_ERROR with a generic Thai message (nothing internal leaks)', async () => {
    punch.punch.mockRejectedValueOnce(new Error('connection to db-internal:5432 refused'));
    const res = await post(valid).expect(500);
    expect(res.body).toMatchObject({ code: 'SERVER_ERROR', message: 'ระบบขัดข้อง ยังไม่ได้บันทึก — ลองใหม่อีกครั้ง' });
    expect(JSON.stringify(res.body)).not.toContain('5432');
  });

  it('H5 a write race → 409 REQUEST_BUSY; a bad requestId → 400 with the DTO message', async () => {
    punch.punch.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    const busy = await post(valid).expect(409);
    expect(busy.body).toMatchObject({ code: 'REQUEST_BUSY' });
    const bad = await post({ ...valid, requestId: 'not-a-uuid' }).expect(400);
    expect(bad.body).toMatchObject({ code: 'BAD_REQUEST', message: 'requestId ต้องเป็น uuid' });
  });

  it('H6 heartbeat success reaches the tablet with its next token', async () => {
    devices.heartbeat.mockImplementationOnce(async (_a: unknown, _c: unknown, build: (d: typeof DEVICE) => Record<string, unknown>) => ({ body: build(DEVICE), nextToken: 'next-hb' }));
    const res = await request(app.getHttpServer()).post('/api/kiosk/heartbeat').send({ deviceToken: 'tok', requestId: RID }).expect(201);
    expect(res.body.data).toMatchObject({ nextDeviceToken: 'next-hb', device: { status: 'ACTIVE', branchName: 'ลพบุรี' } });
  });
});
