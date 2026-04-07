import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import { KanbanBoard, type KanbanColumn } from '@/components/ui/KanbanBoard';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  CheckSquare,
  Plus,
  Trash2,
  Calendar,
  Flag,
  X,
  ListTodo,
  Clock,
  CalendarDays,
  AlertCircle,
  CheckCircle2,
  Search,
  GripVertical,
  Paperclip,
  FileText,
  Image as ImageIcon,
  Upload,
  User as UserIcon,
  Tag,
  AlignLeft,
  Type as TypeIcon,
} from 'lucide-react';

type TodoStatus = 'TODO' | 'DOING' | 'DONE';
type TodoPriority = 'LOW' | 'MEDIUM' | 'HIGH';
type TodoView = 'all' | 'today' | 'upcoming' | 'priority' | 'completed';

interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

interface Attachment {
  url: string;
  name: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
}

interface AssigneeRef {
  id: string;
  name: string;
  nickname?: string | null;
  avatarUrl?: string | null;
}

interface Todo {
  id: string;
  title: string;
  description?: string | null;
  status: TodoStatus;
  priority: TodoPriority;
  dueDate?: string | null;
  completedAt?: string | null;
  assigneeId?: string | null;
  assignee?: AssigneeRef | null;
  createdById: string;
  createdBy?: AssigneeRef | null;
  tags: string[];
  checklist?: ChecklistItem[] | null;
  attachments?: Attachment[] | null;
  createdAt: string;
}

interface TodosResponse {
  data: Todo[];
  total: number;
  summary: {
    all: number;
    today: number;
    upcoming: number;
    priority: number;
    completed: number;
  };
}

const priorityConfig: Record<
  TodoPriority,
  { label: string; badge: string; bar: string; dot: string }
> = {
  LOW: {
    label: 'ต่ำ',
    badge: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    bar: 'bg-slate-300',
    dot: 'bg-slate-400',
  },
  MEDIUM: {
    label: 'ปานกลาง',
    badge: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    bar: 'bg-amber-400',
    dot: 'bg-amber-500',
  },
  HIGH: {
    label: 'สูง',
    badge: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    bar: 'bg-rose-500',
    dot: 'bg-rose-500',
  },
};

const avatarColors = [
  'from-blue-500 to-indigo-500',
  'from-emerald-500 to-teal-500',
  'from-purple-500 to-pink-500',
  'from-orange-500 to-red-500',
  'from-cyan-500 to-blue-500',
  'from-violet-500 to-purple-500',
];

function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash << 5) - hash + name.charCodeAt(i);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

const tabs: { value: TodoView; label: string; icon: typeof ListTodo }[] = [
  { value: 'all', label: 'ทั้งหมด', icon: ListTodo },
  { value: 'today', label: 'วันนี้', icon: Clock },
  { value: 'upcoming', label: 'กำลังจะถึง', icon: CalendarDays },
  { value: 'priority', label: 'สำคัญ', icon: AlertCircle },
  { value: 'completed', label: 'เสร็จแล้ว', icon: CheckCircle2 },
];

function formatDate(d?: string | null) {
  if (!d) return '';
  const date = new Date(d);
  return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}

function isOverdue(d?: string | null) {
  if (!d) return false;
  return new Date(d).getTime() < Date.now() - 24 * 3600 * 1000;
}

