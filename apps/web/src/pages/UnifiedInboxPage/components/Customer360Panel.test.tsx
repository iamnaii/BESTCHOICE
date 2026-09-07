import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Customer360Panel from './Customer360Panel';
import type { ContractSummaryItem } from './customer360/types';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  mobile: vi.fn(() => false),
}));
vi.mock('@/lib/api', () => ({ default: { get: mocks.get, post: mocks.post, patch: mocks.patch } }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: mocks.mobile }));
vi.mock('./ProductContextCard', () => ({ default: () => null }));
// Exercise the actual targeting/loading and dialog props; Collections owns submission of these forms.
vi.mock('@/pages/CollectionsPage/components/ContactLogDialog', () => ({
  default: ({
    open,
    contract,
    onSaved,
  }: {
    open: boolean;
    contract?: { id: string };
    onSaved: () => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="บันทึกติดต่อ">
        <span>{contract?.id}</span>
        <button onClick={onSaved}>บันทึกการติดต่อ</button>
      </div>
    ) : null,
}));
vi.mock('@/pages/CollectionsPage/components/LockDeviceDialog', () => ({
  default: ({
    contractId,
    customerName,
    daysOverdue,
  }: {
    contractId: string;
    customerName: string;
    daysOverdue: number;
  }) => (
    <div role="dialog" aria-label="ยืนยันล็อกเครื่อง">
      {contractId}|{customerName}|{daysOverdue}
    </div>
  ),
}));

const first: ContractSummaryItem = {
  id: 'c1',
  contractNumber: 'CT-1',
  status: 'ACTIVE',
  paidInstallments: 1,
  totalInstallments: 12,
  monthlyPayment: '1515.83',
  product: { name: 'เครื่องแรก' },
};
const second: ContractSummaryItem = {
  ...first,
  id: 'c2',
  contractNumber: 'CT-2',
  product: { name: 'เครื่องที่สอง' },
};
let contracts: ContractSummaryItem[];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.mobile.mockReturnValue(false);
  contracts = [first];
  mocks.get.mockImplementation(async (url: string) => {
    if (url.endsWith('/chat-summary'))
      return {
        data: {
          activeContracts: contracts,
          recentPayments: [
            {
              id: 'payment',
              contract: { contractNumber: 'CT-1' },
              installmentNo: 1,
              amountDue: '1515.83',
              amountPaid: '1000.25',
              status: 'PARTIALLY_PAID',
              partials: [
                {
                  id: 'r1',
                  receiptNumber: 'R1',
                  amount: '800.00',
                  paidDate: '2026-09-01T10:00:00Z',
                  paymentMethod: 'BANK_TRANSFER',
                },
                {
                  id: 'r2',
                  receiptNumber: 'R2',
                  amount: '200.25',
                  paidDate: '2026-09-02T10:00:00Z',
                  paymentMethod: 'CASH',
                },
              ],
            },
          ],
        },
      };
    if (url.endsWith('/queue-row'))
      return {
        data: {
          data: {
            id: url.includes('/c2/') ? 'c2' : 'c1',
            customer: { name: 'ลูกค้าสังเคราะห์' },
            daysOverdue: 7,
          },
        },
      };
    if (url.startsWith('/customers/search'))
      return { data: [{ id: 'matched', name: 'ลูกค้าเดิม' }] };
    if (url === '/customers/customer1')
      return { data: { id: 'customer1', name: 'ลูกค้าสังเคราะห์' } };
    return { data: [] };
  });
  mocks.post.mockResolvedValue({ data: { type: 'reminder' } });
  mocks.patch.mockResolvedValue({ data: {} });
});

function mount(props: Partial<Parameters<typeof Customer360Panel>[0]> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Customer360Panel
          bare
          customerId="customer1"
          activeRoomId="room1"
          sections={['actions']}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { invalidate };
}

async function openAction(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'ดำเนินการ' }));
  fireEvent.click(await screen.findByRole('button', { name }));
}

