import { useEffect, useRef } from 'react';
import {
  Phone,
  Package,
  CalendarCheck,
  MessageCircle,
  CheckCheck,
  Clock,
  StickyNote,
  AlertTriangle,
  Loader2,
  X,
} from 'lucide-react';
import { useContractSnapshot } from '../hooks/useContractSnapshot';
import { formatRelativeTime } from '../utils/cardIndicators';
import { formatDateShort } from '@/utils/formatters';

interface Props {
  contractId: string | null;
  /** Anchor rect in viewport coordinates (from getBoundingClientRect of the source card). */
  anchor: { top: number; left: number; right: number; bottom: number } | null;
  /** Bottom-sheet variant for mobile (long-press). */
  variant?: 'floating' | 'sheet';
  open: boolean;
  onClose: () => void;
}

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: 'bg-success/10 text-success border-success/30',
  OVERDUE: 'bg-warning/10 text-warning border-warning/30',
  DEFAULT: 'bg-destructive/10 text-destructive border-destructive/30',
  LEGAL: 'bg-destructive/10 text-destructive border-destructive/30',
  CLOSED: 'bg-muted text-muted-foreground border-border',
};

/**
 * Customer 360 snapshot preview card.
 *
 * - Desktop: floating panel anchored to the right of the source ContractCard
 *   (opens after 500ms hover dwell — see CollectionsPage queue tab wiring).
 * - Mobile: bottom sheet variant (long-press 500ms on the card).
 *
 * Designed for sub-100ms perceived latency. Calls `useContractSnapshot`
 * which hits `GET /contracts/:id/snapshot` (lightweight — does NOT load
 * the full timeline).
 */
export default function Customer360SnapshotCard({
  contractId,
  anchor,
  variant = 'floating',
  open,
  onClose,
}: Props) {
  const { data, isLoading, error } = useContractSnapshot(contractId, open);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onMouseDown);
    };
  }, [open, onClose]);

  if (!open || !contractId) return null;

  // Position the floating panel to the right of the anchor, fallback to left
  // if there's no room. Sheet variant ignores anchor (CSS-positioned).
  let positionStyle: React.CSSProperties = {};
  if (variant === 'floating' && anchor) {
    const PANEL_WIDTH = 360;
    const GAP = 8;
    const viewportRight = window.innerWidth;
    const wantsRight = anchor.right + GAP + PANEL_WIDTH < viewportRight - 16;
    positionStyle = wantsRight
      ? { top: anchor.top, left: anchor.right + GAP }
      : { top: anchor.top, left: Math.max(16, anchor.left - GAP - PANEL_WIDTH) };
  }

  const wrapperClass =
    variant === 'sheet'
      ? 'fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-auto rounded-t-2xl border-t border-border bg-card shadow-card-hover'
      : 'fixed z-50 w-[360px] max-h-[80vh] overflow-auto rounded-xl border border-border bg-card shadow-card-hover';

  return (
    <>
      {variant === 'sheet' && (
        <div
          className="fixed inset-0 z-40 bg-black/30"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <div
        ref={panelRef}
        className={wrapperClass}
        style={positionStyle}
        role="dialog"
        aria-label="Customer 360 snapshot"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground leading-snug">
            Customer 360 — สรุปด่วน
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            aria-label="ปิด"
          >
            <X className="size-4" />
          </button>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center px-4 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 mr-2 animate-spin" /> กำลังโหลด...
          </div>
        )}

        {error && (
          <div className="px-4 py-6 text-sm text-destructive leading-snug">
            <AlertTriangle className="size-4 inline mr-1" />
            โหลดข้อมูลไม่สำเร็จ
          </div>
        )}

        {data && (
          <div className="space-y-3 p-4">
            {/* Header — name + status + contract# */}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="text-base font-semibold leading-snug truncate">
                  {data.customer.name}
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-2xs font-medium leading-snug ${
                    STATUS_COLOR[data.status] ?? 'bg-muted text-muted-foreground border-border'
                  }`}
                >
                  {data.status}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground leading-snug">
                <span className="font-mono text-primary">{data.contractNumber}</span>
                <span>·</span>
                <a
                  href={`tel:${data.customer.phone}`}
                  className="inline-flex items-center gap-1 hover:underline"
                >
                  <Phone className="size-3" />
                  {data.customer.phone}
                </a>
              </div>
            </div>

            {/* Product */}
            <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs leading-snug">
              <Package className="size-3.5 text-muted-foreground shrink-0" />
              <span className="truncate">{data.product.name}</span>
            </div>

            {/* Totals */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-border/50 px-3 py-2">
                <div className="text-2xs uppercase tracking-wide text-muted-foreground leading-snug">
                  คงค้าง
                </div>
                <div className="text-sm font-semibold tabular-nums text-destructive leading-snug">
                  {data.totals.outstanding.toLocaleString()} ฿
                </div>
              </div>
              <div className="rounded-lg border border-border/50 px-3 py-2">
                <div className="text-2xs uppercase tracking-wide text-muted-foreground leading-snug">
                  งวดเหลือ
                </div>
                <div className="text-sm font-semibold tabular-nums leading-snug">
                  {data.totals.installmentsRemaining}/{data.totals.installmentsTotal}
                </div>
              </div>
            </div>

            {/* Last promise */}
            {data.lastPromise && (
              <div className="rounded-lg border border-border/50 px-3 py-2 space-y-0.5">
                <div className="flex items-center gap-1.5 text-2xs uppercase tracking-wide text-muted-foreground leading-snug">
                  <CalendarCheck className="size-3" />
                  นัดล่าสุด
                </div>
                <div className="text-xs leading-snug">
                  <span className="tabular-nums">
                    {formatDateShort(new Date(data.lastPromise.settlementDate))}
                  </span>{' '}
                  <span
                    className={
                      data.lastPromise.result === 'BROKEN'
                        ? 'text-destructive font-medium'
                        : 'text-foreground'
                    }
                  >
                    · {data.lastPromise.result === 'BROKEN' ? 'นัดผิด' : data.lastPromise.result}
                  </span>
                </div>
                {data.lastPromise.notes && (
                  <div className="text-2xs text-muted-foreground leading-snug truncate">
                    {data.lastPromise.notes}
                  </div>
                )}
              </div>
            )}

            {/* Last LINE message */}
            {data.lastLine && (
              <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2 text-xs leading-snug">
                <div className="flex items-center gap-1.5">
                  <MessageCircle className="size-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">LINE ล่าสุด</span>
                  <span className="tabular-nums">
                    {formatRelativeTime(data.lastLine.timestamp)}
                  </span>
                </div>
                {data.lastLine.read ? (
                  <span className="inline-flex items-center gap-1 text-success">
                    <CheckCheck className="size-3.5" /> อ่านแล้ว
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Clock className="size-3.5" /> ยังไม่อ่าน
                  </span>
                )}
              </div>
            )}

            {/* Last collector comment */}
            {data.lastCollectorComment && (
              <div className="rounded-lg border border-border/50 px-3 py-2 space-y-1">
                <div className="flex items-center gap-1.5 text-2xs uppercase tracking-wide text-muted-foreground leading-snug">
                  <StickyNote className="size-3" />
                  บันทึกล่าสุด
                </div>
                <div className="text-xs text-foreground leading-snug">
                  {data.lastCollectorComment.text}
                </div>
                <div className="text-2xs text-muted-foreground leading-snug">
                  {formatRelativeTime(data.lastCollectorComment.at)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
