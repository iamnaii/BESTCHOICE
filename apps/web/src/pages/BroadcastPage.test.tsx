import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import BroadcastPage from './BroadcastPage';
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  user: { id: 'reviewer', role: 'OWNER' },
}));
vi.mock('@/lib/api', () => ({
  default: { get: mocks.get, post: mocks.post, delete: mocks.delete },
  getErrorMessage: () => 'เกิดข้อผิดพลาด',
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.id = 'reviewer';
  mocks.get.mockImplementation(async (url: string) => ({
    data: url.includes('/history')
      ? {
          data: [
            {
              id: 'draft',
              messages: [
                { type: 'text', content: { text: 'ข้อความรออนุมัติ' } },
                { type: 'text', content: { text: 'รายละเอียดข้อความที่สองต้องตรวจได้ครบ' } },
              ],
              audience: 'EXISTING',
              audienceCount: 2,
              status: 'PENDING_APPROVAL',
              scheduledAt: null,
              sentAt: null,
              createdById: 'creator',
            },
          ],
          total: 1,
          page: 1,
          limit: 20,
        }
      : { all: 3, existing: 2, overdue: 1, new: 1 },
  }));
  mocks.post.mockResolvedValue({ data: { success: true, message: 'สำเร็จ' } });
});
function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <BroadcastPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it('renders actual API history and allows a different owner to approve', async () => {
  mount();
  fireEvent.mouseDown(screen.getByRole('tab', { name: /ประวัติ/ }), { button: 0, ctrlKey: false });
  expect(await screen.findByText('ข้อความรออนุมัติ')).toBeInTheDocument();
  expect(screen.getByText('รออนุมัติ')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'อนุมัติ' }));
  const review = within(screen.getByRole('dialog'));
  expect(review.getByText('ข้อความรออนุมัติ')).toBeInTheDocument();
  expect(review.getByText('รายละเอียดข้อความที่สองต้องตรวจได้ครบ')).toBeInTheDocument();
  expect(review.getByText('ส่งทันทีหลังอนุมัติ')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'ยืนยันอนุมัติ' }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith('/line-oa/broadcast/draft/approve', {}),
  );
});

it('reports cancellation failure when sending has already started', async () => {
  mocks.get.mockResolvedValue({
    data: {
      data: [
        {
          id: 'scheduled',
          messages: [{ type: 'text', content: 'Scheduled message' }],
          audience: 'ALL',
          audienceCount: 3,
          status: 'SCHEDULED',
          scheduledAt: '2027-01-01T00:00:00Z',
          sentAt: null,
          createdById: 'creator',
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    },
  });
  mocks.delete.mockResolvedValue({
    data: { success: false, message: 'รายการนี้เริ่มส่งหรือถูกดำเนินการแล้ว' },
  });
  mount();
  fireEvent.mouseDown(screen.getByRole('tab', { name: /ประวัติ/ }), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByRole('button', { name: 'ยกเลิก' }));
  fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก Broadcast' }));
  await waitFor(() => expect(mocks.delete).toHaveBeenCalledWith('/line-oa/broadcast/scheduled'));
  await waitFor(() =>
    expect(mocks.error).toHaveBeenCalledWith('รายการนี้เริ่มส่งหรือถูกดำเนินการแล้ว'),
  );
  expect(mocks.success).not.toHaveBeenCalled();
});
it('does not offer self approval', async () => {
  mocks.user.id = 'creator';
  mount();
  fireEvent.mouseDown(screen.getByRole('tab', { name: /ประวัติ/ }), { button: 0, ctrlKey: false });
  await screen.findByText('ข้อความรออนุมัติ');
  expect(screen.queryByRole('button', { name: 'อนุมัติ' })).not.toBeInTheDocument();
  expect(screen.getAllByText('รอผู้อนุมัติคนที่สอง').length).toBeGreaterThan(0);
});

it('keeps text input focused across edits and submits the API audience key for approval', async () => {
  mount();
  const input = screen.getByPlaceholderText('พิมพ์ข้อความที่ต้องการ broadcast...');
  input.focus();
  fireEvent.change(input, { target: { value: 'ข้อความทดสอบ' } });
  expect(input).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'ส่ง Broadcast' }));
  fireEvent.click(screen.getByRole('button', { name: 'บันทึกรออนุมัติ' }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith('/line-oa/broadcast', {
      audience: 'ALL',
      messages: [{ type: 'text', content: { text: 'ข้อความทดสอบ' } }],
    }),
  );
});

it('requires a rejection reason inside the confirmation dialog', async () => {
  mount();
  fireEvent.mouseDown(screen.getByRole('tab', { name: /ประวัติ/ }), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByRole('button', { name: 'ปฏิเสธ' }));
  const confirm = screen.getByRole('button', { name: 'ยืนยันปฏิเสธ' });
  expect(confirm).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: 'เหตุผลการปฏิเสธ' }), {
    target: { value: 'แก้ไขข้อความก่อนส่ง' },
  });
  fireEvent.click(confirm);
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith('/line-oa/broadcast/draft/reject', {
      reason: 'แก้ไขข้อความก่อนส่ง',
    }),
  );
});
