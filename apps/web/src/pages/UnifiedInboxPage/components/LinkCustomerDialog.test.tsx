import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, it, expect, vi } from 'vitest';
import LinkCustomerDialog from './LinkCustomerDialog';

const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    patch: vi.fn(async () => ({ data: {} })),
  },
}));

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockResolvedValue({ data: [{ id: 'customer', name: 'ลูกค้าทดสอบ' }] });
});

function renderDialog() {
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
  return { invalidate };
}

it('refreshes the customer list filters after linking imported credit history', async () => {
  const { invalidate } = renderDialog();
  // แถวที่ไม่มีเบอร์และไม่ใช่ผู้สนใจแสดงขีด (ProspectPhoneLine) ⇒ ชื่อปุ่มไม่ได้เป็นชื่อลูกค้าเปล่า ๆ แล้ว
  fireEvent.click(await screen.findByRole('button', { name: /ลูกค้าทดสอบ/ }));
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['customers'] }));
});

// C8 — ผลค้นหาต้องบอกว่าแถวไหนเป็นผู้สนใจจากแชท (ธงจาก GET /customers/search) แทนบรรทัดเบอร์ว่าง
it('ผลค้นหา: ผู้สนใจจากแชทโชว์ "จากแชท · ยังไม่มีเบอร์" · ลูกค้าที่มีเบอร์โชว์เบอร์', async () => {
  apiGet.mockResolvedValue({
    data: [
      { id: 'p1', name: 'สมชาย ใจดี', phone: null, chatPlaceholder: true },
      { id: 'c1', name: 'สมชาย ใจงาม', phone: '0812345678', chatPlaceholder: false },
    ],
  });
  renderDialog();
  const prospect = await screen.findByRole('button', { name: /สมชาย ใจดี/ });
  expect(prospect).toHaveTextContent('จากแชท · ยังไม่มีเบอร์');
  const real = screen.getByRole('button', { name: /สมชาย ใจงาม/ });
  expect(real).toHaveTextContent('0812345678');
  expect(real).not.toHaveTextContent('จากแชท');
});
