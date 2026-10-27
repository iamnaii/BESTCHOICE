import { beforeEach, describe, expect, it } from 'vitest';
import { KIOSK_STORE_KEY, clearDevice, loadDevice, saveDevice, setPendingRequest, updateToken } from '../kiosk-store';

/** ก้อน 10 D3 Task 8 — ที่เก็บ device token ของเครื่องตอกบัตร (localStorage ของเครื่องนั้น · ข้อยกเว้นที่เขียนไว้ใน security.md) */
describe('kiosk-store', () => {
  beforeEach(() => localStorage.clear());

  it('KS1 save/load round trip and updateToken keeps the rest', () => {
    saveDevice({ token: 't1', branchName: 'ลพบุรี', deviceName: 'แท็บเล็ต' });
    expect(loadDevice()).toEqual({ token: 't1', branchName: 'ลพบุรี', deviceName: 'แท็บเล็ต' });
    updateToken('t2');
    expect(loadDevice()?.token).toBe('t2');
    clearDevice();
    expect(loadDevice()).toBeNull();
  });

  it('KS2 garbage or a throwing storage never crashes — load returns null', () => {
    localStorage.setItem(KIOSK_STORE_KEY, '{not json');
    expect(loadDevice()).toBeNull();
    localStorage.setItem(KIOSK_STORE_KEY, JSON.stringify({ token: 42 }));
    expect(loadDevice()).toBeNull();
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('blocked'); };
    try { expect(loadDevice()).toBeNull(); } finally { Storage.prototype.getItem = original; }
  });
  it('KS3 a pending requestId is stored with the device and cleared by the same write that saves the next token (รีวิว C3)', () => {
    saveDevice({ token: 't1', branchName: 'ลพบุรี', deviceName: 'แท็บเล็ต' });
    setPendingRequest('r-1');
    expect(loadDevice()).toMatchObject({ token: 't1', pendingRequestId: 'r-1' });
    updateToken('t2');
    expect(loadDevice()).toEqual({ token: 't2', branchName: 'ลพบุรี', deviceName: 'แท็บเล็ต' });
    setPendingRequest('r-2');
    setPendingRequest(null);
    expect(loadDevice()?.pendingRequestId).toBeUndefined();
  });
});
