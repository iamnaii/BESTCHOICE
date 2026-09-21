import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CashDayStrip from './CashDayStrip';
import CashHoldingsCard from './CashHoldingsCard';
import type { CashCloseDayState, CashCloseOverviewResponse, CashHolding } from './cash-close';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: { get: mocks.get, post: mocks.post }, getErrorMessage: (error: Error) => error.message }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const dates = Array.from({ length: 14 }, (_, index) => `2026-09-${String(8 + index).padStart(2, '0')}`);
const cells: CashCloseDayState[] = ['REACHED', 'REACHED', 'NO_CASH', 'REACHED', 'REACHED', 'MISSED', 'NO_CASH', 'REACHED', 'REACHED', 'REACHED', 'REACHED', 'AT_BRANCH', 'REACHED', 'AWAITING_CONFIRM'];

const holding = (over: Partial<CashHolding> = {}): CashHolding => ({
  branchId: 'br-1', branchName: 'ลพบุรี', source: 'BRANCH_SAFE', sourceLabel: 'ตู้เซฟสาขา', reachedCompany: false, outstanding: 8200, closeCount: 1,
  oldestConfirmedAt: '2026-09-19T13:52:00.000Z', openCloses: [{ id: 'c-19', confirmedAt: '2026-09-19T13:52:00.000Z', outstanding: 8200 }], canDeposit: true, ...over,
});

const overview = (over: Partial<CashCloseOverviewResponse> = {}): CashCloseOverviewResponse => ({
  date: '2026-09-21', today: '2026-09-21', asOf: '2026-09-21T13:00:00.000Z', viewerId: 'u-owner', viewerRole: 'OWNER', rows: [],
  summary: { reached: 0, atBranch: 0, awaitingConfirm: 1, notCounted: 0, noCash: 0 },
  strip: { dates, rows: [{ branchId: 'br-1', branchName: 'ลพบุรี', cells }] }, holdings: [holding()], ...over,
});

function renderWith(node: React.ReactNode, response = overview()) {
  mocks.get.mockResolvedValue({ data: response });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => vi.clearAllMocks());

