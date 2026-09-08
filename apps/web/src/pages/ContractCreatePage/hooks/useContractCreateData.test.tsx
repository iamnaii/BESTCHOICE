import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import { useContractCreateData } from './useContractCreateData';
import { useContractCalculation } from './useContractCalculation';

const mocks = vi.hoisted(() => ({ get: vi.fn(), userId: 'staff-a' }));
vi.mock('@/lib/api', () => ({ default: { get: mocks.get, post: vi.fn(), patch: vi.fn() }, getErrorMessage: () => 'error' }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: mocks.userId, role: 'SALES' } }) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

const product = { id: 'product-a', name: 'Phone', category: 'PHONE', status: 'IN_STOCK', installmentPrice: '10000', prices: [] };
const customer = { id: 'customer-a', name: 'Customer', salaryPayDay: 20 };
let credit: unknown;
const saved = { step: 2, customerId: customer.id, productId: product.id, fromRoom: 'room-a', downPayment: 3500,
  totalMonths: 18, paymentDueDay: 20, notes: 'internal draft notes', savedAt: new Date().toISOString() };
function mount(path: string, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>{children}</MemoryRouter></QueryClientProvider>;
  return { client, ...renderHook(() => {
    const data = useContractCreateData();
    useContractCalculation({ selectedProduct: data.selectedProduct, interestConfig: data.interestConfig,
      posConfig: data.posConfig, downPayment: data.downPayment, setDownPayment: data.setDownPayment,
      totalMonths: data.totalMonths, setTotalMonths: data.setTotalMonths,
      preserveDownPayment: data.preserveDownPayment, configPending: data.configPending });
    return { ...data, location: useLocation() };
  }, { wrapper }) };
}

beforeEach(() => {
  localStorage.clear();
  mocks.userId = 'staff-a';
  credit = null;
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    if (path === `/products/${product.id}`) return { data: product };
    if (path === `/customers/${customer.id}`) return { data: customer };
    if (path.endsWith('/credit-check/latest')) return { data: credit };
    if (path.startsWith('/interest-configs/')) return { data: { interestRate: '0.01', minDownPaymentPct: '0.15', storeCommissionPct: '0.1', vatPct: '0.07', minInstallmentMonths: 6, maxInstallmentMonths: 24 } };
    if (path === '/sales/config') return { data: { minInstallmentMonths: 6, maxInstallmentMonths: 12 } };
    return { data: { data: [] } }; // Selected IDs intentionally absent from paginated search results.
  });
});

