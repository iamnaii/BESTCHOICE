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
  MoreHorizontal,
  Moon,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  Coins,
} from 'lucide-react';
import { formatDateShort, formatNumber } from '@/utils/formatters';
import { isToday, formatHHMM } from '../utils/today';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import type { ContractRow } from '../types';
import { agingBucket, agingColor, formatRelativeTime } from '../utils/cardIndicators';
import CustomerTagChips from './CustomerTagChips';
import NextBestActionChip, { type NextBestActionType } from './NextBestActionChip';
import { CallButton } from '@/components/CallButton';
import { ESCALATION_BROKEN_PROMISE_THRESHOLD } from '../hooks/useEscalate';

const CHANNEL_META: Record<
  NonNullable<ContractRow['lastChannel']>,
  { icon: typeof Phone; label: string }
> = {
  LINE: { icon: MessageCircle, label: 'LINE' },
  SMS: { icon: MessageCircle, label: 'SMS' },
  CALL: { icon: Phone, label: 'โทร' },
  LETTER: { icon: FileText, label: 'จดหมาย' },
};

function severityPanel(daysOverdue: number): { bg: string; fg: string } {
  if (daysOverdue >= 30) return { bg: 'bg-destructive', fg: 'text-destructive-foreground' };
  if (daysOverdue >= 8) return { bg: 'bg-warning', fg: 'text-warning-foreground' };
  if (daysOverdue >= 1) return { bg: 'bg-primary', fg: 'text-primary-foreground' };
  return { bg: 'bg-muted', fg: 'text-muted-foreground' };
}

function formatSnoozeUntil(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (sameDay) return `${hh}:${mm}`;
  return `${formatDateShort(d)} ${hh}:${mm}`;
}

interface Props {
  contract: ContractRow;
  onLogContact: (c: ContractRow) => void;
  onOpen360?: (c: ContractRow) => void;
  onSendLine?: (c: ContractRow) => void;
  focused?: boolean;
  onSnooze?: (c: ContractRow) => void;
  onUnsnooze?: (c: ContractRow) => void;
  onSkipTrace?: (c: ContractRow) => void;
  onNextBestAction?: (c: ContractRow, type: NextBestActionType) => void;
  onPartialPaymentReschedule?: (c: ContractRow) => void;
}

