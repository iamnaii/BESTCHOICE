import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import api from '@/lib/api';
import TodosPage from './index';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'staff-1', role: 'SALES' } }) }));
vi.mock('@/lib/api', () => ({
  default: { get: vi.fn() },
  getErrorMessage: () => 'เกิดข้อผิดพลาด',
}));
vi.mock('./components/TodoKanbanView', () => ({ TodoKanbanView: () => <div>รายการงาน</div> }));
vi.mock('./components/TodoForm', () => ({ TodoForm: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data:
      url === '/users'
        ? []
        : {
            data: [],
            total: 0,
            summary: { all: 0, today: 0, upcoming: 0, priority: 0, completed: 0 },
          },
  }));
});

function openTodos(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <TodosPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('staff home task link', () => {
  it('preserves the personal/today context and keeps the assignee when switching tabs', async () => {
    openTodos('/todos?view=today&assigneeId=me');
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/todos?view=today&assigneeId=me&limit=100'),
    );
    expect(api.get).not.toHaveBeenCalledWith('/users');
    fireEvent.click(screen.getByRole('button', { name: /^ทั้งหมด/ }));
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/todos?view=all&assigneeId=me&limit=100'),
    );
  });

  it('defaults unknown views to the normal all view', async () => {
    openTodos('/todos?view=unknown');
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/todos?view=all&limit=100'));
  });
});
