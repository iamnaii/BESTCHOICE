import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CashAccountSelect, SHOP_CASH_ACCOUNT_CODES } from '@/components/CashAccountSelect';
import { fmtMoney, type RecallCandidate } from './types';

/**
 * รับเงินสดคืนจากหน้าร้าน (Flow C-2 — Phase 3 Task 7, spec §5.4 ทางเลือกที่สอง
 * นอกจากหักกลบรอบจ่าย): `POST /interco-settlement/recalls/:contractId/settle-cash`.
 *
 * - ยอด default = ยอดเรียกคืนสุทธิคงเหลือ (recallGl) — แก้ได้ แต่ห้ามเกิน net
 *   (server re-check เดียวกัน ±0.01)
 * - `requestId` = crypto.randomUUID() ต่อการเปิด dialog หนึ่งครั้ง — คงที่ระหว่าง
 *   retry (กัน double-post; server idempotency จับ requestId เดิม + ยอดเดิม)
 * - บัญชีรับเงิน FINANCE จาก CASH_ACCOUNT_CODES (default 11-1201 KBank);
 *   บัญชีจ่ายฝั่ง SHOP optional (default S11-1201 ตาม service)
 */

interface RecallCashDialogProps {
  /** แถว recall ที่จะรับเงินสดคืน — null = ปิด dialog */
  recall: RecallCandidate | null;
  onClose: () => void;
}

const DEFAULT_FINANCE_ACCOUNT = '11-1201';
const DEFAULT_SHOP_ACCOUNT = 'S11-1201';

export function RecallCashDialog({ recall, onClose }: RecallCashDialogProps) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [financeAccount, setFinanceAccount] = useState(DEFAULT_FINANCE_ACCOUNT);
  const [shopAccount, setShopAccount] = useState(DEFAULT_SHOP_ACCOUNT);
  const [requestId, setRequestId] = useState('');

  // Reset ต่อการเปิดหนึ่งครั้ง — `recall` เป็น object ที่ parent จับไว้ใน state
  // (identity คงที่แม้ pending query refetch) ⇒ requestId ไม่ถูก regenerate
  // ระหว่าง retry บนหน้าต่างเดิม
  useEffect(() => {
    if (recall) {
      setAmount(recall.recallGl);
      setFinanceAccount(DEFAULT_FINANCE_ACCOUNT);
      setShopAccount(DEFAULT_SHOP_ACCOUNT);
      setRequestId(crypto.randomUUID());
    }
  }, [recall]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!recall) return null;
      return (
        await api.post(`/interco-settlement/recalls/${recall.contractId}/settle-cash`, {
          amount: Number(amount),
          financeDepositAccountCode: financeAccount,
          shopPayoutAccountCode: shopAccount,
          requestId,
        })
      ).data as { financeEntryNo: string; shopEntryNo: string; deduped: boolean };
    },
    onSuccess: (data) => {
      toast.success(
        data?.deduped
          ? 'รายการนี้ถูกบันทึกไปก่อนหน้าแล้ว (ไม่บันทึกซ้ำ)'
          : `รับเงินสดคืนสำเร็จ — ใบสำคัญ ${data?.financeEntryNo ?? ''} / ${data?.shopEntryNo ?? ''}`,
      );
      queryClient.invalidateQueries({ queryKey: ['interco-pending'] });
      queryClient.invalidateQueries({ queryKey: ['interco-aging'] });
      onClose();
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'เกิดข้อผิดพลาด กรุณาลองใหม่';
      toast.error(msg);
    },
  });

  const netNum = Number(recall?.recallGl ?? 0);
  const amountNum = Number(amount);
  const amountInvalid = amount.trim() === '' || Number.isNaN(amountNum) || amountNum <= 0;
  const amountExceeds = !amountInvalid && amountNum > netNum + 0.01;
  const canSubmit = !!recall && !amountInvalid && !amountExceeds && !mutation.isPending;

  return (
    <Dialog open={!!recall} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>รับเงินสดคืนจากหน้าร้าน</DialogTitle>
          <DialogDescription className="leading-snug">
            สัญญา <span className="font-semibold">{recall?.contractNumber ?? ''}</span> — ล้างยอด
            เรียกคืนด้วยเงินสด (FINANCE: Dr เงินสด/ธนาคาร / Cr 11-2107 · SHOP: Dr S21-3001 / Cr
            เงินสด/ธนาคาร) ยอดคงเหลือสุทธิ{' '}
            <span className="font-semibold tabular-nums">฿{fmtMoney(recall?.recallGl)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="recall-cash-amount">ยอดรับเงินคืน (฿)</Label>
            <Input
              id="recall-cash-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {amountExceeds && (
              <p className="text-xs text-destructive leading-snug">
                ยอดรับเงินคืนเกินยอดเรียกคืนคงเหลือ ฿{fmtMoney(recall?.recallGl)} ไม่อนุญาต
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>บัญชีรับเงินฝั่ง FINANCE</Label>
            <CashAccountSelect
              value={financeAccount}
              onChange={setFinanceAccount}
              placeholder="เลือกบัญชีรับเงิน"
            />
          </div>

          <div className="space-y-1.5">
            <Label>
              บัญชีจ่ายเงินฝั่ง SHOP{' '}
              <span className="font-normal text-muted-foreground">(ค่าเริ่มต้น S11-1201)</span>
            </Label>
            <CashAccountSelect
              value={shopAccount}
              onChange={setShopAccount}
              placeholder="เลือกบัญชีจ่ายเงิน"
              codes={SHOP_CASH_ACCOUNT_CODES}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            ยกเลิก
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSubmit}>
            {mutation.isPending ? 'กำลังบันทึก...' : 'บันทึกรับเงินคืน'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
