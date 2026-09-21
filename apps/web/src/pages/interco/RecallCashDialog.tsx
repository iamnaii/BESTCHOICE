import { useEffect, useRef, useState } from 'react';
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
import { fmtMoney, type CashSettleCandidate } from './types';

/**
 * รับเงินสดคืนจากหน้าร้านแทนการหักในรอบจ่าย — สองประเภท (spec 2026-09-20 §6.3):
 *   RECALL        → `POST /interco-settlement/recalls/:contractId/settle-cash` (Flow C-2 เดิม)
 *   DEVICE_RETURN → `POST /interco-settlement/device-returns/:contractId/settle-cash`
 *                   (ค่าเครื่องคืน — FINANCE Dr เงิน / Cr 11-2107 [DEVICE_RETURN] · SHOP Dr S21-1104 / Cr เงิน)
 *
 * - ยอด default = ยอดสุทธิคงเหลือ (`candidate.net`) — แก้ได้ แต่ห้ามเกิน net (server re-check ±0.01)
 * - `requestId` = crypto.randomUUID() ต่อการเปิด dialog หนึ่งครั้ง — คงที่ระหว่าง retry
 * - บัญชีรับเงิน FINANCE จาก CASH_ACCOUNT_CODES (default 11-1201 KBank);
 *   บัญชีจ่ายฝั่ง SHOP default: RECALL S11-1201 / DEVICE_RETURN S11-1202 ตาม service
 */

export type CashSettleKind = 'RECALL' | 'DEVICE_RETURN';

interface RecallCashDialogProps {
  /** แถวที่จะรับเงินสด (normalize แล้ว) — null = ปิด dialog */
  candidate: CashSettleCandidate | null;
  kind: CashSettleKind;
  onClose: () => void;
}

const DEFAULT_FINANCE_ACCOUNT = '11-1201';
const DEFAULT_SHOP_ACCOUNT: Record<CashSettleKind, string> = {
  RECALL: 'S11-1201',
  DEVICE_RETURN: 'S11-1202',
};

const ENDPOINT: Record<CashSettleKind, (contractId: string) => string> = {
  RECALL: (id) => `/interco-settlement/recalls/${id}/settle-cash`,
  DEVICE_RETURN: (id) => `/interco-settlement/device-returns/${id}/settle-cash`,
};

const COPY: Record<
  CashSettleKind,
  {
    title: string;
    what: string;
    amountLabel: string;
    exceeds: string;
    submit: string;
    success: string;
  }
> = {
  RECALL: {
    title: 'รับเงินสดคืนจากหน้าร้าน',
    what: 'ล้างยอดเรียกคืนด้วยเงินสด',
    amountLabel: 'ยอดรับเงินคืน (฿)',
    exceeds: 'ยอดรับเงินคืนเกินยอดเรียกคืนคงเหลือ',
    submit: 'บันทึกรับเงินคืน',
    success: 'รับเงินสดคืนสำเร็จ',
  },
  DEVICE_RETURN: {
    title: 'รับเงินสดค่าเครื่องคืนจากหน้าร้าน',
    what: 'ล้างค่าเครื่องคืนด้วยเงินสด (แทนการหักในรอบจ่าย)',
    amountLabel: 'ยอดรับเงินค่าเครื่องคืน (฿)',
    exceeds: 'ยอดรับเงินเกินค่าเครื่องคืนคงเหลือ',
    submit: 'บันทึกรับเงินค่าเครื่องคืน',
    success: 'รับเงินสดค่าเครื่องคืนสำเร็จ',
  },
};

export function RecallCashDialog({ candidate, kind, onClose }: RecallCashDialogProps) {
  if (!candidate) return null;
  // Identity belongs to the open contract/kind, not the parent's normalized object instance.
  return (
    <CashSettlementSession
      key={`${kind}:${candidate.contractId}`}
      candidate={candidate}
      kind={kind}
      onClose={onClose}
    />
  );
}

