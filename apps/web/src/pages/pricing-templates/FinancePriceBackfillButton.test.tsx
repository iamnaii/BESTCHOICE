import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import api from '@/lib/api';
import { FinancePriceBackfillButton } from './FinancePriceBackfillButton';

vi.mock('@/lib/api', () => ({ default: { post: vi.fn() }, getErrorMessage: () => 'ผิดพลาด' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderButton() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FinancePriceBackfillButton />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('FinancePriceBackfillButton', () => {
  it('แสดงจำนวนเครื่องก่อนยืนยัน (dry run) แล้วเติมเมื่อกดยืนยันใน dialog', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { count: 7 } });
    const user = userEvent.setup();
    renderButton();

    await user.click(await screen.findByRole('button', { name: 'เติมราคาขาย GFIN ให้เครื่องในสต๊อก (7 เครื่อง)' }));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/pricing-templates/backfill-finance-price?dryRun=true');
    expect(await screen.findByText(/ให้เครื่องในสต๊อกที่ยังว่าง 7 เครื่อง/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'เติม 7 เครื่อง' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/pricing-templates/backfill-finance-price'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('เติมราคาขาย GFIN แล้ว 7 เครื่อง'));
  });

  it('ไม่มีเครื่องให้เติม → ปุ่มกดไม่ได้', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { count: 0 } });
    renderButton();
    expect(
      await screen.findByRole('button', { name: 'เติมราคาขาย GFIN ให้เครื่องในสต๊อก (0 เครื่อง)' }),
    ).toBeDisabled();
  });
});
