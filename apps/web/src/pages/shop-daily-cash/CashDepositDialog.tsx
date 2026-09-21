import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EvidenceImageInput } from './EvidenceImage';
import { useInvalidateCashClose } from './CashCloseConfirmDialog';
import { baht, MIN_DEPOSIT_REFERENCE, parseAmount, thaiShortDate, toSatang, type CashHolding } from './cash-close';

/** บันทึกนำฝาก (mockup CnXmYLkT กระดาน 11 ส่วน B) — ย้ายเงินในตู้เซฟสาขา/เงินที่เจ้าของเก็บ เข้าบัญชีธนาคารของร้าน · ฝากบางส่วนได้ */
const bkkDate = (iso: string) => new Date(new Date(iso).getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

export default function CashDepositDialog({ holding, onClose }: { holding: CashHolding; onClose: () => void }) {
  const invalidate = useInvalidateCashClose();
  const [amountText, setAmountText] = useState(baht(holding.outstanding));
  const [reference, setReference] = useState('');
  const [slip, setSlip] = useState<File | null>(null);
  const amount = parseAmount(amountText);
  const over = amount != null && toSatang(amount) > toSatang(holding.outstanding);
  const ready = amount != null && toSatang(amount) > 0 && !over && !!slip && reference.trim().length >= MIN_DEPOSIT_REFERENCE;

  const mutation = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append('branchId', holding.branchId);
      form.append('source', holding.source);
      form.append('amount', (toSatang(amount!) / 100).toFixed(2));
      form.append('reference', reference.trim());
      form.append('file', slip!);
      return (await api.post('/shop-tenders/cash-deposits', form, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
    },
    onSuccess: () => { toast.success(`บันทึกนำฝาก ${baht(amount!)} ฿ แล้ว`); invalidate(); onClose(); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && !mutation.isPending && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>บันทึกนำฝากเข้าบัญชีร้าน</DialogTitle>
          <DialogDescription>{holding.branchName} · {holding.source === 'BRANCH_SAFE' ? 'เงินในตู้เซฟสาขา' : 'เงินที่เจ้าของเก็บไว้'}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 rounded-lg bg-muted/60 p-3 text-sm leading-snug">
          {holding.openCloses.slice(0, 6).map((row) => (
            <div key={row.id} className="contents">
              <dt className="text-muted-foreground">รับเงินปิดยอด {thaiShortDate(bkkDate(row.confirmedAt))}</dt>
              <dd className="text-right tabular-nums">{baht(row.outstanding)}</dd>
            </div>
          ))}
          {holding.openCloses.length > 6 && <dt className="col-span-2 text-xs text-muted-foreground">และอีก {holding.openCloses.length - 6} ครั้ง</dt>}
          <dt className="border-t border-border pt-1.5 font-semibold">ยังไม่ได้นำฝาก</dt>
          <dd className="border-t border-border pt-1.5 text-right font-bold tabular-nums">{baht(holding.outstanding)}</dd>
        </dl>
        <div className="space-y-1">
          <label htmlFor="cash-deposit-amount" className="block text-xs text-muted-foreground leading-snug">ยอดที่นำฝากครั้งนี้ <span className="text-destructive">*</span></label>
          <input id="cash-deposit-amount" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)}
            className="h-12 w-full rounded-lg border border-input bg-background px-3.5 text-right text-lg font-semibold tabular-nums" />
          {amountText.trim() !== '' && amount == null && <p className="text-xs text-destructive leading-snug">กรอกเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง</p>}
          {over && <p className="text-xs text-destructive leading-snug">ยอดนำฝากเกินเงินที่ยังไม่ได้นำฝาก ({baht(holding.outstanding)})</p>}
          <p className="text-xs text-muted-foreground leading-snug">ฝากบางส่วนได้ ส่วนที่เหลือยังค้างในรายการต่อ · ระบบลงบัญชีย้ายเงินเข้าธนาคารของร้านให้เอง</p>
        </div>
        <EvidenceImageInput label="รูปสลิปฝากเงิน" file={slip} onChange={setSlip} />
        <div className="space-y-1">
          <label htmlFor="cash-deposit-ref" className="block text-xs text-muted-foreground leading-snug">เลขอ้างอิงในสลิป <span className="text-destructive">*</span></label>
          <input id="cash-deposit-ref" value={reference} maxLength={128} onChange={(e) => setReference(e.target.value)}
            placeholder={`อย่างน้อย ${MIN_DEPOSIT_REFERENCE} ตัว`} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" />
        </div>
        <DialogFooter>
          <Button variant="outline" size="md" disabled={mutation.isPending} onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" size="md" disabled={!ready || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'กำลังบันทึก…' : 'บันทึกนำฝาก'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
