import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EvidenceImageInput } from './EvidenceImage';
import {
  baht, dayTimeOf, DESTINATION_LABEL, MIN_DEPOSIT_REFERENCE, parseAmount, toSatang, varianceLabel, varianceTone,
  type CashClose, type CashDestination,
} from './cash-close';

/**
 * กล่องยืนยันรับเงิน / ตีกลับ (mockup CnXmYLkT กระดาน 8 + 11 ส่วน A) — ใช้ร่วมกันทั้งกล่องปิดยอดของสาขาและตารางสถานะทุกสาขา.
 * ปลายทางเงินเป็นตัวตัดสินว่าเงิน "ถึงบริษัทแล้ว" หรือยัง จึงต้องเลือกเอง (ไม่มีค่าตั้งต้น) และนำฝากธนาคารต้องมีรูปสลิป + เลขอ้างอิง
 */
const MIN_REASON = 5;
const inputClass = 'h-12 w-full rounded-lg border border-input bg-background px-3.5 text-right text-lg font-semibold tabular-nums';
const areaClass = 'w-full resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-sm leading-snug';

const DESTINATIONS: { key: CashDestination; hint: string }[] = [
  { key: 'BANK_DEPOSIT', hint: 'ต้องแนบรูปสลิปฝากเงิน — นับว่าถึงบริษัทแล้ว' },
  { key: 'OWNER_HOLD', hint: 'เลือกได้เมื่อเจ้าของเป็นผู้กดยืนยันเอง — นับว่าถึงบริษัทแล้ว' },
  { key: 'BRANCH_SAFE', hint: 'เงินยังอยู่ที่สาขา — ขึ้นรายการ “ยังไม่ถึงบริษัท” จนกว่าจะบันทึกนำฝาก' },
];

/** ทุกหน้าจอที่อ่านข้อมูลปิดยอดต้องรีเฟรชหลังยืนยัน/ตีกลับ/นำฝาก — key ขึ้นต้นเดียวกันทั้งหมด */
export function useInvalidateCashClose() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ['shop-tenders', 'cash-close'] });
}

