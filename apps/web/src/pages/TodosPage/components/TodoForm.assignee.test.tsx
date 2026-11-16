import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pickComboOption } from '@/test/combobox';
import type { Todo } from '../types';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@/lib/api', () => ({
  default: api,
  getErrorMessage: (e: unknown) => String(e),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TodoForm } from './TodoForm';

const staff = [
  { id: 'u1', name: 'สมชาย ใจดี', nickname: 'ชาย' },
  { id: 'u2', name: 'สมหญิง รักงาน' },
];

const assignedElsewhere: Todo = {
  id: 't1',
  title: 'งานเดิม',
  status: 'TODO',
  priority: 'MEDIUM',
  revision: 3,
  assigneeId: 'u9',
  assignee: { id: 'u9', name: 'พนักงานสาขาอื่น' },
  createdById: 'u1',
  tags: [],
  createdAt: '2026-11-01T00:00:00.000Z',
};

function view(editing: Todo | null = null) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <MemoryRouter>
        <TodoForm open onOpenChange={() => {}} editing={editing} staffUsers={staff} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ data: [] });
  api.post.mockResolvedValue({ data: {} });
  api.patch.mockResolvedValue({ data: {} });
});

describe('TodoForm — assignee combobox (R2-4a)', () => {
  it('sends the picked assignee id when creating a todo', async () => {
    const user = userEvent.setup();
    view();
    fireEvent.change(screen.getByLabelText(/ชื่องาน/), { target: { value: 'โทรหาลูกค้า' } });
    const assignee = screen.getByRole('combobox', { name: 'ผู้รับมอบหมาย' });
    expect(assignee).toHaveTextContent('ไม่ระบุ');

    await pickComboOption(user, 'ผู้รับมอบหมาย', 'ชาย', { search: 'สมชาย' });

    expect(assignee).toHaveTextContent('ชาย');
    await user.click(screen.getByRole('button', { name: 'สร้างงาน' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/todos',
        expect.objectContaining({ title: 'โทรหาลูกค้า', assigneeId: 'u1' }),
      ),
    );
  });

  it('"ไม่ระบุ" sends no assigneeId', async () => {
    const user = userEvent.setup();
    view();
    fireEvent.change(screen.getByLabelText(/ชื่องาน/), { target: { value: 'งานไม่มีคนรับ' } });
    await pickComboOption(user, 'ผู้รับมอบหมาย', 'สมหญิง รักงาน');
    await pickComboOption(user, 'ผู้รับมอบหมาย', 'ไม่ระบุ');
    await user.click(screen.getByRole('button', { name: 'สร้างงาน' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post.mock.calls[0][1].assigneeId).toBeUndefined();
  });

  it('editing a todo assigned outside the list shows the saved name and keeps the id', async () => {
    const user = userEvent.setup();
    view(assignedElsewhere);
    const assignee = screen.getByRole('combobox', { name: 'ผู้รับมอบหมาย' });
    await waitFor(() => expect(assignee).toHaveTextContent('พนักงานสาขาอื่น'));
    await user.click(screen.getByRole('button', { name: 'บันทึกการแก้ไข' }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        '/todos/t1',
        expect.objectContaining({ assigneeId: 'u9', expectedRevision: 3 }),
      ),
    );
  });
});
