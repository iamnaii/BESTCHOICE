import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const get = vi.fn();
vi.mock('@/lib/api', () => ({ default: { get: (...a: unknown[]) => get(...a) } }));

import { useQcPendingCount } from './useQcPendingCount';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

describe('useQcPendingCount', () => {
  beforeEach(() => get.mockReset());

  it('returns the total from qc-pending and requests includePhotoPending', async () => {
    get.mockResolvedValue({ data: { total: 7 } });
    const { result } = renderHook(() => useQcPendingCount(true), { wrapper });
    await waitFor(() => expect(result.current).toBe(7));
    expect(get).toHaveBeenCalledWith(
      '/purchase-orders/qc-pending',
      expect.objectContaining({ params: expect.objectContaining({ includePhotoPending: true, limit: 1 }) }),
    );
  });

  it('does not fetch when disabled', async () => {
    const { result } = renderHook(() => useQcPendingCount(false), { wrapper });
    await waitFor(() => expect(result.current).toBeUndefined());
    expect(get).not.toHaveBeenCalled();
  });
});
