import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
vi.mock('./shop-daily-cash/CashCloseOverview', () => ({
  default: ({ branchId, showTable, onOpen }: { branchId: string; showTable: boolean; onOpen: (branchId: string, date?: string) => void }) => (
    <div>
      <div data-testid="overview">{`${branchId || 'ALL'}|${showTable}`}</div>
      <button type="button" onClick={() => onOpen('branch-001', '2026-09-08')}>ช่องวันที่ 8 ของแถบ 14 วัน</button>
    </div>
  ),
}));

const summary = (branches: { id: string; name: string }[]) => ({
  date: '2026-09-21', scope: 'ALL', branchId: null, branches,
  totals: { cashIn: '0', transferIn: '0', qrIn: '0', totalIn: '0', cashOut: '0', nonCashOut: '0', totalOut: '0', expectedCashInDrawer: '0', inCount: 0, outCount: 0 },
  byStaff: [], byKind: [], rows: [], duplicateReferences: [],
});

function renderPage(branches: { id: string; name: string }[]) {
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/shop-tenders/daily-summary') return { data: summary(branches) };
    return { data: { closes: [], awaitingConfirm: [] } };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><ShopDailyCashPage /></QueryClientProvider></MemoryRouter>);
}

beforeEach(() => vi.clearAllMocks());

describe('ShopDailyCashPage — เจ้าของเปิดหน้ามาต้องเห็นเรื่องปิดยอดทันที', () => {
  it('ร้านสาขาเดียว: เลือกสาขานั้นให้เอง → เจอกล่องปิดยอดของสาขา (เดิมค้างที่ "ทุกสาขา" ไม่เห็นอะไรเลย) · สลับกลับ "ทุกสาขา" ได้', async () => {
    renderPage([{ id: 'branch-001', name: 'คลังสินค้าหลัก' }]);
    expect(await screen.findByTestId('close-card')).toHaveTextContent('branch-001');
    expect(screen.getByTestId('overview')).toHaveTextContent('branch-001|false');
    await userEvent.selectOptions(screen.getByLabelText('สาขา'), '');
    await waitFor(() => expect(screen.getByTestId('overview')).toHaveTextContent('ALL|true'));
    expect(screen.queryByTestId('close-card')).not.toBeInTheDocument(); // ไม่ถูกบังคับเลือกซ้ำ
  });

  it('หลายสาขา: เปิดมาเป็น "ทุกสาขา" พร้อมตารางสถานะปิดยอดของทุกสาขา', async () => {
    renderPage([{ id: 'b1', name: 'ลาดพร้าว' }, { id: 'b2', name: 'รังสิต' }]);
    expect(await screen.findByTestId('overview')).toHaveTextContent('ALL|true');
    expect(screen.queryByTestId('close-card')).not.toBeInTheDocument();
  });
});

describe('ShopDailyCashPage — ดูวันย้อนหลังต้องมีทางกลับ', () => {
  it('เปลี่ยนไปดูวันก่อนหน้า → มีแถบบอกว่าย้อนหลัง + ปุ่ม "กลับมาวันนี้" พากลับวันนี้ แล้วแถบหาย', async () => {
    renderPage([{ id: 'branch-001', name: 'ลพบุรี' }]);
    await screen.findByTestId('close-card');
    expect(screen.queryByRole('button', { name: 'กลับมาวันนี้' })).not.toBeInTheDocument();
    const calls = () => mocks.get.mock.calls.filter(([path]) => path === '/shop-tenders/daily-summary').map(([, config]) => config.params.date as string);
    const today = calls()[0];
    await userEvent.click(screen.getByRole('button', { name: 'ช่องวันที่ 8 ของแถบ 14 วัน' })); // ทางเดียวกับที่เจ้าของหลงไปวันย้อนหลังบนระบบจริง
    expect(await screen.findByText(/กำลังดูวันที่ 8 ก\.ย\. 2569 \(ย้อนหลัง\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'กลับมาวันนี้' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'กลับมาวันนี้' })).not.toBeInTheDocument());
    expect(calls().at(-1)).toBe(today);
  });
});
