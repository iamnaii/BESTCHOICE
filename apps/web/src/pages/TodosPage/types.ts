export type TodoStatus = 'TODO' | 'DOING' | 'REVIEW' | 'DONE';
export type TodoPriority = 'LOW' | 'MEDIUM' | 'HIGH';
export type TodoView = 'all' | 'today' | 'upcoming' | 'priority' | 'completed';

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Attachment {
  url: string;
  name: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
}

export interface AssigneeRef {
  id: string;
  name: string;
  nickname?: string | null;
  avatarUrl?: string | null;
}

export interface Todo {
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

export interface TodoComment {
  id: string;
  todoId: string;
  userId: string;
  content: string;
  createdAt: string;
  user: AssigneeRef;
}

export interface TodosResponse {
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

export const priorityConfig: Record<
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

export const avatarColors = [
  'from-blue-500 to-indigo-500',
  'from-emerald-500 to-teal-500',
  'from-purple-500 to-pink-500',
  'from-orange-500 to-red-500',
  'from-cyan-500 to-blue-500',
  'from-violet-500 to-purple-500',
];

export function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash << 5) - hash + name.charCodeAt(i);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

export function formatBytes(bytes?: number) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const emptyForm: Partial<Todo> & { tagsInput?: string } = {
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
