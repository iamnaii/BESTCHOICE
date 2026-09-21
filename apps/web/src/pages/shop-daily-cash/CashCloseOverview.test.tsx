import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CashCloseOverview from './CashCloseOverview';
import type { CashClose, CashCloseDayState, CashCloseOverviewResponse, CashCloseOverviewRow, CashHolding } from './cash-close';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: { get: mocks.get, post: mocks.post }, getErrorMessage: (error: Error) => error.message }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const close = (over: Partial<CashClose> = {}): CashClose => ({
  id: 'cl-1', branchId: 'br-rs', branchName: 'รังสิต', status: 'PENDING_CONFIRM', attemptNo: 1, periodStart: null,
  countedAt: '2026-09-21T13:15:00.000Z', floatAmount: 2000, cashIn: 4300, cashOut: 0, expectedAmount: 6300, countedAmount: 6300,
  varianceAmount: 0, varianceReason: null, sendAmount: 4300, countedBy: { id: 'u-wichai', name: 'วิชัย' },
  receivedAmount: null, receiveVariance: null, receiveNote: null, destination: null, confirmedBy: null, confirmedAt: null,
  sentBackBy: null, sentBackAt: null, sentBackReason: null, journalPosted: false,
  depositReference: null, hasDepositSlip: false, moneyState: 'AWAITING_CONFIRM', ...over,
});

const row = (over: Partial<CashCloseOverviewRow>): CashCloseOverviewRow => ({
  branchId: 'br-x', branchName: 'สาขา', state: 'NO_CASH', close: null, closeCount: 0, dayCashIn: 0, dayCashOut: 0, lastCashInAt: null,
  round: null, canConfirm: false, ...over,
});

const holding = (over: Partial<CashHolding> = {}): CashHolding => ({
  branchId: 'br-rs', branchName: 'รังสิต', source: 'BRANCH_SAFE', sourceLabel: 'ตู้เซฟสาขา', reachedCompany: false, outstanding: 18200,
  closeCount: 3, oldestConfirmedAt: '2026-09-17T13:00:00.000Z',
  openCloses: [{ id: 'a', confirmedAt: '2026-09-17T13:00:00.000Z', outstanding: 7100 }, { id: 'b', confirmedAt: '2026-09-18T13:00:00.000Z', outstanding: 5600 },
    { id: 'c', confirmedAt: '2026-09-19T13:00:00.000Z', outstanding: 5500 }],
  canDeposit: true, ...over,
});

const dates = Array.from({ length: 14 }, (_, index) => `2026-09-${String(8 + index).padStart(2, '0')}`);
const cells = (last: CashCloseDayState[]): CashCloseDayState[] => [...Array<CashCloseDayState>(14 - last.length).fill('REACHED'), ...last];

const overview = (over: Partial<CashCloseOverviewResponse> = {}): CashCloseOverviewResponse => ({
  date: '2026-09-21', today: '2026-09-21', asOf: '2026-09-21T14:00:00.000Z', viewerId: 'u-owner', viewerRole: 'OWNER',
  rows: [
    row({ branchId: 'br-lp', branchName: 'ลาดพร้าว', state: 'REACHED', closeCount: 1,
      close: close({ id: 'cl-lp', branchId: 'br-lp', branchName: 'ลาดพร้าว', status: 'CONFIRMED', expectedAmount: 12710, countedAmount: 12510, varianceAmount: -200,
        sendAmount: 10510, receivedAmount: 10500, destination: 'BANK_DEPOSIT', moneyState: 'REACHED', hasDepositSlip: true, depositReference: '2026092120521187',
        countedBy: { id: 'u-thana', name: 'ธนา' }, confirmedBy: { id: 'u-sur', name: 'สุรชัย' }, confirmedAt: '2026-09-21T13:52:00.000Z' }) }),
    row({ branchId: 'br-rs', branchName: 'รังสิต', state: 'AWAITING_CONFIRM', closeCount: 1, close: close(), canConfirm: true }),
    row({ branchId: 'br-bn', branchName: 'บางนา', state: 'NOT_COUNTED', dayCashIn: 6400, lastCashInAt: '2026-09-21T12:40:00.000Z',
      round: { floatAmount: 2000, cashIn: 6400, cashOut: 0, expectedAmount: 8400, periodStart: '2026-09-20T13:00:00.000Z' } }),
    row({ branchId: 'br-dm', branchName: 'ดอนเมือง', state: 'NO_CASH', round: { floatAmount: 2000, cashIn: 0, cashOut: 0, expectedAmount: 2000, periodStart: null } }),
  ],
  summary: { reached: 1, atBranch: 0, awaitingConfirm: 1, notCounted: 1, noCash: 1 },
  strip: { dates, rows: [
    { branchId: 'br-lp', branchName: 'ลาดพร้าว', cells: cells(['REACHED']) },
    { branchId: 'br-bn', branchName: 'บางนา', cells: cells(['MISSED', 'NOT_COUNTED']) },
  ] },
  holdings: [holding(), holding({ source: 'OWNER_HOLD', sourceLabel: 'เจ้าของเก็บไว้', reachedCompany: true, outstanding: 9000, closeCount: 1 })],
  ...over,
});

