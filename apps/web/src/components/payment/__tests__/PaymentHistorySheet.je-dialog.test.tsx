vi.mock('../ReceiptVoidDialog', () => ({ default: () => null, ReceiptVoidDialog: () => null }));
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PaymentHistorySheet from '../PaymentHistorySheet';

/**
 * Owner request 2026-07-08: (1) the history sheet renders FULLSCREEN so all
 * table columns fit without a horizontal scrollbar, and (2) the บันทึกบัญชี
 * (JE) view opens as its own one-page dialog instead of an inline row
 * expansion that pushed content below the fold.
 */

const apiGet = vi.fn();

vi.mock('@/lib/api', () => ({
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    post: vi.fn(),
  },
  getErrorMessage: (e: unknown) => String(e),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', name: 'เจ้าของร้าน', role: 'OWNER' },
    isLoading: false,
    isAuthenticated: true,
  }),
}));

const PAYMENT = {
  id: 'pay-1',
  installmentNo: 2,
  amountDue: '4472.00',
  amountPaid: '4472.00',
  lateFee: '0',
  lateFeeWaived: false,
  waivedAmount: null,
  waivedReason: null,
  waivedApprovedByName: null,
  depositAccountCode: '11-1101',
  status: 'PAID',
  paymentMethod: 'CASH',
  recordedBy: { name: 'เอกนรินทร์ คงเดช' },
};

const CONTRACT = {
  contractNumber: 'TEST-20260630-003',
  customerName: 'ทดสอบ ค้าง 2 งวด 3',
  productName: 'Apple iPhone 15 Pro Max',
  totalMonths: 10,
  advanceBalance: '0',
};

const RECEIPT = {
  id: 'rcpt-1',
  receiptNumber: 'RT-202607-00015',
  receiptType: 'PAYMENT',
  amount: '4472.00',
  installmentNo: 2,
  paymentId: 'pay-1',
  paymentMethod: 'CASH',
  paymentStatus: 'PAID',
  isVoided: false,
  paidDate: '2026-07-07T03:00:00.000Z',
  issuedByName: 'เอกนรินทร์ คงเดช',
};

const JE = {
  id: 'je-1',
  entryNumber: 'JE-202607-00042',
  entryDate: '2026-07-07T03:00:00.000Z',
  postedAt: '2026-07-07T03:00:00.000Z',
  description: 'รับชำระงวด 2',
  paymentId: 'pay-1',
  tag: 'receipt',
  flow: 'payment-receipt',
  deltaApplied: '4472.00',
  lateFeePortion: null,
  reversed: false,
  reversedByEntryNumber: null,
  originalEntryId: null,
  lines: [
    { accountCode: '11-1101', accountName: 'เงินสด', debit: '4472.00', credit: '0', description: '' },
    { accountCode: '11-2103', accountName: 'ลูกหนี้ค้างชำระ', debit: '0', credit: '4472.00', description: '' },
  ],
  totalDebit: '4472.00',
  totalCredit: '4472.00',
  isBalanced: true,
};

function wrap(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockImplementation((url: string) => {
    if (url.includes('/journal-entries')) return Promise.resolve({ data: [JE] });
    if (url.startsWith('/receipts/contract')) return Promise.resolve({ data: [RECEIPT] });
    if (url.startsWith('/payments/contract'))
      return Promise.resolve({ data: { data: [PAYMENT], contract: CONTRACT } });
    return Promise.resolve({ data: [] });
  });
});

