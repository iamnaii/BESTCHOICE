import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import api from '@/lib/api';
import { pickComboOption } from '@/test/combobox';
import ProductCreatePage from '../index';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  getErrorMessage: () => 'บันทึกไม่สำเร็จ',
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ProductCreatePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === '/branches') return { data: [{ id: 'branch-1', name: 'สาขาหลัก' }] };
    if (url === '/suppliers') {
      return { data: { data: [{ id: 'sup-1', name: 'บริษัท มือถือดี จำกัด' }, { id: 'sup-2', name: 'ห้างหุ้นส่วน ไอโฟนไทย' }] } };
    }
    if (url.startsWith('/pricing-templates/lookup?')) {
      return { data: { cashPrice: '30000', installmentBestchoicePrice: '35000', installmentFinancePrice: '36000' } };
    }
    if (url.startsWith('/interest-configs/resolved?')) {
      return { data: { minDownPct: 0.15, commissionPct: 0.1, vatPct: 0.07, ratePctByMonths: { 12: 0.5 }, allowedMonths: [12] } };
    }
    if (url === '/gfin-config/max-prices' || url === '/gfin-config/overprice-rules' || url === '/gfin-config/rate-factors') {
      return { data: [] };
    }
    if (url === '/gfin-config/settings') {
      return { data: { minDownPct: 25, maxDownPct: 80, downStepPct: 5, contractFee: 100, commissionPctByCategory: { PHONE: 15, TABLET: 5 } } };
    }
    throw new Error(`unexpected GET ${url}`);
  });
  vi.mocked(api.post).mockResolvedValue({ data: { id: 'product-1' } });
});

describe('ProductCreatePage — รุ่น (Combobox)', () => {
  it('is disabled until a brand is chosen; the picked model and supplier go into POST /products', async () => {
    const user = userEvent.setup();
    renderPage();
    const model = await screen.findByRole('combobox', { name: 'รุ่น *' });
    expect(model).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('ยี่ห้อ *'), 'Apple');
    expect(model).toBeEnabled();

    await pickComboOption(user, 'รุ่น *', 'iPhone 16 Pro', { search: '16 pro' });
    expect(model).toHaveTextContent('iPhone 16 Pro');
    await pickComboOption(user, 'ผู้จัดจำหน่าย', 'ห้างหุ้นส่วน ไอโฟนไทย');
    await user.selectOptions(screen.getByLabelText('สาขา *'), 'branch-1');
    await user.type(screen.getByLabelText('ราคาทุน (บาท) *'), '25000');
    await screen.findByDisplayValue('30,000'); // price template filled from brand + model
    await user.click(screen.getByRole('button', { name: 'บันทึกสินค้า' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith(
      '/products',
      expect.objectContaining({
        brand: 'Apple',
        model: 'iPhone 16 Pro',
        name: 'Apple iPhone 16 Pro',
        category: 'PHONE_NEW',
        supplierId: 'sup-2',
        branchId: 'branch-1',
        costPrice: 25000,
      }),
    );
  });

  it('required: with a brand but no model, saving shows กรุณาเลือกรุ่น and posts nothing', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(await screen.findByLabelText('ยี่ห้อ *'), 'Apple');
    await user.selectOptions(screen.getByLabelText('สาขา *'), 'branch-1');
    await user.type(screen.getByLabelText('ราคาทุน (บาท) *'), '25000');
    await user.type(screen.getByLabelText('เงินสด'), '30000');
    await user.click(screen.getByRole('button', { name: 'บันทึกสินค้า' }));

    expect(toast.error).toHaveBeenCalledWith('กรุณาเลือกรุ่น');
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: 'รุ่น *' })).toHaveAttribute('aria-required', 'true');
  });

  it('re-picking the current model keeps the chosen storage (a native select fired no change)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(await screen.findByLabelText('ยี่ห้อ *'), 'Apple');
    await pickComboOption(user, 'รุ่น *', 'iPhone 16 Pro', { search: '16 pro' });
    await user.click(screen.getByRole('button', { name: '256GB' }));
    expect(screen.getByRole('button', { name: '256GB' })).toHaveAttribute('aria-pressed', 'true');

    await pickComboOption(user, 'รุ่น *', 'iPhone 16 Pro', { search: '16 pro' });
    expect(screen.getByRole('button', { name: '256GB' })).toHaveAttribute('aria-pressed', 'true');

    await pickComboOption(user, 'รุ่น *', 'iPhone 15');
    expect(screen.getByRole('combobox', { name: 'รุ่น *' })).toHaveTextContent('iPhone 15');
    expect(screen.getByRole('button', { name: '256GB' })).toHaveAttribute('aria-pressed', 'false');
  });
});
