import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AttendancePage from './index';

/**
 * ก้อน 10 D3 Task 9 — บุคลากร › ลงเวลา (mockup บอร์ด 3–4): วันนี้ (kpi + สถานะไอคอน+คำ) · รายเดือน (ตารางคน × วัน + สรุป + Excel) ·
 * ตารางหยุด/ลา (กดสลับ → บันทึก) · แก้ไขรายวันพร้อมเหตุผล · ผจก.เห็นสาขาตัวเองเท่านั้น
 */
const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: apiMock, getErrorMessage: (e: unknown) => (e as Error)?.message ?? String(e) }));
const authMock = vi.hoisted(() => ({ user: { id: 'u-owner', role: 'OWNER', branchId: null as string | null } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: authMock.user }) }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));
const excelMock = vi.hoisted(() => ({ exportToExcel: vi.fn(async () => undefined) }));
vi.mock('@/utils/excel.util', () => excelMock);

const BRANCHES = [{ id: 'br1', name: 'ลพบุรี' }, { id: 'br2', name: 'สระบุรี' }];
const RULES = { workStart: '10:00', workEnd: '19:00', lateGraceMinutes: 15 };
const row = (o: Record<string, unknown>) => ({ userId: 'u', nickname: 'x', name: 'x', role: 'SALES', hasPin: true, visiting: false, dayId: 'd-' + o.userId, dayKind: 'WORK', status: 'NOT_IN', clockIn: null, clockOut: null, lateMinutes: 0, earlyLeaveMinutes: 0, otHours: 0, flags: [], clockInPunchId: null, clockOutPunchId: null, note: null, ...o });
const TODAY = {
  date: '2026-10-27',
  rules: RULES,
  rows: [
    row({ userId: 'u1', nickname: 'นุ๊ก', name: 'วรรณา ส.', status: 'ON_TIME', clockIn: '2026-10-27T03:02:00.000Z', clockInPunchId: 'p1' }),
    row({ userId: 'u2', nickname: 'เอก', name: 'เอกชัย ร.', role: 'BRANCH_MANAGER', status: 'LATE', clockIn: '2026-10-27T03:16:00.000Z', lateMinutes: 16 }),
    row({ userId: 'u3', nickname: 'มิ้นท์', name: 'สุมิตรา พ.', status: 'NOT_IN' }),
    row({ userId: 'u4', nickname: 'ต้น', name: 'ธนากร ว.', status: 'DAY_OFF', dayKind: 'DAY_OFF' }),
    row({ userId: 'u5', nickname: 'แนน', name: 'อรทัย บ.', status: 'MISSING_OUT', clockIn: '2026-10-27T03:01:00.000Z', flags: ['MISSING_OUT'] }),
  ],
  kpi: { staff: 5, present: 3, onTime: 2, late: 1, absentSoFar: 1, off: 1, leave: 0, flagged: 1 },
};
const cell = (o: Record<string, unknown>) => ({ dayId: 'd', dayKind: 'WORK', status: 'NONE', clockIn: null, clockOut: null, lateMinutes: 0, otHours: 0, flags: [], clockInPunchId: null, clockOutPunchId: null, ...o });
const MONTH = {
  month: '2026-10',
  days: Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`),
  rows: [
    { userId: 'u1', nickname: 'นุ๊ก', name: 'วรรณา ส.', role: 'SALES', hasPin: true, visiting: false, cells: { '2026-10-20': cell({ status: 'ON_TIME', clockIn: 'x', otHours: 2 }), '2026-10-21': cell({ status: 'LATE', clockIn: 'x', lateMinutes: 8 }), '2026-10-22': cell({ status: 'DAY_OFF', dayKind: 'DAY_OFF' }), '2026-10-24': cell({ status: 'ABSENT' }) }, summary: { workDays: 22, lateCount: 1, lateMinutes: 8, absent: 1, leave: 0, otHours: 3.5 } },
  ],
};

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><AttendancePage /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.user = { id: 'u-owner', role: 'OWNER', branchId: null };
  apiMock.get.mockImplementation(async (path: string) => {
    if (path === '/branches') return { data: BRANCHES };
    if (path === '/attendance/today') return { data: TODAY };
    if (path === '/attendance/month') return { data: MONTH };
    return { data: null };
  });
  apiMock.patch.mockResolvedValue({ data: { id: 'd-u5' } });
  apiMock.put.mockResolvedValue({ data: { updated: 2 } });
});

describe('AttendancePage', () => {
  it('A1 today tab: kpi + rows with icon+label status chips, visiting/flags shown', async () => {
    wrap();
    await screen.findByText('วรรณา ส.');
    expect(apiMock.get).toHaveBeenCalledWith('/attendance/today', { params: { branchId: 'br1', date: undefined } });
    const table = screen.getByRole('table', { name: /รายการวันนี้/ });
    expect(within(table).getAllByText('ตรงเวลา').length).toBeGreaterThan(0);
    expect(within(table).getByText('สาย 16 นาที')).toBeInTheDocument();
    expect(within(table).getByText('ยังไม่มา')).toBeInTheDocument();
    expect(within(table).getByText('วันหยุด')).toBeInTheDocument();
    expect(within(table).getByText('ไม่ได้ตอกออก')).toBeInTheDocument();
    const kpi = screen.getByRole('list', { name: /สรุปวันนี้/ });
    expect(within(kpi).getByText('มาแล้ว').parentElement).toHaveTextContent('3');
    expect(within(kpi).getByText('สาย').parentElement).toHaveTextContent('1');
    // สถานะทุกชิปมีไอคอน (svg) กำกับ ไม่ใช่สีอย่างเดียว
    const chip = screen.getByText('สาย 16 นาที').closest('span');
    expect(chip?.querySelector('svg')).not.toBeNull();
  });

  it('A2 month tab: per-day cells and summary columns from GET /attendance/month', async () => {
    wrap();
    await screen.findByText('วรรณา ส.');
    fireEvent.click(screen.getByRole('tab', { name: /รายเดือน/ }));
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/attendance/month', { params: { branchId: 'br1', month: expect.stringMatching(/^\d{4}-\d{2}$/) } }));
    await screen.findByText('3.5');
    const table = screen.getByRole('table', { name: /รายเดือน/ });
    expect(within(table).getAllByRole('columnheader').length).toBeGreaterThan(31);
    expect(within(table).getByText('22')).toBeInTheDocument(); // วันทำงาน
    expect(within(table).getByTitle(/24 ต.ค. · ขาด/)).toBeInTheDocument();
  });

  it('A3 correction dialog requires a reason ≥ 10 chars and PATCHes /attendance/days/:id', async () => {
    wrap();
    await screen.findByText('อรทัย บ.');
    const rowEl = screen.getByText('อรทัย บ.').closest('tr')!;
    fireEvent.click(within(rowEl).getByRole('button', { name: /แก้ไข/ }));
    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: /บันทึกการแก้ไข/ });
    expect(save).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/ออกงาน/), { target: { value: '20:30' } });
    fireEvent.change(within(dialog).getByLabelText(/เหตุผล/), { target: { value: 'สั้น' } });
    expect(save).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/เหตุผล/), { target: { value: 'ลืมตอกออก มีลูกค้าทำสัญญาถึงสองทุ่มครึ่ง' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith('/attendance/days/d-u5', expect.objectContaining({ clockOut: expect.stringMatching(/^2026-10-27T13:30:00/), reason: expect.stringContaining('ลืมตอกออก') })));
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('A4 schedule tab cycles a cell ทำงาน→หยุด→ลาป่วย and PUTs /attendance/day-kinds on save', async () => {
    wrap();
    await screen.findByText('วรรณา ส.');
    fireEvent.click(screen.getByRole('tab', { name: /ตารางหยุด/ }));
    const grid = await screen.findByRole('table', { name: /ตารางหยุด/ });
    const firstRow = within(grid).getAllByRole('row')[1];
    const cellBtn = within(firstRow).getAllByRole('button')[0];
    expect(cellBtn).toHaveTextContent('ทำงาน');
    fireEvent.click(cellBtn);
    expect(cellBtn).toHaveTextContent('หยุด');
    fireEvent.click(cellBtn);
    expect(cellBtn).toHaveTextContent('ลาป่วย');
    fireEvent.click(screen.getByRole('button', { name: /บันทึกตาราง/ }));
    await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith('/attendance/day-kinds', expect.objectContaining({ branchId: 'br1', entries: [expect.objectContaining({ userId: 'u1', dayKind: 'LEAVE_SICK', date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })] })));
  });

  it('A5 export button calls exportToExcel with the summary columns', async () => {
    wrap();
    await screen.findByText('วรรณา ส.');
    fireEvent.click(screen.getByRole('tab', { name: /รายเดือน/ }));
    await screen.findByText('3.5');
    fireEvent.click(screen.getByRole('button', { name: /ส่งออก Excel/ }));
    await waitFor(() => expect(excelMock.exportToExcel).toHaveBeenCalledWith(expect.objectContaining({ columns: expect.arrayContaining([expect.objectContaining({ header: 'OT (ชม.)', key: 'otHours' })]), data: [expect.objectContaining({ name: 'วรรณา ส.', otHours: 3.5, workDays: 22 })] })));
  });

  it('A6 a branch manager sees only their own branch (no branch picker) and their own rows cannot be edited', async () => {
    authMock.user = { id: 'u2', role: 'BRANCH_MANAGER', branchId: 'br2' };
    wrap();
    await screen.findByText('วรรณา ส.');
    expect(apiMock.get).toHaveBeenCalledWith('/attendance/today', { params: { branchId: 'br2', date: undefined } });
    expect(screen.queryByLabelText(/^สาขา$/)).not.toBeInTheDocument();
    const own = screen.getByText('เอกชัย ร.').closest('tr')!;
    expect(within(own).queryByRole('button', { name: /แก้ไข/ })).not.toBeInTheDocument();
  });
});
