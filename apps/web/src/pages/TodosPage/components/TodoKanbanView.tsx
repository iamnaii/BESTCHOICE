import { useMemo } from 'react';
import { formatThaiDateShort } from '@/lib/date';
import { useAuth } from '@/contexts/AuthContext';
import { KanbanBoard, type KanbanColumn } from '@/components/ui/KanbanBoard';
import QueryBoundary from '@/components/QueryBoundary';
import {
  Calendar,
  Flag,
  Trash2,
  GripVertical,
  CheckCircle2,
  User as UserIcon,
} from 'lucide-react';
import { type Todo, type TodoStatus, priorityConfig, avatarColor } from '../types';

function formatDate(d?: string | null) {
  if (!d) return '';
  return formatThaiDateShort(d);
}

function isOverdue(d?: string | null) {
  if (!d) return false;
  return new Date(d).getTime() < Date.now() - 24 * 3600 * 1000;
}

interface TodoKanbanViewProps {
  todos: Todo[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  onRefetch: () => void;
  onCardClick: (todo: Todo) => void;
  onCardMove: (id: string, from: string, to: string) => void;
  onToggle: (id: string) => void;
  onDeleteRequest: (id: string) => void;
}

export function TodoKanbanView({
  todos,
  isLoading,
  isError,
  error,
  onRefetch,
  onCardClick,
  onCardMove,
  onToggle,
  onDeleteRequest,
}: TodoKanbanViewProps) {
  const { user } = useAuth();

  const columns = useMemo<KanbanColumn<Todo>[]>(() => {
    const byStatus: Record<TodoStatus, Todo[]> = { TODO: [], DOING: [], REVIEW: [], DONE: [] };
    todos.forEach((t) => {
      byStatus[t.status].push(t);
    });
    return [
      { id: 'TODO', title: 'รอทำ', color: 'bg-muted-foreground', items: byStatus.TODO },
      { id: 'DOING', title: 'กำลังทำ', color: 'bg-amber-400', items: byStatus.DOING },
      { id: 'REVIEW', title: 'รอแก้ไข', color: 'bg-orange-400', items: byStatus.REVIEW },
      { id: 'DONE', title: 'เสร็จแล้ว', color: 'bg-emerald-500', items: byStatus.DONE },
    ];
  }, [todos]);

  return (
    <QueryBoundary
      isLoading={isLoading}
      isError={isError}
      error={error}
      onRetry={onRefetch}
      errorTitle="ไม่สามารถโหลดงานได้"
    >
      <KanbanBoard
        columns={columns}
        onCardClick={onCardClick}
        onCardMove={(id, from, to) => onCardMove(id, from, to)}
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
                      onToggle(t.id);
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
                    {t.createdBy && (
                      <span
                        className="inline-flex items-center gap-1 truncate"
                        title={`สร้างโดย ${t.createdBy.nickname || t.createdBy.name}`}
                      >
                        <UserIcon className="size-3" />
                        โดย {t.createdBy.nickname || t.createdBy.name}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {t.assignee && (
                      <div
                        className={`size-6 rounded-full bg-linear-to-br ${avatarColor(
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
                          onDeleteRequest(t.id);
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
    </QueryBoundary>
  );
}
