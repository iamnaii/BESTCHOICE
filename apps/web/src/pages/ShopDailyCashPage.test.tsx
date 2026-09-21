import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ShopDailyCashPage from './ShopDailyCashPage';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: { get: mocks.get, post: vi.fn() }, getErrorMessage: (error: Error) => error.message }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-owner', role: 'OWNER', branchId: null } }) }));
vi.mock('./shop-daily-cash/CashCloseCard', () => ({
  default: ({ branchId }: { branchId: string }) => <div data-testid="close-card">{branchId}</div>,
  cashCloseKey: (branchId: string, date: string) => ['shop-tenders', 'cash-close', 'status', branchId, date],
}));
vi.mock('./shop-daily-cash/CashDayStrip', () => ({
  default: ({ branchId, onPick }: { branchId: string; onPick: (day: string) => void }) => (
    <div>
      <div data-testid="day-strip">{branchId}</div>
      <button type="button" onClick={() => onPick('2026-09-08')}>ช่องวันที่ 8 ของแถบ 14 วัน</button>
    </div>
  ),
}));
vi.mock('./shop-daily-cash/CashHoldingsCard', () => ({
  default: ({ branchId }: { branchId: string }) => <div data-testid="holdings-card">{branchId}</div>,
}));
vi.mock('./shop-daily-cash/CashCloseOverview', () => ({
  default: ({ branchId, showTable, onOpen }: { branchId: string; showTable: boolean; onOpen: (branchId: string, date?: string) => void }) => (
    <div>
      <div data-testid="overview">{`${branchId || 'ALL'}|${showTable}`}</div>
      <button type="button" onClick={() => onOpen('b2', '2026-09-08')}>เปิดสาขารังสิตวันที่ 8</button>
    </div>
  ),
}));

const emptyTotals = { cashIn: '0', transferIn: '0', qrIn: '0', totalIn: '0', cashOut: '0', nonCashOut: '0', totalOut: '0', expectedCashInDrawer: '0', inCount: 0, outCount: 0 };
const summary = (branches: { id: string; name: string }[], over: Record<string, unknown> = {}) => ({
  date: '2026-09-21', scope: 'ALL', branchId: null, branches, totals: emptyTotals,
  byStaff: [], byKind: [], rows: [], duplicateReferences: [], ...over,
});

function renderPage(branches: { id: string; name: string }[], over: Record<string, unknown> = {}) {
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/shop-tenders/daily-summary') return { data: summary(branches, over) };
    return { data: { closes: [], awaitingConfirm: [] } };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><ShopDailyCashPage /></QueryClientProvider></MemoryRouter>);
}

const summaryDates = () => mocks.get.mock.calls.filter(([path]) => path === '/shop-tenders/daily-summary').map(([, config]) => config.params.date as string);

beforeEach(() => vi.clearAllMocks());

describe('ShopDailyCashPage — เจ้าของเปิดหน้ามาต้องเห็นเรื่องปิดยอดทันที', () => {
  it('ร้านสาขาเดียว: เลือกสาขานั้นให้เอง → แถบ 14 วัน + กล่องสถานะ + การ์ดเงินค้างของสาขา (ไม่มีตารางทุกสาขา) · สลับกลับ "ทุกสาขา" ได้', async () => {
    renderPage([{ id: 'branch-001', name: 'คลังสินค้าหลัก' }]);
    expect(await screen.findByTestId('close-card')).toHaveTextContent('branch-001');
    expect(screen.getByTestId('day-strip')).toHaveTextContent('branch-001');
    expect(screen.getByTestId('holdings-card')).toHaveTextContent('branch-001');
    expect(screen.queryByTestId('overview')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('สาขา'), '');
    await waitFor(() => expect(screen.getByTestId('overview')).toHaveTextContent('ALL|true'));
    expect(screen.queryByTestId('close-card')).not.toBeInTheDocument(); // ไม่ถูกบังคับเลือกซ้ำ
    expect(screen.queryByTestId('day-strip')).not.toBeInTheDocument();
  });

  it('หลายสาขา: เปิดมาเป็น "ทุกสาขา" พร้อมตารางสถานะของทุกสาขา · กดเปิดสาขาจากตาราง = ไปกล่องสถานะของสาขานั้นในวันนั้น', async () => {
    renderPage([{ id: 'b1', name: 'ลาดพร้าว' }, { id: 'b2', name: 'รังสิต' }]);
    expect(await screen.findByTestId('overview')).toHaveTextContent('ALL|true');
    expect(screen.queryByTestId('close-card')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'เปิดสาขารังสิตวันที่ 8' }));
    expect(await screen.findByTestId('close-card')).toHaveTextContent('b2');
    expect(summaryDates().at(-1)).toBe('2026-09-08');
  });
});

