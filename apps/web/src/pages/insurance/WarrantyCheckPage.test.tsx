import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import api from '@/lib/api';
import WarrantyCheckPage from './WarrantyCheckPage';

// ── Mocks ────────────────────────────────────────────────────────────────────

let mockRole = 'SALES';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', role: mockRole, branchId: 'b-1' },
    isLoading: false,
    isAuthenticated: true,
  }),
}));

vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn(),
  },
  getErrorMessage: (e: unknown) => String(e),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Stub WarrantyWindowCard so we can assert its presence without full render
vi.mock('./components/WarrantyWindowCard', () => ({
  WarrantyWindowCard: ({ windows }: { windows: Record<string, unknown> }) => (
    <div data-testid="warranty-window-card" data-windows={JSON.stringify(windows)} />
  ),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function renderWith() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/insurance/warranty-check']}>
        <Routes>
          <Route path="/insurance/warranty-check" element={<WarrantyCheckPage />} />
          <Route path="/insurance/new" element={<div data-testid="wizard-page">Wizard</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const deviceResult = {
  product: { id: 'prod-1', brand: 'Apple', model: 'iPhone 15', imeiSerial: '123456789012345' },
  contract: { id: 'ct-1', contractNumber: 'CN-2026-0001', status: 'ACTIVE' },
  warrantyWindows: { sevenDayDefect: 5, shopWarranty: 45, mfrWarranty: 300 },
  eligibility: { forExchange: true, forRepair: true },
};

const deviceNoExchange = {
  ...deviceResult,
  product: { ...deviceResult.product, id: 'prod-2' },
  eligibility: { forExchange: false, forRepair: true },
};

beforeEach(() => {
  mockRole = 'SALES';
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WarrantyCheckPage', () => {
  it('renders 3 search mode tabs: ลูกค้า / IMEI/Serial / เลขสัญญา', () => {
    renderWith();
    expect(screen.getByRole('button', { name: 'ลูกค้า' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'IMEI/Serial' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'เลขสัญญา' })).toBeInTheDocument();
  });

  it('submit button is disabled when query is shorter than 3 chars', () => {
    renderWith();
    const input = screen.getByRole('textbox');
    const submitBtn = screen.getByRole('button', { name: /ค้นหา/ });

    // empty → disabled
    expect(submitBtn).toBeDisabled();

    // 2 chars → still disabled
    fireEvent.change(input, { target: { value: 'ab' } });
    expect(submitBtn).toBeDisabled();

    // 3 chars → enabled
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(submitBtn).not.toBeDisabled();
  });

  it('IMEI lookup returns 1 device → renders product info + WarrantyWindowCard', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: {
        customer: { id: 'cust-1', name: 'สมชาย ใจดี', phone: '0812345678' },
        devices: [deviceResult],
      },
    });

    renderWith();

    // Type IMEI and submit
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '123456789012345' } });
    fireEvent.click(screen.getByRole('button', { name: /ค้นหา/ }));

    await waitFor(() => {
      expect(screen.getByText('Apple iPhone 15')).toBeInTheDocument();
    });

    expect(screen.getByText('IMEI: 123456789012345')).toBeInTheDocument();
    expect(screen.getByText('สัญญา: CN-2026-0001')).toBeInTheDocument();
    expect(screen.getByTestId('warranty-window-card')).toBeInTheDocument();
  });

  it('empty devices array → shows "ไม่พบเครื่องในระบบ" empty state', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: { customer: null, devices: [] },
    });

    renderWith();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'NOT-FOUND-IMEI' } });
    fireEvent.click(screen.getByRole('button', { name: /ค้นหา/ }));

    await waitFor(() => {
      expect(screen.getByText('ไม่พบเครื่องในระบบ')).toBeInTheDocument();
    });
  });

  it('SALES role — CTA "ส่งซ่อม" visible + "เปลี่ยนเครื่อง" visible when eligibility.forExchange = true', async () => {
    mockRole = 'SALES';
    vi.mocked(api.get).mockResolvedValueOnce({
      data: { customer: null, devices: [deviceResult] },
    });

    renderWith();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '123456789012345' } });
    fireEvent.click(screen.getByRole('button', { name: /ค้นหา/ }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /ส่งซ่อม/ })).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /เปลี่ยนเครื่อง/ })).toBeInTheDocument();
  });

  it('SALES role — "เปลี่ยนเครื่อง" hidden when eligibility.forExchange = false', async () => {
    mockRole = 'SALES';
    vi.mocked(api.get).mockResolvedValueOnce({
      data: { customer: null, devices: [deviceNoExchange] },
    });

    renderWith();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '987654321012345' } });
    fireEvent.click(screen.getByRole('button', { name: /ค้นหา/ }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /ส่งซ่อม/ })).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /เปลี่ยนเครื่อง/ })).not.toBeInTheDocument();
  });

  it('ACCOUNTANT role — no CTA buttons rendered (read-only view)', async () => {
    mockRole = 'ACCOUNTANT';
    vi.mocked(api.get).mockResolvedValueOnce({
      data: { customer: null, devices: [deviceResult] },
    });

    renderWith();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '123456789012345' } });
    fireEvent.click(screen.getByRole('button', { name: /ค้นหา/ }));

    await waitFor(() => {
      expect(screen.getByText('Apple iPhone 15')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /ส่งซ่อม/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /เปลี่ยนเครื่อง/ })).not.toBeInTheDocument();
  });

  it('switching search mode resets query and clears previous results', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: { customer: null, devices: [deviceResult] },
    });

    renderWith();

    // Search in IMEI mode
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '123456789012345' } });
    fireEvent.click(screen.getByRole('button', { name: /ค้นหา/ }));

    await waitFor(() => {
      expect(screen.getByText('Apple iPhone 15')).toBeInTheDocument();
    });

    // Switch to contract mode
    fireEvent.click(screen.getByRole('button', { name: 'เลขสัญญา' }));

    // Input should be cleared
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
    // Results should be cleared (no result card visible)
    expect(screen.queryByText('Apple iPhone 15')).not.toBeInTheDocument();
  });
});
