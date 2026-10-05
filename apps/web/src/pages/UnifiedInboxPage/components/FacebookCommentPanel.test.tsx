import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { it, expect, vi, beforeEach } from 'vitest';
import FacebookCommentPanel, { canReplyPublic } from './FacebookCommentPanel';
const mocks = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('@/lib/api', () => ({
  default: mocks.api,
  getErrorMessage: () => 'ตรวจผลการส่งก่อนลองใหม่',
}));
vi.mock('../hooks/useChatWork', () => ({
  useChatWorkSettings: () => ({
    company: 'SHOP',
    scope: { company: 'SHOP' },
    key: ['chat-work', 'actor', 'SHOP'],
  }),
}));
const fixture = {
  id: 'thread',
  revision: 1,
  status: 'OPEN',
  rootDeleted: false,
  needsReconciliation: false,
  assigneeId: null,
  capabilities: { publicReply: true, reason: null },
  permalink: 'https://www.facebook.com/post?comment_id=root',
  records: [
    { id: 'record', commentId: 'root', authorName: 'ลูกค้า', text: 'ราคาเท่าไร', deletedAt: null },
  ],
  recordsTotal: 1,
  repliesTotal: 0,
  replies: [],
  unresolvedReply: null,
};
const view = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <FacebookCommentPanel threadId="thread" />
    </QueryClientProvider>,
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.get.mockImplementation((url: string) =>
    Promise.resolve({ data: url.endsWith('eligible-staff') ? [] : fixture }),
  );
});
it('requires verified capability, live comment, no uncertain attempt and nonblank text', () => {
  const good = { capability: true, deleted: false, pending: false, text: 'ตอบ' };
  expect(canReplyPublic(good)).toBe(true);
  for (const patch of [{ capability: false }, { deleted: true }, { pending: true }, { text: '  ' }])
    expect(canReplyPublic({ ...good, ...patch })).toBe(false);
});
it('uses a separate public composer and confirmed acknowledgement clears only its sent draft', async () => {
  mocks.api.post.mockResolvedValue({ data: { id: 'reply', status: 'CONFIRMED' } });
  view();
  await screen.findByText('ราคาเท่าไร');
  expect(screen.queryByText('ข้อความสำเร็จรูป')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('คำตอบสาธารณะ'), {
    target: { value: 'ราคา 9,900 บาทค่ะ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'ตอบสาธารณะ' }));
  await waitFor(() => expect(screen.getByLabelText('คำตอบสาธารณะ')).toHaveValue(''));
  expect(mocks.api.post).toHaveBeenCalledWith(
    '/staff-chat/facebook-comments/thread/replies',
    { text: 'ราคา 9,900 บาทค่ะ', clientRequestId: expect.any(String) },
    expect.anything(),
  );
});
it('preserves uncertain text and disables blind resend even before polling catches up', async () => {
  mocks.api.post.mockResolvedValue({ data: { id: 'reply', status: 'UNKNOWN' } });
  view();
  await screen.findByText('ราคาเท่าไร');
  fireEvent.change(screen.getByLabelText('คำตอบสาธารณะ'), {
    target: { value: 'คำตอบที่รอยืนยัน' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'ตอบสาธารณะ' }));
  await screen.findByText('ยังไม่ทราบผลการส่ง');
  expect(screen.getByLabelText('คำตอบสาธารณะ')).toHaveValue('คำตอบที่รอยืนยัน');
  expect(screen.getByRole('button', { name: 'ตอบสาธารณะ' })).toBeDisabled();
  expect(mocks.api.post).toHaveBeenCalledTimes(1);
});
it('hides cached thread contents after access is revoked', async () => {
  mocks.api.get.mockRejectedValue({ response: { status: 404 } });
  view();
  await screen.findByRole('alert');
  expect(screen.queryByLabelText('คำตอบสาธารณะ')).not.toBeInTheDocument();
});
it('clears only the matching uncertain draft after proof confirms the same reply', async () => {
  mocks.api.get.mockImplementation((url: string) =>
    Promise.resolve({
      data: url.endsWith('eligible-staff')
        ? []
        : {
            ...fixture,
            unresolvedReply: { id: 'uncertain', status: 'UNKNOWN' },
            replies: [{ id: 'uncertain', status: 'UNKNOWN', text: 'คำตอบเดิม', externalId: null }],
          },
    }),
  );
  mocks.api.post.mockResolvedValue({
    data: { id: 'uncertain', status: 'CONFIRMED', text: 'คำตอบเดิม' },
  });
  view();
  fireEvent.change(await screen.findByLabelText('คำตอบสาธารณะ'), {
    target: { value: 'คำตอบเดิม' },
  });
  fireEvent.change(screen.getByLabelText('รหัสคำตอบบน Meta'), { target: { value: 'external' } });
  fireEvent.change(screen.getByLabelText('รายละเอียดที่ตรวจพบ'), {
    target: { value: 'พบคำตอบตรงกัน' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'ตรวจหลักฐานการส่ง' }));
  await waitFor(() => expect(screen.getByLabelText('คำตอบสาธารณะ')).toHaveValue(''));
});
