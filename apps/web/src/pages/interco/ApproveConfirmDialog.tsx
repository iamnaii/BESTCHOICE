import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatThaiDateShort, toLocalDateString } from '@/lib/date';
import { fmtMoney, isClosedPeriodError, netAmountOf, type BatchDetail } from './types';

/**
 * เมนู "จ่ายให้หน้าร้าน (INTER-CO)" — ยืนยันอนุมัติ พร้อม preview JE 2 ฝั่ง
 * คำนวณฝั่ง client จาก items ของรอบ (สูตรเดียวกับ `IntercoSettlementService`
 * §5 — SHOP รวมเฉพาะ item ที่ `legacyNoShop=false`).
 *
 * D4 (spec §7): เมื่อ approve ชน "งวดปิด" (BadRequestException จาก
 * `guardPeriodOpen`) เปลี่ยนหน้าเป็นฟอร์มเลือก `postedAt` แล้วลองใหม่ แทนที่
 * จะโชว์แค่ toast error เฉยๆ.
 */

interface ApproveConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batch: BatchDetail;
  onApproved: () => void;
}

interface PreviewLine {
  label: string;
  amount: number;
}

export function ApproveConfirmDialog({
  open,
  onOpenChange,
  batch,
  onApproved,
}: ApproveConfirmDialogProps) {
  const [closedPeriodMessage, setClosedPeriodMessage] = useState<string | null>(null);
  const [postedAtOverride, setPostedAtOverride] = useState(toLocalDateString());

  useEffect(() => {
    if (open) {
      setClosedPeriodMessage(null);
      setPostedAtOverride(toLocalDateString());
    }
  }, [open]);

  const approveMutation = useMutation({
    mutationFn: async (postedAt?: string) =>
      api.post(`/interco-settlement/batches/${batch.id}/approve`, postedAt ? { postedAt } : {}),
    onSuccess: () => {
      toast.success('อนุมัติรอบจ่ายเรียบร้อย');
      onOpenChange(false);
      onApproved();
    },
    onError: (err) => {
      const msg = getErrorMessage(err);
      if (isClosedPeriodError(msg)) {
        setClosedPeriodMessage(msg);
      } else {
        toast.error(msg);
      }
    },
  });

  // Mirror `buildFinanceLines`/`buildShopLines` (Phase 2 หักกลบ): RECALL rows
  // contribute ONLY the 11-2107/S21-3001 legs; settlement legs skip them.
  // item รอบเก่าไม่มี itemType ใน fixture เก่า — `!== 'RECALL'` = SETTLEMENT
  // (นิยามเดียวกับ server).
  const settlementItems = batch.items.filter((i) => i.itemType !== 'RECALL');
  const recallItems = batch.items.filter((i) => i.itemType === 'RECALL');
  const nonLegacyItems = settlementItems.filter((i) => !i.legacyNoShop);
  const legacyItems = settlementItems.filter((i) => i.legacyNoShop);
  const financedTotal = settlementItems.reduce((s, i) => s + Number(i.financedGl), 0);
  const commissionTotal = settlementItems.reduce((s, i) => s + Number(i.commissionGl), 0);
  const shopFinancedTotal = nonLegacyItems.reduce((s, i) => s + Number(i.shopFinancedGl), 0);
  const shopCommissionTotal = nonLegacyItems.reduce((s, i) => s + Number(i.shopCommissionGl), 0);
  const swapCreditTotal = settlementItems.reduce((s, i) => s + Number(i.swapCreditAmount ?? 0), 0);
  const recallTotal = recallItems.reduce((s, i) => s + Number(i.recallAmount ?? 0), 0);
  const totalDeduction = swapCreditTotal + recallTotal;
  // รอบก่อน Phase 2 (netTransferAmount = null) → เงินโอน = ยอดเต็ม (netAmountOf)
  const netCash = Number(netAmountOf(batch));
  const shopNetCash = Number(batch.shopNetAmount ?? batch.shopPostedAmount);

  const financeLines: PreviewLine[] = [
    {
      label: `Dr 21-1101 ล้างเจ้าหนี้ยอดจัด (${settlementItems.length} สัญญา)`,
      amount: financedTotal,
    },
    ...(commissionTotal > 0
      ? [{ label: 'Dr 21-1102 ล้างเจ้าหนี้ค่าคอม', amount: commissionTotal }]
      : []),
    ...(swapCreditTotal > 0
      ? [{ label: 'Cr 11-2107 หักเครดิตเปลี่ยนเครื่อง', amount: swapCreditTotal }]
      : []),
    ...(recallTotal > 0
      ? [
          {
            label: `Cr 11-2107 หักเรียกคืนจากยกเลิก (${recallItems.length} สัญญา)`,
            amount: recallTotal,
          },
        ]
      : []),
    // รอบที่หักจนเงินโอนจริงเป็นศูนย์ — server ไม่ออกบรรทัดธนาคารเลย
    ...(netCash > 0
      ? [{ label: `Cr ${batch.financeBankCode} จ่ายให้หน้าร้าน (สุทธิ)`, amount: netCash }]
      : []),
  ];

  const shopLines: PreviewLine[] = [
    ...(shopNetCash > 0
      ? [{ label: `Dr ${batch.shopBankCode} รับโอนจาก FINANCE (สุทธิ)`, amount: shopNetCash }]
      : []),
    ...(totalDeduction > 0
      ? [{ label: 'Dr S21-3001 ล้างเจ้าหนี้ FINANCE (หักกลบ)', amount: totalDeduction }]
      : []),
    ...(nonLegacyItems.length > 0
      ? [
          {
            label: `Cr S11-3001 ล้างลูกหนี้ยอดจัด (${nonLegacyItems.length} สัญญา)`,
            amount: shopFinancedTotal,
          },
        ]
      : []),
    ...(shopCommissionTotal > 0
      ? [{ label: 'Cr S11-3002 ล้างลูกหนี้ค่าคอม', amount: shopCommissionTotal }]
      : []),
  ];

  // SHOP half มีเมื่อมี settlement ที่ไม่ legacy หรือมีขาหัก (นิยามเดียวกับ buildShopLines)
  const hasShopHalf = nonLegacyItems.length > 0 || totalDeduction > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !approveMutation.isPending && onOpenChange(v)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>ยืนยันอนุมัติรอบจ่าย {batch.batchNumber}</DialogTitle>
          <DialogDescription className="leading-snug">
            ระบบจะสร้าง Journal Entry 2 ฝั่งพร้อมกัน (atomic ผ่าน PairedJournalService)
          </DialogDescription>
        </DialogHeader>

        {closedPeriodMessage ? (
          <div className="space-y-4">
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive leading-snug">
              {closedPeriodMessage}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ic-postedAt-override">วันที่ลงบัญชี (เลือกเดือนที่ยังเปิดอยู่)</Label>
              <Input
                id="ic-postedAt-override"
                type="date"
                value={postedAtOverride}
                onChange={(e) => setPostedAtOverride(e.target.value)}
              />
              <p className="text-xs text-muted-foreground leading-snug">
                วันโอนจริง ({formatThaiDateShort(batch.transferDate)}) จะถูกบันทึกไว้ในรายละเอียด JE
                เสมอ (D4 — ลงเดือนที่เปิด + จดวันโอนจริงในหมายเหตุ)
              </p>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={approveMutation.isPending}
              >
                ยกเลิก
              </Button>
              <Button
                onClick={() => approveMutation.mutate(postedAtOverride)}
                disabled={approveMutation.isPending}
              >
                {approveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                ลองอนุมัติอีกครั้ง
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm space-y-1">
              <div className="flex items-center justify-between leading-snug">
                <span className="text-muted-foreground">ยอดเจ้าหนี้รวม</span>
                <span className="tabular-nums">฿{fmtMoney(batch.totalAmount)}</span>
              </div>
              {/* รอบก่อน Phase 2 (null) — ไม่มี snapshot หัก ไม่โชว์บรรทัดหัก */}
              {batch.netTransferAmount !== null && (
                <div className="flex items-center justify-between leading-snug">
                  <span className="text-muted-foreground">
                    หักรวม (เครดิตเปลี่ยนเครื่อง + เรียกคืน)
                  </span>
                  <span className="tabular-nums text-warning">
                    −฿{fmtMoney(batch.totalDeduction)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-border pt-1 leading-snug">
                <span className="font-semibold">ยอดโอนสุทธิ</span>
                <span className="tabular-nums font-bold">฿{fmtMoney(netAmountOf(batch))}</span>
              </div>
            </div>

            <JournalPreviewBlock title="FINANCE" lines={financeLines} />

            {hasShopHalf ? (
              <JournalPreviewBlock title="SHOP" lines={shopLines} />
            ) : (
              <p className="text-sm text-muted-foreground leading-snug rounded-md border border-border bg-muted p-3">
                ไม่มีการลงบัญชีฝั่ง SHOP — ทุกสัญญาในรอบนี้เป็น LEGACY (SHOP ไม่มียอดตั้งต้น)
              </p>
            )}

            {legacyItems.length > 0 && nonLegacyItems.length > 0 && (
              <p className="text-xs text-warning leading-snug">
                ฝั่ง SHOP ไม่รวม {legacyItems.length} สัญญา (legacy)
              </p>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={approveMutation.isPending}
              >
                ยกเลิก
              </Button>
              <Button
                onClick={() => approveMutation.mutate(undefined)}
                disabled={approveMutation.isPending}
              >
                {approveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                ยืนยันอนุมัติ
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function JournalPreviewBlock({ title, lines }: { title: string; lines: PreviewLine[] }) {
  return (
    <div className="rounded-md border border-border overflow-hidden">
      <div className="bg-muted px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground leading-snug">
        {title}
      </div>
      <table className="w-full text-sm">
        <tbody>
          {lines.map((l) => (
            <tr key={l.label} className="border-t border-border/60">
              <td className="px-3 py-1.5 leading-snug">{l.label}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
