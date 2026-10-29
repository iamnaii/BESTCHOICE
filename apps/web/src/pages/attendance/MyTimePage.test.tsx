import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MyTimePage from './MyTimePage';

/** ก้อน 10 D3 Task 10 — "เวลาทำงานของฉัน" (mockup บอร์ด 5): อ่านอย่างเดียว · 4 kpi · รายการรายวันพร้อมชิปสถานะ */
const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: apiMock, getErrorMessage: (e: unknown) => (e as Error)?.message ?? String(e) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', role: 'SALES', branchId: 'br1' } }) }));

const cell = (o: Record<string, unknown>) => ({ dayId: 'd', dayKind: 'WORK', status: 'NONE', clockIn: null, clockOut: null, lateMinutes: 0, otHours: 0, flags: [], clockInPunchId: null, clockOutPunchId: null, correctedCount: 0, ...o });
const ME = {
  month: '2026-10',
  rows: [
    cell({ date: '2026-10-27', status: 'ON_TIME', clockIn: '2026-10-27T03:02:00.000Z' }),
    cell({ date: '2026-10-25', status: 'ON_TIME', clockIn: '2026-10-25T03:00:00.000Z', clockOut: '2026-10-25T13:30:00.000Z', otHours: 1.5 }),
    cell({ date: '2026-10-23', status: 'LATE', clockIn: '2026-10-23T03:19:00.000Z', clockOut: '2026-10-23T12:10:00.000Z', lateMinutes: 19, flags: ['CORRECTED'], correctedCount: 1 }),
    cell({ date: '2026-10-22', status: 'DAY_OFF', dayKind: 'DAY_OFF' }),
    cell({ date: '2026-10-20', status: 'LEAVE', dayKind: 'LEAVE_SICK' }),
  ],
  summary: { workDays: 22, lateCount: 1, lateMinutes: 19, absent: 0, leave: 1, otHours: 3.5 },
};

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><MyTimePage /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: ME });
});

describe('MyTimePage', () => {
  it('M1 lists the month rows with status chips and the 4 kpis, read-only', async () => {
    wrap();
    await screen.findByText(/27 ต.ค./);
    expect(apiMock.get).toHaveBeenCalledWith('/attendance/me', { params: { month: expect.stringMatching(/^\d{4}-\d{2}$/) } });
    const kpi = screen.getByRole('list', { name: /สรุปเดือน/ });
    expect(within(kpi).getByText('มา').parentElement).toHaveTextContent('22');
    expect(within(kpi).getByText('OT ชม.').parentElement).toHaveTextContent('3.5');
    expect(screen.getByText('สาย 19 นาที')).toBeInTheDocument();
    expect(screen.getByText(/แก้โดย ผจก\./)).toBeInTheDocument();
    expect(screen.getByText('ตรงเวลา · OT 1.5 ชม.')).toBeInTheDocument();
    expect(screen.getByText('วันหยุด')).toBeInTheDocument();
    expect(screen.getByText('ลา')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /แก้ไข/ })).not.toBeInTheDocument();
  });
});
