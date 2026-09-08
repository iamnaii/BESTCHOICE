import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { it, expect, vi } from 'vitest';
import LinkCustomerDialog from './LinkCustomerDialog';

vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn(async () => ({ data: [{ id: 'customer', name: 'ลูกค้าทดสอบ' }] })),
    patch: vi.fn(async () => ({ data: {} })),
  },
}));

it('refreshes the customer list filters after linking imported credit history', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  render(
    <QueryClientProvider client={qc}>
      <LinkCustomerDialog open roomId="room" onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'ค้นหาลูกค้า' }), {
    target: { value: 'ลูกค้า' },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'ลูกค้าทดสอบ' }));
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['customers'] }));
});
