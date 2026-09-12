import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { AxiosError } from 'axios';
import type { ContractQuote } from '@installment/shared';
import ContractCreatePage from './index';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: mocks, getErrorMessage: () => 'คำนวณไม่สำเร็จ' }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'quote-staff', role: 'OWNER' } }) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock('@/components/trade-in/TradeInCreditPicker', () => ({ default: () => null }));

const product = { id: 'product', branchId: 'branch', category: 'PHONE_NEW', name: 'Synthetic phone', brand: 'Test', model: 'One',
  status: 'IN_STOCK', installmentPrice: '10000', prices: [], branch: { id: 'branch', name: 'Test branch' } };
const customer = { id: 'customer', name: 'Synthetic customer', salaryPayDay: 31, activeContracts: 0, overdueContracts: 0 };
const config = { interestRate: '0.01', minDownPaymentPct: '0.15', storeCommissionPct: '0.1', vatPct: '0.07', minInstallmentMonths: 6, maxInstallmentMonths: 12 };
function quote(fingerprint = 'a'.repeat(64)): ContractQuote {
  return { fingerprint, sellingPrice: '10000.00', downPayment: '2000.00', cashDownPayment: '2000.00', tradeInCreditAmount: '0.00',
    configId: 'config', vatSource: 'BRANCH_COMPANY', effectiveVatPct: '0.0000', interestRate: '0.0100', storeCommissionPct: '0.1000',
    minDownPaymentPct: '0.1500', minInstallmentMonths: 6, maxInstallmentMonths: 12, ratePct: '0.06000000', principal: '8000.00',
    interestTotal: '480.00', storeCommission: '800.00', vatAmount: '0.00', totalPayable: '9280.00', monthlyPayment: '1546.66',
    lastPayment: '1546.70', totalMonths: 6, firstDueDate: '2026-10-30T17:00:00Z',
    schedule: Array.from({ length: 6 }, (_, index) => ({ installmentNo: index + 1, dueDate: '2026-10-30T17:00:00Z',
      amountDue: index === 5 ? '1546.70' : '1546.66', monthlyPrincipal: '0.00', monthlyInterest: '0.00', monthlyCommission: '0.00', vatAmount: '0.00' })),
  };
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/contracts/create']}><ContractCreatePage /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  localStorage.clear(); mocks.post.mockReset(); mocks.get.mockReset();
  localStorage.setItem('bestchoice-contract-draft:quote-staff', JSON.stringify({ step: 2, productId: product.id, customerId: customer.id,
    downPayment: 2000, totalMonths: 6, paymentDueDay: 31, notes: '', savedAt: new Date().toISOString() }));
  mocks.get.mockImplementation(async (url: string) => {
    if (url === '/products/product') return { data: product };
    if (url === '/customers/customer') return { data: customer };
    if (url.includes('/credit-check/latest')) return { data: { id: 'check', status: 'APPROVED', checkType: 'FULL',
      approvals: [{ id: 'approval', salaryPayDay: 31, approvedMonthlyPayment: '2000', supersededAt: null, usedByContractId: null }] } };
    if (url.startsWith('/interest-configs')) return { data: config };
    if (url === '/sales/config') return { data: config };
    return { data: { data: [] } };
  });
  mocks.post.mockImplementation(async (url: string) => ({ data: url === '/contracts/quote' ? quote() : { id: 'created' } }));
});

describe('contract quote and down receipt confirmation', () => {
  it('uses the server VAT/residual and sends the reviewed fingerprint and actual tender', async () => {
    mount();
    const submit = await screen.findByRole('button', { name: 'สร้างสัญญาและบันทึกรับดาวน์' });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(screen.getByText(/งวดสุดท้าย 1,546.70/)).toBeVisible();
    expect(screen.getByText('11,280.00 ฿')).toBeVisible();
    await userEvent.selectOptions(screen.getByLabelText('วิธีรับเงินดาวน์'), 'BANK_TRANSFER');
    await userEvent.type(screen.getByLabelText('เลขอ้างอิงการรับเงิน (ถ้ามี)'), 'SYNTHETIC-123');
    await userEvent.click(submit);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/contracts', expect.objectContaining({
      quoteFingerprint: 'a'.repeat(64), downPaymentMethod: 'BANK_TRANSFER', downPaymentReference: 'SYNTHETIC-123', downPayment: 2000,
    })));
  });
  it('blocks submission while a changed-input quote is loading or fails', async () => {
    mount();
    const submit = await screen.findByRole('button', { name: 'สร้างสัญญาและบันทึกรับดาวน์' });
    await waitFor(() => expect(submit).toBeEnabled());
    let reject!: (reason: Error) => void;
    mocks.post.mockImplementation(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    fireEvent.change(screen.getByLabelText(/เงินดาวน์ที่รับเป็นเงินสด\/โอน/), { target: { value: '3000' } });
    expect(submit).toBeDisabled();
    await waitFor(() => expect(reject).toBeDefined());
    reject(new Error('offline'));
    await screen.findByRole('button', { name: 'คำนวณอีกครั้ง' });
    expect(submit).toBeDisabled();
    expect(mocks.post.mock.calls.filter(([url]) => url === '/contracts')).toHaveLength(0);
  });
  it('requires another review after a 409 and never automatically retries creation', async () => {
    let changed = false;
    mocks.post.mockImplementation(async (url: string) => {
      if (url === '/contracts/quote') return { data: quote(changed ? 'b'.repeat(64) : 'a'.repeat(64)) };
      changed = true;
      throw new AxiosError('changed', 'ERR_BAD_REQUEST', undefined, undefined,
        { status: 409, data: { code: 'CONTRACT_QUOTE_CHANGED', quote: quote('b'.repeat(64)) } } as never);
    });
    mount();
    const submit = await screen.findByRole('button', { name: 'สร้างสัญญาและบันทึกรับดาวน์' });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);
    const reviewed = await screen.findByRole('button', { name: 'ตรวจยอดใหม่แล้ว' });
    await waitFor(() => expect(reviewed).toBeEnabled());
    expect(submit).toBeDisabled();
    expect(mocks.post.mock.calls.filter(([url]) => url === '/contracts')).toHaveLength(1);
    await userEvent.click(reviewed);
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    await waitFor(() => expect(mocks.post.mock.calls.filter(([url]) => url === '/contracts').slice(-1)[0]).toEqual(['/contracts', expect.objectContaining({ quoteFingerprint: 'b'.repeat(64) })]));
  });
});
