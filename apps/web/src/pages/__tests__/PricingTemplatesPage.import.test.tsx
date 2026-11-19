import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  default: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a), put: vi.fn(), delete: vi.fn() },
}));
const importFromExcel = vi.fn();
vi.mock('@/utils/excel.util', () => ({
  importFromExcel: (...a: unknown[]) => importFromExcel(...a),
  downloadExcelBuffer: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';
import PricingTemplatesPage from '../PricingTemplatesPage';

const template = {
  id: 't1',
  deviceOrigin: 'UNSPECIFIED',
  brand: 'Apple',
  model: 'iPhone 17 Pro',
  storage: '256GB',
  category: 'PHONE_NEW',
  hasWarranty: false,
  cashPrice: '39000.00',
  installmentBestchoicePrice: '39000.00',
  installmentFinancePrice: '39000.00',
  isActive: true,
  rate1DownPayment: '15000.00',
  rate1TermMonths: 12,
  rate2DownPayment: null,
  rate2TermMonths: 15,
};

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  apiGet.mockReset().mockResolvedValue({ data: [template] });
  apiPost.mockReset().mockResolvedValue({ data: { success: 1, skipped: 0, errors: [], deactivated: 1 } });
  importFromExcel.mockReset();
  vi.mocked(toast.success).mockClear();
});

describe('PricingTemplatesPage', () => {
  it('ป้ายราคาผ่อนบอกว่าเป็นราคาเต็ม และแสดงงวด/ดาวน์ของรุ่น', async () => {
    render(<Wrapper><PricingTemplatesPage /></Wrapper>);
    expect(await screen.findByText('เรท 1: 12 งวด · ดาวน์ 15,000')).toBeInTheDocument();
    expect(screen.getByText('เรท 2: 15 งวด')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'ราคาผ่อน BESTCHOICE (ราคาเต็ม)' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'ราคาขาย GFIN (ราคาเต็ม)' })).toBeInTheDocument();
  });

  it('นำเข้า: อ่านไฟล์ → หน้าตรวจ → ติ๊กปิดแถวที่ไม่อยู่ในไฟล์ → ส่งรายการพร้อม deactivateIds', async () => {
    importFromExcel.mockResolvedValue([
      {
        'ยี่ห้อ': 'Apple',
        'รุ่น': 'iPhone 15',
        'ความจุ': '128GB',
        'ประเภท': 'มือ 1',
        'ราคาเงินสด': 25900,
        'ราคาผ่อน BESTCHOICE (ราคาเต็ม)': 25900,
        'ราคาขาย GFIN (ราคาเต็ม)': 25900,
        'งวดเรท 1': 12,
      },
    ]);
    const { container } = render(<Wrapper><PricingTemplatesPage /></Wrapper>);
    await screen.findByText('เรท 1: 12 งวด · ดาวน์ 15,000');
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'prices.xlsx')] } });

    expect(await screen.findByText('ตรวจรายการก่อนยืนยัน — เพิ่ม 1 · แก้ 0 · ข้าม 0 แถว')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'ปิดแถวที่เปิดใช้อยู่แต่ไม่อยู่ในไฟล์ (1 แถว)' }));
    await userEvent.click(screen.getByRole('button', { name: 'ยืนยันนำเข้า' }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/pricing-templates/import', {
        items: [
          {
            brand: 'Apple',
            model: 'iPhone 15',
            storage: '128GB',
            deviceOrigin: 'UNSPECIFIED',
            category: 'PHONE_NEW',
            hasWarranty: false,
            cashPrice: 25900,
            installmentBestchoicePrice: 25900,
            installmentFinancePrice: 25900,
            rate1TermMonths: 12,
            rate1DownPayment: null,
            rate2TermMonths: null,
          },
        ],
        deactivateIds: ['t1'],
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('นำเข้าแล้ว 1 แถว · ปิด 1 แถว'));
  });
});