export default function ContractCard({
  contract,
  onLogContact,
  onOpen360,
  onSendLine,
  focused,
  onSnooze,
  onUnsnooze,
  onSkipTrace,
  onNextBestAction,
  onPartialPaymentReschedule,
}: Props) {
  const isSnoozed =
    !!contract.snoozedUntil && new Date(contract.snoozedUntil).getTime() > Date.now();
  const focusRing = focused ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : '';

  const { bg: panelBg, fg: panelFg } = severityPanel(contract.daysOverdue);
  const bucket = agingBucket(contract.daysOverdue);
  const channelMeta = contract.lastChannel ? CHANNEL_META[contract.lastChannel] : null;
  const ChannelIcon = channelMeta?.icon ?? null;
  const arrow = contract.trendingArrow;

  return (
    <div
      data-collections-card-id={contract.id}
      className={`group relative flex rounded-xl border border-border/50 bg-card shadow-sm hover:shadow-card-hover transition-shadow overflow-hidden ${focusRing}`}
    >
      {/* Severity panel — full-height colored block with day count */}
      <div className={`w-16 shrink-0 flex flex-col ${panelBg} ${panelFg}`}>
        <div className="flex-1 flex flex-col items-center justify-center gap-0.5 py-4">
          <div className="text-3xl font-bold tabular-nums leading-none">
            {contract.daysOverdue}
          </div>
          <div className="text-xs font-medium leading-snug" style={{ opacity: 0.85 }}>
            วัน
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 p-4 min-w-0">
        {/* Top row: contract info | outstanding */}
        <div className="flex items-start justify-between gap-3 mb-3 min-w-0">
          <div className="min-w-0">
            {onOpen360 ? (
              <button
                type="button"
                onClick={() => onOpen360(contract)}
                className="font-mono text-sm text-primary font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 rounded text-left leading-snug"
                aria-label={`เปิด Customer 360 ของสัญญา ${contract.contractNumber}`}
              >
                {contract.contractNumber}
              </button>
            ) : (
              <div className="font-mono text-sm text-primary font-medium leading-snug">
                {contract.contractNumber}
              </div>
            )}
            <div className="text-base font-bold leading-snug truncate mt-1">
              {contract.customer.name}
            </div>
            <div className="text-sm text-muted-foreground leading-snug mt-0.5">
              {contract.branch.name}
            </div>
          </div>

          <div className="text-right shrink-0">
            <div className="flex items-baseline gap-1 justify-end leading-none">
              <span className="text-2xl sm:text-3xl font-bold tabular-nums text-destructive tracking-tight">
                {formatNumber(contract.outstanding)}
              </span>
              <span className="text-base font-semibold text-destructive">฿</span>
            </div>
            <div className="text-xs text-muted-foreground leading-snug mt-1">ค้างชำระ</div>
          </div>
        </div>

        {/* Unified chip row — text-xs (was 2xs), size-3.5 icons (was size-3) */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {/* Called-today chip — most prominent indicator so collectors
              instantly know this row was already worked today. */}
          {isToday(contract.lastCallAt) && contract.lastCallAt && (
            <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 text-success text-xs font-medium px-2.5 py-1 leading-snug">
              <CheckCircle2 className="size-3.5" />
              โทรแล้ววันนี้ {formatHHMM(contract.lastCallAt)}
            </span>
          )}

          {/* Trend arrow chip — only shown when there's a movement signal.
              Plain "เลย X วัน" is redundant with the giant left-panel number. */}
          {arrow && (
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium leading-snug ${agingColor(bucket)}`}
            >
              {arrow === 'UP' ? (
                <>
                  <ArrowUp className="size-3.5" data-testid="trending-up" />
                  แย่ลง
                </>
              ) : (
                <>
                  <ArrowDown className="size-3.5" data-testid="trending-down" />
                  ดีขึ้น
                </>
              )}
            </span>
          )}

          {/* Settlement / นัดชำระ — แสดงยอดด้วยถ้ามี (พร้อมงวดที่ 2 กรณีแบ่งจ่าย) */}
          {contract.settlementDate && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs font-medium px-2.5 py-1 leading-snug"
              title={
                contract.secondSettlementDate
                  ? `งวด 1: ${contract.settlementAmount != null ? formatNumber(contract.settlementAmount) + ' ฿ ' : ''}${formatDateShort(new Date(contract.settlementDate))}\nงวด 2: ${contract.secondSettlementAmount != null ? formatNumber(contract.secondSettlementAmount) + ' ฿ ' : ''}${formatDateShort(new Date(contract.secondSettlementDate))}`
                  : undefined
              }
            >
              <CalendarCheck className="size-3.5" />
              นัดชำระ {formatDateShort(new Date(contract.settlementDate))}
              {contract.settlementAmount != null && (
                <span className="font-semibold tabular-nums">
                  {' · '}
                  {formatNumber(contract.settlementAmount)} ฿
                </span>
              )}
              {contract.secondSettlementDate && contract.secondSettlementAmount != null && (
                <span className="text-primary/70">
                  {' + '}
                  {formatNumber(contract.secondSettlementAmount)} ฿{' '}
                  {formatDateShort(new Date(contract.secondSettlementDate))}
                </span>
              )}
            </span>
          )}

          {/* Broken promise — เปลี่ยนเป็น solid red + เตือน "ต้อง escalate" เมื่อ ≥ threshold */}
          {contract.brokenPromiseCount > 0 &&
            (contract.brokenPromiseCount >= ESCALATION_BROKEN_PROMISE_THRESHOLD ? (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-destructive text-destructive-foreground text-xs font-bold px-2.5 py-1 leading-snug"
                title="ลูกค้าผิดนัดถึงเกณฑ์ — ห้ามนัดเพิ่ม ต้อง escalate"
              >
                <AlertTriangle className="size-3.5" />
                ผิดนัด {contract.brokenPromiseCount} ครั้ง · ต้อง escalate
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 text-destructive text-xs font-medium px-2.5 py-1 leading-snug">
                <AlertTriangle className="size-3.5" />
                ผิดนัด {contract.brokenPromiseCount} ครั้ง
              </span>
            ))}

          {/* No-answer count */}
          {contract.noAnswerCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 text-warning border border-warning/20 text-xs font-medium px-2.5 py-1 leading-snug">
              <PhoneMissed className="size-3.5" />
              ไม่รับสาย {contract.noAnswerCount} ครั้ง
            </span>
          )}

          {/* Snooze */}
          {contract.snoozedUntil && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-medium px-2.5 py-1 leading-snug"
              title={`Snooze ถึง ${new Date(contract.snoozedUntil).toLocaleString('th-TH')}`}
            >
              <Moon className="size-3.5" />
              ถึง {formatSnoozeUntil(contract.snoozedUntil)}
            </span>
          )}

          {/* Last contacted — clearer text */}
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted text-muted-foreground text-xs font-medium px-2.5 py-1 leading-snug">
            <Clock className="size-3.5" />
            ติดต่อล่าสุด {formatRelativeTime(contract.lastContactedAt)}
          </span>

          {/* Channel */}
          {ChannelIcon && channelMeta && (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted text-muted-foreground text-xs font-medium px-2.5 py-1 leading-snug">
              <ChannelIcon className="size-3.5" />
              ผ่าน {channelMeta.label}
            </span>
          )}

          {/* MDM */}
          {contract.mdmState === 'PENDING' && (
            <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 text-warning text-xs font-medium px-2.5 py-1 leading-snug">
              <Lock className="size-3.5" /> รออนุมัติล็อคเครื่อง
            </span>
          )}
          {contract.mdmState === 'LOCKED' && (
            <span className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 text-destructive text-xs font-medium px-2.5 py-1 leading-snug">
              <Lock className="size-3.5" /> ล็อคเครื่องอยู่
            </span>
          )}

          {/* Device locked */}
          {contract.deviceLocked && contract.mdmState !== 'LOCKED' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive border border-destructive/20 text-xs font-medium px-2.5 py-1 leading-snug">
              <Lock className="size-3.5" /> ล็อคเครื่องอยู่
            </span>
          )}

          {/* Skip tracing */}
          {contract.needsSkipTracing &&
            (onSkipTrace ? (
              <button
                onClick={() => onSkipTrace(contract)}
                className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary border border-border text-xs font-medium px-2.5 py-1 leading-snug transition-colors"
                title="เปิดวิซาร์ดหาเบอร์ใหม่"
                aria-label="หาเบอร์ใหม่"
              >
                <Search className="size-3.5" /> หาเบอร์ใหม่
              </button>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground border border-border text-xs font-medium px-2.5 py-1 leading-snug">
                <Search className="size-3.5" /> หาเบอร์ใหม่
              </span>
            ))}

          {/* Related contracts */}
          {contract.relatedContractsCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted text-muted-foreground text-xs font-medium px-2.5 py-1 leading-snug">
              <Users className="size-3.5" />
              ผ่อนอีก {contract.relatedContractsCount} สัญญา
            </span>
          )}

          <CustomerTagChips tags={contract.customerTags} compact />

          <NextBestActionChip
            action={contract.nextBestAction}
            onClick={onNextBestAction ? (type) => onNextBestAction(contract, type) : undefined}
          />
        </div>

        {/* Bottom row: assignee · phone | CTAs — bigger, more legible */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2 text-sm text-foreground truncate leading-snug">
            {contract.assignedTo ? (
              <span className="inline-flex items-center gap-1 shrink-0 text-muted-foreground">
                <UserCircle className="size-3.5" />
                {contract.assignedTo.name}
              </span>
            ) : (
              <span className="text-muted-foreground italic shrink-0">ยังไม่มอบหมาย</span>
            )}
            {contract.customer.phone && (
              <>
                <span className="text-border select-none">·</span>
                <span className="font-mono tabular-nums truncate font-medium">
                  {contract.customer.phone}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <CallButton
              customerId={contract.customer.id}
              contractId={contract.id}
              phone={contract.customer.phone}
              size="icon"
              variant="outline"
            />
            <button
              onClick={() => onLogContact(contract)}
              className="rounded-lg border border-input p-2 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title="บันทึกผลการโทร"
              aria-label="บันทึกผลการโทร"
            >
              <NotebookPen className="size-4" />
            </button>
            <button
              onClick={() => onSendLine?.(contract)}
              disabled={!contract.customer.lineId}
              className="rounded-lg border border-input p-2 hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
              title={contract.customer.lineId ? 'ส่ง LINE' : 'ลูกค้าไม่มี LINE ID'}
              aria-label="ส่ง LINE"
            >
              <MessageSquare className="size-4" />
            </button>
            {onOpen360 && (
              <button
                onClick={() => onOpen360(contract)}
                className="rounded-lg border border-input p-2 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                title="เปิด Customer 360"
                aria-label="เปิด Customer 360"
              >
                <ChevronRight className="size-4" />
              </button>
            )}
            {(onSnooze || onUnsnooze || onPartialPaymentReschedule) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="rounded-lg border border-input p-2 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                    title="เพิ่มเติม"
                    aria-label="เพิ่มเติม"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {onPartialPaymentReschedule && (
                    <DropdownMenuItem onSelect={() => onPartialPaymentReschedule(contract)}>
                      <Coins className="size-4" /> บันทึกชำระเงิน
                    </DropdownMenuItem>
                  )}
                  {onSnooze && !isSnoozed && (
                    <DropdownMenuItem onSelect={() => onSnooze(contract)}>
                      <Moon className="size-4" /> Snooze จน...
                    </DropdownMenuItem>
                  )}
                  {onUnsnooze && isSnoozed && (
                    <DropdownMenuItem onSelect={() => onUnsnooze(contract)}>
                      <Moon className="size-4" /> ยกเลิก snooze
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