describe('Customer360Panel extracted actions used by RoomDossier', () => {
  it.each([false, true])(
    'requires choosing a contract before an MDM request (mobile=%s)',
    async (mobile) => {
      mocks.mobile.mockReturnValue(mobile);
      contracts = [first, second];
      mount();
      await openAction('ส่งคำสั่งล็อกเครื่อง (MDM)');
      expect(mocks.get).not.toHaveBeenCalledWith(expect.stringContaining('/queue-row'));
      fireEvent.click(await screen.findByRole('button', { name: /CT-2/ }));
      expect(await screen.findByRole('dialog', { name: 'ยืนยันล็อกเครื่อง' })).toHaveTextContent(
        'c2|ลูกค้าสังเคราะห์|7',
      );
      expect(mocks.get).toHaveBeenCalledWith('/overdue/contracts/c2/queue-row');
      expect(mocks.get).not.toHaveBeenCalledWith('/overdue/contracts/c1/queue-row');
      expect(mocks.post).not.toHaveBeenCalled();
    },
  );

  it('sends the payment link for the selected contract and keeps API error messages', async () => {
    contracts = [first, second];
    mocks.post.mockRejectedValueOnce({
      response: { data: { message: 'ยังไม่ได้ผูก LINE Finance' } },
    });
    mount();
    await openAction('ส่งลิงก์ชำระ');
    expect(mocks.post).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: /CT-2/ }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/line-oa/payment-flex', { contractId: 'c2' }),
    );
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('ยังไม่ได้ผูก LINE Finance'));
  });

  it('loads the only contract directly and refreshes the customer summary after contact logging', async () => {
    const { invalidate } = mount();
    await openAction('บันทึกติดต่อ + นัดชำระ');
    expect(await screen.findByRole('dialog', { name: 'บันทึกติดต่อ' })).toHaveTextContent('c1');
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกการติดต่อ' }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['customer-chat-summary', 'customer1'] });
    expect(screen.queryByRole('dialog', { name: 'บันทึกติดต่อ' })).not.toBeInTheDocument();
  });

  it('does not start a contract action when no contract is available', async () => {
    contracts = [];
    mount();
    await openAction('ส่งคำสั่งล็อกเครื่อง (MDM)');
    expect(mocks.error).toHaveBeenCalledWith('ไม่มีสัญญาที่ใช้งาน');
    expect(mocks.get).not.toHaveBeenCalledWith(expect.stringContaining('/queue-row'));
  });

  it('opens the newest contract PDF and ignores other document types', async () => {
    const base = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation(async (url: string) => {
      if (url === '/contracts/c1/documents')
        return {
          data: {
            data: [
              { id: 'older', documentType: 'CONTRACT', createdAt: '2026-09-01' },
              { id: 'newer', documentType: 'CONTRACT', createdAt: '2026-09-02' },
              { id: 'receipt', documentType: 'RECEIPT', createdAt: '2026-09-03' },
            ],
          },
        };
      if (url === '/documents/newer/signed-url')
        return { data: { url: 'https://example.test/signed.pdf' } };
      return base(url);
    });
    mount();
    await openAction('ดูสัญญา PDF');
    expect(await screen.findByTitle('สัญญา CT-1')).toHaveAttribute(
      'src',
      'https://example.test/signed.pdf',
    );
    expect(mocks.get).toHaveBeenCalledWith('/documents/newer/signed-url');
    expect(mocks.get).not.toHaveBeenCalledWith('/documents/receipt/signed-url');
  });

  it('keeps partial receipts and satang amounts visible when expanding payment history', async () => {
    mount({ sections: ['payments'] });
    const payment = await screen.findByRole('button', { name: /CT-1.*งวด 1/ });
    expect(payment).toHaveTextContent('1,000.25 บ.');
    expect(payment).toHaveTextContent('1,515.83');
    fireEvent.click(payment);
    expect(screen.getByText('800')).toBeInTheDocument();
    expect(screen.getByText('200.25')).toBeInTheDocument();
    expect(screen.getByText('โอน')).toBeInTheDocument();
    expect(screen.getByText('เงินสด')).toBeInTheDocument();
  });

  it('mounts the shared customer-link dialog in the unlinked session branch', async () => {
    const { invalidate } = mount({
      customerId: null,
      session: { id: 'room1', displayName: 'ผู้ติดต่อใหม่' },
    });
    fireEvent.click(screen.getByRole('button', { name: /ผูกลูกค้าที่มีอยู่/ }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'ค้นหาลูกค้า' }), {
      target: { value: 'ลูกค้า' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'ลูกค้าเดิม' }));
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith('/staff-chat/rooms/room1/customer', {
        customerId: 'matched',
      }),
    );
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['customer-credit-checks'] }),
    );
  });
});