const emptyForm: Partial<Todo> & { tagsInput?: string } = {
  title: '',
  description: '',
  priority: 'MEDIUM',
  status: 'TODO',
  dueDate: '',
  assigneeId: '',
  tags: [],
  checklist: [],
  attachments: [],
  tagsInput: '',
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function TodosPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [view, setView] = useState<TodoView>('all');
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Todo | null>(null);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);

  const { data: staffUsers = [] } = useQuery<AssigneeRef[]>({
    queryKey: ['staff-users-todo'],
    queryFn: async () => {
      const { data } = await api.get('/users');
      const list = data.data || data || [];
      return Array.isArray(list) ? list : [];
    },
  });

  const { data, isLoading } = useQuery<TodosResponse>({
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

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        title: form.title?.trim(),
        description: form.description || undefined,
        priority: form.priority,
        status: form.status,
        dueDate: form.dueDate || undefined,
        assigneeId: form.assigneeId || undefined,
        tags: form.tags || [],
        checklist: form.checklist || [],
        attachments: form.attachments || [],
      };
      if (!payload.title) throw new Error('กรุณาระบุชื่องาน');
      if (editing) {
        const { data } = await api.patch(`/todos/${editing.id}`, payload);
        return data;
      }
      const { data } = await api.post('/todos', payload);
      return data;
    },
    onSuccess: () => {
      toast.success(editing ? 'อัปเดตรายการแล้ว' : 'สร้างรายการแล้ว');
      queryClient.invalidateQueries({ queryKey: ['todos'] });
      setDialogOpen(false);
      setEditing(null);
      setForm(emptyForm);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setDialogOpen(true);
  };

  const openEdit = (t: Todo) => {
    setEditing(t);
    setForm({
      title: t.title,
      description: t.description || '',
      priority: t.priority,
      status: t.status,
      dueDate: t.dueDate ? t.dueDate.slice(0, 10) : '',
      assigneeId: t.assigneeId || '',
      tags: t.tags || [],
      checklist: Array.isArray(t.checklist) ? t.checklist : [],
      attachments: Array.isArray(t.attachments) ? t.attachments : [],
      tagsInput: '',
    });
    setDialogOpen(true);
  };

  const uploadAttachment = async (file: File) => {
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/todos/upload-attachment', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setForm((prev) => ({
        ...prev,
        attachments: [...(prev.attachments || []), data as Attachment],
      }));
      toast.success('อัปโหลดไฟล์สำเร็จ');
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const removeAttachment = (url: string) =>
    setForm({
      ...form,
      attachments: (form.attachments || []).filter((a) => a.url !== url),
    });


  const addTag = () => {
    const v = (form.tagsInput || '').trim();
    if (!v) return;
    if (form.tags?.includes(v)) return;
    setForm({ ...form, tags: [...(form.tags || []), v], tagsInput: '' });
  };
  const removeTag = (t: string) =>
    setForm({ ...form, tags: (form.tags || []).filter((x) => x !== t) });

  const addChecklist = () => {
    const next: ChecklistItem = {
      id: crypto.randomUUID(),
      text: '',
      done: false,
    };
    setForm({ ...form, checklist: [...(form.checklist || []), next] });
  };
  const updateChecklist = (id: string, patch: Partial<ChecklistItem>) =>
    setForm({
      ...form,
      checklist: (form.checklist || []).map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  const removeChecklist = (id: string) =>
    setForm({ ...form, checklist: (form.checklist || []).filter((c) => c.id !== id) });

  const columns = useMemo<KanbanColumn<Todo>[]>(() => {
    const byStatus: Record<TodoStatus, Todo[]> = { TODO: [], DOING: [], DONE: [] };
    todos.forEach((t) => {
      byStatus[t.status].push(t);
    });
    return [
      { id: 'TODO', title: 'รอทำ', color: 'bg-slate-400', items: byStatus.TODO },
      { id: 'DOING', title: 'กำลังทำ', color: 'bg-amber-400', items: byStatus.DOING },
      { id: 'DONE', title: 'เสร็จแล้ว', color: 'bg-emerald-500', items: byStatus.DONE },
    ];
  }, [todos]);

  const tabCount = useMemo(
    () => ({
      all: summary.all,
      today: summary.today,
      upcoming: summary.upcoming,
      priority: summary.priority,
      completed: summary.completed,
    }),
    [summary],
  );

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

      {/* Tabs (pill style) */}
      <div className="flex gap-1.5 mb-5 p-1 bg-muted/50 rounded-xl w-fit overflow-x-auto">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = view === t.value;
          return (
            <button
              key={t.value}
              onClick={() => setView(t.value)}
              className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all whitespace-nowrap ${
                active
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="size-4" />
              {t.label}
              <span
                className={`px-1.5 min-w-[20px] text-center rounded-md text-2xs font-semibold ${
                  active ? 'bg-primary/10 text-primary' : 'bg-muted-foreground/10 text-muted-foreground'
                }`}
              >
                {tabCount[t.value]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="mb-5 relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="ค้นหางาน..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2.5 border border-input bg-card rounded-xl text-sm focus-visible:ring-2 focus-visible:ring-primary/20 focus:border-primary/50 outline-none transition-colors"
        />
      </div>

      {/* Kanban Board */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <KanbanBoard
          columns={columns}
          onCardClick={openEdit}
          onCardMove={(id, _from, to) =>
            moveStatusMutation.mutate({ id, status: to as TodoStatus })
          }
          emptyMessage="ไม่มีงานในคอลัมน์นี้"
          renderCard={(t) => {
            const pri = priorityConfig[t.priority];
            const overdue = isOverdue(t.dueDate) && t.status !== 'DONE';
            const checkDone = Array.isArray(t.checklist)
              ? t.checklist.filter((c) => c.done).length
              : 0;
            const checkTotal = Array.isArray(t.checklist) ? t.checklist.length : 0;
            const assigneeName = t.assignee?.nickname || t.assignee?.name || '';
            const canDelete =
              user?.role === 'OWNER' ||
              user?.role === 'BRANCH_MANAGER' ||
              t.createdById === user?.id;

            return (
              <div className="relative -m-3 p-3 group">
                {/* Left priority accent bar */}
                <div
                  className={`absolute left-0 top-2 bottom-2 w-1 rounded-r-full ${pri.bar}`}
                />

                {/* Drag indicator (visible on hover) */}
                <GripVertical className="absolute right-1.5 top-1.5 size-3.5 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

                <div className="pl-2 flex flex-col gap-2.5">
                  {/* Title row */}
                  <div className="flex items-start gap-2 pr-5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleMutation.mutate(t.id);
                      }}
                      className={`mt-0.5 size-4 rounded-md border-2 flex items-center justify-center transition-all shrink-0 ${
                        t.status === 'DONE'
                          ? 'bg-emerald-500 border-emerald-500 text-white'
                          : 'border-muted-foreground/30 hover:border-primary'
                      }`}
                      aria-label="toggle"
                    >
                      {t.status === 'DONE' && <CheckCircle2 className="size-3" />}
                    </button>
                    <span
                      className={`text-sm font-semibold leading-snug flex-1 ${
                        t.status === 'DONE'
                          ? 'line-through text-muted-foreground'
                          : 'text-foreground'
                      }`}
                    >
                      {t.title}
                    </span>
                  </div>

                  {/* Description */}
                  {t.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 pl-6">
                      {t.description}
                    </p>
                  )}

                  {/* Badges row: priority + tags */}
                  <div className="flex flex-wrap items-center gap-1 pl-6">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-2xs font-semibold ${pri.badge}`}
                    >
                      <Flag className="size-2.5" />
                      {pri.label}
                    </span>
                    {t.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 rounded-md text-2xs font-medium bg-primary/10 text-primary"
                      >
                        #{tag}
                      </span>
                    ))}
                    {t.tags.length > 3 && (
                      <span className="text-2xs text-muted-foreground">
                        +{t.tags.length - 3}
                      </span>
                    )}
                  </div>

                  {/* Footer: meta + avatar + actions */}
                  <div className="flex items-center justify-between gap-2 pt-2 pl-6 border-t border-dashed border-border/60">
                    <div className="flex items-center gap-2.5 text-2xs text-muted-foreground min-w-0">
                      {t.dueDate && (
                        <span
                          className={`inline-flex items-center gap-1 ${
                            overdue
                              ? 'text-rose-600 font-semibold dark:text-rose-400'
                              : ''
                          }`}
                        >
                          <Calendar className="size-3" />
                          {formatDate(t.dueDate)}
                        </span>
                      )}
                      {checkTotal > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <CheckCircle2 className="size-3" />
                          {checkDone}/{checkTotal}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {t.assignee && (
                        <div
                          className={`size-6 rounded-full bg-gradient-to-br ${avatarColor(
                            assigneeName,
                          )} text-white text-[10px] font-bold inline-flex items-center justify-center ring-2 ring-card shadow-sm`}
                          title={assigneeName}
                        >
                          {assigneeName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      {canDelete && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm('ลบรายการนี้?')) deleteMutation.mutate(t.id);
                          }}
                          className="size-6 rounded-md text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 inline-flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100"
                          aria-label="delete"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          }}
        />
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto p-0 gap-0">
          {/* Gradient header */}
          <DialogHeader className="px-6 py-5 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b border-border">
            <DialogTitle className="flex items-center gap-2.5 text-lg">
              <div className="size-9 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
                <CheckSquare className="size-5" />
              </div>
              {editing ? 'แก้ไขงาน' : 'เพิ่มงานใหม่'}
            </DialogTitle>
          </DialogHeader>

          <div className="px-6 py-5 space-y-5">
            {/* Title */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                <TypeIcon className="size-3.5" />
                ชื่องาน <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={form.title || ''}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full px-4 py-2.5 border border-input rounded-xl text-sm bg-card focus-visible:ring-2 focus-visible:ring-primary/20 focus:border-primary/50 outline-none transition-colors"
                placeholder="เช่น โทรตามลูกค้า A"
                autoFocus
              />
            </div>

            {/* Description */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                <AlignLeft className="size-3.5" />
                รายละเอียด
              </label>
              <textarea
                value={form.description || ''}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                placeholder="อธิบายรายละเอียดงาน..."
                className="w-full px-4 py-2.5 border border-input rounded-xl text-sm bg-card focus-visible:ring-2 focus-visible:ring-primary/20 focus:border-primary/50 outline-none transition-colors resize-none"
              />
            </div>

            {/* Priority + Status as button groups */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  <Flag className="size-3.5" />
                  ความสำคัญ
                </label>
                <div className="flex gap-1.5">
                  {(['LOW', 'MEDIUM', 'HIGH'] as TodoPriority[]).map((p) => {
                    const cfg = priorityConfig[p];
                    const active = form.priority === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setForm({ ...form, priority: p })}
                        className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-semibold border-2 transition-all ${
                          active
                            ? `${cfg.badge} border-current`
                            : 'border-border bg-card text-muted-foreground hover:bg-muted/50'
                        }`}
                      >
                        <span className={`size-1.5 rounded-full ${cfg.dot}`} />
                        {cfg.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  <CheckCircle2 className="size-3.5" />
                  สถานะ
                </label>
                <div className="flex gap-1.5">
                  {([
                    { v: 'TODO', label: 'รอทำ', color: 'bg-slate-400' },
                    { v: 'DOING', label: 'กำลังทำ', color: 'bg-amber-400' },
                    { v: 'DONE', label: 'เสร็จ', color: 'bg-emerald-500' },
                  ] as const).map((s) => {
                    const active = form.status === s.v;
                    return (
                      <button
                        key={s.v}
                        type="button"
                        onClick={() => setForm({ ...form, status: s.v })}
                        className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-semibold border-2 transition-all ${
                          active
                            ? 'border-primary bg-primary/5 text-primary'
                            : 'border-border bg-card text-muted-foreground hover:bg-muted/50'
                        }`}
                      >
                        <span className={`size-1.5 rounded-full ${s.color}`} />
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Date + Assignee */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                  <Calendar className="size-3.5" />
                  ครบกำหนด
                </label>
                <input
                  type="date"
                  value={form.dueDate || ''}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                  className="w-full px-4 py-2.5 border border-input rounded-xl text-sm bg-card focus-visible:ring-2 focus-visible:ring-primary/20 focus:border-primary/50 outline-none transition-colors"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                  <UserIcon className="size-3.5" />
                  ผู้รับมอบหมาย
                </label>
                <select
                  value={form.assigneeId || ''}
                  onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}
                  className="w-full px-4 py-2.5 border border-input rounded-xl text-sm bg-card focus-visible:ring-2 focus-visible:ring-primary/20 focus:border-primary/50 outline-none transition-colors"
                >
                  <option value="">ไม่ระบุ</option>
                  {staffUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nickname || u.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Tags */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                <Tag className="size-3.5" />
                แท็ก
              </label>
              <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border border-input rounded-xl bg-card focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/50 transition-colors">
                {(form.tags || []).map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-primary/10 text-primary"
                  >
                    #{tag}
                    <button
                      onClick={() => removeTag(tag)}
                      className="hover:text-rose-600"
                      aria-label="remove tag"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  value={form.tagsInput || ''}
                  onChange={(e) => setForm({ ...form, tagsInput: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder={form.tags?.length ? '' : 'พิมพ์แล้วกด Enter'}
                  className="flex-1 min-w-[120px] outline-none bg-transparent text-sm py-0.5"
                />
              </div>
            </div>

            {/* Checklist */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  <CheckSquare className="size-3.5" />
                  Checklist
                  {(form.checklist?.length || 0) > 0 && (
                    <span className="text-2xs font-normal text-muted-foreground/70">
                      ({form.checklist?.filter((c) => c.done).length}/{form.checklist?.length})
                    </span>
                  )}
                </label>
                <button
                  type="button"
                  onClick={addChecklist}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:bg-primary/10 px-2 py-1 rounded-md transition-colors"
                >
                  <Plus className="size-3" />
                  เพิ่มรายการ
                </button>
              </div>
              <div className="space-y-1.5">
                {(form.checklist || []).length === 0 && (
                  <p className="text-xs text-muted-foreground italic">ยังไม่มีรายการย่อย</p>
                )}
                {(form.checklist || []).map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors group"
                  >
                    <button
                      type="button"
                      onClick={() => updateChecklist(c.id, { done: !c.done })}
                      className={`size-4 rounded-md border-2 flex items-center justify-center transition-all shrink-0 ${
                        c.done
                          ? 'bg-emerald-500 border-emerald-500 text-white'
                          : 'border-muted-foreground/30 hover:border-primary'
                      }`}
                    >
                      {c.done && <CheckCircle2 className="size-3" />}
                    </button>
                    <input
                      type="text"
                      value={c.text}
                      onChange={(e) => updateChecklist(c.id, { text: e.target.value })}
                      className={`flex-1 bg-transparent outline-none text-sm ${
                        c.done ? 'line-through text-muted-foreground' : ''
                      }`}
                      placeholder="รายการย่อย..."
                    />
                    <button
                      type="button"
                      onClick={() => removeChecklist(c.id)}
                      className="text-muted-foreground/50 hover:text-rose-600 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Attachments */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  <Paperclip className="size-3.5" />
                  ไฟล์แนบ
                  {(form.attachments?.length || 0) > 0 && (
                    <span className="text-2xs font-normal text-muted-foreground/70">
                      ({form.attachments?.length})
                    </span>
                  )}
                </label>
              </div>

              {/* Upload zone */}
              <label className="flex flex-col items-center justify-center gap-2 px-4 py-6 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors">
                <Upload className="size-6 text-muted-foreground" />
                <div className="text-xs text-center">
                  <span className="font-semibold text-primary">คลิกเพื่ออัปโหลด</span>{' '}
                  <span className="text-muted-foreground">หรือลากไฟล์มาวาง</span>
                </div>
                <p className="text-2xs text-muted-foreground">ไฟล์สูงสุด 10MB</p>
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      uploadAttachment(file);
                      e.target.value = '';
                    }
                  }}
                />
              </label>

              {/* Attachment list */}
              {(form.attachments || []).length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {(form.attachments || []).map((a) => {
                    const isImage = a.mimeType?.startsWith('image/');
                    return (
                      <div
                        key={a.url}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors group"
                      >
                        <div
                          className={`size-8 rounded-md flex items-center justify-center shrink-0 ${
                            isImage
                              ? 'bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400'
                              : 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                          }`}
                        >
                          {isImage ? (
                            <ImageIcon className="size-4" />
                          ) : (
                            <FileText className="size-4" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <a
                            href={a.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm font-medium truncate block hover:text-primary transition-colors"
                          >
                            {a.name}
                          </a>
                          <p className="text-2xs text-muted-foreground">
                            {formatBytes(a.size)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAttachment(a.url)}
                          className="text-muted-foreground/50 hover:text-rose-600 opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t border-border bg-muted/20">
            <button
              type="button"
              onClick={() => setDialogOpen(false)}
              className="px-5 py-2.5 text-sm font-medium border border-input rounded-xl hover:bg-muted transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="px-5 py-2.5 text-sm font-semibold bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 disabled:opacity-50 shadow-sm transition-all"
            >
              {saveMutation.isPending ? 'กำลังบันทึก...' : editing ? 'บันทึกการแก้ไข' : 'สร้างงาน'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

