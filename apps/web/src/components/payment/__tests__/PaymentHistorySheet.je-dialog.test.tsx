import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
