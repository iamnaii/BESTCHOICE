import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import SalesHistoryPage from '../SalesHistoryPage';

/**
 * Task 6 (void-sale) — ปุ่ม "ยกเลิกใบขาย" + สวิตช์ "แสดงใบที่ยกเลิกแล้ว" บนหน้าประวัติการขาย.
 * ปักว่า: (1) ปุ่มเห็นเฉพาะ OWNER/BRANCH_MANAGER และเฉพาะใบ CASH/EXTERNAL_FINANCE
 * ที่ยังไม่ถูกยกเลิก (2) ไดอะล็อกบังคับเหตุผล ≥10 ตัวอักษร ตรงกับ DTO ฝั่ง API
 * (3) สวิตช์ส่ง includeVoided=true (4) แถวที่ยกเลิกแสดงป้าย+เหตุผล+คนกด
 * (5) ข้อความ error จาก server แสดงตรง ๆ ใน toast
 */

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    loading: vi.fn(),
  },
}));

const exportToExcel = vi.fn();
vi.mock('@/utils/excel.util', () => ({
  exportToExcel: (...a: unknown[]) => exportToExcel(...a),
}));

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
  getErrorMessage: (err: unknown) => {
    const e = err as { response?: { data?: { message?: string } } };
    return e?.response?.data?.message ?? 'เกิดข้อผิดพลาด';
  },
}));

let mockRole = 'OWNER';
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'me', role: mockRole, branchId: 'b1' },
    isLoading: false,
    isAuthenticated: true,
  }),
}));

const saleRow = {
  id: 's1',
  saleNumber: 'SA-0001',
  saleType: 'CASH',
  sellingPrice: '10000',
  discount: '0',
  netAmount: '10000',
  paymentMethod: 'CASH',
  amountReceived: '10000',
  downPaymentAmount: null,
  financeCompany: null,
  financeRefNumber: null,
  financeAmount: null,
  notes: null,
  createdAt: '2026-08-20T03:00:00Z',
  deletedAt: null,
  voidReason: null,
  voidedBy: null,
  customer: { id: 'c1', name: 'ลูกค้า ก', phone: '0800000000' },
  product: { id: 'p1', name: 'iPhone', brand: 'Apple', model: '15', imeiSerial: '3591', serialNumber: null },
  branch: { id: 'b1', name: 'ลาดพร้าว' },
  salesperson: { id: 'u1', name: 'พนักงาน ข' },
  contract: null,
};

