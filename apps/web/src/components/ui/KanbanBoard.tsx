import { ReactNode, useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  closestCorners,
  defaultDropAnimationSideEffects,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DropAnimation,
} from '@dnd-kit/core';
import { cn } from '@/lib/utils';

const dropAnimation: DropAnimation = {
  duration: 220,
  easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: '0.4' } },
  }),
};

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
  /**
   * If provided, cards become draggable between columns.
   * Called when a card is dropped into a different column.
   */
  onCardMove?: (itemId: string, fromColumnId: string, toColumnId: string) => void;
  emptyMessage?: string;
}

/* ─── Draggable card wrapper ─── */

interface DraggableCardProps {
  id: string;
  columnId: string;
  onClick?: () => void;
  children: ReactNode;
}

function DraggableCard({ id, columnId, onClick, children }: DraggableCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    data: { columnId },
  });

  // Hide the original card while dragging — DragOverlay shows a clone
  // attached to the cursor instead. This avoids the "ghost in place" look.
  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn(
        'bg-card rounded-xl border border-border p-3 shadow-xs cursor-grab active:cursor-grabbing touch-none',
        'transition-[box-shadow,border-color,opacity] duration-150',
        onClick && 'hover:shadow-card hover:border-border/80',
        isDragging && 'opacity-0 pointer-events-none',
      )}
    >
      {children}
    </div>
  );
}

/* ─── Droppable column wrapper ─── */

function DroppableColumn({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex-1 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-280px)] rounded-b-xl transition-all duration-200',
        isOver && 'bg-primary/8 ring-2 ring-primary/30 ring-inset scale-[1.01]',
      )}
    >
      {children}
    </div>
  );
}

/* ─── Component ─── */

export function KanbanBoard<T extends { id: string }>({
  columns,
  renderCard,
  onCardClick,
  onCardMove,
  emptyMessage = 'ไม่มีรายการ',
}: KanbanBoardProps<T>) {
  const [activeItem, setActiveItem] = useState<T | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const dragEnabled = !!onCardMove;

  const handleDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    for (const col of columns) {
      const found = col.items.find((i) => i.id === id);
      if (found) {
        setActiveItem(found);
        return;
      }
    }
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveItem(null);
    if (!onCardMove) return;
    const { active, over } = e;
    if (!over) return;
    const fromColumnId = (active.data.current?.columnId as string) || '';
    const toColumnId = String(over.id);
    if (fromColumnId && fromColumnId !== toColumnId) {
      onCardMove(String(active.id), fromColumnId, toColumnId);
    }
  };

  const board = (
    <div className="flex gap-4 overflow-x-auto pb-4 -mx-1 px-1">
      {columns.map((col) => (
        <div
          key={col.id}
          className="shrink-0 w-72 lg:w-80 flex flex-col bg-muted/50 rounded-xl"
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
          {dragEnabled ? (
            <DroppableColumn id={col.id}>
              {col.items.length === 0 ? (
                <div className="text-center text-2sm text-muted-foreground py-8">
                  {emptyMessage}
                </div>
              ) : (
                col.items.map((item) => (
                  <DraggableCard
                    key={item.id}
                    id={item.id}
                    columnId={col.id}
                    onClick={onCardClick ? () => onCardClick(item) : undefined}
                  >
                    {renderCard(item)}
                  </DraggableCard>
                ))
              )}
            </DroppableColumn>
          ) : (
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
          )}
        </div>
      ))}
    </div>
  );

  if (!dragEnabled) return board;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {board}
      <DragOverlay dropAnimation={dropAnimation}>
        {activeItem && (
          <div className="bg-card rounded-xl border-2 border-primary/40 p-3 shadow-2xl shadow-primary/20 w-72 lg:w-80 rotate-3 scale-105 cursor-grabbing">
            {renderCard(activeItem)}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
