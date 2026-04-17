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
    badge: 'bg-muted text-muted-foreground',
    bar: 'bg-muted-foreground/40',
    dot: 'bg-muted-foreground',
  },
  MEDIUM: {
    label: 'ปานกลาง',
    badge: 'bg-warning/10 text-warning',
    bar: 'bg-warning/60',
    dot: 'bg-warning',
  },
  HIGH: {
    label: 'สูง',
    badge: 'bg-destructive/10 text-destructive',
    bar: 'bg-destructive',
    dot: 'bg-destructive',
  },
};

export const avatarColors = [
  'from-primary to-primary/70',
  'from-success to-success/70',
  'from-info to-info/70',
  'from-warning to-warning/70',
  'from-destructive to-destructive/70',
  'from-muted-foreground to-muted-foreground/70',
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