describe('PaymentHistorySheet — fullscreen + JE one-page dialog', () => {
  it('shows a 6a receipt at installment 12/12 separately from the later installment 5 payment', async () => {
    const payment = { ...PAYMENT, id: 'pay-5', installmentNo: 5, amountDue: '3671', amountPaid: '3671' };
    const split = {
      ...RECEIPT, id: 'reschedule-6a', receiptNumber: 'RT-6A-1714', receiptType: 'RESCHEDULE_FEE',
      installmentNo: 5, paymentId: payment.id, amount: '1714', paymentCase: 'RESCHEDULE',
      lateFeeCollected: '0', lateFeeWaivedThisReceipt: '0',
      installmentAllocations: [{ installmentNo: 12, amount: '1714', kind: 'RESCHEDULE_ADVANCE' }],
    };
    const installment = {
      ...RECEIPT, id: 'installment-5', receiptNumber: 'RT-INSTALLMENT-3671',
      installmentNo: 5, paymentId: payment.id, amount: '3671', paymentCase: 'NORMAL',
      installmentAllocations: [{ installmentNo: 5, amount: '3671', kind: 'INSTALLMENT' }],
    };
    apiGet.mockImplementation((url: string) => {
      if (url.includes('/journal-entries')) return Promise.resolve({ data: [] });
      if (url.startsWith('/receipts/contract')) return Promise.resolve({ data: [split, installment] });
      return Promise.resolve({ data: { data: [payment], contract: { ...CONTRACT, totalMonths: 12, rescheduleAdvanceBalance: '1714' } } });
    });
    render(wrap(<PaymentHistorySheet contractId="ct-1" onClose={vi.fn()} />));
    const splitRow = within((await screen.findByText('RT-6A-1714')).closest('tr')!);
    expect(splitRow.getByText('12/12')).toBeInTheDocument();
    expect(splitRow.getByText('1,714.00 ฿')).toBeInTheDocument();
    expect(splitRow.getByText('ปรับดิว')).toBeInTheDocument();
    expect(splitRow.queryByText('5/12')).not.toBeInTheDocument();
    const installmentRow = within(screen.getByText('RT-INSTALLMENT-3671').closest('tr')!);
    expect(installmentRow.getByText('5/12')).toBeInTheDocument();
    expect(installmentRow.getByText('ตรงดิว')).toBeInTheDocument();
  });

  it('retains collected reschedule fees in the summary after the installment fee resets', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url.includes('/journal-entries')) return Promise.resolve({ data: [] });
      if (url.startsWith('/receipts/contract')) return Promise.resolve({ data: [{
        ...RECEIPT, receiptType: 'RESCHEDULE_FEE', amount: '1144',
        paymentCase: 'RESCHEDULE', lateFeeCollected: '100.00', lateFeeWaivedThisReceipt: '0.00',
        installmentAllocations: [{ installmentNo: 10, amount: '1044', kind: 'RESCHEDULE_ADVANCE' }],
      }] });
      return Promise.resolve({ data: { data: [{
        ...PAYMENT, status: 'PENDING', amountPaid: '0', lateFee: '0',
      }], contract: { ...CONTRACT, rescheduleAdvanceBalance: '1044' } } });
    });
    render(wrap(<PaymentHistorySheet contractId="ct-1" onClose={vi.fn()} />));
    await screen.findByText(RECEIPT.receiptNumber);
    expect(screen.getByText('100.00 / 0.00 ฿')).toBeInTheDocument();
    expect(screen.getByText('0 / 10')).toBeInTheDocument();
  });

  it('shows both reschedule allocations in one receipt without counting the last installment paid', async () => {
    const installments = Array.from({ length: 10 }, (_, index) => ({
      ...PAYMENT,
      id: `pay-${index + 1}`,
      installmentNo: index + 1,
      status: index < 4 ? 'PAID' : 'PENDING',
      amountPaid: index < 4 ? '4472' : '0',
      lateFee: index < 3 ? '100' : '0',
    }));
    const receipts = installments.slice(0, 4).map((p, index) => ({
      ...RECEIPT,
      id: `receipt-${index + 1}`,
      receiptNumber: `RT-HISTORY-${index + 1}`,
      paymentId: p.id,
      installmentNo: p.installmentNo,
      amount: index < 3 ? '4572' : '5516',
      paymentCase: index < 3 ? 'NORMAL' : 'RESCHEDULE',
      installmentAllocations: index < 3 ? null : [
        { installmentNo: 4, amount: '4472', kind: 'INSTALLMENT' },
        { installmentNo: 10, amount: '1044', kind: 'RESCHEDULE_ADVANCE' },
      ],
    }));
    apiGet.mockImplementation((url: string) => {
      if (url.includes('/journal-entries')) return Promise.resolve({ data: [] });
      if (url.startsWith('/receipts/contract')) return Promise.resolve({ data: receipts });
      return Promise.resolve({ data: { data: installments, contract: {
        ...CONTRACT, rescheduleAdvanceBalance: '1044',
      } } });
    });
    render(wrap(<PaymentHistorySheet contractId="ct-1" onClose={vi.fn()} />));
    const receiptCell = await screen.findByText('RT-HISTORY-4');
    const row = within(receiptCell.closest('tr')!);
    expect(row.getByText('4/10')).toBeInTheDocument();
    expect(row.getByText('4,472.00 ฿')).toBeInTheDocument();
    expect(row.getByText('10/10')).toBeInTheDocument();
    expect(row.getByText('1,044.00 ฿')).toBeInTheDocument();
    expect(row.getByText('ล่วงหน้างวดสุดท้าย')).toBeInTheDocument();
    expect(row.getByText('ปรับดิว')).toBeInTheDocument();
    expect(row.getByText('5,516.00')).toBeInTheDocument();
    expect(screen.getByText('4 / 10')).toBeInTheDocument();
    expect(screen.getByText('19,232.00 ฿')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(5);
    expect(screen.getAllByText('ตรงดิว')).toHaveLength(3);
    expect(screen.getByRole('columnheader', { name: 'ลักษณะการชำระ' })).toBeInTheDocument();
  });

  it('does not assign the current parked balance to a receipt without allocation history', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url.includes('/journal-entries')) return Promise.resolve({ data: [] });
      if (url.startsWith('/receipts/contract')) return Promise.resolve({ data: [RECEIPT] });
      return Promise.resolve({ data: { data: [PAYMENT], contract: {
        ...CONTRACT, rescheduleAdvanceBalance: '1044',
      } } });
    });
    render(wrap(<PaymentHistorySheet contractId="ct-1" onClose={vi.fn()} />));
    const receiptCell = await screen.findByText(RECEIPT.receiptNumber);
    const row = within(receiptCell.closest('tr')!);
    expect(row.queryByText('10/10')).not.toBeInTheDocument();
    expect(row.queryByText('1,044.00 ฿')).not.toBeInTheDocument();
  });

  it('renders the history dialog fullscreen (inset-5, no centered max-width)', async () => {
    render(wrap(<PaymentHistorySheet contractId="ct-1" onClose={vi.fn()} />));
    await screen.findByText('RT-202607-00015');

    const contents = document.querySelectorAll('[data-slot="dialog-content"]');
    const history = contents[0] as HTMLElement;
    expect(history.className).toContain('inset-5');
    expect(history.className).not.toContain('max-w-6xl');
  });

  it('opens the บันทึกบัญชี dialog on the book button — JE lines visible without inline expansion', async () => {
    render(wrap(<PaymentHistorySheet contractId="ct-1" onClose={vi.fn()} />));
    await screen.findByText('RT-202607-00015');

    // No JE content rendered before the click.
    expect(screen.queryByText('JE-202607-00042')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('ดูบันทึกบัญชีของใบเสร็จ RT-202607-00015'));

    // The JE dialog shows the entry + its Dr/Cr lines in one view.
    await waitFor(() => expect(screen.getByText('JE-202607-00042')).toBeInTheDocument());
    expect(screen.getByText(/บันทึกบัญชี \(JE\)/)).toBeInTheDocument();
    expect(screen.getByText('ลูกหนี้ค้างชำระ')).toBeInTheDocument();
    expect(screen.getByText('BALANCED', { exact: false })).toBeInTheDocument();
  });

  it('credit-note row keeps the JE button but hides the void button (backend refuses CN void)', async () => {
    const CN = {
      ...RECEIPT,
      id: 'rcpt-cn',
      receiptNumber: 'RT-202607-00016',
      receiptType: 'CREDIT_NOTE',
    };
    apiGet.mockImplementation((url: string) => {
      if (url.includes('/journal-entries')) return Promise.resolve({ data: [JE] });
      if (url.startsWith('/receipts/contract')) return Promise.resolve({ data: [RECEIPT, CN] });
      if (url.startsWith('/payments/contract'))
        return Promise.resolve({ data: { data: [PAYMENT], contract: CONTRACT } });
      return Promise.resolve({ data: [] });
    });
    render(wrap(<PaymentHistorySheet contractId="ct-1" onClose={vi.fn()} />));
    await screen.findByText('RT-202607-00016');

    expect(
      screen.getByLabelText('ดูบันทึกบัญชีของใบเสร็จ RT-202607-00016'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('ยกเลิกใบเสร็จ RT-202607-00016')).not.toBeInTheDocument();
    // The normal receipt row still offers void.
    expect(screen.getByLabelText('ยกเลิกใบเสร็จ RT-202607-00015')).toBeInTheDocument();
  });

  it('closes the JE dialog without closing the history sheet', async () => {
    const onClose = vi.fn();
    render(wrap(<PaymentHistorySheet contractId="ct-1" onClose={onClose} />));
    await screen.findByText('RT-202607-00015');

    fireEvent.click(screen.getByLabelText('ดูบันทึกบัญชีของใบเสร็จ RT-202607-00015'));
    await waitFor(() => expect(screen.getByText('JE-202607-00042')).toBeInTheDocument());

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('JE-202607-00042')).not.toBeInTheDocument());

    // History sheet is still open underneath.
    expect(screen.getByText('RT-202607-00015')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
