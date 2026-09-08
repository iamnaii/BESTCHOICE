import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PaymentApprovalQueue from '../PaymentApprovalQueue';
import PaymentApprovalRequestDialog from '../PaymentApprovalRequestDialog';
import type { PaymentApprovalRequest } from '@/hooks/usePaymentApprovalRequests';

const state = vi.hoisted(() => ({
  user: { id: 'reviewer', name: 'ผู้ตรวจ', role: 'SALES' },
  get: vi.fn(),
  post: vi.fn(),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('@/lib/company-scope', () => ({ getRequestCompany: () => 'FINANCE' }));
vi.mock('@/lib/api', () => ({
  default: { get: state.get, post: state.post },
  getErrorMessage: (error: Error) => error.message,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function row(overrides: Partial<PaymentApprovalRequest> = {}): PaymentApprovalRequest {
  return {
    id: 'request-1',
    action: 'RECORD_PAYMENT',
    status: 'PENDING',
    contractId: 'contract-1',
    contractNumber: 'TEST-017',
    targetId: 'payment-2',
    requestedById: 'cashier',
    requestedByName: 'พนักงานรับเงิน',
    reason: 'รับค่าปรับเพิ่มตามข้อตกลง',
    createdAt: '2026-09-08T07:00:00Z',
    payload: {
      amount: 3050,
      installmentNo: 2,
      lateFee: 150,
      lateFeeWaiverAmount: 0,
      additionalLateFee: 50,
    },
    requiredPermissions: ['PAYMENT_TOLERANCE'],
    canApprove: true,
    ...overrides,
  };
}
function mount(element: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  render(<QueryClientProvider client={qc}>{element}</QueryClientProvider>);
  return { qc, invalidate };
}

beforeEach(() => {
  state.user = { id: 'reviewer', name: 'ผู้ตรวจ', role: 'SALES' };
  state.get.mockReset();
  state.post.mockReset();
  state.get.mockResolvedValue({ data: { data: [row()] } });
  state.post.mockResolvedValue({ data: { ...row(), status: 'APPROVED' } });
});

describe('payment approval queue', () => {
  it('shows the frozen receipt fee and allows a delegated SALES reviewer according to canApprove', async () => {
    mount(<PaymentApprovalQueue />);
    const article = await screen.findByRole('article');
    expect(within(article).getByText('3,050.00 ฿')).toBeInTheDocument();
    expect(within(article).getByText('50.00 ฿')).toBeInTheDocument();
    expect(within(article).queryByText('150.00 ฿')).not.toBeInTheDocument();
    expect(within(article).getByText(/พนักงานรับเงิน/)).toBeInTheDocument();
    expect(within(article).getByRole('button', { name: 'อนุมัติ' })).toBeEnabled();
    expect(within(article).queryByRole('button', { name: 'ยกเลิกคำขอ' })).not.toBeInTheDocument();
  });

  it('never derives approval rights from role when backend canApprove is false', async () => {
    state.user = { id: 'cashier', name: 'เจ้าของ', role: 'OWNER' };
    state.get.mockResolvedValue({ data: { data: [row({ canApprove: false })] } });
    mount(<PaymentApprovalQueue />);
    await screen.findByRole('article');
    expect(screen.queryByRole('button', { name: 'อนุมัติ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ปฏิเสธ' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ยกเลิกคำขอ' })).toBeEnabled();
  });

  it('requires an OWNER self-approval reason and submits only the decision under the current session', async () => {
    state.user = { id: 'cashier', name: 'เจ้าของ', role: 'OWNER' };
    const { invalidate } = mount(<PaymentApprovalQueue />);
    fireEvent.click(await screen.findByRole('button', { name: 'อนุมัติ' }));
    const dialog = screen.getByRole('dialog');
    const reason = within(dialog).getByRole('textbox');
    expect(reason).toHaveValue('รับค่าปรับเพิ่มตามข้อตกลง');
    fireEvent.change(reason, { target: { value: '' } });
    expect(within(dialog).getByRole('button', { name: 'ยืนยัน' })).toBeDisabled();
    fireEvent.change(reason, { target: { value: '  ตรวจหลักฐานครบแล้ว  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'ยืนยัน' }));
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith('/payments/approval-requests/request-1/approve', {
        reason: 'ตรวจหลักฐานครบแล้ว',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['payment-approval-requests'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['pending-payments'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['contract-receipts'] });
  });

  it('requires a rejection reason and retains API errors for correction', async () => {
    state.post.mockRejectedValue(new Error('สิทธิ์อนุมัติเปลี่ยนแล้ว'));
    mount(<PaymentApprovalQueue />);
    fireEvent.click(await screen.findByRole('button', { name: 'ปฏิเสธ' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'ยืนยัน' })).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'หลักฐานไม่ตรง' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'ยืนยัน' }));
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith('/payments/approval-requests/request-1/reject', {
        reason: 'หลักฐานไม่ตรง',
      }),
    );
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('สิทธิ์อนุมัติเปลี่ยนแล้ว');
    expect(within(dialog).getByRole('textbox')).toHaveValue('หลักฐานไม่ตรง');
  });

  it('lets only the requester cancel their pending request, without an approver field', async () => {
    state.user.id = 'cashier';
    mount(<PaymentApprovalQueue />);
    fireEvent.click(await screen.findByRole('button', { name: 'ยกเลิกคำขอ' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ยืนยัน' }));
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith('/payments/approval-requests/request-1/cancel', {}),
    );
  });

  it('disables an open approval after a refreshed permission check denies it', async () => {
    const { qc } = mount(<PaymentApprovalQueue />);
    fireEvent.click(await screen.findByRole('button', { name: 'อนุมัติ' }));
    state.get.mockResolvedValue({ data: { data: [row({ canApprove: false })] } });
    await qc.invalidateQueries({ queryKey: ['payment-approval-requests'] });
    await waitFor(() =>
      expect(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'ยืนยัน' }),
      ).toBeDisabled(),
    );
    expect(state.post).not.toHaveBeenCalled();
  });

  it('shows query error and supports retry instead of displaying an empty queue', async () => {
    state.get.mockRejectedValueOnce(new Error('เชื่อมต่อไม่สำเร็จ'));
    mount(<PaymentApprovalQueue />);
    expect(await screen.findByRole('alert')).toHaveTextContent('เชื่อมต่อไม่สำเร็จ');
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    expect(await screen.findByRole('article')).toBeInTheDocument();
  });
});

describe('frozen server review summaries', () => {
  it('shows every receipt affected by a void and its frozen total', async () => {
    state.get.mockResolvedValue({
      data: {
        data: [
          row({
            action: 'VOID_RECEIPT',
            payload: {},
            reviewSummary: { amount: '6179', receiptNumbers: ['RC-2-1', 'RC-2-2'] },
          }),
        ],
      },
    });
    mount(<PaymentApprovalQueue />);
    const article = await screen.findByRole('article');
    expect(within(article).getByText('ยอดใบเสร็จที่ยกเลิก')).toBeInTheDocument();
    expect(within(article).getByText('6,179.00 ฿')).toBeInTheDocument();
    expect(within(article).getByText('RC-2-1, RC-2-2')).toBeInTheDocument();
  });

  it('uses frozen payoff and standalone waiver amounts without modifying executable payload', async () => {
    state.get.mockResolvedValue({
      data: {
        data: [
          row({
            id: 'payoff',
            action: 'EARLY_PAYOFF',
            payload: { discountPct: 10 },
            reviewSummary: {
              totalPayoff: '22000',
              discountAmount: '1200',
              unpaidLateFees: '100',
              remainingMonths: 4,
            },
          }),
          row({
            id: 'waive',
            action: 'WAIVE_LATE_FEE',
            payload: {},
            reviewSummary: { lateFeeWaiverAmount: '50' },
          }),
        ],
      },
    });
    mount(<PaymentApprovalQueue />);
    await screen.findAllByRole('article');
    expect(screen.getByText('22,000.00 ฿')).toBeInTheDocument();
    expect(screen.getByText('1,200.00 ฿')).toBeInTheDocument();
    expect(screen.getByText('100.00 ฿')).toBeInTheDocument();
    expect(screen.getByText('50.00 ฿')).toBeInTheDocument();
  });
});

describe('shared request dialog', () => {
  it('requires a reason and sends the reviewed payload to the request endpoint without nominated users', async () => {
    const onRequested = vi.fn();
    const onOpenChange = vi.fn();
    mount(
      <PaymentApprovalRequestDialog
        open
        action="RECORD_PAYMENT"
        targetId="payment-2"
        payload={row().payload}
        onOpenChange={onOpenChange}
        onRequested={onRequested}
      />,
    );
    const dialog = screen.getByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'ส่งคำขออนุมัติ' });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: '  ขออนุมัติรับยอดนี้  ' },
    });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith('/payments/approval-requests', {
        action: 'RECORD_PAYMENT',
        targetId: 'payment-2',
        reason: 'ขออนุมัติรับยอดนี้',
        payload: row().payload,
      }),
    );
    await waitFor(() => expect(onRequested).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(state.post).toHaveBeenCalledTimes(1);
  });

  it('keeps the request reason and scope visible when creation fails', async () => {
    state.post.mockRejectedValue(new Error('มีคำขอรออนุมัติอยู่แล้ว'));
    const onOpenChange = vi.fn();
    mount(
      <PaymentApprovalRequestDialog
        open
        action="VOID_RECEIPT"
        targetId="receipt-1"
        payload={{}}
        initialReason="บันทึกผิด"
        description="ใบเสร็จอื่นของงวดเดียวกันจะถูกยกเลิกพร้อมกัน"
        onOpenChange={onOpenChange}
      />,
    );
    expect(screen.getByText('ใบเสร็จอื่นของงวดเดียวกันจะถูกยกเลิกพร้อมกัน')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ส่งคำขออนุมัติ' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('มีคำขอรออนุมัติอยู่แล้ว');
    expect(screen.getByRole('textbox')).toHaveValue('บันทึกผิด');
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
