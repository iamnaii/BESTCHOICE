vi.mock('../ReceiptVoidDialog', () => ({ default: () => null, ReceiptVoidDialog: () => null }));
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PaymentHistorySheet from '../PaymentHistorySheet';

/**
 * เจ้าของ 2026-09-24: "ทำไมประวัติชำระอื่นๆ หายไปด้วย" — TEST-20260827-022 มี 5 งวด PAID แต่มีใบเสร็จ
 * ใบเดียว (งวด 1–4 seed เป็น PAID ไว้ล่วงหน้าโดยไม่มีใบเสร็จ/JE) หน้าประวัติที่เรียงจากใบเสร็จจึง
 * โชว์แถวเดียวทั้งที่การ์ดบอก 5/6 ⇒ ต้องเติมแถว "ไม่มีใบเสร็จ" ให้งวดพวกนั้น
 */

const apiGet = vi.fn();

vi.mock('@/lib/api', () => ({
  default: { get: (...args: unknown[]) => apiGet(...args), post: vi.fn() },
  getErrorMessage: (e: unknown) => String(e),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', name: 'เจ้าของร้าน', role: 'OWNER' },
    isLoading: false,
    isAuthenticated: true,
  }),
}));

const basePayment = {
  amountDue: '4199.00',
  lateFee: '0',
  lateFeeWaived: false,
  waivedAmount: null,
  waivedReason: null,
  waivedApprovedByName: null,
  paymentMethod: 'CASH',
  recordedBy: { name: 'ระบบ' },
};
const PAYMENTS = [
  // งวด 1 — seed เป็น PAID ไม่มีใบเสร็จ
  {
    ...basePayment,
    id: 'pay-1',
    installmentNo: 1,
    dueDate: '2026-04-26T00:00:00.000Z',
    paidDate: '2026-04-26T10:00:00.000Z',
    amountPaid: '4199.00',
    depositAccountCode: null,
    status: 'PAID',
  },
  // งวด 5 — รับผ่านระบบ มีใบเสร็จ
  {
    ...basePayment,
    id: 'pay-5',
    installmentNo: 5,
    dueDate: '2026-08-26T00:00:00.000Z',
    paidDate: '2026-08-31T17:00:00.000Z',
    amountPaid: '4299.00',
    lateFee: '100',
    depositAccountCode: '11-1101',
    status: 'PAID',
  },
  // งวด 6 — ยังค้าง ห้ามมีแถว
  {
    ...basePayment,
    id: 'pay-6',
    installmentNo: 6,
    dueDate: '2026-09-26T00:00:00.000Z',
    paidDate: null,
    amountPaid: '0.00',
    depositAccountCode: null,
    status: 'PENDING',
  },
];
const RECEIPT = {
  id: 'rcpt-5',
  receiptNumber: 'RT-202609-00002',
  receiptType: 'INSTALLMENT',
  amount: '4299.00',
  installmentNo: 5,
  paymentId: 'pay-5',
  paymentMethod: 'CASH',
  paymentStatus: 'PAID',
  isVoided: false,
  paidDate: '2026-08-31T17:00:00.000Z',
  issuedByName: 'สุทธินีย์ คงเดช',
};
const CONTRACT = {
  contractNumber: 'TEST-20260827-022',
  customerName: 'ทดสอบ ใกล้ปิดยอด',
  productName: 'Apple iPhone 15',
  totalMonths: 6,
  advanceBalance: '0',
  rescheduleAdvanceBalance: '0',
  status: 'CLOSED_BAD_DEBT',
  closure: null,
};

function wrap(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockImplementation((url: string) => {
    if (url.includes('/journal-entries')) return Promise.resolve({ data: [] });
    if (url.startsWith('/receipts/contract')) return Promise.resolve({ data: [RECEIPT] });
    if (url.startsWith('/payments/contract'))
      return Promise.resolve({ data: { data: PAYMENTS, contract: CONTRACT } });
    return Promise.resolve({ data: [] });
  });
});

describe('PaymentHistorySheet — งวด PAID ที่ไม่มีใบเสร็จ', () => {
  it('เติมแถว "ไม่มีใบเสร็จ" ให้งวดที่ PAID โดยไม่มีใบเสร็จ เรียงก่อนใบเสร็จจริง และไม่เติมงวดที่ยังค้าง', async () => {
    render(wrap(<PaymentHistorySheet contractId="ct-22" onClose={vi.fn()} />));
    await screen.findByText('RT-202609-00002');
    const bodyRows = screen.getAllByRole('row').slice(1); // ตัด header
    expect(bodyRows).toHaveLength(2);
    const legacy = within(bodyRows[0]);
    expect(legacy.getByText('ไม่มีใบเสร็จ')).toBeInTheDocument();
    expect(legacy.getByText('ชำระแล้ว (ยกมา)')).toBeInTheDocument();
    expect(legacy.getByText('1/6')).toBeInTheDocument();
    expect(legacy.getAllByText('4,199.00')).toHaveLength(2); // ยอดต้องชำระ + ยอดรับจริง
    expect(legacy.getByText('● PAID')).toBeInTheDocument();
    expect(within(bodyRows[1]).getByText('RT-202609-00002')).toBeInTheDocument();
  });

  it('แถวไม่มีใบเสร็จ: มีปุ่มบันทึกบัญชีของงวด แต่ไม่มีปุ่มดาวน์โหลด/ยกเลิกใบเสร็จ', async () => {
    render(wrap(<PaymentHistorySheet contractId="ct-22" onClose={vi.fn()} />));
    await screen.findByText('RT-202609-00002');
    expect(screen.getByRole('button', { name: 'ดูบันทึกบัญชีของงวด 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ดาวน์โหลดใบเสร็จ $/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /ดาวน์โหลดใบเสร็จ/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /ยกเลิกใบเสร็จ/ })).toHaveLength(1);
  });

  it('การ์ด "งวดที่ชำระแล้ว" และ "ยอดชำระสะสม" นับงวดที่ไม่มีใบเสร็จด้วย', async () => {
    render(wrap(<PaymentHistorySheet contractId="ct-22" onClose={vi.fn()} />));
    await screen.findByText('RT-202609-00002');
    expect(screen.getByText('2 / 6')).toBeInTheDocument();
    expect(screen.getByText('8,498.00 ฿')).toBeInTheDocument();
  });
});
