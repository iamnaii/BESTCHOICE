import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PromoBar from './PromoBar';

const get = vi.fn();
vi.mock('@/lib/api', () => ({ api: { get: (...args: unknown[]) => get(...args) } }));

function renderBar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <PromoBar />
    </QueryClientProvider>,
  );
}

afterEach(() => get.mockReset());
// toDownFloor / seed / พาดหัว / การ์ด อยู่ที่ src/hooks/useDownFloor.test.tsx

describe('PromoBar — ดาวน์เริ่มตามสต๊อก (เจ้าของ 2026-11-27)', () => {
  it('ถามยอดจากรายการสินค้าแบบเบาที่สุด (1 การ์ด + งบดาวน์ 1 บาท)', async () => {
    get.mockResolvedValue({ data: { freeDownCount: 13, nextDownFrom: 1200 } });
    renderBar();
    await screen.findByText('ดาวน์เริ่ม 0 บาท');
    expect(get).toHaveBeenCalledWith('/api/shop/products', { params: { limit: 1, downAmount: 1 } });
  });

  it('ฟรีดาวน์หมด — แสดงดาวน์ต่ำสุดจริง', async () => {
    get.mockResolvedValue({ data: { freeDownCount: 0, nextDownFrom: 1200 } });
    renderBar();
    expect(await screen.findByText('ดาวน์เริ่ม 1,200 บาท')).toBeInTheDocument();
    expect(screen.queryByText('ดาวน์เริ่ม 0 บาท')).not.toBeInTheDocument();
  });

  it('ดึงยอดไม่ได้ — ซ่อนเฉพาะส่วนดาวน์ ข้อความอื่นยังอยู่', async () => {
    get.mockRejectedValue(new Error('network'));
    renderBar();
    expect(screen.getByText('บัตรประชาชนใบเดียว')).toBeInTheDocument();
    await vi.waitFor(() => expect(get).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/ดาวน์เริ่ม/)).not.toBeInTheDocument();
  });
});
