import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RepairCenterCombobox } from '@/pages/insurance/components/RepairCenterCombobox';
import { afterSalesKeys, PAYER_LABEL, type Payer } from './after-sales';

/**
 * 4 dialog ของ Step 5 — ส่งซ่อม / ซ่อมเสร็จ / ส่งซ่อมต่อ / ยกเลิกเคส. ทุก mutation:
 * onSuccess → toast.success + invalidateQueries(afterSalesKeys.all) + ปิด dialog,
 * onError → toast.error(getErrorMessage). ("ส่งมอบคืน" ใช้ ConfirmDialog กลาง — เขียนตรงใน
 * AfterSalesCasePage.tsx ไม่ได้อยู่ในไฟล์นี้ เพราะไม่มีฟอร์มให้กรอก)
 */
const inputClass =
  'h-11 w-full rounded-lg border border-input bg-background px-3.5 text-sm leading-snug text-foreground placeholder:text-muted-foreground/70';
const areaClass =
  'w-full resize-none rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm leading-snug text-foreground placeholder:text-muted-foreground/70';

const SEND_BACK_MIN_NOTE = 5;
const CANCEL_MIN_REASON = 10;

interface DialogBaseProps {
  caseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SendRepairDialog({ caseId, open, onOpenChange }: DialogBaseProps) {
  const queryClient = useQueryClient();
  const [supplier, setSupplier] = useState<{ id: string; name: string } | null>(null);
  const [claimNo, setClaimNo] = useState('');
  const [estimatedCost, setEstimatedCost] = useState('');

  useEffect(() => {
    if (open) {
      setSupplier(null);
      setClaimNo('');
      setEstimatedCost('');
    }
  }, [open]);

  // ค่าซ่อมประมาณเป็นช่องไม่บังคับ — ว่างได้ แต่ถ้ากรอกต้องเป็นตัวเลข >= 0 (R22 fix round 1,
  // แบบเดียวกับ MarkRepairedDialog.actualCost)
  const estimatedCostParsed = Number(estimatedCost);
  const estimatedCostValid =
    estimatedCost.trim() === '' || (!Number.isNaN(estimatedCostParsed) && estimatedCostParsed >= 0);

  const mutate = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { repairSupplierId: supplier!.id };
      if (claimNo.trim()) body.externalClaimNo = claimNo.trim();
      if (estimatedCost.trim()) body.estimatedCost = estimatedCostParsed;
      return (await api.post(`/after-sales/${caseId}/repair/send`, body)).data;
    },
    onSuccess: () => {
      toast.success('ส่งซ่อมแล้ว');
      queryClient.invalidateQueries({ queryKey: afterSalesKeys.all });
      onOpenChange(false);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ส่งซ่อม</DialogTitle>
          <DialogDescription>เลือกศูนย์ซ่อมที่จะส่งเครื่องไป</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <span className="block text-xs leading-snug text-muted-foreground">
            ศูนย์ซ่อม <span className="text-destructive">*</span>
          </span>
          <RepairCenterCombobox
            value={supplier?.id ?? ''}
            displayName={supplier?.name}
            onSelect={(s) => setSupplier(s)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="sr-claim" className="block text-xs leading-snug text-muted-foreground">
            เลขเคลม
          </label>
          <input
            id="sr-claim"
            value={claimNo}
            onChange={(e) => setClaimNo(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="sr-cost" className="block text-xs leading-snug text-muted-foreground">
            ค่าซ่อมประมาณ
          </label>
          <input
            id="sr-cost"
            inputMode="decimal"
            value={estimatedCost}
            onChange={(e) => setEstimatedCost(e.target.value)}
            className={inputClass}
          />
          {!estimatedCostValid && (
            <p className="text-xs leading-snug text-destructive">กรอกเป็นตัวเลขตั้งแต่ 0 ขึ้นไป</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutate.isPending}>
            ยกเลิก
          </Button>
          <Button
            variant="primary"
            disabled={!supplier || !estimatedCostValid || mutate.isPending}
            onClick={() => mutate.mutate()}
          >
            {mutate.isPending ? 'กำลังบันทึก…' : 'ส่งซ่อม'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface MarkRepairedDialogProps extends DialogBaseProps {
  defaultPayer: Payer;
}

export function MarkRepairedDialog({
  caseId,
  open,
  onOpenChange,
  defaultPayer,
}: MarkRepairedDialogProps) {
  const queryClient = useQueryClient();
  const [actualCost, setActualCost] = useState('');
  const [payer, setPayer] = useState<Payer>(defaultPayer);

  useEffect(() => {
    if (open) {
      setActualCost('');
      setPayer(defaultPayer);
    }
  }, [open, defaultPayer]);

  const parsed = Number(actualCost);
  const valid = actualCost.trim() !== '' && !Number.isNaN(parsed) && parsed >= 0;

  const mutate = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/after-sales/${caseId}/repair/mark-repaired`, {
          actualCost: parsed,
          payer,
        })
      ).data,
    onSuccess: () => {
      toast.success('บันทึกซ่อมเสร็จแล้ว');
      queryClient.invalidateQueries({ queryKey: afterSalesKeys.all });
      onOpenChange(false);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>บันทึกซ่อมเสร็จ</DialogTitle>
          <DialogDescription>บันทึกค่าซ่อมจริงและผู้จ่ายก่อนปิดขั้นตอนซ่อม</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <label
            htmlFor="mr-actual-cost"
            className="block text-xs leading-snug text-muted-foreground"
          >
            ค่าซ่อมจริง <span className="text-destructive">*</span>
          </label>
          <input
            id="mr-actual-cost"
            inputMode="decimal"
            value={actualCost}
            onChange={(e) => setActualCost(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="mr-payer" className="block text-xs leading-snug text-muted-foreground">
            ผู้จ่ายค่าซ่อม <span className="text-destructive">*</span>
          </label>
          <select
            id="mr-payer"
            value={payer}
            onChange={(e) => setPayer(e.target.value as Payer)}
            className={inputClass}
          >
            {(['SHOP', 'CUSTOMER', 'SUPPLIER_CLAIM'] as const).map((p) => (
              <option key={p} value={p}>
                {PAYER_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutate.isPending}>
            ยกเลิก
          </Button>
          <Button
            variant="primary"
            disabled={!valid || mutate.isPending}
            onClick={() => mutate.mutate()}
          >
            {mutate.isPending ? 'กำลังบันทึก…' : 'ยืนยัน'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SendBackDialog({ caseId, open, onOpenChange }: DialogBaseProps) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) setNote('');
  }, [open]);

  const valid = note.trim().length >= SEND_BACK_MIN_NOTE;

  const mutate = useMutation({
    mutationFn: async () =>
      (await api.post(`/after-sales/${caseId}/repair/send-back`, { note: note.trim() })).data,
    onSuccess: () => {
      toast.success('ส่งซ่อมต่อแล้ว');
      queryClient.invalidateQueries({ queryKey: afterSalesKeys.all });
      onOpenChange(false);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ส่งซ่อมต่อ</DialogTitle>
          <DialogDescription>บันทึกเหตุผลที่ต้องส่งเครื่องกลับไปซ่อมต่อ</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <label htmlFor="sb-note" className="block text-xs leading-snug text-muted-foreground">
            เหตุผล <span className="text-destructive">*</span> (อย่างน้อย {SEND_BACK_MIN_NOTE}{' '}
            ตัวอักษร)
          </label>
          <textarea
            id="sb-note"
            rows={3}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={areaClass}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutate.isPending}>
            ยกเลิก
          </Button>
          <Button
            variant="primary"
            disabled={!valid || mutate.isPending}
            onClick={() => mutate.mutate()}
          >
            {mutate.isPending ? 'กำลังบันทึก…' : 'ยืนยัน'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CancelCaseDialog({ caseId, open, onOpenChange }: DialogBaseProps) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const valid = reason.trim().length >= CANCEL_MIN_REASON;

  const mutate = useMutation({
    mutationFn: async () =>
      (await api.post(`/after-sales/${caseId}/cancel`, { reason: reason.trim() })).data,
    onSuccess: () => {
      toast.success('ยกเลิกเคสแล้ว');
      queryClient.invalidateQueries({ queryKey: afterSalesKeys.all });
      onOpenChange(false);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ยกเลิกเคส</DialogTitle>
          <DialogDescription>เคสนี้จะถูกปิดเป็นสถานะยกเลิก</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <label htmlFor="cc-reason" className="block text-xs leading-snug text-muted-foreground">
            เหตุผลที่ยกเลิก <span className="text-destructive">*</span> (อย่างน้อย{' '}
            {CANCEL_MIN_REASON} ตัวอักษร)
          </label>
          <textarea
            id="cc-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={areaClass}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutate.isPending}>
            ปิด
          </Button>
          <Button
            variant="destructive"
            disabled={!valid || mutate.isPending}
            onClick={() => mutate.mutate()}
          >
            {mutate.isPending ? 'กำลังบันทึก…' : 'ยืนยันยกเลิก'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
