import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KioskApiError } from '@/lib/kiosk-api';
import { clearDevice, saveDevice } from '@/lib/kiosk-store';
import KioskPage from '../KioskPage';

/** ก้อน 10 D3 Task 8 — หน้าตอกบัตรบนเครื่องประจำสาขา (mockup บอร์ด 1–2): ลงทะเบียน · กดเข้า/ออก + รหัส 6 หลัก · ผล · ผิดพลาดไม่หลอกว่าสำเร็จ */
const apiMock = vi.hoisted(() => ({ register: vi.fn(), heartbeat: vi.fn(), punch: vi.fn() }));
vi.mock('@/lib/kiosk-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/kiosk-api')>('@/lib/kiosk-api');
  return { ...actual, kioskApi: apiMock };
});

const DEVICE = { token: 'tok-1', branchName: 'ลพบุรี', deviceName: 'แท็บเล็ตเคาน์เตอร์' };
const ok = (over: Partial<{ nickname: string; status: string; lateMinutes: number; otHours: number; kind: string; flags: string[] }> = {}) => ({
  nextDeviceToken: 'tok-2',
  serverTime: '2026-10-27T03:02:00.000Z',
  result: { nickname: 'นุ๊ก', kind: 'IN', at: '2026-10-27T03:02:00.000Z', status: 'ON_TIME', lateMinutes: 0, otHours: 0, flags: [], ...over },
});

function typePin(digits: string) {
  for (const d of digits) fireEvent.click(screen.getByRole('button', { name: d }));
}

