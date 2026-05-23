import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ImeiLookupStep } from '../WizardSteps/ImeiLookupStep';
import api from '@/lib/api';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// useAuth mock — default to SALES role; tests can override per case
const useAuthMock = vi.fn(() => ({ user: { role: 'SALES', branchId: 'br-A' } }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

function renderWith(props: Partial<React.ComponentProps<typeof ImeiLookupStep>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onRepairChosen = vi.fn();
  return {
    onRepairChosen,
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ImeiLookupStep onRepairChosen={onRepairChosen} {...props} />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

describe('ImeiLookupStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ user: { role: 'SALES', branchId: 'br-A' } });
  });

  it('blocks lookup when IMEI < 4 chars', async () => {
    renderWith();
    fireEvent.change(screen.getByPlaceholderText(/359/), { target: { value: 'abc' } });
    fireEvent.click(screen.getByText('ค้นหา'));
    await waitFor(() => expect(api.get).not.toHaveBeenCalled());
  });

  it('shows block message when IMEI not found', async () => {
    (api.get as any).mockResolvedValue({ data: { found: false } });
    renderWith();
    fireEvent.change(screen.getByPlaceholderText(/359/), { target: { value: '999999' } });
    fireEvent.click(screen.getByText('ค้นหา'));
    expect(await screen.findByText(/ไม่พบเครื่องในระบบ/)).toBeInTheDocument();
  });

  it('CASH sale: BOTH buttons shown (exchange = upgrade flow, works for all channels)', async () => {
    (api.get as any).mockResolvedValue({
      data: {
        found: true,
        product: { id: 'p1', brand: 'iPhone', model: '15', storage: '256GB', imeiSerial: '123456' },
        sale: { id: 's1', saleType: 'CASH' },
        customer: { id: 'c1', name: 'สมชาย', phone: '0800000000' },
        contract: null,
        warrantyStatus: 'OUT_OF_WARRANTY',
        daysRemainingIn7Day: null,
      },
    });
    renderWith();
    fireEvent.change(screen.getByPlaceholderText(/359/), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('ค้นหา'));
    expect(await screen.findByText('สมชาย')).toBeInTheDocument();
    expect(screen.getByText('ซื้อสด')).toBeInTheDocument();
    expect(screen.getByText('รับเข้าซ่อม')).toBeInTheDocument();
    // Owner clarified: เปลี่ยนเครื่อง = upgrade flow works for CASH too —
    // SP2 destination uses old contract's yodjat+commission as buyback value.
    expect(screen.getByText('เปลี่ยนเครื่อง').closest('button')).not.toBeDisabled();
  });

  it('disables เปลี่ยนเครื่อง for GFIN (EXTERNAL_FINANCE)', async () => {
    (api.get as any).mockResolvedValue({
      data: {
        found: true,
        product: { id: 'p1', brand: 'X', model: 'Y', storage: null, imeiSerial: '999' },
        sale: { id: 's1', saleType: 'EXTERNAL_FINANCE' },
        customer: null,
        contract: null,
        warrantyStatus: null,
        daysRemainingIn7Day: null,
      },
    });
    renderWith();
    fireEvent.change(screen.getByPlaceholderText(/359/), { target: { value: '99901' } });
    fireEvent.click(screen.getByText('ค้นหา'));
    await screen.findByText('GFIN');
    expect(screen.getByText('เปลี่ยนเครื่อง').closest('button')).toBeDisabled();
  });

  it('F4: disables เปลี่ยนเครื่อง when contract is CANCELED', async () => {
    (api.get as any).mockResolvedValue({
      data: {
        found: true,
        product: { id: 'p1', brand: 'X', model: 'Y', storage: null, imeiSerial: '12345' },
        sale: { id: 's1', saleType: 'INSTALLMENT' },
        customer: { id: 'c1', name: 'A', phone: '0' },
        contract: { id: 'ctr', contractNumber: 'BC-CANCELED', status: 'CANCELED' },
        warrantyStatus: 'IN_7DAY_DEFECT',
        daysRemainingIn7Day: 5,
      },
    });
    renderWith();
    fireEvent.change(screen.getByPlaceholderText(/359/), { target: { value: '12345' } });
    fireEvent.click(screen.getByText('ค้นหา'));
    await screen.findByText('BC-CANCELED');
    expect(screen.getByText('เปลี่ยนเครื่อง').closest('button')).toBeDisabled();
  });

  it('F3: disables เปลี่ยนเครื่อง for SALES when outside 7-day defect window', async () => {
    useAuthMock.mockReturnValue({ user: { role: 'SALES', branchId: 'br-A' } });
    (api.get as any).mockResolvedValue({
      data: {
        found: true,
        product: { id: 'p1', brand: 'X', model: 'Y', storage: null, imeiSerial: '54321' },
        sale: { id: 's1', saleType: 'INSTALLMENT' },
        customer: { id: 'c1', name: 'A', phone: '0' },
        contract: { id: 'ctr', contractNumber: 'BC-LATE', status: 'ACTIVE' },
        warrantyStatus: 'IN_SHOP_WARRANTY',
        daysRemainingIn7Day: 0,
      },
    });
    renderWith();
    fireEvent.change(screen.getByPlaceholderText(/359/), { target: { value: '54321' } });
    fireEvent.click(screen.getByText('ค้นหา'));
    await screen.findByText('BC-LATE');
    expect(screen.getByText('เปลี่ยนเครื่อง').closest('button')).toBeDisabled();
  });

  it('F3: ENABLES เปลี่ยนเครื่อง for OWNER when outside 7-day window (bypass)', async () => {
    useAuthMock.mockReturnValue({ user: { role: 'OWNER', branchId: 'br-A' } });
    (api.get as any).mockResolvedValue({
      data: {
        found: true,
        product: { id: 'p1', brand: 'X', model: 'Y', storage: null, imeiSerial: '54321' },
        sale: { id: 's1', saleType: 'INSTALLMENT' },
        customer: { id: 'c1', name: 'A', phone: '0' },
        contract: { id: 'ctr', contractNumber: 'BC-LATE', status: 'ACTIVE' },
        warrantyStatus: 'IN_SHOP_WARRANTY',
        daysRemainingIn7Day: 0,
      },
    });
    renderWith();
    fireEvent.change(screen.getByPlaceholderText(/359/), { target: { value: '54321' } });
    fireEvent.click(screen.getByText('ค้นหา'));
    await screen.findByText('BC-LATE');
    expect(screen.getByText('เปลี่ยนเครื่อง').closest('button')).not.toBeDisabled();
  });

  it('calls onRepairChosen when repair button clicked', async () => {
    (api.get as any).mockResolvedValue({
      data: {
        found: true,
        product: { id: 'p1', brand: 'X', model: 'Y', storage: null, imeiSerial: '12345' },
        sale: { id: 's1', saleType: 'INSTALLMENT' },
        customer: { id: 'c1', name: 'A', phone: '0' },
        contract: { id: 'ctr', contractNumber: 'BC-1', status: 'ACTIVE' },
        warrantyStatus: 'IN_7DAY_DEFECT',
        daysRemainingIn7Day: 5,
      },
    });
    const { onRepairChosen } = renderWith();
    fireEvent.change(screen.getByPlaceholderText(/359/), { target: { value: '12345' } });
    fireEvent.click(screen.getByText('ค้นหา'));
    await screen.findByText('BC-1');
    fireEvent.click(screen.getByText('รับเข้าซ่อม'));
    expect(onRepairChosen).toHaveBeenCalledOnce();
  });
});
