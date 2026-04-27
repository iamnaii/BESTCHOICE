import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Phone, PhoneIncoming, PhoneOutgoing, Clock, AlertTriangle, FileText, Lock, Scale } from 'lucide-react';
import api from '@/lib/api';
import Modal from '@/components/ui/Modal';
import { formatNumber } from '@/utils/formatters';
import { useContactLog } from '../hooks/useContactLog';
import {
  useEscalate,
  ESCALATION_BROKEN_PROMISE_THRESHOLD,
  type EscalationAction,
} from '../hooks/useEscalate';
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

export default function ContactLogDialog({ open, contract, onClose, onSaved }: Props) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [notes, setNotes] = useState('');
  const [settlementDate, setSettlementDate] = useState('');
  const [settlementAmount, setSettlementAmount] = useState(''); // = งวด 1 ตอน split, = ยอดรวม ตอน non-split
  const [splitPayment, setSplitPayment] = useState(false);
  const [secondSettlementDate, setSecondSettlementDate] = useState('');
  const [settlementNotes, setSettlementNotes] = useState('');
  const [escalationReason, setEscalationReason] = useState('');

  const mutation = useContactLog();
  const escalateMutation = useEscalate();

  const requiresEscalation =
    !!contract && contract.brokenPromiseCount >= ESCALATION_BROKEN_PROMISE_THRESHOLD;

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

  useEffect(() => {
    if (open) {
      setOutcome(null);
      setNotes('');
      setSettlementDate('');
      setSettlementAmount(contract ? String(contract.outstanding) : '');
      setSplitPayment(false);
      setSecondSettlementDate('');
      setSettlementNotes('');
      setEscalationReason('');
    }
  }, [open, contract?.id, contract?.outstanding]);

  const recentList: CallLogItem[] = Array.isArray(recentCallQuery.data)
    ? (recentCallQuery.data as CallLogItem[])
    : ((recentCallQuery.data as { data: CallLogItem[] } | undefined)?.data ?? []);
  const latestCall = recentList[0];
  const isRecent =
    latestCall &&
    Date.now() - new Date(latestCall.calledAt ?? latestCall.createdAt).getTime() < RECENT_WINDOW_MS;

  const showSettlement = outcome === 'WILL_PAY';

  const outstanding = contract?.outstanding ?? 0;
  const amount1Num = Number(settlementAmount);
  const amount1Valid = Number.isFinite(amount1Num) && amount1Num > 0;
  // Split mode: total ถูก lock = outstanding → งวด 2 auto = outstanding − งวด 1.
  // (ถ้าอยาก promise น้อยกว่า outstanding ให้ใช้ non-split mode)
  const amount2Num = splitPayment
    ? Math.max(0, +(outstanding - amount1Num).toFixed(2))
    : 0;
  const amount1WithinBound = splitPayment
    ? amount1Num > 0 && amount1Num < outstanding // < เพื่อให้งวด 2 > 0
    : amount1Num > 0 && amount1Num <= outstanding;

  const settlementValid = splitPayment
    ? amount1Valid && amount1WithinBound && !!settlementDate && !!secondSettlementDate
    : amount1Valid && amount1WithinBound && !!settlementDate;

  const canSave = outcome !== null && (!showSettlement || settlementValid) && !mutation.isPending;

  function handleClose() {
    if (mutation.isPending) return;
    onClose();
  }

  function pickQuickDate(opt: (typeof QUICK_DATE_OPTIONS)[number]) {
    if (opt.endOfMonth) setSettlementDate(endOfThisMonth());
    else if (opt.offsetDays != null) setSettlementDate(dateOffset(opt.offsetDays));
  }

  // ติ๊ก toggle → split โดย total = outstanding (lock), งวด 1 default = ครึ่ง
  // ปลด toggle → settlementAmount = outstanding (single field, แก้ลดได้)
  function toggleSplit(checked: boolean) {
    if (checked) {
      const half = Math.floor(outstanding / 2);
      setSettlementAmount(String(half));
    } else {
      setSettlementAmount(String(outstanding));
      setSecondSettlementDate('');
    }
    setSplitPayment(checked);
  }

  function handleEscalate(action: EscalationAction) {
    if (!contract) return;
    const reason = escalationReason.trim();
    if (reason.length < 5) return; // UI guard mirror of backend
    escalateMutation.mutate(
      { contractId: contract.id, action, reason },
      {
        onSuccess: () => {
          onSaved?.({ outcome: 'ESCALATED', notes: reason });
          handleClose();
        },
      },
    );
  }

  function handleSubmit() {
    if (!contract || !outcome) return;
    const result =
      outcome === 'WILL_PAY'
        ? 'PROMISED'
        : outcome === 'NO_ANSWER'
          ? 'NO_ANSWER'
          : 'NO_ANSWER'; // UNREACHABLE → legacy result NO_ANSWER (Yeastar covers fine-grained reason via callResult)

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
        settlementDate: showSettlement ? settlementDate || undefined : undefined,
        settlementAmount: showSettlement && amount1Valid ? amount1Num : undefined,
        secondSettlementDate:
          showSettlement && splitPayment ? secondSettlementDate || undefined : undefined,
        secondSettlementAmount:
          showSettlement && splitPayment && amount2Num > 0 ? amount2Num : undefined,
        settlementNotes: showSettlement ? settlementNotes || undefined : undefined,
      },
      {
        onSuccess: () => {
          onSaved?.({ outcome, notes: notes || undefined });
          handleClose();
        },
      },
    );
  }

  return (
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
                  {new Date(latestCall.calledAt ?? latestCall.createdAt).toLocaleTimeString('th-TH', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
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

        {/* Escalation Guardrail banner — โผล่ตอนผิดนัด ≥ threshold */}
        {requiresEscalation && contract && (
          <div className="rounded-xl border-2 border-destructive bg-destructive/5 p-4 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-bold text-destructive leading-snug">
                  ลูกค้าผิดนัดสะสม {contract.brokenPromiseCount} ครั้ง — ห้ามนัดเพิ่ม
                </div>
                <div className="text-xs text-muted-foreground leading-snug mt-1">
                  ระบบบล็อคการบันทึกนัดใหม่ ต้องเลือก escalation 1 ใน 3 ทาง
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ผลการคุย — 3 chips (นัดชำระ disable เมื่อต้อง escalate) */}
        <div>
          <label className="text-sm font-semibold text-foreground mb-2 block leading-snug">
            ผลการคุย <span className="text-destructive">*</span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {OUTCOMES.map((o) => {
              const selected = outcome === o.value;
              const blocked = requiresEscalation && o.value === 'WILL_PAY';
              return (
                <button
                  key={o.value}
                  type="button"
                  disabled={blocked}
                  onClick={() => !blocked && setOutcome(o.value)}
                  title={blocked ? 'ผิดนัดเกินเกณฑ์ — ใช้ Escalation panel ด้านล่าง' : undefined}
                  className={`px-4 py-3.5 rounded-xl border text-left transition-colors ${
                    blocked
                      ? 'border-border bg-muted/40 text-muted-foreground cursor-not-allowed'
                      : selected
                        ? 'border-primary bg-primary/10 text-primary'
                        : `${o.tone} border bg-card text-foreground`
                  }`}
                >
                  <div className="text-base font-semibold leading-snug">{o.label}</div>
                  <div
                    className={`text-xs leading-snug mt-1 ${
                      blocked
                        ? 'text-muted-foreground'
                        : selected
                          ? 'text-primary/80'
                          : 'text-muted-foreground'
                    }`}
                  >
                    {o.description}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Escalation panel — โผล่ตอน requiresEscalation */}
        {requiresEscalation && (
          <div className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
            <div className="text-sm font-semibold text-destructive leading-snug">
              เลือก Escalation
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block leading-snug">
                เหตุผล <span className="text-destructive">*</span>
                <span className="text-xs text-muted-foreground ml-2">(≥ 5 ตัวอักษร)</span>
              </label>
              <textarea
                value={escalationReason}
                onChange={(e) => setEscalationReason(e.target.value)}
                placeholder="เช่น ผิดนัดต่อเนื่อง ติดต่อไม่ได้ 2 ครั้ง..."
                rows={2}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm resize-none leading-relaxed"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleEscalate('LETTER')}
                disabled={
                  escalationReason.trim().length < 5 || escalateMutation.isPending
                }
                className="px-3 py-3 rounded-lg border border-warning/40 bg-card hover:bg-warning/10 text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex flex-col items-center gap-1"
              >
                <FileText className="size-5 text-warning" />
                <span className="text-sm font-semibold leading-snug">ส่งจดหมายเตือน</span>
                <span className="text-xs text-muted-foreground leading-snug">
                  สร้างหนังสือบอกเลิกสัญญา
                </span>
              </button>
              <button
                type="button"
                onClick={() => handleEscalate('MDM')}
                disabled={
                  escalationReason.trim().length < 5 || escalateMutation.isPending
                }
                className="px-3 py-3 rounded-lg border border-warning/40 bg-card hover:bg-warning/10 text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex flex-col items-center gap-1"
              >
                <Lock className="size-5 text-warning" />
                <span className="text-sm font-semibold leading-snug">เสนอล็อคเครื่อง</span>
                <span className="text-xs text-muted-foreground leading-snug">
                  รออนุมัติจาก ผจก.
                </span>
              </button>
              <button
                type="button"
                onClick={() => handleEscalate('LEGAL')}
                disabled={
                  escalationReason.trim().length < 5 || escalateMutation.isPending
                }
                className="px-3 py-3 rounded-lg border border-destructive/40 bg-card hover:bg-destructive/10 text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex flex-col items-center gap-1"
              >
                <Scale className="size-5 text-destructive" />
                <span className="text-sm font-semibold leading-snug">ส่งให้ทนาย</span>
                <span className="text-xs text-muted-foreground leading-snug">
                  ตั้ง dunningStage = LEGAL_ACTION
                </span>
              </button>
            </div>
            {escalateMutation.isPending && (
              <div className="text-xs text-muted-foreground leading-snug">
                กำลังบันทึก escalation...
              </div>
            )}
            <div className="text-xs text-muted-foreground leading-snug">
              Owner จะได้รับ LINE แจ้งเตือนทันทีหลังบันทึก
            </div>
          </div>
        )}

        {/* Settlement card — appears only for "นัดชำระ" */}
        {showSettlement && (
          <div className="space-y-4 rounded-xl border border-success/30 bg-success/5 p-4">
            {/* Toggle: นัดแบ่งจ่าย 2 งวด — บนสุด เพื่อให้ผู้ใช้เลือกโหมดก่อนกรอก */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={splitPayment}
                onChange={(e) => toggleSplit(e.target.checked)}
                className="size-4 accent-primary"
              />
              <span className="text-sm font-medium text-foreground leading-snug">
                นัดแบ่งจ่าย 2 งวด
              </span>
              <span className="text-xs text-muted-foreground leading-snug">
                (จ่ายบางส่วนวันแรก, ที่เหลืออีกวัน)
              </span>
            </label>

            {/* Non-split: single date + amount */}
            {!splitPayment && (
              <>
                <div>
                  <label className="text-sm font-semibold text-foreground mb-2 block leading-snug">
                    วันที่นัดจ่าย <span className="text-destructive">*</span>
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2.5">
                    {QUICK_DATE_OPTIONS.map((opt) => {
                      const computed = opt.endOfMonth
                        ? endOfThisMonth()
                        : opt.offsetDays != null
                          ? dateOffset(opt.offsetDays)
                          : '';
                      const active = settlementDate === computed;
                      return (
                        <button
                          key={opt.label}
                          type="button"
                          onClick={() => pickQuickDate(opt)}
                          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
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
                    value={settlementDate}
                    onChange={(e) => setSettlementDate(e.target.value)}
                    className="w-full px-3 py-2.5 border border-input rounded-lg text-base leading-snug font-mono"
                  />
                </div>

                <div>
                  <label className="text-sm font-semibold text-foreground mb-1.5 block leading-snug">
                    ยอดที่ต้องนัด <span className="text-destructive">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0.01}
                      max={outstanding}
                      step="0.01"
                      value={settlementAmount}
                      onChange={(e) => setSettlementAmount(e.target.value)}
                      placeholder={String(outstanding)}
                      className="w-full px-3 py-2.5 pr-10 border border-input rounded-lg text-base leading-snug tabular-nums"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      ฿
                    </span>
                  </div>
                  {settlementAmount && (!amount1Valid || amount1Num > outstanding) && (
                    <p className="mt-1 text-xs text-destructive leading-snug">
                      ยอดต้องมากกว่า 0 และไม่เกิน {formatNumber(outstanding)} ฿
                    </p>
                  )}
                </div>
              </>
            )}

            {/* Split mode: 2 sections + sum indicator */}
            {splitPayment && (
              <>
                {/* งวดที่ 1 */}
                <div className="rounded-lg border border-border/60 bg-card p-3 space-y-3">
                  <div className="text-sm font-semibold text-foreground leading-snug">
                    งวดที่ 1
                  </div>
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
                        const active = settlementDate === computed;
                        return (
                          <button
                            key={opt.label}
                            type="button"
                            onClick={() => pickQuickDate(opt)}
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
                      value={settlementDate}
                      onChange={(e) => setSettlementDate(e.target.value)}
                      className="w-full px-3 py-2 border border-input rounded-lg text-sm leading-snug font-mono"
                    />
                  </div>
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
                        value={settlementAmount}
                        onChange={(e) => setSettlementAmount(e.target.value)}
                        className="w-full px-3 py-2 pr-9 border border-input rounded-lg text-sm leading-snug tabular-nums"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        ฿
                      </span>
                    </div>
                  </div>
                </div>

                {/* งวดที่ 2 — ยอด auto-calc จากงวด 1 (lock) */}
                <div className="rounded-lg border border-border/60 bg-card p-3 space-y-3">
                  <div className="text-sm font-semibold text-foreground leading-snug">
                    งวดที่ 2
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block leading-snug">
                      วันที่นัด <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="date"
                      min={settlementDate || getTomorrow()}
                      value={secondSettlementDate}
                      onChange={(e) => setSecondSettlementDate(e.target.value)}
                      className="w-full px-3 py-2 border border-input rounded-lg text-sm leading-snug font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block leading-snug">
                      ยอด (คำนวณอัตโนมัติ)
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        readOnly
                        value={amount1Valid && amount1WithinBound ? formatNumber(amount2Num) : '—'}
                        className="w-full px-3 py-2 pr-9 border border-input rounded-lg text-sm leading-snug tabular-nums bg-muted/40 text-muted-foreground cursor-not-allowed"
                        aria-label="ยอดงวดที่ 2 (คำนวณจาก ยอดค้าง − งวดที่ 1)"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        ฿
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground leading-snug">
                      ยอดค้าง {formatNumber(outstanding)} − งวดที่ 1
                    </p>
                  </div>
                </div>

                {amount1Valid && !amount1WithinBound && (
                  <p className="text-xs text-destructive leading-snug">
                    งวดที่ 1 ต้องน้อยกว่ายอดค้าง ({formatNumber(outstanding)} ฿)
                  </p>
                )}
              </>
            )}

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
  );
}
