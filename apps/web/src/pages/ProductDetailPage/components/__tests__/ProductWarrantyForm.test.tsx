import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import ProductWarrantyForm from '../ProductWarrantyForm';

vi.mock('@/lib/api', () => ({ default: { patch: vi.fn() }, getErrorMessage: () => 'บันทึกไม่สำเร็จ' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => { vi.mocked(api.patch).mockReset().mockResolvedValue({ data: {} }); });

function mount(canEdit = true, product = { id: 'p1', shopWarrantyDays: 60, warrantyTerms: 'เงื่อนไขเดิม' } as { id: string; shopWarrantyDays: number | null; warrantyTerms: string | null; defaultShopWarrantyDays?: number; defaultWarrantyTerms?: string }) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <ProductWarrantyForm
        product={product}
        canEdit={canEdit}
      />
    </QueryClientProvider>,
  );
}

it('shows the approved standard automatically and follows duration without storing a copy', async () => {
  mount(true, { id: 'p1', shopWarrantyDays: 30, warrantyTerms: null, defaultShopWarrantyDays: 60 });
  const terms = screen.getByLabelText('ผู้รับประกันและเงื่อนไขความคุ้มครอง');
  expect((terms as HTMLTextAreaElement).value).toContain('รับประกัน 30 วัน');
  expect((terms as HTMLTextAreaElement).value).toContain('6. ระยะเวลาซ่อม 3–7 วันทำการ');
  expect(screen.getByRole('button', { name: 'บันทึกประกันเครื่อง' })).toBeDisabled();
  await userEvent.clear(screen.getByLabelText('ระยะเวลาประกันร้าน (วัน)'));
  expect((terms as HTMLTextAreaElement).value).toContain('รับประกัน 60 วัน');
  await userEvent.click(screen.getByRole('button', { name: 'บันทึกประกันเครื่อง' }));
  await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/products/p1/online-listing', { shopWarrantyDays: null }));
});

it('does not add shop coverage to a device without warranty', () => {
  mount(true, { id: 'p1', shopWarrantyDays: 0, warrantyTerms: null });
  expect(screen.getByLabelText('ผู้รับประกันและเงื่อนไขความคุ้มครอง')).toHaveValue('');
});

it('lets an editor switch custom terms back to the automatic standard', async () => {
  mount();
  await userEvent.click(screen.getByRole('button', { name: 'ใช้เงื่อนไขมาตรฐานของร้าน' }));
  expect((screen.getByLabelText('ผู้รับประกันและเงื่อนไขความคุ้มครอง') as HTMLTextAreaElement).value).toContain('รับประกัน 60 วัน');
  await userEvent.click(screen.getByRole('button', { name: 'บันทึกประกันเครื่อง' }));
  await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/products/p1/online-listing', { warrantyTerms: null }));
});

it('updates terms without overwriting existing duration', async () => {
  mount();
  const terms = screen.getByLabelText('ผู้รับประกันและเงื่อนไขความคุ้มครอง');
  await userEvent.clear(terms);
  await userEvent.type(terms, 'ประกันโดยร้าน\nไม่รวมตกน้ำ');
  await userEvent.click(screen.getByRole('button', { name: 'บันทึกประกันเครื่อง' }));
  await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/products/p1/online-listing', {
    warrantyTerms: 'ประกันโดยร้าน\nไม่รวมตกน้ำ',
  }));
});

it.each([{ input: '0', value: 0 }, { input: '', value: null }])(
  'saves zero separately from clearing the duration ($input)', async ({ input, value }) => {
    mount();
    const days = screen.getByLabelText('ระยะเวลาประกันร้าน (วัน)');
    await userEvent.clear(days);
    if (input) await userEvent.type(days, input);
    await userEvent.click(screen.getByRole('button', { name: 'บันทึกประกันเครื่อง' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/products/p1/online-listing', { shopWarrantyDays: value }));
  },
);

it('disables edits for staff without listing permissions', () => {
  mount(false);
  expect(screen.getByLabelText('ระยะเวลาประกันร้าน (วัน)')).toBeDisabled();
  expect(screen.getByLabelText('ผู้รับประกันและเงื่อนไขความคุ้มครอง')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'บันทึกประกันเครื่อง' })).toBeDisabled();
  expect(api.patch).not.toHaveBeenCalled();
});
