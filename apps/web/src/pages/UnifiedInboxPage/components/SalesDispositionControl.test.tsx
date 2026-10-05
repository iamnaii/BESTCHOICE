import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SalesDispositionControl from './SalesDispositionControl';
import { journeySummary } from '@/pages/CustomerDetailPage/__tests__/journeyFixtures';
const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: api, getErrorMessage: () => 'บันทึกไม่ได้' }));
vi.mock('../hooks/useChatWork', () => ({ useChatWorkSettings: () => ({ company: 'SHOP', scope: { company: 'SHOP' }, key: ['chat-work', 'user', 'SHOP'] }) }));
const view = (lost = false, bought = false) => render(<QueryClientProvider client={new QueryClient()}><SalesDispositionControl roomId="room" journey={journeySummary({ stage: bought ? 'PURCHASED' : 'INTERESTED', lost: lost ? { at: '2026-10-06T00:00:00Z', reason: 'BOUGHT_ELSEWHERE' } : null })} /></QueryClientProvider>);
beforeEach(() => { vi.clearAllMocks(); api.post.mockResolvedValue({ data: {} }); });
describe('Manual sales disposition', () => {
  it('requires a standard reason before marking lost and never sends a purchased stage', async () => {
    view(); fireEvent.click(screen.getByRole('button', { name: 'ไม่ซื้อแล้ว' }));
    expect(screen.getByRole('button', { name: 'บันทึกเหตุผล' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('เหตุผลที่ไม่ซื้อ'), { target: { value: 'BOUGHT_ELSEWHERE' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกเหตุผล' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/staff-chat/rooms/room/sales-disposition', { action: 'MARK_LOST', reason: 'BOUGHT_ELSEWHERE', clientRequestId: expect.any(String) }, expect.anything()));
  });
  it('reopens with a new history event and has no purchase override', async () => {
    const rendered = view(true); fireEvent.click(screen.getByRole('button', { name: 'กลับมาติดตาม' }));
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกกลับมาติดตาม' }));
    await waitFor(() => expect(api.post.mock.calls[0][1]).toEqual({ action: 'REOPEN', clientRequestId: expect.any(String) }));
    rendered.unmount(); view(false, true);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
