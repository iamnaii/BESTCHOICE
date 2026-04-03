import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/* ─── Types ─── */

export interface KanbanColumn<T> {
  id: string;
  title: string;
  color: string;
  items: T[];
}

export interface KanbanBoardProps<T> {
  columns: KanbanColumn<T>[];
  renderCard: (item: T) => ReactNode;
  onCardClick?: (item: T) => void;
  emptyMessage?: string;
}

/* ─── Component ─── */

export function KanbanBoard<T extends { id: string }>({
  columns,
  renderCard,
  onCardClick,
  emptyMessage = 'ไม่มีรายการ',
}: KanbanBoardProps<T>) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4 -mx-1 px-1">
      {columns.map((col) => (
        <div
          key={col.id}
          className="flex-shrink-0 w-72 lg:w-80 flex flex-col bg-muted/50 rounded-xl"
        >
          {/* Column header */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border/50">
            <span className={cn('size-2.5 rounded-full', col.color)} />
            <span className="text-sm font-semibold text-foreground">{col.title}</span>
            <span className="ml-auto text-2xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-md">
              {col.items.length}
            </span>
          </div>

          {/* Cards */}
          <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-280px)]">
            {col.items.length === 0 ? (
              <div className="text-center text-2sm text-muted-foreground py-8">
                {emptyMessage}
              </div>
            ) : (
              col.items.map((item) => (
                <div
                  key={item.id}
                  onClick={() => onCardClick?.(item)}
                  className={cn(
                    'bg-card rounded-xl border border-border p-3 shadow-xs transition-all',
                    onCardClick && 'cursor-pointer hover:shadow-card hover:border-border/80',
                  )}
                >
                  {renderCard(item)}
                </div>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
