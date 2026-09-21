import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import CashCloseConfirmDialog, { useInvalidateCashClose } from './CashCloseConfirmDialog';
import { EvidenceImageLink } from './EvidenceImage';
import {
  baht, dayTimeOf, DESTINATION_LABEL, parseAmount, timeOf, toSatang, varianceLabel, varianceTone,
  type CashClose, type CashCloseStatusResponse,
} from './cash-close';

/**
 * กล่อง "ปิดยอดวันนี้" (mockup CnXmYLkT กระดาน 7–8) — แสดงเมื่อเลือกสาขาเดียว (ร้านสาขาเดียว = เลือกให้เอง)
 * 1 ยังไม่ปิดยอด → 2 นับแล้วรอยืนยันรับเงิน → 3 ปิดยอดแล้ว · ยอดนับแก้ไม่ได้ (นับผิด = ผู้ยืนยันตีกลับ)
 */
const MIN_REASON = 5;
const inputClass = 'h-12 w-full rounded-lg border border-input bg-background px-3.5 text-right text-lg font-semibold tabular-nums';
const areaClass = 'w-full resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-sm leading-snug';

export const cashCloseKey = (branchId: string, date: string) => ['shop-tenders', 'cash-close', 'status', branchId, date];

export default function CashCloseCard({ branchId, date, isToday }: { branchId: string; date: string; isToday: boolean }) {
  const [counting, setCounting] = useState(false);
  const [deciding, setDeciding] = useState<CashClose | null>(null);
  const query = useQuery<CashCloseStatusResponse>({
    queryKey: cashCloseKey(branchId, date),
    queryFn: async () => (await api.get('/shop-tenders/cash-close/status', { params: { branchId, date } })).data,
  });
  const data = query.data;

  if (query.isLoading) return <div className="h-32 animate-pulse rounded-xl border border-border bg-card" />;
  if (query.isError || !data) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm leading-snug text-destructive">
        โหลดกล่องปิดยอดไม่สำเร็จ: {getErrorMessage(query.error)}{' '}
        <button type="button" className="underline" onClick={() => query.refetch()}>ลองอีกครั้ง</button>
      </div>
    );
  }

  const { round, permissions } = data;
  const awaitingIds = new Set(data.awaitingConfirm.map((c) => c.id));
  const confirmed = data.closes.filter((c) => c.status === 'CONFIRMED');
  const sentBack = data.closes.filter((c) => c.status === 'SENT_BACK');
  const nothingNew = round.movementCount === 0 && round.periodStart !== null;
  const closedToday = data.closes.some((c) => c.status !== 'SENT_BACK');

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5" aria-label="ปิดยอดลิ้นชักสาขา">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold leading-snug">{isToday ? 'ปิดยอดวันนี้' : 'การปิดยอดของวันที่เลือก'} · {data.branchName}</h2>
        <span className="text-xs text-muted-foreground leading-snug">หนึ่งสาขา = หนึ่งลิ้นชัก · ปิดยอดแล้วส่งเงินทั้งหมด เหลือเงินทอนตั้งต้น</span>
      </div>

      {data.awaitingConfirm.map((close) => (
        <CloseSummary key={close.id} close={close} tone="pending">
          {permissions.canConfirm && close.countedBy.id !== permissions.viewerId ? (
            <Button variant="primary" size="md" onClick={() => setDeciding(close)}>ยืนยันรับเงิน</Button>
          ) : permissions.canConfirm ? (
            <span className="text-xs text-muted-foreground leading-snug">คุณเป็นผู้นับ — ต้องให้เจ้าของ ผู้จัดการการเงิน หรือผู้จัดการสาขาคนอื่นเป็นผู้ยืนยัน</span>
          ) : (
            <span className="text-xs text-muted-foreground leading-snug">รอเจ้าของ ผู้จัดการการเงิน หรือผู้จัดการสาขายืนยันรับเงิน</span>
          )}
        </CloseSummary>
      ))}

      {confirmed.filter((c) => !awaitingIds.has(c.id)).map((close) => <CloseSummary key={close.id} close={close} tone="done" />)}

      {sentBack.map((close) => (
        <p key={close.id} className="text-xs text-muted-foreground leading-snug">
          นับครั้งที่ {close.attemptNo} เวลา {timeOf(close.countedAt)} โดย {close.countedBy.name} ({baht(close.countedAmount)}) ถูกตีกลับโดย {close.sentBackBy?.name ?? '-'}: “{close.sentBackReason}”
        </p>
      ))}

      {isToday && (
        <div className="rounded-lg bg-muted/60 p-3 sm:p-4">
          <div className="mb-2 text-sm font-medium leading-snug">{closedToday ? 'รอบใหม่หลังปิดยอด' : 'ยังไม่ปิดยอด'}</div>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm leading-snug">
            <dt className="text-muted-foreground">เงินทอนตั้งต้นของสาขา</dt><dd className="text-right tabular-nums">{baht(round.floatAmount)}</dd>
            <dt className="text-muted-foreground">+ รับเงินสด</dt><dd className="text-right tabular-nums">{baht(round.cashIn)}</dd>
            <dt className="text-muted-foreground">− จ่ายเงินสดออก</dt><dd className="text-right tabular-nums text-destructive">{baht(round.cashOut)}</dd>
            <dt className="border-t border-border pt-1.5 font-semibold">= ต้องมีในลิ้นชักตอนนี้</dt>
            <dd className="border-t border-border pt-1.5 text-right text-lg font-bold tabular-nums">{baht(round.expectedAmount)} ฿</dd>
          </dl>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {permissions.canCount && (
              <Button variant="primary" size="md" disabled={nothingNew} onClick={() => setCounting(true)}>นับเงินปิดยอดวันนี้</Button>
            )}
            <span className="text-xs text-muted-foreground leading-snug">
              {nothingNew ? 'ยังไม่มีรายการเงินสดใหม่ตั้งแต่ปิดยอดครั้งก่อน'
                : `นับตั้งแต่${round.periodStart ? `ปิดยอดครั้งก่อน (${dayTimeOf(round.periodStart)})` : 'เริ่มใช้สมุดเงินหน้าร้าน'} ถึงตอนนี้`}
              {!permissions.canCount && ' · ผู้นับ = พนักงานขายหรือผู้จัดการสาขาของสาขานี้'}
              {round.floatAmount === 0 && ' · ยังไม่ได้ตั้งเงินทอนตั้งต้น (ตั้งได้ที่หน้าจัดการสาขา)'}
            </span>
          </div>
        </div>
      )}

      {!isToday && data.closes.length === 0 && data.awaitingConfirm.length === 0 && (
        <p className="text-sm text-muted-foreground leading-snug">วันที่เลือกไม่มีการปิดยอด</p>
      )}

      {counting && <CountDialog status={data} onClose={() => setCounting(false)} />}
      {deciding && <CashCloseConfirmDialog close={deciding} viewerRole={permissions.viewerRole} onClose={() => setDeciding(null)} />}
    </section>
  );
}

