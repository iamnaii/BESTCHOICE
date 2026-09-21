import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import CashCloseConfirmDialog, { useInvalidateCashClose } from './CashCloseConfirmDialog';
import CashDepositDialog from './CashDepositDialog';
import CashStatusHero from './CashStatusHero';
import {
  baht, parseAmount, toSatang, varianceLabel, varianceTone,
  type CashClose, type CashCloseStatusResponse, type CashHolding,
} from './cash-close';

/**
 * กล่องปิดยอดของสาขา = ตัวโหลดข้อมูล + หน้าต่าง · หน้าตาอยู่ที่ `CashStatusHero` (mockup CnXmYLkT กระดาน 7–8 → 12–14 → 15–16) — แสดงเมื่อเลือกสาขาเดียว (ร้านสาขาเดียว = เลือกให้เอง)
 * ปุ่ม "ส่งยอดรายวัน" → หน้าต่างบันทึก → ผู้รับกด "ยืนยันรับเงิน" → เงินถึงบริษัท · ยอดที่ส่งแล้วแก้ไม่ได้ (นับผิด = ผู้ยืนยันตีกลับ)
 */
const MIN_REASON = 5;
const inputClass = 'h-12 w-full rounded-lg border border-input bg-background px-3.5 text-right text-lg font-semibold tabular-nums';
const areaClass = 'w-full resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-sm leading-snug';

export const cashCloseKey = (branchId: string, date: string) => ['shop-tenders', 'cash-close', 'status', branchId, date];

export default function CashCloseCard({ branchId, date, isToday }: { branchId: string; date: string; isToday: boolean }) {
  const [counting, setCounting] = useState(false);
  const [deciding, setDeciding] = useState<CashClose | null>(null);
  const [depositing, setDepositing] = useState<CashHolding | null>(null);
  const query = useQuery<CashCloseStatusResponse>({
    queryKey: cashCloseKey(branchId, date),
    queryFn: async () => (await api.get('/shop-tenders/cash-close/status', { params: { branchId, date } })).data,
    // ยอดเงินสดต้องสดเสมอ: ขายเงินสด/ตั้งค่าสาขาแล้วกลับมาหน้านี้ ต้องไม่เห็นของเก่าจาก cache 3 นาทีของแอป
    staleTime: 0, refetchOnMount: 'always',
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

  return (
    <>
      <CashStatusHero status={data} date={date} isToday={isToday} onSend={() => setCounting(true)} onConfirm={setDeciding} onDeposit={setDepositing} />
      {counting && <CountDialog status={data} onClose={() => setCounting(false)} />}
      {deciding && <CashCloseConfirmDialog close={deciding} viewerRole={data.permissions.viewerRole} onClose={() => setDeciding(null)} />}
      {depositing && <CashDepositDialog holding={depositing} onClose={() => setDepositing(null)} />}
    </>
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
      toast.success(`บันทึกส่งยอดแล้ว — ยอดที่ส่ง ${baht(close.sendAmount)} · ${varianceLabel(close.varianceAmount)}`);
      invalidate(); onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && !mutation.isPending && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ส่งยอดรายวัน</DialogTitle>
          <DialogDescription>{status.branchName} · ผู้ส่งยอด = คุณ (ผู้ที่ล็อกอินอยู่)</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 rounded-lg bg-muted/60 p-3 text-sm leading-snug">
          <dt className="text-muted-foreground">เงินทอนตั้งต้น</dt><dd className="text-right tabular-nums">{baht(round.floatAmount)}</dd>
          <dt className="text-muted-foreground">+ รับเงินสดตั้งแต่ส่งยอดครั้งก่อน</dt><dd className="text-right tabular-nums">{baht(round.cashIn)}</dd>
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
            <div className="text-[13px] text-muted-foreground">ยอดที่ส่งวันนี้</div>
            <div className="text-2xl font-bold tabular-nums text-primary">{baht(send)} ฿</div>
            <div className="text-xs text-muted-foreground">ส่งให้ผู้จัดการหรือเจ้าของ · เหลือเงินทอนตั้งต้นในลิ้นชัก {baht(Math.min(counted ?? 0, round.floatAmount))} สำหรับวันถัดไป</div>
          </div>
        )}
        <p className="text-xs text-muted-foreground leading-snug">บันทึกแล้วแก้ยอดไม่ได้ ถ้านับผิดให้ผู้ยืนยันกด “ตีกลับให้นับใหม่” (ระบบเก็บประวัติทุกครั้ง)</p>
        <DialogFooter>
          <Button variant="outline" size="md" disabled={mutation.isPending} onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" size="md" disabled={!ready || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'กำลังบันทึก…' : 'บันทึกส่งยอด'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
