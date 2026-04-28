import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Phone, PhoneIncoming, PhoneOutgoing, Clock } from 'lucide-react';
import api from '@/lib/api';
import Modal from '@/components/ui/Modal';
import { formatNumber } from '@/utils/formatters';
import { formatThaiDateShort } from '@/lib/date';
import { useContactLog } from '../hooks/useContactLog';
import { usePromiseSlots } from '../hooks/usePromiseSlots';
import SupersedePromiseConfirmDialog from './SupersedePromiseConfirmDialog';
import InstallmentPickerPopover, { type InstallmentOption } from './InstallmentPickerPopover';
import type { ContractRow } from '../types';

interface CallLogItem {
  id: string;
  result: string;
  notes?: string | null;
  createdAt: string;
  calledAt?: string | null;
  recordingUrl?: string | null;
  recordingStorageTier?: string | null;
  yeastarRecordingPath?: string | null;
  yeastarCallId?: string | null;
  callDirection?: 'INBOUND' | 'OUTBOUND' | null;
  callDurationSec?: number | null;
}

interface Props {
  open: boolean;
  contract: ContractRow | null;
  onClose: () => void;
  onSaved?: (result: { outcome?: string; notes?: string }) => void;
}

/**
 * 3 outcomes — covers what collectors actually need to log:
 * - WILL_PAY: customer agreed to pay (with date)
 * - NO_ANSWER: phone rang, customer didn't pick up
 * - UNREACHABLE: couldn't connect at all (phone off, wrong number, disconnected)
 */
type Outcome = 'WILL_PAY' | 'NO_ANSWER' | 'UNREACHABLE';

const OUTCOMES: Array<{
  value: Outcome;
  label: string;
  tone: string;
  description: string;
}> = [
  {
    value: 'WILL_PAY',
    label: 'นัดชำระ',
    tone: 'border-success/40 hover:bg-success/10',
    description: 'ลูกค้ารับสาย + ตกลงวันจะจ่าย',
  },
  {
    value: 'NO_ANSWER',
    label: 'ไม่รับสาย',
    tone: 'border-warning/40 hover:bg-warning/10',
    description: 'โทรไปแล้วไม่รับ',
  },
  {
    value: 'UNREACHABLE',
    label: 'ติดต่อไม่ได้',
    tone: 'border-destructive/40 hover:bg-destructive/10',
    description: 'ปิดเครื่อง / เบอร์ผิด / ตัดสาย',
  },
];

const QUICK_DATE_OPTIONS: Array<{
  label: string;
  offsetDays?: number;
  endOfMonth?: boolean;
}> = [
  { label: 'พรุ่งนี้', offsetDays: 1 },
  { label: 'อีก 3 วัน', offsetDays: 3 },
  { label: 'อีก 7 วัน', offsetDays: 7 },
  { label: 'อีก 15 วัน', offsetDays: 15 },
  { label: 'สิ้นเดือน', endOfMonth: true },
];

function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function endOfThisMonth(): string {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return last.toISOString().split('T')[0];
}

function getTomorrow(): string {
  return dateOffset(1);
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')} นาที`;
}

const RECENT_WINDOW_MS = 30 * 60 * 1000;

interface ActivePromiseSummary {
  id: string;
  settlementDate: string | null;
  settlementAmount: number;
  rescheduleCount: number;
  slotsPastDue: boolean;
}