function renderOverview(response: CashCloseOverviewResponse, props: Partial<React.ComponentProps<typeof CashCloseOverview>> = {}) {
  mocks.get.mockResolvedValue({ data: response });
  const onOpen = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><CashCloseOverview date="2026-09-21" branchId="" showTable onOpen={onOpen} {...props} /></QueryClientProvider>);
  return { onOpen };
}

beforeEach(() => vi.clearAllMocks());

describe('CashCloseOverview — มุมมองเจ้าของ (กระดาน 10)', () => {
  it('หนึ่งแถวต่อสาขา: ถึงบริษัทแล้ว / รอยืนยันรับเงิน (มีปุ่มยืนยันในแถว) / ยังไม่นับ / ไม่มีเงินสด', async () => {
    renderOverview(overview());
    const table = await screen.findByRole('table');
    const rowOf = (name: string) => within(table).getByText(name).closest('tr')!;
    expect(within(rowOf('ลาดพร้าว')).getByText('ถึงบริษัทแล้ว')).toBeInTheDocument();
    expect(within(rowOf('ลาดพร้าว')).getByText('10,500.00')).toBeInTheDocument();
    expect(within(rowOf('ลาดพร้าว')).getByText('ขาด 200.00')).toBeInTheDocument();
    expect(within(rowOf('ลาดพร้าว')).getByRole('button', { name: 'มีสลิป' })).toBeInTheDocument();
    expect(within(rowOf('รังสิต')).getByText('แจ้งส่ง 4,300.00')).toBeInTheDocument();
    expect(within(rowOf('รังสิต')).getByRole('button', { name: 'ยืนยันรับเงิน' })).toBeInTheDocument();
    expect(within(rowOf('บางนา')).getByText('ยังไม่นับ')).toBeInTheDocument();
    expect(within(rowOf('บางนา')).getByText('8,400.00')).toBeInTheDocument();
    expect(within(rowOf('บางนา')).getByText(/มีเงินสดรับ 6,400.00 ตั้งแต่ปิดยอดครั้งก่อน/)).toBeInTheDocument();
    expect(within(rowOf('ดอนเมือง')).getByText('ไม่มีเงินสด')).toBeInTheDocument();
    expect(within(rowOf('ดอนเมือง')).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/ถึงบริษัทแล้ว 1 สาขา · ยังอยู่ที่สาขา 0 · รอยืนยันรับเงิน 1 · ยังไม่นับ 1 · ไม่มีเงินสด 1/)).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith('/shop-tenders/cash-close/overview', { params: { date: '2026-09-21', branchId: undefined } });
  });

  it('ปุ่มยืนยันรับเงินในแถวเปิดกล่องยืนยันของการปิดยอดครั้งนั้น · "เปิดสาขานี้" พาไปสาขานั้น', async () => {
    const { onOpen } = renderOverview(overview());
    const table = await screen.findByRole('table');
    await userEvent.click(within(table).getByRole('button', { name: 'ยืนยันรับเงิน' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/รังสิต · นับโดย วิชัย/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/เงินที่รับมาจริง/)).toHaveValue('4,300.00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await userEvent.click(within(table).getByRole('button', { name: 'เปิดสาขานี้' }));
    expect(onOpen).toHaveBeenCalledWith('br-bn', '2026-09-21');
  });

  it('แถบ 14 วัน: ช่องละวันต่อสาขา กดแล้วเปิดวันนั้นของสาขานั้น', async () => {
    const { onOpen } = renderOverview(overview());
    const missed = await screen.findByRole('button', { name: /บางนา 20 ก\.ย\. มีเงินสดแต่ไม่ปิดยอด/ });
    expect(screen.getAllByRole('button', { name: /^บางนา \d+ ก\.ย\./ })).toHaveLength(14);
    expect(screen.getByRole('button', { name: /บางนา 21 ก\.ย\. ยังไม่นับ/ })).toBeInTheDocument();
    await userEvent.click(missed);
    expect(onOpen).toHaveBeenCalledWith('br-bn', '2026-09-20');
  });

  it('เลือกสาขาเดียว: ไม่แสดงตาราง (หน้าแสดงกล่องปิดยอดของสาขาแทน) แต่ยังมีแถบ 14 วันและเงินที่ยังไม่ถึงบริษัท', async () => {
    renderOverview(overview(), { branchId: 'br-rs', showTable: false });
    expect(await screen.findByText(/ปิดยอดครบทุกวันไหม/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith('/shop-tenders/cash-close/overview', { params: { date: '2026-09-21', branchId: 'br-rs' } });
  });

  it('เงินที่ยังไม่ถึงบริษัท → บันทึกนำฝาก: ห้ามเกินยอดค้าง · ต้องมีสลิป + เลขอ้างอิง → ส่งเป็น multipart', async () => {
    mocks.post.mockResolvedValue({ data: {} });
    renderOverview(overview());
    const box = await screen.findByRole('region', { name: 'เงินที่ยังไม่ถึงบริษัท' });
    expect(within(box).getByText(/รวม 18,200.00 ฿/)).toBeInTheDocument();
    expect(within(box).getByText(/จากการปิดยอด 3 ครั้ง · เก่าสุดค้างมา \d+ วัน/)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'เงินที่เจ้าของเก็บไว้' })).getByText(/รวม 9,000.00 ฿/)).toBeInTheDocument();

    await userEvent.click(within(box).getByRole('button', { name: 'บันทึกนำฝาก' }));
    const dialog = await screen.findByRole('dialog');
    const amount = within(dialog).getByLabelText(/ยอดที่นำฝากครั้งนี้/);
    expect(amount).toHaveValue('18,200.00');
    const save = within(dialog).getByRole('button', { name: 'บันทึกนำฝาก' });
    expect(save).toBeDisabled();
    const slip = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'slip.jpg', { type: 'image/jpeg' });
    await userEvent.upload(within(dialog).getByLabelText(/^รูปสลิปฝากเงิน/), slip);
    await userEvent.type(within(dialog).getByLabelText(/เลขอ้างอิงในสลิป/), 'DEP-20260921');
    expect(save).toBeEnabled();
    await userEvent.clear(amount); await userEvent.type(amount, '20000');
    expect(within(dialog).getByText(/ยอดนำฝากเกินเงินที่ยังไม่ได้นำฝาก/)).toBeInTheDocument();
    expect(save).toBeDisabled();
    await userEvent.clear(amount); await userEvent.type(amount, '10000');
    await userEvent.click(save);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    const [path, form] = mocks.post.mock.calls[0] as [string, FormData];
    expect(path).toBe('/shop-tenders/cash-deposits');
    expect(Object.fromEntries([...form.entries()].filter(([key]) => key !== 'file')))
      .toEqual({ branchId: 'br-rs', source: 'BRANCH_SAFE', amount: '10000.00', reference: 'DEP-20260921' });
    expect(form.get('file')).toBe(slip);
  });

  it('ผู้ที่ไม่มีสิทธิ์นำฝากเห็นยอดแต่ไม่เห็นปุ่ม', async () => {
    renderOverview(overview({ holdings: [holding({ source: 'OWNER_HOLD', sourceLabel: 'เจ้าของเก็บไว้', reachedCompany: true, canDeposit: false })] }));
    const box = await screen.findByRole('region', { name: 'เงินที่เจ้าของเก็บไว้' });
    expect(within(box).queryByRole('button', { name: 'บันทึกนำฝาก' })).not.toBeInTheDocument();
    expect(within(box).getByText('รอเจ้าของหรือผู้จัดการการเงินบันทึกนำฝาก')).toBeInTheDocument();
  });
});
