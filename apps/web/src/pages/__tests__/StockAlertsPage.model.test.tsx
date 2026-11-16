import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import { pickComboOption } from '@/test/combobox';
import StockAlertsPage from '../StockAlertsPage';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorMessage: () => 'บันทึกไม่สำเร็จ',
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'owner-1', role: 'OWNER', branchId: null } }),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <StockAlertsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function openCreate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: '+ จุดสั่งซื้อซ้ำ' }));
  return screen.getByRole('dialog', { name: 'สร้าง จุดสั่งซื้อซ้ำ ใหม่' });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === '/branches') return { data: [{ id: 'branch-1', name: 'สาขาหลัก' }] };
    if (url === '/reorder-points/low-stock') return { data: { totalLowStock: 0, data: [] } };
    if (url === '/reorder-points') return { data: [] };
    if (url === '/reorder-points/alerts') return { data: { data: [], total: 0 } };
    throw new Error(`unexpected GET ${url}`);
  });
  vi.mocked(api.post).mockResolvedValue({ data: { id: 'rp-1' } });
});

describe('StockAlertsPage — รุ่น (Combobox) in the create dialog', () => {
  it('is disabled until a brand is chosen; the picked model goes into POST /reorder-points', async () => {
    const user = userEvent.setup();
    renderPage();
    const dialog = await openCreate(user);
    const model = within(dialog).getByRole('combobox', { name: 'รุ่น' });
    expect(model).toBeDisabled();
    await user.selectOptions(within(dialog).getByLabelText('แบรนด์'), 'Apple');
    expect(model).toBeEnabled();

    await pickComboOption(user, 'รุ่น', 'iPhone 16 Pro', { search: '16 pro' });
    expect(model).toHaveTextContent('iPhone 16 Pro');
    await user.selectOptions(within(dialog).getByLabelText('สาขา'), 'branch-1');
    await user.click(within(dialog).getByRole('button', { name: 'บันทึก' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/reorder-points', {
        brand: 'Apple',
        model: 'iPhone 16 Pro',
        storage: undefined,
        category: 'PHONE_NEW',
        branchId: 'branch-1',
        minQuantity: 1,
        reorderQuantity: 5,
      }),
    );
  });

  it('picking a model sets the category from the catalog entry and clears the storage', async () => {
    const user = userEvent.setup();
    renderPage();
    const dialog = await openCreate(user);
    // Pre-existing: getModels(brand, 'PHONE_USED') lists the catalog's PHONE_NEW entries, and the
    // pick copies the entry's category — so the category flips to มือถือใหม่ (kept as is).
    await user.selectOptions(within(dialog).getByLabelText('ประเภท'), 'PHONE_USED');
    await user.selectOptions(within(dialog).getByLabelText('แบรนด์'), 'Apple');
    await pickComboOption(user, 'รุ่น', 'iPhone 16 Pro', { search: '16 pro' });
    await user.selectOptions(within(dialog).getByLabelText('ความจุ (ไม่บังคับ)'), '256GB');
    expect(within(dialog).getByLabelText('ประเภท')).toHaveValue('PHONE_NEW');

    await pickComboOption(user, 'รุ่น', 'iPhone 15');
    expect(within(dialog).getByLabelText('ความจุ (ไม่บังคับ)')).toHaveValue('');
  });

  it('required: saving with no model shows กรุณาเลือกรุ่น under the field and posts nothing; picking clears it', async () => {
    const user = userEvent.setup();
    renderPage();
    const dialog = await openCreate(user);
    await user.selectOptions(within(dialog).getByLabelText('แบรนด์'), 'Apple');
    await user.selectOptions(within(dialog).getByLabelText('สาขา'), 'branch-1');
    await user.click(within(dialog).getByRole('button', { name: 'บันทึก' }));

    const model = within(dialog).getByRole('combobox', { name: 'รุ่น' });
    expect(await within(dialog).findByText('กรุณาเลือกรุ่น')).toBeInTheDocument();
    expect(model).toHaveAttribute('aria-invalid', 'true');
    expect(model).toHaveAccessibleDescription('กรุณาเลือกรุ่น');
    expect(api.post).not.toHaveBeenCalled();

    await pickComboOption(user, 'รุ่น', 'iPhone 15');
    expect(within(dialog).queryByText('กรุณาเลือกรุ่น')).toBeNull();
    expect(model).not.toHaveAttribute('aria-invalid', 'true');
  });
});