describe('ShopDailyCashPage — ดูวันย้อนหลังต้องมีทางกลับ', () => {
  it('กดช่องของแถบ 14 วัน → มีแถบบอกว่าย้อนหลัง + ปุ่ม "กลับมาวันนี้" พากลับวันนี้ แล้วแถบหาย', async () => {
    renderPage([{ id: 'branch-001', name: 'ลพบุรี' }]);
    await screen.findByTestId('close-card');
    expect(screen.queryByRole('button', { name: 'กลับมาวันนี้' })).not.toBeInTheDocument();
    const today = summaryDates()[0];
    await userEvent.click(screen.getByRole('button', { name: 'ช่องวันที่ 8 ของแถบ 14 วัน' })); // ทางเดียวกับที่เจ้าของหลงไปวันย้อนหลังบนระบบจริง
    expect(await screen.findByText(/กำลังดูวันที่ 8 ก\.ย\. 2569 \(ย้อนหลัง\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'กลับมาวันนี้' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'กลับมาวันนี้' })).not.toBeInTheDocument());
    expect(summaryDates().at(-1)).toBe(today);
  });

  it('ปุ่มเลื่อนวัน: วันนี้ไปข้างหน้าไม่ได้ · ถอยหนึ่งวันแล้วเดินหน้ากลับมาวันนี้ได้', async () => {
    renderPage([{ id: 'branch-001', name: 'ลพบุรี' }]);
    await screen.findByTestId('close-card');
    const today = summaryDates()[0];
    expect(screen.getByRole('button', { name: 'วันถัดไป' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'วันก่อนหน้า' }));
    await waitFor(() => expect(summaryDates().at(-1)).not.toBe(today));
    expect(new Date(`${today}T00:00:00Z`).getTime() - new Date(`${summaryDates().at(-1)}T00:00:00Z`).getTime()).toBe(86_400_000);
    await userEvent.click(screen.getByRole('button', { name: 'วันถัดไป' }));
    await waitFor(() => expect(summaryDates().at(-1)).toBe(today));
    expect(screen.getByRole('button', { name: 'วันถัดไป' })).toBeDisabled();
  });
});

describe('ShopDailyCashPage — เงินเข้า-ออกของวัน + ตาราง (mockup กระดาน 15)', () => {
  const day = {
    totals: { cashIn: '16500', transferIn: '24900', qrIn: '8000', totalIn: '49400', cashOut: '5790', nonCashOut: '0', totalOut: '5790', expectedCashInDrawer: '10710', inCount: 7, outCount: 2 },
    byKind: [
      { kind: 'CASH_SALE', direction: 'IN', cash: '9500', transfer: '14900', qr: '0', total: '24400', count: 3 },
      { kind: 'TRADE_IN_PAYOUT', direction: 'OUT', cash: '5000', transfer: '0', qr: '0', total: '5000', count: 1 },
    ],
    rows: [
      { id: 'r1', occurredAt: '2026-09-21T03:12:00.000Z', kind: 'CASH_SALE', direction: 'IN', docType: 'sale', docId: 's1', docNumber: 'SL-0001', customerName: null,
        method: 'CASH', reference: null, amount: '9500', seq: 1, seqTotal: 1, actorId: 'u1', actorName: 'ธนา', branchName: 'ลพบุรี', duplicateReference: false },
      { id: 'r2', occurredAt: '2026-09-21T07:25:00.000Z', kind: 'CASH_SALE', direction: 'IN', docType: 'sale', docId: 's4', docNumber: 'SL-0004', customerName: null,
        method: 'BANK_TRANSFER', reference: '2026092114250931', amount: '7450', seq: 1, seqTotal: 1, actorId: 'u1', actorName: 'ธนา', branchName: 'ลพบุรี', duplicateReference: true },
      { id: 'r3', occurredAt: '2026-09-21T08:00:00.000Z', kind: 'CASH_SALE', direction: 'IN', docType: 'sale', docId: 's5', docNumber: 'SL-0005', customerName: null,
        method: 'QR_EWALLET', reference: 'QR12345678', amount: '8000', seq: 1, seqTotal: 1, actorId: 'u1', actorName: 'ธนา', branchName: 'ลพบุรี', duplicateReference: false },
    ],
    duplicateReferences: [{ reference: '2026092114250931', documents: ['SL-0004', 'SL-0006'] }],
  };

  it('แถบเดียว 4 ช่อง: เงินสดสุทธิ / รับโอน / รับ QR / รวมทั้งวัน — ไม่มีการ์ด "เงินสดที่ต้องมีในลิ้นชัก" ซ้ำกับกล่องสถานะอีกแล้ว', async () => {
    renderPage([{ id: 'branch-001', name: 'ลพบุรี' }], day);
    await screen.findByTestId('close-card'); // รอให้เลือกสาขาเดียวให้เองและโหลดรอบสองจบก่อน
    const strip = await screen.findByRole('region', { name: 'เงินเข้า-ออกของวัน' });
    expect(within(strip).getByText('10,710.00 ฿')).toBeInTheDocument();
    expect(within(strip).getByText('24,900.00 ฿')).toBeInTheDocument();
    expect(within(strip).getAllByText('1 รายการ · เข้าบัญชีร้านโดยตรง')).toHaveLength(2); // รับโอน 1 + รับ QR 1 (นับจากรายการรับเข้า)
    expect(within(strip).getByText('รับ 49,400.00 ฿')).toBeInTheDocument();
    expect(within(strip).getByText('รับเข้า 7 รายการ')).toBeInTheDocument();
    expect(screen.queryByText('เงินสดที่ต้องมีในลิ้นชัก')).not.toBeInTheDocument();
  });

  it('คำเตือนเลขอ้างอิงซ้ำอยู่ในกล่องรายการ · "แยกตามประเภท" ยุบเป็นบรรทัดสรุป กดแล้วกางเป็นตารางเดิม', async () => {
    renderPage([{ id: 'branch-001', name: 'ลพบุรี' }], day);
    await screen.findByTestId('close-card'); // รอให้เลือกสาขาเดียวให้เองและโหลดรอบสองจบก่อน
    expect(await screen.findByRole('alert')).toHaveTextContent('เลขอ้างอิง 2026092114250931 ถูกใช้กับ 2 บิล — SL-0004 และ SL-0006');
    const toggle = screen.getByRole('button', { name: /แยกตามประเภท — ขายเงินสด 3 · จ่ายรับซื้อมือสอง 1/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('columnheader', { name: 'รวม' })).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('columnheader', { name: 'รวม' })).toBeInTheDocument();
    expect(screen.getByText('−5,000.00')).toBeInTheDocument();
  });
});
