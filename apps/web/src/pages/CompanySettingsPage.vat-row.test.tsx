import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({
  default: { get: apiGet, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorMessage: (e: unknown) => String(e),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-owner', name: 'เจ้าของ', role: 'OWNER', branchId: null }, isLoading: false }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import CompanySettingsPage from './CompanySettingsPage';

const company = {
  id: 'co-1', nameTh: 'บริษัท ทดสอบ จำกัด', nameEn: null, taxId: null, companyCode: 'FINANCE',
  address: null, phone: null, vatRegistered: true, vatRate: 0.07, bankName: null,
  bankAccountName: null, bankAccountNumber: null, directorName: null, directorPosition: null, branches: [],
};

function open() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <CompanySettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// S1-02: ป้าย "สถานะ VAT" ต่ำกว่า "อัตรา VAT (%)" ~11px เพราะแถวเป็น items-center
function expectVatRowAligned() {
  const checkbox = screen.getByRole('checkbox', { name: 'จดทะเบียน VAT' });
  expect(checkbox.closest('label')).toHaveClass('min-h-11', 'items-center');
  const row = screen.getByText('สถานะ VAT').closest('div')?.parentElement;
  expect(row).toHaveClass('items-start');
  expect(row).not.toHaveClass('items-center');
}

describe('CompanySettingsPage — S1-02 แถว "สถานะ VAT / อัตรา VAT" ป้ายตรงแนว', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (url: string) => ({ data: url === '/companies' ? [company] : [] }));
  });

  it('กล่องแก้ไขนิติบุคคล', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'แก้ไข' }));
    await screen.findByRole('dialog');
    expectVatRowAligned();
  });

  it('กล่องเพิ่มนิติบุคคล', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'เพิ่มนิติบุคคล' }));
    await screen.findByRole('dialog');
    expectVatRowAligned();
  });
});
