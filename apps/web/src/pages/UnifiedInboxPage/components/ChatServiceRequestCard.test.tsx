import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatServiceRequestCard from './ChatServiceRequestCard';
import { pickComboOption } from '@/test/combobox';
const mocks = vi.hoisted(() => ({ api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
vi.mock('@/lib/api', () => ({ default: mocks.api, getErrorMessage: () => 'บันทึกไม่ได้' }));
vi.mock('../hooks/useChatWork', () => ({
  useChatWorkSettings: () => ({
    company: 'SHOP',
    scope: { company: 'SHOP' },
    key: ['chat-work', 'u', 'SHOP'],
  }),
}));
const row = {
  id: 'intake',
  roomId: 'room',
  symptom: 'หน้าจอสัมผัสไม่ตอบสนอง',
  status: 'OPEN',
  revision: 0,
  todo: {
    status: 'TODO',
    assigneeId: 'u',
    assignee: { name: 'เมย์' },
    dueDate: '2026-10-07T03:00:00Z',
  },
  sourceMessages: [],
  currentCustomerId: null,
  canOpenCase: false,
  canLinkCase: false,
  linkedCase: null,
};
function view() {
  return render(
    <MemoryRouter>
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        <ChatServiceRequestCard requestId="intake" />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.get.mockImplementation((url: string) =>
    Promise.resolve({ data: url.endsWith('eligible-staff') ? [{ id: 'u', name: 'เมย์' }] : row }),
  );
});
describe('Service request card', () => {
  it('keeps chat intake distinct from physical receipt and requires known customer before opening a case', async () => {
    view();
    await screen.findByText('รับเรื่องทางแชทแล้ว ยังไม่ใช่การรับฝากเครื่อง');
    expect(screen.queryByRole('link', { name: 'เปิดเคสหลังการขาย' })).not.toBeInTheDocument();
    expect(mocks.api.post).not.toHaveBeenCalled();
  });
  it('shows live linked case stage with original-case link and no local repair selector', async () => {
    mocks.api.get.mockResolvedValue({
      data: {
        ...row,
        status: 'LINKED',
        linkedCase: { id: 'case', caseNumber: 'AS-001', stage: 'CLOSED' },
        todo: { ...row.todo, status: 'DONE' },
      },
    });
    view();
    expect(await screen.findByRole('link', { name: /AS-001/ })).toHaveAttribute(
      'href',
      '/after-sales/case',
    );
    expect(
      screen.queryByText('รับเรื่องทางแชทแล้ว ยังไม่ใช่การรับฝากเครื่อง'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'แก้ไขการติดตาม' })).not.toBeInTheDocument();
  });
  it('keeps closure reason on conflict and requires explicit latest revision before retry', async () => {
    mocks.api.patch.mockRejectedValue({ response: { status: 409 } });
    view();
    fireEvent.click(await screen.findByRole('button', { name: 'แก้ไขการติดตาม' }));
    fireEvent.change(screen.getByLabelText('สถานะรับเรื่อง'), { target: { value: 'RESOLVED' } });
    fireEvent.change(screen.getByLabelText('เหตุผล'), { target: { value: 'ลูกค้าแก้ไขได้แล้ว' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกการติดตาม' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('เหตุผล')).toHaveValue('ลูกค้าแก้ไขได้แล้ว');
    expect(screen.getByRole('button', { name: 'บันทึกการติดตาม' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'โหลดสถานะล่าสุด' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'บันทึกการติดตาม' })).toBeEnabled(),
    );
  });
  it('picks a new assignee from the eligible staff and PATCHes it (R2-4a)', async () => {
    const user = userEvent.setup();
    mocks.api.get.mockImplementation((url: string) =>
      Promise.resolve({
        data: url.endsWith('eligible-staff')
          ? [
              { id: 'u', name: 'เมย์' },
              { id: 'v', name: 'ต้น', detail: 'สาขาลาดพร้าว · SALES · 00000v' },
            ]
          : row,
      }),
    );
    mocks.api.patch.mockResolvedValue({ data: {} });
    view();
    await user.click(await screen.findByRole('button', { name: 'แก้ไขการติดตาม' }));
    const assignee = screen.getByRole('combobox', { name: 'ผู้รับผิดชอบ' });
    expect(assignee).toHaveTextContent('เมย์');
    await waitFor(() =>
      expect(mocks.api.get).toHaveBeenCalledWith(
        '/staff-chat/rooms/room/eligible-staff',
        expect.anything(),
      ),
    );

    await pickComboOption(user, 'ผู้รับผิดชอบ', 'ต้น สาขาลาดพร้าว · SALES · 00000v', {
      search: 'ต้น',
    });

    expect(assignee).toHaveTextContent('ต้น สาขาลาดพร้าว · SALES · 00000v');
    await user.click(screen.getByRole('button', { name: 'บันทึกการติดตาม' }));
    await waitFor(() =>
      expect(mocks.api.patch).toHaveBeenCalledWith(
        '/staff-chat/service-requests/intake',
        expect.objectContaining({ expectedRevision: 0, status: 'OPEN', assigneeId: 'v' }),
        { params: { company: 'SHOP' } },
      ),
    );
  });
  it('keeps an assignee who left the eligible list as the first row; picking it back sends no assigneeId', async () => {
    const user = userEvent.setup();
    const formerRow = {
      ...row,
      todo: { ...row.todo, assigneeId: 'gone', assignee: { name: 'คนเดิม' } },
    };
    mocks.api.get.mockImplementation((url: string) =>
      Promise.resolve({
        data: url.endsWith('eligible-staff') ? [{ id: 'v', name: 'ต้น' }] : formerRow,
      }),
    );
    mocks.api.patch.mockResolvedValue({ data: {} });
    view();
    await user.click(await screen.findByRole('button', { name: 'แก้ไขการติดตาม' }));
    const assignee = screen.getByRole('combobox', { name: 'ผู้รับผิดชอบ' });
    expect(assignee).toHaveTextContent('คนเดิม');
    await waitFor(() =>
      expect(mocks.api.get).toHaveBeenCalledWith(
        '/staff-chat/rooms/room/eligible-staff',
        expect.anything(),
      ),
    );
    await pickComboOption(user, 'ผู้รับผิดชอบ', 'ต้น');
    await pickComboOption(user, 'ผู้รับผิดชอบ', 'คนเดิม');
    expect(assignee).toHaveTextContent('คนเดิม');
    await user.click(screen.getByRole('button', { name: 'บันทึกการติดตาม' }));
    await waitFor(() => expect(mocks.api.patch).toHaveBeenCalledTimes(1));
    expect(mocks.api.patch.mock.calls[0][1]).not.toHaveProperty('assigneeId');
  });
});
