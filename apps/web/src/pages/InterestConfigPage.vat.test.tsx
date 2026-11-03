import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InterestConfigPage from './InterestConfigPage';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() }));
vi.mock('@/lib/api', () => ({
  default: {
    get: mocks.get,
    post: mocks.post,
    put: mocks.put,
    patch: mocks.patch,
    delete: vi.fn(),
  },
  getErrorMessage: (e: unknown) => String(e),
}));

const config = {
  id: 'ic-1',
  name: 'มือ 1',
  productCategories: ['PHONE_NEW'],
  interestRate: '0.03',
  minDownPaymentPct: '0.15',
  storeCommissionPct: '0.10',
  vatPct: '0.07',
  minInstallmentMonths: 6,
  maxInstallmentMonths: 12,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function open() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <InterestConfigPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// คำตัดสินเจ้าของ #22 (31 ต.ค. 2026): VAT ของตั้งค่าดอกเบี้ยอ่านจากบริษัท FINANCE ที่เดียว — หน้านี้แสดงแบบอ่านอย่างเดียว
// พร้อมบอกที่แก้ (ตั้งค่า › บริษัท & สาขา › บริษัทในเครือ — /settings/company/entities) และไม่ส่ง vatPct ตอนบันทึก
describe('InterestConfigPage — VAT is read-only from FINANCE (#22)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockImplementation(async (url: string) => {
      if (url === '/settings')
        return { data: [{ id: 's1', key: 'VAT_RATE', value: '8', label: null }] };
      if (url === '/interest-configs') return { data: [config] };
      if (url === '/companies')
        return {
          data: [{ id: 'f', companyCode: 'FINANCE', vatRegistered: true, vatRate: '0.0700' }],
        };
      throw new Error(`unexpected ${url}`);
    });
    mocks.put.mockResolvedValue({ data: config });
  });

  it('edit modal shows the FINANCE VAT read-only with where to change it, and saves without vatPct', async () => {
    open();
    await screen.findByText('มือ 1');
    // [0] = ปุ่มแก้ไขของการ์ดค่าเริ่มต้น · [1] = ปุ่มแก้ไขของการ์ด "มือ 1"
    fireEvent.click(screen.getAllByRole('button', { name: 'แก้ไข' })[1]);

    const vat = await screen.findByTestId('interest-vat-readonly');
    expect(vat).toHaveTextContent('7%');
    expect(screen.queryByLabelText('VAT (%)')).not.toBeInTheDocument();
    const link = screen.getAllByRole('link', { name: /บริษัทในเครือ/ })[0];
    expect(link).toHaveAttribute('href', '/settings/company/entities');

    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await vi.waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(1));
    expect(mocks.put.mock.calls[0][1]).not.toHaveProperty('vatPct');
  });

  it('default card shows the FINANCE VAT, not the system VAT_RATE, and its editor no longer edits VAT', async () => {
    open();
    expect(await screen.findByTestId('interest-default-vat')).toHaveTextContent('7%');
    expect(screen.getByTestId('interest-default-vat')).not.toHaveTextContent('8%');
    expect(screen.getByText('ค่าเริ่มต้น')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'แก้ไข' })[0]);
    expect(screen.getByText('อัตราดอกเบี้ยต่อเดือน (แบบคงที่)')).toBeInTheDocument();
    expect(screen.queryByText('VAT (%) — เช่น 7 = 7%')).not.toBeInTheDocument();
  });
});
