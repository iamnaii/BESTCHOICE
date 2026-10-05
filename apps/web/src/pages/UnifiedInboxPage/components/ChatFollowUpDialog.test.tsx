import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ChatFollowUpDialog from './ChatFollowUpDialog';
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: api, getErrorMessage: () => 'บันทึกไม่ได้' }));
vi.mock('../hooks/useChatWork', () => ({
  useChatWorkSettings: () => ({
    company: 'SHOP',
    scope: { company: 'SHOP' },
    key: ['chat-work', 'user', 'SHOP'],
  }),
}));
function view(
  editing?: {
    id: string;
    title: string;
    dueDate: string;
    assigneeId: string;
    revision: number;
    status: 'TODO';
  },
  handoff = false,
) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <ChatFollowUpDialog
        roomId="room"
        open
        onOpenChange={vi.fn()}
        editing={editing}
        handoff={handoff}
      />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ data: [{ id: 'staff', name: 'เมย์' }] });
});
describe('Chat follow-up form', () => {
  it('retains Bangkok time and the draft after a conflict, requiring latest revision before retry', async () => {
    api.patch.mockRejectedValueOnce({ response: { status: 409 } }).mockResolvedValue({ data: {} });
    view({
      id: 'task',
      title: 'นัดเดิม',
      dueDate: '2026-10-06T03:30:00Z',
      assigneeId: 'staff',
      revision: 1,
      status: 'TODO',
    });
    expect(screen.getByLabelText('วันเวลานัด (เวลาไทย)')).toHaveValue('2026-10-06T10:30');
    fireEvent.change(screen.getByLabelText('เรื่องที่ติดตาม'), {
      target: { value: 'เลื่อนนัดที่พิมพ์ไว้' },
    });
    await screen.findByRole('option', { name: 'เมย์' });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกนัด' }));
    await screen.findByText(/มีคนแก้ไขนัดนี้แล้ว/);
    expect(screen.getByLabelText('เรื่องที่ติดตาม')).toHaveValue('เลื่อนนัดที่พิมพ์ไว้');
    expect(screen.getByRole('button', { name: 'บันทึกนัด' })).toBeDisabled();
    api.get.mockResolvedValueOnce({
      data: { revision: 2, title: 'อีกคนแก้', dueDate: '2026-10-06T04:30:00Z', status: 'TODO' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'โหลดข้อมูลล่าสุดเพื่อเทียบ' }));
    await screen.findByText('อีกคนแก้');
    fireEvent.click(screen.getByRole('button', { name: 'ใช้ฉบับร่างนี้กับข้อมูลล่าสุด' }));
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกนัด' }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenLastCalledWith(
        '/staff-chat/follow-ups/task',
        expect.objectContaining({
          title: 'เลื่อนนัดที่พิมพ์ไว้',
          expectedRevision: 2,
          dueAt: '2026-10-06T03:30:00.000Z',
        }),
        expect.anything(),
      ),
    );
  });
  it.each([false, true])(
    'recovers a committed create and explicitly updates the retained edited draft (handoff=%s)',
    async (handoff) => {
      const titleLabel = handoff ? 'เรื่องที่ฝาก' : 'เรื่องที่ติดตาม';
      const saveLabel = handoff ? 'ส่งงาน' : 'บันทึกนัด';
      api.post.mockRejectedValueOnce(new Error('response lost')).mockRejectedValueOnce({
        response: {
          status: 409,
          data: { code: 'CHAT_TASK_REQUEST_MISMATCH', taskId: 'committed-task' },
        },
      });
      api.patch.mockResolvedValue({ data: {} });
      view(undefined, handoff);
      fireEvent.change(screen.getByLabelText(titleLabel), { target: { value: 'original' } });
      fireEvent.change(screen.getByLabelText('วันเวลานัด (เวลาไทย)'), {
        target: { value: '2026-10-06T10:30' },
      });
      await screen.findByRole('option', { name: 'เมย์' });
      fireEvent.change(screen.getByLabelText('ผู้รับผิดชอบงาน'), { target: { value: 'staff' } });
      fireEvent.click(screen.getByRole('button', { name: saveLabel }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: saveLabel })).not.toBeDisabled(),
      );
      fireEvent.change(screen.getByLabelText(titleLabel), {
        target: { value: 'edited draft' },
      });
      fireEvent.click(screen.getByRole('button', { name: saveLabel }));
      await screen.findByText(/งานนี้บันทึกไปแล้ว/);
      api.get.mockResolvedValueOnce({
        data: {
          id: 'committed-task',
          revision: 0,
          title: 'original',
          dueDate: '2026-10-06T03:30:00Z',
          assigneeId: 'staff',
          status: 'TODO',
        },
      });
      fireEvent.click(screen.getByRole('button', { name: 'โหลดข้อมูลล่าสุดเพื่อเทียบ' }));
      await screen.findByText('original');
      expect(api.get).toHaveBeenLastCalledWith('/todos/committed-task', expect.anything());
      expect(screen.getByLabelText(titleLabel)).toHaveValue('edited draft');
      fireEvent.click(screen.getByRole('button', { name: 'ใช้ฉบับร่างนี้กับข้อมูลล่าสุด' }));
      fireEvent.click(screen.getByRole('button', { name: saveLabel }));
      await waitFor(() =>
        expect(api.patch).toHaveBeenCalledWith(
          handoff
            ? '/staff-chat/handoffs/committed-task/details'
            : '/staff-chat/follow-ups/committed-task',
          expect.objectContaining({ title: 'edited draft', expectedRevision: 0 }),
          expect.anything(),
        ),
      );
      expect(api.post).toHaveBeenCalledTimes(2);
    },
  );
  it('uses one request token when retrying a failed create', async () => {
    api.post.mockRejectedValueOnce(new Error()).mockResolvedValue({ data: {} });
    view();
    fireEvent.change(screen.getByLabelText('เรื่องที่ติดตาม'), { target: { value: 'โทรติดตาม' } });
    fireEvent.change(screen.getByLabelText('วันเวลานัด (เวลาไทย)'), {
      target: { value: '2026-10-06T10:30' },
    });
    await screen.findByRole('option', { name: 'เมย์' });
    fireEvent.change(screen.getByLabelText('ผู้รับผิดชอบงาน'), { target: { value: 'staff' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกนัด' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'บันทึกนัด' })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกนัด' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post.mock.calls[0][1].clientRequestId).toBe(
      api.post.mock.calls[1][1].clientRequestId,
    );
  });
});
