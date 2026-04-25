import { useEffect, useMemo, useState } from 'react';
import { Receipt } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { PaymentScheduleItem } from '../hooks/useCustomer360';
import { useCreateLateFeeWaiver } from '../hooks/useLateFeeWaiver';

interface Props {
  open: boolean;
  onClose: () => void;
  contract: { id: string; contractNumber: string; customer: { name: string } } | null;
  /**
   * Customer 360 already loaded the payment schedule — passing it in lets
   * the dialog show row-level checkboxes without a second fetch. Only rows
   * with a non-zero late fee that haven't already been waived are
   * selectable (BE re-validates).
   */
  payments: PaymentScheduleItem[] | undefined;
}

interface PaymentWithLateFee extends PaymentScheduleItem {
  lateFee?: number;
  lateFeeWaived?: boolean;
}

/**
 * LateFeeWaiverDialog — collector picks one or more overdue installments
 * with outstanding late fees and submits a request for OWNER approval.
 *
 * UI invariants:
 *  - Only rows with `lateFee > 0` and `!lateFeeWaived` are selectable.
 *  - "เลือกทั้งหมด" toggles all eligible rows.
 *  - Submit blocked until ≥ 1 row + reason ≥ 5 chars.
 */
export default function LateFeeWaiverDialog({ open, onClose, contract, payments }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const create = useCreateLateFeeWaiver();

  // Reset state every time the dialog reopens for a different contract.
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set());
      setReason('');
    }
  }, [open, contract?.id]);

  const eligible = useMemo<PaymentWithLateFee[]>(() => {
    if (!payments) return [];
    return (payments as PaymentWithLateFee[]).filter(
      (p) => (p.lateFee ?? 0) > 0 && !p.lateFeeWaived,
    );
  }, [payments]);

  const totalSelected = useMemo(() => {
    return eligible
      .filter((p) => selectedIds.has(p.id))
      .reduce((sum, p) => sum + (p.lateFee ?? 0), 0);
  }, [eligible, selectedIds]);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === eligible.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(eligible.map((p) => p.id)));
    }
  }

  function handleSubmit() {
    if (!contract || selectedIds.size === 0 || reason.trim().length < 5) return;
    create.mutate(
      {
        contractId: contract.id,
        paymentIds: Array.from(selectedIds),
        reason: reason.trim(),
      },
      { onSuccess: () => onClose() },
    );
  }

  const canSubmit =
    !!contract && selectedIds.size > 0 && reason.trim().length >= 5 && !create.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !create.isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="size-4 text-muted-foreground" /> ขอ waive ค่าปรับ
          </DialogTitle>
          {contract && (
            <DialogDescription className="leading-snug">
              {contract.contractNumber} · {contract.customer.name}
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Payment selection */}
        <div className="space-y-2">
          {eligible.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 py-8 text-center text-sm text-muted-foreground leading-snug">
              ไม่มีงวดที่มีค่าปรับให้ขอ waive
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">เลือกงวดที่ต้องการ waive</Label>
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-xs text-primary hover:underline"
                >
                  {selectedIds.size === eligible.length ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด'}
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {eligible.map((p) => {
                  const checked = selectedIds.has(p.id);
                  return (
                    <label
                      key={p.id}
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-accent"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(p.id)}
                        className="size-4 rounded border-input"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium leading-snug">งวด {p.installmentNo}</div>
                        <div className="text-2xs text-muted-foreground leading-snug">
                          ครบกำหนด{' '}
                          {new Date(p.dueDate).toLocaleDateString('th-TH', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </div>
                      </div>
                      <div className="text-sm tabular-nums font-mono text-destructive">
                        {(p.lateFee ?? 0).toLocaleString()} ฿
                      </div>
                    </label>
                  );
                })}
              </div>
              <div className="flex items-center justify-between pt-1 text-sm">
                <span className="text-muted-foreground leading-snug">รวมยอดที่ขอ waive</span>
                <span className="font-mono tabular-nums font-semibold text-foreground">
                  {totalSelected.toLocaleString()} ฿
                </span>
              </div>
            </>
          )}
        </div>

        {/* Reason */}
        <div className="space-y-1.5">
          <Label htmlFor="waiver-reason">เหตุผล (อย่างน้อย 5 ตัวอักษร)</Label>
          <textarea
            id="waiver-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="เช่น ลูกค้าป่วยเข้า รพ. มีหลักฐานใบรับรองแพทย์"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm leading-snug focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        </div>

        <div className="text-2xs text-muted-foreground leading-snug">
          คำขอนี้จะถูกส่งให้ผู้อนุมัติ (OWNER) — ผู้ขอและผู้อนุมัติต้องเป็นคนละคน
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            ยกเลิก
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {create.isPending ? 'กำลังส่ง...' : 'ส่งคำขอ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
