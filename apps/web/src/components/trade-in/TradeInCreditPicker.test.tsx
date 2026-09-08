import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TradeInCreditPicker from './TradeInCreditPicker';
import api from '@/lib/api';

vi.mock('@/lib/api', () => ({ default: { get: vi.fn() } }));
const credit = { id: 'credit-1', voucherNumber: 'EXP-1', deviceLabel: 'Test phone',
  baseAmount: '5000', bonusAmount: '500', totalAmount: '5500' };
function setup(value = 'credit-1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChange = vi.fn();
  const onResolved = vi.fn();
  render(<QueryClientProvider client={client}><TradeInCreditPicker customerId="customer-1"
    branchId="branch-1" productId="product-1" value={value} onChange={onChange} onResolved={onResolved} /></QueryClientProvider>);
  return { onChange, onResolved };
}
describe('Trade-in credit choice', () => {
  beforeEach(() => vi.clearAllMocks());
  it('resolves a restored choice only after checking current availability', async () => {
    let resolve!: (value: { data: typeof credit[] }) => void;
    vi.mocked(api.get).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { onResolved } = setup();
    expect(onResolved).toHaveBeenLastCalledWith(null);
    resolve({ data: [credit] });
    await waitFor(() => expect(onResolved).toHaveBeenLastCalledWith(credit));
    expect(api.get).toHaveBeenCalledWith('/trade-ins/credits', { params: { customerId: 'customer-1', branchId: 'branch-1' } });
  });
  it('keeps an already spent choice unresolved', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    const { onResolved } = setup();
    expect(await screen.findByText(/เครดิตที่เลือกยังไม่พร้อมใช้/)).toBeVisible();
    expect(onResolved).toHaveBeenLastCalledWith(null);
  });
  it('lets staff remove a selected credit when availability cannot be checked', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    const { onChange, onResolved } = setup();
    await screen.findByText(/ตรวจเครดิตไม่ได้/);
    await userEvent.selectOptions(screen.getByLabelText('เครดิตเครื่องเทิร์นของลูกค้า'), '');
    expect(onChange).toHaveBeenCalledWith('');
    expect(onResolved).toHaveBeenLastCalledWith(null);
  });
});
