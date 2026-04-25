import { useRef } from 'react';
import {
  Phone,
  PhoneMissed,
  MessageCircle,
  MessageSquare,
  Lock,
  Search,
  CalendarCheck,
  UserCircle,
  NotebookPen,
  ChevronRight,
  Clock,
  AlertTriangle,
  Users,
  FileText,
} from 'lucide-react';
import { formatDateShort } from '@/utils/formatters';
import type { ContractRow } from '../types';
import { agingBucket, agingColor, formatRelativeTime } from '../utils/cardIndicators';

/**
 * Customer 360 snapshot preview is a deliberate intent gesture (Task 11):
 * - Desktop: 500ms hover dwell → opens floating panel
 * - Mobile: 500ms long-press (touchstart-touchend with no scroll) → bottom sheet
 *
 * 500ms strikes the balance between "pops on accidental drag-by" (too fast)
 * and "feels broken / unresponsive" (too slow). Material/macOS tooltip
 * defaults are 400-700ms; we picked 500ms so a quick triple-glance through
 * the list does NOT spawn a panel for every card.
 */
const PREVIEW_DELAY_MS = 500;

export interface PreviewAnchor {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

function priorityColor(daysOverdue: number): string {
  if (daysOverdue >= 30) return 'bg-destructive';
  if (daysOverdue >= 8) return 'bg-warning';
  if (daysOverdue >= 1) return 'bg-primary';
  return 'bg-muted';
}

const CHANNEL_META: Record<
  NonNullable<ContractRow['lastChannel']>,
  { icon: typeof Phone; label: string }
> = {
  LINE: { icon: MessageCircle, label: 'LINE' },
  SMS: { icon: MessageCircle, label: 'SMS' },
  CALL: { icon: Phone, label: 'โทร' },
  LETTER: { icon: FileText, label: 'จดหมาย' },
};

function IndicatorChips({ contract }: { contract: ContractRow }) {
  const bucket = agingBucket(contract.daysOverdue);
  const channelMeta = contract.lastChannel ? CHANNEL_META[contract.lastChannel] : null;
  const ChannelIcon = channelMeta?.icon ?? null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-medium leading-snug ${agingColor(bucket)}`}
      >
        เลย {contract.daysOverdue} วัน
      </span>

      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted text-muted-foreground text-2xs font-medium px-2 py-0.5 leading-snug">
        <Clock className="size-3" />
        {formatRelativeTime(contract.lastContactedAt)}
      </span>

      {contract.brokenPromiseCount > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 text-destructive text-2xs font-medium px-2 py-0.5 leading-snug">
          <AlertTriangle className="size-3" />
          นัดผิด {contract.brokenPromiseCount} ครั้ง
        </span>
      )}

      {ChannelIcon && channelMeta && (
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted text-muted-foreground text-2xs font-medium px-2 py-0.5 leading-snug">
          <ChannelIcon className="size-3" />
          {channelMeta.label}
        </span>
      )}

      {contract.mdmState === 'PENDING' && (
        <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 text-warning text-2xs font-medium px-2 py-0.5 leading-snug">
          <Lock className="size-3" />
          รอ OWNER อนุมัติ
        </span>
      )}
      {contract.mdmState === 'LOCKED' && (
        <span className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 text-destructive text-2xs font-medium px-2 py-0.5 leading-snug">
          <Lock className="size-3" />
          ล็อคแล้ว
        </span>
      )}

      {contract.relatedContractsCount > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted text-muted-foreground text-2xs font-medium px-2 py-0.5 leading-snug">
          <Users className="size-3" />
          +{contract.relatedContractsCount} สัญญา
        </span>
      )}
    </div>
  );
}

interface Props {
  contract: ContractRow;
  onLogContact: (c: ContractRow) => void;
  onOpen360?: (c: ContractRow) => void;
  onSendLine?: (c: ContractRow) => void;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  /** Highlight as keyboard-focused card (J/K navigation) */
  focused?: boolean;
  /**
   * Fired after a 500ms hover dwell (desktop) or long-press (mobile).
   * Caller renders the floating Customer360SnapshotCard at `anchor`.
   */
  onPreview?: (contract: ContractRow, anchor: PreviewAnchor) => void;
  /** Cancel a pending preview (called when caller closes the panel). */
  onPreviewCancel?: () => void;
}

export default function ContractCard({
  contract,
  onLogContact,
  onOpen360,
  onSendLine,
  selected,
  onToggleSelect,
  focused,
  onPreview,
  onPreviewCancel,
}: Props) {
  const focusRing = focused ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : '';
  const wrapperRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);

  function clearTimer() {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function schedulePreview() {
    if (!onPreview || !wrapperRef.current) return;
    clearTimer();
    const el = wrapperRef.current;
    timerRef.current = window.setTimeout(() => {
      const r = el.getBoundingClientRect();
      onPreview(contract, { top: r.top, left: r.left, right: r.right, bottom: r.bottom });
    }, PREVIEW_DELAY_MS);
  }

  function cancelPreview() {
    clearTimer();
  }

  return (
    <div
      ref={wrapperRef}
      data-collections-card-id={contract.id}
      onMouseEnter={schedulePreview}
      onMouseLeave={cancelPreview}
      onTouchStart={schedulePreview}
      onTouchEnd={() => {
        clearTimer();
        onPreviewCancel?.();
      }}
      onTouchMove={cancelPreview}
      className={`group relative flex rounded-xl border border-border/50 bg-card shadow-sm hover:shadow-card-hover transition-shadow overflow-hidden ${focusRing}`}
    >
      {/* Checkbox column — only rendered when bulk-select is active */}
      {onToggleSelect && (
        <label className="flex items-start pt-5 pl-3 shrink-0 cursor-pointer">
          <input
            type="checkbox"
            checked={!!selected}
            onChange={() => onToggleSelect(contract.id)}
            onClick={(e) => e.stopPropagation()}
            className="size-4 rounded border-input accent-primary focus:ring-2 focus:ring-ring/30"
            aria-label={`เลือกสัญญา ${contract.contractNumber}`}
          />
        </label>
      )}

      {/* Priority heat strip */}
      <div className={`w-1 shrink-0 ${priorityColor(contract.daysOverdue)}`} />

      <div className="flex-1 p-4 min-w-0">
        {/* Top row: contract# + name + branch | days-overdue hero */}
        <div className="flex items-start justify-between gap-3 mb-2 min-w-0">
          <div className="min-w-0">
            <div
              className="font-mono text-xs text-primary font-medium cursor-pointer hover:underline"
              onClick={() => onOpen360?.(contract)}
            >
              {contract.contractNumber}
            </div>
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
            {contract.outstanding.toLocaleString()}
          </span>{' '}
          ฿
        </div>

        {/* Enrichment indicator chips: aging / last contacted / broken promise / channel / MDM / related */}
        <IndicatorChips contract={contract} />

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
            <button
              onClick={() => onSendLine?.(contract)}
              disabled={!contract.customer.lineId}
              className="rounded-lg border border-input p-1.5 hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
              title={contract.customer.lineId ? 'ส่ง LINE' : 'ลูกค้าไม่มี LINE ID'}
              aria-label="ส่ง LINE"
            >
              <MessageSquare className="size-3.5" />
            </button>
            {onOpen360 && (
              <button
                onClick={() => onOpen360(contract)}
                className="rounded-lg border border-input p-1.5 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                title="เปิด Customer 360"
                aria-label="เปิด Customer 360"
              >
                <ChevronRight className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
