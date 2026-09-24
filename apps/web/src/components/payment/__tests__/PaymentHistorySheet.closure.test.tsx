vi.mock('../ReceiptVoidDialog', () => ({ default: () => null, ReceiptVoidDialog: () => null }));
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PaymentHistorySheet from '../PaymentHistorySheet';

/**
 * เจ้าของ 2026-09-24: "ไม่มีประวัติว่าลูกค้าปิดยอด / คืนเครื่อง" — หน้าประวัติเรียงจากใบเสร็จ
 * แต่คืนเครื่อง/ยึดคืน (JP5) ไม่ออกใบเสร็จ ⇒ ต้องมีแถว "ปิดสัญญาแล้ว" จาก contract.closure
 * และเปิดบันทึกบัญชี JP5 ได้จากแถวนั้น
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

const PAYMENT = {
  id: 'pay-5',
  installmentNo: 5,
  amountDue: '3671.00',
  amountPaid: '3671.00',
  lateFee: '0',
  lateFeeWaived: false,
  waivedAmount: null,
  waivedReason: null,
  waivedApprovedByName: null,
  depositAccountCode: '11-1101',
  status: 'PAID',
  paymentMethod: 'CASH',
  recordedBy: { name: 'สุทธินีย์ คงเดช' },
};
const RECEIPT = {
  id: 'rcpt-5',
  receiptNumber: 'RT-202609-00021',
  receiptType: 'INSTALLMENT',
  amount: '3671.00',
  installmentNo: 5,
  paymentId: 'pay-5',
  paymentMethod: 'CASH',
  paymentStatus: 'PAID',
  isVoided: false,
  paidDate: '2026-09-07T17:00:00.000Z',
  issuedByName: 'สุทธินีย์ คงเดช',
};
const CONTRACT = {
  contractNumber: 'TEST-20260827-019',
  customerName: 'ทดสอบ ค้าง 3 งวด',
  productName: 'Apple iPhone 15',
  totalMonths: 12,
  advanceBalance: '0',
  rescheduleAdvanceBalance: '0',
  status: 'CLOSED_BAD_DEBT',
  closure: {
    kind: 'DEVICE_RETURN',
    at: '2026-09-22T20:25:08.000Z',
    amount: '17717.97',
    appraisalPrice: '17800',
    docNumber: 'DR-20260922-0001',
    receiptNumber: null,
    entryNumber: 'JE-202609-00051',
    byName: 'เอกนรินทร์ คงเดช',
  },
};
const JP5 = {
  id: 'je-jp5',
  entryNumber: 'JE-202609-00051',
  entryDate: '2026-09-22T17:00:00.000Z',
  postedAt: '2026-09-22T17:00:00.000Z',
  description: 'คืนเครื่อง — สัญญา TEST-20260827-019',
  paymentId: null,
  tag: 'JP5',
  flow: 'repossession',
  deltaApplied: null,
  lateFeePortion: null,
  reversed: false,
  reversedByEntryNumber: null,
  originalEntryId: null,
  lines: [
    {
      accountCode: '11-2107',
      accountName: 'ลูกหนี้-หน้าร้าน',
      debit: '17800.00',
      credit: '0',
      description: '',
    },
    {
      accountCode: '11-2101',
      accountName: 'ลูกหนี้ผ่อนชำระ',
      debit: '0',
      credit: '17800.00',
      description: '',
    },
  ],
  totalDebit: '17800.00',
  totalCredit: '17800.00',
  isBalanced: true,
};

function wrap(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

function routeApi(contract: Record<string, unknown>, jes: unknown[] = [JP5]) {
  apiGet.mockImplementation((url: string) => {
    if (url.includes('/journal-entries')) return Promise.resolve({ data: jes });
    if (url.startsWith('/receipts/contract')) return Promise.resolve({ data: [RECEIPT] });
    if (url.startsWith('/payments/contract'))
      return Promise.resolve({ data: { data: [PAYMENT], contract } });
    return Promise.resolve({ data: [] });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PaymentHistorySheet — แถวปิดสัญญา', () => {
  it('คืนเครื่อง/ยึดคืน: แสดงแถวปิดสัญญา (วันที่ ยอดปิด ราคาประเมิน เลขใบ ผู้ยืนยัน) เหนือตารางใบเสร็จ', async () => {
    routeApi(CONTRACT);
    render(wrap(<PaymentHistorySheet contractId="ct-1" onClose={vi.fn()} />));
    const row = within(await screen.findByTestId('contract-closure'));
    expect(row.getByText(/ปิดสัญญาแล้ว — คืนเครื่อง \/ ยึดคืน/)).toBeInTheDocument();
    expect(row.getByText('17,717.97 ฿')).toBeInTheDocument();
    expect(row.getByText('17,800.00 ฿')).toBeInTheDocument();
    expect(row.getByText('DR-20260922-0001')).toBeInTheDocument();
    expect(row.getByText('โดย เอกนรินทร์ คงเดช')).toBeInTheDocument();
    // ใบเสร็จงวดปกติยังอยู่ครบ
    expect(screen.getByText('RT-202609-00021')).toBeInTheDocument();
  });

  it('ปุ่มบันทึกบัญชีของแถวปิดสัญญาเปิดกล่อง JE ที่แสดง JP5 (flow repossession) ไม่ปนกับ JE ใบเสร็จ', async () => {
    const receiptJe = {
      ...JP5,
      id: 'je-r',
      entryNumber: 'JE-202609-00035',
      tag: 'receipt',
      flow: 'payment-receipt',
      paymentId: 'pay-5',
    };
    routeApi(CONTRACT, [receiptJe, JP5]);
    render(wrap(<PaymentHistorySheet contractId="ct-1" onClose={vi.fn()} />));
    fireEvent.click(
      await screen.findByRole('button', { name: /ดูบันทึกบัญชีของการปิดสัญญา JE-202609-00051/ }),
    );
    const dialog = await screen.findByRole('dialog', { name: /บันทึกบัญชี \(JE\)/ });
    expect(within(dialog).getByText(/ปิดสัญญา \(คืนเครื่อง \/ ยึดคืน\)/)).toBeInTheDocument();
    expect(within(dialog).getByText('JE-202609-00051')).toBeInTheDocument();
    expect(within(dialog).queryByText('JE-202609-00035')).not.toBeInTheDocument();
  });

  it('ปิดยอดก่อนกำหนด: แถวปิดสัญญาแสดงเลขใบเสร็จและยอด', async () => {
    routeApi({
      ...CONTRACT,
      status: 'EARLY_PAYOFF',
      closure: {
        kind: 'EARLY_PAYOFF',
        at: '2026-09-24T05:00:00.000Z',
        amount: '18135.85',
        appraisalPrice: null,
        docNumber: null,
        receiptNumber: 'RT-202609-00030',
        entryNumber: null,
        byName: 'ผจก.ลพบุรี',
      },
    });
    render(wrap(<PaymentHistorySheet contractId="ct-1" onClose={vi.fn()} />));
    const row = within(await screen.findByTestId('contract-closure'));
    expect(row.getByText(/ปิดสัญญาแล้ว — ปิดยอดก่อนกำหนด/)).toBeInTheDocument();
    expect(row.getByText('18,135.85 ฿')).toBeInTheDocument();
    expect(row.getByText('RT-202609-00030')).toBeInTheDocument();
    expect(row.queryByRole('button')).not.toBeInTheDocument(); // ไม่มี JE ให้เปิด
  });

  it('สัญญายังเดินอยู่ (closure null / ไม่ส่งมา) → ไม่มีแถวปิดสัญญา', async () => {
    routeApi({ ...CONTRACT, status: 'ACTIVE', closure: null });
    render(wrap(<PaymentHistorySheet contractId="ct-1" onClose={vi.fn()} />));
    await screen.findByText('RT-202609-00021');
    expect(screen.queryByTestId('contract-closure')).not.toBeInTheDocument();
  });
});
