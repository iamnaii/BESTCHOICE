import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import OrderDetailPage from './OrderDetailPage';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { get } }));
vi.mock('@/components/layout/ShopLayout', () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
beforeEach(() => vi.clearAllMocks());

const order = {
  orderNumber: 'TEST-ORDER', status: 'PAID', createdAt: '2026-10-16T10:00:00Z',
  product: { name: 'โทรศัพท์ทดสอบ', gallery: [] }, productPrice: '1000',
  shippingMethod: 'EMS', shippingFee: '50', totalAmount: '1050',
};

function openOrder() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={['/orders/TEST-ORDER']}><Routes>
      <Route path="/orders/:orderNumber" element={<OrderDetailPage />} />
    </Routes></MemoryRouter>
  </QueryClientProvider>);
  return client;
}

it('shows recovery instead of loading forever, and retry loads the order', async () => {
  get.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ data: order });
  openOrder();
  expect(await screen.findByText('โหลดคำสั่งซื้อไม่สำเร็จ')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'โหลดใหม่' }));
  expect(await screen.findByText('โทรศัพท์ทดสอบ')).toBeInTheDocument();
  expect(screen.queryByText('โหลดคำสั่งซื้อไม่สำเร็จ')).not.toBeInTheDocument();
  expect(get).toHaveBeenCalledTimes(2);
  expect(get).toHaveBeenLastCalledWith('/api/shop/orders/TEST-ORDER');
});

it('keeps the loaded order visible when a background refresh fails', async () => {
  get.mockResolvedValueOnce({ data: order }).mockRejectedValue(new Error('offline'));
  const client = openOrder();
  expect(await screen.findByText('โทรศัพท์ทดสอบ')).toBeInTheDocument();
  await act(async () => { await client.refetchQueries({ queryKey: ['order', 'TEST-ORDER'] }); });
  expect(await screen.findByText('อัปเดตสถานะไม่สำเร็จ กำลังแสดงข้อมูลล่าสุดที่โหลดได้')).toBeInTheDocument();
  expect(screen.getByText('โทรศัพท์ทดสอบ')).toBeInTheDocument();
  expect(screen.queryByText('โหลดคำสั่งซื้อไม่สำเร็จ')).not.toBeInTheDocument();
});
