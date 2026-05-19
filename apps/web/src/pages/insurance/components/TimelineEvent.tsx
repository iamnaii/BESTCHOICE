import { Circle } from 'lucide-react';
import { formatDateShort } from '@/utils/formatters';

export interface TimelineEventProps {
  fromStatus: string;
  toStatus: string;
  changedByName: string | null;
  note?: string | null;
  createdAt: string;
}

export function TimelineEvent({
  fromStatus,
  toStatus,
  changedByName,
  note,
  createdAt,
}: TimelineEventProps) {
  return (
    <div className="flex gap-3 pb-4 border-l-2 border-muted pl-4 last:pb-0">
      <Circle className="-ml-[1.625rem] mt-1 h-3 w-3 fill-primary text-primary" />
      <div className="flex-1">
        <div className="font-medium leading-snug">
          {fromStatus} → {toStatus}
        </div>
        <div className="text-xs text-muted-foreground leading-snug">
          {formatDateShort(createdAt)} · {changedByName ?? 'ไม่ระบุ'}
        </div>
        {note && (
          <div className="text-sm mt-1 text-muted-foreground leading-snug">{note}</div>
        )}
      </div>
    </div>
  );
}
