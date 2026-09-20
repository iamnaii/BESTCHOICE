import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BundleSearch, { type BundleProduct } from './BundleSearch';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({
  default: { get: apiGet, post: vi.fn() },
  getErrorMessage: (error: Error) => error.message,
}));
// ค้นหาทันทีที่พิมพ์ (ไม่รอ timer ของ debounce)
vi.mock('@/hooks/useDebounce', () => ({ useDebounce: (v: unknown) => v }));

const CASE: BundleProduct = {
  id: 'acc-1', name: 'เคสใส iPhone 15', brand: 'Generic', model: 'เคสใส', imeiSerial: null, category: 'ACCESSORY',
};

function Harness({ branchId }: { branchId?: string }) {
  const [search, setSearch] = useState('');
  const [bundle, setBundle] = useState<BundleProduct[]>([]);
  return (
    <BundleSearch
      bundleSearch={search}
      setBundleSearch={setSearch}
      bundleProducts={bundle}
      excludeIds={bundle.map((p) => p.id)}
      onAddBundle={(p) => setBundle((prev) => [...prev, p])}
      onRemoveBundle={(id) => setBundle((prev) => prev.filter((p) => p.id !== id))}
      branchId={branchId}
    />
  );
}

function renderHarness(branchId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness branchId={branchId} />
    </QueryClientProvider>,
  );
}

describe('BundleSearch — ของแถมเลือกได้เฉพาะอุปกรณ์เสริม (คำตัดสินเจ้าของ 2026-09-20)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue({ data: { data: [CASE] } });
  });

  it('ค้นหาด้วยตัวกรองหมวดอุปกรณ์เสริม — มือถือ/แท็บเล็ตไม่ขึ้นในช่องของแถม', async () => {
    renderHarness();
    fireEvent.change(screen.getByPlaceholderText(/ค้นหาของแถม/), { target: { value: 'เคส' } });

    expect(await screen.findByText('เคสใส iPhone 15')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/products', {
      params: { search: 'เคส', status: 'IN_STOCK', category: 'ACCESSORY', limit: '10' },
    });
  });

  it('บอกพนักงานตรง ๆ ว่าช่องนี้รับเฉพาะอุปกรณ์เสริม', () => {
    renderHarness();
    expect(screen.getByText(/เลือกได้เฉพาะอุปกรณ์เสริม/)).toBeInTheDocument();
  });

  it('ค้นไม่เจอ → ข้อความบอกว่าไม่พบ "อุปกรณ์เสริม" (ไม่ใช่ "สินค้า" — มือถือถูกกรองออกโดยตั้งใจ)', async () => {
    apiGet.mockResolvedValue({ data: { data: [] } });
    renderHarness();
    fireEvent.change(screen.getByPlaceholderText(/ค้นหาของแถม/), { target: { value: 'iPhone' } });

    expect(await screen.findByText(/ไม่พบอุปกรณ์เสริม "iPhone"/)).toBeInTheDocument();
  });

  it('หน้าสัญญาส่งสาขามา → ค้นเฉพาะอุปกรณ์เสริมของสาขานั้น', async () => {
    renderHarness('br-9');
    fireEvent.change(screen.getByPlaceholderText(/ค้นหาของแถม/), { target: { value: 'เคส' } });
    await screen.findByText('เคสใส iPhone 15');
    expect(apiGet).toHaveBeenCalledWith('/products', {
      params: { search: 'เคส', status: 'IN_STOCK', category: 'ACCESSORY', limit: '10', branchId: 'br-9' },
    });
  });

  it('เลือกแล้วขึ้นในรายการของแถม และกด "นำออก" ได้', async () => {
    renderHarness();
    fireEvent.change(screen.getByPlaceholderText(/ค้นหาของแถม/), { target: { value: 'เคส' } });
    fireEvent.click(await screen.findByRole('button', { name: /เคสใส iPhone 15/ }));
    expect(screen.getByRole('button', { name: 'นำออก' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'นำออก' }));
    expect(screen.queryByRole('button', { name: 'นำออก' })).not.toBeInTheDocument();
  });
});
