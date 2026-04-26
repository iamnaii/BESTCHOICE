import { useDroppable } from '@dnd-kit/core';
import DraggableContractTile from './DraggableContractTile';

interface Props {
  items: Array<{ id: string; contract: any }>;
  escalation: Array<{ id: string; contract: any }>;
}

export default function PoolColumn({ items, escalation }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: '__pool__' });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border border-dashed border-border bg-muted/20 p-3 flex flex-col gap-2 min-h-[200px] transition-shadow ${
        isOver ? 'ring-2 ring-primary/40 bg-primary/5' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold leading-snug">Pool กลาง</div>
          <div className="text-2xs text-muted-foreground leading-snug">
            {items.length + escalation.length} รายการ ({escalation.length} escalation)
          </div>
        </div>
      </div>

      {escalation.length > 0 && (
        <div className="space-y-1">
          <div className="text-2xs uppercase tracking-wider text-destructive font-semibold leading-snug">
            Escalation
          </div>
          {escalation.map((a) => (
            <DraggableContractTile key={a.id} assignmentId={a.id} contract={a.contract} escalation />
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-1 mt-1">
          {items.map((a) => (
            <DraggableContractTile key={a.id} assignmentId={a.id} contract={a.contract} />
          ))}
        </div>
      )}

      {items.length === 0 && escalation.length === 0 && (
        <div className="text-2xs text-muted-foreground text-center py-4 leading-snug">
          Pool ว่าง
        </div>
      )}
    </div>
  );
}
