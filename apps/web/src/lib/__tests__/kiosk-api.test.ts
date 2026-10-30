import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';

/**
 * ก้อน 10 D3 รีวิว C1/C3/I5/I6 — client ของเครื่องตอกบัตร
 * - คำขอทั้งหมดเข้าคิวเดียว และอ่าน token จาก store ตอนส่ง (heartbeat ต้องไม่แซงการตอกที่ค้างอยู่)
 * - คำตอบหาย: ลองใหม่ด้วย requestId เดิม · คำขอใหม่ครั้งถัดไปต้อง "เก็บคำตอบที่ค้าง" ก่อน (heartbeat ด้วย requestId ที่ค้าง)
 * - error ของเซิร์ฟเวอร์ส่ง `code` ระดับบนสุด · เครื่องเก่าไม่มี crypto.randomUUID ก็ต้องได้ uuid v4
 */
const postMock = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({ default: { create: () => ({ post: postMock }) } }));

import { KioskApiError, kioskApi, newRequestId } from '../kiosk-api';
import { loadDevice, saveDevice, setPendingRequest } from '../kiosk-store';

const DEVICE = { token: 'tok-1', branchName: 'ลพบุรี', deviceName: 'แท็บเล็ต' };
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const okEnvelope = (data: Record<string, unknown>) => ({ data: { success: true, data } });
const httpError = (status: number, body: Record<string, unknown>) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data: body } });
const networkError = () => Object.assign(new Error('Network Error'), { request: {} });
const field = (form: FormData, k: string) => form.get(k);
const bodyOf = (call: unknown[]) => call[1] as Record<string, unknown> | FormData;
const requestIdOf = (call: unknown[]) => { const b = bodyOf(call); return b instanceof FormData ? (field(b, 'requestId') as string) : (b.requestId as string); };
const tokenOf = (call: unknown[]) => { const b = bodyOf(call); return b instanceof FormData ? (field(b, 'deviceToken') as string) : (b.deviceToken as string); };

