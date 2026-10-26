import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import SalesHistoryPage from '../SalesHistoryPage';

/**
 * ก้อน 4 — แผงใบขาย (`/sales?saleId=`) มีแถว "เอกสาร": พิมพ์ใบเสร็จ / ส่ง LINE / คัดลอกลิงก์
 * เฉพาะใบ CASH/EXTERNAL_FINANCE · ใบยกเลิกเหลือพิมพ์อย่างเดียว · ใบผ่อนไม่มีเลย (ใช้ใบเสร็จของสัญญา)
 */
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() } }));
vi.mock('@/utils/excel.util', () => ({ exportToExcel: vi.fn() }));
vi.mock('@/components/PdfPreview', () => ({ __esModule: true, default: () => null }));

const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => apiGet(...args), post: vi.fn() },
  getErrorMessage: () => 'เกิดข้อผิดพลาด',
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me', role: 'OWNER', branchId: 'b1' }, isLoading: false, isAuthenticated: true }),
}));

const detail = {
  id: 's1', saleNumber: 'SA-0001', saleType: 'CASH', sellingPrice: '10000', discount: '0', netAmount: '10000',
  paymentMethod: 'CASH', amountReceived: '10000', downPaymentAmount: null, financeCompany: null, financeRefNumber: null,
  financeAmount: null, notes: null, createdAt: '2026-08-20T03:00:00Z', deletedAt: null, voidReason: null, voidedBy: null,
  tradeInCreditSnapshot: null, receiptBreakdown: null, productDisclosure: null,
  customer: { id: 'c1', name: 'ลูกค้า ก', phone: '0800000000' },
  product: { id: 'p1', name: 'iPhone', brand: 'Apple', model: '15', imeiSerial: '3591', serialNumber: null },
  branch: { id: 'b1', name: 'ลาดพร้าว' }, salesperson: { id: 'u1', name: 'พนักงาน ข' }, contract: null,
};

function renderSheet(saleDetail: Record<string, unknown>) {
  apiGet.mockImplementation(async (url: unknown) => {
    if (typeof url !== 'string') return { data: [] };
    if (url.startsWith('/sales/s1')) return { data: saleDetail };
    if (url.startsWith('/sales?')) {
      return { data: { data: [saleDetail], total: 1, page: 1, limit: 20, totalPages: 1, summary: {
        totalAmount: 10000, totalDiscount: 0, totalProfit: 0, cashCount: 1, cashAmount: 10000,
        installmentCount: 0, installmentAmount: 0, financeCount: 0, financeAmount: 0 } } };
    }
    return { data: [] };
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/sales?saleId=s1']}>
        <SalesHistoryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => apiGet.mockReset());

describe('SalesHistoryPage — เอกสารใบเสร็จในแผงใบขาย', () => {
  it('shows print / LINE / copy-link for a live cash sale', async () => {
    renderSheet(detail);
    await screen.findByText('รายละเอียดใบขาย');
    expect(await screen.findByRole('button', { name: 'พิมพ์ใบเสร็จ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ส่ง LINE' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'คัดลอกลิงก์' })).toBeInTheDocument();
  });

  it('keeps only the print button on a voided sale', async () => {
    renderSheet({ ...detail, deletedAt: '2026-08-22T03:00:00Z', voidReason: 'คีย์ผิด', voidedBy: { id: 'u9', name: 'สมชาย' } });
    await screen.findByText('รายละเอียดใบขาย');
    expect(await screen.findByRole('button', { name: 'พิมพ์ใบเสร็จ' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ส่ง LINE' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'คัดลอกลิงก์' })).toBeNull();
  });

  it('shows no receipt actions for an installment sale', async () => {
    renderSheet({ ...detail, saleType: 'INSTALLMENT' });
    await screen.findByText('รายละเอียดใบขาย');
    await screen.findByText('พนักงาน: พนักงาน ข');
    expect(screen.queryByRole('button', { name: 'พิมพ์ใบเสร็จ' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'ส่ง LINE' })).toBeNull();
  });
});
