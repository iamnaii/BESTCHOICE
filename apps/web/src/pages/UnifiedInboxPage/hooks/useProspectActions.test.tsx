import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const apiPost = vi.fn();
const apiPatch = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { post: (...a: unknown[]) => apiPost(...a), patch: (...a: unknown[]) => apiPatch(...a), get: vi.fn() },
}));

import { useAbsorbCustomer, useDismissSamePerson } from './useProspectActions';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const spy = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { wrapper, spy };
}

describe('useProspectActions', () => {
  beforeEach(() => { apiPost.mockReset(); apiPatch.mockReset(); });

  it('useAbsorbCustomer: POST /customers/:placeholder/absorb-into/:target แล้ว invalidate ห้อง รายการห้อง และคีย์ลูกค้า/เครดิต', async () => {
    apiPost.mockResolvedValue({ data: { placeholderId: 'p1', targetId: 'c1', movedRooms: 1, movedCreditChecks: 0 } });
    const { wrapper, spy } = makeWrapper();
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useAbsorbCustomer('r-1', { onSuccess }), { wrapper });
    result.current.mutate({ placeholderId: 'p1', targetId: 'c1' });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(apiPost).toHaveBeenCalledWith('/customers/p1/absorb-into/c1');
    const keys = spy.mock.calls.map(([arg]) => JSON.stringify((arg as { queryKey: unknown }).queryKey));
    expect(keys).toEqual(expect.arrayContaining([JSON.stringify(['chat-room', 'r-1']), JSON.stringify(['chat-rooms']), JSON.stringify(['customers'])]));
  });

  it('useDismissSamePerson: PATCH /staff-chat/rooms/:id/same-person/dismiss { customerId } แล้ว invalidate ห้อง', async () => {
    apiPatch.mockResolvedValue({ data: {} });
    const { wrapper, spy } = makeWrapper();
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useDismissSamePerson('r-1', { onSuccess }), { wrapper });
    result.current.mutate('c9');
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(apiPatch).toHaveBeenCalledWith('/staff-chat/rooms/r-1/same-person/dismiss', { customerId: 'c9' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['chat-room', 'r-1'] });
  });
});
