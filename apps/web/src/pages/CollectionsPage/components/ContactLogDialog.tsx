import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Phone, PhoneIncoming, PhoneOutgoing, Clock } from 'lucide-react';
import api from '@/lib/api';
import Modal from '@/components/ui/Modal';
import { formatNumber } from '@/utils/formatters';
import { useContactLog } from '../hooks/useContactLog';
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
  const [settlementNotes, setSettlementNotes] = useState('');

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

  useEffect(() => {
    if (open) {
      setOutcome(null);
      setNotes('');
      setSettlementDate('');
      setSettlementNotes('');
    }
  }, [open, contract?.id]);

  const recentList: CallLogItem[] = Array.isArray(recentCallQuery.data)
    ? (recentCallQuery.data as CallLogItem[])
    : ((recentCallQuery.data as { data: CallLogItem[] } | undefined)?.data ?? []);
  const latestCall = recentList[0];
  const isRecent =
    latestCall &&
    Date.now() - new Date(latestCall.calledAt ?? latestCall.createdAt).getTime() < RECENT_WINDOW_MS;

  const showSettlement = outcome === 'WILL_PAY';
  const canSave =
    outcome !== null && (!showSettlement || settlementDate) && !mutation.isPending;

  function handleClose() {
    if (mutation.isPending) return;
    onClose();
  }

  function pickQuickDate(opt: (typeof QUICK_DATE_OPTIONS)[number]) {
    if (opt.endOfMonth) setSettlementDate(endOfThisMonth());
    else if (opt.offsetDays != null) setSettlementDate(dateOffset(opt.offsetDays));
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

        {/* Settlement card — appears only for "นัดชำระ" */}
        {showSettlement && (
          <div className="space-y-3 rounded-xl border border-success/30 bg-success/5 p-4">
            <div>
              <label className="text-sm font-semibold text-foreground mb-2 block leading-snug">
                วันที่นัดจ่าย <span className="text-destructive">*</span>
              </label>

              {/* Quick date pills */}
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
                รายละเอียดการนัด
              </label>
              <textarea
                value={settlementNotes}
                onChange={(e) => setSettlementNotes(e.target.value)}
                placeholder="จำนวนเงินที่นัดจ่าย, ช่องทางการชำระ..."
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
