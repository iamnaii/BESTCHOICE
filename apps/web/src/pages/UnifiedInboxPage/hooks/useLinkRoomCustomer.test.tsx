import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const apiPatch = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { patch: (...a: unknown[]) => apiPatch(...a), get: vi.fn(), post: vi.fn() },
}));

import { useLinkRoomCustomer } from './useLinkRoomCustomer';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const spy = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { wrapper, spy };
}

/** M-A4: `PATCH /staff-chat/rooms/:id/customer` → `{ success, absorbed: { targetId, movedCreditChecks } | null }` */
describe('useLinkRoomCustomer', () => {
  beforeEach(() => { apiPatch.mockReset(); });

  it('ผูกห้องแล้วรวมผู้สนใจ → onSuccess ได้ id ที่ผูก + ห้องที่ยิงจริง + ผลการรวม · invalidate ห้องและลูกค้า', async () => {
    apiPatch.mockResolvedValue({ data: { success: true, absorbed: { targetId: 'c-old', movedCreditChecks: 2 } } });
    const { wrapper, spy } = makeWrapper();
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useLinkRoomCustomer('r-1', { onSuccess }), { wrapper });
    result.current.mutate('c-old');
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(apiPatch).toHaveBeenCalledWith('/staff-chat/rooms/r-1/customer', { customerId: 'c-old' });
    expect(onSuccess).toHaveBeenCalledWith('c-old', { roomId: 'r-1', absorbed: { targetId: 'c-old', movedCreditChecks: 2 } });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['chat-room', 'r-1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['customers'] });
  });

  it.each([
    ['absorbed: null', { success: true, absorbed: null }],
    ['API เก่า ({ success } อย่างเดียว)', { success: true }],
    ['ว่างเปล่า', undefined],
    ['absorbed ผิดรูป (ไม่มี targetId)', { success: true, absorbed: { movedCreditChecks: 3 } }],
  ])('%s → absorbed = null ไม่พัง', async (_label, body) => {
    apiPatch.mockResolvedValue({ data: body });
    const { wrapper } = makeWrapper();
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useLinkRoomCustomer('r-1', { onSuccess }), { wrapper });
    result.current.mutate('c-old');
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onSuccess.mock.calls[0][1]).toEqual({ roomId: 'r-1', absorbed: null });
  });

  it('ตัวนับหาย/ไม่ใช่ตัวเลข → นับเป็น 0', async () => {
    apiPatch.mockResolvedValue({ data: { success: true, absorbed: { targetId: 'c-old', movedCreditChecks: '2' } } });
    const { wrapper } = makeWrapper();
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useLinkRoomCustomer('r-1', { onSuccess }), { wrapper });
    result.current.mutate('c-old');
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onSuccess.mock.calls[0][1]).toEqual({ roomId: 'r-1', absorbed: { targetId: 'c-old', movedCreditChecks: 0 } });
  });
});
