import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, it, expect } from 'vitest';
import SlotPicker from './SlotPicker';
const branches = [
  { id: 'a', name: 'สาขา A' },
  { id: 'b', name: 'สาขา B' },
];
it('clears the selected time when changing branch and distinguishes errors from empty availability', async () => {
  const load = vi
    .fn()
    .mockResolvedValue([
      { startsAt: '2026-10-13T03:00:00Z', endsAt: '2026-10-13T03:45:00Z', available: 1 },
    ]);
  const change = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SlotPicker
        branches={branches}
        branchId="a"
        day="2026-10-13"
        selected="2026-10-13T03:00:00Z"
        onChange={change}
        load={load}
        queryScope="test"
      />
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: /10:00/ });
  fireEvent.change(screen.getByLabelText('สาขา'), { target: { value: 'b' } });
  expect(change).toHaveBeenCalledWith({ branchId: 'b', day: '2026-10-13', startsAt: '' });
});
it('offers a retry when availability fails', async () => {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SlotPicker
        branches={branches}
        branchId="a"
        day="2026-10-13"
        selected=""
        onChange={() => {}}
        load={() => Promise.reject(new Error('offline'))}
        queryScope="failed"
      />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('button', { name: 'ลองใหม่' })).toBeInTheDocument();
  expect(screen.queryByText('วันนี้ยังไม่มีเวลาว่าง กรุณาเลือกวันอื่น')).not.toBeInTheDocument();
});

it('explains why slots cannot load before a branch is selected', () => {
  const load = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SlotPicker
        branches={[]}
        branchId=""
        day="2026-10-16"
        selected=""
        onChange={vi.fn()}
        load={load}
        queryScope="test"
      />
    </QueryClientProvider>,
  );
  expect(screen.getByRole('status')).toHaveTextContent('เลือกสาขาเพื่อดูเวลาว่าง');
  expect(screen.getByLabelText('สาขา', { exact: true })).toBeDisabled();
  expect(screen.getByLabelText('วันที่นัด', { exact: true })).toBeDisabled();
  expect(load).not.toHaveBeenCalled();
});
