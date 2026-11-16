import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatServiceRequestDialog from './ChatServiceRequestDialog';
import { pickComboOption } from '@/test/combobox';

const mocks = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/lib/api', () => ({ default: mocks.api, getErrorMessage: () => 'บันทึกไม่ได้' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../hooks/useChatWork', () => ({
  useChatWorkSettings: () => ({
    company: 'SHOP',
    scope: { company: 'SHOP' },
    key: ['chat-work', 'u', 'SHOP'],
  }),
}));

function view() {
  const onCreated = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <ChatServiceRequestDialog roomId="room" onClose={vi.fn()} onCreated={onCreated} />
    </QueryClientProvider>,
  );
  return onCreated;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.get.mockImplementation((url: string) =>
    Promise.resolve({
      data: url.endsWith('eligible-staff')
        ? [
            { id: 'u1', name: 'เมย์', detail: 'สาขาลาดพร้าว · SALES · 0000u1' },
            { id: 'u2', name: 'ต้น' },
          ]
        : { data: [], total: 0 },
    }),
  );
});

describe('ChatServiceRequestDialog — assignee combobox (R2-4a)', () => {
  it('keeps save disabled until an assignee is picked, then posts the picked id', async () => {
    const user = userEvent.setup();
    mocks.api.post.mockResolvedValue({ data: { id: 'sr-1' } });
    const onCreated = view();
    fireEvent.change(screen.getByLabelText('อาการที่ลูกค้าแจ้ง'), {
      target: { value: 'จอเป็นเส้นแนวตั้ง' },
    });
    fireEvent.change(screen.getByLabelText('นัดติดตาม (เวลาไทย)'), {
      target: { value: '2026-10-06T10:30' },
    });
    const save = screen.getByRole('button', { name: 'บันทึกรับเรื่อง' });
    const assignee = screen.getByRole('combobox', { name: 'ผู้รับผิดชอบ' });
    expect(assignee).toHaveAttribute('aria-required', 'true');
    expect(assignee).toHaveTextContent('เลือกผู้ติดตาม');
    expect(save).toBeDisabled();
    await waitFor(() =>
      expect(mocks.api.get).toHaveBeenCalledWith(
        '/staff-chat/rooms/room/eligible-staff',
        expect.anything(),
      ),
    );

    await pickComboOption(user, 'ผู้รับผิดชอบ', 'เมย์ สาขาลาดพร้าว · SALES · 0000u1', {
      search: 'เมย์',
    });

    expect(assignee).toHaveTextContent('เมย์ สาขาลาดพร้าว · SALES · 0000u1');
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() =>
      expect(mocks.api.post).toHaveBeenCalledWith(
        '/staff-chat/rooms/room/service-requests',
        expect.objectContaining({
          symptom: 'จอเป็นเส้นแนวตั้ง',
          assigneeId: 'u1',
          dueAt: '2026-10-06T03:30:00.000Z',
          sourceMessageIds: [],
        }),
        { params: { company: 'SHOP' } },
      ),
    );
    expect(onCreated).toHaveBeenCalledWith('sr-1');
  });
});
