import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import api from '@/lib/api';
import TodosPage from './index';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'staff-1', role: 'SALES' } }) }));
vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), patch: vi.fn() },
  getErrorMessage: () => 'เกิดข้อผิดพลาด',
}));
vi.mock('./components/TodoKanbanView', () => ({ TodoKanbanView: ({ todos, onToggle }: { todos: { id: string }[]; onToggle: (id: string) => void }) => <div>รายการงาน{todos.map(t => <button key={t.id} onClick={() => onToggle(t.id)}>จบงาน {t.id}</button>)}</div> }));
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

function openTodos(path: string, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <TodosPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('staff home task link', () => {
  it('updates a room task with its revision even when the dossier array cache is present', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    client.setQueryData(['todos', 'chat-work', 'SHOP', 'room', 'room'], [{ id: 'task', revision: 1 }]);
    vi.mocked(api.get).mockResolvedValue({ data: { data: [{ id: 'task', roomId: 'room', revision: 1, status: 'TODO', title: 'นัด' }], total: 1, summary: { all: 1 } } });
    vi.mocked(api.patch).mockResolvedValue({ data: { id: 'task', status: 'DONE', revision: 2 } });
    openTodos('/todos', client);
    fireEvent.click(await screen.findByRole('button', { name: 'จบงาน task' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/todos/task/toggle', {}, { params: { expectedRevision: 1 } }));
    expect(client.getQueryData(['todos', 'chat-work', 'SHOP', 'room', 'room'])).toEqual([{ id: 'task', revision: 1 }]);
  });
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
