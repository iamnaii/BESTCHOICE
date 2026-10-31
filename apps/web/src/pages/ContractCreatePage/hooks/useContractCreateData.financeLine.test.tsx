import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { useContractCreateData } from './useContractCreateData';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({
  default: { get: mocks.get, post: mocks.post, patch: vi.fn() },
  getErrorMessage: () => 'error',
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'staff-a', role: 'SALES' } }),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

beforeEach(() => {
  localStorage.clear();
  mocks.post.mockReset().mockResolvedValue({ data: { id: 'customer-new', name: 'สมชาย ใจดี' } });
  mocks.get.mockReset().mockResolvedValue({ data: { data: [] } });
});

/**
 * Task 27 — ทำสัญญา › เพิ่มลูกค้าใหม่ (`CustomerCreateModal`): ฟอร์มไม่มีช่อง LINE การเงินแล้ว และ payload ของ `POST /customers`
 * ไม่ส่ง `lineIdFinance` แม้ state ของฟอร์ม (เช่นร่างเก่าที่กู้คืน) จะยังพกค่ามา
 */
describe('useContractCreateData — สร้างลูกค้าไม่ส่ง lineIdFinance', () => {
  it('POST /customers ไม่มี lineIdFinance · LINE ร้านยังส่ง', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/contracts/create']}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => useContractCreateData(), { wrapper });
    act(() =>
      result.current.setCustForm({
        ...result.current.custForm,
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        nationalId: '1234567890121',
        phone: '0812345678',
        lineIdShop: 'U-shop',
        ...({ lineIdFinance: 'U-from-old-draft' } as object),
      }),
    );
    act(() => result.current.createCustomerMutation.mutate());

    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    const [url, payload] = mocks.post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/customers');
    expect(payload).not.toHaveProperty('lineIdFinance');
    expect(payload.lineIdShop).toBe('U-shop');
  });
});