function Figure({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground leading-snug">{label}</div>
      <div className={`text-base font-semibold tabular-nums leading-snug ${className}`}>{value}</div>
    </div>
  );
}

function CloseSummary({ close, tone, children }: { close: CashClose; tone: 'pending' | 'done'; children?: React.ReactNode }) {
  const done = tone === 'done';
  return (
    <div className={`rounded-lg border p-3 sm:p-4 ${done ? 'border-primary/20 bg-primary/5' : 'border-warning/30 bg-warning/5'}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold leading-snug ${done ? 'bg-primary/10 text-primary' : 'bg-warning/10 text-warning'}`}>
          {done ? `ปิดยอดแล้ว ${close.confirmedAt ? timeOf(close.confirmedAt) : ''}` : 'นับแล้ว รอยืนยันรับเงิน'}
        </span>
        {done && (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold leading-snug ${close.moneyState === 'AT_BRANCH' ? 'bg-warning/10 text-warning' : 'bg-primary/10 text-primary'}`}>
            {close.moneyState === 'AT_BRANCH' ? 'เงินยังอยู่ที่สาขา รอบันทึกนำฝาก' : 'เงินถึงบริษัทแล้ว'}
          </span>
        )}
        <span className="text-xs text-muted-foreground leading-snug">
          นับโดย {close.countedBy.name} {dayTimeOf(close.countedAt)}{close.attemptNo > 1 ? ` · นับครั้งที่ ${close.attemptNo}` : ''}
          {done && close.confirmedBy ? ` · รับ ${close.confirmedBy.name}` : ''}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="ต้องมีในลิ้นชัก" value={baht(close.expectedAmount)} />
        <Figure label="นับได้จริง" value={baht(close.countedAmount)} />
        <Figure label="ส่วนต่าง" value={varianceLabel(close.varianceAmount)} className={varianceTone(close.varianceAmount)} />
        {done
          ? <Figure label="รับเงินจริง" value={baht(close.receivedAmount ?? 0)} />
          : <Figure label={`เงินที่ส่ง (เหลือเงินทอน ${baht(close.floatAmount)})`} value={baht(close.sendAmount)} />}
      </div>
      {(close.varianceReason || (done && (close.receiveNote || close.destination))) && (
        <p className="mt-2 text-xs text-muted-foreground leading-snug">
          {close.varianceReason && <>เหตุผลส่วนต่าง: “{close.varianceReason}”</>}
          {done && close.destination && <>{close.varianceReason ? ' · ' : ''}นำเงินไปไว้ที่: {DESTINATION_LABEL[close.destination]}</>}
          {done && close.depositReference && <> · อ้างอิงสลิป {close.depositReference}</>}
          {done && close.hasDepositSlip && <> · <EvidenceImageLink path={`/shop-tenders/cash-close/${close.id}/deposit-slip`} title={`สลิปฝากเงิน ${close.branchName}`} /></>}
          {done && close.receiveVariance != null && toSatang(close.receiveVariance) !== 0 && (
            <span className="text-destructive"> · รับจริงต่างจากยอดที่แจ้งส่ง {varianceLabel(close.receiveVariance)}: “{close.receiveNote}”</span>
          )}
        </p>
      )}
      {children && <div className="mt-3 flex flex-wrap items-center gap-3">{children}</div>}
    </div>
  );
}

function CountDialog({ status, onClose }: { status: CashCloseStatusResponse; onClose: () => void }) {
  const { round } = status;
  const invalidate = useInvalidateCashClose();
  const [countedText, setCountedText] = useState('');
  const [reason, setReason] = useState('');
  const counted = parseAmount(countedText);
  const variance = counted == null ? null : (toSatang(counted) - toSatang(round.expectedAmount)) / 100;
  const needsReason = variance != null && toSatang(variance) !== 0;
  const send = counted == null ? null : Math.max(toSatang(counted) - toSatang(round.floatAmount), 0) / 100;
  const ready = counted != null && (!needsReason || reason.trim().length >= MIN_REASON);

  const mutation = useMutation({
    mutationFn: async () => (await api.post('/shop-tenders/cash-close', {
      branchId: status.branchId, countedAmount: counted, varianceReason: needsReason ? reason.trim() : undefined,
    })).data as CashClose,
    onSuccess: (close) => {
      toast.success(`บันทึกยอดนับแล้ว — ${varianceLabel(close.varianceAmount)} · ส่งเงิน ${baht(close.sendAmount)}`);
      invalidate(); onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && !mutation.isPending && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>นับเงินปิดยอด</DialogTitle>
          <DialogDescription>{status.branchName} · ผู้นับ = คุณ (ผู้ที่ล็อกอินอยู่)</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 rounded-lg bg-muted/60 p-3 text-sm leading-snug">
          <dt className="text-muted-foreground">เงินทอนตั้งต้น</dt><dd className="text-right tabular-nums">{baht(round.floatAmount)}</dd>
          <dt className="text-muted-foreground">+ รับเงินสดตั้งแต่ปิดยอดครั้งก่อน</dt><dd className="text-right tabular-nums">{baht(round.cashIn)}</dd>
          <dt className="text-muted-foreground">− จ่ายเงินสดออก</dt><dd className="text-right tabular-nums text-destructive">{baht(round.cashOut)}</dd>
          <dt className="border-t border-border pt-1.5 font-semibold">ต้องมีในลิ้นชัก</dt>
          <dd className="border-t border-border pt-1.5 text-right font-bold tabular-nums">{baht(round.expectedAmount)}</dd>
        </dl>
        <div className="space-y-1">
          <label htmlFor="cash-close-counted" className="block text-xs text-muted-foreground leading-snug">เงินสดที่นับได้จริงในลิ้นชัก <span className="text-destructive">*</span></label>
          <input id="cash-close-counted" inputMode="decimal" autoFocus value={countedText} onChange={(e) => setCountedText(e.target.value)}
            placeholder="0.00" className={inputClass} />
          {countedText.trim() !== '' && counted == null && <p className="text-xs text-destructive leading-snug">กรอกเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง</p>}
        </div>
        {variance != null && (
          <div role="status" className={`flex items-center justify-between rounded-lg border px-3.5 py-3 ${needsReason ? 'border-destructive/30 bg-destructive/5' : 'border-primary/20 bg-primary/5'}`}>
            <span className="text-sm font-semibold leading-snug">ส่วนต่าง</span>
            <span className={`text-lg font-bold tabular-nums ${varianceTone(variance)}`}>{varianceLabel(variance)}</span>
          </div>
        )}
        {needsReason && (
          <div className="space-y-1">
            <label htmlFor="cash-close-reason" className="block text-xs text-muted-foreground leading-snug">เหตุผลของส่วนต่าง <span className="text-destructive">*</span> (บังคับเมื่อยอดไม่ตรง)</label>
            <textarea id="cash-close-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className={areaClass} />
          </div>
        )}
        {send != null && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-3.5 py-3 text-sm leading-snug">
            <div><span className="font-semibold">ส่งเงิน {baht(send)}</span> ให้ผู้จัดการหรือเจ้าของ</div>
            <div className="text-xs text-muted-foreground">เหลือเงินทอนตั้งต้นในลิ้นชัก {baht(Math.min(counted ?? 0, round.floatAmount))} สำหรับวันถัดไป</div>
          </div>
        )}
        <p className="text-xs text-muted-foreground leading-snug">บันทึกแล้วแก้ยอดนับไม่ได้ ถ้านับผิดให้ผู้ยืนยันกด “ตีกลับให้นับใหม่” (ระบบเก็บประวัติทุกครั้ง)</p>
        <DialogFooter>
          <Button variant="outline" size="md" disabled={mutation.isPending} onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" size="md" disabled={!ready || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'กำลังบันทึก…' : 'บันทึกยอดนับ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