describe('contract → credit → contract', () => {
  it('saves immediately, restores IDs/plan from cache and rechecks fresh approval without trusting URL', async () => {
    const first = mount(`/contracts/create?customerId=${customer.id}&productId=${product.id}&fromRoom=room-a&downAmount=3500&months=18&creditApproved=true`);
    await waitFor(() => expect(first.result.current.selectedProduct?.id).toBe(product.id));
    await waitFor(() => expect(first.result.current.configPending).toBe(false));
    expect(first.result.current.customerCreditApproved).toBe(false);
    act(() => { first.result.current.setStep(1); first.result.current.setNotes('new notes'); });
    act(() => first.result.current.openCustomerCredit());
    expect(first.result.current.location.pathname).toBe(`/customers/${customer.id}`);
    const target = new URLSearchParams(first.result.current.location.search).get('returnTo')!;
    expect(target).toContain('fromRoom=room-a');
    expect(target).not.toContain('new notes');
    const stored = JSON.parse(localStorage.getItem('bestchoice-contract-draft:staff-a')!);
    expect(stored).toMatchObject({ notes: 'new notes', downPayment: 3500, totalMonths: 18, step: 1 });
    first.unmount();
    credit = { id: 'credit-a', status: 'APPROVED', checkType: 'FULL', approvals: [{ id: 'approval-a', salaryPayDay: 25, approvedMonthlyPayment: '2500', supersededAt: null, usedByContractId: null }] };
    const returned = mount(target, first.client);
    await waitFor(() => expect(returned.result.current.selectedCustomer?.id).toBe(customer.id));
    await waitFor(() => expect(returned.result.current.creditApproval?.id).toBe('approval-a'));
    await waitFor(() => expect(returned.result.current.paymentDueDay).toBe(25));
    expect(returned.result.current.selectedProduct?.id).toBe(product.id);
    expect(returned.result.current).toMatchObject({ notes: 'new notes', downPayment: 3500, totalMonths: 18, step: 1 });
    expect(returned.result.current.customerSearch).toBe('');
    expect(returned.result.current.productSearch).toBe('');
    expect(mocks.get).toHaveBeenCalledWith(`/customers/${customer.id}/credit-check/latest`);
  });

  it('does not mix a fresh Inbox proposal with an old draft', async () => {
    localStorage.setItem('bestchoice-contract-draft:staff-a', JSON.stringify(saved));
    const { result } = mount(`/contracts/create?customerId=${customer.id}&productId=${product.id}&fromRoom=room-new`);
    await waitFor(() => expect(result.current.selectedProduct?.id).toBe(product.id));
    expect(result.current.notes).toBe('');
    expect(result.current.step).toBe(0);
    expect(result.current.totalMonths).toBe(6);
  });

  it('does not resume another room proposal with matching customer and product IDs', async () => {
    localStorage.setItem('bestchoice-contract-draft:staff-a', JSON.stringify(saved));
    const { result } = mount(`/contracts/create?customerId=${customer.id}&productId=${product.id}&fromRoom=room-new&resume=1`);
    await waitFor(() => expect(result.current.selectedProduct?.id).toBe(product.id));
    expect(result.current.notes).toBe('');
    expect(result.current.fromRoom).toBe('room-new');
  });

  it('keeps an explicit clear when an earlier customer restore finishes later', async () => {
    let resolveCustomer!: (value: { data: typeof customer }) => void;
    const pendingCustomer = new Promise<{ data: typeof customer }>(resolve => { resolveCustomer = resolve; });
    const original = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation((path: string) => path === `/customers/${customer.id}` ? pendingCustomer : original(path));
    const { result } = mount(`/contracts/create?customerId=${customer.id}&productId=${product.id}`);
    await waitFor(() => expect(result.current.selectedProduct?.id).toBe(product.id));
    act(() => result.current.setSelectedCustomer(null));
    await act(async () => { resolveCustomer({ data: customer }); await pendingCustomer; });
    expect(result.current.selectedCustomer).toBeNull();
  });

  it('does not autosave the original customer after staff explicitly clear the selection', async () => {
    vi.useFakeTimers();
    const mounted = mount(`/contracts/create?customerId=${customer.id}&productId=${product.id}`);
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      expect(mounted.result.current.selectedCustomer?.id).toBe(customer.id);
      act(() => mounted.result.current.setSelectedCustomer(null));
      act(() => vi.advanceTimersByTime(30_000));
      expect(JSON.parse(localStorage.getItem('bestchoice-contract-draft:staff-a')!)).not.toHaveProperty('customerId');
    } finally { mounted.unmount(); vi.useRealTimers(); }
  });

  it('does not accept cached approval while the fresh credit request is pending or denied', async () => {
    let rejectCredit!: (reason: Error) => void;
    const pendingCredit = new Promise((_, reject) => { rejectCredit = reject; });
    const original = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation((path: string) => path.endsWith('/credit-check/latest') ? pendingCredit : original(path));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['customer-latest-credit', customer.id], {
      id: 'old-credit', status: 'APPROVED', checkType: 'FULL',
      approvals: [{ id: 'old-approval', salaryPayDay: 25, approvedMonthlyPayment: '2500' }],
    });
    const { result } = mount(`/contracts/create?customerId=${customer.id}&productId=${product.id}`, client);
    await waitFor(() => expect(result.current.selectedCustomer?.id).toBe(customer.id));
    expect(result.current.customerCreditApproved).toBe(false);
    await act(async () => { rejectCredit(new Error('forbidden')); });
    expect(result.current.customerCreditApproved).toBe(false);
  });

  it('does not restore another employee or the legacy unscoped draft', () => {
    localStorage.setItem('bestchoice-contract-draft:staff-a', JSON.stringify(saved));
    localStorage.setItem('bestchoice-contract-draft', JSON.stringify(saved));
    mocks.userId = 'staff-b';
    const { result } = mount('/contracts/create');
    expect(result.current.notes).toBe('');
    expect(result.current.selectedCustomer).toBeNull();
  });

  it('returns to stock selection when the saved product is no longer available', async () => {
    localStorage.setItem('bestchoice-contract-draft:staff-a', JSON.stringify(saved));
    const original = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation((path: string) => path === `/products/${product.id}` ? Promise.resolve({ data: { ...product, status: 'SOLD' } }) : original(path));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['preselect-product', 'staff-a', product.id], product); // Old cache still says IN_STOCK.
    const { result } = mount('/contracts/create', client);
    await waitFor(() => expect(result.current.step).toBe(0));
    expect(result.current.selectedProduct).toBeNull();
    await waitFor(() => expect(result.current.selectedCustomer?.id).toBe(customer.id));
    act(() => result.current.openCustomerCredit());
    expect(JSON.parse(localStorage.getItem('bestchoice-contract-draft:staff-a')!)).not.toHaveProperty('productId');
  });

  it('does not revive a cached customer after the fresh ID request is denied', async () => {
    localStorage.setItem('bestchoice-contract-draft:staff-a', JSON.stringify(saved));
    const original = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation((path: string) => path === `/customers/${customer.id}`
      ? Promise.reject(new Error('forbidden')) : original(path));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['preselect-customer', 'staff-a', customer.id], customer);
    const { result } = mount('/contracts/create', client);
    await waitFor(() => expect(result.current.step).toBe(1));
    expect(result.current.selectedCustomer).toBeNull();
    expect(result.current.customerCreditApproved).toBe(false);
  });

  it('keeps the current form open if browser storage rejects the synchronous save', async () => {
    const { result } = mount(`/contracts/create?customerId=${customer.id}&productId=${product.id}`);
    await waitFor(() => expect(result.current.selectedCustomer).not.toBeNull());
    const fail = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    act(() => result.current.openCustomerCredit());
    expect(result.current.location.pathname).toBe('/contracts/create');
    fail.mockRestore();
  });
});