export default function ContactLogDialog({ open, contract, onClose, onSaved }: Props) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [notes, setNotes] = useState('');
  const [settlementNotes, setSettlementNotes] = useState('');
  const [supersedeConfirmOpen, setSupersedeConfirmOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [overrideMode, setOverrideMode] = useState(false);
  const [targetInstallmentIds, setTargetInstallmentIds] = useState<string[]>([]);

  const { slots, addSlot, removeSlot, updateSlot, reset: resetSlots } = usePromiseSlots();
  const mutation = useContactLog();

  const recentCallQuery = useQuery<{ data: CallLogItem[] } | CallLogItem[]>({
    queryKey: ['contract-call-log-latest', contract?.id],
    queryFn: async () => {
      const { data } = await api.get(`/overdue/contracts/${contract!.id}/call-logs?limit=1`);
      return data;
    },
    enabled: open && !!contract,
    refetchOnWindowFocus: false,
    staleTime: 30 * 1000,
  });

  const cycleDeadlineQuery = useQuery({
    queryKey: ['contract-cycle-deadline', contract?.id],
    queryFn: async () => {
      const { data } = await api.get(`/overdue/contracts/${contract!.id}/cycle-deadline`);
      return data as {
        cycleDeadline: string;
        activePromise: ActivePromiseSummary | null;
      };
    },
    enabled: open && !!contract && outcome === 'WILL_PAY',
    refetchOnWindowFocus: false,
  });

  const installmentsQuery = useQuery({
    queryKey: ['contract-overdue-installments', contract?.id],
    queryFn: async () => {
      const { data } = await api.get(`/overdue/contracts/${contract!.id}/overdue-installments`);
      return data as InstallmentOption[];
    },
    enabled: open && !!contract && outcome === 'WILL_PAY',
    refetchOnWindowFocus: false,
  });

  const cycleDeadline = cycleDeadlineQuery.data?.cycleDeadline;
  const activePromise = cycleDeadlineQuery.data?.activePromise ?? null;
  const willCountBroken =
    !!activePromise && (activePromise.rescheduleCount >= 1 || activePromise.slotsPastDue);

  useEffect(() => {
    if (open) {
      setOutcome(null);
      setNotes('');
      setSettlementNotes('');
      resetSlots([
        {
          id: crypto.randomUUID(),
          settlementDate: '',
          settlementAmount: contract ? String(contract.outstanding) : '',
        },
      ]);
      setOverrideMode(false);
      setTargetInstallmentIds([]);
      setSupersedeConfirmOpen(false);
      setPickerOpen(false);
    }
    // L1 fix: do NOT depend on contract.outstanding here. Including it caused
    // an in-flight outstanding refetch (e.g. after a payment posted) to wipe
    // user-entered slot data mid-dialog. Reset on dialog open / contract change only.
  }, [open, contract?.id, resetSlots]);

  const recentList: CallLogItem[] = Array.isArray(recentCallQuery.data)
    ? (recentCallQuery.data as CallLogItem[])
    : ((recentCallQuery.data as { data: CallLogItem[] } | undefined)?.data ?? []);
  const latestCall = recentList[0];
  const isRecent =
    latestCall &&
    Date.now() - new Date(latestCall.calledAt ?? latestCall.createdAt).getTime() < RECENT_WINDOW_MS;

  const showSettlement = outcome === 'WILL_PAY';

  const slotsValid = slots.every((s) => {
    const amt = Number(s.settlementAmount);
    return !!s.settlementDate && Number.isFinite(amt) && amt > 0;
  });
  const canSave = outcome !== null && (!showSettlement || slotsValid) && !mutation.isPending;

  function handleClose() {
    if (mutation.isPending) return;
    onClose();
  }

  function doSubmit() {
    if (!contract || !outcome) return;

    const result =
      outcome === 'WILL_PAY'
        ? 'PROMISED'
        : outcome === 'NO_ANSWER'
          ? 'NO_ANSWER'
          : 'NO_ANSWER'; // UNREACHABLE → legacy result NO_ANSWER

    const callResult =
      outcome === 'WILL_PAY' ? 'ANSWERED' : outcome === 'NO_ANSWER' ? 'NO_ANSWER' : 'UNREACHABLE';

    const negotiationResult = outcome === 'WILL_PAY' ? 'WILL_PAY' : 'NOT_APPLICABLE';

    mutation.mutate(
      {
        contractId: contract.id,
        result: result as any,
        notes: notes || undefined,
        callResult: callResult as any,
        negotiationResult: negotiationResult as any,
        slots: showSettlement
          ? slots.map((s) => ({
              settlementDate: s.settlementDate,
              settlementAmount: Number(s.settlementAmount),
            }))
          : undefined,
        targetInstallmentIds:
          showSettlement && overrideMode ? targetInstallmentIds : undefined,
        settlementNotes: showSettlement ? settlementNotes || undefined : undefined,
      },
      {
        onSuccess: () => {
          onSaved?.({ outcome: outcome!, notes: notes || undefined });
          handleClose();
        },
      },
    );
  }

  function handleSubmit() {
    if (!contract || !outcome) return;
    if (showSettlement && activePromise) {
      setSupersedeConfirmOpen(true);
      return;
    }
    doSubmit();
  }

  return (
    <>
      <Modal
        isOpen={open}
        onClose={handleClose}
        title={`บันทึกผล — ${contract?.customer.name ?? ''}`}
        size="md"
      >
        <div className="space-y-5">
          {/* Contract summary */}
          {contract && (
            <div className="rounded-xl bg-muted/40 px-4 py-3 flex items-baseline justify-between gap-3">
              <span className="font-mono text-sm text-primary font-medium leading-snug">
                {contract.contractNumber}
              </span>
              <span className="text-sm leading-snug">
                ค้าง{' '}
                <span className="text-lg font-bold tabular-nums text-destructive">
                  {formatNumber(contract.outstanding)}
                </span>{' '}
                ฿ · <span className="font-medium">{contract.daysOverdue} วัน</span>
              </span>
            </div>
          )}

          {/* Yeastar info card / no-recent fallback */}
          {recentCallQuery.isLoading ? (
            <div className="rounded-xl border border-border/50 bg-card px-4 py-3 text-sm text-muted-foreground leading-relaxed">
              กำลังโหลดข้อมูลการโทร...
            </div>
          ) : isRecent && latestCall ? (
            <div className="rounded-xl border border-success/30 bg-success/5 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-success leading-snug mb-2">
                {latestCall.callDirection === 'INBOUND' ? (
                  <PhoneIncoming className="size-4" />
                ) : (
                  <PhoneOutgoing className="size-4" />
                )}
                ระบบบันทึกการโทรอัตโนมัติ
              </div>
              <div className="flex items-center gap-3 text-sm text-foreground leading-snug">
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="size-3.5 text-muted-foreground" />
                  <span className="tabular-nums">
                    {new Date(latestCall.calledAt ?? latestCall.createdAt).toLocaleTimeString(
                      'th-TH',
                      {
                        hour: '2-digit',
                        minute: '2-digit',
                      },
                    )}
                  </span>
                </span>
                {latestCall.callDurationSec != null && latestCall.callDurationSec > 0 && (
                  <>
                    <span className="text-muted-foreground">·</span>
                    <span className="tabular-nums font-medium">
                      {formatDuration(latestCall.callDurationSec)}
                    </span>
                  </>
                )}
                <span className="text-muted-foreground">·</span>
                <span className="font-medium">
                  {latestCall.callDurationSec && latestCall.callDurationSec > 0
                    ? 'รับสาย'
                    : 'ไม่รับสาย'}
                </span>
              </div>
              {latestCall.recordingUrl && (
                <audio
                  controls
                  src={latestCall.recordingUrl}
                  preload="none"
                  className="w-full h-8 mt-3"
                  aria-label="ฟังเสียงโทร"
                >
                  เบราว์เซอร์ไม่รองรับ audio player
                </audio>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground leading-relaxed flex items-center gap-2">
              <Phone className="size-4" />
              ไม่พบบันทึกการโทรจากระบบ — ใช้กรณีโทรผ่านมือถือส่วนตัว / LINE / พบหน้า
            </div>
          )}

          {/* ผลการคุย — 3 chips */}
          <div>
            <label className="text-sm font-semibold text-foreground mb-2 block leading-snug">
              ผลการคุย <span className="text-destructive">*</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {OUTCOMES.map((o) => {
                const selected = outcome === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setOutcome(o.value)}
                    className={`px-4 py-3.5 rounded-xl border text-left transition-colors ${
                      selected
                        ? 'border-primary bg-primary/10 text-primary'
                        : `${o.tone} border bg-card text-foreground`
                    }`}
                  >
                    <div className="text-base font-semibold leading-snug">{o.label}</div>
                    <div
                      className={`text-xs leading-snug mt-1 ${
                        selected ? 'text-primary/80' : 'text-muted-foreground'
                      }`}
                    >
                      {o.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Settlement card — N-slot manager (appears only for "นัดชำระ") */}
          {showSettlement && (
            <div className="space-y-4 rounded-xl border border-success/30 bg-success/5 p-4">
              {/* Cycle deadline banner */}
              {cycleDeadline && (
                <div className="rounded-lg bg-card border border-border px-3 py-2 text-sm leading-snug">
                  เพดานรอบนัด:{' '}
                  <span className="font-semibold tabular-nums">
                    {formatThaiDateShort(cycleDeadline)}
                  </span>{' '}
                  — ทุก &ldquo;ที่&rdquo; ต้องไม่เกินวันนี้
                </div>
              )}

              {/* N slots */}
              {slots.map((slot, idx) => (
                <div
                  key={slot.id}
                  className="rounded-lg border border-border/60 bg-card p-3 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold leading-snug">ที่ {idx + 1}</div>
                    {slots.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeSlot(slot.id)}
                        className="text-xs text-destructive hover:underline"
                      >
                        ลบ
                      </button>
                    )}
                  </div>

                  {/* Date pills + date input */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block leading-snug">
                      วันที่นัด <span className="text-destructive">*</span>
                    </label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {QUICK_DATE_OPTIONS.map((opt) => {
                        const computed = opt.endOfMonth
                          ? endOfThisMonth()
                          : opt.offsetDays != null
                            ? dateOffset(opt.offsetDays)
                            : '';
                        const active = slot.settlementDate === computed;
                        return (
                          <button
                            key={opt.label}
                            type="button"
                            onClick={() => updateSlot(slot.id, { settlementDate: computed })}
                            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                              active
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'bg-card border-input hover:bg-muted'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                    <input
                      type="date"
                      min={getTomorrow()}
                      max={cycleDeadline ? cycleDeadline.slice(0, 10) : undefined}
                      value={slot.settlementDate}
                      onChange={(e) => updateSlot(slot.id, { settlementDate: e.target.value })}
                      className="w-full px-3 py-2 border border-input rounded-lg text-sm font-mono"
                    />
                  </div>

                  {/* Amount */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block leading-snug">
                      ยอด <span className="text-destructive">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0.01}
                        step="0.01"
                        value={slot.settlementAmount}
                        onChange={(e) =>
                          updateSlot(slot.id, { settlementAmount: e.target.value })
                        }
                        className="w-full px-3 py-2 pr-9 border border-input rounded-lg text-sm tabular-nums"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        ฿
                      </span>
                    </div>
                  </div>
                </div>
              ))}

              {/* Sum indicator */}
              {(() => {
                const totalSlots = slots.reduce(
                  (acc, s) => acc + (Number(s.settlementAmount) || 0),
                  0,
                );
                const outstanding = contract?.outstanding ?? 0;
                return (
                  <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2 text-sm leading-snug flex items-center justify-between">
                    <span>รวม {slots.length} ที่</span>
                    <span className="font-semibold tabular-nums">
                      {formatNumber(totalSlots)} ฿{' '}
                      <span className="text-muted-foreground text-xs">
                        / ค้าง {formatNumber(outstanding)} ฿
                      </span>
                    </span>
                  </div>
                );
              })()}

              {/* Add slot button */}
              <button
                type="button"
                onClick={addSlot}
                className="w-full px-3 py-2 rounded-lg border-2 border-dashed border-border hover:bg-muted text-sm font-medium leading-snug transition-colors"
              >
                + เพิ่ม &ldquo;ที่&rdquo;
              </button>

              {/* Installment picker link (Task 22) */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setPickerOpen((v) => !v)}
                  className="text-sm text-primary hover:underline leading-snug"
                >
                  {overrideMode
                    ? `ครอบงวด ${targetInstallmentIds.length} งวด · แก้`
                    : 'ครอบงวด: อัตโนมัติ (FIFO) · ระบุงวดเอง'}
                </button>
                {installmentsQuery.data && (
                  <InstallmentPickerPopover
                    open={pickerOpen}
                    installments={installmentsQuery.data}
                    selectedIds={targetInstallmentIds}
                    onChange={(ids, total) => {
                      setTargetInstallmentIds(ids);
                      setOverrideMode(ids.length > 0);
                      // Auto-fill first slot's amount when single-slot
                      if (slots.length === 1 && total > 0) {
                        updateSlot(slots[0].id, { settlementAmount: String(total) });
                      }
                    }}
                    onClose={() => setPickerOpen(false)}
                  />
                )}
              </div>

              {/* Settlement notes */}
              <div>
                <label className="text-sm font-semibold text-foreground mb-1.5 block leading-snug">
                  รายละเอียดการนัด
                </label>
                <textarea
                  value={settlementNotes}
                  onChange={(e) => setSettlementNotes(e.target.value)}
                  placeholder="ช่องทางการชำระ, หมายเหตุ..."
                  rows={2}
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm resize-none leading-relaxed"
                />
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-sm font-semibold text-foreground mb-1.5 block leading-snug">
              บันทึก
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="รายละเอียดการสนทนา..."
              rows={3}
              className="w-full px-3 py-2.5 border border-input rounded-lg text-sm resize-none leading-relaxed"
            />
          </div>

          {/* LINE notify hint — fires for outcomes that should reach customer */}
          {outcome && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-primary leading-snug">
              ระบบจะส่ง LINE แจ้งเตือนลูกค้าทันทีหลังบันทึก
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 justify-end pt-2 border-t border-border/40">
            <button
              onClick={handleClose}
              disabled={mutation.isPending}
              className="px-5 py-2.5 text-base border border-input rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
            >
              ยกเลิก
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSave}
              className="px-5 py-2.5 text-base bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {mutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Supersede confirm dialog — shown when active promise exists and user clicks submit */}
      <SupersedePromiseConfirmDialog
        open={supersedeConfirmOpen}
        oldPromise={
          activePromise
            ? {
                settlementDate: activePromise.settlementDate ?? new Date().toISOString(),
                settlementAmount: activePromise.settlementAmount,
                rescheduleCount: activePromise.rescheduleCount,
              }
            : null
        }
        willCountBroken={willCountBroken}
        onConfirm={() => {
          setSupersedeConfirmOpen(false);
          doSubmit();
        }}
        onCancel={() => setSupersedeConfirmOpen(false)}
      />
    </>
  );
}
