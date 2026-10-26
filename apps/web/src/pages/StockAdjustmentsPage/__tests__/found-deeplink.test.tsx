import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import StockAdjustmentsPage from '../index';

/** ก้อน 8 A10 — ถังขยะส่งมาที่ `/stock/adjustments?request=found&q=<imei>` → เปิดฟอร์มคำขอ "พบของคืน" พร้อมค้น IMEI ให้ */
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => apiGet(...args), post: vi.fn() },
  getErrorMessage: () => 'เกิดข้อผิดพลาด',
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-owner', role: 'OWNER', branchId: null }, isLoading: false, isAuthenticated: true }) }));

function open(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/stock/adjustments" element={<StockAdjustmentsPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockImplementation(async (path: string) => (String(path).includes('lookup') ? { data: [] } : { data: { data: [], total: 0, page: 1, totalPages: 1 } }));
});

describe('stock adjustments — FOUND deep link from the trash bin', () => {
  it('F1 ?request=found&q=35123 opens the request dialog with reason พบของคืน and the IMEI prefilled', async () => {
    open('/stock/adjustments?request=found&q=35123');
    expect(await screen.findByRole('radio', { name: 'พบของคืน' })).toBeChecked();
    expect(screen.getByDisplayValue('35123')).toBeInTheDocument();
    await waitFor(() => {
      const lookupCall = apiGet.mock.calls.find(([path]) => String(path).includes('lookup'));
      expect(lookupCall).toBeDefined();
      expect(JSON.stringify(lookupCall![1])).toContain('35123');
      expect(JSON.stringify(lookupCall![1])).toContain('FOUND');
    });
  });

  it('F2 without the param the dialog stays closed', async () => {
    open('/stock/adjustments');
    await screen.findByRole('button', { name: /ขอตัดสินค้า|สร้างคำขอ|ส่งคำขอ/ });
    expect(screen.queryByRole('radio', { name: 'พบของคืน' })).not.toBeInTheDocument();
  });
});
