import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Paperclip, X } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { toLocalDateString } from '@/lib/date';
import { fmtMoney, type PendingContract } from './types';

/**
 * เมนู "จ่ายให้หน้าร้าน (INTER-CO)" — สร้างรอบจ่ายจากสัญญาที่เลือกในแท็บ "รอจ่าย".
 *
 * รองรับ "โหมดย้อนหลัง" (D2/D4 spec §7) เพียงแค่ให้ `transferDate` เป็นวันที่
 * ในอดีตได้ — closed-period ตรวจตอน `approve` เท่านั้น (ไม่ตรวจที่นี่ ตาม
 * plan Task 6, งวดปิดจะโผล่เป็น error ที่ `BatchDetailSheet`).
 *
 * Spec: docs/superpowers/specs/2026-07-30-interco-settlement-batch-design.md §7, §8
 */

const FINANCE_BANK_OPTIONS = [
  { code: '11-1201', label: '11-1201 ธนาคาร KBank' },
  { code: '11-1202', label: '11-1202 ธนาคาร SCB (ค่าใช้จ่าย)' },
  { code: '11-1203', label: '11-1203 ธนาคาร SCB (ค่าเสื่อม)' },
];

const SHOP_BANK_OPTIONS = [
  { code: 'S11-1201', label: 'S11-1201 รับเข้า (default)' },
  { code: 'S11-1202', label: 'S11-1202 จ่ายออก' },
];

const ACCEPTED_SLIP_TYPES = 'application/pdf,image/jpeg,image/png,image/webp';

const createBatchSchema = z.object({
  transferDate: z.string().min(1, 'กรุณาระบุวันที่โอน'),
  financeBankCode: z.string().min(1, 'กรุณาเลือกบัญชี FINANCE'),
  shopBankCode: z.string().min(1, 'กรุณาเลือกบัญชี SHOP'),
  transferRef: z.string().max(100, 'ไม่เกิน 100 ตัวอักษร').optional(),
  note: z.string().max(1000, 'ไม่เกิน 1000 ตัวอักษร').optional(),
});
type CreateBatchFormValues = z.infer<typeof createBatchSchema>;

function defaultFormValues(): CreateBatchFormValues {
  return {
    transferDate: toLocalDateString(),
    financeBankCode: '11-1201',
    shopBankCode: 'S11-1201',
    transferRef: '',
    note: '',
  };
}

interface CreateBatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedContracts: PendingContract[];
  onCreated: (batchId: string) => void;
}

export function CreateBatchDialog({
  open,
  onOpenChange,
  selectedContracts,
  onCreated,
}: CreateBatchDialogProps) {
  const [file, setFile] = useState<File | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateBatchFormValues>({
    resolver: standardSchemaResolver(createBatchSchema),
    defaultValues: defaultFormValues(),
  });

  // Reset the form (fresh transferDate + cleared file) every time the dialog
  // opens for a new selection — otherwise a second "สร้างรอบจ่าย" click would
  // silently reuse yesterday's stale values.
  useEffect(() => {
    if (open) {
      reset(defaultFormValues());
      setFile(null);
    }
  }, [open, reset]);

  const totalAmount = selectedContracts.reduce(
    (sum, c) => sum + Number(c.financedGl) + Number(c.commissionGl),
    0,
  );
  const legacyCount = selectedContracts.filter((c) => c.legacyNoShop).length;

  const createMutation = useMutation({
    mutationFn: async (values: CreateBatchFormValues) => {
      const { data: batch } = await api.post<{ id: string; batchNumber: string }>(
        '/interco-settlement/batches',
        {
          contractIds: selectedContracts.map((c) => c.contractId),
          transferDate: values.transferDate,
          financeBankCode: values.financeBankCode,
          shopBankCode: values.shopBankCode,
          transferRef: values.transferRef?.trim() || undefined,
          note: values.note?.trim() || undefined,
        },
      );

      // Slip is optional (spec §6 — backfill rounds may have no slip left) —
      // upload only when the maker actually picked a file.
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        await api.post(`/interco-settlement/batches/${batch.id}/slip`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }

      return batch;
    },
    onSuccess: (batch) => {
      toast.success(`สร้างรอบจ่าย ${batch.batchNumber} เรียบร้อย`);
      onOpenChange(false);
      onCreated(batch.id);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const onSubmit = (values: CreateBatchFormValues) => {
    if (selectedContracts.length === 0) {
      toast.error('กรุณาเลือกอย่างน้อย 1 สัญญา');
      return;
    }
    createMutation.mutate(values);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !createMutation.isPending && onOpenChange(v)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>สร้างรอบจ่าย</DialogTitle>
          <DialogDescription className="leading-snug">
            เลือกแล้ว {selectedContracts.length} สัญญา • รวม ฿{fmtMoney(totalAmount)}
            {legacyCount > 0 && (
              <span className="block mt-1 text-warning">
                {legacyCount} สัญญาเป็น LEGACY (SHOP ไม่มียอดตั้งต้น) — ฝั่ง SHOP จะไม่ลงบัญชีให้สัญญากลุ่มนี้
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ic-transferDate">วันที่โอน *</Label>
              <Input id="ic-transferDate" type="date" {...register('transferDate')} />
              {errors.transferDate && (
                <p className="text-xs text-destructive leading-snug">
                  {errors.transferDate.message}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ic-transferRef">เลขที่อ้างอิงโอน</Label>
              <Input
                id="ic-transferRef"
                placeholder="เช่น TXN-2026-08-001"
                maxLength={100}
                {...register('transferRef')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ic-financeBankCode">บัญชี FINANCE (จ่ายออก)</Label>
              <select
                id="ic-financeBankCode"
                {...register('financeBankCode')}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
              >
                {FINANCE_BANK_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ic-shopBankCode">บัญชี SHOP (รับเข้า)</Label>
              <select
                id="ic-shopBankCode"
                {...register('shopBankCode')}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
              >
                {SHOP_BANK_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ic-note">หมายเหตุ</Label>
            <Textarea id="ic-note" rows={2} maxLength={1000} {...register('note')} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ic-slip">สลิป/หลักฐานโอน (ไม่บังคับ)</Label>
            {file ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm">
                <Paperclip className="size-4 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate leading-snug">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="ลบไฟล์ที่แนบ"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <Input
                id="ic-slip"
                type="file"
                accept={ACCEPTED_SLIP_TYPES}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createMutation.isPending}
            >
              ยกเลิก
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || selectedContracts.length === 0}
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              สร้างรอบจ่าย
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
