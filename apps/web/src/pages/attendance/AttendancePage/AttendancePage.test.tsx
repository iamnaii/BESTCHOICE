import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AttendancePage from './index';

/**
 * ก้อน 10 D3 Task 9 — เมนู ลงเวลา (mockup บอร์ด 3–4): วันนี้ (kpi + สถานะไอคอน+คำ) · รายเดือน (ตารางคน × วัน + สรุป + Excel) ·
 * ตารางหยุด/ลา (กดสลับ → บันทึก) · แก้ไขรายวันพร้อมเหตุผล · ผจก.เห็นสาขาตัวเองเท่านั้น
 */
const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: apiMock, getErrorMessage: (e: unknown) => (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? (e as Error)?.message ?? String(e) }));
const permMock = vi.hoisted(() => ({ cancel: false }));
vi.mock('@/hooks/useAccountingPermissions', () => ({ useAccountingPermissions: () => ({ can: (k: string) => k === 'EXPENSE_CANCEL' && permMock.cancel, isError: false, isPending: false, refetch: vi.fn() }) }));
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

function wrap(entry = '/attendance') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[entry]}><AttendancePage /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.user = { id: 'u-owner', role: 'OWNER', branchId: null };
  permMock.cancel = false;
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
    const cells = within(firstRow).getAllByRole('button');
    const cellBtn = cells[cells.length - 1]; // วันอาทิตย์ของสัปดาห์นี้ — ไม่มีทางเป็นวันที่ผ่านไปแล้ว
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
  it('A7 owner clears the DEVICE_CONFLICT flag from the correction dialog (POST clear-conflict)', async () => {
    const conflicted = { ...TODAY, rows: TODAY.rows.map((r) => (r.userId === 'u1' ? { ...r, flags: ['DEVICE_CONFLICT'] } : r)) };
    apiMock.get.mockImplementation(async (path: string) => ({ data: path === '/branches' ? BRANCHES : path === '/attendance/today' ? conflicted : null }));
    apiMock.post.mockResolvedValue({ data: { id: 'd-u1' } });
    wrap();
    await screen.findByText('วรรณา ส.');
    fireEvent.click(within(screen.getByText('วรรณา ส.').closest('tr')!).getByRole('button', { name: /แก้ไข/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /ตรวจแล้ว ล้างธง/ }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/attendance/days/d-u1/clear-conflict'));
  });

  it('A8 a branch manager editing a conflict-flagged row sees the notice but no clear button', async () => {
    authMock.user = { id: 'u2', role: 'BRANCH_MANAGER', branchId: 'br2' };
    const conflicted = { ...TODAY, rows: TODAY.rows.map((r) => (r.userId === 'u1' ? { ...r, flags: ['DEVICE_CONFLICT'] } : r)) };
    apiMock.get.mockImplementation(async (path: string) => ({ data: path === '/attendance/today' ? conflicted : null }));
    wrap();
    await screen.findByText('วรรณา ส.');
    fireEvent.click(within(screen.getByText('วรรณา ส.').closest('tr')!).getByRole('button', { name: /แก้ไข/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/เจ้าของต้องตรวจ/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /ตรวจแล้ว ล้างธง/ })).not.toBeInTheDocument();
  });
  it('A9 schedule: days already past are locked (after-the-fact leave goes through แก้ไข with a reason) — รีวิว I2', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T05:00:00.000Z')); // พุธ 28 ต.ค. 12:00 ไทย
    try {
      wrap();
      await screen.findByText('วรรณา ส.');
      fireEvent.click(screen.getByRole('tab', { name: /ตารางหยุด/ }));
      const grid = await screen.findByRole('table', { name: /ตารางหยุด/ });
      const row = within(grid).getAllByRole('row')[1];
      const cells = within(row).getAllByRole('button');
      expect(cells[0]).toBeDisabled(); // จ 26
      expect(cells[1]).toBeDisabled(); // อ 27
      expect(cells[2]).toBeEnabled(); // พ 28 (วันนี้)
      expect(screen.getByText(/ผ่านไปแล้ว.*แก้ไข/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('A10 correction dialog can clear the clock-in and clock-out (owner marks a fraudulent punch as not present) → PATCH clockIn null — รีวิว I9', async () => {
    wrap();
    await screen.findByText('วรรณา ส.');
    fireEvent.click(within(screen.getByText('วรรณา ส.').closest('tr')!).getByRole('button', { name: /แก้ไข/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/เข้างาน/), { target: { value: '' } });
    expect(within(dialog).getByText(/ถือว่าไม่ได้มาทำงาน/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/เหตุผล/), { target: { value: 'ตรวจรูปแล้ว ไม่ใช่ตัวพนักงาน ตอกแทนกัน' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /บันทึกการแก้ไข/ }));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith('/attendance/days/d-u1', expect.objectContaining({ clockIn: null })));
  });
  it('A11 today: staff without a PIN show a "ยังไม่มีรหัสตอกบัตร" chip with an icon; the conflict flag uses the danger style unlike harmless flags (รีวิว minor)', async () => {
    const custom = { ...TODAY, rows: [
      row({ userId: 'u7', nickname: 'ใหม่', name: 'พนักงานใหม่', hasPin: false, status: 'NO_PIN' }),
      row({ userId: 'u1', nickname: 'นุ๊ก', name: 'วรรณา ส.', status: 'ON_TIME', clockIn: '2026-10-27T03:02:00.000Z', flags: ['DEVICE_CONFLICT', 'NO_PHOTO'] }),
    ] };
    apiMock.get.mockImplementation(async (path: string) => ({ data: path === '/branches' ? BRANCHES : path === '/attendance/today' ? custom : null }));
    wrap();
    await screen.findByText('พนักงานใหม่');
    const table = screen.getByRole('table', { name: /รายการวันนี้/ });
    const chip = within(table).getByText('ยังไม่มีรหัสตอกบัตร').closest('span');
    expect(chip?.querySelector('svg')).not.toBeNull();
    expect(within(table).getByText('เครื่องถูกใช้ซ้อน').closest('span')?.className).toContain('destructive');
    expect(within(table).getByText('ไม่มีรูป').closest('span')?.className).not.toContain('destructive');
  });

  it('A12 month: the legend shows the same icons as the cells, and "วันที่ต้องตรวจ" lists flagged days with a button that opens that day (รีวิว minor)', async () => {
    const flaggedMonth = { ...MONTH, rows: [{ ...MONTH.rows[0], cells: { ...MONTH.rows[0].cells, '2026-10-23': cell({ status: 'ON_TIME', clockIn: 'x', flags: ['DEVICE_CONFLICT'] }) } }] };
    apiMock.get.mockImplementation(async (path: string) => ({ data: path === '/branches' ? BRANCHES : path === '/attendance/today' ? TODAY : path === '/attendance/month' ? flaggedMonth : null }));
    wrap();
    await screen.findByText('วรรณา ส.');
    fireEvent.click(screen.getByRole('tab', { name: /รายเดือน/ }));
    const legend = await screen.findByRole('list', { name: /สัญลักษณ์/ });
    for (const label of ['ตรงเวลา', 'ขาด', 'ลา', 'วันหยุด']) expect(within(legend).getByText(label).closest('li')?.querySelector('svg')).not.toBeNull();
    const review = await screen.findByRole('list', { name: /วันที่ต้องตรวจ/ });
    expect(within(review).getByText(/23 ต.ค./)).toBeInTheDocument();
    fireEvent.click(within(review).getByRole('button', { name: /เปิดวันนั้น/ }));
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/attendance/today', { params: { branchId: 'br1', date: '2026-10-23' } }));
    expect(screen.getByRole('tab', { name: /วันนี้/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('A13 correction dialog: an OUT time earlier than the IN time means after midnight (next day) — PATCH carries the next calendar day (รีวิว minor)', async () => {
    const late = { ...TODAY, rows: [row({ userId: 'u1', nickname: 'นุ๊ก', name: 'วรรณา ส.', status: 'MISSING_OUT', clockIn: '2026-10-27T16:50:00.000Z', flags: ['MISSING_OUT'] })] };
    apiMock.get.mockImplementation(async (path: string) => ({ data: path === '/branches' ? BRANCHES : path === '/attendance/today' ? late : null }));
    wrap();
    await screen.findByText('วรรณา ส.');
    fireEvent.click(within(screen.getByText('วรรณา ส.').closest('tr')!).getByRole('button', { name: /แก้ไข/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/ออกงาน/), { target: { value: '00:20' } });
    expect(within(dialog).getByText(/วันถัดไป/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/เหตุผล/), { target: { value: 'ปิดร้านดึก ลูกค้าทำสัญญาเสร็จหลังเที่ยงคืน' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /บันทึกการแก้ไข/ }));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith('/attendance/days/d-u1', expect.objectContaining({ clockOut: '2026-10-27T17:20:00.000Z' })));
  });
  it('A14 a branch manager gets no แก้ไข on their own employee\'s day recorded at another branch, with a note instead of a dead-end 403 (รีวิวรอบ 2 C9)', async () => {
    authMock.user = { id: 'u-bm', role: 'BRANCH_MANAGER', branchId: 'br2' };
    const custom = { ...TODAY, rows: [row({ userId: 'u1', nickname: 'นุ๊ก', name: 'วรรณา ส.', status: 'ON_TIME', clockIn: '2026-10-27T03:02:00.000Z', dayId: 'd-u1', dayBranchId: 'br1' })] };
    apiMock.get.mockImplementation(async (path: string) => ({ data: path === '/attendance/today' ? custom : null }));
    wrap();
    await screen.findByText('วรรณา ส.');
    const tr = screen.getByText('วรรณา ส.').closest('tr')!;
    expect(within(tr).queryByRole('button', { name: /แก้ไข/ })).not.toBeInTheDocument();
    expect(within(tr).getByText(/ตอกที่สาขาอื่น/)).toBeInTheDocument();
  });

  it('A15 the no-PIN hint tells a branch manager to ask the owner (the user page is owner-only) — รีวิวรอบ 2 C14', async () => {
    authMock.user = { id: 'u-bm', role: 'BRANCH_MANAGER', branchId: 'br2' };
    const custom = { ...TODAY, rows: [row({ userId: 'u7', nickname: 'ใหม่', name: 'พนักงานใหม่', hasPin: false, status: 'NO_PIN' })] };
    apiMock.get.mockImplementation(async (path: string) => ({ data: path === '/attendance/today' ? custom : null }));
    wrap();
    await screen.findByText('พนักงานใหม่');
    expect(screen.getByText(/ให้เจ้าของตั้งรหัส/)).toBeInTheDocument();
    expect(screen.queryByText(/หน้าผู้ใช้/)).not.toBeInTheDocument();
  });

  // ---- Payroll D4 Task 9: เดือนที่จ่ายเงินเดือนแล้ว = read-only + deep link ----
  const PAID_MSG = 'เดือนนี้จ่ายเงินเดือนแล้ว (ใบ PR-20261031-0001) — แก้ไม่ได้ ถ้าต้องปรับ ให้ใส่แถว "รายการปรับปรุงงวดก่อน" (จ่ายเพิ่ม) หรือรายการหัก (หักคืน) ในใบเงินเดือนงวดถัดไป';
  const paidToday = (flags: string[] = []) => ({ ...TODAY, rows: TODAY.rows.map((r) => (r.userId === 'u1' ? { ...r, flags, paidDocumentNumber: 'PR-20261031-0001' } : { ...r, paidDocumentNumber: null })) });
  const mockToday = (today: unknown, month: unknown = MONTH) =>
    apiMock.get.mockImplementation(async (path: string) => ({ data: path === '/branches' ? BRANCHES : path === '/attendance/today' ? today : path === '/attendance/month' ? month : null }));

  it('P1 today: a paid-month row shows the lock chip (icon + words), a banner, and a disabled แก้ไข whose reason is linked by aria-describedby', async () => {
    mockToday(paidToday());
    wrap();
    await screen.findByText('วรรณา ส.');
    expect(screen.getByRole('status', { name: /เดือนที่จ่ายเงินเดือนแล้ว/ })).toHaveTextContent('PR-20261031-0001');
    const tr = screen.getByText('วรรณา ส.').closest('tr')!;
    const chip = within(tr).getByText('จ่ายเงินเดือนแล้ว').parentElement!;
    expect(chip.querySelector('svg')).not.toBeNull();
    const btn = within(tr).getByRole('button', { name: /แก้ไข/ });
    expect(btn).toBeDisabled();
    const reason = document.getElementById(btn.getAttribute('aria-describedby')!);
    expect(reason).toHaveTextContent('PR-20261031-0001');
    // แถวอื่นที่ไม่ได้อยู่ในใบ ยังแก้ได้
    expect(within(screen.getByText('อรทัย บ.').closest('tr')!).getByRole('button', { name: /แก้ไข/ })).toBeEnabled();
  });

  it('P2 dialog on a paid row: save is disabled with the ATTENDANCE_PAID text, but the owner can still clear the DEVICE_CONFLICT flag', async () => {
    mockToday(paidToday(['DEVICE_CONFLICT']));
    apiMock.post.mockResolvedValue({ data: { id: 'd-u1' } });
    wrap();
    await screen.findByText('วรรณา ส.');
    fireEvent.click(within(screen.getByText('วรรณา ส.').closest('tr')!).getByRole('button', { name: /แก้ไข/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(PAID_MSG)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/เหตุผล/), { target: { value: 'ตรวจรูปแล้ว ไม่ใช่ตัวพนักงาน ตอกแทนกัน' } });
    for (const c of [within(dialog).getByLabelText(/เข้างาน/), within(dialog).getByLabelText(/ออกงาน/), within(dialog).getByLabelText(/ประเภทวัน/), within(dialog).getByLabelText(/เหตุผล/)]) {
      expect(c).toBeDisabled();
      expect(c).toHaveAttribute('aria-describedby', 'corr-paid');
    }
    const save = within(dialog).getByRole('button', { name: /บันทึกการแก้ไข/ });
    expect(save).toBeDisabled();
    expect(document.getElementById(save.getAttribute('aria-describedby')!)).toHaveTextContent(PAID_MSG);
    const clear = within(dialog).getByRole('button', { name: /ตรวจแล้ว ล้างธง/ });
    expect(clear).toBeEnabled();
    fireEvent.click(clear);
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/attendance/days/d-u1/clear-conflict'));
    expect(apiMock.patch).not.toHaveBeenCalled();
  });

  it('P3 a branch manager cannot clear flags, so a paid + conflict row has a disabled แก้ไข', async () => {
    authMock.user = { id: 'u-bm', role: 'BRANCH_MANAGER', branchId: 'br2' };
    mockToday(paidToday(['DEVICE_CONFLICT']));
    wrap();
    await screen.findByText('วรรณา ส.');
    expect(within(screen.getByText('วรรณา ส.').closest('tr')!).getByRole('button', { name: /แก้ไข/ })).toBeDisabled();
  });

  it('P4 a real 409 ATTENDANCE_PAID (page was stale) toasts the server message, refetches and closes the stale dialog', async () => {
    apiMock.patch.mockRejectedValue(Object.assign(new Error('mock-error-message'), { response: { status: 409, data: { code: 'ATTENDANCE_PAID', documentNumber: 'PR-20261031-0001', message: PAID_MSG } } }));
    wrap();
    await screen.findByText('อรทัย บ.');
    fireEvent.click(within(screen.getByText('อรทัย บ.').closest('tr')!).getByRole('button', { name: /แก้ไข/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/ออกงาน/), { target: { value: '20:30' } });
    fireEvent.change(within(dialog).getByLabelText(/เหตุผล/), { target: { value: 'ลืมตอกออก มีลูกค้าทำสัญญาถึงสองทุ่มครึ่ง' } });
    const todayCalls = () => apiMock.get.mock.calls.filter((c) => c[0] === '/attendance/today').length;
    const before = todayCalls();
    fireEvent.click(within(dialog).getByRole('button', { name: /บันทึกการแก้ไข/ }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(PAID_MSG));
    expect(toastMock.error).not.toHaveBeenCalledWith('mock-error-message');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(todayCalls()).toBeGreaterThan(before));
  });

  it('P5 month tab: paid people carry the lock chip and the banner names the document', async () => {
    mockToday(TODAY, { ...MONTH, rows: [{ ...MONTH.rows[0], paidDocumentNumber: 'PR-20261031-0001' }, { ...MONTH.rows[0], userId: 'u8', nickname: 'ใหม่', name: 'ธนา ใ.', paidDocumentNumber: null }] });
    wrap();
    await screen.findByText('วรรณา ส.');
    fireEvent.click(screen.getByRole('tab', { name: /รายเดือน/ }));
    const table = await screen.findByRole('table', { name: /ตารางรายเดือน/ });
    expect(within(table).getByText('จ่ายเงินเดือนแล้ว').parentElement?.querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('status', { name: /เดือนที่จ่ายเงินเดือนแล้ว/ })).toHaveTextContent('PR-20261031-0001');
    const unpaid = within(table).getByText('ยังไม่อยู่ในใบเงินเดือน — แก้ได้');
    expect(unpaid.querySelector('svg')).not.toBeNull();
    expect(within(table).getAllByText('ยังไม่อยู่ในใบเงินเดือน — แก้ได้')).toHaveLength(1);
  });

  it('P6 schedule tab: day cells of a paid person are disabled with a visible reason (paid text wins over the past-day tooltip)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-20T05:00:00.000Z')); // สัปดาห์ 19–25 ต.ค. = เดือน 2026-10 ทั้งสัปดาห์
      mockToday(TODAY, { ...MONTH, rows: [{ ...MONTH.rows[0], paidDocumentNumber: 'PR-20261031-0001' }] });
      wrap();
      await screen.findByText('วรรณา ส.');
      fireEvent.click(screen.getByRole('tab', { name: /ตารางหยุด/ }));
      const grid = await screen.findByRole('table', { name: /ตารางหยุด/ });
      const cells = within(within(grid).getAllByRole('row')[1]).getAllByRole('button');
      const locked = cells.filter((c) => c.hasAttribute('aria-describedby'));
      expect(locked).toHaveLength(7);
      for (const c of locked) {
        expect(c).toBeDisabled();
        expect(document.getElementById(c.getAttribute('aria-describedby')!)).toHaveTextContent('PR-20261031-0001');
        expect(c.getAttribute('title')).toBe(PAID_MSG);
      }
      expect(screen.getByText(/ยกเว้นเดือนที่จ่ายเงินเดือนแล้ว/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('P7 banner wording follows the role: EXPENSE_CANCEL holders get the board sentence, others are told the owner reverses', async () => {
    mockToday(paidToday());
    permMock.cancel = true;
    const first = wrap();
    await screen.findByText('วรรณา ส.');
    const banner = screen.getByRole('status', { name: /เดือนที่จ่ายเงินเดือนแล้ว/ });
    expect(banner).toHaveTextContent('ถ้ากลับรายการใบเงินเดือน เดือนนี้แก้ได้อีก');
    expect(banner).not.toHaveTextContent('ถ้าเจ้าของกลับรายการ');
    first.unmount();
    permMock.cancel = false;
    wrap();
    await screen.findByText('วรรณา ส.');
    expect(screen.getByRole('status', { name: /เดือนที่จ่ายเงินเดือนแล้ว/ })).toHaveTextContent('ถ้าเจ้าของกลับรายการใบเงินเดือน เดือนนี้แก้ได้อีก');
    // ปล่อยให้เจ้าของยังล้างธงได้ — แบนเนอร์ไม่อ้างว่าล้างไม่ได้
    expect(screen.getByRole('status', { name: /เดือนที่จ่ายเงินเดือนแล้ว/ })).toHaveTextContent('ล้างธง');
  });

  it('P8 schedule: a person paid while edits are pending — only their cells are dropped (with a count), the rest stay and save', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-20T05:00:00.000Z'));
      const two = (paid: boolean) => ({ ...MONTH, rows: [{ ...MONTH.rows[0], paidDocumentNumber: paid ? 'PR-20261031-0001' : null }, { ...MONTH.rows[0], userId: 'u9', nickname: 'ต้น', name: 'ธนากร ว.', paidDocumentNumber: null }] });
      mockToday(TODAY, two(false));
      apiMock.put.mockRejectedValue(Object.assign(new Error('x'), { response: { status: 409, data: { code: 'ATTENDANCE_PAID', message: PAID_MSG } } }));
      wrap();
      await screen.findByText('วรรณา ส.');
      fireEvent.click(screen.getByRole('tab', { name: /ตารางหยุด/ }));
      const grid = await screen.findByRole('table', { name: /ตารางหยุด/ });
      const rowsEl = within(grid).getAllByRole('row');
      const u1Cell = within(rowsEl[1]).getAllByRole('button')[1];
      const u9Cell = within(rowsEl[2]).getAllByRole('button')[1];
      fireEvent.click(u1Cell);
      fireEvent.click(u9Cell);
      expect(u1Cell).toHaveTextContent('หยุด');
      mockToday(TODAY, two(true)); // ระหว่างนั้นมีคนลงบัญชีใบเงินเดือนของคนแรก
      fireEvent.click(screen.getByRole('button', { name: /บันทึกตาราง/ }));
      await waitFor(() => expect(toastMock.warning).toHaveBeenCalledWith(expect.stringContaining('1 ช่อง')));
      expect(u1Cell).toBeDisabled();
      expect(u1Cell).toHaveTextContent('ทำงาน');
      expect(u9Cell).toHaveTextContent('หยุด'); // ช่องของคนที่ยังไม่จ่ายยังอยู่
      apiMock.put.mockResolvedValue({ data: { updated: 1 } });
      fireEvent.click(screen.getByRole('button', { name: /บันทึกตาราง/ }));
      await waitFor(() => expect(apiMock.put).toHaveBeenLastCalledWith('/attendance/day-kinds', expect.objectContaining({ entries: [expect.objectContaining({ userId: 'u9', dayKind: 'DAY_OFF' })] })));
      const lastEntries = (apiMock.put.mock.calls.at(-1)![1] as { entries: unknown[] }).entries;
      expect(lastEntries).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('P9 schedule: when the second month of a two-month week fails to load, that month\'s cells are disabled with a visible reason', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-28T05:00:00.000Z')); // สัปดาห์ 26 ต.ค. – 1 พ.ย.
      apiMock.get.mockImplementation(async (path: string, cfg?: { params?: { month?: string } }) => {
        if (path === '/attendance/month' && cfg?.params?.month === '2026-11') throw new Error('boom');
        return { data: path === '/branches' ? BRANCHES : path === '/attendance/today' ? TODAY : path === '/attendance/month' ? MONTH : null };
      });
      wrap();
      await screen.findByText('วรรณา ส.');
      fireEvent.click(screen.getByRole('tab', { name: /ตารางหยุด/ }));
      const grid = await screen.findByRole('table', { name: /ตารางหยุด/ });
      await screen.findByText(/โหลดข้อมูลเดือน.*ไม่สำเร็จ/);
      const nov1 = within(within(grid).getAllByRole('row')[1]).getAllByRole('button')[6];
      expect(nov1).toBeDisabled();
      expect(document.getElementById(nov1.getAttribute('aria-describedby')!)).toHaveTextContent(/จึงแก้ช่องของเดือนนั้นไม่ได้/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('D1 deep link ?tab=today&date=&branchId= opens that day and branch for the owner', async () => {
    wrap('/attendance?tab=today&date=2026-10-23&branchId=br2');
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/attendance/today', { params: { branchId: 'br2', date: '2026-10-23' } }));
    expect(apiMock.get).not.toHaveBeenCalledWith('/attendance/today', { params: { branchId: 'br1', date: '2026-10-23' } });
    expect(screen.getByRole('tab', { name: /วันนี้/ })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByLabelText('สาขา')).toHaveValue('br2');
  });

  it('D2 deep link ?tab=month selects the month tab; unknown tab / bad date / unknown branch fall back to defaults', async () => {
    const { unmount } = wrap('/attendance?tab=month&branchId=br2');
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/attendance/month', { params: { branchId: 'br2', month: expect.any(String) } }));
    expect(screen.getByRole('tab', { name: /รายเดือน/ })).toHaveAttribute('aria-selected', 'true');
    unmount();
    vi.clearAllMocks();
    wrap('/attendance?tab=nope&date=31-10-2026&branchId=zzz');
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/attendance/today', { params: { branchId: 'br1', date: undefined } }));
    expect(screen.getByRole('tab', { name: /วันนี้/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('D5 a deep-link date in the future falls back to today', async () => {
    wrap('/attendance?tab=today&date=2999-01-01');
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/attendance/today', { params: { branchId: 'br1', date: undefined } }));
    expect(apiMock.get).not.toHaveBeenCalledWith('/attendance/today', { params: { branchId: 'br1', date: '2999-01-01' } });
  });

  it('D3 a branch manager always stays on their own branch: branchId param is ignored', async () => {
    authMock.user = { id: 'u-bm', role: 'BRANCH_MANAGER', branchId: 'br2' };
    wrap('/attendance?tab=today&date=2026-10-23&branchId=br1');
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/attendance/today', { params: { branchId: 'br2', date: '2026-10-23' } }));
    expect(apiMock.get).not.toHaveBeenCalledWith('/attendance/today', { params: { branchId: 'br1', date: '2026-10-23' } });
  });

  it('D4 changing the day afterwards does not fight the URL (date param follows the state)', async () => {
    apiMock.get.mockImplementation(async (path: string, cfg?: { params?: { date?: string } }) => ({ data: path === '/branches' ? BRANCHES : path === '/attendance/today' ? { ...TODAY, date: cfg?.params?.date ?? TODAY.date } : null }));
    wrap('/attendance?tab=today&date=2026-10-23&branchId=br1');
    await screen.findByText('วรรณา ส.');
    fireEvent.click(screen.getByRole('button', { name: 'วันถัดไป' }));
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/attendance/today', { params: { branchId: 'br1', date: '2026-10-24' } }));
  });
});