describe('CashDayStrip — แถบ 14 วันเป็นตัวเลือกวัน (mockup กระดาน 15)', () => {
  it('หนึ่งช่องต่อวัน · ชื่อช่องบอกวันที่ + สถานะเป็นข้อความ (ไม่พึ่งสี) · วันที่เลือกอยู่ถูกกดค้าง · กดแล้วเปิดวันนั้น', async () => {
    const onPick = vi.fn();
    renderWith(<CashDayStrip date="2026-09-21" branchId="br-1" onPick={onPick} />);
    const strip = await screen.findByRole('region', { name: 'ส่งยอดครบทุกวันไหม 14 วันล่าสุด' });
    expect(within(strip).getAllByRole('button')).toHaveLength(14);
    expect(within(strip).getByRole('button', { name: '21 ก.ย. ส่งยอดแล้ว รอยืนยันรับเงิน' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(strip).getByText('วันนี้')).toBeInTheDocument();
    const missed = within(strip).getByRole('button', { name: '13 ก.ย. มีเงินสดแต่ไม่ส่งยอด' });
    expect(missed).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(missed);
    expect(onPick).toHaveBeenCalledWith('2026-09-13');
  });

  it('บรรทัดใต้แถบนับจำนวนวันของแต่ละสถานะ (ทำหน้าที่เป็นคำอธิบายไอคอน) — ไม่แสดงสถานะที่ไม่มีวันไหนเป็น', async () => {
    renderWith(<CashDayStrip date="2026-09-21" branchId="br-1" onPick={vi.fn()} />);
    const strip = await screen.findByRole('region', { name: /ส่งยอดครบทุกวันไหม/ });
    const legend = within(strip).getAllByRole('listitem').map((item) => item.textContent);
    expect(legend).toEqual(['ถึงบริษัทแล้ว 9 วัน', 'รอยืนยันรับเงิน 1 วัน', 'ยังอยู่ที่สาขา 1 วัน', 'มีเงินสดแต่ไม่ส่งยอด 1 วัน', 'ไม่มีเงินสด 2 วัน', 'กดวันเพื่อเปิดดูวันนั้น']);
  });
});

describe('CashHoldingsCard — เงินสดที่ยังไม่ได้ฝากธนาคาร + วันที่ต้องตามดู (mockup กระดาน 15)', () => {
  it('แสดงยอดรวม + แหล่งเก็บ (ตู้เซฟสาขา = ยังไม่ถึงบริษัท) + ปุ่มบันทึกนำฝากเปิดหน้าต่างเดิม · วันที่มีเงินสดแต่ไม่ส่งยอดกดเปิดดูได้', async () => {
    const onPick = vi.fn();
    renderWith(<CashHoldingsCard date="2026-09-21" branchId="br-1" onPick={onPick} />);
    const card = await screen.findByRole('complementary', { name: /เงินสดที่ยังไม่ได้ฝากธนาคาร/ });
    expect(within(card).getByText('8,200.00 ฿')).toBeInTheDocument();
    expect(within(card).getByText('ตู้เซฟสาขา')).toBeInTheDocument();
    expect(within(card).getByText('ยังไม่ถึงบริษัท · ตั้งแต่ 19 ก.ย.')).toBeInTheDocument();
    expect(within(card).getByText(/13 ก\.ย\. — มีเงินสดแต่ไม่ส่งยอด/)).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'เปิดดูวันที่ 13 ก.ย.' }));
    expect(onPick).toHaveBeenCalledWith('2026-09-13');
    await userEvent.click(within(card).getByRole('button', { name: 'บันทึกนำฝาก' }));
    expect(within(await screen.findByRole('dialog')).getByLabelText(/ยอดที่นำฝากครั้งนี้/)).toHaveValue('8,200.00');
  });

  it('เจ้าของเก็บไว้ = ถึงบริษัทแล้ว รอฝากธนาคาร · คนที่ไม่มีสิทธิ์นำฝากเห็นยอดและรู้ว่ารอใคร แต่ไม่เห็นปุ่ม', async () => {
    renderWith(<CashHoldingsCard date="2026-09-21" branchId="br-1" onPick={vi.fn()} />, overview({
      holdings: [holding({ canDeposit: false }), holding({ source: 'OWNER_HOLD', sourceLabel: 'เจ้าของเก็บไว้', reachedCompany: true, outstanding: 3000, canDeposit: false })],
    }));
    const card = await screen.findByRole('complementary', { name: /เงินสดที่ยังไม่ได้ฝากธนาคาร/ });
    expect(within(card).getByText('11,200.00 ฿')).toBeInTheDocument();
    expect(within(card).getByText('ถึงบริษัทแล้ว รอฝากธนาคาร · ตั้งแต่ 19 ก.ย.')).toBeInTheDocument();
    expect(within(card).getByText('รอเจ้าของ ผู้จัดการการเงิน หรือผู้จัดการสาขาบันทึกนำฝาก')).toBeInTheDocument();
    expect(within(card).getByText('รอเจ้าของหรือผู้จัดการการเงินบันทึกนำฝาก')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /บันทึกนำฝาก/ })).not.toBeInTheDocument();
  });

  it('ไม่มีเงินค้างและส่งยอดครบ = บอกตรง ๆ ว่าเรียบร้อย (ไม่ปล่อยกล่องว่าง)', async () => {
    renderWith(<CashHoldingsCard date="2026-09-21" branchId="br-1" onPick={vi.fn()} />, overview({
      holdings: [], strip: { dates, rows: [{ branchId: 'br-1', branchName: 'ลพบุรี', cells: cells.map((state) => (state === 'MISSED' ? 'REACHED' : state)) }] },
    }));
    expect(await screen.findByText('ไม่มีเงินค้าง — เงินสดที่รับแล้วฝากธนาคารครบ')).toBeInTheDocument();
    expect(screen.getByText('ส่งยอดครบทุกวันที่มีเงินสด')).toBeInTheDocument();
  });
});