function mockSales(rows: Array<Record<string, unknown>>) {
  apiGet.mockImplementation(async (url: string) => {
    if (url.startsWith('/sales?')) {
      return {
        data: {
          data: rows,
          total: rows.length,
          page: 1,
          limit: 20,
          totalPages: 1,
          summary: {
            totalAmount: 10000, totalDiscount: 0, totalProfit: 0,
            cashCount: 1, cashAmount: 10000, installmentCount: 0, installmentAmount: 0,
            financeCount: 0, financeAmount: 0,
          },
        },
      };
    }
    return { data: [] };
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function renderWithRole(role: string, rows: Array<Record<string, unknown>> = [saleRow]) {
  mockRole = role;
  mockSales(rows);
  return render(<SalesHistoryPage />, { wrapper });
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  exportToExcel.mockReset();
  exportToExcel.mockResolvedValue(undefined);
});

describe('SalesHistoryPage — Excel export กับใบที่ยกเลิก', () => {
  const voidedRow = {
    ...saleRow, id: 's2', saleNumber: 'SA-0002',
    deletedAt: '2026-08-22T03:00:00Z', voidReason: 'คีย์ผิดรุ่นเครื่อง', voidedBy: { id: 'u9', name: 'สมชาย' },
  };

  it('ปิดสวิตช์ → ไฟล์ไม่มีคอลัมน์สถานะใบ (คอลัมน์เดิมทุกประการ)', async () => {
    renderWithRole('OWNER');
    await screen.findByText(/SA-0001/);
    await userEvent.click(screen.getByRole('button', { name: /ส่งออก Excel/ }));
    await waitFor(() => expect(exportToExcel).toHaveBeenCalled());
    const headers = exportToExcel.mock.calls[0][0].columns.map((c: { header: string }) => c.header);
    expect(headers).not.toContain('สถานะใบ');
  });

  it('เปิดสวิตช์ → มีคอลัมน์สถานะใบ/ยกเลิกเมื่อ/เหตุผลยกเลิก และแถวยกเลิกได้ค่า "ยกเลิกแล้ว"', async () => {
    renderWithRole('OWNER', [saleRow, voidedRow]);
    await screen.findByText(/SA-0001/);
    await userEvent.click(screen.getByLabelText(/แสดงใบที่ยกเลิกแล้ว/));
    await userEvent.click(screen.getByRole('button', { name: /ส่งออก Excel/ }));
    await waitFor(() => expect(exportToExcel).toHaveBeenCalled());
    const arg = exportToExcel.mock.calls[0][0];
    const headers = arg.columns.map((c: { header: string }) => c.header);
    expect(headers).toEqual(expect.arrayContaining(['สถานะใบ', 'ยกเลิกเมื่อ', 'เหตุผลยกเลิก', 'ผู้ยกเลิก']));
    const active = arg.data.find((r: { saleNumber: string }) => r.saleNumber === 'SA-0001');
    const voided = arg.data.find((r: { saleNumber: string }) => r.saleNumber === 'SA-0002');
    expect(active.voidStatus).toBe('ใช้อยู่');
    expect(voided.voidStatus).toBe('ยกเลิกแล้ว');
    expect(voided.voidReason).toBe('คีย์ผิดรุ่นเครื่อง');
    expect(voided.voidedBy).toBe('สมชาย');
    expect(voided.voidedAt).not.toBe('-');
  });
});

describe('SalesHistoryPage — ยกเลิกใบขาย', () => {
  it('ปุ่มยกเลิกใบขายเห็นเฉพาะ OWNER/BRANCH_MANAGER', async () => {
    renderWithRole('BRANCH_MANAGER');
    expect(await screen.findByRole('button', { name: /ยกเลิกใบขาย/ })).toBeInTheDocument();
  });

  it('SALES ไม่เห็นปุ่ม', async () => {
    renderWithRole('SALES');
    await screen.findByText(/SA-0001/);
    expect(screen.queryByRole('button', { name: /ยกเลิกใบขาย/ })).not.toBeInTheDocument();
  });

  it('ใบ INSTALLMENT ไม่มีปุ่ม (ใช้เส้นทางยกเลิกสัญญาแทน)', async () => {
    renderWithRole('OWNER', [
      { ...saleRow, saleType: 'INSTALLMENT', contract: { id: 'ct1', contractNumber: 'CT-1', status: 'ACTIVE', monthlyPayment: '1000', totalMonths: 10 } },
    ]);
    await screen.findByText(/SA-0001/);
    expect(screen.queryByRole('button', { name: /ยกเลิกใบขาย/ })).not.toBeInTheDocument();
  });

  it('ไดอะล็อกบังคับเหตุผลอย่างน้อย 10 ตัวอักษร', async () => {
    renderWithRole('OWNER');
    await userEvent.click(await screen.findByRole('button', { name: /ยกเลิกใบขาย/ }));
    const confirm = screen.getByRole('button', { name: /ยืนยันยกเลิก/ });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: /เหตุผล/ }), 'คีย์ผิด');
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: /เหตุผล/ }), 'รุ่นเครื่อง');
    expect(confirm).toBeEnabled();
  });

  it('ยืนยัน → POST /sales/:id/void พร้อมเหตุผล + toast เลขใบขาย', async () => {
    apiPost.mockResolvedValue({ data: { saleNumber: 'SA-0001', restoredProductIds: ['p1'], reversalEntryNumbers: ['JE-1'] } });
    renderWithRole('OWNER');
    await userEvent.click(await screen.findByRole('button', { name: /ยกเลิกใบขาย/ }));
    await userEvent.type(screen.getByRole('textbox', { name: /เหตุผล/ }), 'คีย์ผิดรุ่นเครื่อง');
    await userEvent.click(screen.getByRole('button', { name: /ยืนยันยกเลิก/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/sales/s1/void', { reason: 'คีย์ผิดรุ่นเครื่อง' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('SA-0001')));
  });

  it('server ปฏิเสธ → แสดงข้อความจาก server ตรง ๆ', async () => {
    apiPost.mockRejectedValue({ response: { status: 400, data: { message: 'ใบขายนี้ข้ามงวดบัญชีที่ปิดแล้ว — ให้ OWNER เปิดงวดก่อน' } } });
    renderWithRole('OWNER');
    await userEvent.click(await screen.findByRole('button', { name: /ยกเลิกใบขาย/ }));
    await userEvent.type(screen.getByRole('textbox', { name: /เหตุผล/ }), 'คีย์ผิดรุ่นเครื่อง');
    await userEvent.click(screen.getByRole('button', { name: /ยืนยันยกเลิก/ }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('ใบขายนี้ข้ามงวดบัญชีที่ปิดแล้ว — ให้ OWNER เปิดงวดก่อน'),
    );
  });

  it('สวิตช์ "แสดงใบที่ยกเลิกแล้ว" ส่ง includeVoided=true + ป้ายเตือนยอดสรุป', async () => {
    renderWithRole('OWNER');
    await screen.findByText(/SA-0001/);
    expect(apiGet).not.toHaveBeenCalledWith(expect.stringContaining('includeVoided=true'));
    await userEvent.click(screen.getByLabelText(/แสดงใบที่ยกเลิกแล้ว/));
    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('includeVoided=true')),
    );
    expect(await screen.findByText(/ยอดสรุปรวมใบที่ยกเลิก/)).toBeInTheDocument();
  });

  it('ใบที่ยกเลิกแสดงป้ายพร้อมเหตุผลและคนกด และไม่มีปุ่มยกเลิกซ้ำ', async () => {
    renderWithRole('OWNER', [
      { ...saleRow, deletedAt: '2026-08-22T03:00:00Z', voidReason: 'คีย์ผิดรุ่นเครื่อง', voidedBy: { id: 'u9', name: 'สมชาย' } },
    ]);
    // exact match — กันชนกับป้ายสวิตช์ "แสดงใบที่ยกเลิกแล้ว"
    expect(await screen.findByText('ยกเลิกแล้ว')).toBeInTheDocument();
    expect(screen.getByText(/คีย์ผิดรุ่นเครื่อง/)).toBeInTheDocument();
    expect(screen.getByText(/สมชาย/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ยกเลิกใบขาย/ })).not.toBeInTheDocument();
  });
});
