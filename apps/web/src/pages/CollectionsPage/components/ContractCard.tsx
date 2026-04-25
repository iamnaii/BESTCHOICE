import {
  Phone,
  PhoneMissed,
  MessageCircle,
  Lock,
  Search,
  CalendarCheck,
  UserCircle,
  NotebookPen,
} from 'lucide-react';
import { formatDateShort, formatNumber } from '@/utils/formatters';
import type { ContractRow } from '../types';

function priorityColor(daysOverdue: number): string {
  if (daysOverdue >= 30) return 'bg-destructive';
  if (daysOverdue >= 8) return 'bg-warning';
  if (daysOverdue >= 1) return 'bg-primary';
  return 'bg-muted';
}

interface Props {
  contract: ContractRow;
  onLogContact: (c: ContractRow) => void;
  onOpen360?: (c: ContractRow) => void;
}

export default function ContractCard({ contract, onLogContact, onOpen360 }: Props) {
  return (
    <div className="group relative flex rounded-xl border border-border/50 bg-card shadow-sm hover:shadow-card-hover transition-shadow overflow-hidden">
      {/* Priority heat strip */}
      <div className={`w-1 shrink-0 ${priorityColor(contract.daysOverdue)}`} />

      <div className="flex-1 p-4 min-w-0">
        {/* Top row: contract# + name + branch | days-overdue hero */}
        <div className="flex items-start justify-between gap-3 mb-2 min-w-0">
          <div className="min-w-0">
            {onOpen360 ? (
              <button
                type="button"
                onClick={() => onOpen360(contract)}
                className="font-mono text-xs text-primary font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 rounded text-left"
                aria-label={`เปิด Customer 360 ของสัญญา ${contract.contractNumber}`}
              >
                {contract.contractNumber}
              </button>
            ) : (
              <div className="font-mono text-xs text-primary font-medium">
                {contract.contractNumber}
              </div>
            )}
            <div className="text-sm font-semibold leading-snug truncate">
              {contract.customer.name}
            </div>
            <div className="text-2xs text-muted-foreground leading-snug">
              {contract.branch.name}
            </div>
          </div>

          {/* Days-overdue hero */}
          <div className="text-right shrink-0">
            <div className="text-3xl font-bold tabular-nums leading-none">
              {contract.daysOverdue}
            </div>
            <div className="text-2xs text-muted-foreground uppercase tracking-wide leading-snug">
              วัน
            </div>
          </div>
        </div>

        {/* Outstanding amount (secondary) */}
        <div className="text-sm font-medium tabular-nums mb-3 leading-snug">
          ค้าง{' '}
          <span className="text-destructive">
            {formatNumber(contract.outstanding)}
          </span>{' '}
          ฿
        </div>

        {/* Status chip cluster */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {contract.noAnswerCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 text-warning text-2xs font-medium px-2 py-0.5 leading-snug">
              <PhoneMissed className="size-3" />
              ไม่รับ {contract.noAnswerCount} ครั้ง
            </span>
          )}
          {contract.customer.lineId && (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/10 text-success text-2xs font-medium px-2 py-0.5 leading-snug">
              <MessageCircle className="size-3" /> LINE
            </span>
          )}
          {contract.deviceLocked && (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive text-2xs font-medium px-2 py-0.5 leading-snug">
              <Lock className="size-3" /> ล็อคแล้ว
            </span>
          )}
          {contract.needsSkipTracing && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground text-2xs font-medium px-2 py-0.5 leading-snug">
              <Search className="size-3" /> หาเบอร์ใหม่
            </span>
          )}
          {contract.settlementDate && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-2xs font-medium px-2 py-0.5 leading-snug">
              <CalendarCheck className="size-3" /> นัด{' '}
              {formatDateShort(new Date(contract.settlementDate))}
            </span>
          )}
        </div>

        {/* Bottom row: assignee + CTAs */}
        <div className="flex items-center justify-between gap-3">
          <div className="text-2xs text-muted-foreground truncate leading-snug">
            {contract.assignedTo ? (
              <span className="inline-flex items-center gap-1">
                <UserCircle className="size-3" />
                {contract.assignedTo.name}
              </span>
            ) : (
              <span className="italic">ยังไม่มอบหมาย</span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <a
              href={`tel:${contract.customer.phone}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 tabular-nums transition-colors"
            >
              <Phone className="size-3.5" /> {contract.customer.phone}
            </a>
            <button
              onClick={() => onLogContact(contract)}
              className="rounded-lg border border-input p-1.5 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title="บันทึกผลการโทร"
              aria-label="บันทึกผลการโทร"
            >
              <NotebookPen className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