export default function CashCloseConfirmDialog({ close, viewerRole, onClose }: { close: CashClose; viewerRole?: string; onClose: () => void }) {
  const invalidate = useInvalidateCashClose();
  const [receivedText, setReceivedText] = useState(baht(close.sendAmount));
  const [destination, setDestination] = useState<CashDestination | null>(null);
  const [note, setNote] = useState('');
  const [slip, setSlip] = useState<File | null>(null);
  const [reference, setReference] = useState('');
  const [sendingBack, setSendingBack] = useState(false);
  const [backReason, setBackReason] = useState('');
  const received = parseAmount(receivedText);
  const differs = received != null && toSatang(received) !== toSatang(close.sendAmount);
  // ไม่มีเงินรับจริง (นับได้ไม่เกินเงินทอนตั้งต้น) = ไม่มีอะไรให้ฝาก จึงไม่ต้องมีสลิป
  const needsSlip = destination === 'BANK_DEPOSIT' && received != null && toSatang(received) > 0;
  const slipReady = !needsSlip || (!!slip && reference.trim().length >= MIN_DEPOSIT_REFERENCE);
  const confirmReady = received != null && !!destination && (!differs || note.trim().length >= MIN_REASON) && slipReady;

  const done = (message: string) => { toast.success(message); invalidate(); onClose(); };
  const confirm = useMutation({
    mutationFn: async () => {
      if (needsSlip && slip) {
        const form = new FormData();
        form.append('file', slip);
        await api.post(`/shop-tenders/cash-close/${close.id}/deposit-slip`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      return (await api.post(`/shop-tenders/cash-close/${close.id}/confirm`, {
        receivedAmount: received, destination, note: note.trim() || undefined,
        depositReference: needsSlip ? reference.trim() : undefined })).data;
    },
    onSuccess: () => done(destination === 'BRANCH_SAFE' ? 'ยืนยันรับเงินแล้ว — เงินยังอยู่ที่สาขาจนกว่าจะบันทึกนำฝาก' : 'ยืนยันรับเงินและปิดยอดแล้ว'),
    onError: (err) => toast.error(getErrorMessage(err)),
  });
  const sendBack = useMutation({
    mutationFn: async () => (await api.post(`/shop-tenders/cash-close/${close.id}/send-back`, { reason: backReason.trim() })).data,
    onSuccess: () => done('ตีกลับให้นับใหม่แล้ว'),
    onError: (err) => toast.error(getErrorMessage(err)),
  });
  const busy = confirm.isPending || sendBack.isPending;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{sendingBack ? 'ตีกลับให้นับใหม่' : 'ยืนยันรับเงิน'}</DialogTitle>
          <DialogDescription>{close.branchName} · นับโดย {close.countedBy.name} {dayTimeOf(close.countedAt)}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 rounded-lg bg-muted/60 p-3 text-sm leading-snug">
          <dt className="text-muted-foreground">ต้องมีในลิ้นชัก</dt><dd className="text-right tabular-nums">{baht(close.expectedAmount)}</dd>
          <dt className="text-muted-foreground">พนักงานนับได้</dt><dd className="text-right tabular-nums">{baht(close.countedAmount)}</dd>
          <dt className={`font-semibold ${varianceTone(close.varianceAmount)}`}>ส่วนต่าง</dt>
          <dd className={`text-right font-semibold tabular-nums ${varianceTone(close.varianceAmount)}`}>{varianceLabel(close.varianceAmount)}</dd>
          {close.varianceReason && <dd className="col-span-2 text-xs text-muted-foreground">เหตุผล: {close.varianceReason}</dd>}
        </dl>

        {sendingBack ? (
          <div className="space-y-1">
            <label htmlFor="cash-close-back-reason" className="block text-xs text-muted-foreground leading-snug">เหตุผลที่ตีกลับ <span className="text-destructive">*</span></label>
            <textarea id="cash-close-back-reason" rows={2} maxLength={500} autoFocus value={backReason} onChange={(e) => setBackReason(e.target.value)} className={areaClass} />
            <p className="text-xs text-muted-foreground leading-snug">ยอดนับครั้งนี้จะถูกเก็บเป็นประวัติ และพนักงานต้องนับใหม่ทั้งรอบ</p>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <label htmlFor="cash-close-received" className="block text-xs text-muted-foreground leading-snug">
                เงินที่รับมาจริง <span className="text-destructive">*</span> (พนักงานแจ้งส่ง {baht(close.sendAmount)})
              </label>
              <input id="cash-close-received" inputMode="decimal" value={receivedText} onChange={(e) => setReceivedText(e.target.value)} className={inputClass} />
              {receivedText.trim() !== '' && received == null && <p className="text-xs text-destructive leading-snug">กรอกเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง</p>}
            </div>
            {differs && (
              <div className="space-y-1">
                <label htmlFor="cash-close-note" className="block text-xs text-destructive leading-snug">
                  รับจริงไม่เท่ายอดที่แจ้งส่ง ({varianceLabel((toSatang(received!) - toSatang(close.sendAmount)) / 100)}) — หมายเหตุ <span>*</span>
                </label>
                <textarea id="cash-close-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={areaClass} />
              </div>
            )}

            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs text-muted-foreground leading-snug">นำเงินไปไว้ที่ <span className="text-destructive">*</span></legend>
              {DESTINATIONS.map(({ key, hint }) => {
                const locked = key === 'OWNER_HOLD' && viewerRole !== 'OWNER';
                const selected = destination === key;
                return (
                  <label key={key} className={`flex items-start gap-2.5 rounded-lg border p-3 leading-snug ${locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${selected ? 'border-primary bg-primary/5' : 'border-border'}`}>
                    <input type="radio" name="cash-close-destination" value={key} checked={selected} disabled={locked}
                      onChange={() => setDestination(key)} className="mt-0.5 h-[18px] w-[18px] accent-primary" />
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm font-semibold">{DESTINATION_LABEL[key]}</span>
                      <span className="text-xs text-muted-foreground">{hint}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>

            {needsSlip && (
              <>
                <EvidenceImageInput label="รูปสลิปฝากเงิน" file={slip} onChange={setSlip} />
                <div className="space-y-1">
                  <label htmlFor="cash-close-deposit-ref" className="block text-xs text-muted-foreground leading-snug">เลขอ้างอิงในสลิป <span className="text-destructive">*</span></label>
                  <input id="cash-close-deposit-ref" value={reference} maxLength={128} onChange={(e) => setReference(e.target.value)}
                    placeholder={`อย่างน้อย ${MIN_DEPOSIT_REFERENCE} ตัว`} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" />
                </div>
              </>
            )}
          </>
        )}

        <DialogFooter className="sm:justify-between">
          {sendingBack ? (
            <>
              <Button variant="outline" size="md" disabled={busy} onClick={() => setSendingBack(false)}>กลับ</Button>
              <Button variant="destructive" size="md" disabled={backReason.trim().length < MIN_REASON || busy} onClick={() => sendBack.mutate()}>
                {sendBack.isPending ? 'กำลังบันทึก…' : 'ยืนยันตีกลับ'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="md" className="text-destructive" disabled={busy} onClick={() => setSendingBack(true)}>ตีกลับให้นับใหม่</Button>
              <Button variant="primary" size="md" disabled={!confirmReady || busy} onClick={() => confirm.mutate()}>
                {confirm.isPending ? 'กำลังบันทึก…' : 'ยืนยันรับเงินและปิดยอด'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