describe('kiosk-api', () => {
  beforeEach(() => { localStorage.clear(); postMock.mockReset(); saveDevice(DEVICE); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('KA1 newRequestId is a v4 uuid even without crypto.randomUUID (old tablets — รีวิว I6)', () => {
    expect(newRequestId()).toMatch(UUID_V4);
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => webcrypto.getRandomValues(a) });
    for (let i = 0; i < 20; i += 1) expect(newRequestId()).toMatch(UUID_V4);
  });

  it('KA2 an error reply exposes the server code/message, keeps the token and clears the pending request (definitive answer)', async () => {
    postMock.mockRejectedValueOnce(httpError(400, { statusCode: 400, code: 'PIN_INVALID', message: 'รหัสไม่ถูกต้อง', serverTime: 'x' }));
    const err = await kioskApi.punch({ pin: '000000', kind: 'IN' }).catch((e) => e);
    expect(err).toBeInstanceOf(KioskApiError);
    expect(err).toMatchObject({ code: 'PIN_INVALID', message: 'รหัสไม่ถูกต้อง', status: 400, retryable: false });
    expect(loadDevice()).toEqual(DEVICE);
  });

  it('KA3 a heartbeat fired while a punch is in flight waits for it and sends the token the punch returned (รีวิว I5)', async () => {
    let release!: (v: unknown) => void;
    postMock.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    postMock.mockResolvedValueOnce(okEnvelope({ nextDeviceToken: 'tok-3', serverTime: 'x', device: { status: 'ACTIVE', name: 'n', branchName: 'b' } }));
    const punch = kioskApi.punch({ pin: '123456', kind: 'IN' });
    const hb = kioskApi.heartbeat();
    await Promise.resolve();
    await Promise.resolve();
    expect(postMock).toHaveBeenCalledTimes(1);
    release(okEnvelope({ nextDeviceToken: 'tok-2', serverTime: 'x', result: { nickname: 'นุ๊ก' } }));
    await punch;
    await hb;
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(tokenOf(postMock.mock.calls[1])).toBe('tok-2');
    expect(loadDevice()?.token).toBe('tok-3');
  });

  it('KA4 network failure (after one automatic retry with the same requestId) is retryable and keeps the pending id; retrying with that id resends the same request (รีวิว C3)', async () => {
    vi.useFakeTimers();
    postMock.mockRejectedValue(networkError());
    const failing = kioskApi.punch({ pin: '123456', kind: 'IN' }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(1600);
    const err = await failing;
    expect(err).toMatchObject({ network: true, retryable: true });
    expect(err.requestId).toMatch(UUID_V4);
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(requestIdOf(postMock.mock.calls[0])).toBe(err.requestId);
    expect(requestIdOf(postMock.mock.calls[1])).toBe(err.requestId);
    expect(loadDevice()?.pendingRequestId).toBe(err.requestId);

    postMock.mockReset();
    postMock.mockResolvedValueOnce(okEnvelope({ nextDeviceToken: 'tok-2', serverTime: 'x', result: { nickname: 'นุ๊ก' } }));
    await kioskApi.punch({ pin: '123456', kind: 'IN', requestId: err.requestId });
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(requestIdOf(postMock.mock.calls[0])).toBe(err.requestId);
    expect(tokenOf(postMock.mock.calls[0])).toBe('tok-1');
    expect(loadDevice()).toEqual({ ...DEVICE, token: 'tok-2' });
  });

  it('KA5 a new operation with an unresolved pending request first recovers it (heartbeat with the pending id) and then uses the recovered token', async () => {
    setPendingRequest('11111111-1111-4111-8111-111111111111');
    postMock.mockResolvedValueOnce(okEnvelope({ nextDeviceToken: 'tok-recovered', serverTime: 'x', result: { nickname: 'คนก่อน' } }));
    postMock.mockResolvedValueOnce(okEnvelope({ nextDeviceToken: 'tok-after', serverTime: 'x', result: { nickname: 'นุ๊ก' } }));
    const out = await kioskApi.punch({ pin: '123456', kind: 'OUT' });
    expect(postMock.mock.calls[0][0]).toBe('/kiosk/heartbeat');
    expect(requestIdOf(postMock.mock.calls[0])).toBe('11111111-1111-4111-8111-111111111111');
    expect(postMock.mock.calls[1][0]).toBe('/kiosk/punch');
    expect(tokenOf(postMock.mock.calls[1])).toBe('tok-recovered');
    expect(requestIdOf(postMock.mock.calls[1])).not.toBe('11111111-1111-4111-8111-111111111111');
    expect(out.result.nickname).toBe('นุ๊ก');
    expect(loadDevice()).toEqual({ ...DEVICE, token: 'tok-after' });
  });

  it('KA6 REQUEST_BUSY is retried once with the same requestId', async () => {
    vi.useFakeTimers();
    postMock.mockRejectedValueOnce(httpError(409, { statusCode: 409, code: 'REQUEST_BUSY', message: 'busy' }));
    postMock.mockResolvedValueOnce(okEnvelope({ nextDeviceToken: 'tok-2', serverTime: 'x', device: { status: 'ACTIVE', name: 'n', branchName: 'b' } }));
    const hb = kioskApi.heartbeat();
    await vi.advanceTimersByTimeAsync(1600);
    await hb;
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(requestIdOf(postMock.mock.calls[0])).toBe(requestIdOf(postMock.mock.calls[1]));
    expect(loadDevice()?.token).toBe('tok-2');
  });
  it('KA7 a retried punch whose id was meanwhile used by a recovery heartbeat (the punch never arrived) → NOT_RECORDED, never a fake success', async () => {
    postMock.mockResolvedValueOnce(okEnvelope({ serverTime: 'x', device: { status: 'ACTIVE', name: 'n', branchName: 'b' } }));
    const err = await kioskApi.punch({ pin: '123456', kind: 'IN', requestId: '44444444-4444-4444-8444-444444444444' }).catch((e) => e);
    expect(err).toBeInstanceOf(KioskApiError);
    expect(err).toMatchObject({ code: 'NOT_RECORDED', retryable: false });
    expect(err.message).toContain('ยังไม่ได้บันทึก');
  });
  it('KA8 when recovering an old pending request fails, the error never carries that old id — a different person\'s retry must not replay someone else\'s punch (รีวิวรอบ 2 C1)', async () => {
    vi.useFakeTimers();
    setPendingRequest('55555555-5555-4555-8555-555555555555');
    postMock.mockRejectedValue(networkError());
    const failing = kioskApi.punch({ pin: '222222', kind: 'IN' }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(1600);
    const err = await failing;
    expect(err).toMatchObject({ network: true, retryable: true });
    expect(err.requestId).not.toBe('55555555-5555-4555-8555-555555555555');
    expect(err.requestId).toBeUndefined(); // คำขอใหม่ยังไม่ได้ส่ง — ลองใหม่ = กู้คำขอเดิมก่อนแล้วส่งของตัวเอง
    expect(loadDevice()?.pendingRequestId).toBe('55555555-5555-4555-8555-555555555555');
    expect(postMock.mock.calls.every((c) => c[0] === '/kiosk/heartbeat')).toBe(true);
  });

  it('KA9 a 5xx, 429 or 408 is an unknown outcome like a network error: retryable, pending kept, token unchanged (รีวิวรอบ 2 C2)', async () => {
    vi.useFakeTimers();
    for (const status of [502, 500, 429, 408]) {
      postMock.mockReset();
      saveDevice(DEVICE);
      postMock.mockRejectedValue(httpError(status, { statusCode: status, code: 'SERVER_ERROR', message: 'x' }));
      const failing = kioskApi.heartbeat().catch((e) => e);
      await vi.advanceTimersByTimeAsync(1600);
      const err = await failing;
      expect(err.retryable).toBe(true);
      expect(loadDevice()?.pendingRequestId).toBe(err.requestId);
      expect(loadDevice()?.token).toBe('tok-1');
    }
  });

  it('KA10 requests run under a cross-tab Web Lock when the browser has one (two kiosk tabs must not race on the token — รีวิวรอบ 2 C3)', async () => {
    const request = vi.fn(async (_name: string, cb: () => Promise<unknown>) => cb());
    vi.stubGlobal('navigator', { ...navigator, locks: { request } });
    postMock.mockResolvedValueOnce(okEnvelope({ nextDeviceToken: 'tok-2', serverTime: 'x', device: { status: 'ACTIVE', name: 'n', branchName: 'b' } }));
    await kioskApi.heartbeat();
    expect(request).toHaveBeenCalledWith('bc-kiosk-device', expect.any(Function));
  });

  it('KA11 register is not auto-retried (a second try would burn the one-time code) and a network failure says what to check (รีวิวรอบ 2 C5)', async () => {
    postMock.mockRejectedValue(networkError());
    const err = await kioskApi.register('ABCDEFGH', 'แท็บเล็ต').catch((e) => e);
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(err.message).toContain('ไม่แน่ใจ');
  });
});