describe('KioskPage', () => {
  beforeEach(() => {
    localStorage.clear();
    apiMock.heartbeat.mockResolvedValue({ nextDeviceToken: 'tok-hb', serverTime: '2026-10-27T03:00:00.000Z', device: { status: 'ACTIVE', name: DEVICE.deviceName, branchName: DEVICE.branchName } });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockRejectedValue(new Error('NotAllowedError')) } });
  });
  afterEach(() => { vi.clearAllMocks(); clearDevice(); });

  it('W1 unregistered → registration screen; a valid code saves the device and shows the punch screen with the branch name', async () => {
    apiMock.register.mockResolvedValue({ deviceToken: 'tok-new', branch: { id: 'br1', name: 'ลพบุรี' }, device: { id: 'd1', name: 'แท็บเล็ตเคาน์เตอร์' }, serverTime: '2026-10-27T02:00:00.000Z' });
    render(<KioskPage />);
    expect(screen.getByRole('heading', { name: /ผูกเครื่องนี้กับสาขา/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/รหัสลงทะเบียน/), { target: { value: '7k4m2qx9' } });
    fireEvent.change(screen.getByLabelText(/ชื่อเครื่อง/), { target: { value: 'แท็บเล็ตเคาน์เตอร์' } });
    fireEvent.click(screen.getByRole('button', { name: /ผูกเครื่องกับสาขา/ }));
    await waitFor(() => expect(screen.getByText('ลพบุรี')).toBeInTheDocument());
    expect(apiMock.register).toHaveBeenCalledWith('7K4M2QX9', 'แท็บเล็ตเคาน์เตอร์');
    expect(JSON.parse(localStorage.getItem('bc.kiosk.device')!)).toMatchObject({ token: 'tok-new', branchName: 'ลพบุรี' });
    expect(screen.getByRole('button', { name: /^เข้างาน$/ })).toBeInTheDocument();
  });

  it('W2 choosing เข้างาน + 6 digits + ยืนยัน → punch(kind IN) and the result shows nickname + status; token rotated into the store', async () => {
    saveDevice(DEVICE);
    apiMock.punch.mockResolvedValue(ok());
    render(<KioskPage />);
    await screen.findByRole('button', { name: /^เข้างาน$/ });
    fireEvent.click(screen.getByRole('button', { name: /^เข้างาน$/ }));
    typePin('123456');
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันเข้างาน/ }));
    await waitFor(() => expect(screen.getByText(/สวัสดี นุ๊ก/)).toBeInTheDocument());
    expect(apiMock.punch).toHaveBeenCalledWith(expect.objectContaining({ pin: '123456', kind: 'IN' }));
    expect(apiMock.punch.mock.calls[0][0]).not.toHaveProperty('token'); // client อ่าน token จาก store เองตอนส่ง (คิวเดียว)
    expect(apiMock.punch.mock.calls[0][0].requestId).toBeUndefined(); // คำขอใหม่
    expect(screen.getByText('ตรงเวลา')).toBeInTheDocument();
  });

  it('W3 LATE shows "สาย 16 นาที"; OUT_OT shows "OT 2 ชั่วโมง"', async () => {
    saveDevice(DEVICE);
    apiMock.punch.mockResolvedValueOnce(ok({ nickname: 'เอก', status: 'LATE', lateMinutes: 16 }));
    render(<KioskPage />);
    await screen.findByRole('button', { name: /^เข้างาน$/ });
    fireEvent.click(screen.getByRole('button', { name: /^เข้างาน$/ }));
    typePin('654321');
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันเข้างาน/ }));
    await screen.findByText(/สาย 16 นาที/);
    apiMock.punch.mockResolvedValueOnce(ok({ nickname: 'เอก', kind: 'OUT', status: 'OUT_OT', otHours: 2 }));
    fireEvent.click(screen.getByRole('button', { name: /กลับหน้าหลัก/ }));
    fireEvent.click(screen.getByRole('button', { name: /^ออกงาน$/ }));
    typePin('654321');
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันออกงาน/ }));
    await screen.findByText(/OT 2 ชั่วโมง/);
  });

  it('W4 400 รหัสไม่ถูกต้อง → inline error, pin cleared, screen stays on the punch screen', async () => {
    saveDevice(DEVICE);
    apiMock.punch.mockRejectedValue(new KioskApiError('รหัสไม่ถูกต้อง', { code: 'PIN_INVALID', status: 400 }));
    render(<KioskPage />);
    await screen.findByRole('button', { name: /^เข้างาน$/ });
    fireEvent.click(screen.getByRole('button', { name: /^เข้างาน$/ }));
    typePin('000000');
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันเข้างาน/ }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('รหัสไม่ถูกต้อง');
    expect(screen.getByRole('button', { name: /ยืนยันเข้างาน/ })).toBeDisabled(); // pin ถูกล้าง
    expect(screen.queryByText(/สวัสดี/)).not.toBeInTheDocument();
  });

  it('W5 network error → red "ยังไม่ได้บันทึก" with retry, never a success state', async () => {
    saveDevice(DEVICE);
    apiMock.punch.mockRejectedValue(new KioskApiError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', { network: true }));
    render(<KioskPage />);
    await screen.findByRole('button', { name: /^เข้างาน$/ });
    fireEvent.click(screen.getByRole('button', { name: /^เข้างาน$/ }));
    typePin('123456');
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันเข้างาน/ }));
    await screen.findByText(/ยังไม่ได้บันทึก/);
    expect(screen.getByRole('button', { name: /ลองใหม่/ })).toBeInTheDocument();
    expect(screen.queryByText(/สวัสดี/)).not.toBeInTheDocument();
  });

  it('W6 camera denied → punch is still sent without a photo and the notice is shown', async () => {
    saveDevice(DEVICE);
    apiMock.punch.mockResolvedValue(ok({ flags: ['NO_PHOTO'] }));
    render(<KioskPage />);
    await screen.findByRole('button', { name: /^เข้างาน$/ });
    await waitFor(() => expect(screen.getAllByText(/กล้องใช้ไม่ได้/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /^เข้างาน$/ }));
    typePin('123456');
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันเข้างาน/ }));
    await screen.findByText(/สวัสดี นุ๊ก/);
    expect(apiMock.punch.mock.calls[0][0].photo).toBeUndefined();
    expect(screen.getByText(/บันทึกโดยไม่มีรูป/)).toBeInTheDocument();
  });

  it('W7 401 DEVICE_LOCKED → blocked screen; DEVICE_REVOKED clears the store and returns to registration', async () => {
    saveDevice(DEVICE);
    apiMock.punch.mockRejectedValueOnce(new KioskApiError('เครื่องนี้ถูกล็อก', { code: 'DEVICE_LOCKED', status: 401 }));
    const { unmount } = render(<KioskPage />);
    await screen.findByRole('button', { name: /^เข้างาน$/ });
    fireEvent.click(screen.getByRole('button', { name: /^เข้างาน$/ }));
    typePin('123456');
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันเข้างาน/ }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('เครื่องนี้ถูกล็อก');
    // ชี้เมนูที่มีจริง: หมวดตั้งค่าชื่อ "บริษัท & สาขา"
    expect(screen.getByText(/ตั้งค่า › บริษัท & สาขา › เครื่องตอกบัตร/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^เข้างาน$/ })).not.toBeInTheDocument();
    expect(localStorage.getItem('bc.kiosk.device')).not.toBeNull();
    unmount();
    apiMock.heartbeat.mockRejectedValueOnce(new KioskApiError('ยกเลิกแล้ว', { code: 'DEVICE_REVOKED', status: 401 }));
    render(<KioskPage />);
    await screen.findByRole('heading', { name: /ผูกเครื่องนี้กับสาขา/ });
    expect(localStorage.getItem('bc.kiosk.device')).toBeNull();
  });

  it('W8 keypad buttons are real <button>s ≥ 64px with labels and the confirm button is disabled until kind + 6 digits', async () => {
    saveDevice(DEVICE);
    render(<KioskPage />);
    await screen.findByRole('button', { name: /^เข้างาน$/ });
    const pad = screen.getByRole('group', { name: /แป้นรหัส/ });
    const keys = within(pad).getAllByRole('button');
    expect(keys.length).toBe(12);
    for (const k of keys) expect(k.className).toMatch(/min-h-16|h-16/);
    expect(within(pad).getByRole('button', { name: /ลบตัวสุดท้าย/ })).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: /ยืนยัน/ });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^ออกงาน$/ }));
    typePin('12345');
    expect(confirm).toBeDisabled();
    typePin('6');
    expect(confirm).toBeEnabled();
    await act(async () => undefined);
  });
  it('W9 ลองใหม่ after a network error resends the SAME request (requestId from the error) so a punch that did reach the server is not doubled; a new PIN starts a new request (รีวิว C3)', async () => {
    saveDevice(DEVICE);
    const lost = Object.assign(new KioskApiError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', { network: true }), { requestId: '22222222-2222-4222-8222-222222222222' });
    apiMock.punch.mockRejectedValueOnce(lost).mockResolvedValueOnce(ok());
    render(<KioskPage />);
    await screen.findByRole('button', { name: /^เข้างาน$/ });
    fireEvent.click(screen.getByRole('button', { name: /^เข้างาน$/ }));
    typePin('123456');
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันเข้างาน/ }));
    fireEvent.click(await screen.findByRole('button', { name: /ลองใหม่/ }));
    await screen.findByText(/สวัสดี นุ๊ก/);
    expect(apiMock.punch.mock.calls[1][0]).toMatchObject({ pin: '123456', kind: 'IN', requestId: '22222222-2222-4222-8222-222222222222' });
  });

  it('W10 REQUEST_BUSY is shown as retryable; the current location is attached when the tablet allows it (รีวิว I4)', async () => {
    saveDevice(DEVICE);
    const getCurrentPosition = vi.fn((ok: (p: { coords: { latitude: number; longitude: number } }) => void) => ok({ coords: { latitude: 14.7995, longitude: 100.6534 } }));
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } });
    apiMock.punch.mockRejectedValueOnce(Object.assign(new KioskApiError('busy', { code: 'REQUEST_BUSY', status: 409 }), { requestId: '33333333-3333-4333-8333-333333333333' }));
    render(<KioskPage />);
    await screen.findByRole('button', { name: /^เข้างาน$/ });
    fireEvent.click(screen.getByRole('button', { name: /^เข้างาน$/ }));
    typePin('123456');
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันเข้างาน/ }));
    await screen.findByRole('button', { name: /ลองใหม่/ });
    expect(apiMock.punch.mock.calls[0][0].geo).toEqual({ lat: 14.7995, lng: 100.6534 });
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
  });
});
