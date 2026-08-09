import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const get = vi.fn();
vi.mock('@/lib/api', () => ({ default: { get: (...a: unknown[]) => get(...a) } }));

import { useOnlineOrdersPendingCount } from './useOnlineOrdersPendingCount';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

describe('useOnlineOrdersPendingCount', () => {
  beforeEach(() => get.mockReset());

  it('คืน total จาก pending-count', async () => {
    get.mockResolvedValue({ data: { total: 4, pendingBankReview: 1, paid: 2, unfulfillable: 1 } });
    const { result } = renderHook(() => useOnlineOrdersPendingCount(true), { wrapper });
    await waitFor(() => expect(result.current).toBe(4));
    expect(get).toHaveBeenCalledWith('/admin/online-orders/pending-count');
  });

  it('ไม่ยิงเมื่อ disabled', async () => {
    const { result } = renderHook(() => useOnlineOrdersPendingCount(false), { wrapper });
    await waitFor(() => expect(result.current).toBeUndefined());
    expect(get).not.toHaveBeenCalled();
  });
});
