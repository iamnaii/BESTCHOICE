import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { it, expect, vi, beforeEach } from 'vitest';
const auth = vi.hoisted(() => ({ role: 'OWNER' }));
const row = {
  checkType: 'FULL',
  id: 'c',
  status: 'MANUAL_REVIEW',
  aiScore: null,
  aiSummary: 'อ่านแล้ว',
  createdAt: '2026-09-07T00:00:00Z',
  customer: { id: 'customer', name: 'ลูกค้าทดสอบ' },
  aiAnalysis: {
    source: 'chat-statement',
    roomId: 'room',
    totalIncome: 30000,
    totalExpense: 10000,
    dateRange: 'มกราคม',
  },
};
let rows: unknown[] = [row];
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: auth.role } }) }));
vi.mock('@/lib/api', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(async () => ({
      data: {
        data: rows,
        total: 1,
        page: 1,
        totalPages: 1,
        summary: {
          totalCount: 1,
          pendingCount: 1,
          approvedCount: 0,
          rejectedCount: 0,
          avgScore: 0,
        },
      },
    })),
  },
  getErrorMessage: () => 'error',
}));
import CreditChecksPage from './CreditChecksPage';
import api from '@/lib/api';
beforeEach(() => { rows = [row]; auth.role = 'OWNER'; vi.mocked(api.post).mockReset(); });
function showQueue() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><CreditChecksPage /></MemoryRouter></QueryClientProvider>);
}

it('requires confirmed financial figures when approving from the queue', async () => {
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><CreditChecksPage /></MemoryRouter></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'อนุมัติ' }));
  expect(screen.getByLabelText(/รายได้ประจำที่ยืนยัน/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/เหตุผล/), { target: { value: 'มีหลักฐานและต้องยืนยันตัวเลขก่อนอนุมัติให้ลูกค้า' } });
  expect(screen.getByRole('button', { name: 'ยืนยัน' })).toBeDisabled();
});

it('shows chat statement figures and opens the source room from the existing manager queue', async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <CreditChecksPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('link', { name: 'เปิดแชทต้นทาง' })).toHaveAttribute(
    'href',
    '/inbox/room',
  );
  expect(screen.getByText(/เงินเหลือช่วง มกราคม.*20,000/)).toBeInTheDocument();
});


it.each([
  ['REJECTED', 'FULL', 'OWNER', 'ไม่อนุมัติ'],
  ['REJECTED', 'FULL', 'BRANCH_MANAGER', 'อนุมัติ'],
  ['APPROVED', 'PRE', 'OWNER', 'ทบทวนยอดอนุมัติ'],
])('does not offer an impossible %s/%s transition to %s: %s', async (status, checkType, role, button) => {
  rows = [{ ...row, status, checkType }]; auth.role = role;
  showQueue();
  await screen.findByText('ลูกค้าทดสอบ');
  expect(screen.queryByRole('button', { name: button })).not.toBeInTheDocument();
});

it.each([
  [null, null, 'สำหรับสัญญาใหม่หนึ่งฉบับ'],
  ['contract', null, 'นำไปใช้กับสัญญาแล้ว'],
  [null, '2026-09-08', 'ผลนี้ถูกแทนที่แล้ว'],
])('shows the actual approved amount and usage (%s / %s)', async (usedByContractId, supersededAt, label) => {
  rows = [{ ...row, status: 'APPROVED', approvals: [{ id: 'approval', approvedMonthlyPayment: '1500', salaryPayDay: 31, usedByContractId, supersededAt }] }];
  showQueue();
  expect(await screen.findByText(/อนุมัติค่างวดไม่เกิน 1,500 บาท/)).toBeInTheDocument();
  expect(screen.getByText('ชำระทุกสิ้นเดือน')).toBeInTheDocument();
  expect(screen.getByText(label)).toBeInTheDocument();
});

it('does not claim the queue is cleared while the "รอตรวจ" card still counts rows awaiting analysis', async () => {
  rows = [];
  showQueue();
  expect(await screen.findByText(/อีก 1 รายการยังรอผลวิเคราะห์/)).toBeInTheDocument();
  expect(screen.queryByText(/เคลียร์หมดแล้ว/)).not.toBeInTheDocument();
});

it('opens evidence in the credit tab and keeps the decision reason within the DTO limit', async () => {
  showQueue();
  fireEvent.click(await screen.findByRole('button', { name: 'อนุมัติ' }));
  expect(screen.getByRole('link', { name: 'เปิดหลักฐานและประวัติเครดิต' })).toHaveAttribute('href', '/customers/customer?tab=credit');
  expect(screen.getByLabelText(/เหตุผล/)).toHaveAttribute('maxLength', '2000');
});

it('keeps the submitted decision fixed and the dialog open while saving', async () => {
  let resolvePost!: (value: unknown) => void;
  vi.mocked(api.post).mockReturnValue(new Promise(resolve => { resolvePost = resolve; }) as never);
  showQueue();
  fireEvent.click(await screen.findByRole('button', { name: 'ไม่อนุมัติ' }));
  const reason = '  ตรวจเอกสารและยืนยันว่าไม่สามารถอนุมัติยอดในรอบนี้ได้  ';
  fireEvent.change(screen.getByLabelText(/เหตุผล/), { target: { value: reason } });
  fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/customers/customer/credit-check/c/override',
    expect.objectContaining({ overrideReason: reason.trim(), status: 'REJECTED' })));
  expect(screen.getByRole('button', { name: 'ยกเลิก' })).toBeDisabled();
  expect(screen.getByLabelText(/เหตุผล/)).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  await act(async () => resolvePost({ data: {} }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