function CashSettlementSession({
  candidate,
  kind,
  onClose,
}: Omit<RecallCashDialogProps, 'candidate'> & { candidate: CashSettleCandidate }) {
  const queryClient = useQueryClient();
  const copy = COPY[kind];
  const [amount, setAmount] = useState(candidate.net);
  const [financeAccount, setFinanceAccount] = useState(DEFAULT_FINANCE_ACCOUNT);
  const [shopAccount, setShopAccount] = useState(DEFAULT_SHOP_ACCOUNT[kind]);
  const [requestId] = useState(() => crypto.randomUUID());
  const submitting = useRef(false);
  const active = useRef(true);

  // A parent can replace the selected contract while a request completes in the background.
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const mutation = useMutation({
    retry: false,
    mutationFn: async (payload: {
      amount: number;
      financeDepositAccountCode: string;
      shopPayoutAccountCode: string;
      requestId: string;
    }) => {
      return (await api.post(ENDPOINT[kind](candidate.contractId), payload)).data as {
        financeEntryNo: string;
        shopEntryNo: string;
        deduped: boolean;
      };
    },
    onSuccess: (data) => {
      toast.success(
        data?.deduped
          ? 'รายการนี้ถูกบันทึกไปก่อนหน้าแล้ว (ไม่บันทึกซ้ำ)'
          : `${copy.success} — ใบสำคัญ ${data?.financeEntryNo ?? ''} / ${data?.shopEntryNo ?? ''}`,
      );
      queryClient.invalidateQueries({ queryKey: ['interco-pending'] });
      queryClient.invalidateQueries({ queryKey: ['interco-aging'] });
      queryClient.invalidateQueries({ queryKey: ['repossessions'] });
      if (active.current) onClose();
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'เกิดข้อผิดพลาด กรุณาลองใหม่';
      toast.error(msg);
    },
    onSettled: () => {
      submitting.current = false;
    },
  });

  const netNum = Number(candidate?.net ?? 0);
  const amountNum = Number(amount);
  const amountInvalid = amount.trim() === '' || Number.isNaN(amountNum) || amountNum <= 0;
  const amountExceeds = !amountInvalid && amountNum > netNum + 0.01;
  const locked = mutation.isPending || mutation.isSuccess;
  const canSubmit = !amountInvalid && !amountExceeds && !locked;

  return (
    <Dialog open onOpenChange={(open) => !open && !submitting.current && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription className="leading-snug">
            สัญญา <span className="font-semibold">{candidate?.contractNumber ?? ''}</span> —{' '}
            {copy.what} (FINANCE: Dr เงินสด/ธนาคาร / Cr 11-2107 · SHOP: Dr S21-1104 / Cr
            เงินสด/ธนาคาร) ยอดคงเหลือสุทธิ{' '}
            <span className="font-semibold tabular-nums">฿{fmtMoney(candidate?.net)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="recall-cash-amount">{copy.amountLabel}</Label>
            <Input
              id="recall-cash-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={amount}
              disabled={locked}
              onChange={(e) => setAmount(e.target.value)}
            />
            {amountExceeds && (
              <p className="text-xs text-destructive leading-snug">
                {copy.exceeds} ฿{fmtMoney(candidate?.net)} ไม่อนุญาต
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>บัญชีรับเงินฝั่ง FINANCE</Label>
            <CashAccountSelect
              value={financeAccount}
              disabled={locked}
              onChange={setFinanceAccount}
              placeholder="เลือกบัญชีรับเงิน"
            />
          </div>

          <div className="space-y-1.5">
            <Label>
              บัญชีจ่ายเงินฝั่ง SHOP{' '}
              <span className="font-normal text-muted-foreground">
                (ค่าเริ่มต้น {DEFAULT_SHOP_ACCOUNT[kind]})
              </span>
            </Label>
            <CashAccountSelect
              value={shopAccount}
              disabled={locked}
              onChange={setShopAccount}
              placeholder="เลือกบัญชีจ่ายเงิน"
              codes={SHOP_CASH_ACCOUNT_CODES}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => !submitting.current && onClose()}
            disabled={mutation.isPending}
          >
            ยกเลิก
          </Button>
          <Button
            onClick={() => {
              if (!canSubmit || submitting.current) return;
              submitting.current = true;
              mutation.mutate({
                amount: amountNum,
                financeDepositAccountCode: financeAccount,
                shopPayoutAccountCode: shopAccount,
                requestId,
              });
            }}
            disabled={!canSubmit}
          >
            {mutation.isPending ? 'กำลังบันทึก...' : copy.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
