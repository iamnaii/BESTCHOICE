import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AttendanceDevicesPage from './index';
import { settingsRegistry } from '@/config/settings-registry';

/** ก้อน 10 D3 Task 10 — ตั้งค่า › บริษัท & สาขา › เครื่องตอกบัตร (mockup บอร์ด 4): รายการเครื่อง · เพิ่มเครื่อง = รหัส 8 ตัว · ยกเลิก/ปลดล็อก · เวลางาน/ผ่อนผัน */
const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: apiMock, getErrorMessage: (e: unknown) => (e as Error)?.message ?? String(e) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-owner', role: 'OWNER', branchId: null } }) }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

const DEVICES = [
  { id: 'd1', name: 'แท็บเล็ตเคาน์เตอร์', branchId: 'br1', branchName: 'ลพบุรี', status: 'ACTIVE', lastSeenAt: '2026-10-27T03:16:00.000Z', lastIp: '1.1.1.1', lastUserAgent: 'Android', pinLockedUntil: null, createdAt: '2026-10-20T00:00:00.000Z' },
  { id: 'd2', name: 'มือถือสำรอง', branchId: 'br1', branchName: 'ลพบุรี', status: 'LOCKED', lastSeenAt: '2026-10-27T06:41:00.000Z', lastIp: '9.9.9.9', lastUserAgent: 'iPhone', pinLockedUntil: null, createdAt: '2026-10-22T00:00:00.000Z' },
];
const SETTINGS = { workStart: '10:00', workEnd: '19:00', lateGraceMinutes: 15, photoRetentionDays: 365, branches: [{ branchId: 'br1', branchName: 'ลพบุรี', workStart: null, workEnd: null }] };

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><AttendanceDevicesPage /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockImplementation(async (path: string) => ({ data: path === '/attendance/devices' ? DEVICES : path === '/attendance/settings' ? SETTINGS : null }));
  apiMock.post.mockImplementation(async (path: string) => ({ data: path.endsWith('registration-code') ? { code: '7K4M2QX9', expiresAt: '2026-10-27T03:42:00.000Z' } : { ok: true } }));
  apiMock.patch.mockResolvedValue({ data: SETTINGS });
});

describe('AttendanceDevicesPage', () => {
  it('D1 lists devices with status chips; เพิ่มเครื่อง opens a dialog with the 8-char code; ยกเลิก/ปลดล็อก confirm then POST', async () => {
    wrap();
    await screen.findByText('แท็บเล็ตเคาน์เตอร์');
    expect(screen.getByText(/ใช้งาน/)).toBeInTheDocument();
    expect(screen.getByText(/ล็อก · รหัสเครื่องถูกใช้จาก 2 ที่/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /เพิ่มเครื่อง/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /ออกรหัส/ }));
    await within(dialog).findByText('7K4M2QX9');
    expect(apiMock.post).toHaveBeenCalledWith('/attendance/devices/registration-code', { branchId: 'br1' });
    fireEvent.click(within(dialog).getByRole('button', { name: /ปิด/ }));
    const locked = screen.getByText('มือถือสำรอง').closest('tr')!;
    fireEvent.click(within(locked).getByRole('button', { name: /ปลดล็อก/ }));
    const confirm = await screen.findByRole('dialog');
    fireEvent.click(within(confirm).getByRole('button', { name: /^ปลดล็อก$/ }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/attendance/devices/d2/unlock'));
    const active = screen.getByText('แท็บเล็ตเคาน์เตอร์').closest('tr')!;
    fireEvent.click(within(active).getByRole('button', { name: /ยกเลิก/ }));
    const confirm2 = await screen.findByRole('dialog');
    fireEvent.click(within(confirm2).getByRole('button', { name: /^ยกเลิกเครื่อง$/ }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/attendance/devices/d1/revoke'));
  });

  it('D2 settings form PATCHes work hours + grace + retention', async () => {
    wrap();
    await screen.findByText('แท็บเล็ตเคาน์เตอร์');
    const start = await screen.findByLabelText(/เวลาเข้างาน/);
    fireEvent.change(start, { target: { value: '09:30' } });
    fireEvent.change(screen.getByLabelText(/ผ่อนผันสาย/), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /บันทึกเวลางาน/ }));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith('/attendance/settings', expect.objectContaining({ workStart: '09:30', workEnd: '19:00', lateGraceMinutes: 10, photoRetentionDays: 365 })));
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('D3 registered in the settings registry as an OWNER route under สาขา', () => {
    const item = settingsRegistry.flatMap((c) => c.items).find((i) => i.id === 'attendance-devices');
    expect(item).toMatchObject({ group: 'สาขา', roles: ['OWNER'], kind: 'route', path: '/settings/company/attendance-devices' });
  });
});
