import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import InboxWorkTools from './InboxWorkTools';
const mocks = vi.hoisted(() => ({ getTarget: vi.fn(), markRead: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: mocks.error } }));
vi.mock('../hooks/useChatWork', () => ({ useChatWork: () => ({
  company: 'SHOP', enabled: true, settings: { isError: false }, queue: { data: undefined },
  inbox: { data: { unreadCount: 1, total: 1, data: [{ id: 'n', title: 'มีโน้ตถึงคุณ', targetType: 'NOTE', targetId: 'note', roomId: 'room', createdAt: '2026-10-06T00:00:00Z', readAt: null }] } },
  getTarget: mocks.getTarget, markRead: mocks.markRead,
}) }));
describe('Work notification targets', () => {
  it('refuses navigation and read mutation when target permission is gone', async () => {
    mocks.getTarget.mockRejectedValueOnce(new Error('not found'));
    const select = vi.fn(); render(<InboxWorkTools onSelectRoom={select} />);
    fireEvent.click(screen.getByRole('button', { name: 'การแจ้งเตือนงาน 1' }));
    fireEvent.click(screen.getByRole('button', { name: /มีโน้ตถึงคุณ/ }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(select).not.toHaveBeenCalled(); expect(mocks.markRead).not.toHaveBeenCalled();
  });
  it('opens the exact authorized note and marks only that notification read', async () => {
    mocks.getTarget.mockResolvedValueOnce({ roomId: 'room', targetId: 'note', targetType: 'NOTE', title: 'โน้ตภายใน', content: 'ตรวจเอกสารก่อนโทร' });
    mocks.markRead.mockResolvedValueOnce({});
    const select = vi.fn(); render(<InboxWorkTools onSelectRoom={select} />);
    fireEvent.click(screen.getByRole('button', { name: 'การแจ้งเตือนงาน 1' }));
    fireEvent.click(screen.getByRole('button', { name: /มีโน้ตถึงคุณ/ }));
    await waitFor(() => expect(select).toHaveBeenCalledWith('room'));
    expect(mocks.getTarget).toHaveBeenLastCalledWith('NOTE', 'note');
    expect(mocks.markRead).toHaveBeenCalledWith('n');
    expect(screen.getByText('ตรวจเอกสารก่อนโทร')).toBeInTheDocument();
  });
});
