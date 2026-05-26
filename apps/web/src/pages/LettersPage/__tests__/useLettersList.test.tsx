import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLettersList } from '../hooks/useLettersList';
import api from '@/lib/api';
import React from 'react';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn() },
}));

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe('useLettersList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('serializes filters to query params', async () => {
    (api.get as any).mockResolvedValue({ data: { data: [], total: 0, page: 1, limit: 50 } });
    renderHook(
      () => useLettersList({ status: 'PENDING_DISPATCH', q: 'สมชาย', page: 2 }),
      { wrapper },
    );
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const callArgs = (api.get as any).mock.calls[0];
    expect(callArgs[0]).toBe('/overdue/letters');
    expect(callArgs[1].params).toMatchObject({
      status: 'PENDING_DISPATCH',
      q: 'สมชาย',
      page: 2,
    });
  });

  it('omits undefined filter keys', async () => {
    (api.get as any).mockResolvedValue({ data: { data: [], total: 0, page: 1, limit: 50 } });
    renderHook(() => useLettersList({ status: 'DISPATCHED' }), { wrapper });
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const params = (api.get as any).mock.calls[0][1].params;
    expect(params.q).toBeUndefined();
    expect(params.branchId).toBeUndefined();
  });
});
