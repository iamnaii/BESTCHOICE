import { useDraggable } from '@dnd-kit/core';
import { formatNumber } from '@/utils/formatters';

interface Props {
  assignmentId: string;
  contract: {
    contractNumber: string;
    outstanding?: number | null;
    daysOverdue?: number;
    customer: { name: string };
  };
  escalation?: boolean;
}

export default function DraggableContractTile({ assignmentId, contract, escalation }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: assignmentId,
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`rounded-lg border border-border/50 bg-card px-2.5 py-1.5 cursor-grab active:cursor-grabbing select-none ${
        isDragging ? 'opacity-50 shadow-md' : ''
      } ${escalation ? 'border-destructive/40' : ''}`}
    >
      <div className="font-mono text-2xs text-primary leading-snug">{contract.contractNumber}</div>
      <div className="text-xs font-medium truncate leading-snug">{contract.customer.name}</div>
      <div className="text-2xs text-muted-foreground tabular-nums leading-snug">
        {contract.daysOverdue ?? 0}ว ·{' '}
        {contract.outstanding != null ? `${formatNumber(contract.outstanding)} ฿` : '—'}
      </div>
    </div>
  );
}
