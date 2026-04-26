import { useDroppable } from '@dnd-kit/core';
import { Button } from '@/components/ui/button';
import DraggableContractTile from './DraggableContractTile';

interface Collector {
  id: string;
  name: string;
  branch: { id: string; name: string } | null;
  active: boolean;
  assignments: Array<{ id: string; escalationFlag: boolean; status?: string; contract: any }>;
  progress: { total: number; done: number };
}

interface Props {
  collector: Collector;
  locked: boolean;
  onTransferClick?: () => void;
  onCloseSessionClick?: () => void;
}

function statusColor(total: number, active: boolean): string {
  if (!active) return 'border-warning/40 bg-warning/5';
  if (total > 30) return 'border-destructive/40 bg-destructive/5';
  if (total >= 25) return 'border-warning/40 bg-warning/5';
  return 'border-border/50 bg-card';
}

export default function CollectorColumn({
  collector,
  locked,
  onTransferClick,
  onCloseSessionClick,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: collector.id });
  const total = collector.assignments.length;
  const pct = total === 0 ? 0 : Math.round((collector.progress.done / total) * 100);

  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border ${statusColor(total, collector.active)} ${
        isOver ? 'ring-2 ring-primary/40' : ''
      } p-3 flex flex-col gap-2 min-h-[200px] transition-shadow`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-snug truncate">{collector.name}</div>
          <div className="text-2xs text-muted-foreground leading-snug">
            {collector.branch?.name ?? '—'}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-base font-bold tabular-nums leading-snug">{total}</div>
          <div className="text-2xs text-muted-foreground leading-snug">ราย</div>
        </div>
      </div>

      {!collector.active && (
        <div className="text-2xs text-warning bg-warning/10 rounded px-2 py-1 leading-snug">
          วันนี้ไม่ active
        </div>
      )}

      {locked && total > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-2xs text-muted-foreground leading-snug">
            <span>ความคืบหน้า</span>
            <span className="font-mono tabular-nums">
              {collector.progress.done}/{total} ({pct}%)
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5 mt-1 max-h-[280px] overflow-y-auto">
        {collector.assignments.map((a) => (
          <DraggableContractTile
            key={a.id}
            assignmentId={a.id}
            contract={a.contract}
            escalation={a.escalationFlag}
          />
        ))}
      </div>

      {locked && (onTransferClick || onCloseSessionClick) && (
        <div className="flex gap-1.5 mt-auto pt-2 border-t border-border/40">
          {onTransferClick && (
            <Button variant="ghost" size="sm" className="text-2xs" onClick={onTransferClick}>
              โอนคิว
            </Button>
          )}
          {onCloseSessionClick && (
            <Button
              variant="ghost"
              size="sm"
              className="text-2xs text-destructive"
              onClick={onCloseSessionClick}
            >
              ปิด session
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
