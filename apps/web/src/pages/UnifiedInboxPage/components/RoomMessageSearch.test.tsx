import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RoomMessageSearch from './RoomMessageSearch';

const get = vi.fn();
vi.mock('@/lib/api', () => ({ default: { get: (...args: unknown[]) => get(...args) } }));
vi.mock('../hooks/useChatWork', () => ({ useChatWorkSettings: () => ({ key: ['chat-work', 'SHOP'], scope: { company: 'SHOP' } }) }));
function setup() {
  const select = vi.fn();
  const close = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RoomMessageSearch open roomId="room-1" onClose={close} onSelect={select} /></QueryClientProvider>);
  return { select, close };
}
describe('room message search', () => {
  beforeEach(() => get.mockReset());
  it('scopes historical search, opens a hit and clears stale results while the query changes', async () => {
    get.mockResolvedValue({ data: { data: [{ id: 'old-hit', text: 'อยากซื้อ iPhone', role: 'CUSTOMER', createdAt: '2026-10-19T01:00:00Z' }], total: 1, limit: 20 } });
    const { select, close } = setup();
    const input = screen.getByRole('textbox', { name: 'ข้อความที่ต้องการค้นหา' });
    expect(get).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'iPhone' } });
    await screen.findByText('พบ 1 ข้อความ');
    expect(get).toHaveBeenCalledWith('/staff-chat/rooms/room-1/messages/search', expect.objectContaining({ params: { company: 'SHOP', q: 'iPhone', page: 1 } }));
    fireEvent.change(input, { target: { value: 'ไม่มี' } });
    expect(screen.queryByRole('button', { name: /อยากซื้อ/ })).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'iPhone' } });
    fireEvent.click(await screen.findByRole('button', { name: /อยากซื้อ/ }));
    expect(select).toHaveBeenCalledWith('old-hit');
    expect(close).toHaveBeenCalled();
  });
  it('offers retry on error and fetches subsequent pages without stale hits', async () => {
    get.mockRejectedValueOnce(new Error('network')).mockResolvedValue({ data: { data: [{ id: 'hit-1', text: 'รุ่นที่สนใจ', role: 'CUSTOMER', createdAt: '2026-10-19T01:00:00Z' }], total: 21, limit: 20 } });
    setup();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'รุ่น' } });
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    await screen.findByText('พบ 21 ข้อความ');
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ params: { company: 'SHOP', q: 'รุ่น', page: 2 } })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'ถัดไป' })).toBeDisabled());
  });
  it('closes after selection and can reopen with the previous query', async () => {
    get.mockResolvedValue({ data: { data: [{ id: 'old-hit', text: 'อยากซื้อ iPhone', role: 'CUSTOMER', createdAt: '2026-10-19T01:00:00Z' }], total: 1, limit: 20 } });
    const select = vi.fn();
    function ControlledSearch() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>ค้นหา</button><RoomMessageSearch roomId="room-1" open={open} onClose={() => setOpen(false)} onSelect={select} /></>;
    }
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ControlledSearch /></QueryClientProvider>);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'ค้นหา' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'iPhone' } });
    fireEvent.click(await screen.findByRole('button', { name: /อยากซื้อ/ }));
    expect(select).toHaveBeenCalledWith('old-hit');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'ค้นหา' }));
    expect(screen.getByRole('textbox')).toHaveValue('iPhone');
    fireEvent.click(screen.getByRole('button', { name: 'ปิด' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
