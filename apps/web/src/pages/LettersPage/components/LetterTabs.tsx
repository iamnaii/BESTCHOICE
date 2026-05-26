import { FileText, Printer, Truck, AlertTriangle, X } from 'lucide-react';
import type { LetterStatus } from '../types';

interface Props {
  active: LetterStatus;
  counts: Partial<Record<LetterStatus, number>>;
  onChange: (status: LetterStatus) => void;
}

const TABS: Array<{ status: LetterStatus; label: string; Icon: React.ElementType }> = [
  { status: 'PENDING_DISPATCH', label: 'รอพิมพ์', Icon: FileText },
  { status: 'PDF_GENERATED', label: 'พิมพ์แล้ว', Icon: Printer },
  { status: 'DISPATCHED', label: 'ส่งแล้ว', Icon: Truck },
  { status: 'UNDELIVERABLE', label: 'ตีกลับ', Icon: AlertTriangle },
  { status: 'CANCELLED', label: 'ยกเลิก', Icon: X },
];

export default function LetterTabs({ active, counts, onChange }: Props) {
  return (
    <div className="flex gap-0 border-b border-border mb-4 overflow-x-auto">
      {TABS.map(({ status, label, Icon }) => {
        const count = counts[status] ?? 0;
        const isActive = active === status;
        return (
          <button
            key={status}
            onClick={() => onChange(status)}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm border-b-2 transition-colors whitespace-nowrap ${
              isActive
                ? 'border-primary text-primary font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            <Icon className={`size-4 shrink-0 ${isActive ? 'text-primary' : ''}`} />
            {label}
            {count > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-2xs tabular-nums leading-none ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
