import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toast } from 'sonner';
import { CheckSquare, Plus } from 'lucide-react';
import { TodoFilters } from './components/TodoFilters';
import { TodoKanbanView } from './components/TodoKanbanView';
import { TodoForm } from './components/TodoForm';
import {
  type Todo,
  type TodoStatus,
  type TodoView,
  type AssigneeRef,
  type TodosResponse,
} from './types';

export default function TodosPage() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<TodoView>('all');
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: string }>({
    open: false,
    id: '',
  });
  const [editing, setEditing] = useState<Todo | null>(null);

  const { data: staffUsers = [] } = useQuery<AssigneeRef[]>({
    queryKey: ['staff-users-todo'],
    queryFn: async () => {
      const { data } = await api.get('/users');
      const list = data.data || data || [];
      return Array.isArray(list) ? list : [];
    },
  });

  const { data, isLoading, isError, error, refetch } = useQuery<TodosResponse>({
    queryKey: ['todos', view, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('view', view);
      if (search) params.set('search', search);
      params.set('limit', '100');
      const { data } = await api.get(`/todos?${params}`);
      return data;
    },
  });

  const todos = data?.data || [];
  const summary = data?.summary || { all: 0, today: 0, upcoming: 0, priority: 0, completed: 0 };

  const moveStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: TodoStatus }) => {
      const { data } = await api.patch(`/todos/${id}`, { status });
      return data;
    },
    // Optimistic update: patch cache immediately so the card appears in
    // the destination column without waiting for the API round-trip.
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ['todos'] });
      const snapshots = queryClient.getQueriesData<TodosResponse>({ queryKey: ['todos'] });
      snapshots.forEach(([key, prev]) => {
        if (!prev) return;
        const next: TodosResponse = {
          ...prev,
          data: prev.data.map((t) =>
            t.id === id
              ? {
                  ...t,
                  status,
                  completedAt: status === 'DONE' ? new Date().toISOString() : null,
                }
              : t,
          ),
        };
        queryClient.setQueryData(key, next);
      });
      return { snapshots };
    },
    onError: (e, _vars, ctx) => {
      // Rollback
      ctx?.snapshots.forEach(([key, prev]) => queryClient.setQueryData(key, prev));
      toast.error(getErrorMessage(e));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
  });

  const toggleMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.patch(`/todos/${id}/toggle`);
      return data;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['todos'] });
      const snapshots = queryClient.getQueriesData<TodosResponse>({ queryKey: ['todos'] });
      snapshots.forEach(([key, prev]) => {
        if (!prev) return;
        const next: TodosResponse = {
          ...prev,
          data: prev.data.map((t) =>
            t.id === id
              ? {
                  ...t,
                  status: t.status === 'DONE' ? 'TODO' : 'DONE',
                  completedAt: t.status === 'DONE' ? null : new Date().toISOString(),
                }
              : t,
          ),
        };
        queryClient.setQueryData(key, next);
      });
      return { snapshots };
    },
    onError: (e, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, prev]) => queryClient.setQueryData(key, prev));
      toast.error(getErrorMessage(e));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/todos/${id}`);
    },
    onSuccess: () => {
      toast.success('ลบรายการแล้ว');
      queryClient.invalidateQueries({ queryKey: ['todos'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (t: Todo) => {
    setEditing(t);
    setDialogOpen(true);
  };

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) setEditing(null);
  };

  const tabCounts: Record<TodoView, number> = {
    all: summary.all,
    today: summary.today,
    upcoming: summary.upcoming,
    priority: summary.priority,
    completed: summary.completed,
  };

  return (
    <div>
      <PageHeader
        title="งาน / สิ่งที่ต้องทำ"
        subtitle="จัดการรายการงานของทีม มอบหมาย ติดตามสถานะ"
        icon={<CheckSquare className="size-5" />}
        action={
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
          >
            <Plus className="size-4" />
            เพิ่มงาน
          </button>
        }
      />

      <TodoFilters
        view={view}
        onViewChange={setView}
        search={search}
        onSearchChange={setSearch}
        tabCounts={tabCounts}
      />

      <TodoKanbanView
        todos={todos}
        isLoading={isLoading && !data}
        isError={isError}
        error={error as Error | null}
        onRefetch={refetch}
        onCardClick={openEdit}
        onCardMove={(id, _from, to) =>
          moveStatusMutation.mutate({ id, status: to as TodoStatus })
        }
        onToggle={(id) => toggleMutation.mutate(id)}
        onDeleteRequest={(id) => setDeleteConfirm({ open: true, id })}
      />

      <TodoForm
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        editing={editing}
        staffUsers={staffUsers}
      />

      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm((prev) => ({ ...prev, open }))}
        description="ต้องการลบรายการนี้?"
        variant="destructive"
        onConfirm={() => deleteMutation.mutate(deleteConfirm.id)}
      />
    </div>
  );
}
